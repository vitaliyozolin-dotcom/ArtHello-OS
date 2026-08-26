import { env } from "cloudflare:workers";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

type ProductionEnv = {
  DB: D1Database;
  ARTHELLO_BOOTSTRAP_LOGIN?: string;
  ARTHELLO_BOOTSTRAP_PASSWORD?: string;
  ARTHELLO_BOOTSTRAP_RESET_VERSION?: string;
};

export type AuthUser = {
  role: "owner" | "accountant" | "viewer";
  name: string;
  mustChangePassword: boolean;
};

type CredentialRow = {
  user_id: string;
  login: string;
  display_name: string;
  role: AuthUser["role"];
  password_salt: string;
  password_hash: string;
  must_change_password: number;
  failed_attempts: number;
  locked_until: number;
};

type SessionRow = {
  token_hash: string;
  user_id: string;
  csrf_token: string;
  expires_at: number;
};

const SESSION_COOKIE = "__Host-arthello_session";
const CSRF_COOKIE = "__Host-arthello_csrf";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PBKDF2_ITERATIONS = 310_000;

function runtimeEnv(): ProductionEnv {
  return env as unknown as ProductionEnv;
}

function database(): D1Database {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("Production database is unavailable");
  return db;
}

export async function ensureAuthTables() {
  const db = database();
  await db.prepare(`CREATE TABLE IF NOT EXISTS production_auth_credentials (
    user_id TEXT PRIMARY KEY NOT NULL,
    login TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS production_auth_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS production_auth_bootstrap_resets (
    reset_version TEXT PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL
  )`).run();
  await applyBootstrapResetIfNeeded();
  await db.prepare("DELETE FROM production_auth_sessions WHERE expires_at <= ?")
    .bind(nowSeconds()).run();
}

async function applyBootstrapResetIfNeeded() {
  const runtime = runtimeEnv();
  const resetVersion = (runtime.ARTHELLO_BOOTSTRAP_RESET_VERSION ?? "").trim();
  if (!resetVersion) return;

  const db = database();
  const alreadyApplied = await db.prepare(
    "SELECT reset_version FROM production_auth_bootstrap_resets WHERE reset_version=?",
  ).bind(resetVersion).first<{ reset_version: string }>();
  if (alreadyApplied) return;

  const login = normalizeLogin(runtime.ARTHELLO_BOOTSTRAP_LOGIN ?? "owner");
  const password = runtime.ARTHELLO_BOOTSTRAP_PASSWORD ?? "";
  if (!login || !password) throw new Error("Owner recovery secret is unavailable");

  const salt = randomToken(16);
  const hash = await derivePasswordHash(password, salt);
  const userId = "AUTH-OWNER";
  await db.prepare(`INSERT INTO production_auth_credentials
    (user_id,login,display_name,role,password_salt,password_hash,must_change_password,failed_attempts,locked_until,updated_at)
    VALUES (?,?,?,?,?,?,1,0,0,?)
    ON CONFLICT(user_id) DO UPDATE SET
      login=excluded.login,
      display_name=excluded.display_name,
      role=excluded.role,
      password_salt=excluded.password_salt,
      password_hash=excluded.password_hash,
      must_change_password=1,
      failed_attempts=0,
      locked_until=0,
      updated_at=excluded.updated_at`)
    .bind(userId, login, "Виталий Озолин", "owner", salt, hash, nowSeconds()).run();
  await db.prepare("DELETE FROM production_auth_sessions WHERE user_id=?").bind(userId).run();
  await db.prepare(
    "INSERT INTO production_auth_bootstrap_resets (reset_version,applied_at) VALUES (?,?)",
  ).bind(resetVersion, nowSeconds()).run();
}

