const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, getConfig, setConfig, logEvent } = require('../db');
const ldap = require('../ldap');
const mail = require('../mail');
const studentDb = require('../student_db');

/**
 * Holt den aktuellen Benutzer aus der Session.
 */
router.get('/me', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const impressumUrl = getConfig('impressum_url', 'https://www.mso-hef.de/impressum');
  const platformName = getConfig('platform_name', 'MSO Cloud');
  const platformLogo = getConfig('platform_logo', '');
  const cardLogo = getConfig('card_logo', '');

  if (req.session.user) {
    // 1. Prüfen, ob der Benutzer noch in der lokalen Datenbank existiert und aktiv ist
    const dbUser = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(req.session.user.id);
    if (!dbUser || dbUser.is_active === 0) {
      console.log(`[Express /me] Lokales Konto für Benutzer ${req.session.user.username} ist inaktiv oder existiert nicht mehr.`);
      req.session.destroy();
      return res.json({ logged_in: false, error: 'Konto existiert nicht mehr oder wurde im System deaktiviert.', impressum_url: impressumUrl, platform_name: platformName, platform_logo: platformLogo, card_logo: cardLogo });
    }

    // 2. LDAP-Live-Prüfung oder periodische tägliche Prüfung
    const liveCheckEnabled = getConfig('ldap_live_check_enabled', '0') === '1';
    const ldapEnabled = getConfig('ldap_enabled', '0') === '1';
    
    // Prüfen, ob das letzte LDAP-Check-Intervall (24h) abgelaufen ist
    const now = Date.now();
    const lastCheck = req.session.user.lastLdapCheck || 0;
    const checkInterval = 24 * 60 * 60 * 1000; // 24 Stunden in ms
    const periodicCheckNeeded = ldapEnabled && (now - lastCheck > checkInterval);

    if (liveCheckEnabled || periodicCheckNeeded) {
      let ldapStatus = { active: true, error: null };
      try {
        ldapStatus = await ldap.isUserActiveInLdap(req.session.user.username);
      } catch (err) {
        console.error(`[Express /me] Kritischer Fehler bei LDAP-Live-Prüfung für ${req.session.user.username}:`, err);
        ldapStatus = { active: true, error: 'Routenfehler: ' + err.message };
      }

      if (ldapStatus.error) {
        console.warn(`[Express /me] LDAP-Prüfung fehlgeschlagen: ${ldapStatus.error}. Verwende Fallback (Konto bleibt aktiv).`);
        logEvent('error', 'ldap_live_check_failed', `LDAP-Verbindung fehlgeschlagen bei Live-Prüfung für Benutzer ${req.session.user.username}: ${ldapStatus.error}`, { userId: req.session.user.id });
        // Bei Verbindungsfehlern nach 1 Stunde erneut versuchen statt 24 Stunden zu warten
        req.session.user.lastLdapCheck = now - (23 * 60 * 60 * 1000); 
      } else if (!ldapStatus.active) {
        console.log(`[Express /me] Kicke Benutzer ${req.session.user.username} aus Session da inaktives/gelöschtes LDAP-Konto.`);
        req.session.destroy();
        logEvent('warn', 'user_deactivated_ldap', `Sitzung beendet: Benutzer ${req.session.user.username} ist im LDAP deaktiviert oder gelöscht`, { userId: req.session.user.id });
        return res.json({ logged_in: false, error: 'Konto existiert nicht mehr oder wurde im LDAP/System deaktiviert.', impressum_url: impressumUrl, platform_name: platformName, platform_logo: platformLogo, card_logo: cardLogo });
      } else {
        // Erfolgreich geprüft und aktiv -> Zeitstempel aktualisieren
        req.session.user.lastLdapCheck = now;
      }
    }
    const isStudentRow = db.prepare('SELECT card_image FROM student_profiles WHERE user_id = ?').get(req.session.user.id);
    const disableCheck = getConfig('disable_student_check', '0') === '1';
    const isStudent = disableCheck || !!isStudentRow || req.session.user.role === 'schueler';
    
    const userPayload = {
      ...req.session.user,
      isStudent: isStudent,
      card_image: isStudentRow ? isStudentRow.card_image : null
    };
    res.json({ logged_in: true, user: userPayload, impressum_url: impressumUrl, platform_name: platformName, platform_logo: platformLogo, card_logo: cardLogo });
  } else {
    const maintenanceEnabled = getConfig('maintenance_enabled', '0') === '1';
    const maintenanceMessage = getConfig('maintenance_message', 'Das System wird momentan gewartet. Bitte versuchen Sie es später wieder.');
    res.json({ logged_in: false, impressum_url: impressumUrl, platform_name: platformName, platform_logo: platformLogo, card_logo: cardLogo, maintenance: maintenanceEnabled ? { enabled: true, message: maintenanceMessage } : null });
  }
});

// IP Rate-Limiting für Login (konfigurierbare Fehlversuche & Sperrdauer sowie IP-Whitelist)
const ipLoginAttempts = new Map();

