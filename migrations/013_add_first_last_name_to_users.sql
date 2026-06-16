-- Migration: Fügt die Spalten first_name und last_name zur users-Tabelle hinzu
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
