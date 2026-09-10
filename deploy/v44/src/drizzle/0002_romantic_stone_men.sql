CREATE TABLE `entity_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`document_type` text NOT NULL,
	`status` text DEFAULT 'Актуален' NOT NULL,
	`valid_until` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entity_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_entity_id` text NOT NULL,
	`to_entity_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_links_unique` ON `entity_links` (`from_entity_id`,`to_entity_id`,`relation_type`);--> statement-breakpoint
CREATE TABLE `entity_merges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`survivor_id` text NOT NULL,
	`duplicate_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_merges_duplicate_unique` ON `entity_merges` (`duplicate_id`);