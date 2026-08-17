CREATE TABLE "branch_legal_entity_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"branch_name" text,
	"operating_unit_code" text NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"mapping_status" text DEFAULT 'pending_review' NOT NULL,
	"mapping_rule" text NOT NULL,
	"confirmation_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_legal_entity_assignments_branch_uniq" UNIQUE("branch_crm_id")
);
--> statement-breakpoint
CREATE TABLE "crm_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"group_crm_id" text NOT NULL,
	"student_crm_id" text NOT NULL,
	"external_membership_id" text,
	"status" text,
	"enrolled_at" date,
	"unenrolled_at" date,
	"raw_record_id" uuid,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_group_memberships_business_uniq" UNIQUE("branch_crm_id","group_crm_id","student_crm_id")
);
--> statement-breakpoint
CREATE TABLE "employee_external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid,
	"source_system" text NOT NULL,
	"external_id" text NOT NULL,
	"source_name" text,
	"source_role" text,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"match_confidence" numeric(5, 4),
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_external_identities_source_uniq" UNIQUE("source_system","external_id")
);
--> statement-breakpoint
CREATE TABLE "family_merge_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"left_student_crm_id" text NOT NULL,
	"right_student_crm_id" text NOT NULL,
	"branch_crm_id" text,
	"candidate_type" text NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_merge_candidates_pair_uniq" UNIQUE("left_student_crm_id","right_student_crm_id","candidate_type")
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text NOT NULL,
	"entity_type" text NOT NULL,
	"confirmation_source" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "operating_unit_legal_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operating_unit_code" text NOT NULL,
	"operating_unit_name" text NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"mapping_status" text DEFAULT 'owner_confirmed' NOT NULL,
	"confirmation_source" text NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operating_unit_legal_entity_code_uniq" UNIQUE("operating_unit_code")
);
--> statement-breakpoint
CREATE TABLE "payroll_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid,
	"employee_external_identity_id" uuid,
	"employee_id" uuid,
	"source_raw_record_id" uuid NOT NULL,
	"payment_date" date,
	"amount" numeric(15, 2) NOT NULL,
	"payment_kind" text,
	"status" text DEFAULT 'imported_unverified' NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payments_source_uniq" UNIQUE("source_raw_record_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_month" date NOT NULL,
	"legal_entity_id" uuid,
	"source_import_batch_id" uuid,
	"status" text DEFAULT 'imported_unverified' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_periods_source_uniq" UNIQUE("period_month","legal_entity_id","source_import_batch_id")
);
--> statement-breakpoint
CREATE TABLE "salary_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" uuid,
	"employee_external_identity_id" uuid,
	"employee_id" uuid,
	"source_raw_record_id" uuid NOT NULL,
	"component_key" text NOT NULL,
	"accrual_type" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" text DEFAULT 'imported_unverified' NOT NULL,
	"calculation_evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_accruals_source_component_uniq" UNIQUE("source_raw_record_id","component_key")
);
--> statement-breakpoint
CREATE TABLE "source_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" text NOT NULL,
	"source_external_id" text NOT NULL,
	"source_title" text,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"records_read" integer DEFAULT 0 NOT NULL,
	"records_saved" integer DEFAULT 0 NOT NULL,
	"records_rejected" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_import_batches_content_uniq" UNIQUE("source_system","source_external_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "source_raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_external_id" text NOT NULL,
	"record_type" text NOT NULL,
	"record_locator" text NOT NULL,
	"external_record_id" text,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"source_modified_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_raw_records_batch_locator_uniq" UNIQUE("import_batch_id","record_locator","payload_hash")
);
