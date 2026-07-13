-- Migration: Spalte open_in_new_tab zur tiles-Tabelle hinzufügen
ALTER TABLE tiles ADD COLUMN open_in_new_tab INTEGER DEFAULT 0;
