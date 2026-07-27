DO $$
DECLARE
  populated_table text;
  has_rows boolean;
BEGIN
  FOREACH populated_table IN ARRAY ARRAY[
    'crm_attendance',
    'crm_branches',
    'crm_groups',
    'crm_lessons',
    'crm_payments',
    'crm_students',
    'crm_teachers',
    'student_profiles',
    'crm_change_log',
    'crm_customer_tariffs',
    'crm_group_memberships',
    'crm_leads',
    'crm_reference_records'
  ]
  LOOP
    has_rows := false;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I)',
      populated_table
    ) INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION
        '0015 fail-closed: % contains rows without an exact raw observation',
        populated_table;
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE "alpha_raw_observations" DROP CONSTRAINT "alpha_raw_observations_batch_raw_uniq";--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_students" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_change_log" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD COLUMN "raw_observation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD CONSTRAINT "crm_attendance_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD CONSTRAINT "crm_branches_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD CONSTRAINT "crm_groups_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD CONSTRAINT "crm_lessons_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD CONSTRAINT "crm_payments_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_students" ADD CONSTRAINT "crm_students_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD CONSTRAINT "crm_teachers_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_change_log" ADD CONSTRAINT "crm_change_log_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD CONSTRAINT "crm_customer_tariffs_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD CONSTRAINT "crm_group_memberships_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD CONSTRAINT "crm_reference_records_raw_observation_id_alpha_raw_observations_id_fk" FOREIGN KEY ("raw_observation_id") REFERENCES "public"."alpha_raw_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_raw_observations" ADD CONSTRAINT "alpha_raw_observations_batch_raw_scope_page_uniq" UNIQUE("sync_batch_id","raw_record_id","scope_key","page");--> statement-breakpoint
ALTER TABLE "alpha_raw_observations" ADD CONSTRAINT "alpha_raw_observations_lineage_uniq" UNIQUE("id","sync_batch_id","raw_record_id","scope_key");--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD CONSTRAINT "crm_attendance_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD CONSTRAINT "crm_branches_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD CONSTRAINT "crm_groups_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD CONSTRAINT "crm_lessons_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD CONSTRAINT "crm_payments_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_students" ADD CONSTRAINT "crm_students_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD CONSTRAINT "crm_teachers_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_change_log" ADD CONSTRAINT "crm_change_log_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD CONSTRAINT "crm_customer_tariffs_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD CONSTRAINT "crm_group_memberships_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD CONSTRAINT "crm_reference_records_observation_lineage_fk" FOREIGN KEY ("raw_observation_id","last_seen_batch_id","raw_record_id","source_scope") REFERENCES "public"."alpha_raw_observations"("id","sync_batch_id","raw_record_id","scope_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER alpha_raw_records_no_truncate
BEFORE TRUNCATE ON alpha_raw_records
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_alpha_raw_record_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_alpha_raw_observation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'alpha_raw_observations is append-only; % is prohibited',
    TG_OP;
END
$$;
--> statement-breakpoint
CREATE TRIGGER alpha_raw_observations_append_only
BEFORE UPDATE OR DELETE ON alpha_raw_observations
FOR EACH ROW
EXECUTE FUNCTION prevent_alpha_raw_observation_mutation();
--> statement-breakpoint
CREATE TRIGGER alpha_raw_observations_no_truncate
BEFORE TRUNCATE ON alpha_raw_observations
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_alpha_raw_observation_mutation();
