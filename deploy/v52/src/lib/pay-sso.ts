import { env } from "cloudflare:workers";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Database = { prepare: (query: string) => D1Statement };

type RuntimeEnv = {
  DB: D1Database;
  ARTHELLO_PUBLIC_ORIGIN?: string;
  PAY_PUBLIC_ORIGIN?: string;
};

export const PAY_SYSTEM_ID = "SYS-ARTHELLO-PAY";
const CENTRAL_SYSTEM_ID = "SYS-ARTHELLO-OS";
const CODE_TTL_SECONDS = 60;
const RATE_WINDOW_SECONDS = 60;
const RATE_WINDOW_REQUESTS = 60;
const RATE_LEASE_SECONDS = 5;

export type PaySsoIdentity = {
  centralUserId: string;
  displayName: string;
  contact: string;
  role: "owner" | "payment_operator";
  accessVersion: number;
};

type CurrentPayAccessRow = {
  central_user_id: string;
  display_name: string;
  contact: string;
  app_role: string;
  is_administrative: number;
  user_status: string;
  user_access_version: number;
  central_status: string;
  central_access_version: number;
  pay_role: string | null;
  pay_status: string | null;
  pay_access_version: number | null;
};

type PayCodeRow = {
  central_user_id: string;
  display_name: string;
  contact: string;
  pay_role: "owner" | "payment_operator";
  access_version: number;
  return_to: string;
};

export type PaySsoExchangeRateLease = {
  subjectHash: string;
  leaseUntil: number;
};

function runtimeEnv() {
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

function activeStatus(value: string | null) {
  const normalized = value?.trim().toLocaleLowerCase("ru-RU") ?? "";
  return normalized === "активен" || normalized === "active" || normalized === "enabled";
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
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} public origin is invalid`);
  }
  return url.origin;
}

export function artHelloPublicOrigin() {
  return trustedHttpsOrigin(runtimeEnv().ARTHELLO_PUBLIC_ORIGIN, "ArtHello");
}

export function payPublicOrigin() {
  return trustedHttpsOrigin(runtimeEnv().PAY_PUBLIC_ORIGIN, "ArtHello Pay");
}

function safeReturnTo(value: unknown) {
  const route = typeof value === "string" ? value.trim() : "";
  return route.startsWith("/")
    && !route.startsWith("//")
    && !route.includes("\\")
    && !/[\u0000-\u001f\u007f]/.test(route)
    ? route
    : "/";
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export async function requireCurrentPaySsoIdentity(
  centralUserIdInput: unknown,
  issuedIdentity?: PaySsoIdentity,
): Promise<PaySsoIdentity> {
  const centralUserId = typeof centralUserIdInput === "string" ? centralUserIdInput.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(centralUserId)) {
    throw new Error("Учётная запись ArtHello OS не найдена");
  }

  const row = await database().prepare(`SELECT
      u.id AS central_user_id,u.display_name,u.contact,u.role AS app_role,
      u.is_administrative,u.status AS user_status,u.access_version AS user_access_version,
      central_grant.status AS central_status,central_grant.access_version AS central_access_version,
      pay_grant.role AS pay_role,pay_grant.status AS pay_status,
      pay_grant.access_version AS pay_access_version
    FROM app_users u
    JOIN user_system_access central_grant
      ON central_grant.user_id=u.id AND central_grant.system_id=?
    LEFT JOIN user_system_access pay_grant
      ON pay_grant.user_id=u.id AND pay_grant.system_id=?
    WHERE u.id=?`)
    .bind(CENTRAL_SYSTEM_ID, PAY_SYSTEM_ID, centralUserId)
    .first<CurrentPayAccessRow>();
  if (!row || !activeStatus(row.user_status) || !activeStatus(row.central_status)) {
    throw new Error("Доступ к ArtHello Pay не выдан");
  }

  const userVersion = Number(row.user_access_version);
  const centralVersion = Number(row.central_access_version);
  const canonicalOwner = row.central_user_id === "USR-OWNER"
    && row.app_role === "Собственник"
    && Boolean(row.is_administrative);
  const operator = Boolean(row.is_administrative)
    && row.pay_role === "payment_operator"
    && activeStatus(row.pay_status)
    && Number(row.pay_access_version) === userVersion;
  if (!canonicalOwner && !operator) throw new Error("Доступ к ArtHello Pay не выдан");
  if (!Number.isSafeInteger(userVersion) || userVersion < 1 || centralVersion !== userVersion) {
    throw new Error("Права доступа изменились. Начните вход в Pay заново");
  }

  const identity: PaySsoIdentity = {
    centralUserId: row.central_user_id,
    displayName: row.display_name,
    contact: row.contact,
    role: canonicalOwner ? "owner" : "payment_operator",
    accessVersion: userVersion,
  };
  if (issuedIdentity && (
    issuedIdentity.centralUserId !== identity.centralUserId
    || issuedIdentity.role !== identity.role
    || issuedIdentity.accessVersion !== identity.accessVersion
  )) throw new Error("Права доступа изменились. Начните вход в Pay заново");
  return identity;
}

async function ensurePaySsoTables() {
  const db = database();
  await db.prepare(`CREATE TABLE IF NOT EXISTS pay_sso_codes (
    code_hash TEXT PRIMARY KEY NOT NULL,
    central_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    contact TEXT NOT NULL,
    pay_role TEXT NOT NULL,
    access_version INTEGER NOT NULL,
    code_challenge TEXT NOT NULL,
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS pay_sso_codes_expiry_idx ON pay_sso_codes (expires_at,used_at)").run();
  await db.prepare("DELETE FROM pay_sso_codes WHERE expires_at<=? OR (used_at>0 AND used_at<=?)")
    .bind(nowSeconds() - 60, nowSeconds() - 15 * 60).run();
}

export async function issuePaySsoCode(identity: PaySsoIdentity, codeChallenge: string, returnToInput: unknown) {
  await ensurePaySsoTables();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) throw new Error("PKCE challenge is invalid");
  const code = randomToken(32);
  const now = nowSeconds();
  await database().prepare(`INSERT INTO pay_sso_codes
    (code_hash,central_user_id,display_name,contact,pay_role,access_version,
      code_challenge,return_to,expires_at,used_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,?)`)
    .bind(
      await sha256(code), identity.centralUserId, identity.displayName,
      identity.contact, identity.role, identity.accessVersion, codeChallenge,
      safeReturnTo(returnToInput), now + CODE_TTL_SECONDS, now,
    ).run();
  return { code, expiresInSeconds: CODE_TTL_SECONDS };
}

