BEGIN;

UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW());
DROP INDEX IF EXISTS auth_sessions_user_id_idx;
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_user_id_auth_users_id_fk;
ALTER TABLE auth_sessions DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE auth_sessions DROP COLUMN IF EXISTS user_id;
DROP INDEX IF EXISTS auth_users_active_role_idx;
DROP INDEX IF EXISTS auth_users_login_normalized_uniq;
DROP TABLE IF EXISTS auth_users;

COMMIT;
