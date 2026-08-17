CREATE INDEX "crm_group_memberships_group_idx" ON "crm_group_memberships" USING btree ("branch_crm_id","group_crm_id");--> statement-breakpoint
CREATE INDEX "family_merge_candidates_status_idx" ON "family_merge_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payroll_payments_period_idx" ON "payroll_payments" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "salary_accruals_period_idx" ON "salary_accruals" USING btree ("payroll_period_id");--> statement-breakpoint
CREATE INDEX "source_raw_records_source_idx" ON "source_raw_records" USING btree ("source_system","source_external_id","record_type");