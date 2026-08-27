-- Migration 019: Spalte last_user zur proxycheck_cache Tabelle hinzufügen
ALTER TABLE proxycheck_cache ADD COLUMN last_user TEXT;
