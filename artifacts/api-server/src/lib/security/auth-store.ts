import { pool } from "@workspace/db";
import { isAuthRole, type AuthRole, type BusinessScope } from "./access-policy.js";

export interface AuthUser {
  id: string;
  login: string;
  passwordHash: string;
  role: AuthRole;
  name: string;
  scope: BusinessScope;
  active: boolean;
  mustChangePassword: boolean;
}

export interface AuthSession {
  userId: string;
  role: AuthRole;
  name: string;
  csrfHash: string;
  scope: BusinessScope;
  mustChangePassword: boolean;
  expiresAt: Date;
}

export interface CreateSessionInput extends AuthSession { tokenHash: string; }
export interface CreateUserInput {
  login: string;
  loginNormalized: string;
  passwordHash: string;
  role: AuthRole;
  name: string;
  scope: BusinessScope;
  mustChangePassword: boolean;
  createdByUserId?: string | null;
}
export interface LoginLimit { blocked: boolean; retryAfterSeconds: number; }

export interface AuthStore {
  getActiveUserByLogin(loginNormalized: string): Promise<AuthUser | null>;
  getUserById(userId: string): Promise<AuthUser | null>;
  listUsers(): Promise<Omit<AuthUser, "passwordHash">[]>;
  createUser(input: CreateUserInput): Promise<Omit<AuthUser, "passwordHash">>;
  updateUserPassword(userId: string, passwordHash: string, mustChangePassword: boolean): Promise<boolean>;
  setUserActive(userId: string, active: boolean): Promise<boolean>;
  countActiveOwners(): Promise<number>;
  createSession(input: CreateSessionInput): Promise<void>;
  getActiveSession(tokenHash: string): Promise<AuthSession | null>;
  revokeSession(tokenHash: string): Promise<void>;
  revokeSessionsForUser(userId: string, exceptTokenHash?: string): Promise<void>;
  getLoginLimit(keyHash: string): Promise<LoginLimit>;
  recordLoginFailure(keyHash: string, maxAttempts: number, windowMs: number, lockMs: number): Promise<LoginLimit>;
  clearLoginFailures(keyHash: string): Promise<void>;
}

interface UserRow {
  id: unknown; login: unknown; password_hash: unknown; role: unknown;
  display_name: unknown; scope_mode: unknown; branch_ids: unknown;
  legal_entity_ids: unknown; is_active: unknown; must_change_password: unknown;
}
interface SessionRow {
  user_id: unknown; role: unknown; display_name: unknown; csrf_hash: unknown;
  scope_mode: unknown; branch_ids: unknown; legal_entity_ids: unknown;
  must_change_password: unknown; expires_at: Date | string;
}

function stringIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 128))];
}

function parseUser(row: UserRow | undefined): AuthUser | null {
  if (
    !row || typeof row.id !== "string" || typeof row.login !== "string" ||
    typeof row.password_hash !== "string" || !isAuthRole(row.role) ||
    typeof row.display_name !== "string" || typeof row.is_active !== "boolean" ||
    typeof row.must_change_password !== "boolean"
  ) return null;
  return {
    id: row.id,
    login: row.login,
    passwordHash: row.password_hash,
    role: row.role,
    name: row.display_name,
    scope: {
      unrestricted: row.scope_mode === "unrestricted",
      branchIds: stringIdList(row.branch_ids),
      legalEntityIds: stringIdList(row.legal_entity_ids),
    },
    active: row.is_active,
    mustChangePassword: row.must_change_password,
  };
}

const USER_COLUMNS = `id, login, password_hash, role, display_name, scope_mode,
  branch_ids, legal_entity_ids, is_active, must_change_password`;

