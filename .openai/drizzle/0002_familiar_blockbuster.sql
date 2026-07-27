CREATE TABLE `alpha_teacher_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`branch_name` text,
	`teacher_id` text,
	`teacher_name` text,
	`rate_amount` real,
	`rate_type` text,
	`valid_from` text,
	`valid_to` text,
	`conditions_json` text DEFAULT '{}' NOT NULL,
	`evidence_status` text NOT NULL,
	`record_state` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alpha_teacher_rates_teacher_idx` ON `alpha_teacher_rates` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `alpha_teacher_rates_branch_idx` ON `alpha_teacher_rates` (`branch_id`);--> statement-breakpoint
CREATE TABLE `alpha_teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text,
	`branch_name` text,
	`full_name` text,
	`teacher_status` text,
	`record_state` text NOT NULL,
	`lesson_count` integer DEFAULT 0 NOT NULL,
	`rate_rule_count` integer DEFAULT 0 NOT NULL,
	`working_hour_rule_count` integer DEFAULT 0 NOT NULL,
	`payroll_employee_id_candidate` text,
	`payroll_match_status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alpha_teachers_name_idx` ON `alpha_teachers` (`full_name`);--> statement-breakpoint
CREATE INDEX `alpha_teachers_branch_idx` ON `alpha_teachers` (`branch_id`);--> statement-breakpoint
CREATE INDEX `alpha_teachers_match_idx` ON `alpha_teachers` (`payroll_match_status`);--> statement-breakpoint
CREATE TABLE `employee_payroll_components` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`period_month` text NOT NULL,
	`legal_entity_name` text,
	`component_key` text NOT NULL,
	`source_label` text NOT NULL,
	`amount` real NOT NULL,
	`quantity` real,
	`source_sheet` text,
	`formula_present` integer DEFAULT 0 NOT NULL,
	`evidence_status` text NOT NULL,
	`rule_activated` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employee_payroll_components_employee_idx` ON `employee_payroll_components` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employee_payroll_components_period_idx` ON `employee_payroll_components` (`period_month`);--> statement-breakpoint
CREATE TABLE `employee_payroll_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`period_month` text,
	`legal_entity_name` text,
	`payment_date` text,
	`amount` real NOT NULL,
	`payment_kind` text,
	`evidence_status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employee_payroll_payments_employee_idx` ON `employee_payroll_payments` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employee_payroll_payments_period_idx` ON `employee_payroll_payments` (`period_month`);--> statement-breakpoint
ALTER TABLE `alpha_groups` ADD `unit_kind` text DEFAULT 'group_or_unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE `alpha_groups` ADD `classification_status` text DEFAULT 'not_explicit' NOT NULL;--> statement-breakpoint
ALTER TABLE `alpha_lessons` ADD `lesson_type_name` text;--> statement-breakpoint
ALTER TABLE `alpha_lessons` ADD `subject_name` text;--> statement-breakpoint
ALTER TABLE `alpha_lessons` ADD `lesson_category` text DEFAULT 'base_or_unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE `alpha_lessons` ADD `classification_status` text DEFAULT 'not_explicit' NOT NULL;