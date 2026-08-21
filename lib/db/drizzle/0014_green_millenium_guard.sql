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
    IF to_regclass('public.' || populated_table) IS NOT NULL THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I)',
        populated_table
      ) INTO has_rows;
    END IF;
    IF has_rows THEN
      RAISE EXCEPTION
        '0014 fail-closed: % contains rows without enforced raw/batch provenance',
        populated_table;
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE TABLE "alpha_raw_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_batch_id" uuid NOT NULL,
	"raw_record_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"branch_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"scope_key" text NOT NULL,
	"page" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alpha_raw_observations_batch_raw_uniq" UNIQUE("sync_batch_id","raw_record_id")
);
--> statement-breakpoint
CREATE TABLE "alpha_sync_scope_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_batch_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"branch_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"records_fetched" integer DEFAULT 0 NOT NULL,
	"safe_error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "alpha_sync_scope_runs_batch_scope_uniq" UNIQUE("sync_batch_id","scope_key")
);
--> statement-breakpoint
ALTER TABLE "crm_attendance" ALTER COLUMN "lesson_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ALTER COLUMN "student_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_groups" ALTER COLUMN "raw_record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_change_log" ALTER COLUMN "raw_record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ALTER COLUMN "raw_record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ALTER COLUMN "raw_record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_leads" ALTER COLUMN "raw_record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ALTER COLUMN "raw_record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "raw_record_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD COLUMN "raw_record_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD COLUMN "raw_record_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD COLUMN "raw_record_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_students" ADD COLUMN "raw_record_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_students" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_students" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_students" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_students" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_students" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD COLUMN "raw_record_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "raw_record_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_change_log" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_change_log" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD COLUMN "last_seen_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD COLUMN "source_scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD COLUMN "record_state" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "alpha_raw_observations" ADD CONSTRAINT "alpha_raw_observations_sync_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("sync_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_raw_observations" ADD CONSTRAINT "alpha_raw_observations_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_sync_scope_runs" ADD CONSTRAINT "alpha_sync_scope_runs_sync_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("sync_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alpha_raw_observations_batch_scope_idx" ON "alpha_raw_observations" USING btree ("sync_batch_id","scope_key");--> statement-breakpoint
CREATE INDEX "alpha_raw_observations_raw_idx" ON "alpha_raw_observations" USING btree ("raw_record_id");--> statement-breakpoint
CREATE INDEX "alpha_sync_scope_runs_status_idx" ON "alpha_sync_scope_runs" USING btree ("sync_batch_id","status");--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD CONSTRAINT "crm_attendance_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD CONSTRAINT "crm_attendance_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD CONSTRAINT "crm_branches_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_branches" ADD CONSTRAINT "crm_branches_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD CONSTRAINT "crm_groups_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_groups" ADD CONSTRAINT "crm_groups_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD CONSTRAINT "crm_lessons_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD CONSTRAINT "crm_lessons_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD CONSTRAINT "crm_payments_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_payments" ADD CONSTRAINT "crm_payments_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_students" ADD CONSTRAINT "crm_students_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_students" ADD CONSTRAINT "crm_students_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD CONSTRAINT "crm_teachers_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD CONSTRAINT "crm_teachers_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_change_log" ADD CONSTRAINT "crm_change_log_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_change_log" ADD CONSTRAINT "crm_change_log_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD CONSTRAINT "crm_customer_tariffs_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_customer_tariffs" ADD CONSTRAINT "crm_customer_tariffs_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD CONSTRAINT "crm_group_memberships_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_group_memberships" ADD CONSTRAINT "crm_group_memberships_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD CONSTRAINT "crm_reference_records_raw_record_id_alpha_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."alpha_raw_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reference_records" ADD CONSTRAINT "crm_reference_records_last_seen_batch_id_alpha_sync_batches_id_fk" FOREIGN KEY ("last_seen_batch_id") REFERENCES "public"."alpha_sync_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_attendance_scope_state_idx" ON "crm_attendance" USING btree ("source_scope","record_state");--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD CONSTRAINT "crm_attendance_lesson_student_uniq" UNIQUE("lesson_crm_id","student_crm_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_alpha_raw_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'alpha_raw_records is append-only; % is prohibited',
    TG_OP;
END
$$;
--> statement-breakpoint
CREATE TRIGGER alpha_raw_records_append_only
BEFORE UPDATE OR DELETE ON alpha_raw_records
FOR EACH ROW
EXECUTE FUNCTION prevent_alpha_raw_record_mutation();
