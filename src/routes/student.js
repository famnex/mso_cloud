const express = require('express');
const router = express.Router();
const { db, getConfig, logEvent } = require('../db');
const studentDb = require('../student_db');
const ldap = require('../ldap');
const {
  evaluateCardEligibility,
  getPersistentGrant,
  revokePersistentGrant
} = require('../services/cardEligibility');

// Einfaches In-Memory IP-Rate-Limiting für öffentliche QR-Verifikation
const verifyRateLimits = new Map();
function checkVerifyRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 Minute
  const maxRequests = 60; // Max 60 Anfragen pro Minute

  const record = verifyRateLimits.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + windowMs;
  } else {
    record.count++;
  }
  verifyRateLimits.set(ip, record);
  return record.count <= maxRequests;
}

/**
 * Holt die Ausweis-Daten des aktuell eingeloggten Schülers.
 */
router.get('/card', async (req, res) => {
  const user = req.session.user;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0';

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  // 1. Prüfen, ob der Benutzer noch in der lokalen Datenbank existiert und aktiv ist
  const dbUser = db.prepare('SELECT id, username, email, display_name, role, is_ldap, is_active, auth_version, is_technik_scout FROM users WHERE id = ?').get(user.id);
  if (!dbUser || dbUser.is_active === 0) {
    console.log(`[Express /card] Lokales Konto für Benutzer ${user.username} ist inaktiv oder existiert nicht mehr.`);
    req.session.destroy(() => {});
    db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(user.id);
    revokePersistentGrant(user.username);
    if (typeof logEvent === 'function') {
      logEvent('warn', 'student_card_account_deleted', `Schülerausweis-Abruf verweigert: Konto für User ${user.username} existiert nicht mehr oder wurde deaktiviert`, { userId: user.id }, clientIp);
    }
    return res.status(401).json({ error: 'Konto existiert nicht mehr oder wurde im System deaktiviert.', account_deleted: true });
  }

  // 1b. Prüfen, ob die Sitzung widerrufen wurde (z.B. nach Passwortänderung oder Rechteanpassung)
  if (user.auth_version !== undefined && dbUser.auth_version !== undefined && dbUser.auth_version !== user.auth_version) {
    console.log(`[Express /card] Sitzung für Benutzer ${user.username} wurde widerrufen (auth_version: session=${user.auth_version}, db=${dbUser.auth_version}).`);
    req.session.destroy(() => {});
    if (typeof logEvent === 'function') {
      logEvent('warn', 'student_card_session_revoked', `Schülerausweis-Abruf verweigert: Sitzung für User ${user.username} wurde widerrufen`, { userId: user.id }, clientIp);
    }
    return res.status(401).json({ error: 'Sitzung wurde widerrufen (Passwort oder Berechtigungen geändert). Bitte erneut anmelden.', session_revoked: true });
  }

  // 2. LDAP-Live-Prüfung ausführen
  const now = new Date();
  let ldapStatus = null;
  try {
    ldapStatus = await ldap.isUserActiveInLdap(user.username);
  } catch (err) {
    console.error(`[Express /card] Kritischer Fehler bei LDAP-Prüfung für ${user.username}:`, err);
    ldapStatus = { active: false, error: 'Verbindungsfehler: ' + err.message };
  }

  // Bei explizitem LDAP-Negativbefund Sitzung sofort terminieren & Grant widerrufen (sofern kein Admin)
  if (ldapStatus && !ldapStatus.error && !ldapStatus.active) {
    if (dbUser.role === 'admin') {
      console.log(`[Express /card] Admin ${user.username} hat kein aktives LDAP-Konto. Sitzung bleibt für Admin-Vorschau erhalten.`);
    } else {
      console.log(`[Express /card] Kicke Benutzer ${user.username} aus Session da inaktives/gelöschtes LDAP-Konto.`);
      req.session.destroy(() => {});
      db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(user.id);
      revokePersistentGrant(user.username);
      if (typeof logEvent === 'function') {
        logEvent('warn', 'student_card_account_deleted', `Schülerausweis-Abruf verweigert: Konto für User ${user.username} ist im LDAP deaktiviert oder gelöscht`, { userId: user.id }, clientIp);
      }
      return res.status(401).json({ error: 'Konto existiert nicht mehr oder wurde im LDAP/System deaktiviert.', account_deleted: true });
    }
  }

  try {
    // 3. Schülerprofil laden (mit Ausweispfad-Prüfung)
    let profile = await studentDb.getStudentProfile(user, { isCardPath: true });
    let isAdminPreview = false;
    if (user.role === 'admin') {
      isAdminPreview = true;
      if (!profile) {
        const dummySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="147" height="196" viewBox="0 0 147 196"><rect width="147" height="196" fill="#1e293b"/><path d="M73.5 98c15.46 0 28-12.54 28-28s-12.54-28-28-28-28 12.54-28 28 12.54 28 28 28zm0 14c-18.67 0-56 9.36-56 28v14h112v-14c0-18.64-37.33-28-56-28z" fill="#38bdf8"/><text x="73.5" y="170" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="sans-serif" font-weight="bold">ADMIN VORSCHAU</text></svg>`;
        const dummyPassphotoBase64 = 'data:image/svg+xml;base64,' + Buffer.from(dummySvg).toString('base64');

        profile = {
          first_name: 'Max (Vorschau)',
          last_name: 'Mustermann',
          birth_date: '2008-05-15',
          birth_place: 'Bad Hersfeld',
          mediothek_number: '123456789',
          card_image: dummyPassphotoBase64,
          card_status: 'Bild verifiziert',
          card_status_code: '1132'
        };
      }
    } else if (!profile) {
      if (typeof logEvent === 'function') {
        logEvent('warn', 'student_card_not_found', `Schülerausweis-Abruf fehlgeschlagen: Kein Schülerprofil für User ${user.username}`, { userId: user.id }, clientIp);
      }
      return res.status(404).json({ error: 'Kein Schülerprofil vorhanden.' });
    } else {
      // Profil in lokaler SQLite synchronisieren für Offline-Puffer
      db.prepare(`
        INSERT INTO student_profiles (
          user_id, first_name, last_name, birth_date, birth_place, 
          mediothek_number, start_password, account_status, card_status, card_image
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          birth_date = excluded.birth_date,
          birth_place = excluded.birth_place,
          mediothek_number = excluded.mediothek_number,
          start_password = excluded.start_password,
          account_status = excluded.account_status,
          card_status = excluded.card_status,
          card_image = excluded.card_image
      `).run(
        user.id,
        profile.first_name || '',
        profile.last_name || '',
        profile.birth_date || null,
        profile.birth_place || '',
        profile.mediothek_number || '',
        profile.start_password || '',
        profile.account_status || 'false',
        profile.card_status || 'Bild ungeprüft / Kein Bild',
        profile.card_image || null
      );
    }

    // 4. Zentrale Gültigkeits- & Pufferbewertung
    const eligibility = evaluateCardEligibility({
      user: dbUser,
      profile: profile,
      ldapStatus: ldapStatus,
      now: now,
      isAdminPreview: isAdminPreview
    });

    let statusSummary = eligibility.statusSummary;
    let logLevel = eligibility.valid ? 'info' : 'warn';

    if (isAdminPreview) {
      statusSummary = 'Admin-Vorschau (Muster - Kein echter Ausweis)';
    }

    const reqSource = req.query.source || req.headers['x-pwa-source'] || req.headers['x-pwa-request'];
    let sourceLabel = 'Web-Browser';
    if (reqSource === 'pwa' || reqSource === 'standalone') {
      sourceLabel = 'PWA App (Homescreen)';
    } else if (reqSource === 'sw' || reqSource === 'service-worker') {
      sourceLabel = 'PWA Service Worker';
    }

    if (typeof logEvent === 'function') {
      const studentName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || user.username;
      logEvent(
        logLevel,
        'student_card_access',
        `Schülerausweis abgerufen für User: ${user.username} (${studentName}) - Status: ${statusSummary} [Quelle: ${sourceLabel}]`,
        {
          username: user.username,
          userId: user.id,
          name: studentName,
          card_status: eligibility.rawStatus,
          expires_at: eligibility.expiresAt,
          offline_valid_until: eligibility.offlineValidUntil,
          is_buffered: eligibility.is_buffered,
          status_summary: statusSummary,
          source: sourceLabel,
          is_admin_preview: isAdminPreview
        },
        clientIp
      );
    }

    res.json({
      username: user.username,
      first_name: profile.first_name,
      last_name: profile.last_name,
      birth_date: profile.birth_date,
      birth_place: profile.birth_place,
      mediothek_number: profile.mediothek_number,
      card_image: profile.card_image,
      card_status: profile.card_status,
      card_status_code: profile.card_status_code || '1130',
      is_card_printed: (profile.card_status_code === '1133' || profile.card_status === 'Ausweis gedruckt' || profile.card_status === 'Ausweis ausgegeben'),
      is_technik_scout: Boolean(eligibility.valid && dbUser && dbUser.is_technik_scout === 1),
      expires_at: eligibility.expiresAt,
      offline_valid_until: eligibility.offlineValidUntil,
      valid: eligibility.valid,
      reason_code: eligibility.reasonCode,
      status_summary: statusSummary,
      is_buffered: eligibility.is_buffered,
      card_version: eligibility.cardVersion,
      server_time: now.toISOString(),
      card_primary_color: getConfig('card_primary_color', '#3b82f6'),
      card_secondary_color: getConfig('card_secondary_color', '#8b5cf6'),
      card_guilloche_pattern: getConfig('card_guilloche_pattern', 'waves'),
      card_guilloche_angle: getConfig('card_guilloche_angle', '0'),
      card_guilloche_fineness: getConfig('card_guilloche_fineness', '1.2'),
      card_guilloche_density: getConfig('card_guilloche_density', '10'),
      card_install_instructions: getConfig('card_install_instructions', ''),
      card_school_name: getConfig('card_school_name', 'Modellschule Obersberg'),
      card_principal_name: getConfig('card_principal_name', 'OStD Karsten Backhaus'),
      card_principal_gender: getConfig('card_principal_gender', 'male'),
      card_logo: getConfig('card_logo', ''),
      card_signature: getConfig('card_signature', ''),
      card_pwa_logging: getConfig('card_pwa_logging', '0'),
      card_pwa_icon: getConfig('card_pwa_icon', ''),
      card_seal: getConfig('card_seal', ''),
      platform_logo: getConfig('platform_logo', ''),
      is_admin_preview: isAdminPreview
    });
  } catch (err) {
    console.error('Fehler beim Laden des Schülerausweises:', err);
    if (typeof logEvent === 'function') {
      logEvent('error', 'student_card_error', `Fehler beim Laden des Schülerausweises für User ${user ? user.username : 'unbekannt'}: ${err.message}`, { error: err.message }, clientIp);
    }
    res.status(500).json({ error: 'Fehler beim Laden des Profils: ' + err.message });
  }
});

/**
 * Liefert das konfigurierte PWA App-Icon aus.
 */
router.get('/pwa-icon', (req, res) => {
  const icon = getConfig('card_pwa_icon', '');
  if (!icon) {
    return res.redirect('/media/icon-512.png');
  }
  const matches = icon.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    return res.redirect('/media/icon-512.png');
  }
  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  res.setHeader('Content-Type', contentType);
  res.send(buffer);
});

/**
 * Prüft anonym den Status eines Schülerausweises (wird von PWAs im Hintergrund aufgerufen).
 */
router.get('/status-check', async (req, res) => {
  const username = String(req.query.username || '').trim();
  if (!username) {
    return res.status(400).json({ error: 'Username ist erforderlich.' });
  }

  try {
    const now = new Date();

    // 1. Lokales Konto prüfen
    const dbUser = db.prepare('SELECT id, username, email, display_name, role, is_active, auth_version, is_technik_scout FROM users WHERE username = ?').get(username);
    if (!dbUser || dbUser.is_active === 0) {
      revokePersistentGrant(username);
      return res.json({
        active: false,
        valid: false,
        account_deleted: true,
        reason_code: 'ACCOUNT_INACTIVE',
        status_summary: 'Konto deaktiviert oder gelöscht.',
        card_status: 'Ausweis gesperrt',
        is_buffered: false,
        is_technik_scout: false
      });
    }

    // 2. Admin-Prüfung: Admin ist kein echter Schülerausweis
    if (dbUser.role === 'admin') {
      return res.json({
        active: false,
        valid: false,
        reason_code: 'ADMIN_PREVIEW',
        status_summary: 'Admin-Vorschau (Kein gültiger Schülerausweis)',
        card_status: 'Vorschau',
        is_admin_preview: true,
        is_buffered: false,
        is_technik_scout: false
      });
    }

    // 3. LDAP-Status prüfen
    let ldapStatus = null;
    try {
      ldapStatus = await ldap.isUserActiveInLdap(username);
    } catch (err) {
      console.error(`[Express /status-check] LDAP-Prüfungsfehler für ${username}:`, err);
      ldapStatus = { active: false, error: 'Verbindungsfehler: ' + err.message };
    }

    if (ldapStatus && !ldapStatus.error && !ldapStatus.active) {
      db.prepare('UPDATE users SET is_active = 0, auth_version = auth_version + 1 WHERE id = ?').run(dbUser.id);
      db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(dbUser.id);
      revokePersistentGrant(username);
      return res.json({
        active: false,
        valid: false,
        account_deleted: true,
        reason_code: 'ACCOUNT_INACTIVE',
        status_summary: 'Konto im LDAP deaktiviert oder gelöscht.',
        card_status: 'Ausweis gesperrt',
        is_buffered: false,
        is_technik_scout: false
      });
    }

    // 4. Schülerprofil laden
    let profile = null;
    try {
      profile = await studentDb.getStudentProfile(dbUser, { isCardPath: true });
    } catch (e) {
      console.error('[Express /status-check] Fehler beim Abrufen des Schülerprofils:', e);
    }

    // 5. Zentrale Gültigkeits- & Pufferbewertung
    const eligibility = evaluateCardEligibility({
      user: dbUser,
      profile: profile,
      ldapStatus: ldapStatus,
      now: now
    });

    return res.json({
      active: eligibility.valid,
      valid: eligibility.valid,
      reason_code: eligibility.reasonCode,
      status_summary: eligibility.statusSummary,
      card_status: eligibility.rawStatus,
      is_technik_scout: Boolean(eligibility.valid && dbUser && dbUser.is_technik_scout === 1),
      expires_at: eligibility.expiresAt,
      offline_valid_until: eligibility.offlineValidUntil,
      is_buffered: eligibility.is_buffered,
      card_version: eligibility.cardVersion
    });
  } catch (err) {
    console.error('[Express /status-check] Fehler:', err);
    return res.json({
      active: false,
      valid: false,
      error: err.message,
      reason_code: 'INTERNAL_ERROR',
      is_buffered: false
    });
  }
});

/**
 * Öffentlicher Endpunkt zur Online-Verifizierung eines Schülerausweis-QR-Codes.
 * 
 * DATENSCHUTZ- UND SICHERHEITSREGELN (FEHLER 1, 4, 5):
 * - Verlangt zwingend b/bib (Mediotheksnummer aus Feld 145) UND n/name (vollständiger Name).
 * - Keine Auswertung von Antrags-IDs oder internen Datenbank-IDs.
 * - Lädt minimalste Daten ohne Passbild-Blob und ohne vertrauliche Stammdaten.
 * - Führt eine LDAP-Prüfung des Inhabers durch.
 * - Liefert nach außen bei JEDEM Fehler eine neutrale, einheitliche Antwort ohne Rückschlüsse auf die Existenz von Nummern.
 */
router.get('/verify-check', async (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0';

  if (!checkVerifyRateLimit(clientIp)) {
    return res.status(429).json({
      verified: false,
      status: 'Ungültig',
      message: 'Zu viele Verifizierungsanfragen. Bitte warten Sie einen Moment.'
    });
  }

  const name = String(req.query.n || req.query.name || '').trim();
  const bib = String(req.query.b || req.query.bib || '').trim();

  // Name UND Bibliotheksnummer/Mediotheksnummer müssen zwingend vorliegen
  if (!name || !bib) {
    return res.status(400).json({ 
      verified: false, 
      status: 'Ungültig',
      message: 'Name und Bibliotheksnummer sind zwingend erforderlich.' 
    });
  }

  try {
    // 1. Gezielter, datensparsamer Finder (Feld 145 + Name)
    const match = await studentDb.findStudentForVerification(bib, name);

    if (!match) {
      return res.json({ 
        verified: false, 
        status: 'Ungültig',
        message: 'Schülerausweis konnte nicht verifiziert werden.' 
      });
    }

    // 2. LDAP-Live-Prüfung für den gefundenen Inhaber
    let ldapStatus = null;
    if (match.username) {
      try {
        ldapStatus = await ldap.isUserActiveInLdap(match.username);
      } catch (err) {
        console.error('[Express /verify-check] LDAP-Fehler:', err.message);
        ldapStatus = { active: false, error: 'Verbindungsfehler: ' + err.message };
      }
    } else {
      ldapStatus = { active: false, error: 'Kein LDAP-Benutzername zugeordnet.' };
    }

    // 3. Zentrale Gültigkeitsprüfung
    const verifyUser = { id: match.userId || null, username: match.username, is_active: 1 };
    const minimalProfile = {
      username: match.username,
      first_name: match.first_name,
      last_name: match.last_name,
      mediothek_number: match.mediothek_number,
      card_status: match.card_status,
      card_status_code: match.card_status_code,
      card_image: match.has_photo ? 'data:image/jpeg;base64,PHOTO_EXISTS' : null
    };

    const eligibility = evaluateCardEligibility({
      user: verifyUser,
      profile: minimalProfile,
      ldapStatus: ldapStatus,
      now: new Date()
    });

    if (!eligibility.valid) {
      return res.json({
        verified: false,
        status: 'Ungültig',
        message: 'Schülerausweis konnte nicht verifiziert werden.'
      });
    }

    const sanitizedFullName = `${match.first_name || ''} ${match.last_name || ''}`.trim();

    return res.json({
      verified: true,
      status: eligibility.is_buffered ? 'Gültig (Puffer)' : 'Gültig',
      is_buffered: Boolean(eligibility.is_buffered),
      name: sanitizedFullName,
      expires_at: eligibility.expiresAt,
      message: eligibility.is_buffered
        ? 'Ausweis verifiziert (Offline-Puffer / LDAP temporär nicht erreichbar).'
        : 'Ausweis erfolgreich verifiziert.'
    });

  } catch (error) {
    console.error('Fehler bei /verify-check:', error);
    return res.json({ 
      verified: false, 
      status: 'Ungültig',
      message: 'Schülerausweis konnte nicht verifiziert werden.' 
    });
  }
});

module.exports = router;
