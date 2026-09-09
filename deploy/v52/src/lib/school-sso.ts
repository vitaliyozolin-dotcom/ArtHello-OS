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
  ARTHELLO_PUBLIC_ORIGIN?: string;
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

type CurrentSchoolAccessRow = {
  central_user_id: string;
  display_name: string;
  contact: string;
  user_status: string;
  user_access_version: number;
  school_role: string;
  school_status: string;
  school_access_version: number;
  central_status: string;
  central_access_version: number;
};

const CODE_TTL_SECONDS = 60;
const EXCHANGE_RATE_WINDOW_SECONDS = 60;
const EXCHANGE_RATE_WINDOW_REQUESTS = 60;
const EXCHANGE_RATE_LEASE_SECONDS = 5;
const CENTRAL_SYSTEM_ID = "SYS-ARTHELLO-OS";
export const SCHOOL_SYSTEM_ID = "SYS-SCHOOL-1-11";

export type SchoolSsoExchangeRateLease = {
  subjectHash: string;
  leaseUntil: number;
};

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

function canonicalExchangeOrigin(value: string | null) {
  if (!value) return "none";
  if (value.length > 512) return "invalid";
  try {
    const url = new URL(value);
    return url.username || url.password || url.pathname !== "/" || url.search || url.hash
      ? "invalid"
      : url.origin;
  } catch {
    return "invalid";
  }
}

function canonicalCloudflareIp(value: string | null) {
  const candidate = value?.trim().toLowerCase() ?? "";
  return candidate.length >= 3 && candidate.length <= 64 && /^[0-9a-f:.]+$/.test(candidate)
    ? candidate
    : "";
}

async function schoolSsoExchangeSubjectHash(request: Request) {
  const ip = canonicalCloudflareIp(request.headers.get("cf-connecting-ip"));
  const origin = canonicalExchangeOrigin(request.headers.get("origin"));
  // Cloudflare replaces CF-Connecting-IP at the trusted edge. Origin is used as
  // a bounded fallback for local/private runtimes where that header is absent.
  const source = ip ? `ip:${ip}` : `origin:${origin}`;
  return sha256(`arthello:school-sso-exchange-rate:v1:${source}`);
}

function safeReturnTo(value: unknown) {
  const route = typeof value === "string" ? value.trim() : "";
  return route.startsWith("/") &&
    !route.startsWith("//") &&
    !route.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(route)
    ? route
    : "/";
}

function activeStatus(value: string) {
  const normalized = value.trim().toLocaleLowerCase("ru-RU");
  return normalized === "активен" || normalized === "active" || normalized === "enabled";
}

export function normalizeSchoolRole(value: unknown): SchoolRole | null {
  const normalized = typeof value === "string"
    ? value.trim().toLocaleLowerCase("ru-RU")
    : "";
  if (normalized === "tech_admin" || normalized.includes("техничес"))
    return "tech_admin";
  if (normalized === "director" || normalized === "директор")
    return "director";
  if (normalized === "deputy" || normalized === "завуч")
    return "deputy";
  if (normalized === "admin" || normalized === "администратор школы")
    return "admin";
  if (
    normalized === "teacher" ||
    normalized === "учитель" ||
    normalized === "педагог"
  )
    return "teacher";
  return null;
}

export async function requireCurrentSchoolSsoIdentity(
  centralUserIdInput: unknown,
  issuedIdentity?: SchoolSsoIdentity,
): Promise<SchoolSsoIdentity> {
  const centralUserId = typeof centralUserIdInput === "string"
    ? centralUserIdInput.trim()
    : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(centralUserId))
    throw new Error("Учётная запись ArtHello OS не найдена");

  const row = await database()
    .prepare(
      `SELECT
        u.id AS central_user_id,
        u.display_name,
        u.contact,
        u.status AS user_status,
        u.access_version AS user_access_version,
        school_grant.role AS school_role,
        school_grant.status AS school_status,
        school_grant.access_version AS school_access_version,
        central_grant.status AS central_status,
        central_grant.access_version AS central_access_version
      FROM app_users u
      JOIN user_system_access school_grant
        ON school_grant.user_id = u.id AND school_grant.system_id = ?
      JOIN user_system_access central_grant
        ON central_grant.user_id = u.id AND central_grant.system_id = ?
      WHERE u.id = ?`,
    )
    .bind(SCHOOL_SYSTEM_ID, CENTRAL_SYSTEM_ID, centralUserId)
    .first<CurrentSchoolAccessRow>();

  if (
    !row ||
    !activeStatus(row.user_status) ||
    !activeStatus(row.school_status) ||
    !activeStatus(row.central_status)
  )
    throw new Error("Доступ к электронному дневнику не выдан");

  const role = normalizeSchoolRole(row.school_role);
  if (!role)
    throw new Error("Роль в электронном дневнике не настроена");

  const userAccessVersion = Number(row.user_access_version);
  const schoolAccessVersion = Number(row.school_access_version);
  const centralAccessVersion = Number(row.central_access_version);
  if (
    !Number.isSafeInteger(userAccessVersion) ||
    userAccessVersion < 1 ||
    schoolAccessVersion !== userAccessVersion ||
    centralAccessVersion !== userAccessVersion
  )
    throw new Error("Права доступа изменились. Начните вход в дневник заново");

  if (
    issuedIdentity &&
    (issuedIdentity.centralUserId !== row.central_user_id ||
      issuedIdentity.role !== role ||
      issuedIdentity.accessVersion !== userAccessVersion)
  )
    throw new Error("Права доступа изменились. Начните вход в дневник заново");

  return {
    centralUserId: row.central_user_id,
    displayName: row.display_name,
    contact: row.contact,
    role,
    accessVersion: userAccessVersion,
  };
}

