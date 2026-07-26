import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * ArtHello Front Office.
 *
 * This is deliberately isolated from transport-specific inbox tables. A
 * conversation is the durable business thread; lead, task and audit records
 * describe the work around it. No table below can initiate an outbound send.
 */
export const frontOfficeConversationsTable = pgTable(
  "front_office_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id").notNull().default("ARTHELLO"),
    externalKey: text("external_key").notNull(),
    kind: text("kind").notNull().default("lead"),
    channel: text("channel").notNull().default("internal"),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("P3"),
    contactDisplayName: text("contact_display_name").notNull(),
    contactPointMasked: text("contact_point_masked"),
    identityStatus: text("identity_status").notNull().default("not_required"),
    intent: text("intent"),
    service: text("service"),
    branchOrObject: text("branch_or_object"),
    ownerRole: text("owner_role"),
    ownerDisplayName: text("owner_display_name"),
    sourceLeadEventId: uuid("source_lead_event_id"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("front_office_conversations_project_external_uniq").on(
      table.projectId,
      table.externalKey,
    ),
    index("front_office_conversations_queue_idx").on(
      table.projectId,
      table.status,
      table.priority,
      table.lastMessageAt,
    ),
    index("front_office_conversations_owner_idx").on(
      table.projectId,
      table.ownerDisplayName,
      table.nextActionAt,
    ),
    check(
      "front_office_conversations_arthello_only",
      sql`${table.projectId} = 'ARTHELLO'`,
    ),
    check(
      "front_office_conversations_kind_check",
      sql`${table.kind} IN ('lead', 'support', 'incident')`,
    ),
    check(
      "front_office_conversations_status_check",
      sql`${table.status} IN ('open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed')`,
    ),
    check(
      "front_office_conversations_priority_check",
      sql`${table.priority} IN ('P0', 'P1', 'P2', 'P3', 'P4')`,
    ),
    check(
      "front_office_conversations_identity_check",
      sql`${table.identityStatus} IN ('not_required', 'verified', 'partial', 'failed')`,
    ),
  ],
);

export const frontOfficeMessagesTable = pgTable(
  "front_office_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => frontOfficeConversationsTable.id, {
        onDelete: "restrict",
      }),
    messageType: text("message_type").notNull(),
    direction: text("direction").notNull().default("internal"),
    body: text("body").notNull(),
    authorRole: text("author_role"),
    authorDisplayName: text("author_display_name"),
    factStatus: text("fact_status").notNull().default("UNVERIFIED"),
    sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default([]),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("front_office_messages_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    check(
      "front_office_messages_type_check",
      sql`${table.messageType} IN ('incoming', 'internal_note', 'ai_draft', 'system')`,
    ),
    check(
      "front_office_messages_direction_check",
      sql`${table.direction} IN ('incoming', 'internal')`,
    ),
    check(
      "front_office_messages_fact_status_check",
      sql`${table.factStatus} IN ('VERIFIED', 'PARTIAL', 'UNVERIFIED', 'CONFLICT', 'STALE')`,
    ),
  ],
);

export const frontOfficeLeadsTable = pgTable(
  "front_office_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => frontOfficeConversationsTable.id, {
        onDelete: "restrict",
      }),
    stage: text("stage").notNull().default("NEW"),
    source: text("source"),
    campaign: text("campaign"),
    childAgeBand: text("child_age_band"),
    branchPreference: text("branch_preference"),
    programInterest: text("program_interest"),
    ownerDisplayName: text("owner_display_name"),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    trialStatus: text("trial_status").notNull().default("not_requested"),
    trialAt: timestamp("trial_at", { withTimezone: true }),
    lossReason: text("loss_reason"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("front_office_leads_conversation_uniq").on(
      table.conversationId,
    ),
    index("front_office_leads_stage_idx").on(table.stage, table.nextActionAt),
    index("front_office_leads_owner_idx").on(
      table.ownerDisplayName,
      table.nextActionAt,
    ),
    check(
      "front_office_leads_stage_check",
      sql`${table.stage} IN ('NEW', 'QUALIFIED', 'PROGRAM_MATCHED', 'TRIAL_REQUESTED', 'TRIAL_CONFIRMED', 'WON', 'LOST')`,
    ),
    check(
      "front_office_leads_trial_status_check",
      sql`${table.trialStatus} IN ('not_requested', 'requested', 'confirmed', 'completed', 'cancelled')`,
    ),
  ],
);

export const frontOfficeTasksTable = pgTable(
  "front_office_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(
      () => frontOfficeConversationsTable.id,
      {
        onDelete: "restrict",
      },
    ),
    leadId: uuid("lead_id").references(() => frontOfficeLeadsTable.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    description: text("description"),
    ownerRole: text("owner_role").notNull(),
    ownerDisplayName: text("owner_display_name"),
    priority: text("priority").notNull().default("P3"),
    status: text("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("front_office_tasks_queue_idx").on(
      table.status,
      table.dueAt,
      table.priority,
    ),
    index("front_office_tasks_owner_idx").on(
      table.ownerDisplayName,
      table.status,
      table.dueAt,
    ),
    check(
      "front_office_tasks_status_check",
      sql`${table.status} IN ('open', 'done', 'cancelled')`,
    ),
    check(
      "front_office_tasks_priority_check",
      sql`${table.priority} IN ('P0', 'P1', 'P2', 'P3', 'P4')`,
    ),
  ],
);

export const frontOfficeAuditEventsTable = pgTable(
  "front_office_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    actorRole: text("actor_role").notNull(),
    actorDisplayName: text("actor_display_name"),
    beforeState: jsonb("before_state").$type<Record<string, unknown> | null>(),
    afterState: jsonb("after_state").$type<Record<string, unknown> | null>(),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("front_office_audit_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("front_office_audit_created_idx").on(table.createdAt),
  ],
);

export type FrontOfficeConversation =
  typeof frontOfficeConversationsTable.$inferSelect;
export type FrontOfficeMessage = typeof frontOfficeMessagesTable.$inferSelect;
export type FrontOfficeLead = typeof frontOfficeLeadsTable.$inferSelect;
export type FrontOfficeTask = typeof frontOfficeTasksTable.$inferSelect;
export type FrontOfficeAuditEvent =
  typeof frontOfficeAuditEventsTable.$inferSelect;
