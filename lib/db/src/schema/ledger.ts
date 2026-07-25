import {
  pgTable, uuid, text, numeric, boolean, timestamp, integer, index,
} from "drizzle-orm/pg-core";

// ─── Chart of Accounts (Статьи) ───────────────────────────────────────────────

export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),                     // e.g. "1.1", "2.3"
  name: text("name").notNull(),                     // "Оплата за обучение"
  groupName: text("group_name").notNull(),          // "Доходы от основной деятельности"
  subGroup: text("sub_group"),                      // "Учебные программы"
  type: text("type").notNull(),                     // income | expense | transfer | asset | liability
  // Financial logic flags
  affectsDds: boolean("affects_dds").default(true),           // ДДС (cashflow)
  affectsPl: boolean("affects_pl").default(true),             // ОПиУ (P&L)
  affectsEbitda: boolean("affects_ebitda").default(false),    // EBITDA
  taxDeductible: boolean("tax_deductible").default(false),    // tax base reduction
  isFixed: boolean("is_fixed").default(false),                // fixed vs variable
  isOperational: boolean("is_operational").default(true),     // operational vs investment
  // Organisation
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Operations Ledger (Реестр операций) ─────────────────────────────────────

export const operations = pgTable("operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  createdBy: text("created_by").default("system"),

  // ── Type & source ─────────────────────────────────────────────────────────
  operationType: text("operation_type").notNull(),
  // income | expense | transfer | payroll | tax | refund | adjustment | accrual

  source: text("source").notNull().default("manual"),
  // manual | bank_import | crm_sync | payroll_import | tax_import

  direction: text("direction").notNull(),
  // in | out | internal

  // ── Amount ───────────────────────────────────────────────────────────────
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  currency: text("currency").default("RUB"),
  description: text("description"),

  // ── Dates — KEY: ДДС vs ОПиУ split ──────────────────────────────────────
  // cashflowDate = when money actually moved (bank statement date)
  // accrualDate  = when the economic event belongs (may be a different period)
  cashflowDate: timestamp("cashflow_date", { withTimezone: true }).notNull(),
  accrualDate: timestamp("accrual_date", { withTimezone: true }),

  // "2025-08" — period this operation belongs to in each report
  cashflowMonth: text("cashflow_month").notNull(),  // ДДС period
  plMonth: text("pl_month").notNull(),              // ОПиУ period (may differ!)

  // ── Classification ────────────────────────────────────────────────────────
  articleId: uuid("article_id").references(() => articles.id),
  articleName: text("article_name"),          // denormalised for query speed
  articleCode: text("article_code"),
  department: text("department"),
  project: text("project"),
  location: text("location"),

  // ── Counterparty ──────────────────────────────────────────────────────────
  counterpartyName: text("counterparty_name"),
  counterpartyType: text("counterparty_type"),
  // contractor | employee | student | family | tax | bank | other

  familyId: uuid("family_id"),                // FK to families (no hard ref across schemas)
  childId: text("child_id"),                  // FK soft to persons.id (student/child)
  contractorId: text("contractor_id"),        // FK soft to contractors.id
  employeeId: text("employee_id"),            // FK soft to staff persons
  contractId: text("contract_id"),            // FK soft to contracts.id
  branchId: text("branch_id"),                // FK soft to crm_branches / branch entity
  groupId: text("group_id"),                  // FK soft to class_groups.id

  // ── Status ────────────────────────────────────────────────────────────────
  paymentStatus: text("payment_status").default("paid"),
  // pending | partial | paid | overdue | cancelled

  verificationStatus: text("verification_status").default("unverified"),
  // unverified | pending_review | verified | disputed

  trustScore: integer("trust_score").default(50),   // 0–100

  // ── External links ────────────────────────────────────────────────────────
  bankTransactionId: text("bank_transaction_id"),   // links to bank_transactions.id
  externalId: text("external_id"),                  // id in source system
  documentRefs: text("document_refs"),              // JSON array of doc URLs/ids

  // ── Notes & soft-delete ───────────────────────────────────────────────────
  notes: text("notes"),
  isTestData: boolean("is_test_data").default(false),
  isDeleted: boolean("is_deleted").default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
}, (t) => [
  index("ops_cashflow_month_idx").on(t.cashflowMonth),
  index("ops_pl_month_idx").on(t.plMonth),
  index("ops_article_idx").on(t.articleId),
  index("ops_source_idx").on(t.source),
  index("ops_type_idx").on(t.operationType),
  index("ops_created_idx").on(t.createdAt),
  index("ops_direction_idx").on(t.direction),
  index("ops_verification_idx").on(t.verificationStatus),
]);

// ─── Audit Trail ─────────────────────────────────────────────────────────────

export const operationHistory = pgTable("operation_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationId: uuid("operation_id").references(() => operations.id).notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow(),
  changedBy: text("changed_by").default("system"),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changeReason: text("change_reason"),
}, (t) => [
  index("op_history_op_idx").on(t.operationId),
]);
