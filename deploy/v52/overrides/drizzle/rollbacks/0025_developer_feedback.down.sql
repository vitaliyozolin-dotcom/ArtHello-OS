-- Destructive schema rollback: use only after a verified database backup/restore.
-- To roll back application code, retain the additive tables and their records instead.
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS developer_feedback_events;
DROP TABLE IF EXISTS developer_feedback;
COMMIT;
