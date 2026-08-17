CREATE TABLE "educational_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_group_id" text,
	"name" text NOT NULL,
	"educational_unit_type" text,
	"department" text,
	"attribution_model" text,
	"revenue_model" text,
	"is_active" boolean DEFAULT true,
	"classification_status" text DEFAULT 'classified',
	"classification_reason" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "educational_units_crm_group_id_unique" UNIQUE("crm_group_id")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "attribution_model" text;