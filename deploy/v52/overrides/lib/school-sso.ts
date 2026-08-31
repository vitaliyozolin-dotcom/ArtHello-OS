import { env } from "cloudflare:workers";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

type RuntimeEnv = {
  DB: D1Database;
  SCHOOL_PUBLIC_ORIGIN?: string;
};

export type SchoolRole =
  | "director"
  | "deputy"
  | "admin"
  | "teacher"
  | "tech_admin";

export type SchoolSsoIdentity = {
  centralUserId: string;
  displayName: string;
  contact: string;
  role: SchoolRole;
  accessVersion: number;
};

type SsoCodeRow = {
  central_user_id: string;
  display_name: string;
  contact: string;
  school_role: SchoolRole;
  access_version: number;
  code_challenge: string;
  return_to: string;
};

const CODE_TTL_SECONDS = 60;
const SCHOOL_FALLBACK_ORIGIN =
  "https://school-188-225-38-55.sslip.io";

function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

function database() {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("Production database is unavailable");
  return db;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomToken(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function safeReturnTo(value: unknown) {
  const route = typeof value === "string" ? value.trim() : "";
  return route.startsWith("/") && !route.startsWith("//") ? route : "/";
}

export function schoolPublicOrigin() {
  const value =
    runtimeEnv().SCHOOL_PUBLIC_ORIGIN?.trim() || SCHOOL_FALLBACK_ORIGIN;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("School public origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("School public origin is invalid");
  return url.origin;
}

export async function ensureSchoolSsoTable() {
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS school_sso_codes (
        code_hash TEXT PRIMARY KEY NOT NULL,
        central_user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        contact TEXT NOT NULL,
        school_role TEXT NOT NULL,
        access_version INTEGER NOT NULL,
        code_challenge TEXT NOT NULL,
        return_to TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS school_sso_codes_expiry_idx ON school_sso_codes (expires_at, used_at)",
    )
    .run();
  await db
    .prepare(
      "DELETE FROM school_sso_codes WHERE expires_at <= ? OR (used_at > 0 AND used_at <= ?)",
    )
    .bind(nowSeconds() - 60, nowSeconds() - 15 * 60)
    .run();
}

export async function issueSchoolSsoCode(
  identity: SchoolSsoIdentity,
  codeChallenge: string,
  returnToInput: unknown,
) {
  await ensureSchoolSsoTable();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge))
    throw new Error("PKCE challenge is invalid");
  const code = randomToken(32);
  const now = nowSeconds();
  await database()
    .prepare(
      `INSERT INTO school_sso_codes
        (code_hash, central_user_id, display_name, contact, school_role,
         access_version, code_challenge, return_to, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(
      await sha256(code),
      identity.centralUserId,
      identity.displayName,
      identity.contact,
      identity.role,
      Math.max(1, Math.trunc(identity.accessVersion)),
      codeChallenge,
      safeReturnTo(returnToInput),
      now + CODE_TTL_SECONDS,
      now,
    )
    .run();
  return { code, expiresInSeconds: CODE_TTL_SECONDS };
}

export async function exchangeSchoolSsoCode(
  codeInput: unknown,
  verifierInput: unknown,
) {
  await ensureSchoolSsoTable();
  const code = typeof codeInput === "string" ? codeInput.trim() : "";
  const verifier =
    typeof verifierInput === "string" ? verifierInput.trim() : "";
  if (
    !/^[A-Za-z0-9_-]{40,180}$/.test(code) ||
    !/^[A-Za-z0-9_-]{40,180}$/.test(verifier)
  )
    throw new Error("Одноразовый код входа недействителен");
  const now = nowSeconds();
  const challenge = await sha256(verifier);
  const row = await database()
    .prepare(
      `UPDATE school_sso_codes
       SET used_at = ?
       WHERE code_hash = ? AND code_challenge = ?
         AND used_at = 0 AND expires_at > ?
       RETURNING central_user_id, display_name, contact, school_role,
         access_version, code_challenge, return_to`,
    )
    .bind(now, await sha256(code), challenge, now)
    .first<SsoCodeRow>();
  if (!row) throw new Error("Одноразовый код входа истёк или уже использован");
  return {
    identity: {
      centralUserId: row.central_user_id,
      displayName: row.display_name,
      contact: row.contact,
      role: row.school_role,
      accessVersion: row.access_version,
    } satisfies SchoolSsoIdentity,
    returnTo: safeReturnTo(row.return_to),
  };
}
