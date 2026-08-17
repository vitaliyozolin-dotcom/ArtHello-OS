-- Concurrent sandbox work created migrations after the Front Office branch
-- had already used index 0016. This additive convergence migration makes both
-- histories safe: databases that already ran Front Office remain unchanged,
-- while databases that ran the AlfaCRM branch first receive the missing
-- Front Office schema. It never removes or rewrites business data.
CREATE TABLE IF NOT EXISTS "front_office_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_role" text NOT NULL,
	"actor_display_name" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "front_office_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text DEFAULT 'ARTHELLO' NOT NULL,
	"external_key" text NOT NULL,
	"kind" text DEFAULT 'lead' NOT NULL,
	"channel" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'P3' NOT NULL,
	"contact_display_name" text NOT NULL,
	"contact_point_masked" text,
	"identity_status" text DEFAULT 'not_required' NOT NULL,
	"intent" text,
	"service" text,
	"branch_or_object" text,
	"owner_role" text,
	"owner_display_name" text,
	"source_lead_event_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"next_action_at" timestamp with time zone,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "front_office_conversations_arthello_only" CHECK ("project_id" = 'ARTHELLO'),
	CONSTRAINT "front_office_conversations_kind_check" CHECK ("kind" IN ('lead', 'support', 'incident')),
	CONSTRAINT "front_office_conversations_status_check" CHECK ("status" IN ('open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed')),
	CONSTRAINT "front_office_conversations_priority_check" CHECK ("priority" IN ('P0', 'P1', 'P2', 'P3', 'P4')),
	CONSTRAINT "front_office_conversations_identity_check" CHECK ("identity_status" IN ('not_required', 'verified', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "front_office_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"stage" text DEFAULT 'NEW' NOT NULL,
	"source" text,
	"campaign" text,
	"child_age_band" text,
	"branch_preference" text,
	"program_interest" text,
	"owner_display_name" text,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"trial_status" text DEFAULT 'not_requested' NOT NULL,
	"trial_at" timestamp with time zone,
	"loss_reason" text,
	"won_at" timestamp with time zone,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "front_office_leads_stage_check" CHECK ("stage" IN ('NEW', 'QUALIFIED', 'PROGRAM_MATCHED', 'TRIAL_REQUESTED', 'TRIAL_CONFIRMED', 'WON', 'LOST')),
	CONSTRAINT "front_office_leads_trial_status_check" CHECK ("trial_status" IN ('not_requested', 'requested', 'confirmed', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "front_office_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_type" text NOT NULL,
	"direction" text DEFAULT 'internal' NOT NULL,
	"body" text NOT NULL,
	"author_role" text,
	"author_display_name" text,
	"fact_status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "front_office_messages_type_check" CHECK ("message_type" IN ('incoming', 'internal_note', 'ai_draft', 'system')),
	CONSTRAINT "front_office_messages_direction_check" CHECK ("direction" IN ('incoming', 'internal')),
	CONSTRAINT "front_office_messages_fact_status_check" CHECK ("fact_status" IN ('VERIFIED', 'PARTIAL', 'UNVERIFIED', 'CONFLICT', 'STALE'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "front_office_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"lead_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"owner_role" text NOT NULL,
	"owner_display_name" text,
	"priority" text DEFAULT 'P3' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "front_office_tasks_status_check" CHECK ("status" IN ('open', 'done', 'cancelled')),
	CONSTRAINT "front_office_tasks_priority_check" CHECK ("priority" IN ('P0', 'P1', 'P2', 'P3', 'P4'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'front_office_leads_conversation_id_front_office_conversations_id_fk'
  ) THEN
    ALTER TABLE "front_office_leads"
      ADD CONSTRAINT "front_office_leads_conversation_id_front_office_conversations_id_fk"
      FOREIGN KEY ("conversation_id")
      REFERENCES "public"."front_office_conversations"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'front_office_messages_conversation_id_front_office_conversations_id_fk'
  ) THEN
    ALTER TABLE "front_office_messages"
      ADD CONSTRAINT "front_office_messages_conversation_id_front_office_conversations_id_fk"
      FOREIGN KEY ("conversation_id")
      REFERENCES "public"."front_office_conversations"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'front_office_tasks_conversation_id_front_office_conversations_id_fk'
  ) THEN
    ALTER TABLE "front_office_tasks"
      ADD CONSTRAINT "front_office_tasks_conversation_id_front_office_conversations_id_fk"
      FOREIGN KEY ("conversation_id")
      REFERENCES "public"."front_office_conversations"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'front_office_tasks_lead_id_front_office_leads_id_fk'
  ) THEN
    ALTER TABLE "front_office_tasks"
      ADD CONSTRAINT "front_office_tasks_lead_id_front_office_leads_id_fk"
      FOREIGN KEY ("lead_id")
      REFERENCES "public"."front_office_leads"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_audit_entity_idx"
  ON "front_office_audit_events" USING btree ("entity_type","entity_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_audit_created_idx"
  ON "front_office_audit_events" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "front_office_conversations_project_external_uniq"
  ON "front_office_conversations" USING btree ("project_id","external_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_conversations_queue_idx"
  ON "front_office_conversations" USING btree ("project_id","status","priority","last_message_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_conversations_owner_idx"
  ON "front_office_conversations" USING btree ("project_id","owner_display_name","next_action_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "front_office_leads_conversation_uniq"
  ON "front_office_leads" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_leads_stage_idx"
  ON "front_office_leads" USING btree ("stage","next_action_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_leads_owner_idx"
  ON "front_office_leads" USING btree ("owner_display_name","next_action_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_messages_conversation_idx"
  ON "front_office_messages" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_tasks_queue_idx"
  ON "front_office_tasks" USING btree ("status","due_at","priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "front_office_tasks_owner_idx"
  ON "front_office_tasks" USING btree ("owner_display_name","status","due_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_front_office_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'front_office_audit_events is append-only; % is prohibited',
    TG_OP;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'front_office_audit_append_only'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER front_office_audit_append_only
    BEFORE UPDATE OR DELETE ON front_office_audit_events
    FOR EACH ROW
    EXECUTE FUNCTION prevent_front_office_audit_mutation();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'front_office_audit_no_truncate'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER front_office_audit_no_truncate
    BEFORE TRUNCATE ON front_office_audit_events
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_front_office_audit_mutation();
  END IF;
END
$$;
