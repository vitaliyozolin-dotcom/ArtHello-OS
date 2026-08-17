DROP TRIGGER IF EXISTS alpha_raw_observations_no_truncate
  ON alpha_raw_observations;
DROP TRIGGER IF EXISTS alpha_raw_observations_append_only
  ON alpha_raw_observations;
DROP TRIGGER IF EXISTS alpha_raw_records_no_truncate
  ON alpha_raw_records;
DROP FUNCTION IF EXISTS prevent_alpha_raw_observation_mutation();

ALTER TABLE IF EXISTS crm_attendance
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_branches
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_groups
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_lessons
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_payments
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_students
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_teachers
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS student_profiles
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_change_log
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_customer_tariffs
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_group_memberships
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_leads
  DROP COLUMN IF EXISTS raw_observation_id;
ALTER TABLE IF EXISTS crm_reference_records
  DROP COLUMN IF EXISTS raw_observation_id;

ALTER TABLE IF EXISTS alpha_raw_observations
  DROP CONSTRAINT IF EXISTS alpha_raw_observations_lineage_uniq,
  DROP CONSTRAINT IF EXISTS alpha_raw_observations_batch_raw_scope_page_uniq,
  ADD CONSTRAINT alpha_raw_observations_batch_raw_uniq
    UNIQUE (sync_batch_id, raw_record_id);
