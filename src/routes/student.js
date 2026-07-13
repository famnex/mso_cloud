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
      if (disableCheck) {
        // Dummy-Profil für Testzwecke erzeugen
        const nameParts = (user.display_name || user.username).split(' ');
        profile = {
          first_name: nameParts[0] || user.username,
          last_name: nameParts.slice(1).join(' ') || 'Test-Account',
          birth_date: '1980-01-01',
          birth_place: 'Musterstadt',
          mediothek_number: '999999',
          card_image: null,
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
      card_pwa_logging: getConfig('card_pwa_logging', '0')
    });
  } catch (err) {
    console.error('Fehler beim Laden des Schülerausweises:', err);
    res.status(500).json({ error: 'Fehler beim Laden des Profils: ' + err.message });
  }
});

module.exports = router;
