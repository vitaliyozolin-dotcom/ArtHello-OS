CREATE TABLE `integration_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_record_id` text NOT NULL,
	`internal_entity_id` text DEFAULT '' NOT NULL,
	`conflict_type` text NOT NULL,
	`field_name` text NOT NULL,
	`source_value` text NOT NULL,
	`target_value` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`status` text NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`related_task_id` integer,
	`detected_at` text NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`system` text NOT NULL,
	`category` text NOT NULL,
	`target_module` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`source_of_truth` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`auth_status` text NOT NULL,
	`credential_expires_at` text DEFAULT '' NOT NULL,
	`last_success_at` text DEFAULT '' NOT NULL,
	`next_sync_at` text DEFAULT '' NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	`impact` text NOT NULL,
	`adapter_version` text NOT NULL,
	`verified_transfer` integer DEFAULT false NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_log_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`level` text NOT NULL,
	`event` text NOT NULL,
	`message` text NOT NULL,
	`record_ref` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text DEFAULT '' NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	`checkpoint` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`initiated_by` text NOT NULL,
	`correlation_id` text NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_runs_correlation_unique` ON `integration_sync_runs` (`correlation_id`);