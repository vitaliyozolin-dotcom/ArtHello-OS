import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  numeric,
  integer,
  date,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

// ─── Counterparties ───────────────────────────────────────────────────────────
// P8.3: Foundational counterparty layer extracted from bank transactions.
// DO NOT use as final ДДС/ОПиУ — see replit.md §9 Do Not Do.

export const counterpartiesTable = pgTable("counterparties", {
  id:               uuid("id").primaryKey().defaultRandom(),
  canonicalKey:     text("canonical_key").unique(),  // inn | acct:<num> | name:<norm>
  displayName:      text("display_name"),           // original name from bank
  normalizedName:   text("normalized_name"),         // trimmed + uppercased
  inn:              text("inn"),
  kpp:              text("kpp"),
  ogrn:             text("ogrn"),
  // counterparty_type: parent_client | supplier | contractor | employee_or_self_employed
  //   | tax_authority | bank_or_fee | internal_company | owner_related | unknown
  counterpartyType: text("counterparty_type").default("unknown"),
  // counterparty_role: payer | payee | both | unknown
  counterpartyRole: text("counterparty_role").default("unknown"),
  // status: active | inactive | needs_review | blocked
  status:           text("status").default("needs_review"),
  // confidence: high | medium | low
  confidence:       text("confidence").default("low"),
  // source: bank_transactions | manual | alpha_match | imported
  source:           text("source").default("bank_transactions"),
  firstSeenAt:      date("first_seen_at"),
  lastSeenAt:       date("last_seen_at"),
  totalIncome:      numeric("total_income",  { precision: 15, scale: 2 }).default("0"),
  totalExpense:     numeric("total_expense", { precision: 15, scale: 2 }).default("0"),
  operationsCount:  integer("operations_count").default(0),
  lastOperationId:  text("last_operation_id"),      // FK soft → bank_transactions.id
  riskFlags:                  jsonb("risk_flags").default({}),
  notes:                      text("notes"),
  // ── P8.4a reclassification fields ─────────────────────────────────────────
  financeTreatmentHint:       text("finance_treatment_hint"),
  excludeFromRevenueExpense:  boolean("exclude_from_revenue_expense").default(false),
  needsManualReview:          boolean("needs_manual_review").default(false),
  reclassificationReason:     text("reclassification_reason"),
  classificationVersion:      text("classification_version"),
  classificationUpdatedAt:    timestamp("classification_updated_at", { withTimezone: true }),
  createdAt:                  timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:                  timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Counterparty = typeof counterpartiesTable.$inferSelect;

// ─── Bank Transaction ↔ Counterparty Links ────────────────────────────────────

export const bankTransactionCounterpartyLinksTable = pgTable(
  "bank_transaction_counterparty_links",
  {
    id:                 uuid("id").primaryKey().defaultRandom(),
    bankTransactionId:  text("bank_transaction_id").notNull(),  // FK soft → bank_transactions.id
    counterpartyId:     uuid("counterparty_id").notNull(),      // FK → counterparties.id
    // role: payer | payee | unknown
    role:               text("role").default("unknown"),
    // match_method: inn | account_number | exact_name | normalized_name | manual | inferred
    matchMethod:        text("match_method").default("inferred"),
    // confidence: high | medium | low
    confidence:         text("confidence").default("low"),
    createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt:          timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_btcp_links_tx_cp_role").on(
      t.bankTransactionId, t.counterpartyId, t.role,
    ),
  ],
);

export type BankTransactionCounterpartyLink =
  typeof bankTransactionCounterpartyLinksTable.$inferSelect;

// ─── Counterparty Aliases ─────────────────────────────────────────────────────

export const counterpartyAliasesTable = pgTable("counterparty_aliases", {
  id:              uuid("id").primaryKey().defaultRandom(),
  counterpartyId:  uuid("counterparty_id").notNull(),   // FK → counterparties.id
  // alias_type: name | account | inn | kpp | bank
  aliasType:       text("alias_type").notNull(),
  aliasValue:      text("alias_value").notNull(),
  source:          text("source").default("bank_transactions"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type CounterpartyAlias = typeof counterpartyAliasesTable.$inferSelect;

// ─── Counterparty Duplicate Candidates ───────────────────────────────────────

export const counterpartyDuplicateCandidatesTable = pgTable(
  "counterparty_duplicate_candidates",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    counterpartyAId: uuid("counterparty_a_id").notNull(),
    counterpartyBId: uuid("counterparty_b_id").notNull(),
    // reason: same_inn_diff_name | same_name_diff_inn | same_account_diff_name
    //       | same_name_with_without_legal | individual_same_name | internal_alias
    reason:         text("reason").notNull(),
    confidence:     text("confidence").default("medium"),
    severity:       text("severity").default("medium"),
    // status: open | ignored | confirmed | resolved
    status:         text("status").default("open"),
    createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
);

export type CounterpartyDuplicateCandidate =
  typeof counterpartyDuplicateCandidatesTable.$inferSelect;
