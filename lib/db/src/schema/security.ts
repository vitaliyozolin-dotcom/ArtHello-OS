import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const authUsersTable = pgTable(
  "auth_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    login: text("login").notNull(),
    loginNormalized: text("login_normalized").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    scopeMode: text("scope_mode").notNull().default("restricted"),
    branchIds: jsonb("branch_ids").$type<string[]>().notNull().default([]),
    legalEntityIds: jsonb("legal_entity_ids").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_users_login_normalized_uniq").on(table.loginNormalized),
    index("auth_users_active_role_idx").on(table.isActive, table.role),
  ],
);

export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").references(() => authUsersTable.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    csrfHash: text("csrf_hash").notNull(),
    scopeMode: text("scope_mode").notNull().default("restricted"),
    branchIds: jsonb("branch_ids").$type<string[]>().notNull().default([]),
    legalEntityIds: jsonb("legal_entity_ids").$type<string[]>().notNull().default([]),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("auth_sessions_expires_at_idx").on(table.expiresAt), index("auth_sessions_user_id_idx").on(table.userId)],
);

export const securityAccessAuditTable = pgTable(
  "security_access_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    sessionFingerprint: text("session_fingerprint").notNull(),
    role: text("role").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    decision: text("decision").notNull(),
    policy: text("policy").notNull(),
    branchIds: jsonb("branch_ids").$type<string[]>().notNull().default([]),
    legalEntityIds: jsonb("legal_entity_ids").$type<string[]>().notNull().default([]),
    requestId: text("request_id"),
  },
  (table) => [index("security_access_audit_occurred_at_idx").on(table.occurredAt), index("security_access_audit_session_idx").on(table.sessionFingerprint)],
);

export const authLoginAttemptsTable = pgTable(
  "auth_login_attempts",
  {
    keyHash: text("key_hash").primaryKey(),
    attempts: integer("attempts").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_login_attempts_blocked_until_idx").on(table.blockedUntil)],
);

export type AuthUserRow = typeof authUsersTable.$inferSelect;
export type AuthSessionRow = typeof authSessionsTable.$inferSelect;
export type SecurityAccessAuditRow = typeof securityAccessAuditTable.$inferSelect;
export type AuthLoginAttemptRow = typeof authLoginAttemptsTable.$inferSelect;
