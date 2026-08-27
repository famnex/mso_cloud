const { getConfig, logEvent } = require('../db');
const { isPrivateOrLocalIp, lookupIp } = require('../proxycheck');
const path = require('path');

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

    // 6. IP-Lookup über ProxyCheck.io (30-Tage SQLite Cache)
    const result = await lookupIp(clientIp);

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

      const logMsg = `Verbindung blockiert (${reasonTitleMap[blockReason] || blockReason}): IP ${clientIp}, Typ: ${result.type || 'Unknown'}, Provider: ${result.provider || 'Unknown'}, Risk-Score: ${result.risk_score || 0}`;

      // WARN Event im System-Protokoll eintragen
      logEvent('WARN', 'PROXYCHECK_BLOCKED', logMsg, {
        ip: clientIp,
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
          error: 'Zugriff verweigert. Anonymisierte Verbindungen oder Verbindungen mit erhöhtem Sicherheitsrisiko sind nicht gestattet.',
          code: 'PROXYCHECK_BLOCKED',
          reason: blockReason,
          details: {
            ip: clientIp,
            type: result.type,
            provider: result.provider,
            risk_score: result.risk_score
          }
        });
      } else {
        const queryParams = new URLSearchParams({
          reason: blockReason,
          ip: clientIp,
          type: result.type || 'Anonymisiert',
          provider: result.provider || 'Unbekannt',
          score: String(result.risk_score || 0)
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
