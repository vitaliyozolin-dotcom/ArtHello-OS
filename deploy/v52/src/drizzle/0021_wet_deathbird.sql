CREATE TABLE `access_sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`user_id` text NOT NULL,
	`system_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'Ожидает синхронизации' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`system_key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Активна' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_systems_key_unique` ON `app_systems` (`system_key`);--> statement-breakpoint
CREATE TABLE `user_system_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`system_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'Активен' NOT NULL,
	`access_version` integer DEFAULT 1 NOT NULL,
	`last_sync_status` text DEFAULT 'Не требуется' NOT NULL,
	`last_synced_at` text DEFAULT '' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_system_access_unique` ON `user_system_access` (`user_id`,`system_id`);--> statement-breakpoint
ALTER TABLE `app_users` ADD `access_version` integer DEFAULT 1 NOT NULL;