function getMaxLoginAttempts() {
  const val = parseInt(getConfig('login_max_attempts', '5'), 10);
  return isNaN(val) || val <= 0 ? 5 : val;
}

function getLockoutDurationMs() {
  const minutes = parseInt(getConfig('login_lockout_duration_min', '15'), 10);
  const val = isNaN(minutes) || minutes <= 0 ? 15 : minutes;
  return val * 60 * 1000;
}

function ipToLong(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function matchCidr(ip, cidr) {
  try {
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(Math.pow(2, 32 - parseInt(bits, 10)) - 1);
    const ipInt = ipToLong(ip);
    const rangeInt = ipToLong(range);
    if (ipInt !== null && rangeInt !== null) {
      return (ipInt & mask) === (rangeInt & mask);
    }
  } catch (e) {}
  return false;
}

function isIpWhitelisted(ip) {
  const whitelistStr = getConfig('login_ip_whitelist', '');
  if (!whitelistStr || !whitelistStr.trim()) return false;

  const cleanIp = (ip || '').replace(/^::ffff:/, '').trim();
  const entries = whitelistStr.split(/[\n,\s]+/).map(e => e.trim()).filter(Boolean);

  for (const entry of entries) {
    const cleanEntry = entry.replace(/^::ffff:/, '').trim();
    if (!cleanEntry) continue;

    if (cleanIp === cleanEntry) return true;

    if (cleanEntry.includes('*')) {
      const regexPattern = '^' + cleanEntry.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
      if (new RegExp(regexPattern).test(cleanIp)) return true;
    }

    if (cleanEntry.includes('/')) {
      if (matchCidr(cleanIp, cleanEntry)) return true;
    }
  }

  return false;
}

function getIpLockStatus(ip) {
  if (isIpWhitelisted(ip)) {
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: 9999, isWhitelisted: true };
  }

  const maxAttempts = getMaxLoginAttempts();
  const record = ipLoginAttempts.get(ip);
  if (!record) {
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: maxAttempts, isWhitelisted: false };
  }

  const now = Date.now();
  if (record.lockUntil && now < record.lockUntil) {
    const remainingSeconds = Math.ceil((record.lockUntil - now) / 1000);
    return { isLocked: true, remainingSeconds, attemptsLeft: 0, isWhitelisted: false };
  }

  if (record.lockUntil && now >= record.lockUntil) {
    ipLoginAttempts.delete(ip);
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: maxAttempts, isWhitelisted: false };
  }

  const remainingAttempts = Math.max(0, maxAttempts - record.attempts);
  return { isLocked: false, remainingSeconds: 0, attemptsLeft: remainingAttempts, isWhitelisted: false };
}

function recordFailedLogin(ip) {
  if (isIpWhitelisted(ip)) {
    console.log(`[RateLimiter] IP ${ip} ist auf der Whitelist. Sperre für Schul-IPs übersprungen.`);
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: 9999, isWhitelisted: true };
  }

  const maxAttempts = getMaxLoginAttempts();
  const lockoutMs = getLockoutDurationMs();
  const now = Date.now();
  let record = ipLoginAttempts.get(ip);

  if (!record || (record.lockUntil && now >= record.lockUntil)) {
    record = { attempts: 0, lockUntil: null, lastAttempt: now };
  }

  record.attempts += 1;
  record.lastAttempt = now;

  if (record.attempts >= maxAttempts) {
    record.lockUntil = now + lockoutMs;
    ipLoginAttempts.set(ip, record);
    const lockSecs = Math.ceil(lockoutMs / 1000);
    logEvent('warn', 'login_ip_locked', `IP-Adresse ${ip} aufgrund von ${record.attempts} Fehlversuchen für ${Math.ceil(lockoutMs/60000)} Min. gesperrt.`, { ip: ip, attempts: record.attempts });
    return { isLocked: true, remainingSeconds: lockSecs, attemptsLeft: 0, isWhitelisted: false };
  }

  ipLoginAttempts.set(ip, record);
  return { isLocked: false, remainingSeconds: 0, attemptsLeft: maxAttempts - record.attempts, isWhitelisted: false };
}

function resetFailedLogin(ip) {
  ipLoginAttempts.delete(ip);
}

/**
 * Abfragen des aktuellen IP-Sperrstatus
 */
router.get('/login-status', (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const status = getIpLockStatus(clientIp);
  res.json(status);
});

/**
 * Login-API (Lokaler Benutzer oder LDAP)
 */
