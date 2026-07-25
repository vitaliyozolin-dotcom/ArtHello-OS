import {
  pgTable,
  text,
  uuid,
  timestamp,
  numeric,
  date,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

// ─── Staff Rates ──────────────────────────────────────────────────────────────
// Owner-managed rate table: how much each teacher earns

export const staffRatesTable = pgTable("staff_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  teacherCrmId: text("teacher_crm_id").notNull(),   // FK to crm_teachers.crm_id
  branchCrmId: text("branch_crm_id"),
  rateType: text("rate_type").notNull().default("per_lesson"),  // 'per_lesson' | 'fixed_monthly' | 'per_hour'
  rateAmount: numeric("rate_amount").notNull(),       // in RUB
  currency: text("currency").default("RUB"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type StaffRate = typeof staffRatesTable.$inferSelect;

// ─── Staff Payouts ────────────────────────────────────────────────────────────
// Calculated or manually-confirmed monthly payouts

export const staffPayoutsTable = pgTable("staff_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  teacherCrmId: text("teacher_crm_id").notNull(),
  branchCrmId: text("branch_crm_id"),
  periodMonth: text("period_month").notNull(),   // 'YYYY-MM'
  lessonsCount: integer("lessons_count").default(0),
  studentsCount: integer("students_count").default(0),
  hoursCount: numeric("hours_count"),
  calculatedAmount: numeric("calculated_amount"),
  confirmedAmount: numeric("confirmed_amount"),
  status: text("status").default("draft"),       // 'draft' | 'confirmed' | 'paid'
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type StaffPayout = typeof staffPayoutsTable.$inferSelect;

// ─── Staff Profiles ───────────────────────────────────────────────────────────
// HR metadata per teacher (position, hire date, tax rates)

export const staffProfilesTable = pgTable("staff_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  teacherCrmId: text("teacher_crm_id").notNull().unique(),
  position: text("position"),                    // e.g. "Педагог", "Старший педагог"
  department: text("department"),                // "Art", "Music", "Dance"
  hireDate: date("hire_date"),
  ndflRate: numeric("ndfl_rate", { precision: 5, scale: 4 }).default("0.13"),
  pfrRate: numeric("pfr_rate", { precision: 5, scale: 4 }).default("0.22"),
  fssRate: numeric("fss_rate", { precision: 5, scale: 4 }).default("0.029"),
  kpiTarget: numeric("kpi_target"),             // monthly lesson count target
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type StaffProfile = typeof staffProfilesTable.$inferSelect;

// ─── Staff Bonuses ────────────────────────────────────────────────────────────

export const staffBonusesTable = pgTable("staff_bonuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  teacherCrmId: text("teacher_crm_id").notNull(),
  periodMonth: text("period_month").notNull(), // YYYY-MM
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  reason: text("reason"),
  status: text("status").default("pending"), // pending | paid | cancelled
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type StaffBonus = typeof staffBonusesTable.$inferSelect;

// ─── Staff Vacations ──────────────────────────────────────────────────────────

export const staffVacationsTable = pgTable("staff_vacations", {
  id: uuid("id").primaryKey().defaultRandom(),
  teacherCrmId: text("teacher_crm_id").notNull(),
  vacationType: text("vacation_type").default("annual"),
  // annual | sick | unpaid | maternity
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  daysCount: integer("days_count"),
  accruedAmount: numeric("accrued_amount", { precision: 15, scale: 2 }),
  paidAmount: numeric("paid_amount", { precision: 15, scale: 2 }),
  status: text("status").default("approved"),
  // planned | approved | completed | cancelled
  notes: text("notes"),
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type StaffVacation = typeof staffVacationsTable.$inferSelect;

// ─── Staff Deductions ─────────────────────────────────────────────────────────

export const staffDeductionsTable = pgTable("staff_deductions", {
  id: uuid("id").primaryKey().defaultRandom(),
  teacherCrmId: text("teacher_crm_id").notNull(),
  periodMonth: text("period_month").notNull(),          // YYYY-MM
  deductionType: text("deduction_type").notNull().default("other"),
  // advance | loan | penalty | tax | absence | other
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  reason: text("reason"),
  status: text("status").default("applied"),
  // pending | applied | cancelled
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type StaffDeduction = typeof staffDeductionsTable.$inferSelect;
