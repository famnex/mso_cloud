const { db, getConfig, logEvent } = require('../db');
const { isPrivateOrLocalIp, lookupIp } = require('../proxycheck');

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = decodeURIComponent(parts[1].trim());
    }
  });
  return list;
}

function detectUserForRequest(req, clientIp) {
  // 1. Session User
  if (req.session && req.session.user) {
    const u = req.session.user.username || req.session.user.name || req.session.user.email;
    if (u) return String(u).trim();
  }

  // 2. Login Payload
  if (req.body && req.body.username) {
    return String(req.body.username).trim();
  }

  // 3. Persistent Cookie
  const cookies = parseCookies(req);
  if (cookies.mso_remember_user) {
    return cookies.mso_remember_user.trim();
  }

  // 4. DB Lookup in system_logs nach letztem bekannten Login / User-Event für diese IP
  try {
    const logRow = db.prepare(`
      SELECT details, message FROM system_logs 
      WHERE ip = ? AND (action LIKE '%login%' OR action LIKE '%auth%' OR action LIKE '%user%')
      ORDER BY id DESC LIMIT 1
    `).get(clientIp);

    if (logRow) {
      if (logRow.details) {
        try {
          const d = JSON.parse(logRow.details);
          if (d.username) return d.username;
          if (d.user) return d.user;
          if (d.email) return d.email;
        } catch(e) {}
      }
      if (logRow.message) {
        const match = logRow.message.match(/für:\s*([^\s,;]+)|Benutzer\s+([^\s,;]+)|User\s+([^\s,;]+)|E-Mail:\s*([^\s,;]+)/i);
        if (match) return match[1] || match[2] || match[3] || match[4];
      }
    }
  } catch(e) {}

  return null;
}

/**
 * Express-Middleware für den automatisierten ProxyCheck.io Schutz.
 */
