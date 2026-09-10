CREATE TABLE `legal_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`signal_type` text NOT NULL,
	`severity` text NOT NULL,
	`evidence` text NOT NULL,
	`recommendation` text NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer,
	`detected_at` text NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legal_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_document_id` text NOT NULL,
	`contract_type` text NOT NULL,
	`party_type` text NOT NULL,
	`party_entity_id` text NOT NULL,
	`number` text NOT NULL,
	`signed_status` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`limit_minor` integer NOT NULL,
	`spent_minor` integer NOT NULL,
	`status` text NOT NULL,
	`electronic_signature_status` text NOT NULL,
	`requisite_status` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`closing_required` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legal_document_items` (
	`id` text PRIMARY KEY NOT NULL,
	`stable_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`item_type` text NOT NULL,
	`title` text NOT NULL,
	`version` integer NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`signed_status` text NOT NULL,
	`status` text NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_document_stable_version_unique` ON `legal_document_items` (`stable_id`,`version`);--> statement-breakpoint
CREATE TABLE `legal_responsibility_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`zone` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
