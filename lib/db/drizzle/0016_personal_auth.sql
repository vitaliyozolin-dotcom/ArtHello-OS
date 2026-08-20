CREATE TABLE "auth_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "login" text NOT NULL,
  "login_normalized" text NOT NULL,
  "display_name" text NOT NULL,
  "role" text NOT NULL,
  "password_hash" text NOT NULL,
  "scope_mode" text DEFAULT 'restricted' NOT NULL,
  "branch_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "legal_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "must_change_password" boolean DEFAULT true NOT NULL,
  "password_changed_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_users_role_check" CHECK ("role" IN ('owner', 'accountant', 'viewer')),
  CONSTRAINT "auth_users_scope_mode_check" CHECK ("scope_mode" IN ('unrestricted', 'restricted')),
  CONSTRAINT "auth_users_login_normalized_check" CHECK ("login_normalized" = lower(btrim("login_normalized")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_login_normalized_uniq" ON "auth_users" USING btree ("login_normalized");
--> statement-breakpoint
CREATE INDEX "auth_users_active_role_idx" ON "auth_users" USING btree ("is_active", "role");
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "auth_sessions" SET "revoked_at" = COALESCE("revoked_at", NOW());
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");