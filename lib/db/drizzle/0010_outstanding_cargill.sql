CREATE TABLE "security_access_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_fingerprint" text NOT NULL,
	"role" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"decision" text NOT NULL,
	"policy" text NOT NULL,
	"branch_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legal_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_id" text
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "scope_mode" text DEFAULT 'restricted' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "branch_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "legal_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "auth_sessions"
SET "scope_mode" = 'unrestricted'
WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "auth_sessions"
SET "revoked_at" = COALESCE("revoked_at", NOW())
WHERE "role" <> 'owner';--> statement-breakpoint
CREATE INDEX "security_access_audit_occurred_at_idx" ON "security_access_audit" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "security_access_audit_session_idx" ON "security_access_audit" USING btree ("session_fingerprint");
