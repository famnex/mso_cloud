const express = require('express');
const router = express.Router();
const { db, getConfig, logEvent } = require('../db');
const studentDb = require('../student_db');
const ldap = require('../ldap');
const { evaluateCardEligibility } = require('../services/cardEligibility');

/**
 * Holt die Ausweis-Daten des aktuell eingeloggten Schülers und protokolliert den Zugriff.
 */
router.get('/card', async (req, res) => {
  const user = req.session.user;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0';

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  // 1. Prüfen, ob der Benutzer noch in der lokalen Datenbank existiert und aktiv ist
  const dbUser = db.prepare('SELECT id, username, email, display_name, role, is_ldap, is_active, auth_version FROM users WHERE id = ?').get(user.id);
  if (!dbUser || dbUser.is_active === 0) {
    console.log(`[Express /card] Lokales Konto für Benutzer ${user.username} ist inaktiv oder existiert nicht mehr.`);
    req.session.destroy(() => {});
    db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(user.id);
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

  // 2. LDAP-Live-Prüfung oder periodische tägliche Prüfung (für LDAP-Konten)
  const liveCheckEnabled = getConfig('ldap_live_check_enabled', '0') === '1';
  const ldapEnabled = getConfig('ldap_enabled', '0') === '1';

  const now = new Date();
  const lastCheck = user.lastLdapCheck || 0;
  const checkInterval = 24 * 60 * 60 * 1000; // 24 Stunden in ms
  const periodicCheckNeeded = ldapEnabled && (now.getTime() - lastCheck > checkInterval);

  if ((dbUser.is_ldap === 1 || user.isLdap === true) && (liveCheckEnabled || periodicCheckNeeded)) {
    let ldapStatus = { active: true, error: null };
    try {
      ldapStatus = await ldap.isUserActiveInLdap(user.username);
    } catch (err) {
      console.error(`[Express /card] Kritischer Fehler bei LDAP-Live-Prüfung für ${user.username}:`, err);
      ldapStatus = { active: true, error: 'Routenfehler: ' + err.message };
    }

    if (ldapStatus.error) {
      console.warn(`[Express /card] LDAP-Live-Prüfung fehlgeschlagen: ${ldapStatus.error}. Verwende Fallback.`);
      if (typeof logEvent === 'function') {
        logEvent('error', 'ldap_live_check_failed', `LDAP-Verbindung fehlgeschlagen bei Ausweis-Prüfung für Benutzer ${user.username}: ${ldapStatus.error}`, { userId: user.id }, clientIp);
      }
      req.session.user.lastLdapCheck = now.getTime() - (23 * 60 * 60 * 1000); 
    } else if (!ldapStatus.active) {
      console.log(`[Express /card] Kicke Benutzer ${user.username} aus Session da inaktives/gelöschtes LDAP-Konto.`);
      req.session.destroy(() => {});
      db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(user.id);
      if (typeof logEvent === 'function') {
        logEvent('warn', 'student_card_account_deleted', `Schülerausweis-Abruf verweigert: Konto für User ${user.username} ist im LDAP deaktiviert oder gelöscht`, { userId: user.id }, clientIp);
      }
      return res.status(401).json({ error: 'Konto existiert nicht mehr oder wurde im LDAP/System deaktiviert.', account_deleted: true });
    } else {
      req.session.user.lastLdapCheck = now.getTime();
    }
  }

  try {
    let profile = await studentDb.getStudentProfile(user);
    const disableCheck = getConfig('disable_student_check', '0') === '1';
    let isAdminPreview = false;

    if (!profile) {
      if (disableCheck || user.role === 'admin') {
        isAdminPreview = true;
        const nameParts = (user.display_name || user.username).split(' ');
        const dummySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="147" height="196" viewBox="0 0 147 196"><rect width="147" height="196" fill="#1e293b"/><path d="M73.5 98c15.46 0 28-12.54 28-28s-12.54-28-28-28-28 12.54-28 28 12.54 28 28 28zm0 14c-18.67 0-56 9.36-56 28v14h112v-14c0-18.64-37.33-28-56-28z" fill="#38bdf8"/><text x="73.5" y="170" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="sans-serif" font-weight="bold">ADMIN VORSCHAU</text></svg>`;
        const dummyPassphotoBase64 = 'data:image/svg+xml;base64,' + Buffer.from(dummySvg).toString('base64');

        profile = {
          first_name: user.role === 'admin' ? 'Max (Vorschau)' : (nameParts[0] || user.username),
          last_name: user.role === 'admin' ? 'Mustermann' : (nameParts.slice(1).join(' ') || 'Test-Account'),
          birth_date: '2008-05-15',
          birth_place: 'Bad Hersfeld',
          mediothek_number: '123456789',
          card_image: dummyPassphotoBase64,
          card_status: 'Bild verifiziert'
        };
      } else {
        if (typeof logEvent === 'function') {
          logEvent('warn', 'student_card_not_found', `Schülerausweis-Abruf fehlgeschlagen: Kein Schülerprofil für User ${user.username}`, { userId: user.id }, clientIp);
        }
        return res.status(404).json({ error: 'Kein Schülerprofil vorhanden.' });
      }
    } else {
      // Profil in lokaler SQLite synchronisieren, damit es offline geladen werden kann
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
          card_image = COALESCE(excluded.card_image, card_image)
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

    // Zentrale Gültigkeits- & Statusauswertung
    const eligibility = evaluateCardEligibility(dbUser, profile, now);
    let statusSummary = eligibility.statusSummary;
    let logLevel = eligibility.valid ? 'info' : 'warn';

    if (isAdminPreview) {
      statusSummary += ' [Admin-Vorschau]';
    }

    // Abruf-Quelle ermitteln (PWA App, Service Worker oder Web-Browser)
    const reqSource = req.query.source || req.headers['x-pwa-source'] || req.headers['x-pwa-request'];
    let sourceLabel = 'Web-Browser';
    if (reqSource === 'pwa' || reqSource === 'standalone') {
      sourceLabel = 'PWA App (Homescreen)';
    } else if (reqSource === 'sw' || reqSource === 'service-worker') {
      sourceLabel = 'PWA Service Worker';
    } else if (reqSource) {
      sourceLabel = `PWA (${reqSource})`;
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
      expires_at: eligibility.expiresAt,
      offline_valid_until: eligibility.offlineValidUntil,
      valid: eligibility.valid,
      reason_code: eligibility.reasonCode,
      status_summary: statusSummary,
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
 * Liefert das konfigurierte PWA App-Icon (oder ein Standardbild als Fallback) aus.
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
 * Prüft anonym, ob ein Benutzername im System und im LDAP noch aktiv ist.
 * Wird von PWAs ohne aktive Session verwendet, um zu prüfen, ob der Ausweis gesperrt werden muss.
 */
router.get('/status-check', async (req, res) => {
  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ error: 'Username ist erforderlich.' });
  }

  try {
    // 1. Prüfen, ob der Benutzer in der lokalen DB existiert und aktiv ist
    const dbUser = db.prepare('SELECT id, username, email, display_name, role, is_active, auth_version FROM users WHERE username = ?').get(username);
    if (!dbUser || dbUser.is_active === 0) {
      return res.json({ active: false, account_deleted: true, reason: 'Konto deaktiviert oder gelöscht.' });
    }

    // 2. Prüfen, ob der Benutzer im LDAP aktiv ist
    const ldapStatus = await ldap.isUserActiveInLdap(username);
    if (ldapStatus && !ldapStatus.error && !ldapStatus.active) {
      db.prepare('UPDATE users SET is_active = 0, auth_version = auth_version + 1 WHERE id = ?').run(dbUser.id);
      db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(dbUser.id);
      return res.json({ active: false, account_deleted: true, reason: 'Konto im LDAP deaktiviert oder gelöscht.' });
    }

    // 3. Schülerprofil in Schulanmeldungs-Datenbank (MySQL / SQLite) abfragen
    let profile = null;
    try {
      profile = await studentDb.getStudentProfile(dbUser);
    } catch (e) {
      console.error('[Express /status-check] Fehler beim Abrufen des Schülerprofils:', e);
    }

    const disableCheck = getConfig('disable_student_check', '0') === '1';
    if (!profile && (disableCheck || dbUser.role === 'admin')) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const expiresAt = `${(now >= new Date(currentYear, 7, 1) ? currentYear + 1 : currentYear)}-07-31`;
      return res.json({ 
        active: true, 
        valid: true,
        reason_code: 'VALID',
        status_summary: 'Gültig [Admin-Vorschau]',
        card_status: 'Bild verifiziert', 
        expires_at: expiresAt 
      });
    }

    const eligibility = evaluateCardEligibility(dbUser, profile);

    return res.json({
      active: eligibility.valid,
      valid: eligibility.valid,
      reason_code: eligibility.reasonCode,
      status_summary: eligibility.statusSummary,
      card_status: eligibility.rawStatus,
      expires_at: eligibility.expiresAt,
      offline_valid_until: eligibility.offlineValidUntil
    });
  } catch (err) {
    console.error('[Express /status-check] Fehler:', err);
    return res.json({ active: false, error: err.message });
  }
});

/**
 * Öffentlicher Endpunkt zur Online-Verifizierung eines Schülerausweis-QR-Codes.
 * Prüft in der Datenbank (student_profiles / Schulanmeldung MySQL), ob der Name
 * und die Bibliotheksnummer (bib) bzw. Kennung exakt übereinstimmen und das Profil gültig ist.
 */
router.get('/verify-check', async (req, res) => {
  const name = String(req.query.n || req.query.name || '').trim();
  const bib = String(req.query.b || req.query.bib || '').trim();
  const id = String(req.query.id || '').trim();

  if (!name || (!bib && !id)) {
    return res.status(400).json({ 
      verified: false, 
      reasonCode: 'MISSING_PARAMS',
      reason: 'Name und Bibliotheksnummer / Schülernummer sind erforderlich.' 
    });
  }

  try {
    // 1. Suche nach Schülerprofil über den O(1)-gezielten Index-Finder
    const match = await studentDb.findStudentByVerificationReference(bib, id, name);

    if (!match || !match.profile) {
      return res.json({ 
        verified: false, 
        reasonCode: 'PROFILE_NOT_FOUND',
        reason: 'Kein übereinstimmender Datensatz in der Schulanmeldungs-Datenbank gefunden.' 
      });
    }

    const matchingUser = match.user;
    const matchingProfile = match.profile;

    // 2. Strenger Namensabgleich (Vorname + Nachname case-insensitive & Umlaute-tolerant)
    const normalize = (str) => String(str || '').trim().toLowerCase()
      .normalize('NFC')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/\s+/g, ' ');

    const normQueryName = normalize(name);
    const normFirst = normalize(matchingProfile.first_name);
    const normLast = normalize(matchingProfile.last_name);
    const normFullName1 = `${normFirst} ${normLast}`.trim();
    const normFullName2 = `${normLast} ${normFirst}`.trim();

    const nameMatches = normQueryName === normFullName1 || normQueryName === normFullName2;

    if (!nameMatches) {
      return res.json({ 
        verified: false, 
        reasonCode: 'NAME_MISMATCH',
        reason: 'Der angegebene Name stimmt nicht mit dem in der Datenbank hinterlegten Inhaber überein.' 
      });
    }

    // 3. Zentrale Gültigkeitsauswertung
    const eligibility = evaluateCardEligibility(matchingUser, matchingProfile);

    if (!eligibility.valid) {
      return res.json({
        verified: false,
        reasonCode: eligibility.reasonCode,
        status: eligibility.statusSummary,
        reason: `Ausweisprüfung nicht erfolgreich: ${eligibility.statusSummary}`
      });
    }

    const fullName = `${matchingProfile.first_name || ''} ${matchingProfile.last_name || ''}`.trim();

    return res.json({
      verified: true,
      reasonCode: 'VALID',
      name: fullName,
      status: 'Gültig',
      expires_at: eligibility.expiresAt,
      message: 'Ausweis erfolgreich in der Schul-Datenbank verifiziert.'
    });

  } catch (error) {
    console.error('Fehler bei /verify-check:', error);
    return res.status(500).json({ 
      verified: false, 
      reasonCode: 'INTERNAL_ERROR',
      reason: 'Interner Serverfehler bei der Verifizierung.' 
    });
  }
});

module.exports = router;