export class PostgresAuthStore implements AuthStore {
  async getActiveUserByLogin(loginNormalized: string): Promise<AuthUser | null> {
    const result = await pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM auth_users WHERE login_normalized = $1 AND is_active = TRUE`,
      [loginNormalized],
    );
    return parseUser(result.rows[0]);
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM auth_users WHERE id = $1`, [userId]);
    return parseUser(result.rows[0]);
  }

  async listUsers(): Promise<Omit<AuthUser, "passwordHash">[]> {
    const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM auth_users ORDER BY is_active DESC, display_name, login`);
    return result.rows.flatMap((row) => {
      const user = parseUser(row);
      if (!user) return [];
      const { passwordHash: _passwordHash, ...safe } = user;
      return [safe];
    });
  }

  async createUser(input: CreateUserInput): Promise<Omit<AuthUser, "passwordHash">> {
    const result = await pool.query<UserRow>(
      `INSERT INTO auth_users (
        login, login_normalized, password_hash, role, display_name, scope_mode,
        branch_ids, legal_entity_ids, is_active, must_change_password,
        password_changed_at, created_by_user_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,TRUE,$9,NOW(),$10,NOW(),NOW())
      RETURNING ${USER_COLUMNS}`,
      [input.login, input.loginNormalized, input.passwordHash, input.role, input.name,
       input.scope.unrestricted ? "unrestricted" : "restricted",
       JSON.stringify(input.scope.branchIds), JSON.stringify(input.scope.legalEntityIds),
       input.mustChangePassword, input.createdByUserId ?? null],
    );
    const user = parseUser(result.rows[0]);
    if (!user) throw new Error("Created auth user could not be parsed");
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  async updateUserPassword(userId: string, passwordHash: string, mustChangePassword: boolean): Promise<boolean> {
    const result = await pool.query(
      `UPDATE auth_users SET password_hash=$2, must_change_password=$3,
       password_changed_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [userId, passwordHash, mustChangePassword],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setUserActive(userId: string, active: boolean): Promise<boolean> {
    const result = await pool.query(
      `UPDATE auth_users SET is_active=$2, updated_at=NOW() WHERE id=$1`,
      [userId, active],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async countActiveOwners(): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM auth_users WHERE role='owner' AND is_active=TRUE`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    await pool.query(
      `INSERT INTO auth_sessions (
        token_hash,user_id,role,display_name,csrf_hash,scope_mode,branch_ids,
        legal_entity_ids,must_change_password,expires_at,created_at,last_seen_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,NOW(),NOW())`,
      [input.tokenHash,input.userId,input.role,input.name,input.csrfHash,
       input.scope.unrestricted ? "unrestricted" : "restricted",
       JSON.stringify(input.scope.branchIds),JSON.stringify(input.scope.legalEntityIds),
       input.mustChangePassword,input.expiresAt],
    );
    await pool.query(`DELETE FROM auth_sessions WHERE expires_at <= NOW() OR revoked_at IS NOT NULL`);
  }

  async getActiveSession(tokenHash: string): Promise<AuthSession | null> {
    const result = await pool.query<SessionRow>(
      `UPDATE auth_sessions s SET last_seen_at=NOW()
       FROM auth_users u
       WHERE s.token_hash=$1 AND s.user_id=u.id AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.is_active=TRUE
       RETURNING s.user_id,s.role,s.display_name,s.csrf_hash,s.scope_mode,
         s.branch_ids,s.legal_entity_ids,s.must_change_password,s.expires_at`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || typeof row.user_id !== "string" || !isAuthRole(row.role) ||
        typeof row.display_name !== "string" || typeof row.csrf_hash !== "string" ||
        typeof row.must_change_password !== "boolean") return null;
    return {
      userId: row.user_id, role: row.role, name: row.display_name,
      csrfHash: row.csrf_hash,
      scope: { unrestricted: row.scope_mode === "unrestricted", branchIds: stringIdList(row.branch_ids), legalEntityIds: stringIdList(row.legal_entity_ids) },
      mustChangePassword: row.must_change_password,
      expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
    };
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await pool.query(`UPDATE auth_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL`, [tokenHash]);
  }

  async revokeSessionsForUser(userId: string, exceptTokenHash?: string): Promise<void> {
    await pool.query(
      `UPDATE auth_sessions SET revoked_at=NOW()
       WHERE user_id=$1 AND revoked_at IS NULL AND ($2::text IS NULL OR token_hash<>$2)`,
      [userId, exceptTokenHash ?? null],
    );
  }

  async getLoginLimit(keyHash: string): Promise<LoginLimit> {
    const result = await pool.query<{ retry_after_seconds: number | string }>(
      `SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM (blocked_until-NOW())))) AS retry_after_seconds
       FROM auth_login_attempts WHERE key_hash=$1 AND blocked_until>NOW()`, [keyHash]);
    const retryAfterSeconds = Number(result.rows[0]?.retry_after_seconds ?? 0);
    return { blocked: retryAfterSeconds > 0, retryAfterSeconds: Math.max(0, retryAfterSeconds) };
  }

  async recordLoginFailure(keyHash: string, maxAttempts: number, windowMs: number, lockMs: number): Promise<LoginLimit> {
    const result = await pool.query<{ retry_after_seconds: number | string }>(
      `INSERT INTO auth_login_attempts (key_hash,attempts,window_started_at,blocked_until,updated_at)
       VALUES ($1,1,NOW(),NULL,NOW())
       ON CONFLICT (key_hash) DO UPDATE SET
         attempts=CASE WHEN auth_login_attempts.window_started_at<=NOW()-($3*INTERVAL '1 millisecond') THEN 1 ELSE auth_login_attempts.attempts+1 END,
         window_started_at=CASE WHEN auth_login_attempts.window_started_at<=NOW()-($3*INTERVAL '1 millisecond') THEN NOW() ELSE auth_login_attempts.window_started_at END,
         blocked_until=CASE WHEN auth_login_attempts.window_started_at<=NOW()-($3*INTERVAL '1 millisecond') THEN NULL WHEN auth_login_attempts.attempts+1 >= $2 THEN NOW()+($4*INTERVAL '1 millisecond') ELSE auth_login_attempts.blocked_until END,
         updated_at=NOW()
       RETURNING GREATEST(0,CEIL(EXTRACT(EPOCH FROM (blocked_until-NOW())))) AS retry_after_seconds`,
      [keyHash,maxAttempts,windowMs,lockMs],
    );
    const retryAfterSeconds = Number(result.rows[0]?.retry_after_seconds ?? 0);
    return { blocked: retryAfterSeconds > 0, retryAfterSeconds: Math.max(0, retryAfterSeconds) };
  }

  async clearLoginFailures(keyHash: string): Promise<void> {
    await pool.query("DELETE FROM auth_login_attempts WHERE key_hash=$1", [keyHash]);
  }
}
