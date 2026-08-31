CREATE TABLE `academic_calendar_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_year` text NOT NULL,
	`kind` text DEFAULT 'vacation' NOT NULL,
	`title` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `program_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`file_name` text NOT NULL,
	`sheet_name` text NOT NULL,
	`imported_by_user_id` text NOT NULL,
	`row_count` integer NOT NULL,
	`required_hours` integer NOT NULL,
	`available_slots` integer NOT NULL,
	`scheduled_hours` integer NOT NULL,
	`unscheduled_hours` integer NOT NULL,
	`validation_status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `program_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`import_id` text NOT NULL,
	`source_row` integer NOT NULL,
	`sequence` text NOT NULL,
	`topic` text NOT NULL,
	`planned_hours` integer DEFAULT 1 NOT NULL,
	`homework` text DEFAULT '' NOT NULL,
	`source_date` text,
	`sort_order` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `program_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `program_topic_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`session_index` integer NOT NULL,
	`scheduled_date` text,
	`template_lesson_id` text,
	`starts_at` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `program_topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `academic_calendar_year_dates_idx` ON `academic_calendar_periods` (`academic_year`,`starts_on`,`ends_on`);
--> statement-breakpoint
CREATE INDEX `program_imports_program_idx` ON `program_imports` (`program_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `program_topics_program_order_idx` ON `program_topics` (`program_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `program_topic_sessions_topic_session_unique` ON `program_topic_sessions` (`topic_id`,`session_index`);
