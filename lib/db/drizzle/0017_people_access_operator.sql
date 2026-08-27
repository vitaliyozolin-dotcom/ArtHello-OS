ALTER TABLE "auth_users" ADD COLUMN "employee_id" uuid;
--> statement-breakpoint
ALTER TABLE "auth_users" ADD CONSTRAINT "auth_users_employee_id_employees_id_fk"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_employee_id_uniq" ON "auth_users" USING btree ("employee_id");
--> statement-breakpoint
CREATE TABLE "people_access_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL,
  "auth_user_id" uuid,
  "action" text NOT NULL,
  "plan_hash" text NOT NULL,
  "outcome" text NOT NULL,
  "requested_by_user_id" uuid NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "people_access_audit_action_check" CHECK ("action" IN ('PROVISION','UPDATE','OFFBOARD')),
  CONSTRAINT "people_access_audit_outcome_check" CHECK ("outcome" IN ('APPLIED','BLOCKED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "people_access_audit" ADD CONSTRAINT "people_access_audit_employee_id_employees_id_fk"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "people_access_audit" ADD CONSTRAINT "people_access_audit_auth_user_id_auth_users_id_fk"
  FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "people_access_audit" ADD CONSTRAINT "people_access_audit_requested_by_user_id_auth_users_id_fk"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "people_access_audit_employee_created_idx" ON "people_access_audit" USING btree ("employee_id", "created_at");
--> statement-breakpoint
CREATE INDEX "people_access_audit_auth_user_created_idx" ON "people_access_audit" USING btree ("auth_user_id", "created_at");