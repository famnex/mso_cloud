const express = require('express');
const router = express.Router();
const { db, getConfig, logEvent } = require('../db');
const studentDb = require('../student_db');
const ldap = require('../ldap');

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
  const dbUser = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(user.id);
  if (!dbUser || dbUser.is_active === 0) {
    console.log(`[Express /card] Lokales Konto für Benutzer ${user.username} ist inaktiv oder existiert nicht mehr.`);
    req.session.destroy();
    db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(user.id);
    if (typeof logEvent === 'function') {
      logEvent('warn', 'student_card_account_deleted', `Schülerausweis-Abruf verweigert: Konto für User ${user.username} existiert nicht mehr oder wurde deaktiviert`, { userId: user.id }, clientIp);
    }
    return res.status(401).json({ error: 'Konto existiert nicht mehr oder wurde im System deaktiviert.', account_deleted: true });
  }

  // 2. LDAP-Live-Prüfung oder periodische tägliche Prüfung
  const liveCheckEnabled = getConfig('ldap_live_check_enabled', '0') === '1';
  const ldapEnabled = getConfig('ldap_enabled', '0') === '1';

  // Prüfen, ob das letzte LDAP-Check-Intervall (24h) abgelaufen ist
  const now = Date.now();
  const lastCheck = user.lastLdapCheck || 0;
  const checkInterval = 24 * 60 * 60 * 1000; // 24 Stunden in ms
  const periodicCheckNeeded = ldapEnabled && (now - lastCheck > checkInterval);

  if (liveCheckEnabled || periodicCheckNeeded) {
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
      // Bei Verbindungsfehlern nach 1 Stunde erneut versuchen statt 24 Stunden zu warten
      req.session.user.lastLdapCheck = now - (23 * 60 * 60 * 1000); 
    } else if (!ldapStatus.active) {
      console.log(`[Express /card] Kicke Benutzer ${user.username} aus Session da inaktives/gelöschtes LDAP-Konto.`);
      req.session.destroy();
      db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(user.id);
      if (typeof logEvent === 'function') {
        logEvent('warn', 'student_card_account_deleted', `Schülerausweis-Abruf verweigert: Konto für User ${user.username} ist im LDAP deaktiviert oder gelöscht`, { userId: user.id }, clientIp);
      }
      return res.status(401).json({ error: 'Konto existiert nicht mehr oder wurde im LDAP/System deaktiviert.', account_deleted: true });
    } else {
      // Erfolgreich geprüft und aktiv -> Zeitstempel in Session aktualisieren
      req.session.user.lastLdapCheck = now;
    }
  }

  try {
    let profile = await studentDb.getStudentProfile(user);
    const disableCheck = getConfig('disable_student_check', '0') === '1';
    let isAdminPreview = false;

    if (!profile) {
      if (disableCheck || user.role === 'admin') {
        isAdminPreview = true;
        // Dummy-Profil für Testzwecke / Admin-Vorschau erzeugen (Base64-kodiertes SVG für volle Canvas-Kompatibilität)
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

    // Ablaufdatum bestimmen: Endet immer am 31. Juli.
    // Ab dem 1. August gilt das nächste Schuljahr (31.07. des Folgejahres).
    const now = new Date();
    const currentYear = now.getFullYear();
    const augustFirst = new Date(currentYear, 7, 1); // Monat 7 = August (0-indexed)

    let expirationYear = currentYear;
    if (now >= augustFirst) {
      expirationYear = currentYear + 1;
    }
    const expiresAt = `${expirationYear}-07-31`;

    // Status- und Gültigkeitsauswertung
    const rawStatus = profile.card_status || 'Bild ungeprüft / Kein Bild';
    const statusCode = String(profile.card_status_code || '');
    const isRevoked = rawStatus === 'Ausweis gesperrt' || rawStatus === 'gesperrt' || rawStatus === 'Ungültig';
    const expiryDate = new Date(expirationYear, 6, 31, 23, 59, 59);
    const isExpired = now > expiryDate;
    const isVerified = rawStatus === 'Bild genehmigt' || 
                       rawStatus === 'genehmigt' || 
                       rawStatus === 'Bild verifiziert' ||
                       rawStatus === 'Bild akzeptiert' ||
                       rawStatus === 'Ausweis gedruckt' ||
                       rawStatus === 'Ausweis ausgegeben' ||
                       rawStatus === '1132' ||
                       rawStatus === '1133' ||
                       statusCode === '1132' ||
                       statusCode === '1133';
    const hasNoImage = !profile.card_image;

    let statusSummary = 'Gültig';
    let logLevel = 'info';

    if (isRevoked) {
      statusSummary = 'Ausweis gesperrt';
      logLevel = 'warn';
    } else if (isExpired) {
      statusSummary = `Abgelaufen (Gültig bis ${expiresAt})`;
      logLevel = 'warn';
    } else if (hasNoImage) {
      statusSummary = 'Kein Foto vorhanden';
      logLevel = 'warn';
    } else if (!isVerified) {
      statusSummary = `Foto ungeprüft (${rawStatus})`;
      logLevel = 'warn';
    }

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

    // Protokolleintrag schreiben
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
          card_status: rawStatus,
          expires_at: expiresAt,
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
      is_card_printed: (profile.card_status_code === '1133' || rawStatus === 'Ausweis gedruckt' || rawStatus === 'Ausweis ausgegeben'),
      expires_at: expiresAt,
      server_time: new Date().toISOString(),
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
    const dbUser = db.prepare('SELECT id, username, email, display_name, role, is_active FROM users WHERE username = ?').get(username);
    if (!dbUser || dbUser.is_active === 0) {
      return res.json({ active: false, account_deleted: true, reason: 'Konto deaktiviert oder gelöscht.' });
    }

    // 2. Prüfen, ob der Benutzer im LDAP aktiv ist
    const ldapStatus = await ldap.isUserActiveInLdap(username);
    if (ldapStatus.error) {
      // Bei LDAP-Server-Verbindungsfehlern erlauben wir Fallback (active: true)
      return res.json({ active: true, error: ldapStatus.error });
    }

    if (!ldapStatus.active) {
      // Konto im LDAP deaktiviert/gelöscht -> lokal deaktivieren
      db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(dbUser.id);
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

    // Admin-Vorschau oder Testbetrieb ohne Schülerprüfungs-Pflicht berücksichtigen
    const disableCheck = getConfig('disable_student_check', '0') === '1';
    if (!profile && (disableCheck || dbUser.role === 'admin')) {
      return res.json({ active: true, card_status: 'Bild verifiziert', expires_at: `${new Date().getFullYear() + 1}-07-31` });
    }

    if (!profile) {
      return res.json({ active: false, account_deleted: false, reason: 'Kein Schülerprofil in der Schulanmeldungs-Datenbank vorhanden.', card_status: 'Ausweis gesperrt' });
    }

    const rawStatus = profile.card_status || 'Bild ungeprüft / Kein Bild';
    const statusCode = String(profile.card_status_code || '');
    const hasImage = !!profile.card_image;

    const isVerified = rawStatus === 'Bild genehmigt' || 
                       rawStatus === 'genehmigt' || 
                       rawStatus === 'Bild verifiziert' ||
                       rawStatus === 'Bild akzeptiert' ||
                       rawStatus === 'Ausweis gedruckt' ||
                       rawStatus === 'Ausweis ausgegeben' ||
                       rawStatus === '1132' ||
                       rawStatus === '1133' ||
                       statusCode === '1132' ||
                       statusCode === '1133';

    const now = new Date();
    const currentYear = now.getFullYear();
    const augustFirst = new Date(currentYear, 7, 1);
    let expirationYear = currentYear;
    if (now >= augustFirst) {
      expirationYear = currentYear + 1;
    }
    const expiresAt = `${expirationYear}-07-31`;

    // Falls kein Bild vorhanden ist oder der Status abgelehnt/ungeprüft/gesperrt ist:
    if (!hasImage) {
      return res.json({ active: false, account_deleted: false, reason: 'Kein Passbild hinterlegt.', card_status: 'Kein Foto hinterlegt', expires_at: expiresAt });
    }

    if (!isVerified) {
      return res.json({ active: false, account_deleted: false, reason: `Ausweis-Status nicht verifiziert (${rawStatus}).`, card_status: rawStatus, expires_at: expiresAt });
    }

    return res.json({ active: true, card_status: rawStatus, expires_at: expiresAt });
  } catch (err) {
    console.error('[Express /status-check] Fehler:', err);
    return res.json({ active: true, error: err.message });
  }
});

/**
 * Öffentlicher Endpunkt zur Online-Verifizierung eines Schülerausweis-QR-Codes.
 * Prüft in der Datenbank (student_profiles / Schulanmeldung MySQL), ob der Name
 * und die Bibliotheksnummer (bib) exakt übereinstimmen und das Konto aktiv ist.
 */
router.get('/verify-check', async (req, res) => {
  const name = String(req.query.n || req.query.name || '').trim();
  const bib = String(req.query.b || req.query.bib || '').trim();
  const id = String(req.query.id || '').trim();

  if (!name || (!bib && !id)) {
    return res.status(400).json({ 
      verified: false, 
      reason: 'Name und Bibliotheksnummer / Schülernummer sind erforderlich.' 
    });
  }

  try {
    // 1. Suche nach Schülerprofil mit passender Bibliotheksnummer (bib) oder ID/Username
    let matchingUser = null;

    if (bib) {
      matchingUser = db.prepare(`
        SELECT u.id, u.username, u.is_active, sp.first_name, sp.last_name, sp.mediothek_number, sp.card_status
        FROM student_profiles sp
        JOIN users u ON sp.user_id = u.id
        WHERE sp.mediothek_number = ? AND u.is_active = 1
      `).get(bib);
    }

    if (!matchingUser && id) {
      const cleanUsername = id.replace(/^S-/, '');
      matchingUser = db.prepare(`
        SELECT u.id, u.username, u.is_active, sp.first_name, sp.last_name, sp.mediothek_number, sp.card_status
        FROM student_profiles sp
        JOIN users u ON sp.user_id = u.id
        WHERE (u.username = ? OR u.id = ? OR sp.id = ?) AND u.is_active = 1
      `).get(cleanUsername, cleanUsername, cleanUsername);
    }

    // Wenn MySQL / Schulanmeldung-DB konfiguriert ist, darüber prüfen
    if (!matchingUser && typeof studentDb.getStudentProfile === 'function') {
      const dbUsers = db.prepare('SELECT id, username, is_active FROM users WHERE is_active = 1').all();
      for (const u of dbUsers) {
        try {
          const prof = await studentDb.getStudentProfile(u);
          if (prof && prof.mediothek_number && prof.mediothek_number === bib) {
            matchingUser = {
              id: u.id,
              username: u.username,
              is_active: u.is_active,
              first_name: prof.first_name,
              last_name: prof.last_name,
              mediothek_number: prof.mediothek_number,
              card_status: prof.card_status
            };
            break;
          }
        } catch (e) {}
      }
    }

    if (!matchingUser) {
      return res.json({ 
        verified: false, 
        reason: 'Kein übereinstimmender Datensatz in der Schulanmeldungs-Datenbank gefunden.' 
      });
    }

    // 2. Namensabgleich (Vorname + Nachname case-insensitive & Umlaute-tolerant)
    const fullName = `${matchingUser.first_name || ''} ${matchingUser.last_name || ''}`.trim();
    
    const normalize = (str) => String(str || '').trim().toLowerCase()
      .normalize('NFC')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/\s+/g, ' ');

    const normQueryName = normalize(name);
    const normDbName = normalize(fullName);

    const nameMatches = normQueryName === normDbName || 
                        (normQueryName.includes(normalize(matchingUser.last_name)) && normQueryName.includes(normalize(matchingUser.first_name)));

    if (!nameMatches) {
      return res.json({ 
        verified: false, 
        reason: 'Der angegebene Name stimmt nicht mit dem in der Datenbank hinterlegten Inhaber überein.' 
      });
    }

    // 3. Statusabgleich
    const rawStatus = matchingUser.card_status || '';
    const isRevoked = rawStatus === 'Ausweis gesperrt' || rawStatus === 'gesperrt' || rawStatus === 'Ungültig';
    if (isRevoked) {
      return res.json({ 
        verified: false, 
        reason: 'Dieser Schülerausweis wurde serverseitig gesperrt.' 
      });
    }

    return res.json({
      verified: true,
      name: fullName,
      status: 'Gültig',
      message: 'Ausweis erfolgreich in der Schul-Datenbank verifiziert.'
    });

  } catch (error) {
    console.error('Fehler bei /verify-check:', error);
    return res.status(500).json({ verified: false, reason: 'Interner Serverfehler bei der Verifizierung.' });
  }
});

module.exports = router;
