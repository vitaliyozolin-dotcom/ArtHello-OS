BEGIN;

DROP INDEX IF EXISTS people_access_audit_auth_user_created_idx;
DROP INDEX IF EXISTS people_access_audit_employee_created_idx;
DROP TABLE IF EXISTS people_access_audit;
DROP INDEX IF EXISTS auth_users_employee_id_uniq;
ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS auth_users_employee_id_employees_id_fk;
ALTER TABLE auth_users DROP COLUMN IF EXISTS employee_id;

COMMIT;
