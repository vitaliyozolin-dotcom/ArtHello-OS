import { pool } from "@workspace/db";
import {
  isAuthRole,
  type AuthRole,
  type BusinessScope,
} from "./access-policy.js";

export interface AuthSession {
  role: AuthRole;
  name: string;
  csrfHash: string;
  scope: BusinessScope;
  expiresAt: Date;
}

export interface CreateSessionInput extends AuthSession {
  tokenHash: string;
}

export interface LoginLimit {
  blocked: boolean;
  retryAfterSeconds: number;
}

export interface AuthStore {
  createSession(input: CreateSessionInput): Promise<void>;
  getActiveSession(tokenHash: string): Promise<AuthSession | null>;
  revokeSession(tokenHash: string): Promise<void>;
  getLoginLimit(keyHash: string): Promise<LoginLimit>;
  recordLoginFailure(
    keyHash: string,
    maxAttempts: number,
    windowMs: number,
    lockMs: number,
  ): Promise<LoginLimit>;
  clearLoginFailures(keyHash: string): Promise<void>;
}

interface SessionRow {
  role: unknown;
  display_name: unknown;
  csrf_hash: unknown;
  scope_mode: unknown;
  branch_ids: unknown;
  legal_entity_ids: unknown;
  expires_at: Date | string;
}

function stringIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          candidate.length > 0 &&
          candidate.length <= 128,
      ),
    ),
  ];
}

export class PostgresAuthStore implements AuthStore {
  async createSession(input: CreateSessionInput): Promise<void> {
    await pool.query(
      `INSERT INTO auth_sessions (
        token_hash,
        role,
        display_name,
        csrf_hash,
        scope_mode,
        branch_ids,
        legal_entity_ids,
        expires_at,
        created_at,
        last_seen_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NOW(), NOW())`,
      [
        input.tokenHash,
        input.role,
        input.name,
        input.csrfHash,
        input.scope.unrestricted ? "unrestricted" : "restricted",
        JSON.stringify(input.scope.branchIds),
        JSON.stringify(input.scope.legalEntityIds),
        input.expiresAt,
      ],
    );

    await pool.query(
      `DELETE FROM auth_sessions
       WHERE expires_at <= NOW() OR revoked_at IS NOT NULL`,
    );
  }

  async getActiveSession(tokenHash: string): Promise<AuthSession | null> {
    const result = await pool.query<SessionRow>(
      `UPDATE auth_sessions
       SET last_seen_at = NOW()
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
       RETURNING
         role,
         display_name,
         csrf_hash,
         scope_mode,
         branch_ids,
         legal_entity_ids,
         expires_at`,
      [tokenHash],
    );

    const row = result.rows[0];
    if (
      !row ||
      !isAuthRole(row.role) ||
      typeof row.display_name !== "string" ||
      typeof row.csrf_hash !== "string"
    ) {
      return null;
    }

    return {
      role: row.role,
      name: row.display_name,
      csrfHash: row.csrf_hash,
      scope: {
        unrestricted: row.scope_mode === "unrestricted",
        branchIds: stringIdList(row.branch_ids),
        legalEntityIds: stringIdList(row.legal_entity_ids),
      },
      expiresAt:
        row.expires_at instanceof Date
          ? row.expires_at
          : new Date(row.expires_at),
    };
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await pool.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  async getLoginLimit(keyHash: string): Promise<LoginLimit> {
    const result = await pool.query<{ retry_after_seconds: number | string }>(
      `SELECT GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (blocked_until - NOW())))
        ) AS retry_after_seconds
       FROM auth_login_attempts
       WHERE key_hash = $1 AND blocked_until > NOW()`,
      [keyHash],
    );
    const retryAfterSeconds = Number(
      result.rows[0]?.retry_after_seconds ?? 0,
    );

    return {
      blocked: retryAfterSeconds > 0,
      retryAfterSeconds: Math.max(0, retryAfterSeconds),
    };
  }

  async recordLoginFailure(
    keyHash: string,
    maxAttempts: number,
    windowMs: number,
    lockMs: number,
  ): Promise<LoginLimit> {
    const result = await pool.query<{ retry_after_seconds: number | string }>(
      `INSERT INTO auth_login_attempts (
         key_hash,
         attempts,
         window_started_at,
         blocked_until,
         updated_at
       ) VALUES ($1, 1, NOW(), NULL, NOW())
       ON CONFLICT (key_hash) DO UPDATE SET
         attempts = CASE
           WHEN auth_login_attempts.window_started_at
                <= NOW() - ($3 * INTERVAL '1 millisecond')
             THEN 1
           ELSE auth_login_attempts.attempts + 1
         END,
         window_started_at = CASE
           WHEN auth_login_attempts.window_started_at
                <= NOW() - ($3 * INTERVAL '1 millisecond')
             THEN NOW()
           ELSE auth_login_attempts.window_started_at
         END,
         blocked_until = CASE
           WHEN auth_login_attempts.window_started_at
                <= NOW() - ($3 * INTERVAL '1 millisecond')
             THEN NULL
           WHEN auth_login_attempts.attempts + 1 >= $2
             THEN NOW() + ($4 * INTERVAL '1 millisecond')
           ELSE auth_login_attempts.blocked_until
         END,
         updated_at = NOW()
       RETURNING GREATEST(
         0,
         CEIL(EXTRACT(EPOCH FROM (blocked_until - NOW())))
       ) AS retry_after_seconds`,
      [keyHash, maxAttempts, windowMs, lockMs],
    );

    const retryAfterSeconds = Number(
      result.rows[0]?.retry_after_seconds ?? 0,
    );
    return {
      blocked: retryAfterSeconds > 0,
      retryAfterSeconds: Math.max(0, retryAfterSeconds),
    };
  }

  async clearLoginFailures(keyHash: string): Promise<void> {
    await pool.query(
      "DELETE FROM auth_login_attempts WHERE key_hash = $1",
      [keyHash],
    );
  }
}
