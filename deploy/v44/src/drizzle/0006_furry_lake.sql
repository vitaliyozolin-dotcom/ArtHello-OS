CREATE TABLE `content_attributions` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`click_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`payment_operation_id` text NOT NULL,
	`revenue_minor` integer NOT NULL,
	`attribution_model` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduled_at` text NOT NULL,
	`account_id` text NOT NULL,
	`author_entity_id` text NOT NULL,
	`format` text NOT NULL,
	`topic` text NOT NULL,
	`offer_id` text DEFAULT '' NOT NULL,
	`campaign_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Запланировано' NOT NULL,
	`brief` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_item_id` text NOT NULL,
	`published_at` text NOT NULL,
	`publication_ref` text NOT NULL,
	`reach` integer NOT NULL,
	`views` integer NOT NULL,
	`reactions` integer NOT NULL,
	`clicks` integer NOT NULL,
	`leads` integer NOT NULL,
	`contracts` integer NOT NULL,
	`revenue_minor` integer NOT NULL,
	`source_type` text DEFAULT 'SYNTHETIC_TEST' NOT NULL,
	`data_quality` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_publications_plan_unique` ON `content_publications` (`plan_item_id`);--> statement-breakpoint
CREATE TABLE `content_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text DEFAULT '' NOT NULL,
	`signal_type` text NOT NULL,
	`evidence` text NOT NULL,
	`recommendation` text NOT NULL,
	`status` text DEFAULT 'Новая' NOT NULL,
	`related_task_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marketing_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`audience_count` integer NOT NULL,
	`source_type` text DEFAULT 'SYNTHETIC_TEST' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
