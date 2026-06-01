-- Tabelle für LDAP Passwort-Resets (Sicherheitstokens)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_dn TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    email_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    request_ip TEXT NULL,
    user_agent TEXT NULL
);

-- Indizes für schnelle Abfragen und Rate-Limiting
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email_time ON password_reset_tokens(email_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_ip_time ON password_reset_tokens(request_ip, created_at);
