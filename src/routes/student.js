const express = require('express');
const router = express.Router();
const { db, getConfig } = require('../db');

/**
 * Holt die Ausweis-Daten des aktuell eingeloggten Schülers.
 */
router.get('/card', (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    let profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
    const disableCheck = getConfig('disable_student_check') === '1';

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
    }

    // Ablaufdatum bestimmen (31. Juli des laufenden Schuljahres)
    const now = new Date();
    const currentYear = now.getFullYear();
    let expirationYear = currentYear;
    if (now.getMonth() >= 7) { // Ab August gilt es bis zum nächsten Jahr
      expirationYear = currentYear + 1;
    }
    const expiresAt = `${expirationYear}-07-31`;

    res.json({
      first_name: profile.first_name,
      last_name: profile.last_name,
      birth_date: profile.birth_date,
      birth_place: profile.birth_place,
      mediothek_number: profile.mediothek_number,
      card_image: profile.card_image,
      card_status: profile.card_status,
      expires_at: expiresAt,
      server_time: new Date().toISOString()
    });
  } catch (err) {
    console.error('Fehler beim Laden des Schülerausweises:', err);
    res.status(500).json({ error: 'Fehler beim Laden des Profils: ' + err.message });
  }
});

module.exports = router;
