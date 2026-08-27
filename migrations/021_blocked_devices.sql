-- Migration 021: Tabelle blocked_devices für gerätebasierte Sperrung (Device Fingerprinting)
CREATE TABLE IF NOT EXISTS blocked_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT UNIQUE,
  fingerprint TEXT,
  username TEXT,
  reason TEXT,
  ip TEXT,
  details TEXT,
  blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_blocked_devices_id ON blocked_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_blocked_devices_fp ON blocked_devices(fingerprint);
