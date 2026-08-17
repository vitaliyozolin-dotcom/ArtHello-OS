ALTER TABLE `read_model_publication_batches` ADD `expected_digests_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `read_model_publication_batches` ADD `computed_digest` text;