CREATE TABLE `read_model_publication_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`payload_digest` text NOT NULL,
	`expected_counts_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`committed_at` text
);
--> statement-breakpoint
CREATE INDEX `read_model_publication_status_idx` ON `read_model_publication_batches` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `read_model_staging_rows` (
	`batch_id` text NOT NULL,
	`dataset_name` text NOT NULL,
	`row_key` text NOT NULL,
	`row_json` text NOT NULL,
	PRIMARY KEY(`batch_id`, `dataset_name`, `row_key`)
);
--> statement-breakpoint
CREATE INDEX `read_model_staging_batch_idx` ON `read_model_staging_rows` (`batch_id`,`dataset_name`);