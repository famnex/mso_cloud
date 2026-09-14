-- Migration 024: Persistente Schülerausweis-Freigaben und Ausfallpuffer (student_card_grants)

CREATE TABLE IF NOT EXISTS student_card_grants (
  user_id INTEGER PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_student_card_grants_username ON student_card_grants(username);
CREATE INDEX IF NOT EXISTS idx_student_card_grants_mediothek ON student_card_grants(mediothek_number);
