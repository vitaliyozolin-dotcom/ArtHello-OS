DROP TRIGGER IF EXISTS front_office_audit_no_truncate
  ON front_office_audit_events;
DROP TRIGGER IF EXISTS front_office_audit_append_only
  ON front_office_audit_events;
DROP FUNCTION IF EXISTS prevent_front_office_audit_mutation();

DROP TABLE IF EXISTS front_office_tasks;
DROP TABLE IF EXISTS front_office_messages;
DROP TABLE IF EXISTS front_office_leads;
DROP TABLE IF EXISTS front_office_conversations;
DROP TABLE IF EXISTS front_office_audit_events;