async function proxyCheckMiddleware(req, res, next) {
  try {
    // 1. Prüfen, ob der Schutz in den Admin-Einstellungen aktiviert ist
    const enabled = getConfig('proxycheck_enabled', '0') === '1';
    if (!enabled) {
      return next();
    }

    const p = req.path.toLowerCase();

    // 2. Automatische Routen-Bypässe (Statische Assets, Admin-API, Setup, Blockseite)
    if (
      p === '/blocked.html' || p === '/blocked' ||
      p.startsWith('/api/admin') || p.startsWith('/novus/api/admin') ||
      p.startsWith('/api/setup') || p.startsWith('/novus/api/setup') ||
      p === '/setup.html' ||
      p.endsWith('.css') || p.endsWith('.js') || p.endsWith('.png') ||
      p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.svg') ||
      p.endsWith('.ico') || p.endsWith('.woff') || p.endsWith('.woff2') ||
      p.endsWith('.ttf')
    ) {
      return next();
    }

    // 3. Automatischer Bypass für eingeloggt Mitarbeiter / Admins
    if (req.session && req.session.user) {
      const role = String(req.session.user.role || '').toLowerCase();
      const groups = Array.isArray(req.session.user.groups) ? req.session.user.groups.map(g => String(g).toLowerCase()) : [];

      const isExemptRole = role === 'admin' || role === 'lehrer' || role === 'mitarbeiter' ||
                           groups.includes('admin') || groups.includes('lehrer') || groups.includes('mitarbeiter');

      if (isExemptRole) {
        return next();
      }
    }

    // 4. Client-IP ermitteln
    let clientIp = req.ip || req.socket.remoteAddress || '';
    if (req.headers['x-forwarded-for']) {
      const forwarded = req.headers['x-forwarded-for'].split(',')[0].trim();
      if (forwarded) clientIp = forwarded;
    }

    // 5. Automatischer Bypass für lokale / private IPs (127.0.0.1, 10.x, 192.168.x, 172.16-31.x)
    if (isPrivateOrLocalIp(clientIp)) {
      return next();
    }

    // 6. Benutzererkennung & IP-Lookup über ProxyCheck.io (30-Tage SQLite Cache)
    const detectedUser = detectUserForRequest(req, clientIp);
    const result = await lookupIp(clientIp, detectedUser);

    // 7. Konfigurierte Schwellenwerte und Schalter abrufen
    const checkVpn = getConfig('proxycheck_check_vpn', '1') === '1';
    const checkTor = getConfig('proxycheck_check_tor', '1') === '1';
    const checkProxy = getConfig('proxycheck_check_proxy', '1') === '1';
    const checkCompromised = getConfig('proxycheck_check_compromised', '1') === '1';
    const riskThreshold = parseInt(getConfig('proxycheck_risk_threshold', '67'), 10);

    let isBlocked = false;
    let blockReason = '';

    if (checkVpn && result.is_vpn) {
      isBlocked = true;
      blockReason = 'vpn';
    } else if (checkTor && result.is_tor) {
      isBlocked = true;
      blockReason = 'tor';
    } else if (checkProxy && result.is_proxy) {
      isBlocked = true;
      blockReason = 'proxy';
    } else if (checkCompromised && result.is_compromised) {
      isBlocked = true;
      blockReason = 'compromised';
    } else if (riskThreshold > 0 && result.risk_score >= riskThreshold) {
      isBlocked = true;
      blockReason = 'risk';
    }

    // 8. Wenn die IP gesperrt ist: Loggen & Blockieren
    if (isBlocked) {
      const reasonTitleMap = {
        vpn: 'VPN-Verbindung',
        tor: 'TOR-Netzwerk',
        proxy: 'Proxy-Server',
        compromised: 'Kompromittierte IP/Server',
        risk: `Erhöhter Risiko-Score (${result.risk_score}/${riskThreshold})`
      };

      const userDisplay = detectedUser ? `User: ${detectedUser}` : 'User: Unbekannt';
      const logMsg = `Verbindung blockiert (${reasonTitleMap[blockReason] || blockReason}): IP ${clientIp}, ${userDisplay}, Typ: ${result.type || 'Unknown'}, Provider: ${result.provider || 'Unknown'}, Risk-Score: ${result.risk_score || 0}`;

      // WARN Event im System-Protokoll eintragen
      logEvent('WARN', 'PROXYCHECK_BLOCKED', logMsg, {
        ip: clientIp,
        username: detectedUser || null,
        type: result.type,
        provider: result.provider,
        country: result.country,
        risk_score: result.risk_score,
        block_reason: blockReason,
        path: req.originalUrl || req.path
      }, clientIp);

      // JSON vs. HTML Antwort
      const isJsonRequest = req.xhr || 
                            (req.headers.accept && req.headers.accept.includes('application/json')) ||
                            p.startsWith('/api/') || 
                            p.startsWith('/novus/api/');

      if (isJsonRequest) {
        return res.status(403).json({
          error: 'Zugriff verweigert: Sie nutzen eine VPN-Verbindung, einen Proxy-Server oder einen anonymisierten Dienst. Bitte deaktivieren Sie Ihre VPN-Verbindung (z.B. NordVPN, Mullvad, ProtonVPN, ExpressVPN) und laden Sie die Seite neu.',
          code: 'PROXYCHECK_BLOCKED',
          reason: blockReason,
          user: detectedUser || null,
          details: {
            ip: clientIp,
            type: result.type || 'Anonymisiert',
            provider: result.provider || 'Unbekannt',
            risk_score: result.risk_score || 0
          }
        });
      } else {
        const queryParams = new URLSearchParams({
          reason: blockReason,
          ip: clientIp,
          type: result.type || 'Anonymisiert',
          provider: result.provider || 'Unbekannt',
          score: String(result.risk_score || 0),
          user: detectedUser || ''
        });

        return res.redirect(`/blocked.html?${queryParams.toString()}`);
      }
    }

  } catch (err) {
    console.error('Fehler in ProxyCheck Middleware:', err);
  }

  next();
}

module.exports = proxyCheckMiddleware;
