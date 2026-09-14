-- Migration 026: Refactoring von student_card_grants (Nullable user_id, dedizierte Indizes, PK auf id)

CREATE TABLE IF NOT EXISTS student_card_grants_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT UNIQUE NOT NULL,
  mediothek_number TEXT,
  last_ldap_success_at DATETIME,
  offline_valid_until DATETIME NOT NULL,
  school_year_expires_at DATETIME NOT NULL,
  is_revoked INTEGER DEFAULT 0,
  card_version TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bestehende valide Daten migrieren (nur wenn username nicht null ist und nicht korrumpiert durch Fake-ID 1001)
INSERT OR IGNORE INTO student_card_grants_new (
  user_id, username, mediothek_number, last_ldap_success_at,
  offline_valid_until, school_year_expires_at, is_revoked, card_version,
  created_at, updated_at
)
SELECT 
  CASE WHEN user_id = 1001 THEN NULL ELSE user_id END,
  username, mediothek_number, last_ldap_success_at,
  offline_valid_until, school_year_expires_at, is_revoked, card_version,
  created_at, updated_at
FROM student_card_grants
WHERE username IS NOT NULL AND username != '';

DROP TABLE IF EXISTS student_card_grants;

ALTER TABLE student_card_grants_new RENAME TO student_card_grants;

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_card_grants_username ON student_card_grants(username);
CREATE INDEX IF NOT EXISTS idx_student_card_grants_mediothek ON student_card_grants(mediothek_number);
CREATE INDEX IF NOT EXISTS idx_student_card_grants_user_id ON student_card_grants(user_id);
