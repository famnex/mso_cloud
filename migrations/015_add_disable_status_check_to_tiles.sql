-- Migration: Spalte disable_status_check zur tiles-Tabelle hinzufügen
ALTER TABLE tiles ADD COLUMN disable_status_check INTEGER DEFAULT 0;
