const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, getConfig, setConfig, runMigrations } = require('../db');

/**
 * Gibt den aktuellen Installations-Status zurück.
 */
router.get('/status', (req, res) => {
  try {
    const setupCompleted = getConfig('setup_completed') === '1';
    res.json({ setup_completed: setupCompleted });
  } catch (error) {
    res.json({ setup_completed: false, error: error.message });
  }
});

/**
 * Führt die Erstinstallation aus. Richtet den Admin-User und Standardwerte ein.
 */
router.post('/run', (req, res) => {
  try {
    const setupCompleted = getConfig('setup_completed') === '1';
    if (setupCompleted) {
      return res.status(400).json({ error: 'System ist bereits eingerichtet.' });
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Alle Felder (Username, E-Mail, Passwort) sind erforderlich.' });
    }

    // 1. Datenbankmigrationen nochmals zur Sicherheit anstoßen
    runMigrations();

    // 2. Admin-User erstellen
    const hash = bcrypt.hashSync(password, 10);
    
    // Prüfen, ob der User bereits existiert (sollte bei Erstinstallation leer sein)
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
      return res.status(400).json({ error: 'Ein Benutzer mit diesem Namen oder E-Mail existiert bereits.' });
    }

    // Admin einfügen
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role, groups, is_ldap)
      VALUES (?, ?, ?, 'admin', '["Admin"]', 0)
    `).run(username, email, hash);

    // 3. Konfigurationswerte initialisieren
    setConfig('setup_completed', '1');
    setConfig('ldap_enabled', '0');
    setConfig('smtp_from', 'no-reply@mso-hef.de');

    // 4. Ein paar Beispielkacheln anlegen, damit das System nicht leer ist!
    db.prepare('DELETE FROM tiles').run(); // Altes löschen
    db.prepare(`
      INSERT INTO tiles (title, description, icon, link, visibility, allowed_groups, sort_order)
      VALUES 
      ('Moodle', 'Das LMS der Modellschule Obersberg', 'fa-graduation-cap', 'https://cloud.mso-hef.de/moodle/login/index.php', 'public', '[]', 1),
      ('Wissensdatenbank', 'Alles Wissenswerte zu unseren Diensten.', 'fa-brain', 'https://cloud.mso-hef.de/osticket23/kb/index.php', 'public', '[]', 2),
      ('Schulkalender', 'Termine der Schule', 'fa-calendar', 'https://cloud.mso-hef.de/kalender_new', 'logged_in', '[]', 3),
      ('Ticketsystem', 'Support-Anfragen für Hard- & Software', 'fa-ticket', 'https://cloud.mso-hef.de/osticket23', 'groups', '["Lehrer", "Admin"]', 4)
    `).run();

    res.json({ success: true, message: 'Installation erfolgreich abgeschlossen.' });
  } catch (error) {
    console.error('Fehler bei der Erstinstallation:', error);
    res.status(500).json({ error: 'Installationsfehler: ' + error.message });
  }
});

module.exports = router;
