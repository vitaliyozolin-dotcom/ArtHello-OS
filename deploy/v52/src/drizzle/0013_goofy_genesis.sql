CREATE TABLE `medical_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_type` text NOT NULL,
	`principal_ref` text NOT NULL,
	`scope` text NOT NULL,
	`granted_by` text NOT NULL,
	`valid_until` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `medical_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`incident_id` text DEFAULT '' NOT NULL,
	`action_type` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`due_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`confirmation_ref` text DEFAULT '' NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `medical_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_entity_id` text NOT NULL,
	`case_type` text NOT NULL,
	`opened_at` text NOT NULL,
	`severity` text NOT NULL,
	`minimum_summary` text NOT NULL,
	`responsible_entity_id` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text NOT NULL,
	`closed_at` text DEFAULT '' NOT NULL,
	`confirmation_ref` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `medical_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_entity_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`document_type` text NOT NULL,
	`document_ref` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`status` text NOT NULL,
	`storage_class` text NOT NULL,
	`minimum_summary` text NOT NULL,
	`confirmed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `medical_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`happened_at` text NOT NULL,
	`incident_type` text NOT NULL,
	`minimum_facts` text NOT NULL,
	`response_required` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `medical_restrictions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_entity_id` text NOT NULL,
	`record_id` text NOT NULL,
	`category` text NOT NULL,
	`limitation` text NOT NULL,
	`valid_until` text NOT NULL,
	`action_scope` text NOT NULL,
	`status` text NOT NULL
);
