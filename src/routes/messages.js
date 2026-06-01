const express = require('express');
const router = express.Router();
const { db } = require('../db');

/**
 * Ruft alle aktuell aktiven Nachrichten für den Benutzer ab.
 * Bereits bestätigte Nachrichten werden für angemeldete Benutzer direkt serverseitig ausgefiltert.
 */
router.get('/', (req, res) => {
  try {
    const user = req.session.user;
    
    // Alle Nachrichten aus der Datenbank holen
    const allMessages = db.prepare('SELECT * FROM news_messages ORDER BY created_at DESC').all();
    
    // Aktuellen Zeitpunkt ermitteln (als ISO-String oder Date-Objekt)
    const now = new Date();
    
    // Filtern der aktiven Nachrichten
    const activeMessages = allMessages.filter(msg => {
      // 1. Zeitgesteuerte Nachricht (temporary) prüfen
      if (msg.type === 'temporary') {
        const start = msg.start_date ? new Date(msg.start_date) : null;
        const end = msg.end_date ? new Date(msg.end_date) : null;
        
        if (start && now < start) return false;
        if (end && now > end) return false;
      }
      
      // 2. Bestätigungsnachricht (until_confirmation) für angemeldete Nutzer serverseitig prüfen
      if (msg.type === 'until_confirmation' && user) {
        const confirmed = db.prepare(`
          SELECT 1 FROM user_message_confirmations 
          WHERE user_id = ? AND message_id = ?
        `).get(user.id, msg.id);
        
        if (confirmed) {
          return false; // Nachricht wurde bereits vom Benutzer bestätigt -> ausblenden
        }
      }
      
      return true;
    });
    
    res.json(activeMessages);
  } catch (error) {
    console.error('Fehler beim Abrufen der Nachrichten:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Nachrichten: ' + error.message });
  }
});

/**
 * Bestätigt eine Nachricht, sodass sie dem Nutzer zukünftig nicht mehr angezeigt wird.
 */
router.post('/:id/confirm', (req, res) => {
  const messageId = parseInt(req.params.id, 10);
  const user = req.session.user;
  
  if (isNaN(messageId)) {
    return res.status(400).json({ error: 'Ungültige Nachrichten-ID.' });
  }
  
  try {
    if (user) {
      // Für angemeldete Nutzer in der Datenbank persistieren
      db.prepare(`
        INSERT OR IGNORE INTO user_message_confirmations (user_id, message_id)
        VALUES (?, ?)
      `).run(user.id, messageId);
      
      res.json({ success: true, logged_in: true });
    } else {
      // Für Gäste dem Frontend signalisieren, dass es im localStorage gesichert werden soll
      res.json({ success: true, logged_in: false, guest: true });
    }
  } catch (error) {
    console.error('Fehler beim Bestätigen der Nachricht:', error);
    res.status(500).json({ error: 'Fehler beim Bestätigen der Nachricht: ' + error.message });
  }
});

module.exports = router;
