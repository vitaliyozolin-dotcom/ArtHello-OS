import {
  pgTable, uuid, text, numeric, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

// ─── Tax Obligations ──────────────────────────────────────────────────────────

export const taxObligationsTable = pgTable("tax_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  taxType: text("tax_type").notNull(), // usn | ndfl | nds | pfr | fss | other
  taxName: text("tax_name"),           // human-readable name
  periodMonth: text("period_month").notNull(), // YYYY-MM — period to which tax belongs
  dueDate: date("due_date"),           // payment deadline
  taxBase: numeric("tax_base", { precision: 15, scale: 2 }),
  taxRate: numeric("tax_rate", { precision: 6, scale: 4 }), // e.g. 0.06 for 6%
  accruedAmount: numeric("accrued_amount", { precision: 15, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 15, scale: 2 }).default("0"),
  status: text("status").default("accrued"), // accrued | partial | paid | overdue | cancelled
  operationId: uuid("operation_id"), // FK to operations (soft) — the actual payment
  notes: text("notes"),
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type TaxObligation = typeof taxObligationsTable.$inferSelect;

// ─── Tax Reserve ──────────────────────────────────────────────────────────────
// Running reserve balance — how much to set aside each month

export const taxReserveTable = pgTable("tax_reserve", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodMonth: text("period_month").notNull().unique(), // YYYY-MM
  reserveAmount: numeric("reserve_amount", { precision: 15, scale: 2 }).default("0"),
  actualTaxPaid: numeric("actual_tax_paid", { precision: 15, scale: 2 }).default("0"),
  notes: text("notes"),
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type TaxReserve = typeof taxReserveTable.$inferSelect;
