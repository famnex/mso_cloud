-- Migration 027: Invalidate legacy and incomplete grants to require fresh live verification
UPDATE student_card_grants
SET is_revoked = 1, updated_at = CURRENT_TIMESTAMP
WHERE is_revoked = 0 AND (
  card_version IS NULL
  OR last_ldap_success_at IS NULL
  OR offline_valid_until IS NULL
  OR school_year_expires_at IS NULL
  OR username IS NULL
  OR TRIM(username) = ''
);