router.post('/login', async (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const lockStatus = getIpLockStatus(clientIp);

  if (lockStatus.isLocked) {
    const minutes = Math.ceil(lockStatus.remainingSeconds / 60);
    return res.status(429).json({
      error: `Zu viele fehlgeschlagene Anmeldeversuche. Diese IP ist noch für ${lockStatus.remainingSeconds} Sekunden (ca. ${minutes} Min.) für die Anmeldung gesperrt.`,
      locked: true,
      remaining_seconds: lockStatus.remainingSeconds,
      attempts_left: 0
    });
  }

  const password = req.body.password;
  const username = String(req.body.username || '').trim().toLowerCase();

  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }

  try {
    // 0. Wartungsmodus prüfen
    if (getConfig('maintenance_enabled', '0') === '1') {
      const maintMsg = getConfig('maintenance_message', 'Das System wird momentan gewartet. Bitte versuchen Sie es später wieder.');
      logEvent('info', 'login_blocked_maintenance', `Login blockiert (Wartungsmodus) für: ${username}`, null, clientIp);
      return res.status(503).json({ error: maintMsg, maintenance: true });
    }

    const ldapEnabled = getConfig('ldap_enabled') === '1';

    // 1. LDAP Login-Versuch durchführen (wenn LDAP in den Einstellungen aktiviert ist)
    if (ldapEnabled) {
      console.log(`Versuche LDAP-Login für Benutzer: ${username}`);
      const ldapResult = await ldap.authenticate(username, password);

      // Verbindungsfehler – NICHT als falsches Passwort werten!
      if (ldapResult && ldapResult.isLdapError) {
        logEvent('error', 'ldap_connection_error', `LDAP-Verbindungsfehler beim Login-Versuch für: ${username} (Code: ${ldapResult.code})`, { code: ldapResult.code, message: ldapResult.message }, clientIp);
        return res.status(503).json({
          error: 'Anmeldung ist momentan nicht möglich. Bitte versuchen Sie es später wieder. Die Administratoren sind bereits informiert.',
          ldap_error: true
        });
      }

      const ldapUser = ldapResult; // null = falsches Passwort oder User nicht gefunden
      
      if (ldapUser) {
        // LDAP-Login erfolgreich! Synchronisiere mit lokaler Cache-Datenbank
        resetFailedLogin(clientIp);
        let localCache = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
        let userId;

        const groupsJson = JSON.stringify(ldapUser.rawGroups);
        
        // Bestimme Rolle: Wenn eine der LDAP-Gruppen dem Admin-Mapping entspricht
        let role = 'user';
        if (ldapUser.roles.includes('Admin')) {
          role = 'admin';
        } else if (localCache) {
          role = localCache.role; // Bestehende Rolle beibehalten
        }

        const emailLower = (ldapUser.email || '').trim().toLowerCase();

        if (localCache) {
          // Cache aktualisieren
          db.prepare(`
            UPDATE users 
            SET email = ?, role = ?, groups = ?, is_ldap = 1, display_name = ?, dn = ?, first_name = ?, last_name = ?
            WHERE id = ?
          `).run(emailLower, role, groupsJson, ldapUser.name, ldapUser.dn, ldapUser.givenName, ldapUser.sn, localCache.id);
          userId = localCache.id;
        } else {
          // Neu anlegen
          const info = db.prepare(`
            INSERT INTO users (username, email, password_hash, role, groups, is_ldap, display_name, dn, first_name, last_name)
            VALUES (?, ?, NULL, ?, ?, 1, ?, ?, ?, ?)
          `).run(username, emailLower, role, groupsJson, ldapUser.name, ldapUser.dn, ldapUser.givenName, ldapUser.sn);
          userId = info.lastInsertRowid;
        }

        const ldapStudentRow = db.prepare('SELECT card_image FROM student_profiles WHERE user_id = ?').get(userId);

        req.session.user = {
          id: userId,
          username: username,
          email: emailLower,
          role: role,
          groups: ldapUser.rawGroups,
          isLdap: true,
          display_name: ldapUser.name,
          dn: ldapUser.dn,
          givenName: ldapUser.givenName,
          sn: ldapUser.sn,
          card_image: ldapStudentRow ? ldapStudentRow.card_image : null
        };
        req.session.plain_password = password; // Passwort für Autologin-Verfahren zwischenspeichern
        const returnTo = req.session.returnTo || null;
        if (returnTo) {
          delete req.session.returnTo;
        }

        const isOauth = !!req.session.oauthQuery;
        logEvent('info', 'login_success', `LDAP-Login erfolgreich für: ${ldapUser.username}`, { userId: userId, role: role, groups: ldapUser.rawGroups }, clientIp);
        return res.json({ success: true, user: req.session.user, oauth_redirect: isOauth, return_to: returnTo });
      }
    }

    // 2. Lokalen Login-Versuch durchführen (falls LDAP deaktiviert ist oder der Benutzer ein reines lokales Konto nutzt)
    const localUser = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    
    if (localUser && localUser.password_hash) {
      // Wenn das Konto als LDAP-Konto markiert ist, aber der LDAP-Login fehlschlug -> Fehler
      if (ldapEnabled && localUser.is_ldap === 1) {
        console.warn(`LDAP-Authentifizierung für LDAP-Konto ${username} fehlgeschlagen.`);
        const failStatus = recordFailedLogin(clientIp);
        const maxAttempts = getMaxLoginAttempts();
        if (failStatus.isLocked) {
          const lockMin = Math.ceil(failStatus.remainingSeconds / 60);
          return res.status(429).json({
            error: `Zu viele fehlgeschlagene Anmeldeversuche (${maxAttempts} von ${maxAttempts}). Diese IP wurde für ${lockMin} Minuten für die Anmeldung gesperrt.`,
            locked: true,
            remaining_seconds: failStatus.remainingSeconds,
            attempts_left: 0
          });
        }
        return res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort.' });
      }

      const match = bcrypt.compareSync(password, localUser.password_hash);
      if (match) {
        // Lokaler Login erfolgreich!
        resetFailedLogin(clientIp);
        const groups = JSON.parse(localUser.groups || '[]');
        const studentRow = db.prepare('SELECT card_image FROM student_profiles WHERE user_id = ?').get(localUser.id);
        req.session.user = {
          id: localUser.id,
          username: localUser.username,
          email: localUser.email,
          role: localUser.role,
          groups: groups,
          isLdap: false,
          display_name: localUser.display_name || '',
          card_image: studentRow ? studentRow.card_image : null
        };
        req.session.plain_password = password; // Passwort für Autologin-Verfahren zwischenspeichern
        const returnTo = req.session.returnTo || null;
        if (returnTo) {
          delete req.session.returnTo;
        }

        const isOauth = !!req.session.oauthQuery;
        logEvent('info', 'login_success', `Lokaler Login erfolgreich für: ${localUser.username}`, { userId: localUser.id, role: localUser.role }, clientIp);
        return res.json({ success: true, user: req.session.user, oauth_redirect: isOauth, return_to: returnTo });
      }
    }

    // Wenn beide fehlschlagen
    logEvent('warn', 'login_failed', `Fehlgeschlagener Login-Versuch für: ${username}`, null, clientIp);
    const failStatus = recordFailedLogin(clientIp);
    const maxAttempts = getMaxLoginAttempts();

    if (failStatus.isLocked) {
      const lockMin = Math.ceil(failStatus.remainingSeconds / 60);
      return res.status(429).json({
        error: `Zu viele fehlgeschlagene Anmeldeversuche (${maxAttempts} von ${maxAttempts}). Diese IP wurde für ${lockMin} Minuten für die Anmeldung gesperrt.`,
        locked: true,
        remaining_seconds: failStatus.remainingSeconds,
        attempts_left: 0
      });
    }

    res.status(401).json({
      error: failStatus.isWhitelisted 
        ? `Ungültiger Benutzername oder Passwort.`
        : `Ungültiger Benutzername oder Passwort. Verbleibende Anmeldeversuche: ${failStatus.attemptsLeft} von ${maxAttempts}.`,
      locked: false,
      attempts_left: failStatus.attemptsLeft
    });
  } catch (error) {
    console.error('Fehler beim Login:', error);
    logEvent('error', 'login_error', `Ausnahmefehler bei Login für: ${username}`, { error: error.message }, clientIp);
    res.status(500).json({ error: 'Serverfehler während der Authentifizierung: ' + error.message });
  }
});

