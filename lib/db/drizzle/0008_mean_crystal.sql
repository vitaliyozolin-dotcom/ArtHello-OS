CREATE TABLE IF NOT EXISTS "crm_groups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "crm_id" text NOT NULL,
        "branch_crm_id" text,
        "name" text,
        "note" text,
        "b_date" text,
        "e_date" text,
        "capacity" integer,
        "teacher_crm_ids" jsonb,
        "raw" jsonb,
        "synced_at" timestamp with time zone DEFAULT now(),
        "lifecycle_status" text,
        "alpha_status" text,
        "raw_record_id" uuid,
        "source_payload_hash" text,
        "created_at_crm" timestamp with time zone,
        "updated_at_crm" timestamp with time zone,
        "inferred_subject_crm_id" text,
        "inferred_subject_name" text,
        "subject_inference_status" text,
        "subject_inference_confidence" numeric,
        CONSTRAINT "crm_groups_crm_id_unique" UNIQUE("crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_student_identities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "branch_id" text NOT NULL,
        "alpha_customer_id" text NOT NULL,
        "identity_type" text NOT NULL,
        "source" text NOT NULL,
        "student_id" uuid,
        "first_seen_lesson_date" date,
        "last_seen_lesson_date" date,
        "attendance_count" integer DEFAULT 0,
        "lesson_count" integer DEFAULT 0,
        "group_ids" jsonb,
        "subject_ids" jsonb,
        "teacher_ids" jsonb,
        "sample_lesson_alpha_ids" jsonb,
        "resolution_status" text DEFAULT 'unresolved' NOT NULL,
        "confidence" text DEFAULT 'medium' NOT NULL,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "crm_student_identities_uniq" UNIQUE("branch_id","alpha_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_duplicate_candidates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "branch_id" text DEFAULT '6' NOT NULL,
        "entity_type" text NOT NULL,
        "candidate_type" text NOT NULL,
        "entity_a_id" text NOT NULL,
        "entity_b_id" text NOT NULL,
        "confidence" numeric(4, 2) DEFAULT '0.5' NOT NULL,
        "reason" text,
        "source_fields" jsonb,
        "status" text DEFAULT 'open' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "resolved_at" timestamp with time zone,
        CONSTRAINT "alpha_dup_candidates_uniq" UNIQUE("entity_type","entity_a_id","entity_b_id","candidate_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_endpoint_registry" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "entity_key" text NOT NULL,
        "endpoint" text NOT NULL,
        "branch_id" text,
        "method" text DEFAULT 'POST',
        "request_body" jsonb,
        "status" text DEFAULT 'UNKNOWN',
        "http_status" integer,
        "records_fetched" integer,
        "pages_fetched" integer,
        "first_successful_page" integer,
        "last_successful_page" integer,
        "error_message" text,
        "response_sample" jsonb,
        "discovered_fields" jsonb,
        "last_checked_at" timestamp with time zone,
        "next_action" text,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "alpha_endpoint_registry_uniq" UNIQUE("entity_key","branch_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_linking_issues" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "sync_batch_id" uuid,
        "entity_type" text,
        "alpha_id" text,
        "raw_record_id" uuid,
        "issue_type" text,
        "issue_message" text,
        "missing_reference_type" text,
        "missing_reference_id" text,
        "severity" text DEFAULT 'warning',
        "suggested_action" text,
        "created_at" timestamp with time zone DEFAULT now(),
        "resolved_at" timestamp with time zone,
        "branch_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_raw_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "alpha_id" text,
        "entity_type" text NOT NULL,
        "endpoint" text,
        "branch_id" text,
        "source_payload" jsonb NOT NULL,
        "payload_hash" text,
        "sync_batch_id" uuid,
        "synced_at" timestamp with time zone DEFAULT now(),
        "sync_status" text DEFAULT 'raw',
        "is_deleted" boolean DEFAULT false,
        "is_archived" boolean DEFAULT false,
        "external_created_at" timestamp with time zone,
        "external_updated_at" timestamp with time zone,
        "page" integer,
        "period_from" date,
        "period_to" date,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "alpha_raw_records_uniq" UNIQUE("alpha_id","entity_type","branch_id","payload_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_sync_batches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "started_at" timestamp with time zone DEFAULT now(),
        "finished_at" timestamp with time zone,
        "status" text DEFAULT 'running',
        "mode" text DEFAULT 'discovery' NOT NULL,
        "from_date" date,
        "to_date" date,
        "branch_id" text,
        "entities_requested" integer DEFAULT 0,
        "entities_succeeded" integer DEFAULT 0,
        "entities_failed" integer DEFAULT 0,
        "endpoints_checked" integer DEFAULT 0,
        "total_fetched" integer DEFAULT 0,
        "total_saved" integer DEFAULT 0,
        "total_updated" integer DEFAULT 0,
        "total_skipped" integer DEFAULT 0,
        "total_errors" integer DEFAULT 0,
        "errors" jsonb,
        "duration_ms" integer,
        "triggered_by" text DEFAULT 'manual',
        "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_sync_scope" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "scope_name" text NOT NULL,
        "branch_id" text NOT NULL,
        "branch_name" text NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "reason" text,
        "created_by" text DEFAULT 'system',
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "alpha_sync_scope_scope_name_unique" UNIQUE("scope_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_verification_reports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "started_at" timestamp with time zone DEFAULT now() NOT NULL,
        "finished_at" timestamp with time zone,
        "status" text DEFAULT 'running' NOT NULL,
        "from_date" date,
        "to_date" date,
        "report" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evotor_connectors" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "publisher_token_enc" text,
        "publisher_token_last4" text,
        "publisher_token_saved_at" timestamp with time zone,
        "user_token_enc" text,
        "user_token_last4" text,
        "user_token_received_at" timestamp with time zone,
        "stores_count" integer DEFAULT 0,
        "devices_count" integer DEFAULT 0,
        "employees_count" integer DEFAULT 0,
        "documents_count" integer DEFAULT 0,
        "last_discovery_at" timestamp with time zone,
        "discovery_raw" jsonb,
        "readiness" text DEFAULT 'NOT_CONNECTED',
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evotor_raw_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "entity_type" text NOT NULL,
        "external_id" text,
        "batch_id" uuid,
        "raw" jsonb NOT NULL,
        "fetched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evotor_sync_batches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "entity_type" text NOT NULL,
        "status" text DEFAULT 'pending',
        "records_raw" integer DEFAULT 0,
        "records_saved" integer DEFAULT 0,
        "error_message" text,
        "started_at" timestamp with time zone DEFAULT now(),
        "finished_at" timestamp with time zone,
        "raw" jsonb
);
--> statement-breakpoint
-- Fix constraint name mismatches: migrate.ts created these with Postgres auto-names (_key),
-- but Drizzle schema expects explicit names (_unique / _uniq). Rename to match snapshot.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_groups_crm_id_key') THEN
    ALTER TABLE "crm_groups" RENAME CONSTRAINT "crm_groups_crm_id_key" TO "crm_groups_crm_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_student_identities_branch_id_alpha_customer_id_key') THEN
    ALTER TABLE "crm_student_identities" RENAME CONSTRAINT "crm_student_identities_branch_id_alpha_customer_id_key" TO "crm_student_identities_uniq";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_teachers_crm_id_key') THEN
    ALTER TABLE "crm_teachers" RENAME CONSTRAINT "crm_teachers_crm_id_key" TO "crm_teachers_crm_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_sources_raw_source_key') THEN
    ALTER TABLE "marketing_sources" RENAME CONSTRAINT "marketing_sources_raw_source_key" TO "marketing_sources_raw_source_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_external_id_key') THEN
    ALTER TABLE "bank_transactions" RENAME CONSTRAINT "bank_transactions_external_id_key" TO "bank_transactions_external_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raw_events_hash_key') THEN
    ALTER TABLE "raw_events" RENAME CONSTRAINT "raw_events_hash_key" TO "raw_events_hash_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'families_primary_guardian_person_id_key') THEN
    ALTER TABLE "families" RENAME CONSTRAINT "families_primary_guardian_person_id_key" TO "families_primary_guardian_person_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_profiles_student_crm_id_key') THEN
    ALTER TABLE "student_profiles" RENAME CONSTRAINT "student_profiles_student_crm_id_key" TO "student_profiles_student_crm_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_health_family_id_key') THEN
    ALTER TABLE "family_health" RENAME CONSTRAINT "family_health_family_id_key" TO "family_health_family_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_profiles_teacher_crm_id_key') THEN
    ALTER TABLE "staff_profiles" RENAME CONSTRAINT "staff_profiles_teacher_crm_id_key" TO "staff_profiles_teacher_crm_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_reserve_period_month_key') THEN
    ALTER TABLE "tax_reserve" RENAME CONSTRAINT "tax_reserve_period_month_key" TO "tax_reserve_period_month_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'month_closings_period_month_key') THEN
    ALTER TABLE "month_closings" RENAME CONSTRAINT "month_closings_period_month_key" TO "month_closings_period_month_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'directions_code_key') THEN
    ALTER TABLE "directions" RENAME CONSTRAINT "directions_code_key" TO "directions_code_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'educational_units_crm_group_id_key') THEN
    ALTER TABLE "educational_units" RENAME CONSTRAINT "educational_units_crm_group_id_key" TO "educational_units_crm_group_id_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'counterparties_canonical_key_key') THEN
    ALTER TABLE "counterparties" RENAME CONSTRAINT "counterparties_canonical_key_key" TO "counterparties_canonical_key_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_code_key') THEN
    ALTER TABLE "departments" RENAME CONSTRAINT "departments_code_key" TO "departments_code_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alpha_duplicate_candidates_entity_type_entity_a_id_entity_b_key') THEN
    ALTER TABLE "alpha_duplicate_candidates" RENAME CONSTRAINT "alpha_duplicate_candidates_entity_type_entity_a_id_entity_b_key" TO "alpha_dup_candidates_uniq";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alpha_endpoint_registry_entity_key_branch_id_key') THEN
    ALTER TABLE "alpha_endpoint_registry" RENAME CONSTRAINT "alpha_endpoint_registry_entity_key_branch_id_key" TO "alpha_endpoint_registry_uniq";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alpha_raw_records_alpha_id_entity_type_branch_id_payload_ha_key') THEN
    ALTER TABLE "alpha_raw_records" RENAME CONSTRAINT "alpha_raw_records_alpha_id_entity_type_branch_id_payload_ha_key" TO "alpha_raw_records_uniq";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alpha_sync_scope_scope_name_key') THEN
    ALTER TABLE "alpha_sync_scope" RENAME CONSTRAINT "alpha_sync_scope_scope_name_key" TO "alpha_sync_scope_scope_name_unique";
  END IF;
END $$;
