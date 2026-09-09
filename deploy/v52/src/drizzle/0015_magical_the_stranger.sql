CREATE TABLE `business_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`event_at` text NOT NULL,
	`location` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`budget_minor` integer NOT NULL,
	`actual_minor` integer NOT NULL,
	`status` text NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`feedback_score` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`participant_entity_id` text NOT NULL,
	`participant_role` text NOT NULL,
	`attendance_status` text NOT NULL,
	`feedback` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategy_deviations` (
	`id` text PRIMARY KEY NOT NULL,
	`kpi_id` text NOT NULL,
	`project_id` text NOT NULL,
	`deviation_type` text NOT NULL,
	`variance_value` integer NOT NULL,
	`explanation` text NOT NULL,
	`decision` text NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer,
	`detected_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategy_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`unit_entity_id` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`period` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`status` text NOT NULL,
	`success_definition` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategy_initiatives` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`kpi_id` text NOT NULL,
	`title` text NOT NULL,
	`hypothesis` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`planned_start` text NOT NULL,
	`planned_end` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategy_kpis` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`target_value` integer NOT NULL,
	`actual_value` integer NOT NULL,
	`forecast_value` integer NOT NULL,
	`variance_value` integer NOT NULL,
	`status` text NOT NULL,
	`source_ref` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategy_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`title` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`budget_id` text NOT NULL,
	`budget_plan_minor` integer NOT NULL,
	`budget_actual_minor` integer NOT NULL,
	`started_at` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategy_results` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event_id` text DEFAULT '' NOT NULL,
	`result_type` text NOT NULL,
	`metric_name` text NOT NULL,
	`metric_value` integer NOT NULL,
	`unit` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL
);
