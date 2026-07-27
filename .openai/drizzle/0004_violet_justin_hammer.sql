CREATE TABLE `front_office_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_role` text NOT NULL,
	`actor_display_name` text,
	`after_state_json` text,
	`request_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `front_office_audit_entity_idx` ON `front_office_audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `front_office_connector_state` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text DEFAULT 'ARTHELLO' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`last_event_at` text,
	`last_error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `front_office_connector_project_status_idx` ON `front_office_connector_state` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `front_office_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text DEFAULT 'ARTHELLO' NOT NULL,
	`external_key` text NOT NULL,
	`kind` text DEFAULT 'lead' NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'P3' NOT NULL,
	`contact_display_name` text NOT NULL,
	`contact_point_masked` text,
	`sealed_contact` text,
	`identity_status` text DEFAULT 'not_required' NOT NULL,
	`intent` text,
	`service` text,
	`branch_or_object` text,
	`owner_role` text,
	`owner_display_name` text,
	`last_message_at` text NOT NULL,
	`due_at` text,
	`next_action_at` text,
	`is_synthetic` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `front_office_conversations_project_external_uniq` ON `front_office_conversations` (`project_id`,`external_key`);--> statement-breakpoint
CREATE INDEX `front_office_conversations_queue_idx` ON `front_office_conversations` (`project_id`,`status`,`priority`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `front_office_inbound_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text DEFAULT 'ARTHELLO' NOT NULL,
	`connector_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`processing_status` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `front_office_inbound_connector_event_uniq` ON `front_office_inbound_events` (`connector_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `front_office_inbound_received_idx` ON `front_office_inbound_events` (`received_at`);--> statement-breakpoint
CREATE TABLE `front_office_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`stage` text DEFAULT 'NEW' NOT NULL,
	`source` text,
	`campaign` text,
	`child_age_band` text,
	`branch_preference` text,
	`program_interest` text,
	`owner_display_name` text,
	`next_action` text,
	`next_action_at` text,
	`trial_status` text DEFAULT 'not_requested' NOT NULL,
	`is_synthetic` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `front_office_conversations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `front_office_leads_conversation_uniq` ON `front_office_leads` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `front_office_leads_stage_idx` ON `front_office_leads` (`stage`,`next_action_at`);--> statement-breakpoint
CREATE TABLE `front_office_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_type` text NOT NULL,
	`direction` text DEFAULT 'incoming' NOT NULL,
	`body` text NOT NULL,
	`author_role` text,
	`author_display_name` text,
	`fact_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`source_refs_json` text DEFAULT '[]' NOT NULL,
	`is_synthetic` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `front_office_conversations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `front_office_messages_conversation_idx` ON `front_office_messages` (`conversation_id`,`created_at`);