const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db, getConfig, setConfig } = require('../db');

/**
 * Holt das RSA-Schlüsselpaar für OIDC aus der Datenbank.
 * Falls keines existiert, wird es einmalig generiert und persistiert.
 */
function getOrCreateOidcKeys() {
  let privateKeyPem = getConfig('oidc_private_key');
  let publicKeyPem = getConfig('oidc_public_key');

  if (!privateKeyPem || !publicKeyPem) {
    console.log('OIDC: Generiere neues RSA-Schlüsselpaar (2048 Bit) für RS256...');
    const { generateKeyPairSync } = crypto;
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
    privateKeyPem = privateKey;
    publicKeyPem = publicKey;
    setConfig('oidc_private_key', privateKeyPem);
    setConfig('oidc_public_key', publicKeyPem);
    console.log('OIDC: RSA-Schlüsselpaar erfolgreich in config-Tabelle gespeichert.');
  }

  return { privateKeyPem, publicKeyPem };
}

/**
 * Endpoint 1: Authorization Endpoint (GET /api/oauth/authorize)
 * Leitet den Benutzer zum Login weiter (falls unauthenticated) oder generiert direkt einen Authorization Code.
 */
router.get('/authorize', (req, res) => {
  try {
    let query = req.query;
    // Wenn Query-Parameter leer sind (nach Login-Redirect), greife auf Session-Puffer zurück
    if (Object.keys(query).length === 0 && req.session.oauthQuery) {
      query = req.session.oauthQuery;
    }

    const { client_id, redirect_uri, response_type, state, scope } = query;

    if (!client_id || !redirect_uri || response_type !== 'code') {
      return res.status(400).send('Ungültige OAuth 2.0 Parameter. client_id, redirect_uri und response_type=code sind erforderlich.');
    }

    // 1. Client validieren
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id);
    if (!client) {
      return res.status(400).send('OAuth-Client nicht gefunden.');
    }

    // Redirect-URI exakt abgleichen (oder Unterverzeichnis-Check, aber exakt ist am sichersten)
    if (client.redirect_uri !== redirect_uri) {
      return res.status(400).send('Die angegebene redirect_uri stimmt nicht mit der registrierten URI überein.');
    }

    // 2. Prüfen, ob der Benutzer angemeldet ist
    if (!req.session.user) {
      // Speichere OAuth-Parameter in der Session, damit wir nach dem Login dorthin zurückkehren
      req.session.oauthQuery = req.query;
      console.log('OAuth-Autorisierung erfordert Login. Speichere Query und leite um:', req.query);
      return res.redirect('/novus/index.html?login_redirect=oauth');
    }

    // 2b. Sicherstellen, dass die User-ID in der Session gesetzt ist (Auto-Provision)
    // Schüler oder LDAP-Nutzer, die sich über die MSO Cloud anmelden, ohne jemals Moodle
    // manuell genutzt zu haben, haben möglicherweise keine users-Zeile / keine ID in der Session.
    if (!req.session.user.id) {
      const username = req.session.user.username;
      const email = req.session.user.email || '';

      // Versuche, den Benutzer anhand des Benutzernamens aus der DB zu laden
      let dbUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

      if (!dbUser && email) {
        // Fallback: Suche per E-Mail
        dbUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      }

      if (!dbUser) {
        // Benutzer existiert noch nicht in der lokalen DB → anlegen
        console.log(`OAuth: User "${username}" nicht in DB gefunden – lege Eintrag an.`);
        const groups = JSON.stringify(req.session.user.groups || []);
        const displayName = req.session.user.display_name || req.session.user.name || username;
        const info = db.prepare(`
          INSERT INTO users (username, email, role, groups, is_ldap, display_name)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(username, email, req.session.user.role || 'user', groups, displayName);
        req.session.user.id = info.lastInsertRowid;
      } else {
        req.session.user.id = dbUser.id;
      }

      console.log(`OAuth: User-ID für "${username}" in Session gesetzt: ${req.session.user.id}`);
    }

    // 3. Wenn angemeldet: Authorization Code generieren

    const code = crypto.randomBytes(16).toString('hex'); // 32-stellig
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 Minuten Gültigkeit

    db.prepare(`
      INSERT INTO oauth_codes (code, user_id, client_id, redirect_uri, expires_at, used)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(code, req.session.user.id, client_id, redirect_uri, expiresAt);

    // Session aufräumen
    delete req.session.oauthQuery;

    // 4. Zurückleiten zum Client mit Code und State
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    console.log(`OAuth-Code erfolgreich generiert für User ${req.session.user.username}. Leite zurück zu: ${redirectUrl.toString()}`);
    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Fehler im OAuth-Authorize-Endpoint:', error);
    res.status(500).send('Interner OAuth-Serverfehler: ' + error.message);
  }
});

/**
 * Endpoint 2: Token Endpoint (POST /api/oauth/token)
 * Tauscht den Authorization Code gegen ein Access Token ein.
 * Unterstützt HTTP Basic Auth und POST-Body Credentials.
 */
router.post('/token', (req, res) => {
  try {
    let clientId = req.body.client_id;
    let clientSecret = req.body.client_secret;

    // 1. Client-Authentifizierung via HTTP Basic Auth Header prüfen (Standard für Moodle)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('basic ')) {
      const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('ascii').split(':');
      clientId = credentials[0];
      clientSecret = credentials[1];
    }

    const { grant_type, code, redirect_uri } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Client-Credentials fehlen.' });
    }

    if (grant_type !== 'authorization_code' || !code || !redirect_uri) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'grant_type=authorization_code, code und redirect_uri sind erforderlich.' });
    }

    // 2. Client in der DB prüfen
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
    if (!client || client.client_secret !== clientSecret) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Client-ID oder Client-Secret ist ungültig.' });
    }

    // 3. Code prüfen
    const codeRow = db.prepare('SELECT * FROM oauth_codes WHERE code = ?').get(code);
    if (!codeRow) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Ungültiger Authorization Code.' });
    }

    if (codeRow.used === 1) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Der Code wurde bereits verwendet (Einweg-Schutz).' });
    }

    if (codeRow.client_id !== clientId || codeRow.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Code-Mapping (client_id oder redirect_uri) stimmt nicht überein.' });
    }

    // Ablaufdatum prüfen
    if (new Date(codeRow.expires_at) < new Date()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization Code ist abgelaufen.' });
    }

    // 4. Code sofort entwerten (Atomic-Eigenschaft)
    db.prepare('UPDATE oauth_codes SET used = 1 WHERE id = ?').run(codeRow.id);

    // 5. Access Token generieren
    const accessToken = crypto.randomBytes(32).toString('hex'); // 64-stellig
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 Stunde Gültigkeit

    db.prepare(`
      INSERT INTO oauth_tokens (access_token, user_id, client_id, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(accessToken, codeRow.user_id, clientId, expiresAt);

    console.log(`Access Token erfolgreich generiert für Client ${clientId} (User ID ${codeRow.user_id})`);

    // 6. ID-Token Generierung für OIDC (RS256 signiert)
    let idToken = null;
    const user = db.prepare('SELECT id, username, email, role, groups, display_name FROM users WHERE id = ?').get(codeRow.user_id);
    
    if (user) {
      let firstname = user.username;
      let lastname = user.username;

      if (user.display_name && user.display_name.trim()) {
        const parts = user.display_name.trim().split(/\s+/);
        firstname = parts[0];
        lastname = parts.slice(1).join(' ') || parts[0];
      } else if (user.username.includes('.')) {
        const parts = user.username.split('.');
        firstname = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        lastname = parts.slice(1).join(' ');
        lastname = lastname.charAt(0).toUpperCase() + lastname.slice(1);
      } else if (user.email && user.email.includes('@')) {
        const prefix = user.email.split('@')[0];
        if (prefix.includes('.')) {
          const parts = prefix.split('.');
          firstname = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
          lastname = parts.slice(1).join(' ');
          lastname = lastname.charAt(0).toUpperCase() + lastname.slice(1);
        }
      }

      if (user.username.toLowerCase() === 'admin') {
        firstname = 'System';
        lastname = 'Administrator';
      }

      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const host = req.get('host');
      const issuer = `${protocol}://${host}/api/oauth`;

      const { privateKeyPem } = getOrCreateOidcKeys();

      const payload = {
        iss: issuer,
        sub: String(user.id),
        aud: clientId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        name: `${firstname} ${lastname}`,
        given_name: firstname,
        family_name: lastname,
        email: user.email || ''
      };

      idToken = jwt.sign(payload, privateKeyPem, {
        algorithm: 'RS256',
        keyid: 'key-1'
      });
    }

    // Standard OAuth2 Response
    const responseJson = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600
    };

    if (idToken) {
      responseJson.id_token = idToken;
    }

    res.json(responseJson);
  } catch (error) {
    console.error('Fehler im OAuth-Token-Endpoint:', error);
    res.status(500).json({ error: 'server_error', error_description: error.message });
  }
});

