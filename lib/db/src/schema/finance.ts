import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  numeric,
  date,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

// ─── Bank Transactions ────────────────────────────────────────────────────────

export const bankTransactionsTable = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id"),                // FK to bank_import_batches
  normalizedEventId: uuid("normalized_event_id"),        // FK to normalized_events
  hash: text("hash"),                                    // dedup hash (unique index via SQL)
  sourceSystem: text("source_system"),                   // 'csv_upload' | 'api_sberbank' | ...
  sourceType: text("source_type").default("csv_import"), // 'csv_import' | 'bank_api'
  externalId: text("external_id").unique(),              // bank-provided unique operation id
  bankConnectorId: uuid("bank_connector_id"),            // FK to bank_connectors
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  bankName: text("bank_name"),
  currency: text("currency").default("RUB"),
  accountName: text("account_name"),
  accountNumber: text("account_number"),
  operationDate: date("operation_date"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  amount: numeric("amount"),
  direction: text("direction"),                          // 'income' | 'expense'
  counterpartyName: text("counterparty_name"),
  counterpartyInn: text("counterparty_inn"),
  purpose: text("purpose"),
  categoryRaw: text("category_raw"),
  ddsCategory: text("dds_category"),
  opiuCategory: text("opiu_category"),
  managementCategory: text("management_category"),
  branchName: text("branch_name"),
  branchCrmId: text("branch_crm_id"),
  isTransferBetweenOwnAccounts: boolean("is_transfer_between_own_accounts").default(false),
  isCapex: boolean("is_capex").default(false),
  isDebtBody: boolean("is_debt_body").default(false),
  isDebtInterest: boolean("is_debt_interest").default(false),
  isTax: boolean("is_tax").default(false),
  isPayroll: boolean("is_payroll").default(false),
  isUnclear: boolean("is_unclear").default(false),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // ── Reconciliation ────────────────────────────────────────────────────────
  matchedOperationId: text("matched_operation_id"),      // FK to operations.id (soft)
  matchStatus: text("match_status").default("unmatched"),// unmatched|matched|ignored|reviewed
  matchType: text("match_type"),                         // auto | manual
  matchConfidence: integer("match_confidence").default(0),// 0–100
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  isIgnored: boolean("is_ignored").default(false),
  // ── Payment matching to families/persons ─────────────────────────────────
  matchedFamilyId: text("matched_family_id"),    // FK soft to families.id
  matchedPersonId: text("matched_person_id"),    // FK soft to persons.id
  matchedChildId: text("matched_child_id"),      // FK soft to persons.id (child)
  matchedContractId: text("matched_contract_id"),// FK soft to contracts
  matchedInvoiceId: text("matched_invoice_id"),  // FK soft to invoices
  accountId: text("account_id"),                 // bank account id from API (external_account_id)
  // ── Extended banking fields ───────────────────────────────────────────────
  maskedAccount: text("masked_account"),         // "****1234"
  bookingDateTime: timestamp("booking_date_time", { withTimezone: true }),
  valueDateTime: timestamp("value_date_time", { withTimezone: true }),
  counterpartyAccount: text("counterparty_account"), // counterparty account number
  operationType: text("operation_type"),         // bank operation type code
  syncRunId: uuid("sync_run_id"),                // FK → bank_sync_runs.id
  // ── Extended match links ──────────────────────────────────────────────────
  matchedContractorId: text("matched_contractor_id"),
  matchedEmployeeId: text("matched_employee_id"),
  matchedPayrollId: text("matched_payroll_id"),
  isInternalTransfer: boolean("is_internal_transfer").default(false),
  ignoredAt: timestamp("ignored_at", { withTimezone: true }),
  ignoredReason: text("ignored_reason"),
  matchedByUserId: text("matched_by_user_id"),
  matchSource: text("match_source"), // 'manual' | 'ai' | 'rule'
});

export type BankTransaction = typeof bankTransactionsTable.$inferSelect;

// ─── DDS Categories ───────────────────────────────────────────────────────────

export const ddsCategoriesTable = pgTable("dds_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  direction: text("direction"),                          // 'income' | 'expense'
  groupName: text("group_name"),
  category: text("category"),
  subcategory: text("subcategory"),
  isActive: boolean("is_active").default(true),
});

export type DdsCategory = typeof ddsCategoriesTable.$inferSelect;

// ─── OPIU Categories ──────────────────────────────────────────────────────────

export const opiuCategoriesTable = pgTable("opiu_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type"),                                    // 'revenue'|'cogs'|'opex'|'tax'|'finance'|'capex'|'debt'|'transfer'|'non_opiu'
  groupName: text("group_name"),
  category: text("category"),
  subcategory: text("subcategory"),
  isActive: boolean("is_active").default(true),
});

export type OpiuCategory = typeof opiuCategoriesTable.$inferSelect;

// ─── Categorization Rules ─────────────────────────────────────────────────────

export const categorizationRulesTable = pgTable("categorization_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleName: text("rule_name"),
  priority: integer("priority").default(100),
  direction: text("direction"),                          // 'income' | 'expense' | null = both
  counterpartyContains: text("counterparty_contains").array(),
  purposeContains: text("purpose_contains").array(),
  amountMin: numeric("amount_min"),
  amountMax: numeric("amount_max"),
  ddsCategory: text("dds_category"),
  opiuCategory: text("opiu_category"),
  branchCrmId: text("branch_crm_id"),
  flags: jsonb("flags"),                                 // { isPayroll, isCapex, isDebtBody, ... }
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // ── Suggestion engine columns (added P3.1) ─────────────────────────────────
  matchField: text("match_field"),       // counterparty | purpose | bank_name | direction | mcc
  matchType: text("match_type"),         // contains | equals | regex | starts_with
  pattern: text("pattern"),
  matchDirection: text("match_direction").default("any"), // any | income | expense  (P3.2)
  suggestedArticleId: uuid("suggested_article_id"),
  suggestedAction: text("suggested_action"), // contractor | employee | family | internal_transfer | ignore
  confidence: integer("confidence").default(80),
});

