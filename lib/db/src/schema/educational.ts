import {
  pgTable, uuid, text, numeric, boolean, timestamp, date, integer,
} from "drizzle-orm/pg-core";

// ─── Directions (Направления) ─────────────────────────────────────────────────

export const directionsTable = pgTable("directions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull(),
  code:        text("code").unique(),
  color:       text("color").default("#7c3aed"),
  description: text("description"),
  sortOrder:   integer("sort_order").default(0),
  isActive:    boolean("is_active").default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Direction = typeof directionsTable.$inferSelect;
export type NewDirection = typeof directionsTable.$inferInsert;

// ─── Programs (Программы) ─────────────────────────────────────────────────────

export const programsTable = pgTable("programs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  name:            text("name").notNull(),
  directionId:     uuid("direction_id"),
  description:     text("description"),
  durationMonths:  integer("duration_months"),
  ageFrom:         integer("age_from"),
  ageTo:           integer("age_to"),
  pricePerMonth:   numeric("price_per_month",  { precision: 15, scale: 2 }),
  pricePerLesson:  numeric("price_per_lesson", { precision: 15, scale: 2 }),
  lessonsPerWeek:  integer("lessons_per_week").default(2),
  isActive:        boolean("is_active").default(true),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Program = typeof programsTable.$inferSelect;
export type NewProgram = typeof programsTable.$inferInsert;

// ─── Class Groups (Учебные группы) ───────────────────────────────────────────

export const classGroupsTable = pgTable("class_groups", {
  id:              uuid("id").primaryKey().defaultRandom(),
  name:            text("name").notNull(),
  directionId:     uuid("direction_id"),
  programId:       uuid("program_id"),
  branchCrmId:     text("branch_crm_id"),
  teacherCrmId:    text("teacher_crm_id"),
  level:           text("level").default("beginner"),
  maxStudents:     integer("max_students").default(12),
  currentStudents: integer("current_students").default(0),
  scheduleInfo:    text("schedule_info"),
  monthlyRevenue:  numeric("monthly_revenue", { precision: 15, scale: 2 }),
  isActive:        boolean("is_active").default(true),
  isTestData:      boolean("is_test_data").default(false),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type ClassGroup = typeof classGroupsTable.$inferSelect;
export type NewClassGroup = typeof classGroupsTable.$inferInsert;

// ─── Schedule Assignments (Расписание занятий → начисления) ──────────────────

export const scheduleAssignmentsTable = pgTable("schedule_assignments", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  teacherCrmId:        text("teacher_crm_id").notNull(),
  classGroupId:        uuid("class_group_id"),
  lessonDate:          date("lesson_date").notNull(),
  startTime:           text("start_time"),
  endTime:             text("end_time"),
  durationHours:       numeric("duration_hours", { precision: 4, scale: 2 }).default("1"),
  lessonType:          text("lesson_type").default("regular"),
  // regular | trial | makeup | cancelled | individual
  rateType:            text("rate_type").default("per_lesson"),
  // per_lesson | per_hour | fixed
  rateAmount:          numeric("rate_amount",  { precision: 15, scale: 2 }),
  totalAmount:         numeric("total_amount", { precision: 15, scale: 2 }),
  directionId:         uuid("direction_id"),
  branchCrmId:         text("branch_crm_id"),
  periodMonth:         text("period_month"),
  studentsCount:       integer("students_count").default(0),
  status:              text("status").default("scheduled"),
  // scheduled | completed | cancelled | no_show
  notes:               text("notes"),
  operationId:         uuid("operation_id"),
  isTestData:          boolean("is_test_data").default(false),
  createdAt:           timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type ScheduleAssignment = typeof scheduleAssignmentsTable.$inferSelect;
export type NewScheduleAssignment = typeof scheduleAssignmentsTable.$inferInsert;

// ─── Enrollments (Зачисления) ─────────────────────────────────────────────────

export const enrollmentsTable = pgTable("enrollments", {
  id:            uuid("id").primaryKey().defaultRandom(),
  studentCrmId:  text("student_crm_id").notNull(),
  classGroupId:  uuid("class_group_id").notNull(),
  enrolledAt:    date("enrolled_at").notNull(),
  unenrolledAt:  date("unenrolled_at"),
  status:        text("status").default("active"),
  // active | suspended | completed | withdrawn
  contractId:    uuid("contract_id"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Enrollment = typeof enrollmentsTable.$inferSelect;
export type NewEnrollment = typeof enrollmentsTable.$inferInsert;

// ─── Educational Units (Управленческая классификация групп) ──────────────────
// Links crm_groups to a management classification layer.
// educational_unit_type: kindergarten_group | school_class | club_subscription_group
//                      | master_class_group | summer_group | service_group | unknown
// attribution_model: group_based | lesson_based | mixed | none
// revenue_model: monthly_contract | subscription | per_lesson | one_time | unknown
// classification_status: classified | needs_review

export const educationalUnitsTable = pgTable("educational_units", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  crmGroupId:           text("crm_group_id").unique(),   // soft FK → crm_groups.crm_id
  name:                 text("name").notNull(),
  educationalUnitType:  text("educational_unit_type"),
  department:           text("department"),
  attributionModel:     text("attribution_model"),
  revenueModel:         text("revenue_model"),
  isActive:             boolean("is_active").default(true),
  classificationStatus: text("classification_status").default("classified"),
  classificationReason: text("classification_reason"),
  createdAt:            timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type EducationalUnit = typeof educationalUnitsTable.$inferSelect;
export type NewEducationalUnit = typeof educationalUnitsTable.$inferInsert;

// ─── Person Roles (Явные роли физлица) ───────────────────────────────────────

export const personRolesTable = pgTable("person_roles", {
  id:          uuid("id").primaryKey().defaultRandom(),
  personId:    uuid("person_id").notNull(),
  role:        text("role").notNull(),
  // parent | student | employee | teacher | external_teacher | contractor_contact | manager | accountant | founder
  contextId:   uuid("context_id"),
  contextType: text("context_type"),
  startDate:   date("start_date"),
  endDate:     date("end_date"),
  isActive:    boolean("is_active").default(true),
  notes:       text("notes"),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type PersonRole = typeof personRolesTable.$inferSelect;
