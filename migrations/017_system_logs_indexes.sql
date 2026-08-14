-- Zusätzliche Indizes für schnelle gefilterte Log-Abfragen (Level + Zeit + Suche)
CREATE INDEX IF NOT EXISTS idx_system_logs_level_id ON system_logs(level, id DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action);