export type CategorizationRule = typeof categorizationRulesTable.$inferSelect;

// ─── Manual Adjustments ───────────────────────────────────────────────────────

export const manualAdjustmentsTable = pgTable("manual_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  month: date("month"),
  branchCrmId: text("branch_crm_id"),
  type: text("type"),                                    // 'revenue' | 'expense' | 'accrual' | 'correction'
  opiuCategory: text("opiu_category"),
  amount: numeric("amount"),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type ManualAdjustment = typeof manualAdjustmentsTable.$inferSelect;

// ─── Payroll Accruals ─────────────────────────────────────────────────────────

export const payrollAccrualsTable = pgTable("payroll_accruals", {
  id: uuid("id").primaryKey().defaultRandom(),
  month: date("month"),
  branchCrmId: text("branch_crm_id"),
  employeeName: text("employee_name"),
  role: text("role"),
  amountGross: numeric("amount_gross"),
  taxes: numeric("taxes"),
  amountNet: numeric("amount_net"),
  source: text("source"),                                // 'manual' | 'bank_import' | 'payroll_system'
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type PayrollAccrual = typeof payrollAccrualsTable.$inferSelect;

// ─── Contracts / Obligations ──────────────────────────────────────────────────

export const contractsObligationsTable = pgTable("contracts_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  branchCrmId: text("branch_crm_id"),
  counterpartyName: text("counterparty_name"),
  obligationType: text("obligation_type"),               // 'rent'|'loan'|'service'|'tax'|'lease'|'other'
  monthlyAmount: numeric("monthly_amount"),
  paymentDay: integer("payment_day"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  opiuCategory: text("opiu_category"),
  ddsCategory: text("dds_category"),
  isActive: boolean("is_active").default(true),
  raw: jsonb("raw"),
});

export type ContractObligation = typeof contractsObligationsTable.$inferSelect;

// ─── ОПиУ Monthly (P&L) ───────────────────────────────────────────────────────

export const opiuMonthlyTable = pgTable("opiu_monthly", {
  id: uuid("id").primaryKey().defaultRandom(),
  month: date("month"),
  branchCrmId: text("branch_crm_id"),
  revenueAccrual: numeric("revenue_accrual"),            // начисленная выручка (CRM charges)
  revenueCash: numeric("revenue_cash"),                  // оплаченная выручка (bank income)
  cogs: numeric("cogs"),
  payroll: numeric("payroll"),
  rent: numeric("rent"),
  marketing: numeric("marketing"),
  utilities: numeric("utilities"),
  taxes: numeric("taxes"),
  bankFees: numeric("bank_fees"),
  services: numeric("services"),
  supplies: numeric("supplies"),
  financeInterest: numeric("finance_interest"),
  depreciation: numeric("depreciation"),
  otherOpex: numeric("other_opex"),
  ebitda: numeric("ebitda"),
  operatingProfit: numeric("operating_profit"),
  netProfit: numeric("net_profit"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  raw: jsonb("raw"),
});

export type OpiuMonthly = typeof opiuMonthlyTable.$inferSelect;

// ─── ДДС Monthly (Cash Flow) ──────────────────────────────────────────────────

export const ddsMonthlyTable = pgTable("dds_monthly", {
  id: uuid("id").primaryKey().defaultRandom(),
  month: date("month"),
  branchCrmId: text("branch_crm_id"),
  openingBalance: numeric("opening_balance"),
  incomeTotal: numeric("income_total"),
  expenseTotal: numeric("expense_total"),
  operatingCashflow: numeric("operating_cashflow"),
  investingCashflow: numeric("investing_cashflow"),
  financingCashflow: numeric("financing_cashflow"),
  closingBalance: numeric("closing_balance"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  raw: jsonb("raw"),
});

export type DdsMonthly = typeof ddsMonthlyTable.$inferSelect;

// ─── Recurring Obligations ────────────────────────────────────────────────────

export const recurringObligationsTable = pgTable("recurring_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  counterpartyName: text("counterparty_name"),
  // type: rent|payroll|taxes|utilities|telecom|software|marketing|leasing|food|security|infrastructure|custom
  type: text("type").notNull().default("custom"),
  ddsArticleId: uuid("dds_article_id"),
  expectedAmount: numeric("expected_amount"),
  minAmount: numeric("min_amount"),
  maxAmount: numeric("max_amount"),
  currency: text("currency").default("RUB"),
  // frequency: weekly|monthly|quarterly|yearly|custom
  frequency: text("frequency").notNull().default("monthly"),
  dayOfMonth: integer("day_of_month"),
  isActive: boolean("is_active").default(true),
  relatedParty: boolean("related_party").default(false),
  // status: suggested|approved|rejected
  status: text("status").notNull().default("suggested"),
  // detectionSource: ai_pattern|manual
  detectionSource: text("detection_source").default("ai_pattern"),
  confidenceScore: integer("confidence_score"),
  lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }),
  lastPaidAt: date("last_paid_at"),
  nextExpectedDate: date("next_expected_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type RecurringObligation = typeof recurringObligationsTable.$inferSelect;
