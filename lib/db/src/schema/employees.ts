import {
  pgTable,
  text,
  uuid,
  timestamp,
  date,
  boolean,
  numeric,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Departments ──────────────────────────────────────────────────────────────
// Normalized department directory — never hardcode in UI, always fetch.

export const departmentsTable = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code").unique(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Department = typeof departmentsTable.$inferSelect;
export type NewDepartment = typeof departmentsTable.$inferInsert;

// ─── Employees ────────────────────────────────────────────────────────────────
// Single source of truth for all staff.
// One employee = one card, regardless of role/rule count.
// employmentType: employee | self_employed | contractor | sole_proprietor
// status:         active   | paused        | dismissed
//
// P9.3.1 — Classification layer:
// employeeKind: real_employee | former_employee | contractor | technical_record
//             | direction_record | synthetic_shared_teacher | unknown
// employeeType: teacher | educator | assistant_educator | administrator
//             | sales_manager | manager | kitchen | cleaner | methodologist
//             | contractor | other
// classificationStatus: classified | needs_review | excluded_from_staff_analytics
// directions: JSONB array of { name, source, lessons_count, groups_count }

export const employeesTable = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  employmentType: text("employment_type").default("employee"),
  status: text("status").default("active"),
  primaryRole: text("primary_role"),
  primaryDepartment: text("primary_department"),
  departmentId: uuid("department_id"),            // FK soft → departments.id
  startDate: date("start_date"),
  endDate: date("end_date"),
  inn: text("inn"),
  bankDetails: text("bank_details"),
  notes: text("notes"),
  // Revenue attribution — links to AlphaCRM teacher entity
  teacherCrmId: text("teacher_crm_id"),           // FK soft → crm_teachers.crm_id
  branchCrmId: text("branch_crm_id"),
  // Identity layer link
  personId: uuid("person_id"),                    // FK soft → persons.id
  isTestData: boolean("is_test_data").default(false),
  // P9.3.1 — Classification layer
  employeeKind: text("employee_kind"),
  employeeType: text("employee_type"),
  classificationStatus: text("classification_status"),
  classificationReason: text("classification_reason"),
  directions: jsonb("directions"),
  excludeFromStaffAnalytics: boolean("exclude_from_staff_analytics").default(false),
  // P9.4.1 — Attribution model: group_based | lesson_based | mixed | none | unknown
  attributionModel: text("attribution_model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Employee = typeof employeesTable.$inferSelect;
export type NewEmployee = typeof employeesTable.$inferInsert;

// ─── Employee Roles ───────────────────────────────────────────────────────────
// One employee can hold multiple roles simultaneously or historically.

export const employeeRolesTable = pgTable("employee_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull(),       // FK → employees.id
  roleName: text("role_name").notNull(),
  department: text("department"),
  departmentId: uuid("department_id"),             // FK soft → departments.id
  branchId: text("branch_id"),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type EmployeeRole = typeof employeeRolesTable.$inferSelect;
export type NewEmployeeRole = typeof employeeRolesTable.$inferInsert;

// ─── Payroll Rules ────────────────────────────────────────────────────────────
// Rules are stored only — auto-calculation is NOT implemented at this stage.
// ruleType: fixed_salary | per_child | per_lesson | per_hour | per_shift
//         | percent_of_revenue | manual_bonus | manual_penalty

export const payrollRulesTable = pgTable("payroll_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull(),       // FK → employees.id
  ruleType: text("rule_type").notNull().default("per_lesson"),
  amount: numeric("amount", { precision: 15, scale: 2 }),
  serviceId: uuid("service_id"),                  // nullable
  groupId: text("group_id"),                      // nullable, soft → crm_groups.crm_id
  department: text("department"),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type PayrollRule = typeof payrollRulesTable.$inferSelect;
export type NewPayrollRule = typeof payrollRulesTable.$inferInsert;

// ─── Employee Educational Unit Links ──────────────────────────────────────────
// P9.4.2 — Links employees to educational units.
// Separates group_based (educator → kindergarten/school class) from
// lesson_based (teacher → club/individual) attribution models.
//
// source:     alpha_crm | manual | inferred
// confidence: high | medium | low
// role_in_unit: educator | assistant_educator | class_teacher | curator
//             | teacher | assistant | unknown
// attribution_model: group_based | lesson_based | mixed | none
//
// Unique: employee_id + educational_unit_id + role_in_unit + valid_from
// manual links (source=manual) are never overwritten by auto-mapping.

export const employeeEducationalUnitLinksTable = pgTable(
  "employee_educational_unit_links",
  {
    id:                uuid("id").primaryKey().defaultRandom(),
    employeeId:        uuid("employee_id").notNull(),     // soft FK → employees.id
    educationalUnitId: uuid("educational_unit_id").notNull(), // soft FK → educational_units.id
    crmGroupId:        text("crm_group_id"),
    teacherCrmId:      text("teacher_crm_id"),
    roleInUnit:        text("role_in_unit").default("unknown"),
    attributionModel:  text("attribution_model"),
    isPrimary:         boolean("is_primary").default(false),
    source:            text("source").default("inferred"),
    confidence:        text("confidence").default("low"),
    validFrom:         date("valid_from"),
    validTo:           date("valid_to"),
    notes:             text("notes"),
    createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
);

export type EmployeeEducationalUnitLink =
  typeof employeeEducationalUnitLinksTable.$inferSelect;
export type NewEmployeeEducationalUnitLink =
  typeof employeeEducationalUnitLinksTable.$inferInsert;
