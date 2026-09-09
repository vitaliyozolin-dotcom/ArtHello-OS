CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'Активна' NOT NULL,
	`source_system` text NOT NULL,
	`source_record_id` text NOT NULL,
	`data_quality` text DEFAULT 'Тестовые данные' NOT NULL,
	`scope` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_source_unique` ON `entities` (`entity_type`,`source_system`,`source_record_id`);