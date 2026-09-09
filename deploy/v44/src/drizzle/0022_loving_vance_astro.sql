CREATE TABLE `family_system_access` (
	`id` text PRIMARY KEY NOT NULL,
	`family_entity_id` text NOT NULL,
	`principal_entity_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`system_id` text NOT NULL,
	`role` text NOT NULL,
	`login_type` text NOT NULL,
	`login` text NOT NULL,
	`delivery_channel` text NOT NULL,
	`delivery_status` text DEFAULT 'Ожидает отправки' NOT NULL,
	`status` text DEFAULT 'Активен' NOT NULL,
	`access_version` integer DEFAULT 1 NOT NULL,
	`last_sync_status` text DEFAULT 'Ожидает синхронизации' NOT NULL,
	`last_synced_at` text DEFAULT '' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_system_access_principal_unique` ON `family_system_access` (`principal_entity_id`,`system_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `family_system_access_login_unique` ON `family_system_access` (`login`,`system_id`);