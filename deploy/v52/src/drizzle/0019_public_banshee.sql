CREATE TABLE `system_runtime_state` (
	`state_key` text PRIMARY KEY NOT NULL,
	`state_value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
