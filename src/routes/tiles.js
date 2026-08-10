const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db, logEvent } = require('../db');
const ldap = require('../ldap');

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
 * ZENTRALER EVALUIERUNGS-ALGORITHMUS FÜR DIE KACHELSICHTBARKEIT.
 * Identischer Algorithmus für Live-Auslieferung und Admin-Diagnose.
 */
function evaluateTileVisibility(tile, user) {
  // 1. Öffentlich sichtbare Kacheln
  if (tile.visibility === 'public') {
    return {
      visible: true,
      reason: 'Öffentlich: Diese Kachel ist für alle Personen (angemeldet & unangemeldet) sichtbar.',
      code: 'PUBLIC'
    };
  }

  // 2. Nur öffentlich (nur für unangemeldete Benutzer)
  if (tile.visibility === 'only_public') {
    const isGuest = !user;
    return {
      visible: isGuest,
      reason: isGuest 
        ? 'Nur-Öffentlich: Benutzer ist unangemeldet (Gastmodus) -> Kachel ist sichtbar.' 
        : 'Nur-Öffentlich: Diese Kachel ist ausschließlich für unangemeldete Gäste sichtbar (Benutzer ist angemeldet -> ausgeblendet).',
      code: 'ONLY_PUBLIC'
    };
  }

  // Für alle weiteren Optionen muss ein Benutzerkontext vorliegen
  if (!user) {
    return {
      visible: false,
      reason: 'Anmeldung erforderlich: Benutzer ist unangemeldet.',
      code: 'LOGIN_REQUIRED'
    };
  }

  // Administrator sieht grundsätzlich alle Kacheln
  if (user.role === 'admin') {
    return {
      visible: true,
      reason: 'Admin-Sonderrecht: Benutzer hat die Rolle "admin" und sieht daher unabhängig von Gruppen alle Kacheln.',
      code: 'ADMIN_BYPASS'
    };
  }

  // 3. Sichtbarkeit für alle angemeldeten Benutzer
  if (tile.visibility === 'logged_in') {
    return {
      visible: true,
      reason: 'Angemeldet: Kachel ist für jeden angemeldeten Benutzer freigeschaltet.',
      code: 'LOGGED_IN'
    };
  }

  // 4. Sichtbarkeit eingeschränkt auf bestimmte Sicherheitsgruppen
  if (tile.visibility === 'groups') {
    let allowedGroups = [];
    try {
      allowedGroups = typeof tile.allowed_groups === 'string' ? JSON.parse(tile.allowed_groups || '[]') : (tile.allowed_groups || []);
    } catch (e) {
      allowedGroups = [];
    }

    if (!Array.isArray(allowedGroups) || allowedGroups.length === 0) {
      return {
        visible: false,
        reason: 'Einschränkung auf Gruppen: Es wurden keine erlaubten Gruppen auf der Kachel definiert.',
        code: 'NO_ALLOWED_GROUPS'
      };
    }

    const userGroups = user.groups || [];
    let effectiveGroups = [...userGroups];
    if (user.isLdap) {
      const mapped = ldap.mapLdapGroupsToLocal(userGroups);
      effectiveGroups = effectiveGroups.concat(mapped);
    }

    const normalizeGroup = (g) => {
      if (!g) return '';
      let name = String(g);
      const match = name.match(/cn=([^,]+)/i);
      if (match) name = match[1];
      return name.trim().toLowerCase()
        .normalize('NFC')
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/\s+/g, ' ');
    };

    const normalizedUserGroups = effectiveGroups.map(g => ({ original: g, norm: normalizeGroup(g) }));
    
    let matchedAllowedGroup = null;
    let matchedUserGroup = null;

    const hasAccess = allowedGroups.some(group => {
      const normAllowed = normalizeGroup(group);
      const found = normalizedUserGroups.find(ug => ug.norm === normAllowed);
      if (found) {
        matchedAllowedGroup = group;
        matchedUserGroup = found.original;
        return true;
      }
      return false;
    });

    if (hasAccess) {
      return {
        visible: true,
        reason: `Gruppen-Übereinstimmung: Benutzergruppe "${matchedUserGroup}" entspricht der geforderten Kachel-Gruppe "${matchedAllowedGroup}".`,
        code: 'GROUP_MATCH',
        details: {
          matchedUserGroup,
          matchedAllowedGroup,
          userGroups: effectiveGroups,
          allowedGroups
        }
      };
    } else {
      return {
        visible: false,
        reason: `Gruppen-Fehlstreffer: Keine der Gruppen des Benutzers [${effectiveGroups.join(', ') || 'keine'}] stimmt mit den geforderten Kachel-Gruppen [${allowedGroups.join(', ')}] überein.`,
        code: 'GROUP_MISMATCH',
        details: {
          userGroups: effectiveGroups,
          allowedGroups
        }
      };
    }
  }

  return {
    visible: false,
    reason: `Unbekannte Sichtbarkeitseinstellung "${tile.visibility}".`,
    code: 'UNKNOWN_VISIBILITY'
  };
}

