-- Migration: Fügt die Spalte dn zur users-Tabelle hinzu
ALTER TABLE users ADD COLUMN dn TEXT;
