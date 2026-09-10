CREATE TABLE `complaint_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`complaint_id` text NOT NULL,
	`task_id` integer NOT NULL,
	`action_type` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`due_at` text NOT NULL,
	`result` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_complaints` (
	`id` text PRIMARY KEY NOT NULL,
	`family_entity_id` text NOT NULL,
	`child_entity_id` text NOT NULL,
	`service_entity_id` text NOT NULL,
	`channel` text NOT NULL,
	`received_at` text NOT NULL,
	`category` text NOT NULL,
	`summary` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer,
	`satisfaction_score` integer DEFAULT 0 NOT NULL,
	`closed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `readiness_scenario_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`step_order` integer NOT NULL,
	`step_name` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`check_type` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`checked_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `readiness_step_order_unique` ON `readiness_scenario_steps` (`scenario_id`,`step_order`);--> statement-breakpoint
CREATE TABLE `readiness_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`chain` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`status` text NOT NULL,
	`data_boundary` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`failure` text DEFAULT '' NOT NULL,
	`last_run_at` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `readiness_validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`suite` text NOT NULL,
	`environment` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`status` text NOT NULL,
	`passed` integer NOT NULL,
	`failed` integer NOT NULL,
	`skipped` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`artifact_ref` text NOT NULL,
	`initiated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recovery_drills` (
	`id` text PRIMARY KEY NOT NULL,
	`drill_type` text NOT NULL,
	`scope` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`status` text NOT NULL,
	`rpo_minutes` integer DEFAULT 0 NOT NULL,
	`rto_minutes` integer DEFAULT 0 NOT NULL,
	`checksum_before` text DEFAULT '' NOT NULL,
	`checksum_after` text DEFAULT '' NOT NULL,
	`evidence` text NOT NULL,
	`limitation` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `release_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`evidence` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`updated_at` text NOT NULL
);
