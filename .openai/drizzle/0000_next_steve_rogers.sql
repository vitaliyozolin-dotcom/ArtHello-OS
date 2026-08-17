CREATE TABLE `alpha_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`record_state` text NOT NULL,
	`legal_entity_name` text,
	`legal_entity_status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alpha_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text,
	`branch_name` text,
	`name` text,
	`lifecycle_status` text,
	`record_state` text NOT NULL,
	`student_count` integer DEFAULT 0 NOT NULL,
	`lesson_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alpha_groups_name_idx` ON `alpha_groups` (`name`);--> statement-breakpoint
CREATE INDEX `alpha_groups_branch_idx` ON `alpha_groups` (`branch_id`);--> statement-breakpoint
CREATE TABLE `alpha_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text,
	`branch_name` text,
	`group_id` text,
	`group_name` text,
	`teacher_name` text,
	`lesson_date` text,
	`title` text,
	`record_state` text NOT NULL,
	`attendance_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alpha_lessons_date_idx` ON `alpha_lessons` (`lesson_date`);--> statement-breakpoint
CREATE INDEX `alpha_lessons_branch_idx` ON `alpha_lessons` (`branch_id`);--> statement-breakpoint
CREATE TABLE `alpha_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text,
	`branch_name` text,
	`student_id` text,
	`student_name` text,
	`amount` real,
	`payment_date` text,
	`payment_type` text,
	`record_state` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alpha_payments_date_idx` ON `alpha_payments` (`payment_date`);--> statement-breakpoint
CREATE INDEX `alpha_payments_branch_idx` ON `alpha_payments` (`branch_id`);--> statement-breakpoint
CREATE TABLE `alpha_students` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text,
	`branch_name` text,
	`full_name` text,
	`study_status` text,
	`record_state` text NOT NULL,
	`group_count` integer DEFAULT 0 NOT NULL,
	`payment_count` integer DEFAULT 0 NOT NULL,
	`lesson_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alpha_students_name_idx` ON `alpha_students` (`full_name`);--> statement-breakpoint
CREATE INDEX `alpha_students_branch_idx` ON `alpha_students` (`branch_id`);--> statement-breakpoint
CREATE INDEX `alpha_students_state_idx` ON `alpha_students` (`record_state`);--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`display_name` text,
	`masked_number` text NOT NULL,
	`currency` text NOT NULL,
	`current_balance` real,
	`balance_status` text NOT NULL,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_connector_idx` ON `bank_accounts` (`connector_id`);--> statement-breakpoint
CREATE TABLE `bank_connector_state` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`consent_id` text,
	`state_hash` text,
	`sealed_tokens` text,
	`token_expires_at` text,
	`last_synced_at` text,
	`last_error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employee_payroll_monthly` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`period_month` text NOT NULL,
	`accrued_amount` real DEFAULT 0 NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`accrual_rows` integer DEFAULT 0 NOT NULL,
	`payment_rows` integer DEFAULT 0 NOT NULL,
	`evidence_status` text NOT NULL,
	`legal_entity_name` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_payroll_monthly_employee_period_uniq` ON `employee_payroll_monthly` (`employee_id`,`period_month`,`legal_entity_name`);--> statement-breakpoint
CREATE INDEX `employee_payroll_monthly_period_idx` ON `employee_payroll_monthly` (`period_month`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`primary_role` text,
	`classification_status` text NOT NULL,
	`source_kind` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employees_name_idx` ON `employees` (`full_name`);--> statement-breakpoint
CREATE INDEX `employees_status_idx` ON `employees` (`classification_status`);--> statement-breakpoint
CREATE TABLE `family_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`left_student_id` text NOT NULL,
	`left_student_name` text,
	`right_student_id` text NOT NULL,
	`right_student_name` text,
	`branch_name` text,
	`confidence` real NOT NULL,
	`status` text NOT NULL,
	`reason_codes_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `family_candidates_status_idx` ON `family_candidates` (`status`);--> statement-breakpoint
CREATE TABLE `payroll_unresolved` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_label` text NOT NULL,
	`source_role` text,
	`period_month` text,
	`amount` real NOT NULL,
	`reason` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payroll_unresolved_source_idx` ON `payroll_unresolved` (`source_type`);--> statement-breakpoint
CREATE INDEX `payroll_unresolved_period_idx` ON `payroll_unresolved` (`period_month`);--> statement-breakpoint
CREATE TABLE `sync_status` (
	`source` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`data_mode` text NOT NULL,
	`last_synced_at` text,
	`counts_json` text DEFAULT '{}' NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
