import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    csrfHash: text("csrf_hash").notNull(),
    scopeMode: text("scope_mode").notNull().default("restricted"),
    branchIds: jsonb("branch_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    legalEntityIds: jsonb("legal_entity_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("auth_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const securityAccessAuditTable = pgTable(
  "security_access_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sessionFingerprint: text("session_fingerprint").notNull(),
    role: text("role").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    decision: text("decision").notNull(),
    policy: text("policy").notNull(),
    branchIds: jsonb("branch_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    legalEntityIds: jsonb("legal_entity_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    requestId: text("request_id"),
  },
  (table) => [
    index("security_access_audit_occurred_at_idx").on(table.occurredAt),
    index("security_access_audit_session_idx").on(
      table.sessionFingerprint,
    ),
  ],
);

export const authLoginAttemptsTable = pgTable(
  "auth_login_attempts",
  {
    keyHash: text("key_hash").primaryKey(),
    attempts: integer("attempts").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("auth_login_attempts_blocked_until_idx").on(table.blockedUntil),
  ],
);

export type AuthSessionRow = typeof authSessionsTable.$inferSelect;
export type SecurityAccessAuditRow =
  typeof securityAccessAuditTable.$inferSelect;
export type AuthLoginAttemptRow =
  typeof authLoginAttemptsTable.$inferSelect;
