CREATE TABLE IF NOT EXISTS "recurring_obligations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "title" text NOT NULL,
        "counterparty_name" text,
        "type" text DEFAULT 'custom' NOT NULL,
        "dds_article_id" uuid,
        "expected_amount" numeric,
        "min_amount" numeric,
        "max_amount" numeric,
        "currency" text DEFAULT 'RUB',
        "frequency" text DEFAULT 'monthly' NOT NULL,
        "day_of_month" integer,
        "is_active" boolean DEFAULT true,
        "related_party" boolean DEFAULT false,
        "status" text DEFAULT 'suggested' NOT NULL,
        "detection_source" text DEFAULT 'ai_pattern',
        "confidence_score" integer,
        "last_detected_at" timestamp with time zone,
        "last_paid_at" date,
        "next_expected_date" date,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incoming_email_documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "sender" text,
        "subject" text,
        "received_at" timestamp with time zone,
        "attachment_count" integer DEFAULT 0,
        "status" text DEFAULT 'new',
        "linked_obligation_id" uuid,
        "raw_metadata" jsonb,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "obligation_documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "obligation_id" uuid,
        "source_type" text NOT NULL,
        "file_name" text,
        "file_url" text,
        "mime_type" text,
        "document_kind" text,
        "extracted_text" text,
        "parsed_json" jsonb,
        "parse_status" text DEFAULT 'not_parsed',
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payable_obligations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "source_type" text NOT NULL,
        "status" text DEFAULT 'draft' NOT NULL,
        "counterparty_name" text NOT NULL,
        "counterparty_id" uuid,
        "document_number" text,
        "document_date" date,
        "due_date" date,
        "service_period_from" date,
        "service_period_to" date,
        "amount_total" numeric(14, 2) NOT NULL,
        "amount_vat" numeric(14, 2),
        "currency" text DEFAULT 'RUB' NOT NULL,
        "dds_article_id" uuid,
        "opiu_article_id" uuid,
        "related_recurring_id" uuid,
        "linked_bank_transaction_id" uuid,
        "linked_operation_id" uuid,
        "branch_id" uuid,
        "facility_id" uuid,
        "legal_entity_id" uuid,
        "is_recurring_candidate" boolean DEFAULT false,
        "is_intercompany" boolean DEFAULT false,
        "description" text,
        "notes" text,
        "created_by" uuid,
        "approved_by" uuid,
        "approved_at" timestamp with time zone,
        "paid_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_transaction_counterparty_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "bank_transaction_id" text NOT NULL,
        "counterparty_id" uuid NOT NULL,
        "role" text DEFAULT 'unknown',
        "match_method" text DEFAULT 'inferred',
        "confidence" text DEFAULT 'low',
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counterparties" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "canonical_key" text,
        "display_name" text,
        "normalized_name" text,
        "inn" text,
        "kpp" text,
        "ogrn" text,
        "counterparty_type" text DEFAULT 'unknown',
        "counterparty_role" text DEFAULT 'unknown',
        "status" text DEFAULT 'needs_review',
        "confidence" text DEFAULT 'low',
        "source" text DEFAULT 'bank_transactions',
        "first_seen_at" date,
        "last_seen_at" date,
        "total_income" numeric(15, 2) DEFAULT '0',
        "total_expense" numeric(15, 2) DEFAULT '0',
        "operations_count" integer DEFAULT 0,
        "last_operation_id" text,
        "risk_flags" jsonb DEFAULT '{}'::jsonb,
        "notes" text,
        "finance_treatment_hint" text,
        "exclude_from_revenue_expense" boolean DEFAULT false,
        "needs_manual_review" boolean DEFAULT false,
        "reclassification_reason" text,
        "classification_version" text,
        "classification_updated_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "counterparties_canonical_key_unique" UNIQUE("canonical_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counterparty_aliases" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "counterparty_id" uuid NOT NULL,
        "alias_type" text NOT NULL,
        "alias_value" text NOT NULL,
        "source" text DEFAULT 'bank_transactions',
        "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counterparty_duplicate_candidates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "counterparty_a_id" uuid NOT NULL,
        "counterparty_b_id" uuid NOT NULL,
        "reason" text NOT NULL,
        "confidence" text DEFAULT 'medium',
        "severity" text DEFAULT 'medium',
        "status" text DEFAULT 'open',
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN IF NOT EXISTS "match_field" text;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN IF NOT EXISTS "match_type" text;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN IF NOT EXISTS "pattern" text;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN IF NOT EXISTS "match_direction" text DEFAULT 'any';--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN IF NOT EXISTS "suggested_article_id" uuid;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN IF NOT EXISTS "suggested_action" text;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN IF NOT EXISTS "confidence" integer DEFAULT 80;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_btcp_links_tx_cp_role" ON "bank_transaction_counterparty_links" USING btree ("bank_transaction_id","counterparty_id","role");