/**
 * Endpoint 3: Userinfo Endpoint (GET /api/oauth/userinfo)
 * Gibt Profildaten des angemeldeten Benutzers zurück. Authentifiziert via Bearer Token.
 */
router.get('/userinfo', (req, res) => {
  try {
    let token = null;

    // Token aus Authorization Header extrahieren
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query.access_token) {
      // Fallback auf Query-Parameter
      token = req.query.access_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'Bearer Access Token fehlt.' });
    }

    // 1. Token validieren
    const tokenRow = db.prepare('SELECT * FROM oauth_tokens WHERE access_token = ?').get(token);
    if (!tokenRow) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'Access Token existiert nicht.' });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'Access Token ist abgelaufen.' });
    }

    // 2. Benutzerdaten laden
    const user = db.prepare('SELECT id, username, email, role, groups, display_name FROM users WHERE id = ?').get(tokenRow.user_id);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Zugehöriger Benutzer existiert nicht mehr.' });
    }

    // 3. Vornamen und Nachnamen intelligent bestimmen
    // Priorität: display_name aus LDAP > Trennung am Punkt im Benutzernamen > Fallback auf Benutzernamen
    let firstname = user.username;
    let lastname = user.username;

    if (user.display_name && user.display_name.trim()) {
      // display_name aus LDAP (z. B. "Max Mustermann")
      const parts = user.display_name.trim().split(/\s+/);
      firstname = parts[0];
      lastname = parts.slice(1).join(' ') || parts[0];
    } else if (user.username.includes('.')) {
      const parts = user.username.split('.');
      firstname = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      lastname = parts.slice(1).join(' ');
      lastname = lastname.charAt(0).toUpperCase() + lastname.slice(1);
    } else if (user.email && user.email.includes('@')) {
      const prefix = user.email.split('@')[0];
      if (prefix.includes('.')) {
        const parts = prefix.split('.');
        firstname = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        lastname = parts.slice(1).join(' ');
        lastname = lastname.charAt(0).toUpperCase() + lastname.slice(1);
      }
    }

    if (user.username.toLowerCase() === 'admin') {
      firstname = 'System';
      lastname = 'Administrator';
    }

    // 4. Standard-OIDC Claims zurückgeben (CNs aus den LDAP-DNs extrahieren für saubere Übergabe)
    const rawGroups = JSON.parse(user.groups || '[]');
    const cleanGroups = rawGroups.map(g => {
      const match = g.match(/cn=([^,]+)/i);
      return match ? match[1].trim() : g;
    });

    const claims = {
      sub: String(user.id),
      username: user.username,
      preferred_username: user.username,
      email: user.email || '',
      name: `${firstname} ${lastname}`,
      given_name: firstname,
      family_name: lastname,
      role: user.role,
      groups: cleanGroups
    };

    console.log(`OIDC-Userinfo erfolgreich ausgeliefert für User: ${user.username}`);
    res.json(claims);
  } catch (error) {
    console.error('Fehler im OAuth-Userinfo-Endpoint:', error);
    res.status(500).json({ error: 'server_error', error_description: error.message });
  }
});

