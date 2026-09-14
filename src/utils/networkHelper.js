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
  ip = ip.toLowerCase();
  // URL/IPv6 canonicalization can encode mapped IPv4 as hexadecimal words.
  const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
    ip = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  
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

/**
 * Prüft, ob eine IP-Adresse zu gesperrten Cloud-Metadaten-Endpunkten (169.254.169.254) oder Broadcast/Multicast gehört.
 */
function isForbiddenMetadataOrBroadcastIp(ip) {
  if (!ip) return true;
  ip = ip.toLowerCase();
  const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
    ip = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  const ipType = net.isIP(ip);
  if (ipType === 0) return true;

  if (ipType === 4) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    // 0.0.0.0/8 (Broadcast/This network)
    if (parts[0] === 0) return true;
    // 169.254.0.0/16 (Link-Local / Cloud Metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;

    return false;
  }

  if (ipType === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::') return true;
    // fe80::/10 (Link-Local)
    if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
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
 * Schützt vor DNS-Rebinding, Endlosschleifen, Timeouts und Cloud-Metadaten-Exfiltration.
 * Erlaubt standardmäßig interne Schulnetz-Dienste (10.x, 192.168.x, 172.16-31.x, 127.0.0.1),
 * da Kacheln ausschließlich vom Administrator im System hinterlegt werden.
 */
async function checkUrlAvailability(targetUrl) {
  const unknown = reason => ({ online: null, state: 'unknown', reason });
  let parsedUrl;
  try { parsedUrl = new URL(targetUrl); }
  catch { return unknown('Ungültiges URL-Format'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    return unknown('Nur HTTP/HTTPS ohne Zugangsdaten in der URL erlaubt');
  }

  // Erlaube interne Schulnetze standardmäßig, außer wenn STATUS_CHECK_ALLOW_PRIVATE explizit '0' oder 'false' ist
  const allowAllPrivate = process.env.STATUS_CHECK_ALLOW_PRIVATE !== '0' && 
                          process.env.STATUS_CHECK_ALLOW_PRIVATE !== 'false';
  const allowedOrigins = (process.env.STATUS_CHECK_PRIVATE_ORIGINS || '').split(',')
    .map(value => value.trim()).filter(Boolean);
  const allowPrivate = allowAllPrivate || allowedOrigins.includes(parsedUrl.origin) || allowedOrigins.includes('*');

  const cacheKey = `${allowPrivate}:${parsedUrl.href}`;
  const cached = statusCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.result;
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');
  let records;
  let dnsTimer;
  try {
    records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }]
      : await Promise.race([
        dns.lookup(hostname, { all: true }),
        new Promise((_, reject) => {
          dnsTimer = setTimeout(() => reject(new Error('DNS timeout')), 4000);
        })
      ]);
  } catch { return unknown('DNS-Auflösung fehlgeschlagen'); }
  finally { clearTimeout(dnsTimer); }
  if (!records.length) return unknown('DNS-Auflösung fehlgeschlagen');

  // Cloud-Metadaten (z.B. 169.254.169.254) und Broadcast/Multicast sind immer blockiert
  if (records.some(record => isForbiddenMetadataOrBroadcastIp(record.address))) {
    return { ...unknown('Gesperrter Cloud-Metadaten- oder Broadcast-Endpunkt'), blocked: true };
  }

  // Falls Strict-Mode aktiv ist (STATUS_CHECK_ALLOW_PRIVATE=false) und private IP nicht in Whitelist
  if (!allowPrivate && records.some(record => isPrivateOrLoopbackIp(record.address))) {
    return { ...unknown('Interner Dienst: Statusprüfung nicht freigegeben'), blocked: true };
  }

  return new Promise(resolve => {
    let resolved = false;
    let timer;
    const finish = result => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (statusCache.size >= 1000) statusCache.delete(statusCache.keys().next().value);
      statusCache.set(cacheKey, { timestamp: Date.now(), result });
      resolve(result);
    };
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const req = protocol.request({
      hostname,
      // Use a direct connection so global proxy agents cannot bypass DNS pinning.
      agent: false,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      method: 'HEAD',
      path: parsedUrl.pathname + parsedUrl.search,
      // Pin the validated addresses; do not perform a second DNS lookup (rebinding).
      lookup: (_host, options, callback) => {
        if (options && options.all) return callback(null, records);
        callback(null, records[0].address, records[0].family);
      },
      headers: { 'User-Agent': 'MSO-Cloud-Checker/2.1', Accept: '*/*' }
    }, res => {
      res.resume();
      // Redirects prove reachability, but are never followed to another target.
      const online = res.statusCode >= 200 && res.statusCode < 500;
      finish({ online, state: online ? 'online' : 'offline', statusCode: res.statusCode,
        reason: online ? `Erreichbar (HTTP ${res.statusCode})` : `Dienst meldet Serverfehler (HTTP ${res.statusCode})` });
    });
    timer = setTimeout(() => {
      finish(unknown('Zeitüberschreitung bei der Statusprüfung'));
      req.destroy();
    }, 4000);
    req.on('error', () => finish(unknown('Verbindung vom Portalserver zum Dienst nicht möglich')));
    req.end();
  });
}

module.exports = { isPrivateOrLoopbackIp, isForbiddenMetadataOrBroadcastIp, checkUrlAvailability };