/**
 * Logout-API
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Fehler beim Abmelden.' });
    }
    res.clearCookie('sid');
    res.json({ success: true });
  });
});

/**
 * E-Mail-Anfrage zur Passwortrücksetzung senden per LDAP (Passwort vergessen)
 */
router.post('/reset-request', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    // Sicherheitshinweis: Immer Erfolg vortäuschen, um E-Mail-Enumeration zu verhindern!
    return res.json({ success: true, message: 'Wenn ein Konto existiert, haben wir dir eine E-Mail gesendet.' });
  }

  try {
    const emailHash = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    const ip = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';

    // Rate Limiting (5 pro E-Mail per Stunde, 20 pro IP per Stunde)
    const emailLimitRow = db.prepare(`
      SELECT COUNT(*) as count FROM password_reset_tokens 
      WHERE email_hash = ? AND created_at >= datetime('now', '-1 hour')
    `).get(emailHash);
    
    const ipLimitRow = db.prepare(`
      SELECT COUNT(*) as count FROM password_reset_tokens 
      WHERE request_ip = ? AND created_at >= datetime('now', '-1 hour')
    `).get(ip);

    if (emailLimitRow.count >= 5 || ipLimitRow.count >= 20) {
      console.warn(`Rate limit hit for password reset request. Email: ${email}, IP: ${ip}`);
      logEvent('warn', 'password_reset_rate_limited', `Rate-Limit für Passwort-Reset überschritten. E-Mail: ${email}`, { emailHash }, ip);
      return res.json({ success: true, message: 'Wenn ein Konto existiert, haben wir dir eine E-Mail gesendet.' });
    }

    // 3. User im LDAP suchen
    const ldapUser = await ldap.findUserByEmail(email);

    if (ldapUser && ldapUser.dn) {
      // Token erzeugen (32 random bytes -> base64url)
      const raw = crypto.randomBytes(32);
      const token = raw.toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 Min gültig
      const createdAt = new Date().toISOString();
      const userAgent = req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 255) : '';

      // In DB eintragen
      db.prepare(`
        INSERT INTO password_reset_tokens (user_dn, token_hash, email_hash, expires_at, created_at, request_ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(ldapUser.dn, tokenHash, emailHash, expiresAt, createdAt, ip, userAgent);

      const host = req.get('host');
      const isSubdir = host.includes('cloud.mso-hef.de') || req.originalUrl.startsWith('/novus');
      const prefix = isSubdir ? '/novus' : '';
      const protocol = host.includes('cloud.mso-hef.de') ? 'https' : (req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http');
      const resetUrl = `${protocol}://${host}${prefix}/index.html?action=reset&token=${token}`;

      // Mail senden
      const htmlContent = `
        <!doctype html><html lang="de"><meta charset="utf-8">
        <body style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.6">
          <p>Hallo,</p>
          <p>du (oder jemand anderes) hat eine Zurücksetzung deines Passworts für dein MSO-Schulkonto angefordert.</p>
          <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none" target="_blank" rel="noopener">Passwort jetzt zurücksetzen</a></p>
          <p>Alternativ: <a href="${resetUrl}" target="_blank" rel="noopener">${resetUrl}</a></p>
          <p style="color:#666;font-size:12px">Der Link ist 15 Minuten gültig.</p>
        </body></html>
      `;

      logEvent('info', 'password_reset_requested', `Passwort-Reset angefordert für: ${email}`, { userDn: ldapUser.dn, expiresAt }, ip);

      try {
        await mail.sendMail(email, 'Passwort zurücksetzen', htmlContent);
        console.log(`LDAP-Password-Reset Mail gesendet an: ${email}`);
      } catch (mailErr) {
        console.error('WARNUNG: E-Mail-Versand fehlgeschlagen (SMTP nicht konfiguriert?):', mailErr.message);
        logEvent('error', 'password_reset_mail_failed', `Fehler beim Senden der Passwort-Reset-Mail an: ${email}`, { error: mailErr.message }, ip);
      }
    } else {
      console.log(`E-Mail ${email} wurde im LDAP nicht gefunden.`);
      logEvent('warn', 'password_reset_user_not_found', `Passwort-Reset angefordert für nicht existierenden LDAP-User: ${email}`, null, ip);
    }

    res.json({ success: true, message: 'Wenn ein Konto existiert, haben wir dir eine E-Mail gesendet.' });
  } catch (error) {
    console.error('Fehler bei der LDAP-Passwort-Reset-Anfrage:', error);
    logEvent('error', 'password_reset_request_error', `Fehler bei Passwort-Reset-Anfrage für E-Mail: ${email}`, { error: error.message }, req.ip || req.headers['x-forwarded-for'] || '0.0.0.0');
    res.status(500).json({ error: 'Interner Serverfehler beim Verarbeiten des Passwort-Resets.' });
  }
});

