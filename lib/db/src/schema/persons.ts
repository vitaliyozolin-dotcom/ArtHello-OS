import {
  pgTable,
  text,
  uuid,
  timestamp,
  numeric,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Persons ──────────────────────────────────────────────────────────────────
// Canonical unified identity — one row per real human being.
// isStudent = child enrolled in courses
// isParent  = guardian/legal representative (holds the phone number in AlphaCRM)
// isLead    = came in via marketing channel

export const personsTable = pgTable("persons", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  primaryPhone: text("primary_phone"),
  primaryEmail: text("primary_email"),
  confidenceScore: numeric("confidence_score"),
  isStudent: boolean("is_student").default(false),
  isParent: boolean("is_parent").default(false),
  isLead: boolean("is_lead").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Person = typeof personsTable.$inferSelect;

// ─── Person Contacts ──────────────────────────────────────────────────────────
// All known contact identifiers for a person (phones, emails, messengers).

export const personContactsTable = pgTable("person_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull(),
  contactType: text("contact_type").notNull(), // phone/email/telegram/whatsapp/vk
  contactValue: text("contact_value").notNull(), // raw as received
  normalizedValue: text("normalized_value"),    // E.164 for phones, lowercase for email
  isPrimary: boolean("is_primary").default(false),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type PersonContact = typeof personContactsTable.$inferSelect;

// ─── Person Links ─────────────────────────────────────────────────────────────
// Connects a person to any entity in the system.
// entity_type: student / lead / guardian_of / payment / bank_transaction / raw_event

export const personLinksTable = pgTable("person_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  sourceSystem: text("source_system"),
  confidence: numeric("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type PersonLink = typeof personLinksTable.$inferSelect;

// ─── Identity Match Queue ─────────────────────────────────────────────────────
// Items that need manual review before linking.

export const identityMatchQueueTable = pgTable("identity_match_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  rawEventId: uuid("raw_event_id"),
  leadEventId: uuid("lead_event_id"),
  suggestedPersonId: uuid("suggested_person_id"),
  matchReason: text("match_reason"),
  confidence: numeric("confidence"),
  status: text("status").notNull().default("new"), // new/auto_matched/manual_review/rejected/new_person
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type IdentityMatchQueueItem = typeof identityMatchQueueTable.$inferSelect;

// ─── Families ─────────────────────────────────────────────────────────────────
// One family = one guardian phone = one or more enrolled children (siblings).
// primary_guardian_person_id is the guardian person who "owns" the shared phone.

export const familiesTable = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  primaryGuardianPersonId: uuid("primary_guardian_person_id").unique(),
  familyName: text("family_name"),
  primaryPhone: text("primary_phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Family = typeof familiesTable.$inferSelect;

// ─── Student Profiles ─────────────────────────────────────────────────────────
// One row per CRM student (child). Bridges the CRM record to the identity layer.

export const studentProfilesTable = pgTable("student_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentCrmId: text("student_crm_id").unique().notNull(),
  studentPersonId: uuid("student_person_id"),
  familyId: uuid("family_id"),
  fullName: text("full_name"),
  dob: text("dob"),  // stored as 'YYYY-MM-DD' string from raw
  branchCrmId: text("branch_crm_id"),
  status: text("status"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type StudentProfile = typeof studentProfilesTable.$inferSelect;

// ─── Guardian–Student Links ───────────────────────────────────────────────────
// Many-to-many: one guardian may have multiple children, and in theory a child
// could have two guardian contacts (mother + father) from different sources.
// Unique on (guardian_person_id, student_crm_id) to prevent duplicate rows.

export const guardianStudentLinksTable = pgTable(
  "guardian_student_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guardianPersonId: uuid("guardian_person_id").notNull(),
    studentPersonId: uuid("student_person_id").notNull(),
    studentCrmId: text("student_crm_id"),
    familyId: uuid("family_id"),
    relationType: text("relation_type").default("guardian"),
    confidence: numeric("confidence"),
    sourceSystem: text("source_system").default("alphacrm"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqueGuardianStudent: uniqueIndex("gsl_guardian_student_crm_idx").on(
      t.guardianPersonId,
      t.studentCrmId,
    ),
  }),
);

export type GuardianStudentLink = typeof guardianStudentLinksTable.$inferSelect;
