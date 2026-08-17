CREATE TABLE `sensitive_access_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`resource_kind` text NOT NULL,
	`outcome` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sensitive_access_audit_occurred_idx` ON `sensitive_access_audit` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `sensitive_access_audit_resource_idx` ON `sensitive_access_audit` (`resource_kind`);