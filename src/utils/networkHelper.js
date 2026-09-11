const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Prüft, ob eine gegebene IPv4- oder IPv6-Adresse in private, Loopback- oder Link-Local-Netze fällt.
 */
function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true;
  
  // IPv4-mapped IPv6 normalisieren (z.B. ::ffff:127.0.0.1 -> 127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  const ipType = net.isIP(ip);
  if (ipType === 0) return true; // Ungültige IP

  if (ipType === 4) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    // 0.0.0.0/8 (Broadcast/This network)
    if (parts[0] === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 10.0.0.0/8 (Private Network)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (Private Network)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private Network)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-Local / Cloud Metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 100.64.0.0/10 (Shared Address Space)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;

    return false;
  }

  if (ipType === 6) {
    const lower = ip.toLowerCase();
    // ::1 (Loopback) & :: (Unspecified)
    if (lower === '::1' || lower === '::') return true;
    // fe80::/10 (Link-Local)
    if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // fc00::/7 (Unique Local Address)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // ff00::/8 (Multicast)
    if (lower.startsWith('ff')) return true;

    return false;
  }

  return true;
}

// In-Memory-Cache für Kachelstatus (60 Sekunden TTL)
const statusCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

/**
 * Führt eine sichere HTTP/HTTPS Statusabfrage für eine Kachel-URL aus.
 * Schützt vor SSRF, DNS-Rebinding, Endlosschleifen und Timeouts.
 */
async function checkUrlAvailability(targetUrl, options = {}) {
  const allowPrivate = options.allowPrivate === true;

  if (!targetUrl || typeof targetUrl !== 'string') {
    return { online: false, reason: 'Keine gültige URL angegeben' };
  }

  // Cache-Check
  const cached = statusCache.get(targetUrl);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.result;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    return { online: false, reason: 'Ungültiges URL-Format' };
  }

  // Nur HTTP und HTTPS erlauben
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { online: false, reason: 'Nicht unterstütztes Protokoll (nur HTTP/HTTPS erlaubt)' };
  }

  const hostname = parsedUrl.hostname;
  const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80);

  // 1. DNS-Auflösung vorab prüfen (SSRF-Schutz)
  try {
    let resolvedIps = [];
    if (net.isIP(hostname)) {
      resolvedIps = [hostname];
    } else {
      const records = await dns.lookup(hostname, { all: true });
      resolvedIps = records.map(r => r.address);
    }

    if (!resolvedIps || resolvedIps.length === 0) {
      return { online: false, reason: 'DNS-Auflösung fehlgeschlagen' };
    }

    if (!allowPrivate) {
      for (const ip of resolvedIps) {
        if (isPrivateOrLoopbackIp(ip)) {
          return { 
            online: false, 
            blocked: true,
            reason: 'Zugriff auf interne/private Netzwerkadressen aus Sicherheitsgründen blockiert (SSRF-Schutz)' 
          };
        }
      }
    }
  } catch (dnsErr) {
    return { online: false, reason: 'DNS-Auflösung fehlgeschlagen: ' + dnsErr.message };
  }

  // 2. HTTP/HTTPS HEAD-Anfrage ausführen
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      statusCache.set(targetUrl, { timestamp: Date.now(), result });
      resolve(result);
    };

    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const requestOptions = {
      method: 'HEAD',
      host: hostname,
      port: port,
      path: parsedUrl.pathname + parsedUrl.search,
      timeout: 4000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MSO-Cloud-Checker/2.0',
        'Accept': '*/*'
      }
    };

    const req = protocol.request(requestOptions, (res) => {
      const isOnline = res.statusCode >= 200 && res.statusCode < 500;
      if (isOnline) {
        finish({ online: true, statusCode: res.statusCode, reason: `Erreichbar (HTTP ${res.statusCode})` });
      } else {
        finish({ online: false, statusCode: res.statusCode, reason: `Dienst meldet Serverfehler (HTTP ${res.statusCode})` });
      }
    });

    req.on('timeout', () => {
      req.destroy();
      finish({ online: false, reason: 'Zeitüberschreitung (Timeout nach 4s)' });
    });

    req.on('error', (err) => {
      finish({ online: false, reason: `Verbindungsfehler: ${err.message}` });
    });

    req.end();
  });
}

module.exports = {
  isPrivateOrLoopbackIp,
  checkUrlAvailability
};
