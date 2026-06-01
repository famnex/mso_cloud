const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../db');

/**
 * Ruft alle für den aktuellen Benutzer sichtbaren Kacheln ab.
 */
router.get('/', (req, res) => {
  try {
    const user = req.session.user;
    
    // Alle Kacheln aus der Datenbank holen
    const allTiles = db.prepare('SELECT * FROM tiles ORDER BY sort_order ASC, title ASC').all();
    
    const visibleTiles = allTiles.filter(tile => {
      // 1. Öffentlich sichtbare Kacheln
      if (tile.visibility === 'public') {
        return true;
      }
      
      // Für alle anderen Sichtbarkeiten muss der User eingeloggt sein
      if (!user) {
        return false;
      }
      
      // Admin sieht grundsätzlich alles
      if (user.role === 'admin') {
        return true;
      }
      
      // 2. Sichtbarkeit für alle angemeldeten Benutzer
      if (tile.visibility === 'logged_in') {
        return true;
      }
      
      // 3. Sichtbarkeit eingeschränkt auf bestimmte Sicherheitsgruppen
      if (tile.visibility === 'groups') {
        const allowedGroups = JSON.parse(tile.allowed_groups || '[]');
        const userGroups = user.groups || [];
        
        // Prüfen, ob eine Überschneidung der Gruppen vorliegt (unterstützt raw DNs und CNs)
        const userGroupsCNs = userGroups.map(g => {
          const match = g.match(/cn=([^,]+)/i);
          return match ? match[1].trim() : g;
        });
        
        const hasAccess = allowedGroups.some(group => 
          userGroups.some(ug => ug.toLowerCase() === group.toLowerCase()) ||
          userGroupsCNs.some(ugCN => ugCN.toLowerCase() === group.toLowerCase())
        );
        return hasAccess;
      }
      
      return false;
    });

    res.json(visibleTiles);
  } catch (error) {
    console.error('Fehler beim Abrufen der Kacheln:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Dienste: ' + error.message });
  }
});

/**
 * SSO-Weiterleitungs-Endpunkt für Kacheln.
 * Prüft Berechtigung und signiert SSO-Tokens bei Bedarf.
 */
router.get('/sso/:id', (req, res) => {
  const tileId = req.params.id;
  const user = req.session.user;

  try {
    const tile = db.prepare('SELECT * FROM tiles WHERE id = ?').get(tileId);
    
    if (!tile) {
      return res.status(404).send('Dienst nicht gefunden.');
    }

    // Berechtigungsprüfung analog zum Kachelabruf
    let hasAccess = false;
    if (tile.visibility === 'public') {
      hasAccess = true;
    } else if (user) {
      if (user.role === 'admin' || tile.visibility === 'logged_in') {
        hasAccess = true;
      } else if (tile.visibility === 'groups') {
        const allowedGroups = JSON.parse(tile.allowed_groups || '[]');
        const userGroups = user.groups || [];
        
        const userGroupsCNs = userGroups.map(g => {
          const match = g.match(/cn=([^,]+)/i);
          return match ? match[1].trim() : g;
        });
        
        hasAccess = allowedGroups.some(group => 
          userGroups.some(ug => ug.toLowerCase() === group.toLowerCase()) ||
          userGroupsCNs.some(ugCN => ugCN.toLowerCase() === group.toLowerCase())
        );
      }
    }

    if (!hasAccess) {
      return res.status(403).send('Zugriff verweigert. Sie haben keine Berechtigung für diesen Dienst.');
    }

    // SSO Logik anwenden
    let redirectUrl = tile.link;

    if (tile.sso_type === 'query' && user) {
      // SSO Typ A: URL Query Parameter mit HMAC Signatur
      const secret = tile.sso_key || 'default_secret_key';
      const timestamp = Math.floor(Date.now() / 1000);
      const username = encodeURIComponent(user.username);
      const email = encodeURIComponent(user.email || '');
      
      const payloadString = `${user.username}:${user.email || ''}:${timestamp}`;
      const signature = crypto.createHmac('sha256', secret)
                              .update(payloadString)
                              .digest('hex');

      const separator = redirectUrl.includes('?') ? '&' : '?';
      redirectUrl = `${redirectUrl}${separator}sso_user=${username}&sso_email=${email}&sso_time=${timestamp}&sso_sig=${signature}`;

    } else if (tile.sso_type === 'jwt' && user) {
      // SSO Typ B: Signierter JSON Web Token (JWT)
      const secret = tile.sso_key || 'default_secret_key';
      
      const payload = {
        username: user.username,
        email: user.email || '',
        groups: user.groups || [],
        role: user.role,
        is_ldap: user.isLdap
      };

      // Signiere JWT mit dem Kachel-eigenen Schlüssel (1 Minute Gültigkeit gegen Replay-Attacks!)
      const token = jwt.sign(payload, secret, { expiresIn: '1m' });
      
      const separator = redirectUrl.includes('?') ? '&' : '?';
      redirectUrl = `${redirectUrl}${separator}sso_token=${token}`;
    }

    // Redirect ausführen
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Fehler im SSO-Redirect:', error);
    res.status(500).send('Fehler bei der SSO-Weiterleitung: ' + error.message);
  }
});

module.exports = router;
