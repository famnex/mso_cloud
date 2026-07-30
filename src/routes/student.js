const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db');
const studentDb = require('../student_db');

/**
 * Holt die Ausweis-Daten des aktuell eingeloggten Schülers.
 */
router.get('/card', async (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    let profile = await studentDb.getStudentProfile(user);
    const disableCheck = getConfig('disable_student_check', '0') === '1';

    if (!profile) {
      if (disableCheck || user.role === 'admin') {
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

    // Ablaufdatum bestimmen (Stichtag: 1. September)
    const now = new Date();
    const currentYear = now.getFullYear();
    const sepFirstCurrentYear = new Date(currentYear, 8, 1); // 8 = September (0-indexed)
    
    let expirationYear = currentYear;
    if (now >= sepFirstCurrentYear) {
      expirationYear = currentYear + 1;
    }
    const expiresAt = `${expirationYear}-09-01`;

    res.json({
      first_name: profile.first_name,
      last_name: profile.last_name,
      birth_date: profile.birth_date,
      birth_place: profile.birth_place,
      mediothek_number: profile.mediothek_number,
      card_image: profile.card_image,
      card_status: profile.card_status,
      expires_at: expiresAt,
      server_time: new Date().toISOString(),
      card_primary_color: getConfig('card_primary_color', '#3b82f6'),
      card_school_name: getConfig('card_school_name', 'Modellschule Obersberg'),
      card_principal_name: getConfig('card_principal_name', 'OStD Karsten Backhaus'),
      card_logo: getConfig('card_logo', ''),
      card_signature: getConfig('card_signature', ''),
      card_pwa_logging: getConfig('card_pwa_logging', '0'),
      card_pwa_icon: getConfig('card_pwa_icon', ''),
      card_seal: getConfig('card_seal', ''),
      platform_logo: getConfig('platform_logo', '')
    });
  } catch (err) {
    console.error('Fehler beim Laden des Schülerausweises:', err);
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

module.exports = router;