/**
 * Ruft alle für den aktuellen Benutzer sichtbaren Kacheln ab.
 */
router.get('/', (req, res) => {
  try {
    const user = req.session.user;
    console.log(`[MSO Server Tiles] Abruf /api/tiles für Benutzer: ${user ? user.username : 'Gästemodus (unangemeldet)'}`);
    
    // Alle Kacheln aus der Datenbank holen
    const allTiles = db.prepare('SELECT * FROM tiles ORDER BY sort_order ASC, title ASC').all();
    const visibleTiles = allTiles.filter(tile => evaluateTileVisibility(tile, user).visible);

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
 * Admin-Diagnose-Endpunkt: Prüft Kachelrechte für einen bestimmten Benutzer
 * auf Basis des exakt identischen Evaluierungs-Algorithmus.
 */
router.get('/check-user/:userId', (req, res) => {
  const adminUser = req.session.user;
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Administratoren haben Zugriff auf das Kachel-Diagnose-Tool.' });
  }

  const { userId } = req.params;
  try {
    const userRow = db.prepare('SELECT id, username, email, role, groups, is_ldap, display_name FROM users WHERE id = ?').get(userId);
    if (!userRow) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    let parsedGroups = [];
    try {
      parsedGroups = typeof userRow.groups === 'string' ? JSON.parse(userRow.groups || '[]') : (userRow.groups || []);
    } catch (e) {
      parsedGroups = [];
    }

    let effectiveGroups = [...parsedGroups];
    if (userRow.is_ldap === 1) {
      const mapped = ldap.mapLdapGroupsToLocal(parsedGroups);
      effectiveGroups = effectiveGroups.concat(mapped);
    }

    const targetUser = {
      id: userRow.id,
      username: userRow.username,
      email: userRow.email,
      role: userRow.role,
      groups: parsedGroups,
      effectiveGroups: Array.from(new Set(effectiveGroups)),
      isLdap: userRow.is_ldap === 1,
      displayName: userRow.display_name
    };

    // Alle Kacheln laden
    const allTiles = db.prepare('SELECT * FROM tiles ORDER BY sort_order ASC, title ASC').all();

    const evaluations = allTiles.map(tile => {
      const evalResult = evaluateTileVisibility(tile, targetUser);
      const isTimeLocked = isTileTimeLocked(tile);
      return {
        id: tile.id,
        title: tile.title,
        icon: tile.icon,
        url: tile.url,
        category: tile.category,
        visibility: tile.visibility,
        allowed_groups: tile.allowed_groups,
        is_time_locked: isTimeLocked ? 1 : 0,
        time_limit_enabled: tile.time_limit_enabled,
        time_limit_start: tile.time_limit_start,
        time_limit_end: tile.time_limit_end,
        evaluation: evalResult
      };
    });

    res.json({
      user: targetUser,
      tilesCount: evaluations.length,
      visibleCount: evaluations.filter(e => e.evaluation.visible).length,
      hiddenCount: evaluations.filter(e => !e.evaluation.visible).length,
      evaluations
    });
  } catch (err) {
    console.error('Fehler bei der Kachel-Rechteprüfung:', err);
    res.status(500).json({ error: 'Fehler bei der Kachel-Rechteprüfung: ' + err.message });
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
    let tile = db.prepare('SELECT * FROM tiles WHERE id = ?').get(tileId);
    
    if (!tile) {
      // Fallback: Nach Titel/Slug suchen (z.B. /sso/fortbildung oder /sso/moodle)
      tile = db.prepare('SELECT * FROM tiles WHERE LOWER(title) = ? OR LOWER(title) LIKE ?').get(tileId.toLowerCase(), `%${tileId.toLowerCase()}%`);
    }

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
        
        let effectiveGroups = [...userGroups];
        if (user.isLdap) {
          const mapped = ldap.mapLdapGroupsToLocal(userGroups);
          effectiveGroups = effectiveGroups.concat(mapped);
        }
        
        const userGroupsCNs = effectiveGroups.map(g => {
          const match = g.match(/cn=([^,]+)/i);
          return match ? match[1].trim() : g;
        });
        
        hasAccess = allowedGroups.some(group => 
          effectiveGroups.some(ug => ug.toLowerCase() === group.toLowerCase()) ||
          userGroupsCNs.some(ugCN => ugCN.toLowerCase() === group.toLowerCase())
        );
      }
    }

    if (!hasAccess) {
      if (!user) {
        // Nicht angemeldet! Unterverzeichnis (/novus) berücksichtigen
        const host = req.get('host') || '';
        const isSubdir = host.includes('cloud.mso-hef.de') || req.originalUrl.startsWith('/novus');
        const prefix = isSubdir ? '/novus' : '';

        const returnTarget = req.originalUrl.startsWith('/novus') ? req.originalUrl : `${prefix}/api/tiles/sso/${tile.id}`;
        req.session.returnTo = returnTarget;

        return res.redirect(`${prefix}/index.html?login_required=1`);
      }
      return res.status(403).send('Zugriff verweigert. Sie haben keine Berechtigung für diesen Dienst.');
    }

    // Zeitsperre auf Server-Ebene erzwingen (Admins können sie zum Testen umgehen!)
    const isLocked = isTileTimeLocked(tile);
    if (isLocked && (!user || user.role !== 'admin')) {
      return res.status(403).send(`Zugriff verweigert. Dieser Dienst ist momentan zeitlich gesperrt. Er ist nur von ${tile.time_limit_start} bis ${tile.time_limit_end} Uhr aktiv.`);
    }

    // Revisionssicheres Log-Event im System-Protokoll ablegen (garantiert für ALLE Kachelaufrufe, inkl. SPH & Booking Autologin)
    if (typeof logEvent === 'function' && user) {
      const clientIpDisplay = (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1') 
        ? `127.0.0.1 (${tile.title})` 
        : `${req.ip} (${tile.title})`;
      logEvent('info', 'sso_tile_redirect', `SSO Aufruf für User: ${user.username} (Dienst: ${tile.title})`, { tileId: tile.id, title: tile.title, sso_type: tile.sso_type }, clientIpDisplay);
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
            // Schulnummer (i-Parameter) aus dem Tile-Link extrahieren (Fallback: 9743)
            let schoolNumber = '9743';
            try {
              if (tile.link.startsWith('http')) {
                const urlObj = new URL(tile.link);
                const iParam = urlObj.searchParams.get('i');
                if (iParam) {
                  schoolNumber = iParam.trim();
                }
              } else {
                const match = tile.link.match(/[?&]i=(\d+)/);
                if (match) {
                  schoolNumber = match[1];
                }
              }
            } catch (e) {
              const match = tile.link.match(/[?&]i=(\d+)/);
              if (match) {
                schoolNumber = match[1];
              }
            }

            let sphUsername = sphCreds.sph_username.trim();
            let userVal, user2Val;
            if (sphUsername.includes('.')) {
              userVal = sphUsername;
              user2Val = sphUsername.split('.').slice(1).join('.');
            } else {
              user2Val = sphUsername;
              userVal = `${schoolNumber}.${sphUsername}`;
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
                
                <form id="sph-login-form" method="POST" action="https://login.schulportal.hessen.de/?url=aHR0cHM6Ly9jb25uZWN0LnNjaHVscG9ydGFsLmhlc3Nlbi5kZS8=&skin=sp&i=${schoolNumber}">
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

      if (typeof logEvent === 'function') {
        const clientIpDisplay = (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1') 
          ? `127.0.0.1 (${tile.title})` 
          : `${req.ip} (${tile.title})`;
        logEvent('info', 'sso_query_claims', `SSO Query Parameter für User: ${user.username} (Dienst: ${tile.title})`, { username: user.username, email: user.email, timestamp, signature }, clientIpDisplay);
      }

    } else if (tile.sso_type === 'jwt' && user) {
      // SSO Typ B: Signierter JSON Web Token (JWT)
      const secret = tile.sso_key || 'default_secret_key';
      
      const payload = {
        username: user.username,
        display_name: user.display_name || user.username,
        email: user.email || '',
        groups: user.groups || [],
        role: user.role,
        is_ldap: user.isLdap
      };

      // Signiere JWT mit dem Kachel-eigenen Schlüssel (1 Minute Gültigkeit gegen Replay-Attacks!)
      const token = jwt.sign(payload, secret, { expiresIn: '1m' });
      
      const separator = redirectUrl.includes('?') ? '&' : '?';
      redirectUrl = `${redirectUrl}${separator}sso_token=${token}`;

      if (typeof logEvent === 'function') {
        const clientIpDisplay = (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1') 
          ? `127.0.0.1 (${tile.title})` 
          : `${req.ip} (${tile.title})`;
        logEvent('info', 'jwt_token_claims', `JWT Token Claims für User: ${user.username} (Dienst: ${tile.title})`, payload, clientIpDisplay);
      }
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
