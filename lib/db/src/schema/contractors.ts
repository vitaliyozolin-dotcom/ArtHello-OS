import {
  pgTable, uuid, text, numeric, boolean, timestamp, date, integer,
} from "drizzle-orm/pg-core";

// ─── Contractors ──────────────────────────────────────────────────────────────

export const contractorsTable = pgTable("contractors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  inn: text("inn"),
  type: text("type"),            // ip | ooo | self_employed | individual
  taxStatus: text("tax_status"), // usn | osno | npd | none
  paymentTerms: text("payment_terms"), // e.g. "net30", "prepaid", "on_act"
  direction: text("direction"),  // которое направление/филиал обслуживает
  responsible: text("responsible"),
  trustScore: integer("trust_score").default(50), // 0–100
  riskLevel: text("risk_level").default("medium"), // low | medium | high
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Contractor = typeof contractorsTable.$inferSelect;

// ─── Contractor Accruals (Начисления) ─────────────────────────────────────────

export const contractorAccrualsTable = pgTable("contractor_accruals", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id").notNull().references(() => contractorsTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  accrualDate: date("accrual_date").notNull(),
  accrualMonth: text("accrual_month").notNull(), // YYYY-MM
  description: text("description"),
  status: text("status").default("pending"), // pending | approved | paid | cancelled
  operationId: uuid("operation_id"), // FK to operations (soft)
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type ContractorAccrual = typeof contractorAccrualsTable.$inferSelect;

// ─── Contractor Payments (Оплаты) ─────────────────────────────────────────────

export const contractorPaymentsTable = pgTable("contractor_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id").notNull().references(() => contractorsTable.id, { onDelete: "cascade" }),
  accrualId: uuid("accrual_id"), // FK to contractor_accruals (soft)
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMonth: text("payment_month").notNull(), // YYYY-MM
  method: text("method").default("bank"), // bank | cash | card
  operationId: uuid("operation_id"), // FK to operations (soft)
  notes: text("notes"),
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type ContractorPayment = typeof contractorPaymentsTable.$inferSelect;

// ─── Contractor Documents ─────────────────────────────────────────────────────

export const contractorDocumentsTable = pgTable("contractor_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id").notNull().references(() => contractorsTable.id, { onDelete: "cascade" }),
  accrualId: uuid("accrual_id"), // soft FK
  docType: text("doc_type").notNull(), // contract | act | invoice | upd | reconciliation | other
  docNumber: text("doc_number"),
  docDate: date("doc_date"),
  amount: numeric("amount", { precision: 15, scale: 2 }),
  status: text("status").default("received"), // expected | received | signed | overdue
  notes: text("notes"),
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type ContractorDocument = typeof contractorDocumentsTable.$inferSelect;
