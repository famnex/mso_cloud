-- Migration: 025_add_is_technik_scout_to_users.sql
-- Erweitert die Tabelle users um die Opt-In Kennzeichnung Technik Scout für den Schülerausweis

ALTER TABLE users ADD COLUMN is_technik_scout INTEGER NOT NULL DEFAULT 0;