export async function authenticate(loginValue: unknown, passwordValue: unknown): Promise<{ user: AuthUser; token: string; csrf: string }> {
  await ensureAuthTables();
  const login = normalizeLogin(loginValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  if (!login || !password) throw new Error("Неверный логин или пароль");

  let credential = await findCredential(login);
  if (!credential) {
    credential = await createBootstrapCredential(login, password);
  }
  if (!credential) throw new Error("Неверный логин или пароль");

  if (credential.locked_until > nowSeconds()) {
    throw new Error("Слишком много попыток входа. Повторите через 15 минут.");
  }

  const calculated = await derivePasswordHash(password, credential.password_salt);
  if (!constantTimeEqual(calculated, credential.password_hash)) {
    const attempts = credential.failed_attempts + 1;
    const lockUntil = attempts >= 5 ? nowSeconds() + 15 * 60 : 0;
    await database().prepare(`UPDATE production_auth_credentials
      SET failed_attempts=?, locked_until=?, updated_at=? WHERE user_id=?`)
      .bind(attempts >= 5 ? 0 : attempts, lockUntil, nowSeconds(), credential.user_id).run();
    throw new Error("Неверный логин или пароль");
  }

  await database().prepare(`UPDATE production_auth_credentials
    SET failed_attempts=0, locked_until=0, updated_at=? WHERE user_id=?`)
    .bind(nowSeconds(), credential.user_id).run();

  const token = randomToken(32);
  const csrf = randomToken(24);
  const tokenHash = await sha256(token);
  await database().prepare(`INSERT INTO production_auth_sessions
    (token_hash,user_id,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)`)
    .bind(tokenHash, credential.user_id, csrf, nowSeconds() + SESSION_TTL_SECONDS, nowSeconds()).run();

  return { user: toAuthUser(credential), token, csrf };
}

export async function getAuthenticatedSession(request: Request): Promise<{ user: AuthUser; session: SessionRow } | null> {
  await ensureAuthTables();
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await database().prepare(`SELECT
      s.token_hash,s.user_id,s.csrf_token,s.expires_at,
      c.display_name,c.role,c.must_change_password
    FROM production_auth_sessions s
    JOIN production_auth_credentials c ON c.user_id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(tokenHash, nowSeconds())
    .first<SessionRow & { display_name: string; role: AuthUser["role"]; must_change_password: number }>();
  if (!row) return null;
  return {
    user: { role: row.role, name: row.display_name, mustChangePassword: Boolean(row.must_change_password) },
    session: { token_hash: row.token_hash, user_id: row.user_id, csrf_token: row.csrf_token, expires_at: row.expires_at },
  };
}

export async function changePassword(request: Request, currentValue: unknown, nextValue: unknown) {
  const authenticated = await getAuthenticatedSession(request);
  if (!authenticated) throw new Error("Сессия истекла. Войдите заново.");
  verifyCsrf(request, authenticated.session.csrf_token);

  const currentPassword = typeof currentValue === "string" ? currentValue : "";
  const newPassword = typeof nextValue === "string" ? nextValue : "";
  if (newPassword.length < 12) throw new Error("Новый пароль должен содержать не менее 12 символов");

  const credential = await database().prepare(`SELECT user_id,login,display_name,role,password_salt,password_hash,
    must_change_password,failed_attempts,locked_until FROM production_auth_credentials WHERE user_id=?`)
    .bind(authenticated.session.user_id).first<CredentialRow>();
  if (!credential) throw new Error("Учётная запись не найдена");

  const currentHash = await derivePasswordHash(currentPassword, credential.password_salt);
  if (!constantTimeEqual(currentHash, credential.password_hash)) throw new Error("Текущий пароль указан неверно");

  const salt = randomToken(16);
  const hash = await derivePasswordHash(newPassword, salt);
  await database().prepare(`UPDATE production_auth_credentials SET password_salt=?,password_hash=?,
    must_change_password=0,failed_attempts=0,locked_until=0,updated_at=? WHERE user_id=?`)
    .bind(salt, hash, nowSeconds(), credential.user_id).run();
  await database().prepare("DELETE FROM production_auth_sessions WHERE user_id=?")
    .bind(credential.user_id).run();
}

export async function logout(request: Request) {
  const authenticated = await getAuthenticatedSession(request);
  if (!authenticated) return;
  verifyCsrf(request, authenticated.session.csrf_token);
  await database().prepare("DELETE FROM production_auth_sessions WHERE token_hash=?")
    .bind(authenticated.session.token_hash).run();
}

export function appendAuthCookies(headers: Headers, token: string, csrf: string) {
  headers.append("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`);
  headers.append("set-cookie", `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; Secure; SameSite=Strict`);
}

export function appendClearedAuthCookies(headers: Headers) {
  headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  headers.append("set-cookie", `${CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Strict`);
}

async function findCredential(login: string) {
  return database().prepare(`SELECT user_id,login,display_name,role,password_salt,password_hash,
    must_change_password,failed_attempts,locked_until FROM production_auth_credentials WHERE login=?`)
    .bind(login).first<CredentialRow>();
}

async function createBootstrapCredential(login: string, password: string): Promise<CredentialRow | null> {
  const configuredLogin = normalizeLogin(runtimeEnv().ARTHELLO_BOOTSTRAP_LOGIN ?? "owner");
  const configuredPassword = runtimeEnv().ARTHELLO_BOOTSTRAP_PASSWORD ?? "";
  if (!configuredPassword || login !== configuredLogin || !constantTimeEqual(password, configuredPassword)) return null;

  const salt = randomToken(16);
  const hash = await derivePasswordHash(password, salt);
  const userId = "AUTH-OWNER";
  await database().prepare(`INSERT OR IGNORE INTO production_auth_credentials
    (user_id,login,display_name,role,password_salt,password_hash,must_change_password,failed_attempts,locked_until,updated_at)
    VALUES (?,?,?,?,?,?,1,0,0,?)`)
    .bind(userId, configuredLogin, "Владелец", "owner", salt, hash, nowSeconds()).run();
  return findCredential(configuredLogin);
}

function toAuthUser(row: CredentialRow): AuthUser {
  return { role: row.role, name: row.display_name, mustChangePassword: Boolean(row.must_change_password) };
}

function verifyCsrf(request: Request, expected: string) {
  const supplied = request.headers.get("x-csrf-token") ?? "";
  if (!supplied || !constantTimeEqual(supplied, expected)) throw new Error("Защитная сессия устарела. Войдите заново.");
}

function normalizeLogin(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  const prefix = `${name}=`;
  const item = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return null; }
}

async function derivePasswordHash(password: string, saltText: string) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new TextEncoder().encode(saltText),
    iterations: PBKDF2_ITERATIONS,
  }, material, 256);
  return base64Url(new Uint8Array(bits));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function randomToken(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