/**
 * Passwort mit Token tatsächlich im LDAP zurücksetzen
 */
router.post('/reset-password', async (req, res) => {
  const { token, password, confirmPassword } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token und neues Passwort sind erforderlich.' });
  }

  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ error: 'Die Passwörter stimmen nicht überein.' });
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';

  // Passwort-Richtlinie prüfen (Mindestens 8 Zeichen, mindestens 1 Buchstabe und mindestens 1 Zahl)
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const isLongEnough = password.length >= 8;

  if (!hasLetter || !hasNumber || !isLongEnough) {
    logEvent('warn', 'password_reset_policy_failed', 'Passwort-Reset abgelehnt: Passwort erfüllt die Richtlinie nicht', null, ip);
    return res.status(400).json({ 
      error: 'Das Passwort erfüllt die Richtlinie nicht (mindestens 8 Zeichen, mindestens 1 Buchstabe und mindestens 1 Zahl).' 
    });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const nowIso = new Date().toISOString();

    // Aktiven, ungenutzten Reset-Token holen
    const reset = db.prepare(`
      SELECT * FROM password_reset_tokens 
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    `).get(tokenHash, nowIso);

    if (!reset) {
      logEvent('warn', 'password_reset_token_invalid', 'Passwort-Reset-Versuch mit ungültigem oder abgelaufenem Token', { tokenHash }, ip);
      return res.status(400).json({ error: 'Der Link ist ungültig oder abgelaufen.' });
    }

    // Passwort in LDAP ändern (mit Fehlerabfangung)
    let ldapSuccess = false;
    let ldapError = null;

    try {
      console.log(`Setze neues Passwort in LDAP für DN: ${reset.user_dn}`);
      await ldap.changePassword(reset.user_dn, password);
      ldapSuccess = true;
    } catch (err) {
      console.error('LDAP Passwortänderung fehlgeschlagen:', err.message);
      ldapError = err.message;
    }

    // Auch in lokaler DB (users) Passwort aktualisieren, falls der User lokal existiert
    const bcrypt = require('bcryptjs');
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    let userRow = db.prepare('SELECT id FROM users WHERE dn = ?').get(reset.user_dn);
    if (!userRow && reset.email_hash) {
      userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(reset.email_hash);
    }
    if (userRow) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userRow.id);
      db.prepare("UPDATE student_profiles SET start_password = 'geändert' WHERE user_id = ?").run(userRow.id);
    }

    if (!ldapSuccess && !userRow) {
      logEvent('error', 'password_reset_failed', `Fehler beim Setzen des Passworts in LDAP und kein lokales Konto`, { error: ldapError }, ip);
      return res.status(400).json({ error: 'Das Passwort konnte nicht geändert werden: ' + (ldapError || 'LDAP-Verbindung fehlgeschlagen') });
    }

    // Token als verbraucht markieren
    const usedAt = new Date().toISOString();
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(usedAt, reset.id);

    logEvent('info', 'password_reset_success', `Passwort erfolgreich geändert für DN: ${reset.user_dn}`, { userDn: reset.user_dn }, ip);
    res.json({ success: true, message: 'Passwort erfolgreich geändert. Du kannst dich jetzt anmelden.' });
  } catch (error) {
    console.error('Fehler beim Zurücksetzen des Passworts:', error);
    logEvent('error', 'password_reset_failed', `Fehler beim Setzen des Passworts`, { error: error.message }, ip);
    res.status(500).json({ error: 'Fehler beim Passwort-Reset: ' + error.message });
  }
});

