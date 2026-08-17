import {
  pgTable, uuid, text, numeric, boolean, timestamp, integer,
} from "drizzle-orm/pg-core";

// ─── Month Closings ───────────────────────────────────────────────────────────
// Tracks the open/close lifecycle of each reporting month.
// When a month is "closed", operations cannot be added or edited for that period.

export const monthClosingsTable = pgTable("month_closings", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodMonth: text("period_month").notNull().unique(), // YYYY-MM

  status: text("status").notNull().default("open"),
  // open | closed | locked
  // open     → normal editing
  // closed   → read-only, can be reopened by owner
  // locked   → hard lock, requires admin to reopen

  // Snapshot KPIs captured at close time
  snapshotRevenue: numeric("snapshot_revenue", { precision: 15, scale: 2 }),
  snapshotExpenses: numeric("snapshot_expenses", { precision: 15, scale: 2 }),
  snapshotGrossProfit: numeric("snapshot_gross_profit", { precision: 15, scale: 2 }),
  snapshotMargin: numeric("snapshot_margin", { precision: 6, scale: 4 }),
  snapshotOperationsCount: integer("snapshot_operations_count"),
  snapshotTrustScore: integer("snapshot_trust_score"),

  // Checklist flags (all must be true before locking)
  checkAllOpsVerified: boolean("check_all_ops_verified").default(false),
  checkArticlesCovered: boolean("check_articles_covered").default(false),
  checkTaxesAccrued: boolean("check_taxes_accrued").default(false),
  checkPayrollPaid: boolean("check_payroll_paid").default(false),

  closedBy: text("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  reopenedBy: text("reopened_by"),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type MonthClosing = typeof monthClosingsTable.$inferSelect;
