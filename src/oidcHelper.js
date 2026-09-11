const crypto = require('crypto');
const { db, getConfig, setConfig } = require('./db');

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
 * Bestimmt die OIDC-Basis-URL dynamisch anhand von Umgebungsvariablen, Datenbankkonfiguration oder anfragendem Host.
 */
function getOidcBaseUrl(req) {
  // 1. Explizit konfigurierte Public Base URL prüfen
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL || getConfig('public_base_url');
  if (configuredBaseUrl && configuredBaseUrl.trim()) {
    return configuredBaseUrl.trim().replace(/\/+$/, '');
  }

  // 2. Host und Protokoll über Request / Forward-Header ermitteln
  const proto = req ? (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')) : 'https';
  const host = req ? (req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000') : 'localhost:3000';

  // 3. Optionaler Base-Path (z. B. bei Subdirectory-Deployments)
  let basePath = process.env.BASE_PATH || getConfig('base_path', '');
  if (!basePath && host.toLowerCase() === 'cloud.mso-hef.de') {
    basePath = '/novus';
  }
  if (basePath) {
    basePath = '/' + basePath.replace(/^\/+|\/+$/g, '');
  }

  return `${proto}://${host}${basePath}`;
}

/**
 * Standard-OIDC-Konfigurations-Handler (Discovery Document)
 */
function openidConfigurationHandler(req, res) {
  try {
    const base = getOidcBaseUrl(req);
    const issuer = base; // OIDC-Standard: Issuer muss exakt dem Base-Path der Discovery-URL entsprechen

    res.json({
      issuer: issuer,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      userinfo_endpoint: `${base}/api/oauth/userinfo`,
      end_session_endpoint: `${base}/api/oauth/logout`,
      jwks_uri: `${base}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      claims_supported: ['sub', 'iss', 'auth_time', 'name', 'given_name', 'family_name', 'email', 'preferred_username', 'user_role']
    });
  } catch (error) {
    console.error('OIDC: Fehler im Discovery-Endpoint:', error);
    res.status(500).json({ error: 'server_error', error_description: error.message });
  }
}

/**
 * Standard-JWKS-Handler
 */
function jwksHandler(req, res) {
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
}

module.exports = {
  getOrCreateOidcKeys,
  getOidcBaseUrl,
  openidConfigurationHandler,
  jwksHandler
};
