CREATE TABLE "fiscal_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text DEFAULT 'sale' NOT NULL,
	"status" text DEFAULT 'expected' NOT NULL,
	"provider_receipt_id" text,
	"receipt_url" text,
	"fiscal_profile_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error_code" text,
	"fiscalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_receipts_kind_check" CHECK ("fiscal_receipts"."kind" in ('sale', 'refund', 'correction')),
	CONSTRAINT "fiscal_receipts_status_check" CHECK ("fiscal_receipts"."status" in ('expected', 'pending', 'fiscalized', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"provider" text DEFAULT 'internal' NOT NULL,
	"event_identity" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_digest" text NOT NULL,
	"safe_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_provider_check" CHECK (length(trim("payment_events"."provider")) > 0),
	CONSTRAINT "payment_events_identity_check" CHECK (length(trim("payment_events"."event_identity")) > 0),
	CONSTRAINT "payment_events_type_check" CHECK (length(trim("payment_events"."event_type")) > 0),
	CONSTRAINT "payment_events_digest_check" CHECK (length(trim("payment_events"."payload_digest")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"family_id" uuid,
	"payer_person_id" uuid,
	"student_person_id" uuid,
	"student_crm_id" text,
	"contract_id" text,
	"invoice_external_id" text,
	"billing_period" date,
	"purpose" text NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"confirmed_paid_kopecks" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence_status" text DEFAULT 'unavailable' NOT NULL,
	"due_date" date,
	"payer_email" text,
	"payer_phone" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_obligations_amount_check" CHECK ("payment_obligations"."amount_kopecks" > 0),
	CONSTRAINT "payment_obligations_paid_check" CHECK ("payment_obligations"."confirmed_paid_kopecks" >= 0 and "payment_obligations"."confirmed_paid_kopecks" <= "payment_obligations"."amount_kopecks"),
	CONSTRAINT "payment_obligations_currency_check" CHECK ("payment_obligations"."currency" = 'RUB'),
	CONSTRAINT "payment_obligations_status_check" CHECK ("payment_obligations"."status" in ('open', 'partial', 'paid', 'cancelled', 'disputed', 'review_required')),
	CONSTRAINT "payment_obligations_evidence_check" CHECK ("payment_obligations"."evidence_status" in ('confirmed', 'ambiguous', 'unavailable')),
	CONSTRAINT "payment_obligations_purpose_check" CHECK (length(trim("payment_obligations"."purpose")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obligation_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payment_link_id" text NOT NULL,
	"public_token_hash" text,
	"provider_operation_id" text,
	"provider_payment_url" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"payer_contact_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fiscal_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_amount_check" CHECK ("payment_requests"."amount_kopecks" > 0),
	CONSTRAINT "payment_requests_currency_check" CHECK ("payment_requests"."currency" = 'RUB'),
	CONSTRAINT "payment_requests_status_check" CHECK ("payment_requests"."status" in ('ready', 'link_creating', 'waiting', 'authorized', 'paid', 'fiscalized', 'expired', 'cancelled', 'refund_pending', 'refunded', 'review_required', 'error')),
	CONSTRAINT "payment_requests_idempotency_key_check" CHECK (length(trim("payment_requests"."idempotency_key")) > 0),
	CONSTRAINT "payment_requests_link_id_check" CHECK (length(trim("payment_requests"."payment_link_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_crm_id" text NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"provider" text DEFAULT 'tochka' NOT NULL,
	"provider_customer_code" text NOT NULL,
	"merchant_id" text NOT NULL,
	"recipient_label" text NOT NULL,
	"fiscal_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fiscal_profile_status" text DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_routes_provider_check" CHECK ("payment_routes"."provider" = 'tochka'),
	CONSTRAINT "payment_routes_fiscal_status_check" CHECK ("payment_routes"."fiscal_profile_status" in ('draft', 'approved', 'disabled')),
	CONSTRAINT "payment_routes_customer_code_check" CHECK (length(trim("payment_routes"."provider_customer_code")) > 0),
	CONSTRAINT "payment_routes_merchant_id_check" CHECK (length(trim("payment_routes"."merchant_id")) > 0),
	CONSTRAINT "payment_routes_recipient_label_check" CHECK (length(trim("payment_routes"."recipient_label")) > 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_request_id_payment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_request_id_payment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_actor_user_id_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_payer_person_id_persons_id_fk" FOREIGN KEY ("payer_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_student_person_id_persons_id_fk" FOREIGN KEY ("student_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_created_by_user_id_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_obligation_id_payment_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_route_id_payment_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."payment_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_created_by_user_id_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_routes" ADD CONSTRAINT "payment_routes_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_routes" ADD CONSTRAINT "payment_routes_created_by_user_id_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_receipts_request_kind_uniq" ON "fiscal_receipts" USING btree ("request_id","kind");--> statement-breakpoint
CREATE INDEX "fiscal_receipts_status_idx" ON "fiscal_receipts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_identity_uniq" ON "payment_events" USING btree ("provider","event_identity");--> statement-breakpoint
CREATE INDEX "payment_events_request_created_idx" ON "payment_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_obligations_scope_status_idx" ON "payment_obligations" USING btree ("branch_crm_id","legal_entity_id","status");--> statement-breakpoint
CREATE INDEX "payment_obligations_family_idx" ON "payment_obligations" USING btree ("family_id","billing_period");--> statement-breakpoint
CREATE INDEX "payment_obligations_student_idx" ON "payment_obligations" USING btree ("student_crm_id","billing_period");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_obligations_source_ref_uniq" ON "payment_obligations" USING btree ("source","source_ref") WHERE "payment_obligations"."source_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_idempotency_key_uniq" ON "payment_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_payment_link_id_uniq" ON "payment_requests" USING btree ("payment_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_provider_operation_id_uniq" ON "payment_requests" USING btree ("provider_operation_id");--> statement-breakpoint
CREATE INDEX "payment_requests_obligation_status_idx" ON "payment_requests" USING btree ("obligation_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_routes_branch_legal_provider_merchant_uniq" ON "payment_routes" USING btree ("branch_crm_id","legal_entity_id","provider","merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_routes_active_scope_uniq" ON "payment_routes" USING btree ("branch_crm_id","legal_entity_id","provider") WHERE "payment_routes"."is_active" = true;--> statement-breakpoint
CREATE INDEX "payment_routes_scope_active_idx" ON "payment_routes" USING btree ("branch_crm_id","legal_entity_id","is_active");