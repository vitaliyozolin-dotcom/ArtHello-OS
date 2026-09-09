CREATE TABLE `hr_accesses` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`system` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`granted_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL,
	`revocation_reason` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_access_employee_system_unique` ON `hr_accesses` (`employee_id`,`system`);--> statement-breakpoint
CREATE TABLE `hr_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`vacancy_id` text NOT NULL,
	`source` text NOT NULL,
	`stage` text NOT NULL,
	`score` integer NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`rejection_reason` text DEFAULT '' NOT NULL,
	`offer_status` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hr_development` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`event_date` text NOT NULL,
	`score` integer NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hr_employees` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`position_id` text NOT NULL,
	`unit` text NOT NULL,
	`rate_minor` integer NOT NULL,
	`hire_date` text NOT NULL,
	`status` text NOT NULL,
	`termination_date` text DEFAULT '' NOT NULL,
	`termination_reason` text DEFAULT '' NOT NULL,
	`access_status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hr_interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`interviewer_entity_id` text NOT NULL,
	`score` integer NOT NULL,
	`summary` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hr_onboarding` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`step` text NOT NULL,
	`status` text NOT NULL,
	`due_date` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`related_task_id` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hr_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`event_type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reason` text NOT NULL,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hr_vacancies` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`unit` text NOT NULL,
	`position_id` text NOT NULL,
	`headcount` integer NOT NULL,
	`status` text NOT NULL,
	`source_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
