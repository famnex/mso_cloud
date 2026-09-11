-- Migration: 023_add_mediothek_and_user_indexes.sql
-- Optimiert die Verifizierungssuche und Schuelerabfragen auf O(1) Zugriffszeit

CREATE INDEX IF NOT EXISTS idx_student_profiles_mediothek ON student_profiles(mediothek_number);
CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON student_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_users_username_active ON users(username, is_active);
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email, is_active);
CREATE INDEX IF NOT EXISTS idx_users_active_role ON users(is_active, role);
