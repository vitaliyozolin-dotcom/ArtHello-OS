CREATE TABLE `food_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`purchase_request_id` text NOT NULL,
	`received_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`quantity` integer NOT NULL,
	`remaining_quantity` integer NOT NULL,
	`unit` text NOT NULL,
	`warehouse` text NOT NULL,
	`status` text NOT NULL,
	`quality_note` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`check_type` text NOT NULL,
	`object_entity_id` text NOT NULL,
	`checked_at` text NOT NULL,
	`result` text NOT NULL,
	`violation` text DEFAULT '' NOT NULL,
	`evidence` text NOT NULL,
	`status` text NOT NULL,
	`related_task_id` integer
);
--> statement-breakpoint
CREATE TABLE `food_production` (
	`id` text PRIMARY KEY NOT NULL,
	`production_date` text NOT NULL,
	`recipe_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`planned_portions` integer NOT NULL,
	`actual_portions` integer NOT NULL,
	`material_cost_minor` integer NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`supplier_id` text NOT NULL,
	`unit` text NOT NULL,
	`purchase_cost_minor` integer NOT NULL,
	`storage_norm` text NOT NULL,
	`status` text NOT NULL,
	`project_entity_id` text NOT NULL,
	`cfr_entity_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity_per_batch` integer NOT NULL,
	`unit` text NOT NULL,
	`cost_minor` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`dish_name` text NOT NULL,
	`version` integer NOT NULL,
	`yield_portions` integer NOT NULL,
	`standard_cost_minor` integer NOT NULL,
	`norm_description` text NOT NULL,
	`menu_date` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_entity_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`rate_minor` integer NOT NULL,
	`status` text NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`destination_object_id` text NOT NULL,
	`shipped_portions` integer NOT NULL,
	`consumed_portions` integer NOT NULL,
	`returned_portions` integer NOT NULL,
	`written_off_portions` integer NOT NULL,
	`revenue_minor` integer NOT NULL,
	`status` text NOT NULL,
	`document_id` text NOT NULL,
	`shipped_at` text NOT NULL
);
