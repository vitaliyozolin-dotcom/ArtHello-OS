CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`legal_entity_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`masked_account` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`balance_minor` integer,
	`balance_as_of` text DEFAULT '' NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_provider_unique` ON `bank_accounts` (`connection_id`,`legal_entity_id`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `bank_statement_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`legal_entity_id` text NOT NULL,
	`provider_statement_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text NOT NULL,
	`start_balance_minor` integer NOT NULL,
	`end_balance_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`transaction_count` integer NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_statement_provider_unique` ON `bank_statement_imports` (`connection_id`,`provider_statement_id`);--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`legal_entity_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`provider_statement_id` text NOT NULL,
	`provider_transaction_id` text NOT NULL,
	`payment_id` text DEFAULT '' NOT NULL,
	`operation_date` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`document_number` text DEFAULT '' NOT NULL,
	`transaction_type` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`counterparty_name` text DEFAULT '' NOT NULL,
	`counterparty_inn` text DEFAULT '' NOT NULL,
	`counterparty_kpp` text DEFAULT '' NOT NULL,
	`source_payload_hash` text NOT NULL,
	`financial_operation_id` text DEFAULT '' NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_transactions_provider_unique` ON `bank_transactions` (`connection_id`,`provider_transaction_id`);--> statement-breakpoint
CREATE INDEX `bank_transactions_date_idx` ON `bank_transactions` (`operation_date`);