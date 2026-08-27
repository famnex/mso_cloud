-- Migration 020: Spalte asn zur proxycheck_cache Tabelle hinzufügen
ALTER TABLE proxycheck_cache ADD COLUMN asn TEXT;
