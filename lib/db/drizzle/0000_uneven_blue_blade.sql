CREATE TABLE IF NOT EXISTS "crm_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_crm_id" text,
	"student_crm_id" text,
	"status" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_id" text NOT NULL,
	"name" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "crm_branches_crm_id_unique" UNIQUE("crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_id" text NOT NULL,
	"branch_crm_id" text,
	"group_crm_id" text,
	"teacher_crm_id" text,
	"lesson_date" timestamp with time zone,
	"title" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "crm_lessons_crm_id_unique" UNIQUE("crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_id" text NOT NULL,
	"branch_crm_id" text,
	"student_crm_id" text,
	"amount" numeric,
	"payment_date" date,
	"type" text,
	"comment" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "crm_payments_crm_id_unique" UNIQUE("crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_id" text NOT NULL,
	"branch_crm_id" text,
	"full_name" text,
	"status" text,
	"phone" text,
	"email" text,
	"created_at_crm" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "crm_students_crm_id_unique" UNIQUE("crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_teachers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_id" text NOT NULL,
	"branch_crm_id" text,
	"full_name" text,
	"phone" text,
	"email" text,
	"status" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "crm_teachers_crm_id_unique" UNIQUE("crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_event_id" uuid,
	"normalized_event_id" uuid,
	"source_system" text NOT NULL,
	"external_id" text,
	"event_time" timestamp with time zone,
	"branch_name" text,
	"branch_crm_id" text,
	"channel" text,
	"source" text,
	"campaign" text,
	"client_name" text,
	"phone" text,
	"email" text,
	"message" text,
	"status" text,
	"manager" text,
	"raw" jsonb,
	"matched_student_crm_id" text,
	"matched_payment_crm_id" text,
	"duplicate_candidate" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" text DEFAULT 'google_sheets',
	"google_sheet_id" text,
	"sheet_name" text,
	"row_number" integer,
	"lead_date" date,
	"branch_name" text,
	"branch_crm_id" text,
	"channel" text,
	"source" text,
	"campaign" text,
	"lead_name" text,
	"phone" text,
	"message" text,
	"status" text,
	"manager" text,
	"comment" text,
	"duplicate_candidate" boolean DEFAULT false,
	"lead_event_id" uuid,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_source" text,
	"canonical_source" text,
	"canonical_channel" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "marketing_sources_raw_source_unique" UNIQUE("raw_source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"records_count" integer,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"raw_error" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid,
	"normalized_event_id" uuid,
	"hash" text,
	"source_system" text,
	"source_type" text DEFAULT 'csv_import',
	"external_id" text,
	"bank_connector_id" uuid,
	"synced_at" timestamp with time zone,
	"bank_name" text,
	"currency" text DEFAULT 'RUB',
	"account_name" text,
	"account_number" text,
	"operation_date" date,
	"posted_at" timestamp with time zone,
	"amount" numeric,
	"direction" text,
	"counterparty_name" text,
	"counterparty_inn" text,
	"purpose" text,
	"category_raw" text,
	"dds_category" text,
	"opiu_category" text,
	"management_category" text,
	"branch_name" text,
	"branch_crm_id" text,
	"is_transfer_between_own_accounts" boolean DEFAULT false,
	"is_capex" boolean DEFAULT false,
	"is_debt_body" boolean DEFAULT false,
	"is_debt_interest" boolean DEFAULT false,
	"is_tax" boolean DEFAULT false,
	"is_payroll" boolean DEFAULT false,
	"is_unclear" boolean DEFAULT false,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"matched_operation_id" text,
	"match_status" text DEFAULT 'unmatched',
	"match_type" text,
	"match_confidence" integer DEFAULT 0,
	"matched_at" timestamp with time zone,
	"is_ignored" boolean DEFAULT false,
	"matched_family_id" text,
	"matched_person_id" text,
	"matched_child_id" text,
	"matched_contract_id" text,
	"matched_invoice_id" text,
	"account_id" text,
	"masked_account" text,
	"booking_date_time" timestamp with time zone,
	"value_date_time" timestamp with time zone,
	"counterparty_account" text,
	"operation_type" text,
	"sync_run_id" uuid,
	"matched_contractor_id" text,
	"matched_employee_id" text,
	"matched_payroll_id" text,
	"is_internal_transfer" boolean DEFAULT false,
	"ignored_at" timestamp with time zone,
	"ignored_reason" text,
	"matched_by_user_id" text,
	"match_source" text,
	CONSTRAINT "bank_transactions_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_name" text,
	"priority" integer DEFAULT 100,
	"direction" text,
	"counterparty_contains" text[],
	"purpose_contains" text[],
	"amount_min" numeric,
	"amount_max" numeric,
	"dds_category" text,
	"opiu_category" text,
	"branch_crm_id" text,
	"flags" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contracts_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text,
	"counterparty_name" text,
	"obligation_type" text,
	"monthly_amount" numeric,
	"payment_day" integer,
	"start_date" date,
	"end_date" date,
	"opiu_category" text,
	"dds_category" text,
	"is_active" boolean DEFAULT true,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dds_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text,
	"group_name" text,
	"category" text,
	"subcategory" text,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dds_monthly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date,
	"branch_crm_id" text,
	"opening_balance" numeric,
	"income_total" numeric,
	"expense_total" numeric,
	"operating_cashflow" numeric,
	"investing_cashflow" numeric,
	"financing_cashflow" numeric,
	"closing_balance" numeric,
	"calculated_at" timestamp with time zone DEFAULT now(),
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manual_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date,
	"branch_crm_id" text,
	"type" text,
	"opiu_category" text,
	"amount" numeric,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opiu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text,
	"group_name" text,
	"category" text,
	"subcategory" text,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opiu_monthly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date,
	"branch_crm_id" text,
	"revenue_accrual" numeric,
	"revenue_cash" numeric,
	"cogs" numeric,
	"payroll" numeric,
	"rent" numeric,
	"marketing" numeric,
	"utilities" numeric,
	"taxes" numeric,
	"bank_fees" numeric,
	"services" numeric,
	"supplies" numeric,
	"finance_interest" numeric,
	"depreciation" numeric,
	"other_opex" numeric,
	"ebitda" numeric,
	"operating_profit" numeric,
	"net_profit" numeric,
	"calculated_at" timestamp with time zone DEFAULT now(),
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date,
	"branch_crm_id" text,
	"employee_name" text,
	"role" text,
	"amount_gross" numeric,
	"taxes" numeric,
	"amount_net" numeric,
	"source" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_name" text,
	"account_name" text,
	"branch_crm_id" text,
	"file_name" text,
	"format" text,
	"date_from" date,
	"date_to" date,
	"transaction_count" integer DEFAULT 0,
	"imported_at" timestamp with time zone DEFAULT now(),
	"imported_by" text DEFAULT 'owner',
	"notes" text,
	"rows_total" integer,
	"rows_imported" integer,
	"rows_skipped" integer,
	"rows_unclear" integer,
	"status" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_connector_id" uuid,
	"credential_type" text,
	"encrypted_payload" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "normalized_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_event_id" uuid,
	"event_type" text,
	"branch_crm_id" text,
	"client_name" text,
	"phone" text,
	"email" text,
	"channel" text,
	"source" text,
	"campaign" text,
	"message" text,
	"amount" numeric,
	"status" text,
	"matched_student_crm_id" text,
	"matched_payment_crm_id" text,
	"matched_bank_transaction_id" uuid,
	"confidence" numeric,
	"duplicate_candidate" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_connector_id" uuid,
	"source_system" text NOT NULL,
	"external_id" text,
	"event_type" text NOT NULL,
	"event_time" timestamp with time zone,
	"raw" jsonb,
	"hash" text,
	"processed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "raw_events_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_name" text NOT NULL,
	"source_type" text NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"config" jsonb,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_guardian_person_id" uuid,
	"family_name" text,
	"primary_phone" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "families_primary_guardian_person_id_unique" UNIQUE("primary_guardian_person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guardian_student_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_person_id" uuid NOT NULL,
	"student_person_id" uuid NOT NULL,
	"student_crm_id" text,
	"family_id" uuid,
	"relation_type" text DEFAULT 'guardian',
	"confidence" numeric,
	"source_system" text DEFAULT 'alphacrm',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity_match_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_event_id" uuid,
	"lead_event_id" uuid,
	"suggested_person_id" uuid,
	"match_reason" text,
	"confidence" numeric,
	"status" text DEFAULT 'new' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"contact_type" text NOT NULL,
	"contact_value" text NOT NULL,
	"normalized_value" text,
	"is_primary" boolean DEFAULT false,
	"source_system" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"source_system" text,
	"confidence" numeric,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"primary_phone" text,
	"primary_email" text,
	"confidence_score" numeric,
	"is_student" boolean DEFAULT false,
	"is_parent" boolean DEFAULT false,
	"is_lead" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_crm_id" text NOT NULL,
	"student_person_id" uuid,
	"family_id" uuid,
	"full_name" text,
	"dob" text,
	"branch_crm_id" text,
	"status" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "student_profiles_student_crm_id_unique" UNIQUE("student_crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"health_score" numeric DEFAULT '50',
	"payment_score" numeric DEFAULT '0',
	"attendance_score" numeric DEFAULT '0',
	"engagement_score" numeric DEFAULT '0',
	"churn_risk_score" numeric DEFAULT '0.5',
	"last_payment_at" timestamp with time zone,
	"last_attendance_at" timestamp with time zone,
	"missed_lessons_30d" integer DEFAULT 0,
	"overdue_amount" numeric DEFAULT '0',
	"active_students" integer DEFAULT 0,
	"inactive_students" integer DEFAULT 0,
	"calculated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "family_health_family_id_unique" UNIQUE("family_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"message" text,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid,
	"person_id" uuid,
	"student_person_id" uuid,
	"event_type" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"title" text,
	"description" text,
	"amount" numeric,
	"source_system" text,
	"related_entity_type" text,
	"related_entity_id" text,
	"severity" text DEFAULT 'info',
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_connector_id" uuid,
	"external_account_id" text,
	"account_name" text,
	"account_number" text,
	"currency" text DEFAULT 'RUB',
	"current_balance" numeric,
	"available_balance" numeric,
	"account_status" text,
	"masked_account" text,
	"branch_crm_id" text,
	"last_balance_sync_at" timestamp with time zone,
	"last_statement_sync_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_name" text NOT NULL,
	"display_name" text,
	"connector_status" text DEFAULT 'inactive',
	"auth_type" text,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"sync_frequency_minutes" integer DEFAULT 15,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_connector_id" uuid,
	"bank_account_id" uuid,
	"external_statement_id" text,
	"external_account_id" text,
	"period_from" text,
	"period_to" text,
	"status" text DEFAULT 'created',
	"requested_at" timestamp with time zone DEFAULT now(),
	"ready_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"transaction_count" integer DEFAULT 0,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_connector_id" uuid,
	"run_type" text DEFAULT 'transactions',
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running',
	"transactions_received" integer DEFAULT 0,
	"transactions_new" integer DEFAULT 0,
	"transactions_updated" integer DEFAULT 0,
	"transactions_duplicates" integer DEFAULT 0,
	"balances_updated" integer DEFAULT 0,
	"statements_requested" integer DEFAULT 0,
	"statements_saved" integer DEFAULT 0,
	"errors_count" integer DEFAULT 0,
	"duration_ms" integer,
	"error_message" text,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_transactions_raw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_connector_id" uuid,
	"sync_run_id" uuid,
	"external_transaction_id" text,
	"account_id" text,
	"amount" numeric,
	"currency" text DEFAULT 'RUB',
	"direction" text,
	"counterparty_name" text,
	"counterparty_inn" text,
	"purpose" text,
	"operation_date" text,
	"booking_date" text,
	"bank_status" text,
	"raw_json" jsonb,
	"normalized_status" text DEFAULT 'pending',
	"article_id" uuid,
	"contractor_id" uuid,
	"employee_id" uuid,
	"ai_classified_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"group_name" text NOT NULL,
	"sub_group" text,
	"type" text NOT NULL,
	"affects_dds" boolean DEFAULT true,
	"affects_pl" boolean DEFAULT true,
	"affects_ebitda" boolean DEFAULT false,
	"tax_deductible" boolean DEFAULT false,
	"is_fixed" boolean DEFAULT false,
	"is_operational" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now(),
	"changed_by" text DEFAULT 'system',
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_by" text DEFAULT 'system',
	"operation_type" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" text DEFAULT 'RUB',
	"description" text,
	"cashflow_date" timestamp with time zone NOT NULL,
	"accrual_date" timestamp with time zone,
	"cashflow_month" text NOT NULL,
	"pl_month" text NOT NULL,
	"article_id" uuid,
	"article_name" text,
	"article_code" text,
	"department" text,
	"project" text,
	"location" text,
	"counterparty_name" text,
	"counterparty_type" text,
	"family_id" uuid,
	"payment_status" text DEFAULT 'paid',
	"verification_status" text DEFAULT 'unverified',
	"trust_score" integer DEFAULT 50,
	"bank_transaction_id" text,
	"external_id" text,
	"document_refs" text,
	"notes" text,
	"is_test_data" boolean DEFAULT false,
	"is_deleted" boolean DEFAULT false,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_bonuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_crm_id" text NOT NULL,
	"period_month" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_crm_id" text NOT NULL,
	"period_month" text NOT NULL,
	"deduction_type" text DEFAULT 'other' NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'applied',
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_crm_id" text NOT NULL,
	"branch_crm_id" text,
	"period_month" text NOT NULL,
	"lessons_count" integer DEFAULT 0,
	"students_count" integer DEFAULT 0,
	"hours_count" numeric,
	"calculated_amount" numeric,
	"confirmed_amount" numeric,
	"status" text DEFAULT 'draft',
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_crm_id" text NOT NULL,
	"position" text,
	"department" text,
	"hire_date" date,
	"ndfl_rate" numeric(5, 4) DEFAULT '0.13',
	"pfr_rate" numeric(5, 4) DEFAULT '0.22',
	"fss_rate" numeric(5, 4) DEFAULT '0.029',
	"kpi_target" numeric,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "staff_profiles_teacher_crm_id_unique" UNIQUE("teacher_crm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_crm_id" text NOT NULL,
	"branch_crm_id" text,
	"rate_type" text DEFAULT 'per_lesson' NOT NULL,
	"rate_amount" numeric NOT NULL,
	"currency" text DEFAULT 'RUB',
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_vacations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_crm_id" text NOT NULL,
	"vacation_type" text DEFAULT 'annual',
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days_count" integer,
	"accrued_amount" numeric(15, 2),
	"paid_amount" numeric(15, 2),
	"status" text DEFAULT 'approved',
	"notes" text,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"accrual_date" date NOT NULL,
	"accrual_month" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending',
	"operation_id" uuid,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"accrual_id" uuid,
	"doc_type" text NOT NULL,
	"doc_number" text,
	"doc_date" date,
	"amount" numeric(15, 2),
	"status" text DEFAULT 'received',
	"notes" text,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"accrual_id" uuid,
	"amount" numeric(15, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"payment_month" text NOT NULL,
	"method" text DEFAULT 'bank',
	"operation_id" uuid,
	"notes" text,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"inn" text,
	"type" text,
	"tax_status" text,
	"payment_terms" text,
	"direction" text,
	"responsible" text,
	"trust_score" integer DEFAULT 50,
	"risk_level" text DEFAULT 'medium',
	"notes" text,
	"is_active" boolean DEFAULT true,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_type" text NOT NULL,
	"tax_name" text,
	"period_month" text NOT NULL,
	"due_date" date,
	"tax_base" numeric(15, 2),
	"tax_rate" numeric(6, 4),
	"accrued_amount" numeric(15, 2) NOT NULL,
	"paid_amount" numeric(15, 2) DEFAULT '0',
	"status" text DEFAULT 'accrued',
	"operation_id" uuid,
	"notes" text,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_reserve" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_month" text NOT NULL,
	"reserve_amount" numeric(15, 2) DEFAULT '0',
	"actual_tax_paid" numeric(15, 2) DEFAULT '0',
	"notes" text,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tax_reserve_period_month_unique" UNIQUE("period_month")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "month_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_month" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"snapshot_revenue" numeric(15, 2),
	"snapshot_expenses" numeric(15, 2),
	"snapshot_gross_profit" numeric(15, 2),
	"snapshot_margin" numeric(6, 4),
	"snapshot_operations_count" integer,
	"snapshot_trust_score" integer,
	"check_all_ops_verified" boolean DEFAULT false,
	"check_articles_covered" boolean DEFAULT false,
	"check_taxes_accrued" boolean DEFAULT false,
	"check_payroll_paid" boolean DEFAULT false,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"reopened_by" text,
	"reopened_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "month_closings_period_month_unique" UNIQUE("period_month")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text DEFAULT 'other' NOT NULL,
	"doc_number" text,
	"doc_date" date,
	"amount" numeric(15, 2),
	"file_name" text,
	"file_url" text,
	"status" text DEFAULT 'received',
	"linked_operation_id" uuid,
	"linked_contractor_id" uuid,
	"linked_period" text,
	"counterparty_name" text,
	"description" text,
	"ai_status" text DEFAULT 'pending',
	"ai_notes" text,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_type" text DEFAULT 'family' NOT NULL,
	"contract_number" text,
	"title" text,
	"status" text DEFAULT 'active',
	"start_date" date,
	"end_date" date,
	"signed_at" date,
	"auto_renewal" boolean DEFAULT false,
	"monthly_amount" numeric(15, 2),
	"total_amount" numeric(15, 2),
	"currency" text DEFAULT 'RUB',
	"payment_terms" text,
	"family_id" uuid,
	"person_id" uuid,
	"counterparty_id" uuid,
	"student_crm_id" text,
	"direction_id" uuid,
	"branch_crm_id" text,
	"file_url" text,
	"notes" text,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "class_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"direction_id" uuid,
	"program_id" uuid,
	"branch_crm_id" text,
	"teacher_crm_id" text,
	"level" text DEFAULT 'beginner',
	"max_students" integer DEFAULT 12,
	"current_students" integer DEFAULT 0,
	"schedule_info" text,
	"monthly_revenue" numeric(15, 2),
	"is_active" boolean DEFAULT true,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"color" text DEFAULT '#7c3aed',
	"description" text,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "directions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_crm_id" text NOT NULL,
	"class_group_id" uuid NOT NULL,
	"enrolled_at" date NOT NULL,
	"unenrolled_at" date,
	"status" text DEFAULT 'active',
	"contract_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"context_id" uuid,
	"context_type" text,
	"start_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"direction_id" uuid,
	"description" text,
	"duration_months" integer,
	"age_from" integer,
	"age_to" integer,
	"price_per_month" numeric(15, 2),
	"price_per_lesson" numeric(15, 2),
	"lessons_per_week" integer DEFAULT 2,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_crm_id" text NOT NULL,
	"class_group_id" uuid,
	"lesson_date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"duration_hours" numeric(4, 2) DEFAULT '1',
	"lesson_type" text DEFAULT 'regular',
	"rate_type" text DEFAULT 'per_lesson',
	"rate_amount" numeric(15, 2),
	"total_amount" numeric(15, 2),
	"direction_id" uuid,
	"branch_crm_id" text,
	"period_month" text,
	"students_count" integer DEFAULT 0,
	"status" text DEFAULT 'scheduled',
	"notes" text,
	"operation_id" uuid,
	"is_test_data" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "operation_history" ADD CONSTRAINT "operation_history_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_accruals" ADD CONSTRAINT "contractor_accruals_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_payments" ADD CONSTRAINT "contractor_payments_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsl_guardian_student_crm_idx" ON "guardian_student_links" USING btree ("guardian_person_id","student_crm_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "te_source_entity_idx" ON "timeline_events" USING btree ("source_system","related_entity_type","related_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_accounts_connector_extid" ON "bank_accounts" USING btree ("bank_connector_id","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_statements_connector_account_period" ON "bank_statements" USING btree ("bank_connector_id","external_account_id","period_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "op_history_op_idx" ON "operation_history" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_cashflow_month_idx" ON "operations" USING btree ("cashflow_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_pl_month_idx" ON "operations" USING btree ("pl_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_article_idx" ON "operations" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_source_idx" ON "operations" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_type_idx" ON "operations" USING btree ("operation_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_created_idx" ON "operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_direction_idx" ON "operations" USING btree ("direction");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_verification_idx" ON "operations" USING btree ("verification_status");