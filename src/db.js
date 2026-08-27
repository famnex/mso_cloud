const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DB_DIR, 'mso_cloud.db');

// Sicherstellen, dass das Datenverzeichnis existiert
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Verbindung zur Datenbank herstellen
const db = new Database(DB_PATH, { verbose: console.log });
db.pragma('journal_mode = WAL'); // Performance-Optimierung für SQLite

/**
 * Führt alle noch ausstehenden SQL-Migrationen aus dem Ordner /migrations aus.
 */
function runMigrations() {
  console.log('Führe Datenbank-Migrationen aus...');

  // Tabelle zur Erfassung angewandter Migrationen erstellen, falls nicht vorhanden
  db.prepare(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  const migrationsDir = path.join(__dirname, '../migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn('Migrations-Verzeichnis existiert nicht.');
    return;
  }

  // Alle SQL-Dateien auslesen und sortieren
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  // Bereits angewandte Migrationen ermitteln
  const applied = new Set(
    db.prepare('SELECT name FROM applied_migrations').all().map(row => row.name)
  );

  // Transaktion für alle ausstehenden Migrationen starten
  const runTransaction = db.transaction(() => {
    for (const file of files) {
      if (!applied.has(file)) {
        console.log(`Wende Migration an: ${file}`);
        const sqlPath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // SQL-Statements ausführen (SQLite erlaubt mehrere Statements in einem exec)
        db.exec(sql);
        
        // Als angewandt markieren
        db.prepare('INSERT INTO applied_migrations (name) VALUES (?)').run(file);
      }
    }
  });

  try {
    runTransaction();
    console.log('Datenbank-Migrationen erfolgreich abgeschlossen.');
  } catch (error) {
    console.error('Fehler bei der Ausführung der Datenbank-Migrationen:', error);
    throw error;
  }
}

/**
 * Holt einen Konfigurationswert aus der Datenbank.
 */
function getConfig(key, defaultValue = null) {
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Setzt oder aktualisiert einen Konfigurationswert in der Datenbank.
 */
function setConfig(key, value) {
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, valueStr, valueStr);
}

/**
 * Schreibt einen Eintrag in die System-Protokolle (Audit Log).
 */
function logEvent(level, action, message, details = null, ip = null) {
  try {
    const cleanLevel = String(level || 'info').toLowerCase().trim();
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    db.prepare(`
      INSERT INTO system_logs (level, action, message, details, ip)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanLevel, action, message, detailsStr, ip);
    console.log(`[System Log - ${cleanLevel.toUpperCase()}] Action: ${action}, Message: ${message}`);
  } catch (err) {
    console.error('Fehler beim Schreiben des System-Protokolls:', err);
  }
}

/**
 * Löscht alte System-Protokolle anhand des Log-Levels und konfigurierbarer Aufbewahrungszeiten:
 * - INFO  → 10 Tage
 * - WARN  → 30 Tage
 * - ERROR → 365 Tage
 */
function cleanupOldLogs() {
  try {
    const infoResult  = db.prepare("DELETE FROM system_logs WHERE level = 'info'  AND datetime(created_at) < datetime('now', '-10 days')").run();
    const warnResult  = db.prepare("DELETE FROM system_logs WHERE level = 'warn'  AND datetime(created_at) < datetime('now', '-30 days')").run();
    const errorResult = db.prepare("DELETE FROM system_logs WHERE level = 'error' AND datetime(created_at) < datetime('now', '-365 days')").run();
    const total = infoResult.changes + warnResult.changes + errorResult.changes;
    if (total > 0) {
      console.log(`[Logs Cleanup] ${total} alte Protokolleinträge gelöscht (INFO: ${infoResult.changes}, WARN: ${warnResult.changes}, ERROR: ${errorResult.changes}).`);
    }
  } catch (err) {
    console.error('Fehler beim Log-Cleanup:', err);
  }
}

/**
 * Sperrt ein Gerät (Device-ID und/oder Fingerprint) in blocked_devices.
 */
function blockDevice({ device_id, fingerprint, username = null, reason = 'blocked', ip = null, details = null }) {
  if (!device_id && !fingerprint) return null;
  try {
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    return db.prepare(`
      INSERT INTO blocked_devices (device_id, fingerprint, username, reason, ip, details)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        fingerprint = COALESCE(excluded.fingerprint, blocked_devices.fingerprint),
        username = COALESCE(excluded.username, blocked_devices.username),
        reason = excluded.reason,
        ip = COALESCE(excluded.ip, blocked_devices.ip),
        details = COALESCE(excluded.details, blocked_devices.details),
        blocked_at = CURRENT_TIMESTAMP
    `).run(device_id || null, fingerprint || null, username || null, reason, ip || null, detailsStr);
  } catch (err) {
    console.error('Fehler beim Sperren des Geräts in blocked_devices:', err);
    return null;
  }
}

/**
 * Prüft, ob ein Gerät anhand von device_id oder fingerprint gesperrt ist.
 */
function isDeviceBlocked(deviceId, fingerprint) {
  if (!deviceId && !fingerprint) return null;
  try {
    if (deviceId && fingerprint) {
      return db.prepare(`
        SELECT * FROM blocked_devices 
        WHERE (device_id = ? OR fingerprint = ?)
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT 1
      `).get(deviceId, fingerprint);
    } else if (deviceId) {
      return db.prepare(`
        SELECT * FROM blocked_devices 
        WHERE device_id = ?
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT 1
      `).get(deviceId);
    } else if (fingerprint) {
      return db.prepare(`
        SELECT * FROM blocked_devices 
        WHERE fingerprint = ?
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT 1
      `).get(fingerprint);
    }
  } catch (err) {
    console.error('Fehler beim Prüfen der Gerätesperre:', err);
  }
  return null;
}

/**
 * Entsperrt ein Gerät aus blocked_devices per ID oder device_id.
 */
function unblockDevice(identifier) {
  if (!identifier) return false;
  try {
    const info = db.prepare('DELETE FROM blocked_devices WHERE id = ? OR device_id = ? OR fingerprint = ?').run(identifier, identifier, identifier);
    return info.changes > 0;
  } catch (err) {
    console.error('Fehler beim Entsperren des Geräts:', err);
    return false;
  }
}

// Initialer Migrationslauf beim Laden des Moduls
runMigrations();

module.exports = {
  db,
  getConfig,
  setConfig,
  runMigrations,
  logEvent,
  cleanupOldLogs,
  blockDevice,
  isDeviceBlocked,
  unblockDevice
};
