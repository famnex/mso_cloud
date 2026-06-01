-- Tabelle für persistente System- und Sicherheits-Protokolle (Audit Log)
CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL, -- 'info', 'warn', 'error'
    action TEXT NOT NULL, -- z.B. 'login_failed', 'password_reset_requested', etc.
    message TEXT NOT NULL,
    details TEXT, -- JSON-kodierte Zusatzdetails
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index für schnelle Abfragen und Sortierung nach Zeit
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at DESC);
