-- Migration: Spalte is_active zur users-Tabelle hinzufügen
ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1;
