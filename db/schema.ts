import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
};

export const students = sqliteTable("students", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  className: text("class_name").notNull(),
  birthYear: integer("birth_year"),
  avatarColor: text("avatar_color").notNull().default("#e84412"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  phone: text("phone").unique(),
  displayName: text("display_name").notNull(),
  role: text("role", {
    enum: [
      "director",
      "deputy",
      "admin",
      "teacher",
      "parent",
      "student",
      "tech_admin",
    ],
  }).notNull(),
  linkedStudentId: text("linked_student_id").references(() => students.id),
  status: text("status").notNull().default("active"),
  profileStatus: text("profile_status").notNull().default("confirmed"),
  notes: text("notes").notNull().default(""),
  passwordHash: text("password_hash"),
  passwordState: text("password_state").notNull().default("pending"),
  centralUserId: text("central_user_id").unique(),
  identitySource: text("identity_source").notNull().default("school_diary"),
  centralAccessVersion: integer("central_access_version").notNull().default(0),
  authVersion: integer("auth_version").notNull().default(1),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  ...timestamps,
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  authVersion: integer("auth_version").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const credentialTokens = sqliteTable("credential_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose", { enum: ["activate", "reset"] }).notNull(),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const centralAccessEvents = sqliteTable("central_access_events", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  centralUserId: text("central_user_id").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("received"),
  result: text("result").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: text("processed_at"),
});

export const schoolClasses = sqliteTable("school_classes", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  grade: integer("grade").notNull(),
  homeroomTeacherUserId: text("homeroom_teacher_user_id").references(
    () => users.id,
  ),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const userStudentLinks = sqliteTable("user_student_links", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  relation: text("relation").notNull().default("guardian"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const accountInvitations = sqliteTable("account_invitations", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  targetRole: text("target_role", { enum: ["parent", "student"] })
    .notNull()
    .default("parent"),
  studentId: text("student_id").references(() => students.id),
  className: text("class_name"),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const registrationRequests = sqliteTable("registration_requests", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  requestedRole: text("requested_role", { enum: ["parent", "student"] })
    .notNull()
    .default("parent"),
  studentFirstName: text("student_first_name").notNull(),
  studentLastName: text("student_last_name").notNull(),
  className: text("class_name").notNull(),
  relation: text("relation").notNull().default("guardian"),
  invitationId: text("invitation_id").references(() => accountInvitations.id),
  studentId: text("student_id").references(() => students.id),
  status: text("status").notNull().default("pending"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
});

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  color: text("color").notNull(),
  icon: text("icon").notNull(),
  stage: text("stage").notNull().default("5–8"),
  weeklyHours: integer("weekly_hours").notNull().default(1),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const teacherAssignments = sqliteTable("teacher_assignments", {
  id: text("id").primaryKey(),
  teacherUserId: text("teacher_user_id")
    .notNull()
    .references(() => users.id),
  className: text("class_name").notNull(),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  status: text("status").notNull().default("confirmed"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
});

export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  className: text("class_name").notNull(),
  weekday: integer("weekday").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  teacherUserId: text("teacher_user_id").references(() => users.id),
  room: text("room").notNull(),
  status: text("status").notNull().default("scheduled"),
  note: text("note"),
  ...timestamps,
});

export const grades = sqliteTable("grades", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  teacherUserId: text("teacher_user_id")
    .notNull()
    .references(() => users.id),
  value: integer("value").notNull(),
  weight: integer("weight").notNull().default(1),
  title: text("title").notNull(),
  gradeDate: text("grade_date").notNull(),
  comment: text("comment"),
  ...timestamps,
});

export const homework = sqliteTable("homework", {
  id: text("id").primaryKey(),
  className: text("class_name").notNull(),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  teacherUserId: text("teacher_user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  dueAt: text("due_at").notNull(),
  status: text("status").notNull().default("published"),
  ...timestamps,
});

export const achievements = sqliteTable("achievements", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  teacherUserId: text("teacher_user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  achievementDate: text("achievement_date").notNull(),
  ...timestamps,
});

export const teacherComments = sqliteTable("teacher_comments", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  teacherUserId: text("teacher_user_id")
    .notNull()
    .references(() => users.id),
  subjectId: text("subject_id").references(() => subjects.id),
  body: text("body").notNull(),
  visibility: text("visibility").notNull().default("parent"),
  commentDate: text("comment_date").notNull(),
  ...timestamps,
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  parentUserId: text("parent_user_id")
    .notNull()
    .references(() => users.id),
  teacherUserId: text("teacher_user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  ...timestamps,
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  authorUserId: text("author_user_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  readAt: text("read_at"),
  ...timestamps,
});

export const menuDays = sqliteTable("menu_days", {
  id: text("id").primaryKey(),
  dayDate: text("day_date").notNull().unique(),
  breakfast: text("breakfast").notNull(),
  lunch: text("lunch").notNull(),
  snack: text("snack").notNull(),
  allergens: text("allergens").notNull().default(""),
  ...timestamps,
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  startsAt: text("starts_at").notNull(),
  location: text("location").notNull(),
  audience: text("audience").notNull().default("all"),
  status: text("status").notNull().default("published"),
  capacity: integer("capacity"),
  ...timestamps,
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  schedule: text("schedule").notNull(),
  teacher: text("teacher").notNull(),
  price: integer("price").notNull().default(0),
  capacity: integer("capacity").notNull().default(0),
  enrolled: integer("enrolled").notNull().default(0),
  status: text("status").notNull().default("open"),
  ...timestamps,
});

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  name: text("name").notNull(),
  period: text("period").notNull(),
  status: text("status").notNull().default("active"),
  balance: integer("balance").notNull().default(0),
  lessonsLeft: integer("lessons_left").notNull().default(0),
  renewalAt: text("renewal_at"),
  ...timestamps,
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  details: text("details").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const programs = sqliteTable("programs", {
  id: text("id").primaryKey(),
  academicYear: text("academic_year").notNull(),
  className: text("class_name").notNull(),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  teacherUserId: text("teacher_user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  plannedLessons: integer("planned_lessons").notNull().default(0),
  completedLessons: integer("completed_lessons").notNull().default(0),
  reviewComment: text("review_comment").notNull().default(""),
  ...timestamps,
});

export const attendance = sqliteTable("attendance", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id")
    .notNull()
    .references(() => lessons.id),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  status: text("status").notNull().default("present"),
  note: text("note"),
  markedByUserId: text("marked_by_user_id")
    .notNull()
    .references(() => users.id),
  markedAt: text("marked_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  ...timestamps,
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  critical: integer("critical", { mode: "boolean" }).notNull().default(false),
  readAt: text("read_at"),
  ...timestamps,
});

export const gradeRevisions = sqliteTable("grade_revisions", {
  id: text("id").primaryKey(),
  gradeId: text("grade_id")
    .notNull()
    .references(() => grades.id),
  actorUserId: text("actor_user_id")
    .notNull()
    .references(() => users.id),
  oldValue: integer("old_value").notNull(),
  newValue: integer("new_value").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const menuRatings = sqliteTable("menu_ratings", {
  id: text("id").primaryKey(),
  menuDayId: text("menu_day_id")
    .notNull()
    .references(() => menuDays.id),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  meal: text("meal").notNull(),
  value: integer("value").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const consents = sqliteTable("consents", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  guardianUserId: text("guardian_user_id")
    .notNull()
    .references(() => users.id),
  consentType: text("consent_type").notNull(),
  status: text("status").notNull(),
  grantedAt: text("granted_at"),
  revokedAt: text("revoked_at"),
  source: text("source").notNull().default("manual"),
  ...timestamps,
});
