CREATE TABLE `accounting_completeness_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`required_types` text NOT NULL,
	`missing_types` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`from_document_id` text NOT NULL,
	`to_document_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`evidence` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`document_type` text NOT NULL,
	`number` text NOT NULL,
	`document_date` text NOT NULL,
	`counterparty_entity_id` text NOT NULL,
	`contract_id` text DEFAULT '' NOT NULL,
	`amount_minor` integer NOT NULL,
	`vat_minor` integer NOT NULL,
	`payment_operation_id` text DEFAULT '' NOT NULL,
	`file_ref` text DEFAULT '' NOT NULL,
	`signature_status` text NOT NULL,
	`edo_status` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`export_type` text NOT NULL,
	`period` text NOT NULL,
	`document_count` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`status` text NOT NULL,
	`file_ref` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`system` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`truth` text NOT NULL,
	`last_success_at` text DEFAULT '' NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`record_count` integer NOT NULL,
	`error` text DEFAULT '' NOT NULL
);