/**
 * OIDC Discovery Document (GET /api/oauth/.well-known/openid-configuration)
 */
router.get('/.well-known/openid-configuration', (req, res) => {
  try {
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const host = req.get('host');
    const issuer = `${protocol}://${host}/api/oauth`;

    res.json({
      issuer: issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      claims_supported: ['sub', 'iss', 'auth_time', 'name', 'given_name', 'family_name', 'email']
    });
  } catch (error) {
    console.error('OIDC: Fehler im Discovery-Endpoint:', error);
    res.status(500).json({ error: 'server_error', error_description: error.message });
  }
});

/**
 * JWKS (JSON Web Key Set) Endpoint (GET /api/oauth/jwks)
 */
router.get('/jwks', (req, res) => {
  try {
    const { publicKeyPem } = getOrCreateOidcKeys();
    const publicKeyObj = crypto.createPublicKey(publicKeyPem);
    const jwk = publicKeyObj.export({ format: 'jwk' });

    res.json({
      keys: [
        {
          ...jwk,
          kid: 'key-1',
          use: 'sig',
          alg: 'RS256'
        }
      ]
    });
  } catch (error) {
    console.error('OIDC: Fehler im JWKS-Endpoint:', error);
    res.status(500).json({ error: 'server_error', error_description: error.message });
  }
});

module.exports = router;
