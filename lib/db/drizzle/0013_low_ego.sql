CREATE TABLE "crm_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"crm_id" text NOT NULL,
	"entity_type" text,
	"entity_crm_id" text,
	"user_crm_id" text,
	"event" text,
	"occurred_at" timestamp with time zone,
	"fields_old" jsonb,
	"fields_new" jsonb,
	"fields_related" jsonb,
	"raw_record_id" uuid,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_change_log_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id")
);
--> statement-breakpoint
CREATE TABLE "crm_customer_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"crm_id" text NOT NULL,
	"customer_crm_id" text NOT NULL,
	"tariff_crm_id" text,
	"balance" numeric,
	"status" text,
	"valid_from" date,
	"valid_to" date,
	"raw_record_id" uuid,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_customer_tariffs_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id")
);
--> statement-breakpoint
CREATE TABLE "crm_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"crm_id" text NOT NULL,
	"full_name" text,
	"status" text,
	"pipeline_crm_id" text,
	"source_crm_id" text,
	"created_at_crm" timestamp with time zone,
	"raw_record_id" uuid,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_leads_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id")
);
--> statement-breakpoint
CREATE TABLE "crm_reference_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"reference_type" text NOT NULL,
	"crm_id" text NOT NULL,
	"name" text,
	"status" text,
	"parent_crm_id" text,
	"raw_record_id" uuid,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_reference_records_business_uniq" UNIQUE("branch_crm_id","reference_type","crm_id")
);
--> statement-breakpoint
CREATE INDEX "crm_change_log_occurred_idx" ON "crm_change_log" USING btree ("branch_crm_id","occurred_at");--> statement-breakpoint
CREATE INDEX "crm_change_log_entity_idx" ON "crm_change_log" USING btree ("branch_crm_id","entity_type","entity_crm_id");--> statement-breakpoint
CREATE INDEX "crm_customer_tariffs_customer_idx" ON "crm_customer_tariffs" USING btree ("branch_crm_id","customer_crm_id");--> statement-breakpoint
CREATE INDEX "crm_leads_status_idx" ON "crm_leads" USING btree ("branch_crm_id","status");--> statement-breakpoint
CREATE INDEX "crm_reference_records_type_idx" ON "crm_reference_records" USING btree ("reference_type","branch_crm_id");