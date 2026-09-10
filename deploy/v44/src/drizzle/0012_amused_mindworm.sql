CREATE TABLE `safety_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`object_entity_id` text NOT NULL,
	`check_type` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`checked_at` text DEFAULT '' NOT NULL,
	`result` text NOT NULL,
	`evidence` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `safety_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`name` text NOT NULL,
	`inventory_number` text NOT NULL,
	`location` text NOT NULL,
	`contractor_id` text NOT NULL,
	`criticality` text NOT NULL,
	`next_check_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `safety_faults` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`severity` text NOT NULL,
	`description` text NOT NULL,
	`detected_at` text NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer
);
--> statement-breakpoint
CREATE TABLE `safety_guard_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`object_entity_id` text NOT NULL,
	`employee_entity_id` text NOT NULL,
	`post` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`journal_ref` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `safety_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`object_entity_id` text NOT NULL,
	`system_id` text NOT NULL,
	`happened_at` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`description` text NOT NULL,
	`response` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `safety_next_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`source_repair_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`check_type` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `safety_repairs` (
	`id` text PRIMARY KEY NOT NULL,
	`fault_id` text NOT NULL,
	`contractor_id` text NOT NULL,
	`action_type` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`result` text NOT NULL,
	`act_document_id` text DEFAULT '' NOT NULL,
	`cost_minor` integer NOT NULL,
	`payment_operation_id` text DEFAULT '' NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `safety_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`system_type` text NOT NULL,
	`name` text NOT NULL,
	`object_entity_id` text NOT NULL,
	`scheme_ref` text NOT NULL,
	`journal_ref` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`status` text NOT NULL,
	`source_type` text NOT NULL
);
