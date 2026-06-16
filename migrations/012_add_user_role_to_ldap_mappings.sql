-- Migration: Fügt die Spalte user_role zur ldap_mappings-Tabelle hinzu
ALTER TABLE ldap_mappings ADD COLUMN user_role TEXT;
