DROP TRIGGER IF EXISTS alpha_raw_records_append_only ON alpha_raw_records;
DROP FUNCTION IF EXISTS prevent_alpha_raw_record_mutation();

ALTER TABLE IF EXISTS crm_attendance
  DROP CONSTRAINT IF EXISTS crm_attendance_lesson_student_uniq;
DROP INDEX IF EXISTS crm_attendance_scope_state_idx;

ALTER TABLE IF EXISTS crm_attendance
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  DROP COLUMN IF EXISTS raw_record_id,
  ALTER COLUMN student_crm_id DROP NOT NULL,
  ALTER COLUMN lesson_crm_id DROP NOT NULL;

ALTER TABLE IF EXISTS crm_branches
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  DROP COLUMN IF EXISTS raw_record_id;

ALTER TABLE IF EXISTS crm_groups
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  ALTER COLUMN raw_record_id DROP NOT NULL;

ALTER TABLE IF EXISTS crm_lessons
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  DROP COLUMN IF EXISTS raw_record_id;

ALTER TABLE IF EXISTS crm_payments
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  DROP COLUMN IF EXISTS raw_record_id;

ALTER TABLE IF EXISTS crm_students
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  DROP COLUMN IF EXISTS raw_record_id;

ALTER TABLE IF EXISTS crm_teachers
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  DROP COLUMN IF EXISTS raw_record_id;

ALTER TABLE IF EXISTS student_profiles
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  DROP COLUMN IF EXISTS raw_record_id;

ALTER TABLE IF EXISTS crm_change_log
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  ALTER COLUMN raw_record_id DROP NOT NULL;

ALTER TABLE IF EXISTS crm_customer_tariffs
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  ALTER COLUMN raw_record_id DROP NOT NULL;

ALTER TABLE IF EXISTS crm_group_memberships
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  ALTER COLUMN raw_record_id DROP NOT NULL;

ALTER TABLE IF EXISTS crm_leads
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  ALTER COLUMN raw_record_id DROP NOT NULL;

ALTER TABLE IF EXISTS crm_reference_records
  DROP COLUMN IF EXISTS stale_reason,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS record_state,
  DROP COLUMN IF EXISTS source_scope,
  DROP COLUMN IF EXISTS last_seen_batch_id,
  ALTER COLUMN raw_record_id DROP NOT NULL;

DROP TABLE IF EXISTS alpha_raw_observations;
DROP TABLE IF EXISTS alpha_sync_scope_runs;
