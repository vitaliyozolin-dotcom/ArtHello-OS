export const REQUIRED_SECURITY_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  auth_users: [
    "id", "employee_id", "login", "login_normalized", "display_name", "role", "password_hash",
    "scope_mode", "branch_ids", "legal_entity_ids", "is_active",
    "must_change_password", "password_changed_at", "created_by_user_id",
    "created_at", "updated_at",
  ],
  auth_sessions: [
    "token_hash", "user_id", "role", "display_name", "csrf_hash", "scope_mode",
    "branch_ids", "legal_entity_ids", "must_change_password", "expires_at",
    "created_at", "last_seen_at", "revoked_at",
  ],
  auth_login_attempts: ["key_hash", "attempts", "window_started_at", "blocked_until", "updated_at"],
  security_access_audit: [
    "id", "occurred_at", "session_fingerprint", "role", "method", "path",
    "decision", "policy", "branch_ids", "legal_entity_ids", "request_id",
  ],
  people_access_audit: [
    "id", "employee_id", "auth_user_id", "action", "plan_hash", "outcome",
    "requested_by_user_id", "evidence", "created_at",
  ],
};

export const REQUIRED_SECURITY_INDEXES = [
  "auth_users_login_normalized_uniq",
  "auth_users_employee_id_uniq",
  "auth_users_active_role_idx",
  "auth_sessions_expires_at_idx",
  "auth_sessions_user_id_idx",
  "auth_login_attempts_blocked_until_idx",
  "security_access_audit_occurred_at_idx",
  "security_access_audit_session_idx",
  "people_access_audit_employee_created_idx",
  "people_access_audit_auth_user_created_idx",
] as const;

export const REQUIRED_SECURITY_MIGRATIONS = [
  { timestamp: "1784855800331", hash: "b6249690fc7e5827aa543a2bfcfbfc1170a0183278492da161907c16c786efab" },
  { timestamp: "1784858251868", hash: "2394a6f7fa2f17c10d8b92560219a05fc1f054a327c133b278a17662087f1843" },
  { timestamp: "1787184000000", hash: "8a471a91e18919c1a9408394d1b26c551721fd66ca806f85faadd796403a3ca4" },
  { timestamp: "1787788800000", hash: "707a77fa43c5b6d30dd95f98f1db4cfba401995c77c80100093a8b755f056c5d" },
] as const;

export interface SecuritySchemaInventory {
  columns: ReadonlyArray<{ tableName: string; columnName: string }>;
  indexes: readonly string[];
  migrations: ReadonlyArray<{ timestamp: string; hash: string }>;
}

export class SecuritySchemaNotReadyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecuritySchemaNotReadyError";
  }
}

export function validateSecuritySchemaInventory(inventory: SecuritySchemaInventory): void {
  const columns = new Set(inventory.columns.map(({ tableName, columnName }) => `${tableName}.${columnName}`));
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SECURITY_TABLE_COLUMNS)) {
    for (const columnName of requiredColumns) {
      if (!columns.has(`${tableName}.${columnName}`)) {
        throw new SecuritySchemaNotReadyError(`Required security schema column is missing: ${tableName}.${columnName}`);
      }
    }
  }
  const indexes = new Set(inventory.indexes);
  for (const indexName of REQUIRED_SECURITY_INDEXES) {
    if (!indexes.has(indexName)) throw new SecuritySchemaNotReadyError(`Required security schema index is missing: ${indexName}`);
  }
  const migrations = new Set(inventory.migrations.map(({ timestamp, hash }) => `${timestamp}:${hash}`));
  for (const migration of REQUIRED_SECURITY_MIGRATIONS) {
    if (!migrations.has(`${migration.timestamp}:${migration.hash}`)) {
      throw new SecuritySchemaNotReadyError(`Required security migration is not recorded with its expected hash: ${migration.timestamp}`);
    }
  }
}
