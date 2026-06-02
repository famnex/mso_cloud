const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../db');

/**
 * Prüft, ob eine Kachel aktuell zeitlich gesperrt ist.
 * Unterstützt auch Spannen über Mitternacht hinweg (z. B. 22:00 bis 06:00 Uhr).
 */
function isTileTimeLocked(tile) {
  if (tile.time_limit_enabled !== 1) return false;
  
  // Aktuelle Serverzeit im Format "HH:MM" holen
  const now = new Date().toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const start = tile.time_limit_start || '08:00';
  const end = tile.time_limit_end || '16:00';
  
  if (start <= end) {
    // Normaler Bereich am selben Tag (z.B. 08:00 bis 16:00)
    return now < start || now > end;
  } else {
    // Bereich überspannt Mitternacht (z.B. 22:00 bis 06:00)
    return now < start && now > end;
  }
}

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
      
      // 2. Nur öffentlich (nur für unangemeldete Benutzer)
      if (tile.visibility === 'only_public') {
        return !user;
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

    // Zeitsperren-Flag dynamisch anfügen
    const mappedTiles = visibleTiles.map(tile => {
      const locked = isTileTimeLocked(tile);
      return {
        ...tile,
        is_time_locked: locked ? 1 : 0
      };
    });

    res.json(mappedTiles);
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
    } else if (tile.visibility === 'only_public') {
      hasAccess = !user || (user && user.role === 'admin');
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

    // Zeitsperre auf Server-Ebene erzwingen (Admins können sie zum Testen umgehen!)
    const isLocked = isTileTimeLocked(tile);
    if (isLocked && (!user || user.role !== 'admin')) {
      return res.status(403).send(`Zugriff verweigert. Dieser Dienst ist momentan zeitlich gesperrt. Er ist nur von ${tile.time_limit_start} bis ${tile.time_limit_end} Uhr aktiv.`);
    }

    // SSO Logik anwenden
    let redirectUrl = tile.link;

    // SPH-Autologin prüfen: Falls der Link zum SPH führt und der User Zugangsdaten hinterlegt hat, Auto-POST senden
    if (tile.link && tile.link.includes('login.schulportal.hessen.de') && user) {
      try {
        const sphCreds = db.prepare('SELECT * FROM user_sph_credentials WHERE user_id = ?').get(user.id);
        if (sphCreds) {
          const authRouter = require('./auth');
          const decryptedPassword = authRouter.decrypt(sphCreds.sph_password);
          
          if (decryptedPassword) {
            let sphUsername = sphCreds.sph_username.trim();
            let userVal, user2Val;
            if (sphUsername.includes('.')) {
              userVal = sphUsername;
              user2Val = sphUsername.split('.').slice(1).join('.');
            } else {
              user2Val = sphUsername;
              userVal = `9743.${sphUsername}`;
            }

            const timezoneOffset = -new Date().getTimezoneOffset() / 60;

            return res.send(`
              <!DOCTYPE html>
              <html lang="de">
              <head>
                <meta charset="UTF-8">
                <title>Weiterleitung zum Schulportal Hessen...</title>
                <style>
                  body { font-family: sans-serif; background: #121212; color: #e0e0e0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                  .loader { border: 4px solid rgba(255,255,255,0.1); border-radius: 50%; border-top: 4px solid #3b82f6; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
                  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                  p { color: #a3a3a3; font-size: 1.1rem; }
                </style>
              </head>
              <body>
                <div class="loader"></div>
                <p>Melde dich automatisch beim Schulportal Hessen an...</p>
                
                <form id="sph-login-form" method="POST" action="https://login.schulportal.hessen.de/?url=aHR0cHM6Ly9jb25uZWN0LnNjaHVscG9ydGFsLmhlc3Nlbi5kZS8=&skin=sp&i=9743">
                  <input type="hidden" name="url" value="aHR0cHM6Ly9jb25uZWN0LnNjaHVscG9ydGFsLmhlc3Nlbi5kZS8=">
                  <input type="hidden" name="timezone" value="${timezoneOffset}">
                  <input type="hidden" name="skin" value="sp">
                  <input type="hidden" name="user2" value="${escapeHtml(user2Val)}">
                  <input type="hidden" name="user" value="${escapeHtml(userVal)}">
                  <input type="hidden" name="password" value="${escapeHtml(decryptedPassword)}">
                </form>

                <script>
                  document.getElementById('sph-login-form').submit();
                </script>
              </body>
              </html>
            `);
          }
        }
      } catch (err) {
        console.error('Fehler bei der Vorbereitung des SPH-Autologins:', err);
      }
    }

    // Booking-Autologin prüfen: Falls der Link zum Buchungssystem führt und der User Zugangsdaten hinterlegt hat, Auto-POST senden
    if (tile.link && tile.link.toLowerCase().includes('/booking/') && user) {
      try {
        const bookingCreds = db.prepare('SELECT * FROM user_booking_credentials WHERE user_id = ?').get(user.id);
        if (bookingCreds) {
          const authRouter = require('./auth');
          const decryptedPassword = authRouter.decrypt(bookingCreds.booking_password);
          
          if (decryptedPassword) {
            return res.send(`
              <!DOCTYPE html>
              <html lang="de">
              <head>
                <meta charset="UTF-8">
                <title>Weiterleitung zum Buchungssystem...</title>
                <style>
                  body { font-family: sans-serif; background: #070e17; color: #f3f5f9; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                  .loader { border: 4px solid rgba(255,255,255,0.05); border-radius: 50%; border-top: 4px solid #2e8bfa; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
                  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                  p { color: #90a0b5; font-size: 1.1rem; }
                </style>
              </head>
              <body>
                <div class="loader"></div>
                <p>Melde dich automatisch beim Buchungssystem an...</p>
                
                <form id="booking-login-form" method="POST" action="https://cloud.mso-hef.de/launcher/booking/index.php/login/submit">
                  <input type="hidden" name="page" value="login">
                  <input type="hidden" name="username" value="${escapeHtml(bookingCreds.booking_username)}">
                  <input type="hidden" name="password" value="${escapeHtml(decryptedPassword)}">
                </form>

                <script>
                  document.getElementById('booking-login-form').submit();
                </script>
              </body>
              </html>
            `);
          }
        }
      } catch (err) {
        console.error('Fehler bei der Vorbereitung des Booking-Autologins:', err);
      }
    }

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

    // Dynamic Microsoft 365 / Outlook login_hint resolution
    if (user && redirectUrl) {
      const isOutlook = redirectUrl.toLowerCase().includes('outlook.office') || 
                        redirectUrl.toLowerCase().includes('outlook.com') ||
                        redirectUrl.toLowerCase().includes('outlook.office365.com');
                        
      const isM365 = !isOutlook && (
                       redirectUrl.toLowerCase().includes('portal.office.com') || 
                       redirectUrl.toLowerCase().includes('login.microsoftonline.com') ||
                       redirectUrl.toLowerCase().includes('office.com')
                     );

      if (isOutlook) {
        // Outlook: Only append hint if the user's email ends with @mso-hef.de
        if (user.email && user.email.toLowerCase().endsWith('@mso-hef.de')) {
          const separator = redirectUrl.includes('?') ? '&' : '?';
          redirectUrl = `${redirectUrl}${separator}login_hint=${encodeURIComponent(user.email)}`;
        }
      } else if (isM365) {
        // Microsoft 365:
        // 1. Teachers (email ends with @mso-hef.de): Use their email address
        // 2. Students (all others): Use [Email-Präfix vor @]@msohef.onmicrosoft.com (falls E-Mail vorhanden), sonst Benutzername
        let hint = '';
        if (user.email && user.email.toLowerCase().endsWith('@mso-hef.de')) {
          hint = user.email;
        } else {
          const usernamePart = (user.email && user.email.includes('@')) ? user.email.split('@')[0] : user.username;
          hint = `${usernamePart}@msohef.onmicrosoft.com`;
        }
        
        if (hint) {
          const separator = redirectUrl.includes('?') ? '&' : '?';
          redirectUrl = `${redirectUrl}${separator}login_hint=${encodeURIComponent(hint)}`;
        }
      }
    }

    // Redirect ausführen
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Fehler im SSO-Redirect:', error);
    res.status(500).send('Fehler bei der SSO-Weiterleitung: ' + error.message);
  }
});

// Hilfsfunktion zum Escapen von HTML-Zeichen
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = router;
