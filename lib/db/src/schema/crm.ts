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
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crmBranchesTable = pgTable("crm_branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  crmId: text("crm_id").unique().notNull(),
  name: text("name"),
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const insertCrmBranchSchema = createInsertSchema(crmBranchesTable).omit({ id: true, syncedAt: true });
export type InsertCrmBranch = z.infer<typeof insertCrmBranchSchema>;
export type CrmBranch = typeof crmBranchesTable.$inferSelect;

export const crmStudentsTable = pgTable("crm_students", {
  id: uuid("id").primaryKey().defaultRandom(),
  crmId: text("crm_id").unique().notNull(),
  branchCrmId: text("branch_crm_id"),
  fullName: text("full_name"),
  status: text("status"),
  phone: text("phone"),
  email: text("email"),
  createdAtCrm: timestamp("created_at_crm", { withTimezone: true }),
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const insertCrmStudentSchema = createInsertSchema(crmStudentsTable).omit({ id: true, syncedAt: true });
export type InsertCrmStudent = z.infer<typeof insertCrmStudentSchema>;
export type CrmStudent = typeof crmStudentsTable.$inferSelect;

export const crmPaymentsTable = pgTable("crm_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  crmId: text("crm_id").unique().notNull(),
  branchCrmId: text("branch_crm_id"),
  studentCrmId: text("student_crm_id"),
  amount: numeric("amount"),
  paymentDate: date("payment_date"),
  type: text("type"),
  comment: text("comment"),
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const insertCrmPaymentSchema = createInsertSchema(crmPaymentsTable).omit({ id: true, syncedAt: true });
export type InsertCrmPayment = z.infer<typeof insertCrmPaymentSchema>;
export type CrmPayment = typeof crmPaymentsTable.$inferSelect;

export const crmLessonsTable = pgTable("crm_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  crmId: text("crm_id").unique().notNull(),
  branchCrmId: text("branch_crm_id"),
  groupCrmId: text("group_crm_id"),
  teacherCrmId: text("teacher_crm_id"),
  lessonDate: timestamp("lesson_date", { withTimezone: true }),
  title: text("title"),
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const insertCrmLessonSchema = createInsertSchema(crmLessonsTable).omit({ id: true, syncedAt: true });
export type InsertCrmLesson = z.infer<typeof insertCrmLessonSchema>;
export type CrmLesson = typeof crmLessonsTable.$inferSelect;

export const crmAttendanceTable = pgTable("crm_attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  lessonCrmId: text("lesson_crm_id"),
  studentCrmId: text("student_crm_id"),
  status: text("status"),
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const insertCrmAttendanceSchema = createInsertSchema(crmAttendanceTable).omit({ id: true, syncedAt: true });
export type InsertCrmAttendance = z.infer<typeof insertCrmAttendanceSchema>;
export type CrmAttendance = typeof crmAttendanceTable.$inferSelect;

// ─── Teachers ─────────────────────────────────────────────────────────────────

export const crmTeachersTable = pgTable("crm_teachers", {
  id: uuid("id").primaryKey().defaultRandom(),
  crmId: text("crm_id").unique().notNull(),
  branchCrmId: text("branch_crm_id"),
  fullName: text("full_name"),
  phone: text("phone"),
  email: text("email"),
  status: text("status"),   // 'active' | 'inactive' | etc from CRM
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export const insertCrmTeacherSchema = createInsertSchema(crmTeachersTable).omit({ id: true, syncedAt: true });
export type InsertCrmTeacher = z.infer<typeof insertCrmTeacherSchema>;
export type CrmTeacher = typeof crmTeachersTable.$inferSelect;

// ─── Marketing / Leads ────────────────────────────────────────────────────────

/**
 * Universal lead event table — all channels funnel into here.
 * Google Sheets rows, website forms, VK leads, Telegram, WhatsApp, etc.
 */
export const leadEventsTable = pgTable("lead_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  rawEventId: uuid("raw_event_id"),                    // FK to raw_events
  normalizedEventId: uuid("normalized_event_id"),      // FK to normalized_events
  sourceSystem: text("source_system").notNull(),       // 'google_sheets' | 'vk' | 'telegram' | 'site' | ...
  externalId: text("external_id"),                     // row number, VK lead id, etc.
  eventTime: timestamp("event_time", { withTimezone: true }),
  branchName: text("branch_name"),
  branchCrmId: text("branch_crm_id"),
  channel: text("channel"),                            // 'vk', 'instagram', 'site', 'referral', ...
  source: text("source"),                              // raw source string from sheet
  campaign: text("campaign"),
  clientName: text("client_name"),
  phone: text("phone"),
  email: text("email"),
  message: text("message"),
  status: text("status"),
  manager: text("manager"),
  raw: jsonb("raw"),
  matchedStudentCrmId: text("matched_student_crm_id"),
  matchedPaymentCrmId: text("matched_payment_crm_id"),
  duplicateCandidate: boolean("duplicate_candidate").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type LeadEvent = typeof leadEventsTable.$inferSelect;

/**
 * Google Sheets specific leads — also copied into lead_events.
 */
export const marketingLeadsTable = pgTable("marketing_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceSystem: text("source_system").default("google_sheets"),
  googleSheetId: text("google_sheet_id"),
  sheetName: text("sheet_name"),
  rowNumber: integer("row_number"),
  leadDate: date("lead_date"),
  branchName: text("branch_name"),
  branchCrmId: text("branch_crm_id"),
  channel: text("channel"),
  source: text("source"),
  campaign: text("campaign"),
  leadName: text("lead_name"),
  phone: text("phone"),
  message: text("message"),
  status: text("status"),
  manager: text("manager"),
  comment: text("comment"),
  duplicateCandidate: boolean("duplicate_candidate").default(false),
  leadEventId: uuid("lead_event_id"),                 // FK to lead_events
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
});

export type MarketingLead = typeof marketingLeadsTable.$inferSelect;

/**
 * Source normalisation map — raw source strings → canonical channel + source.
 */
export const marketingSourcesTable = pgTable("marketing_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  rawSource: text("raw_source").unique(),
  canonicalSource: text("canonical_source"),
  canonicalChannel: text("canonical_channel"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type MarketingSource = typeof marketingSourcesTable.$inferSelect;

// ─── Settings + Logs ──────────────────────────────────────────────────────────

export const settingsTable = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

export type Setting = typeof settingsTable.$inferSelect;

export const syncLogsTable = pgTable("sync_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  entity: text("entity").notNull(),
  status: text("status").notNull(),
  message: text("message").notNull(),
  recordsCount: integer("records_count"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rawError: jsonb("raw_error"),
});

export const insertSyncLogSchema = createInsertSchema(syncLogsTable).omit({ id: true, startedAt: true });
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type SyncLog = typeof syncLogsTable.$inferSelect;

export const crmGroupsTable = pgTable("crm_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  crmId: text("crm_id").unique().notNull(),
  branchCrmId: text("branch_crm_id"),
  name: text("name"),
  note: text("note"),
  bDate: text("b_date"),
  eDate: text("e_date"),
  capacity: integer("capacity"),
  teacherCrmIds: jsonb("teacher_crm_ids"),
  raw: jsonb("raw"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  lifecycleStatus: text("lifecycle_status"),
  alphaStatus: text("alpha_status"),
  rawRecordId: uuid("raw_record_id"),
  sourcePayloadHash: text("source_payload_hash"),
  createdAtCrm: timestamp("created_at_crm", { withTimezone: true }),
  updatedAtCrm: timestamp("updated_at_crm", { withTimezone: true }),
  inferredSubjectCrmId: text("inferred_subject_crm_id"),
  inferredSubjectName: text("inferred_subject_name"),
  subjectInferenceStatus: text("subject_inference_status"),
  subjectInferenceConfidence: numeric("subject_inference_confidence"),
});

export type CrmGroup = typeof crmGroupsTable.$inferSelect;

export const crmStudentIdentitiesTable = pgTable(
  "crm_student_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull(),
    alphaCustomerId: text("alpha_customer_id").notNull(),
    identityType: text("identity_type").notNull(),
    source: text("source").notNull(),
    studentId: uuid("student_id"),
    firstSeenLessonDate: date("first_seen_lesson_date"),
    lastSeenLessonDate: date("last_seen_lesson_date"),
    attendanceCount: integer("attendance_count").default(0),
    lessonCount: integer("lesson_count").default(0),
    groupIds: jsonb("group_ids"),
    subjectIds: jsonb("subject_ids"),
    teacherIds: jsonb("teacher_ids"),
    sampleLessonAlphaIds: jsonb("sample_lesson_alpha_ids"),
    resolutionStatus: text("resolution_status").notNull().default("unresolved"),
    confidence: text("confidence").notNull().default("medium"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique("crm_student_identities_uniq").on(t.branchId, t.alphaCustomerId),
  ],
);

export type CrmStudentIdentity = typeof crmStudentIdentitiesTable.$inferSelect;