function trustedHttpsOrigin(value: string | undefined, label: string) {
  const configured = value?.trim() ?? "";
  if (!configured) throw new Error(`${label} public origin is unavailable`);
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`${label} public origin is invalid`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`${label} public origin is invalid`);
  return url.origin;
}

export function artHelloPublicOrigin() {
  return trustedHttpsOrigin(runtimeEnv().ARTHELLO_PUBLIC_ORIGIN, "ArtHello");
}

export function schoolPublicOrigin() {
  return trustedHttpsOrigin(runtimeEnv().SCHOOL_PUBLIC_ORIGIN, "School");
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

export async function acquireSchoolSsoExchangeRateLease(
  request: Request,
): Promise<SchoolSsoExchangeRateLease | null> {
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS school_sso_exchange_rate_limits (
        subject_hash TEXT PRIMARY KEY NOT NULL,
        window_started_at INTEGER NOT NULL,
        request_count INTEGER NOT NULL,
        active_until INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    )
    .run();
  const now = nowSeconds();
  const windowCutoff = now - EXCHANGE_RATE_WINDOW_SECONDS;
  const leaseUntil = now + EXCHANGE_RATE_LEASE_SECONDS;
  const subjectHash = await schoolSsoExchangeSubjectHash(request);
  await db
    .prepare(
      "DELETE FROM school_sso_exchange_rate_limits WHERE expires_at <= ? AND active_until <= ?",
    )
    .bind(now, now)
    .run();
  const claimed = await db
    .prepare(
      `INSERT INTO school_sso_exchange_rate_limits
        (subject_hash,window_started_at,request_count,active_until,expires_at)
       VALUES (?,?,1,?,?)
       ON CONFLICT(subject_hash) DO UPDATE SET
         window_started_at=CASE
           WHEN school_sso_exchange_rate_limits.window_started_at<=?
             THEN excluded.window_started_at
           ELSE school_sso_exchange_rate_limits.window_started_at END,
         request_count=CASE
           WHEN school_sso_exchange_rate_limits.window_started_at<=? THEN 1
           ELSE school_sso_exchange_rate_limits.request_count+1 END,
         active_until=excluded.active_until,
         expires_at=excluded.expires_at
       WHERE school_sso_exchange_rate_limits.active_until<=?
         AND (school_sso_exchange_rate_limits.window_started_at<=?
           OR school_sso_exchange_rate_limits.request_count<?)
       RETURNING subject_hash`,
    )
    .bind(
      subjectHash,
      now,
      leaseUntil,
      now + EXCHANGE_RATE_WINDOW_SECONDS * 2,
      windowCutoff,
      windowCutoff,
      now,
      windowCutoff,
      EXCHANGE_RATE_WINDOW_REQUESTS,
    )
    .first<{ subject_hash: string }>();
  return claimed ? { subjectHash, leaseUntil } : null;
}

export async function releaseSchoolSsoExchangeRateLease(
  lease: SchoolSsoExchangeRateLease,
) {
  await database()
    .prepare(
      `UPDATE school_sso_exchange_rate_limits SET active_until=0
       WHERE subject_hash=? AND active_until=?`,
    )
    .bind(lease.subjectHash, lease.leaseUntil)
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
    !/^[A-Za-z0-9_-]{43,180}$/.test(code) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)
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
  const issuedIdentity = {
    centralUserId: row.central_user_id,
    displayName: row.display_name,
    contact: row.contact,
    role: row.school_role,
    accessVersion: row.access_version,
  } satisfies SchoolSsoIdentity;
  const currentIdentity = await requireCurrentSchoolSsoIdentity(
    row.central_user_id,
    issuedIdentity,
  );
  return {
    identity: currentIdentity,
    returnTo: safeReturnTo(row.return_to),
  };
}
