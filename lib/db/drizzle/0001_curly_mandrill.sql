ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "child_id" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "contractor_id" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "employee_id" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "contract_id" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "branch_id" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "group_id" text;