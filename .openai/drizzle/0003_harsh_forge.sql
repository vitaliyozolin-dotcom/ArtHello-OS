ALTER TABLE `alpha_payments` ADD `amount_minor` integer;--> statement-breakpoint
UPDATE `alpha_payments`
SET `amount_minor` = CAST(ROUND(`amount` * 100) AS INTEGER)
WHERE `amount` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `alpha_teacher_rates` ADD `rate_amount_minor` integer;--> statement-breakpoint
UPDATE `alpha_teacher_rates`
SET `rate_amount_minor` = CAST(ROUND(`rate_amount` * 100) AS INTEGER)
WHERE `rate_amount` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `current_balance_minor` integer;--> statement-breakpoint
UPDATE `bank_accounts`
SET `current_balance_minor` = CAST(ROUND(`current_balance` * 100) AS INTEGER)
WHERE `current_balance` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_payroll_components` ADD `amount_minor` integer;--> statement-breakpoint
UPDATE `employee_payroll_components`
SET `amount_minor` = CAST(ROUND(`amount` * 100) AS INTEGER);--> statement-breakpoint
ALTER TABLE `employee_payroll_monthly` ADD `accrued_amount_minor` integer;--> statement-breakpoint
ALTER TABLE `employee_payroll_monthly` ADD `paid_amount_minor` integer;--> statement-breakpoint
UPDATE `employee_payroll_monthly`
SET
  `accrued_amount_minor` = CAST(ROUND(`accrued_amount` * 100) AS INTEGER),
  `paid_amount_minor` = CAST(ROUND(`paid_amount` * 100) AS INTEGER);--> statement-breakpoint
ALTER TABLE `employee_payroll_payments` ADD `amount_minor` integer;--> statement-breakpoint
UPDATE `employee_payroll_payments`
SET `amount_minor` = CAST(ROUND(`amount` * 100) AS INTEGER);--> statement-breakpoint
ALTER TABLE `payroll_unresolved` ADD `amount_minor` integer;
--> statement-breakpoint
UPDATE `payroll_unresolved`
SET `amount_minor` = CAST(ROUND(`amount` * 100) AS INTEGER);
