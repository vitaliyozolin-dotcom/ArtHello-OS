-- Sandbox rollback companion only. Do not run against production without
-- an approved backup, restore proof, and maintenance window.
-- Irreversible session effect: migration 0010 revokes existing non-owner
-- sessions. Dropping the scope columns cannot restore those sessions; every
-- affected accountant/viewer must authenticate again after rollback.
DROP TABLE IF EXISTS "security_access_audit";
ALTER TABLE "auth_sessions"
  DROP COLUMN IF EXISTS "legal_entity_ids",
  DROP COLUMN IF EXISTS "branch_ids",
  DROP COLUMN IF EXISTS "scope_mode";
