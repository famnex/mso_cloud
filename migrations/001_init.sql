-- Tabelle für Konfigurationswerte (LDAP, SMTP, Setup-Status)
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Tabelle für Benutzer (lokal & LDAP-Cache)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT, -- NULL für LDAP-only User
    role TEXT DEFAULT 'user', -- 'admin', 'user'
    groups TEXT DEFAULT '[]', -- JSON-Array lokaler Gruppen, z.B. ["Lehrer"]
    is_ldap INTEGER DEFAULT 0, -- 0 = lokal, 1 = LDAP
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabelle für Kacheln (Lobby-Dienste)
CREATE TABLE IF NOT EXISTS tiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT NOT NULL, -- z.B. 'fa-graduation-cap'
    link TEXT NOT NULL,
    visibility TEXT DEFAULT 'public', -- 'public', 'logged_in', 'groups'
    allowed_groups TEXT DEFAULT '[]', -- JSON-Array lokaler Gruppen
    sso_type TEXT DEFAULT 'none', -- 'none', 'query', 'jwt'
    sso_key TEXT, -- Signierschlüssel oder API-Key für SSO
    sort_order INTEGER DEFAULT 0
);

-- Tabelle für LDAP-Gruppen-Mappings
CREATE TABLE IF NOT EXISTS ldap_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ldap_group_dn TEXT UNIQUE NOT NULL, -- Voller Distinguished Name der LDAP-Gruppe
    local_group TEXT NOT NULL -- Zugeordnete lokale Gruppe (z.B. 'Lehrer')
);

-- Tabelle für Passwort-Rücksetzungen (nur lokale Benutzer)
CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabelle zur Nachverfolgung angewandter Migrationen
CREATE TABLE IF NOT EXISTS applied_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
