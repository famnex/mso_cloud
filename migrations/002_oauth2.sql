-- Tabelle für registrierte OAuth 2.0 Clients (z. B. Moodle)
CREATE TABLE IF NOT EXISTS oauth_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    redirect_uri TEXT NOT NULL, -- Erlaubte Callback-URL des Clients
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabelle für temporäre, einweg-verwendbare Authorization Codes
CREATE TABLE IF NOT EXISTS oauth_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabelle für Access Tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Initialen Standard-Client für Moodle anlegen (kann später im Admin-Bereich angepasst werden)
INSERT OR IGNORE INTO oauth_clients (client_name, client_id, client_secret, redirect_uri)
VALUES ('Moodle', 'moodle_client', 'moodle_secret_key_32_chars_long_123', 'https://cloud.mso-hef.de/moodle/admin/oauth2callback.php');
