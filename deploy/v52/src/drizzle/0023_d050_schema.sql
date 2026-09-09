CREATE TABLE IF NOT EXISTS `legal_contract_text_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`stable_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`document_item_id` text NOT NULL,
	`version` integer NOT NULL,
	`body_text` text NOT NULL,
	`source_mode` text NOT NULL,
	`model_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`protection_class` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `legal_contract_text_stable_version_unique` ON `legal_contract_text_versions` (`stable_id`,`version`);--> statement-breakpoint
ALTER TABLE `app_users` ADD `job_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `allowed_modules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `favorite_modules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `created_by_user_id` text DEFAULT '' NOT NULL;
