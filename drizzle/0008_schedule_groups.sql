CREATE TABLE `schedule_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_year` text NOT NULL,
	`source_file_name` text NOT NULL,
	`source_sha256` text NOT NULL,
	`lesson_count` integer NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_imports_source_unique` ON `schedule_imports` (`source_sha256`);
--> statement-breakpoint
CREATE TABLE `schedule_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_year` text NOT NULL,
	`source_class_name` text NOT NULL,
	`student_label` text NOT NULL,
	`student_id` text,
	`subject_id` text NOT NULL,
	`target_class_name` text NOT NULL,
	`instruction` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_cell` text NOT NULL,
	`status` text DEFAULT 'pending_student_match' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `schedule_exceptions_status_idx` ON `schedule_exceptions` (`status`,`source_class_name`);
--> statement-breakpoint
ALTER TABLE `lessons` ADD `display_label` text;
--> statement-breakpoint
ALTER TABLE `lessons` ADD `group_name` text;
--> statement-breakpoint
ALTER TABLE `lessons` ADD `shared_session_key` text;
--> statement-breakpoint
ALTER TABLE `program_topic_sessions` ADD `topic_override` text;
--> statement-breakpoint
ALTER TABLE `program_topic_sessions` ADD `homework_override` text;