/**
 * Passwort für angemeldete User ändern
 */
router.post('/change-password-logged-in', async (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  const { password, confirmPassword } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Neues Passwort ist erforderlich.' });
  }

  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ error: 'Die Passwörter stimmen nicht überein.' });
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';

  // Passwort-Richtlinie prüfen (Mindestens 8 Zeichen, mindestens 1 Buchstabe und mindestens 1 Zahl)
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const isLongEnough = password.length >= 8;

  if (!hasLetter || !hasNumber || !isLongEnough) {
    return res.status(400).json({ error: 'Das Passwort erfüllt die Richtlinie nicht (mindestens 8 Zeichen, mindestens 1 Buchstabe und mindestens 1 Zahl).' });
  }

  try {
    // 1. DN des Users holen (falls nicht in Session)
    let userDn = user.dn;
    if (!userDn) {
      const userRow = db.prepare('SELECT dn FROM users WHERE id = ?').get(user.id);
      if (userRow) userDn = userRow.dn;
    }

    if (!userDn) {
      return res.status(400).json({ error: 'LDAP-DN des Benutzers nicht gefunden.' });
    }

    // 2. Passwort im LDAP ändern
    await ldap.changePassword(userDn, password);

    // 3. Startpasswort in student_profiles als geändert markieren
    db.prepare("UPDATE student_profiles SET start_password = 'geändert' WHERE user_id = ?").run(user.id);

    logEvent('info', 'password_change_logged_in_success', `Passwort über Portal geändert für Benutzer: ${user.username}`, { userId: user.id }, ip);
    res.json({ success: true, message: 'Passwort erfolgreich geändert.' });
  } catch (error) {
    console.error('Fehler beim Ändern des Passworts:', error);
    logEvent('error', 'password_change_logged_in_failed', `Fehler beim Ändern des Passworts für Benutzer: ${user.username}`, { error: error.message }, ip);
    res.status(500).json({ error: 'Fehler beim Ändern des Passworts: ' + error.message });
  }
});

/**
 * Hilfsfunktionen zur symmetrischen Ver- und Entschlüsselung der SPH-Passwörter.
 */
const ENCRYPTION_KEY = crypto.scryptSync(process.env.SESSION_SECRET || 'mso_cloud_default_secret_key_123!', 'salt', 32);
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('Fehler bei der Entschlüsselung:', err);
    return null;
  }
}

/**
 * Gibt den Status der hinterlegten Schulportal-Zugangsdaten für den aktuellen Benutzer aus.
 */
