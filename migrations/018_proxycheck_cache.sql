-- Migration 018: ProxyCheck.io 30-Tage Cache-Tabelle für IP-Ergebnisse
CREATE TABLE IF NOT EXISTS proxycheck_cache (
    ip TEXT PRIMARY KEY,
    type TEXT,
    provider TEXT,
    country TEXT,
    is_vpn INTEGER DEFAULT 0,
    is_tor INTEGER DEFAULT 0,
    is_proxy INTEGER DEFAULT 0,
    is_compromised INTEGER DEFAULT 0,
    risk_score INTEGER DEFAULT 0,
    raw_json TEXT,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

-- Index für schnellen Cleanup abgelaufener Cache-Einträge
CREATE INDEX IF NOT EXISTS idx_proxycheck_cache_expires ON proxycheck_cache(expires_at);
