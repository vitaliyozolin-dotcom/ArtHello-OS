CREATE TABLE `finance_accruals` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`contour` text NOT NULL,
	`subject_entity_id` text NOT NULL,
	`records_count` integer NOT NULL,
	`accrual_minor` integer NOT NULL,
	`paid_minor` integer NOT NULL,
	`debt_minor` integer NOT NULL,
	`debt_cases` integer NOT NULL,
	`source_file` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_ref` text NOT NULL,
	`data_quality` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`line` text NOT NULL,
	`plan_minor` integer NOT NULL,
	`scenario` text NOT NULL,
	`assumption` text NOT NULL,
	`source_type` text NOT NULL,
	`owner_entity_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` text NOT NULL,
	`field_name` text NOT NULL,
	`before_value` text NOT NULL,
	`after_value` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'Предложена' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_forecast_items` (
	`id` text PRIMARY KEY NOT NULL,
	`forecast_date` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`probability` integer NOT NULL,
	`category` text NOT NULL,
	`source_type` text NOT NULL,
	`assumption` text NOT NULL,
	`linked_entity_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_payroll_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`scope` text NOT NULL,
	`source_file` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_ref` text NOT NULL,
	`data_quality` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_reconciliation_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`source_a` text NOT NULL,
	`source_b` text NOT NULL,
	`difference_minor` integer NOT NULL,
	`owner_entity_id` text NOT NULL,
	`status` text DEFAULT 'Открыто' NOT NULL,
	`related_task_id` integer,
	`resolution` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `financial_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_date` text NOT NULL,
	`period` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`category` text NOT NULL,
	`report_class` text NOT NULL,
	`counterparty_entity_id` text DEFAULT '' NOT NULL,
	`contract_id` text DEFAULT '' NOT NULL,
	`document_id` text DEFAULT '' NOT NULL,
	`project_entity_id` text DEFAULT '' NOT NULL,
	`legal_entity_id` text DEFAULT '' NOT NULL,
	`object_entity_id` text DEFAULT '' NOT NULL,
	`cfr_entity_id` text DEFAULT '' NOT NULL,
	`bank_operation_ref` text DEFAULT '' NOT NULL,
	`operation_kind` text DEFAULT 'XLSX_AGGREGATE' NOT NULL,
	`source_system` text NOT NULL,
	`source_file` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_ref` text NOT NULL,
	`data_quality` text NOT NULL,
	`status` text DEFAULT 'Разнесено' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
