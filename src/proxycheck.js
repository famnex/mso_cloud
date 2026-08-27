const https = require('https');
const http = require('http');
const { db, getConfig } = require('./db');

/**
 * Prüft, ob eine IP-Adresse eine lokale, private oder Loopback-Adresse ist.
 * Lokale IPs dürfen NIEMALS gesperrt und NIEMALS an externe APIs gesendet werden.
 * 
 * @param {string} ip 
 * @returns {boolean}
 */
function isPrivateOrLocalIp(ip) {
  if (!ip) return true;

  // IPv6 / IPv4 Mappings bereinigen (z.B. ::ffff:192.168.1.1)
  let cleanIp = ip.trim();
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.substring(7);
  }

  // Loopback & Localhost
  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost' || cleanIp === '0.0.0.0') {
    return true;
  }

  // IPv6 Link-Local / Unique Local
  if (cleanIp.toLowerCase().startsWith('fe80:') || cleanIp.toLowerCase().startsWith('fc00:') || cleanIp.toLowerCase().startsWith('fd00:')) {
    return true;
  }

  // IPv4 Private Subnetze:
  // 10.0.0.0 – 10.255.255.255
  if (cleanIp.startsWith('10.')) {
    return true;
  }

  // 192.168.0.0 – 192.168.255.255
  if (cleanIp.startsWith('192.168.')) {
    return true;
  }

  // 169.254.0.0 – 169.254.255.255 (Link-Local)
  if (cleanIp.startsWith('169.254.')) {
    return true;
  }

  // 172.16.0.0 – 172.31.255.255
  if (cleanIp.startsWith('172.')) {
    const parts = cleanIp.split('.');
    if (parts.length >= 2) {
      const secondOctet = parseInt(parts[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Führt einen HTTP/HTTPS GET Request durch und gibt eine Promise mit den geparsten Daten zurück.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Ungültige JSON-Antwort von ProxyCheck.io: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout bei der Verbindung zu ProxyCheck.io (8s)'));
    });
  });
}

/**
 * Führt die Prüfung einer IP-Adresse durch (mit 30-Tage SQLite Cache).
 * 
 * @param {string} ip 
 * @returns {Promise<Object>}
 */
async function lookupIp(ip) {
  if (!ip || isPrivateOrLocalIp(ip)) {
    return {
      ip,
      bypassed: true,
      reason: 'private_or_local_ip',
      is_vpn: 0,
      is_tor: 0,
      is_proxy: 0,
      is_compromised: 0,
      risk_score: 0,
      type: 'Local/Private',
      provider: 'Internal Network',
      country: 'Local'
    };
  }

  const cleanIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;

  // 1. Lokalen SQLite-Cache prüfen (30-Tage Gültigkeit)
  try {
    const cachedRow = db.prepare(`
      SELECT * FROM proxycheck_cache 
      WHERE ip = ? AND expires_at > CURRENT_TIMESTAMP
    `).get(cleanIp);

    if (cachedRow) {
      return {
        ip: cachedRow.ip,
        cached: true,
        type: cachedRow.type || 'Unknown',
        provider: cachedRow.provider || 'Unknown',
        country: cachedRow.country || 'Unknown',
        is_vpn: cachedRow.is_vpn === 1,
        is_tor: cachedRow.is_tor === 1,
        is_proxy: cachedRow.is_proxy === 1,
        is_compromised: cachedRow.is_compromised === 1,
        risk_score: cachedRow.risk_score || 0,
        raw: cachedRow.raw_json ? JSON.parse(cachedRow.raw_json) : null
      };
    }
  } catch (e) {
    console.error('Fehler beim Abfragen des ProxyCheck SQLite-Caches:', e);
  }

  // 2. Cache-Miss: External API-Abfrage bei ProxyCheck.io
  const apiKey = getConfig('proxycheck_api_key', '').trim();
  const url = `https://proxycheck.io/v2/${cleanIp}?key=${encodeURIComponent(apiKey)}&vpn=1&asn=1&risk=1&port=1&seen=1`;

  let apiResponse;
  try {
    apiResponse = await httpGet(url);
  } catch (err) {
    console.error(`ProxyCheck.io API-Fehler für IP ${cleanIp}:`, err.message);
    // Bei API-Fehler nicht blockieren (Fail-Open für hohe Verfügbarkeit)
    return {
      ip: cleanIp,
      error: err.message,
      is_vpn: false,
      is_tor: false,
      is_proxy: false,
      is_compromised: false,
      risk_score: 0,
      type: 'Unknown',
      provider: 'Unknown',
      country: 'Unknown'
    };
  }

  // API-Ergebnis auswerten
  const ipData = apiResponse[cleanIp] || {};
  const isVpn = ipData.proxy === 'yes' && (ipData.type === 'VPN' || (ipData.type && ipData.type.toUpperCase().includes('VPN')));
  const isTor = ipData.proxy === 'yes' && (ipData.type === 'TOR' || (ipData.type && ipData.type.toUpperCase().includes('TOR')));
  const isProxy = ipData.proxy === 'yes' && !isVpn && !isTor;
  const isCompromised = ipData.type && (ipData.type.toLowerCase().includes('compromised') || ipData.type.toLowerCase().includes('botnet'));
  const riskScore = parseInt(ipData.risk || '0', 10);
  const type = ipData.type || (ipData.proxy === 'yes' ? 'Proxy' : 'Residential');
  const provider = ipData.provider || ipData.asn || 'Unbekannt';
  const country = ipData.country || ipData.isocode || 'Unbekannt';

  // 3. Ergebnis für 30 Tage im SQLite Cache speichern (upsert)
  try {
    db.prepare(`
      INSERT INTO proxycheck_cache (
        ip, type, provider, country, is_vpn, is_tor, is_proxy, is_compromised, risk_score, raw_json, expires_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days')
      )
      ON CONFLICT(ip) DO UPDATE SET
        type = excluded.type,
        provider = excluded.provider,
        country = excluded.country,
        is_vpn = excluded.is_vpn,
        is_tor = excluded.is_tor,
        is_proxy = excluded.is_proxy,
        is_compromised = excluded.is_compromised,
        risk_score = excluded.risk_score,
        raw_json = excluded.raw_json,
        checked_at = CURRENT_TIMESTAMP,
        expires_at = datetime('now', '+30 days')
    `).run(
      cleanIp,
      type,
      provider,
      country,
      isVpn ? 1 : 0,
      isTor ? 1 : 0,
      isProxy ? 1 : 0,
      isCompromised ? 1 : 0,
      riskScore,
      JSON.stringify(apiResponse)
    );
  } catch (e) {
    console.error('Fehler beim Speichern in proxycheck_cache:', e);
  }

  return {
    ip: cleanIp,
    cached: false,
    type,
    provider,
    country,
    is_vpn: isVpn,
    is_tor: isTor,
    is_proxy: isProxy,
    is_compromised: isCompromised,
    risk_score: riskScore,
    raw: apiResponse
  };
}

