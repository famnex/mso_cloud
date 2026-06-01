-- Migration 006: Schülerportal Integration

-- Tabelle für Schüler-Stammdaten & Ausweiskarte
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT,
  birth_place TEXT,
  mediothek_number TEXT,
  start_password TEXT, -- Im Klartext hinterlegtes Startpasswort zur Erstanzeige
  account_status TEXT DEFAULT 'false', -- 'true' (aktiv) oder 'false' (inaktiv)
  card_status TEXT DEFAULT 'Bild ungeprüft / Kein Bild', -- 'Bild ungeprüft / Kein Bild', 'Bild eingereicht', 'Bild genehmigt', 'Bild abgelehnt'
  card_image TEXT, -- Base64-kodiertes Passbild
  dsgvo_consent TEXT DEFAULT 'Nein',
  publish_consent TEXT DEFAULT 'Nein',
  usage_consent TEXT DEFAULT 'Nein',
  videoconference_consent TEXT DEFAULT 'Nein',
  card_processing_consent TEXT DEFAULT 'Nein',
  paednetz_terms TEXT DEFAULT 'Nein',
  wlan_terms TEXT DEFAULT 'Nein',
  ms365_terms TEXT DEFAULT 'Nein',
  paednetz_logging TEXT DEFAULT 'Nein',
  wlan_logging TEXT DEFAULT 'Nein',
  ms365_logging TEXT DEFAULT 'Nein',
  onlinedienste_logging TEXT DEFAULT 'Nein',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabelle für sichere E-Mail Anmeldelinks (Tokens)
CREATE TABLE IF NOT EXISTS student_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Testbenutzer Max Mustermann anlegen (Passwort ist: 'startpassword123')
INSERT OR IGNORE INTO users (id, username, email, password_hash, role, groups, is_ldap)
VALUES (999, 'max.mustermann', 'max@mso-hef.de', '$2a$10$E1yWb5.uBfJq98a6aGzDauqCshNpxZ7iY1gC/z4GskE4092K2/U3W', 'user', '["Schueler"]', 0);

-- Testprofil für Max Mustermann seeden
INSERT OR IGNORE INTO student_profiles (
  user_id, first_name, last_name, birth_date, birth_place, mediothek_number, start_password,
  account_status, card_status, card_image, dsgvo_consent, paednetz_terms, wlan_terms, ms365_terms
) VALUES (
  999, 'Max', 'Mustermann', '2008-09-15', 'Bad Hersfeld', '12345678', 'startpassword123',
  'true', 'Bild ungeprüft / Kein Bild', NULL, 'Ja', 'Ja', 'Ja', 'Ja'
);
