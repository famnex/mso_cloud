const { db } = require('../db');

/**
 * Zentrale Authentifizierungs-Middleware:
 * Prüft bei jedem Aufruf das Vorhandensein einer gültigen Session und lädt
 * den Benutzer-Datensatz live aus der Datenbank, um sicherzustellen, dass:
 * 1. Das Konto noch existiert
 * 2. Das Konto aktiv ist (is_active = 1)
 * 3. Die Sitzung nicht durch eine Rechteänderung / Passwortwechsel invalidiert wurde (auth_version)
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.id) {
    return res.status(401).json({ error: 'Nicht angemeldet. Bitte authentifizieren Sie sich.', authenticated: false });
  }

  try {
    const dbUser = db.prepare(`
      SELECT id, username, email, role, groups, is_ldap, is_active, display_name, auth_version 
      FROM users 
      WHERE id = ?
    `).get(req.session.user.id);

    if (!dbUser || dbUser.is_active === 0) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(401).json({ 
        error: 'Konto existiert nicht mehr oder wurde im System deaktiviert.', 
        account_inactive: true 
      });
    }

    // auth_version Prüfung: Falls im Konto eine neuere auth_version hinterlegt ist als in der Session
    const sessionAuthVersion = req.session.user.auth_version || 1;
    const dbAuthVersion = dbUser.auth_version || 1;
    if (sessionAuthVersion !== dbAuthVersion) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(401).json({ 
        error: 'Ihre Berechtigungen oder Ihr Passwort wurden geändert. Bitte melden Sie sich erneut an.', 
        session_revoked: true 
      });
    }

    // Frische Rolle und Daten aus der Datenbank an req.user und req.session.user anheften
    req.session.user.role = dbUser.role;
    req.user = dbUser;
    next();
  } catch (err) {
    console.error('[AuthMiddleware] Fehler bei der Benutzervalidierung:', err);
    return res.status(500).json({ error: 'Interner Serverfehler bei der Authentifizierung.' });
  }
}

/**
 * Zentrale Administrator-Middleware:
 * Basiert auf Live-Prüfung der Benutzerrolle in der Datenbank.
 * Verhindert Privilege Escalation und ignoriert NODE_ENV=test Bypass.
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      return next();
    }
    return res.status(403).json({ error: 'Zugriff verweigert. Nur Administratoren erlaubt.' });
  });
}

/**
 * Optionale Authentifizierung für öffentliche Endpunkte (z.B. Kachelabruf):
 * Lädt den aktuellen Benutzer, falls angemeldet und aktiv, invalidiert aber tote Sitzungen.
 */
function optionalAuth(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.user = null;
    return next();
  }

  try {
    const dbUser = db.prepare(`
      SELECT id, username, email, role, groups, is_ldap, is_active, display_name, auth_version 
      FROM users 
      WHERE id = ?
    `).get(req.session.user.id);

    if (!dbUser || dbUser.is_active === 0) {
      req.session.destroy(() => {});
      req.user = null;
      return next();
    }

    const sessionAuthVersion = req.session.user.auth_version || 1;
    const dbAuthVersion = dbUser.auth_version || 1;
    if (sessionAuthVersion !== dbAuthVersion) {
      req.session.destroy(() => {});
      req.user = null;
      return next();
    }

    req.session.user.role = dbUser.role;
    req.user = dbUser;
    next();
  } catch (err) {
    console.error('[AuthMiddleware] Fehler in optionalAuth:', err);
    req.user = null;
    next();
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
  optionalAuth
};