export async function exchangePaySsoCode(codeInput: unknown, verifierInput: unknown) {
  await ensurePaySsoTables();
  const code = typeof codeInput === "string" ? codeInput.trim() : "";
  const verifier = typeof verifierInput === "string" ? verifierInput.trim() : "";
  if (!/^[A-Za-z0-9_-]{43,180}$/.test(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
    throw new Error("Одноразовый код входа недействителен");
  }
  const now = nowSeconds();
  const row = await database().prepare(`UPDATE pay_sso_codes SET used_at=?
    WHERE code_hash=? AND code_challenge=? AND used_at=0 AND expires_at>?
    RETURNING central_user_id,display_name,contact,pay_role,access_version,return_to`)
    .bind(now, await sha256(code), await sha256(verifier), now)
    .first<PayCodeRow>();
  if (!row) throw new Error("Одноразовый код входа истёк или уже использован");
  const identity = await requireCurrentPaySsoIdentity(row.central_user_id, {
    centralUserId: row.central_user_id,
    displayName: row.display_name,
    contact: row.contact,
    role: row.pay_role,
    accessVersion: row.access_version,
  });
  return { identity, returnTo: safeReturnTo(row.return_to) };
}

function canonicalOrigin(value: string | null) {
  if (!value || value.length > 512) return "none";
  try {
    const url = new URL(value);
    return url.username || url.password || url.pathname !== "/" || url.search || url.hash ? "invalid" : url.origin;
  } catch {
    return "invalid";
  }
}

async function exchangeSubjectHash(request: Request) {
  const edgeIp = request.headers.get("cf-connecting-ip")?.trim().toLowerCase() ?? "";
  const ip = edgeIp.length >= 3 && edgeIp.length <= 64 && /^[0-9a-f:.]+$/.test(edgeIp) ? edgeIp : "";
  const source = ip ? `ip:${ip}` : `origin:${canonicalOrigin(request.headers.get("origin"))}`;
  return sha256(`arthello:pay-sso-exchange-rate:v1:${source}`);
}

export async function acquirePaySsoExchangeRateLease(request: Request): Promise<PaySsoExchangeRateLease | null> {
  const db = database();
  await db.prepare(`CREATE TABLE IF NOT EXISTS pay_sso_exchange_rate_limits (
    subject_hash TEXT PRIMARY KEY NOT NULL,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    active_until INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();
  const now = nowSeconds();
  const cutoff = now - RATE_WINDOW_SECONDS;
  const leaseUntil = now + RATE_LEASE_SECONDS;
  const subjectHash = await exchangeSubjectHash(request);
  await db.prepare("DELETE FROM pay_sso_exchange_rate_limits WHERE expires_at<=? AND active_until<=?")
    .bind(now, now).run();
  const claimed = await db.prepare(`INSERT INTO pay_sso_exchange_rate_limits
      (subject_hash,window_started_at,request_count,active_until,expires_at)
    VALUES (?,?,1,?,?)
    ON CONFLICT(subject_hash) DO UPDATE SET
      window_started_at=CASE WHEN pay_sso_exchange_rate_limits.window_started_at<=? THEN excluded.window_started_at ELSE pay_sso_exchange_rate_limits.window_started_at END,
      request_count=CASE WHEN pay_sso_exchange_rate_limits.window_started_at<=? THEN 1 ELSE pay_sso_exchange_rate_limits.request_count+1 END,
      active_until=excluded.active_until,expires_at=excluded.expires_at
    WHERE pay_sso_exchange_rate_limits.active_until<=?
      AND (pay_sso_exchange_rate_limits.window_started_at<=? OR pay_sso_exchange_rate_limits.request_count<?)
    RETURNING subject_hash`)
    .bind(subjectHash, now, leaseUntil, now + RATE_WINDOW_SECONDS * 2, cutoff, cutoff, now, cutoff, RATE_WINDOW_REQUESTS)
    .first<{ subject_hash: string }>();
  return claimed ? { subjectHash, leaseUntil } : null;
}

export async function releasePaySsoExchangeRateLease(lease: PaySsoExchangeRateLease) {
  await database().prepare(`UPDATE pay_sso_exchange_rate_limits SET active_until=0
    WHERE subject_hash=? AND active_until=?`)
    .bind(lease.subjectHash, lease.leaseUntil).run();
}