router.get('/sph-credentials', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    const row = db.prepare('SELECT sph_username FROM user_sph_credentials WHERE user_id = ?').get(user.id);
    if (row) {
      res.json({ exists: true, username: row.sph_username });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Speichert oder überschreibt die Schulportal-Zugangsdaten für den angemeldeten Benutzer.
 */
router.post('/sph-credentials', (req, res) => {
  const user = req.session.user;
  const { sph_username, sph_password } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  if (!sph_username || !sph_password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }

  try {
    const encryptedPassword = encrypt(sph_password);
    db.prepare(`
      INSERT OR REPLACE INTO user_sph_credentials (user_id, sph_username, sph_password)
      VALUES (?, ?, ?)
    `).run(user.id, sph_username, encryptedPassword);

    res.json({ success: true, message: 'Zugangsdaten erfolgreich gespeichert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Löscht die hinterlegten Schulportal-Zugangsdaten des angemeldeten Benutzers.
 */
router.delete('/sph-credentials', (req, res) => {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    db.prepare('DELETE FROM user_sph_credentials WHERE user_id = ?').run(user.id);
    res.json({ success: true, message: 'Zugangsdaten erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Gibt den Status der hinterlegten Buchungssystem-Zugangsdaten für den aktuellen Benutzer aus.
 */
router.get('/booking-credentials', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    const row = db.prepare('SELECT booking_username FROM user_booking_credentials WHERE user_id = ?').get(user.id);
    if (row) {
      res.json({ exists: true, username: row.booking_username });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Speichert oder überschreibt die Buchungssystem-Zugangsdaten für den angemeldeten Benutzer.
 */
router.post('/booking-credentials', (req, res) => {
  const user = req.session.user;
  const { booking_username, booking_password } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  if (!booking_username || !booking_password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }

  try {
    const encryptedPassword = encrypt(booking_password);
    db.prepare(`
      INSERT OR REPLACE INTO user_booking_credentials (user_id, booking_username, booking_password)
      VALUES (?, ?, ?)
    `).run(user.id, booking_username, encryptedPassword);

    res.json({ success: true, message: 'Zugangsdaten für das Buchungssystem erfolgreich gespeichert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Löscht die hinterlegten Buchungssystem-Zugangsdaten des angemeldeten Benutzers.
 */
router.delete('/booking-credentials', (req, res) => {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    db.prepare('DELETE FROM user_booking_credentials WHERE user_id = ?').run(user.id);
    res.json({ success: true, message: 'Zugangsdaten erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * ==========================================================================
 * Schülerportal Integration Routes
 * ==========================================================================
 */

/**
 * Validiert die studentische E-Mail-Adresse und sendet einen temporären Anmeldelink per SMTP.
 */
router.post('/student-link', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-Mail-Adresse ist erforderlich.' });
  }

  try {
    // Überprüfen, ob der Schüler existiert und seinen Freigabestatus holen (MySQL / SQLite)
    const userStatus = await studentDb.getStudentByEmail(email);

    if (!userStatus) {
      return res.status(404).json({ 
        error: 'Diese E-Mail-Adresse ist bei der Registrierung nicht hinterlegt oder Ihr Zugang ist noch nicht freigeschaltet. Bitte warten Sie die Begrüßungsmail ab!' 
      });
    }

    if (userStatus.account_status === 'false') {
      // Schüler existiert, ist aber noch nicht freigeschaltet -> "Noch in Bearbeitung" E-Mail senden (analog PHP)
      const mailHtml = `
        <h2>Guten Tag,</h2>
        Sie haben versucht, sich mit dieser E-Mail-Adresse beim Schülerportal der Modellschule Obersberg in Bad Hersfeld anzumelden.<br><br>
        Leider wurde Ihre Anmeldung noch nicht final bearbeitet, sodass wir Sie noch um etwas Geduld bitten.<br>
        Wir senden Ihnen eine Begrüßungsmail, sobald Ihr Zugang freigeschaltet ist.<br><br>
        Mit freundlichen Grüßen<br>
        Modellschule Obersberg<br><br>
        <i>Diese E-Mail wurde automatisch erstellt.</i>
      `;
      
      await mail.sendMail(email.trim(), '[MSO] Schülerportal Anmeldung', mailHtml);
      return res.json({ 
        success: true, 
        pending: true, 
        message: 'Ihre Anmeldung ist noch in Bearbeitung. Sie erhalten eine E-Mail mit weiteren Informationen, sobald Ihr Konto angelegt wurde.' 
      });
    }

    // Token erzeugen (24 Bytes -> 48 Hex-Zeichen) und 20 Minuten Gültigkeit
    const token = crypto.randomBytes(24).toString('hex');
    
    // Token in DB speichern (MySQL / SQLite)
    const result = await studentDb.createStudentToken(email, token, req.ip);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    logEvent('info', 'student_link_requested', `Schüler-Anmeldelink angefordert für: ${email.trim()}`, null, req.ip);

    // Anmeldelink generieren (auf Basis der anfragenden Hostadresse unter Berücksichtigung von Unterverzeichnissen)
    const host = req.get('host');
    const isSubdir = host.includes('cloud.mso-hef.de') || req.originalUrl.startsWith('/novus');
    const prefix = isSubdir ? '/novus' : '';
    const protocol = host.includes('cloud.mso-hef.de') ? 'https' : req.protocol;
    const loginLink = `${protocol}://${host}${prefix}/?student_token=${token}`;

    const mailHtml = `
      <h2>Guten Tag,</h2>
      vielen Dank, dass Sie sich mit dieser E-Mail-Adresse beim Schülerportal der Modellschule Obersberg in Bad Hersfeld angemeldet haben.<br><br>
      Um sich im System anzumelden, können Sie folgenden Link nutzen:<br>
      <a href="${loginLink}"><b>Schülerportal MSO Cloud</b></a><br><br>
      Dieser Link ist <b>einmalig verwendbar</b> und für <b>20 Minuten</b> gültig. Sollte der Link bereits verwendet worden oder abgelaufen sein, können Sie über die Anmeldeseite der MSO Cloud jederzeit einen neuen Link anfordern.<br><br>
      Mit freundlichen Grüßen<br>
      Modellschule Obersberg<br><br>
      <i>Diese E-Mail wurde automatisch erstellt.</i>
    `;

    // E-Mail senden
    try {
      await mail.sendMail(email.trim(), '[MSO] Schülerportal Anmeldelink', mailHtml);
    } catch (mailError) {
      console.warn('WARNUNG: E-Mail-Versand fehlgeschlagen (SMTP nicht konfiguriert?). Der Link wird dennoch generiert:', mailError.message);
    }
    
    // Konsolenprotokollierung zur einfachen lokalen Verifikation/Entwicklung
    console.log(`=================================================`);
    console.log(` Schülerportal-Link generiert für: ${email.trim()}`);
    console.log(` Link: ${loginLink}`);
    console.log(`=================================================`);

    res.json({ 
      success: true, 
      message: 'Ein Anmeldelink wurde an Ihre E-Mail-Adresse versendet. Bitte prüfen Sie auch Ihren Spam-Ordner.' 
    });
  } catch (error) {
    console.error('Fehler beim Generieren des Schüler-Links:', error);
    res.status(500).json({ error: 'Fehler beim Generieren des Links: ' + error.message });
  }
});

/**
 * Führt den automatischen Login durch, wenn ein gültiges E-Mail-Token übergeben wird.
 */
router.post('/student-token-login', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token ist erforderlich.' });
  }

  try {
    const result = await studentDb.verifyStudentToken(token, req.ip);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Express-Sitzung erstellen
    req.session.user = result.user;

    logEvent('info', 'student_token_login_success', `Schüler-Login via E-Mail-Link erfolgreich für: ${result.user.username}`, { userId: result.user.id, email: result.user.email }, req.ip);

    res.json({ 
      success: true, 
      message: 'Erfolgreich über E-Mail-Link angemeldet.', 
      user: req.session.user 
    });
  } catch (error) {
    console.error('Fehler beim E-Mail Token-Login:', error);
    res.status(500).json({ error: 'Fehler beim Login: ' + error.message });
  }
});

/**
 * Ruft die detaillierten Schülerportal-Stammdaten des angemeldeten Benutzers ab.
 */
router.get('/student-profile', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    const profile = await studentDb.getStudentProfile(user);
    if (!profile) {
      if (user.role === 'admin') {
        const dummySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="147" height="196" viewBox="0 0 147 196"><rect width="147" height="196" fill="#1e293b"/><path d="M73.5 98c15.46 0 28-12.54 28-28s-12.54-28-28-28-28 12.54-28 28 12.54 28 28 28zm0 14c-18.67 0-56 9.36-56 28v14h112v-14c0-18.64-37.33-28-56-28z" fill="#38bdf8"/><text x="73.5" y="170" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="sans-serif" font-weight="bold">ADMIN VORSCHAU</text></svg>`;
        const dummyPassphotoBase64 = 'data:image/svg+xml;base64,' + Buffer.from(dummySvg).toString('base64');

        return res.json({
          is_preview: true,
          first_name: 'Max (Vorschau)',
          last_name: 'Mustermann',
          birth_date: '2008-05-15',
          birth_place: 'Bad Hersfeld',
          mediothek_number: '123456789',
          start_password: 'DummyPasswort123!',
          sph_username: '8655.max.mustermann',
          sph_password: 'DummySPHPassword!',
          account_status: 'true',
          card_status: 'Bild verifiziert',
          card_image: dummyPassphotoBase64
        });
      }
      return res.status(404).json({ error: 'Kein Schülerportal-Profil für diesen Account hinterlegt.' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Fehler beim Abrufen des Schülerprofils:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Profils: ' + error.message });
  }
});

/**
 * Speichert das über Pico.js face-cropped Base64-Passbild ab und aktualisiert den Ausweisstatus.
 */
router.post('/student-photo', async (req, res) => {
  const user = req.session.user;
  const { image } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  if (!image) {
    return res.status(400).json({ error: 'Keine Bilddatei übergeben.' });
  }

  if (!image.startsWith('data:image/png') && !image.startsWith('data:image/jpeg')) {
    return res.status(400).json({ error: 'Ungültiges Bildformat. Nur PNG und JPEG erlaubt.' });
  }

  try {
    const result = await studentDb.updateStudentPhoto(user.id, user.email, image);
    logEvent('info', 'student_photo_uploaded', `Benutzer ${user.username} hat sein Passbild aktualisiert (wartet auf Prüfung)`, null, req.ip);
    res.json({
      success: result.success,
      mysqlSuccess: result.mysqlSuccess,
      sqliteSuccess: result.sqliteSuccess,
      message: 'Passbild erfolgreich hochgeladen und zur Prüfung eingereicht.',
      debugLog: result.debugLog
    });
  } catch (error) {
    console.error('Fehler beim Speichern des Passbilds:', error);
    res.status(500).json({ error: 'Fehler beim Speichern: ' + error.message, debugLog: [error.message] });
  }
});

router.encrypt = encrypt;
router.decrypt = decrypt;

module.exports = router;
