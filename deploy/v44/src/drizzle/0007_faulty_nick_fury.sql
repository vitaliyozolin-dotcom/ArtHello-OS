CREATE TABLE `education_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`student_id` text NOT NULL,
	`attendance_status` text NOT NULL,
	`grade` text DEFAULT '' NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`recorded_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `education_attendance_lesson_student_unique` ON `education_attendance` (`lesson_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `education_communications` (
	`id` text PRIMARY KEY NOT NULL,
	`communication_type` text NOT NULL,
	`audience_type` text NOT NULL,
	`audience_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`event_at` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`family_entity_id` text NOT NULL,
	`program_id` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text NOT NULL,
	`recommendation` text NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit_entity_id` text NOT NULL,
	`program_id` text NOT NULL,
	`teacher_entity_id` text NOT NULL,
	`room` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`program_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`topic` text NOT NULL,
	`teacher_entity_id` text NOT NULL,
	`substitute_entity_id` text DEFAULT '' NOT NULL,
	`room` text NOT NULL,
	`status` text NOT NULL,
	`homework` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`author_entity_id` text NOT NULL,
	`methodist_entity_id` text NOT NULL,
	`scope` text NOT NULL,
	`material_ref` text NOT NULL,
	`expected_result` text NOT NULL,
	`source_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`program_id` text NOT NULL,
	`period` text NOT NULL,
	`metric` text NOT NULL,
	`score` integer NOT NULL,
	`trend` text NOT NULL,
	`evidence` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education_students` (
	`id` text PRIMARY KEY NOT NULL,
	`child_entity_id` text NOT NULL,
	`family_entity_id` text NOT NULL,
	`group_id` text NOT NULL,
	`cabinet_status` text NOT NULL,
	`status` text NOT NULL
);
