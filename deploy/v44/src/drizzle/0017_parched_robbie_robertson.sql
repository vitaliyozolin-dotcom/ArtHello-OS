CREATE TABLE `ai_model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`ran_at` text NOT NULL,
	`model_version` text NOT NULL,
	`status` text NOT NULL,
	`input_snapshot_ref` text NOT NULL,
	`output_type` text NOT NULL,
	`output_summary` text NOT NULL,
	`confidence` integer NOT NULL,
	`cost_minor` integer NOT NULL,
	`explanation` text NOT NULL,
	`human_decision` text DEFAULT '' NOT NULL,
	`decided_by` text DEFAULT '' NOT NULL,
	`decision_at` text DEFAULT '' NOT NULL,
	`is_synthetic` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_opt_outs` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_ref` text NOT NULL,
	`requested_by` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`stops_processing_at` text NOT NULL,
	`historical_data_policy` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_process_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`input_data` text NOT NULL,
	`expected_result` text NOT NULL,
	`allowed_actions` text NOT NULL,
	`forbidden_actions` text NOT NULL,
	`human_owner` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`benefit_metric` text NOT NULL,
	`auto_stop_condition` text NOT NULL,
	`opt_out_allowed` integer DEFAULT true NOT NULL,
	`opt_out_procedure` text NOT NULL,
	`fallback_functionality` text NOT NULL,
	`stopped_data_processing` text NOT NULL,
	`historical_data_policy` text NOT NULL,
	`opt_out_impact` text NOT NULL,
	`status` text NOT NULL,
	`version` text NOT NULL,
	`source_refs` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_metric_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`definition` text NOT NULL,
	`formula` text NOT NULL,
	`unit` text NOT NULL,
	`grain` text NOT NULL,
	`source_tables` text NOT NULL,
	`source_quality` text NOT NULL,
	`freshness` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`target_value` integer,
	`sensitive` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`domain` text NOT NULL,
	`signal_type` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`evidence` text NOT NULL,
	`explanation` text NOT NULL,
	`recommendation` text NOT NULL,
	`source_refs` text NOT NULL,
	`confidence` integer NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer,
	`human_decision` text DEFAULT '' NOT NULL,
	`decision_evidence` text DEFAULT '' NOT NULL,
	`detected_at` text NOT NULL,
	`decided_at` text DEFAULT '' NOT NULL
);
