CREATE TABLE `client_accruals` (
	`id` text PRIMARY KEY NOT NULL,
	`family_entity_id` text NOT NULL,
	`child_entity_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`service_entity_id` text NOT NULL,
	`period` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text NOT NULL,
	`payment_operation_id` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'SYNTHETIC_TEST' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `client_bonuses` (
	`id` text PRIMARY KEY NOT NULL,
	`family_entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`points` integer NOT NULL,
	`reason` text NOT NULL,
	`related_contract_id` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `client_lifecycles` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`family_entity_id` text NOT NULL,
	`child_entity_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`service_entity_id` text NOT NULL,
	`accrual_id` text NOT NULL,
	`payment_operation_id` text DEFAULT '' NOT NULL,
	`service_start_date` text NOT NULL,
	`monthly_value_minor` integer NOT NULL,
	`ltv_minor` integer NOT NULL,
	`lifetime_months` integer NOT NULL,
	`next_payment_date` text NOT NULL,
	`next_payment_minor` integer NOT NULL,
	`churn_risk_score` integer NOT NULL,
	`churn_risk_band` text NOT NULL,
	`churn_risk_factors` text DEFAULT '[]' NOT NULL,
	`loyalty_tier` text NOT NULL,
	`repeat_offer` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Активен' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_lifecycles_lead_unique` ON `client_lifecycles` (`lead_id`);--> statement-breakpoint
CREATE TABLE `sales_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`first_click_at` text NOT NULL,
	`source` text NOT NULL,
	`utm_source` text DEFAULT '' NOT NULL,
	`utm_medium` text DEFAULT '' NOT NULL,
	`utm_campaign` text DEFAULT '' NOT NULL,
	`utm_content` text DEFAULT '' NOT NULL,
	`campaign_id` text DEFAULT '' NOT NULL,
	`creative_id` text DEFAULT '' NOT NULL,
	`offer_id` text DEFAULT '' NOT NULL,
	`form_id` text DEFAULT '' NOT NULL,
	`manager_entity_id` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'Заявка' NOT NULL,
	`status` text DEFAULT 'Активен' NOT NULL,
	`family_entity_id` text DEFAULT '' NOT NULL,
	`child_entity_id` text DEFAULT '' NOT NULL,
	`contract_id` text DEFAULT '' NOT NULL,
	`service_entity_id` text DEFAULT '' NOT NULL,
	`rejection_reason` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`data_quality` text DEFAULT 'Синтетические тестовые данные' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_stage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` text NOT NULL,
	`from_stage` text NOT NULL,
	`to_stage` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_touchpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`touchpoint_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`channel` text NOT NULL,
	`direction` text DEFAULT 'Входящий' NOT NULL,
	`summary` text NOT NULL,
	`outcome` text NOT NULL,
	`source_ref` text DEFAULT 'SYNTHETIC' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
