CREATE TABLE IF NOT EXISTS `developer_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`author_name` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`module_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`author_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "developer_feedback_kind" CHECK("developer_feedback"."kind" IN ('bug','suggestion')),
	CONSTRAINT "developer_feedback_title_length" CHECK(length("developer_feedback"."title") BETWEEN 1 AND 160),
	CONSTRAINT "developer_feedback_body_length" CHECK(length("developer_feedback"."body") BETWEEN 1 AND 6000),
	CONSTRAINT "developer_feedback_status" CHECK("developer_feedback"."status" IN ('new','reviewing','planned','done','declined')),
	CONSTRAINT "developer_feedback_revision" CHECK("developer_feedback"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `developer_feedback_author_submission` ON `developer_feedback` (`author_user_id`,`submission_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `developer_feedback_author_id` ON `developer_feedback` (`author_user_id`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `developer_feedback_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feedback_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `developer_feedback`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "developer_feedback_event_status" CHECK("developer_feedback_events"."status" IN ('new','reviewing','planned','done','declined'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `developer_feedback_event_revision` ON `developer_feedback_events` (`feedback_id`,`revision`);