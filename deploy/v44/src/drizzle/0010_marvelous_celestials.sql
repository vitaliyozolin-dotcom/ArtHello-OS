CREATE TABLE `asset_maintenance` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`maintenance_type` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`contractor_id` text NOT NULL,
	`status` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`document_id` text DEFAULT '' NOT NULL,
	`related_task_id` integer
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`object_entity_id` text NOT NULL,
	`assigned_to_entity_id` text DEFAULT '' NOT NULL,
	`warranty_until` text NOT NULL,
	`service_due` text NOT NULL,
	`status` text NOT NULL,
	`acquisition_date` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`monthly_depreciation_minor` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`event_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`from_location` text DEFAULT '' NOT NULL,
	`to_location` text DEFAULT '' NOT NULL,
	`document_id` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`warehouse` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost_minor` integer NOT NULL,
	`asset_id` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `procurement_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`delivered_at` text NOT NULL,
	`document_id` text NOT NULL,
	`status` text NOT NULL,
	`quantity` integer NOT NULL,
	`accepted_quantity` integer NOT NULL,
	`accepted_by` text NOT NULL,
	`quality_note` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `procurement_suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`specialization` text NOT NULL,
	`contract_id` text NOT NULL,
	`base_price_minor` integer NOT NULL,
	`quality_score` integer NOT NULL,
	`rating` integer NOT NULL,
	`market_index` integer NOT NULL,
	`status` text NOT NULL,
	`data_quality` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`order_number` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`status` text NOT NULL,
	`ordered_at` text NOT NULL,
	`expected_at` text NOT NULL,
	`contract_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_entity_id` text NOT NULL,
	`unit` text NOT NULL,
	`item_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`budget_minor` integer NOT NULL,
	`need_by` text NOT NULL,
	`status` text NOT NULL,
	`justification` text NOT NULL,
	`approver_entity_id` text DEFAULT '' NOT NULL,
	`approved_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `supplier_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`price_minor` integer NOT NULL,
	`delivery_days` integer NOT NULL,
	`warranty_months` integer NOT NULL,
	`quality_score` integer NOT NULL,
	`status` text NOT NULL,
	`comparison_note` text NOT NULL
);
