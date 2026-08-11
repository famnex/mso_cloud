const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db, getConfig, setConfig, logEvent } = require('../db');
const studentDb = require('../student_db');
const { getOrCreateOidcKeys, getOidcBaseUrl, openidConfigurationHandler, jwksHandler } = require('../oidcHelper');

/**
 * Normalisiert eine URI für robusten Vergleich (entfernt trailing Slashes, gleicht http/https an).
 */
function normalizeUri(uri) {
  if (!uri) return '';
  let u = decodeURIComponent(uri).trim();
  u = u.replace(/\/+$/, '');
  u = u.replace(/^http:/, 'https:');
  return u;
}

/**
 * Ermittelt intelligent Vor- und Nachname eines Benutzers für OIDC Claims (given_name, family_name).
 * Greift primär auf student_db zu (MySQL Schulanmeldungs-Datenbank mit SQLite-Fallback),
 * genau wie das Benutzerprofil.
 */
async function resolveUserNames(user) {
  let firstname = user.first_name ? String(user.first_name).trim() : '';
  let lastname = user.last_name ? String(user.last_name).trim() : '';

  // 1. Primär: Schüler-Profil über student_db abfragen (MySQL dynamic fieldvalues: field 1 = first_name, field 2 = last_name)
  if (user && (user.id || user.username || user.email)) {
    try {
      const studentProf = await studentDb.getStudentProfile(user);
      if (studentProf) {
        if (studentProf.first_name && studentProf.first_name.trim()) {
          firstname = String(studentProf.first_name).trim();
        }
        if (studentProf.last_name && studentProf.last_name.trim()) {
          lastname = String(studentProf.last_name).trim();
        }
      }
    } catch (e) {
      // Ignorieren falls studentDb-Abfrage nicht möglich
    }
  }

  // 2. Sekundär: Falls immer noch leer, aus display_name auflösen
  if (!firstname && !lastname) {
    if (user.display_name && user.display_name.trim()) {
      const dName = user.display_name.trim();
      if (dName.includes(',')) {
        // Format: "Nachname, Vorname"
        const parts = dName.split(',');
        lastname = parts[0].trim();
        firstname = parts.slice(1).join(',').trim();
      } else {
        // Format: "Vorname ... Nachname" (z. B. "Hazim Alaa Hadi Al-Gburi")
        const parts = dName.split(/\s+/);
        if (parts.length === 1) {
          firstname = parts[0];
          lastname = parts[0];
        } else {
          // Das letzte Wort ist der Nachname, alle vorherigen Wörter bilden den Vornamen
          lastname = parts[parts.length - 1];
          firstname = parts.slice(0, parts.length - 1).join(' ');
        }
      }
    } else if (user.username && user.username.includes('.')) {
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
  }

  if (!firstname) firstname = user.username || 'User';
  if (!lastname) lastname = firstname;

  if (user.username && user.username.toLowerCase() === 'admin') {
    firstname = 'System';
    lastname = 'Administrator';
  }

  return { firstname, lastname };
}

/**
 * Ermittelt die Benutzerrolle (lehrer, schueler, forbidden) anhand von LDAP-Gruppen-Mappings, Schülerprofilen, E-Mail-Suffix etc.
 */
function getCNfromDN(dn) {
  if (!dn) return '';
  const match = dn.match(/cn=([^,]+)/i);
  return match ? match[1].trim() : dn;
}

async function determineUserRole(userId, username, email, role, groupsStr, dn) {
  // 1. Primär: LDAP-Mappings aus der DB laden und abgleichen (höchste Priorität für explizit definierte Custom Claim Regeln!)
  const groups = JSON.parse(groupsStr || '[]');
  if (groups.length > 0 || dn) {
    try {
      const mappings = db.prepare('SELECT ldap_group_dn, user_role FROM ldap_mappings').all();
      
      for (const mapping of mappings) {
        if (!mapping.user_role || !mapping.user_role.trim()) continue;
        
        const mappingDN = mapping.ldap_group_dn.toLowerCase();
        
        const checkMatch = (value) => {
          if (!value) return false;
          const valLower = value.toLowerCase();
          
          if (mappingDN.includes('*')) {
            const regexStr = '^' + mappingDN.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*') + '$';
            const regex = new RegExp(regexStr);
            
            if (regex.test(valLower)) return true;
            
            if (!mappingDN.includes('=')) {
              const cn = getCNfromDN(value).toLowerCase();
              if (regex.test(cn)) return true;
            }
            return false;
          }
          
          if (valLower === mappingDN) return true;
          
          const cn = getCNfromDN(value).toLowerCase();
          return cn === mappingDN;
        };

        // 1a. Erst Gruppen des Benutzers abgleichen
        const groupMatch = groups.some(checkMatch);
        if (groupMatch) {
          const mappedRole = mapping.user_role.trim().toLowerCase();
          if (mappedRole) return mappedRole;
        }

        // 1b. Dann den DN des Benutzers selbst abgleichen (für OUs)
        if (dn && checkMatch(dn)) {
          const mappedRole = mapping.user_role.trim().toLowerCase();
          if (mappedRole) return mappedRole;
        }
      }
    } catch (err) {
      console.error('Fehler bei der Rollenermittlung über LDAP-Mappings:', err);
    }
  }

  // 2. Sekundär: Prüfen, ob der Benutzer in den Schülerprofilen (MySQL/SQLite) existiert -> schueler
  try {
    const studentProf = await studentDb.getStudentProfile({ id: userId, username, email });
    if (studentProf) {
      return 'schueler';
    }
  } catch (e) {
    const isStudent = db.prepare('SELECT 1 FROM student_profiles WHERE user_id = ?').get(userId);
    if (isStudent) {
      return 'schueler';
    }
  }

  // 3. E-Mail-Suffix-Check
  if (email && email.toLowerCase().endsWith('@mso-hef.de')) {
    return 'lehrer';
  }

  // 4. Fallback auf System-Rolle (Admin ist meistens Lehrer/Personal)
  if (role === 'admin') {
    return 'lehrer';
  }

  return 'forbidden';
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

    // Redirect-URI abgleichen
    if (normalizeUri(client.redirect_uri) !== normalizeUri(redirect_uri)) {
      console.error(`OAuth Authorize Mismatch for client "${client_id}". Registered redirect_uri: "${client.redirect_uri}", Requested redirect_uri: "${redirect_uri}"`);
      return res.status(400).send(`Die angegebene redirect_uri stimmt nicht mit der registrierten URI überein.\n\nRegistriert: ${client.redirect_uri}\nÜbergeben: ${redirect_uri}`);
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
        const dn = req.session.user.dn || null;
        const firstName = req.session.user.givenName || null;
        const lastName = req.session.user.sn || null;
        const info = db.prepare(`
          INSERT INTO users (username, email, role, groups, is_ldap, display_name, dn, first_name, last_name)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(username, email, req.session.user.role || 'user', groups, displayName, dn, firstName, lastName);
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
router.post('/token', async (req, res) => {
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

    if (codeRow.client_id !== clientId || normalizeUri(codeRow.redirect_uri) !== normalizeUri(redirect_uri)) {
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
    const user = db.prepare('SELECT id, username, email, role, groups, display_name, dn, first_name, last_name FROM users WHERE id = ?').get(codeRow.user_id);
    
    if (user) {
      const { firstname, lastname } = await resolveUserNames(user);
      const issuer = getOidcBaseUrl(req);
      const { privateKeyPem } = getOrCreateOidcKeys();
      const userRole = await determineUserRole(user.id, user.username, user.email, user.role, user.groups, user.dn);

      // Client-Name des anfragenenden SSO-Systems auflösen
      let clientName = clientId;
      const clientRow = db.prepare('SELECT client_name FROM oauth_clients WHERE client_id = ?').get(clientId);
      if (clientRow && clientRow.client_name) {
        clientName = clientRow.client_name;
      }

      const payload = {
        iss: issuer,
        sub: String(user.id),
        aud: clientId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        name: `${firstname} ${lastname}`,
        display_name: `${lastname}, ${firstname}`,
        displayname: `${lastname}, ${firstname}`,
        fullname: `${firstname} ${lastname}`,
        full_name: `${firstname} ${lastname}`,
        untis_name: `${lastname} ${firstname}`,
        given_name: firstname,
        family_name: lastname,
        givenName: firstname,
        sn: lastname,
        firstname: firstname,
        lastname: lastname,
        first_name: firstname,
        last_name: lastname,
        email: user.email || '',
        preferred_username: user.username,
        user_role: userRole
      };

      console.log(`[OIDC DEBUG] Token Claims für ${user.username} (${clientName}): given_name="${firstname}", family_name="${lastname}", user_role="${userRole}"`);
      console.log('OIDC ID-Token Claims:', JSON.stringify(payload, null, 2));
      if (typeof logEvent === 'function') {
        const clientIpDisplay = (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1') 
          ? `127.0.0.1 (${clientName})` 
          : `${req.ip} (${clientName})`;
        logEvent('info', 'oidc_token_claims', `OIDC ID-Token Claims für User: ${user.username} (System: ${clientName}, given_name="${firstname}", family_name="${lastname}")`, payload, clientIpDisplay);
      }

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
router.get('/userinfo', async (req, res) => {
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
    const user = db.prepare('SELECT id, username, email, role, groups, display_name, dn, first_name, last_name FROM users WHERE id = ?').get(tokenRow.user_id);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Zugehöriger Benutzer existiert nicht mehr.' });
    }

    // 3. Vornamen und Nachnamen intelligent bestimmen (unter Nutzung von student_db für MySQL / Schulanmeldung)
    const { firstname, lastname } = await resolveUserNames(user);

    // 4. Standard-OIDC Claims zurückgeben (CNs aus den LDAP-DNs extrahieren für saubere Übergabe)
    const rawGroups = JSON.parse(user.groups || '[]');
    const cleanGroups = rawGroups.map(g => {
      const match = g.match(/cn=([^,]+)/i);
      return match ? match[1].trim() : g;
    });

    const userRole = await determineUserRole(user.id, user.username, user.email, user.role, user.groups, user.dn);

    const claims = {
      sub: String(user.id),
      username: user.username,
      preferred_username: user.username,
      email: user.email || '',
      name: `${firstname} ${lastname}`,
      display_name: `${lastname}, ${firstname}`,
      displayname: `${lastname}, ${firstname}`,
      fullname: `${firstname} ${lastname}`,
      full_name: `${firstname} ${lastname}`,
      untis_name: `${lastname} ${firstname}`,
      given_name: firstname,
      family_name: lastname,
      givenName: firstname,
      sn: lastname,
      firstname: firstname,
      lastname: lastname,
      first_name: firstname,
      last_name: lastname,
      role: user.role,
      groups: cleanGroups,
      user_role: userRole
    };

    // Client-Name des anfragenenden SSO-Systems für das Log auflösen
    let clientName = 'Unbekanntes SSO-System';
    if (tokenRow && tokenRow.client_id) {
      const clientRow = db.prepare('SELECT client_name FROM oauth_clients WHERE client_id = ?').get(tokenRow.client_id);
      if (clientRow && clientRow.client_name) {
        clientName = clientRow.client_name;
      } else {
        clientName = tokenRow.client_id;
      }
    }

    console.log(`[OIDC DEBUG] Userinfo Claims für ${user.username} (${clientName}): given_name="${firstname}", family_name="${lastname}", user_role="${userRole}"`);
    console.log('OIDC Userinfo Claims:', JSON.stringify(claims, null, 2));
    if (typeof logEvent === 'function') {
      const clientIpDisplay = (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1') 
        ? `127.0.0.1 (${clientName})` 
        : `${req.ip} (${clientName})`;
      logEvent('info', 'oidc_userinfo_claims', `OIDC Userinfo Claims für User: ${user.username} (System: ${clientName}, given_name="${firstname}", family_name="${lastname}")`, claims, clientIpDisplay);
    }

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
router.get('/.well-known/openid-configuration', openidConfigurationHandler);

/**
 * JWKS (JSON Web Key Set) Endpoint (GET /api/oauth/jwks)
 */
router.get('/jwks', jwksHandler);

router.get('/logout', (req, res) => {
  try {
    // Der Benutzer soll in der MSO Cloud angemeldet bleiben, wenn er sich bei WebUntis abmeldet.
    // Daher zerstören wir die Session NICHT und ignorieren den post_logout_redirect_uri.
    // Stattdessen leiten wir ihn direkt zurück auf die MSO Cloud Startseite um.
    const host = req.get('host') || '';
    const isSubdir = host.toLowerCase() === 'cloud.mso-hef.de';
    const redirectUrl = isSubdir ? '/novus/' : '/';
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Fehler im OIDC Logout-Endpoint:', error);
    res.redirect('/');
  }
});

router.determineUserRole = determineUserRole;
module.exports = router;
