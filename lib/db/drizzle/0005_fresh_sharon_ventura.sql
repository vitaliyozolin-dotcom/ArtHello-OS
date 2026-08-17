ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "employee_kind" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "employee_type" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "classification_status" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "classification_reason" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "directions" jsonb;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "exclude_from_staff_analytics" boolean DEFAULT false;