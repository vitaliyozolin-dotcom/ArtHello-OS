CREATE TABLE "employee_educational_unit_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"educational_unit_id" uuid NOT NULL,
	"crm_group_id" text,
	"teacher_crm_id" text,
	"role_in_unit" text DEFAULT 'unknown',
	"attribution_model" text,
	"is_primary" boolean DEFAULT false,
	"source" text DEFAULT 'inferred',
	"confidence" text DEFAULT 'low',
	"valid_from" date,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