/**
 * Testet die ProxyCheck.io API-Verbindung und ruft das verbleibende Tageskontingent ab.
 * 
 * @param {string} apiKey 
 * @returns {Promise<Object>}
 */
async function testApiConnection(apiKey) {
  const keyToUse = (apiKey && apiKey !== '********') ? apiKey.trim() : getConfig('proxycheck_api_key', '').trim();

  if (!keyToUse) {
    return {
      success: false,
      message: 'Kein API-Key angegeben. Bitte tragen Sie Ihren ProxyCheck.io API-Key ein.'
    };
  }

  const url = `https://proxycheck.io/v2/8.8.8.8?key=${encodeURIComponent(keyToUse)}&vpn=1&risk=1&queries=1`;

  try {
    const res = await httpGet(url);
    if (res.status === 'error' || res.status === 'denied') {
      return {
        success: false,
        message: res.message || 'Verbindung abgelehnt. Bitte prüfen Sie Ihren API-Schlüssel.'
      };
    }

    // ProxyCheck API Antwort-Felder prüfen
    let rawToday = res.queries_today !== undefined ? res.queries_today :
                   (res.queries_used !== undefined ? res.queries_used :
                   (res['queries_today'] !== undefined ? res['queries_today'] :
                   (res['8.8.8.8'] && res['8.8.8.8'].queries_today !== undefined ? res['8.8.8.8'].queries_today : undefined)));

    let rawLimit = res.daily_limit !== undefined ? res.daily_limit :
                  (res.limit !== undefined ? res.limit :
                  (res.max_queries !== undefined ? res.max_queries :
                  (res.queries_limit !== undefined ? res.queries_limit : 1000)));

    let queriesTodayNum = (rawToday !== undefined && rawToday !== null) ? parseInt(rawToday, 10) : null;
    let dailyLimitNum = (rawLimit !== undefined && rawLimit !== null) ? parseInt(rawLimit, 10) : 1000;
    if (isNaN(dailyLimitNum)) dailyLimitNum = 1000;

    let isEstimated = false;
    // Falls ProxyCheck.io queries_today nicht in der Antwort sendet, zählen wir die heutigen API-Lookups lokal
    if (queriesTodayNum === null || isNaN(queriesTodayNum)) {
      try {
        const localCount = db.prepare("SELECT COUNT(*) as count FROM proxycheck_cache WHERE DATE(checked_at) = DATE('now')").get();
        queriesTodayNum = localCount ? localCount.count : 0;
        isEstimated = true;
      } catch (e) {
        queriesTodayNum = 0;
      }
    }

    const remainingNum = Math.max(0, dailyLimitNum - queriesTodayNum);

    return {
      success: true,
      message: 'Verbindung zu ProxyCheck.io erfolgreich hergestellt!',
      status: res.status || 'ok',
      queries_today: queriesTodayNum,
      daily_limit: dailyLimitNum,
      queries_remaining: remainingNum,
      is_estimated: isEstimated,
      raw_status: res.status
    };
  } catch (err) {
    return {
      success: false,
      message: `Verbindungsfehler: ${err.message}`
    };
  }
}

/**
 * Löscht abgelaufene Cache-Einträge aus der SQLite-Datenbank.
 */
function cleanExpiredCache() {
  try {
    const result = db.prepare(`DELETE FROM proxycheck_cache WHERE expires_at <= CURRENT_TIMESTAMP`).run();
    if (result.changes > 0) {
      console.log(`[ProxyCheck] ${result.changes} abgelaufene Cache-Einträge entfernt.`);
    }
  } catch (e) {
    console.error('Fehler beim Bereinigen des ProxyCheck-Caches:', e);
  }
}

module.exports = {
  isPrivateOrLocalIp,
  lookupIp,
  testApiConnection,
  cleanExpiredCache
};
