import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  numeric,
  date,
  integer,
} from "drizzle-orm/pg-core";

// ─── P8.4b: Bank ↔ AlphaCRM Reconciliation ───────────────────────────────────
// DO NOT use these records as final ДДС/ОПиУ — see replit.md §9 Do Not Do.
// This is the reconciliation layer only.

export const bankAlphaReconciliationRunsTable = pgTable("bank_alpha_reconciliation_runs", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  startedAt:              timestamp("started_at",  { withTimezone: true }).defaultNow(),
  finishedAt:             timestamp("finished_at", { withTimezone: true }),
  status:                 text("status").default("running"),
  bankTransactionsChecked: integer("bank_transactions_checked").default(0),
  crmPaymentsChecked:     integer("crm_payments_checked").default(0),
  matchedCount:           integer("matched_count").default(0),
  partialCount:           integer("partial_count").default(0),
  possibleCount:          integer("possible_count").default(0),
  unmatchedBankCount:     integer("unmatched_bank_count").default(0),
  unmatchedCrmCount:      integer("unmatched_crm_count").default(0),
  excludedInternalCount:  integer("excluded_internal_count").default(0),
  excludedCollectionCount: integer("excluded_collection_count").default(0),
  excludedBankFeeCount:   integer("excluded_bank_fee_count").default(0),
  needsReviewCount:       integer("needs_review_count").default(0),
  errors:                 jsonb("errors").default([]),
  createdAt:              timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type BankAlphaReconciliationRun =
  typeof bankAlphaReconciliationRunsTable.$inferSelect;

export const bankAlphaReconciliationMatchesTable = pgTable(
  "bank_alpha_reconciliation_matches",
  {
    id:                   uuid("id").primaryKey().defaultRandom(),
    runId:                uuid("run_id"),
    // bank_transaction_id stored as TEXT to match bank_transaction_counterparty_links convention
    bankTransactionId:    text("bank_transaction_id"),
    crmPaymentId:         uuid("crm_payment_id"),
    // match_status: matched|partial_match|possible_match|unmatched_bank|unmatched_crm
    //   |excluded_internal|excluded_collection|excluded_bank_fee|needs_review
    matchStatus:          text("match_status"),
    // match_confidence: exact|high|medium|low|none
    matchConfidence:      text("match_confidence"),
    // match_method: exact_amount_date|amount_date_window_customer|amount_only_customer
    //   |date_amount_no_customer|counterparty_name_match|manual|excluded_rule|none
    matchMethod:          text("match_method"),
    amountDelta:          numeric("amount_delta",  { precision: 15, scale: 2 }),
    dateDeltaDays:        integer("date_delta_days"),
    bankAmount:           numeric("bank_amount",   { precision: 15, scale: 2 }),
    crmAmount:            numeric("crm_amount",    { precision: 15, scale: 2 }),
    bankDate:             date("bank_date"),
    crmDate:              date("crm_date"),
    bankCounterpartyId:   uuid("bank_counterparty_id"),
    bankCounterpartyName: text("bank_counterparty_name"),
    crmCustomerAlphaId:   text("crm_customer_alpha_id"),
    studentId:            uuid("student_id"),
    studentIdentityId:    uuid("student_identity_id"),
    familyId:             uuid("family_id"),
    reasons:              jsonb("reasons").default({}),
    riskFlags:            jsonb("risk_flags").default({}),
    createdAt:            timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt:            timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
);

export type BankAlphaReconciliationMatch =
  typeof bankAlphaReconciliationMatchesTable.$inferSelect;
