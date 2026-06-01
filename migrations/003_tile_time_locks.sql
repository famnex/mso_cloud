-- Migration 003: Zeitsperren für Kacheln hinzufügen
ALTER TABLE tiles ADD COLUMN time_limit_enabled INTEGER DEFAULT 0;
ALTER TABLE tiles ADD COLUMN time_limit_start TEXT DEFAULT '08:00';
ALTER TABLE tiles ADD COLUMN time_limit_end TEXT DEFAULT '16:00';
