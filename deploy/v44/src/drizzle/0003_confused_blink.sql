CREATE TABLE `document_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_unique` ON `document_versions` (`document_id`,`version`);--> statement-breakpoint
CREATE TABLE `escalations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'Открыта' NOT NULL,
	`recipient_entity_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `escalations_unique` ON `escalations` (`task_id`,`level`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_entity_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`status` text DEFAULT 'Новое' NOT NULL,
	`dedup_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`read_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedup_unique` ON `notifications` (`dedup_key`);--> statement-breakpoint
CREATE TABLE `obligations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`status` text DEFAULT 'Открыто' NOT NULL,
	`warning_days` integer DEFAULT 30 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `obligations_unique` ON `obligations` (`document_id`,`title`);--> statement-breakpoint
CREATE TABLE `task_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`step_name` text NOT NULL,
	`status` text DEFAULT 'Ожидает' NOT NULL,
	`decided_by` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_approvals_unique` ON `task_approvals` (`task_id`,`step_name`);--> statement-breakpoint
CREATE TABLE `task_checklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`title` text NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`document_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_documents_unique` ON `task_documents` (`task_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `task_watchers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`entity_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_watchers_unique` ON `task_watchers` (`task_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `workflow_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`document_type` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'Актуален' NOT NULL,
	`valid_until` text DEFAULT '' NOT NULL,
	`owner_entity_id` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignee_entity_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `parent_task_id` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `kind` text DEFAULT 'Задача' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `recurrence_rule` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `automation_key` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `requires_approval` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `result` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `result_evidence` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_automation_unique` ON `tasks` (`automation_key`);