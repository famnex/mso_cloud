-- Migration 004: Tabelle für Schulportal Hessen Zugangsdaten erstellen
CREATE TABLE IF NOT EXISTS user_sph_credentials (
  user_id INTEGER PRIMARY KEY,
  sph_username TEXT NOT NULL,
  sph_password TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
