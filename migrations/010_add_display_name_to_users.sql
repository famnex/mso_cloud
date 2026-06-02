-- Migration: Fügt die Spalte display_name zur users-Tabelle hinzu
ALTER TABLE users ADD COLUMN display_name TEXT;
