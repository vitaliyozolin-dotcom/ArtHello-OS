CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_type` text NOT NULL,
	`contact` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`is_administrative` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'Приглашён' NOT NULL,
	`invitation_status` text DEFAULT 'Ожидает активации' NOT NULL,
	`invited_by` text NOT NULL,
	`invited_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`activated_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_contact_unique` ON `app_users` (`contact`);--> statement-breakpoint
CREATE TABLE `manual_records` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`record_type` text NOT NULL,
	`title` text NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`amount_minor` integer DEFAULT 0 NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'Черновик' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organization_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'Филиал' NOT NULL,
	`status` text DEFAULT 'Активен' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_branch_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`access_level` text DEFAULT 'Работа' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_branch_access_unique` ON `user_branch_access` (`user_id`,`branch_id`);