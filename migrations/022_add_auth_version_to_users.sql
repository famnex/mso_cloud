-- Migration: 022_add_auth_version_to_users.sql
-- Ermoeglicht atomaren Sitzungswiderruf bei Rollenaenderung, Sperrung oder Passwortwechsel

ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;
