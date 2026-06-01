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
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;
    db.prepare(`
      INSERT INTO system_logs (level, action, message, details, ip)
      VALUES (?, ?, ?, ?, ?)
    `).run(level, action, message, detailsStr, ip);
    console.log(`[System Log - ${level.toUpperCase()}] Action: ${action}, Message: ${message}`);
  } catch (err) {
    console.error('Fehler beim Schreiben des System-Protokolls:', err);
  }
}

// Initialer Migrationslauf beim Laden des Moduls
runMigrations();

module.exports = {
  db,
  getConfig,
  setConfig,
  runMigrations,
  logEvent
};
