import { env } from "cloudflare:workers";
import { API_ROLE_BY_APP_ROLE } from "./access-policy";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown[]>;
};

type ProductionEnv = {
  DB: D1Database;
  ARTHELLO_BOOTSTRAP_LOGIN?: string;
  ARTHELLO_BOOTSTRAP_PASSWORD?: string;
};

export type AuthUser = {
  userId: string;
  role: "owner" | "accountant" | "viewer";
  name: string;
  mustChangePassword: boolean;
  appRole: string;
  apiRole: string;
  isAdministrative: boolean;
  isSystemOwner: boolean;
  canAccessMedical: boolean;
};

type CredentialRow = {
  user_id: string;
  login: string;
  display_name: string;
  role: AuthUser["role"];
  password_salt: string;
  password_hash: string;
  must_change_password: number;
  temporary_password_expires_at: number;
  failed_attempts: number;
  locked_until: number;
};

type SessionRow = {
  token_hash: string;
  user_id: string;
  csrf_token: string;
  expires_at: number;
  access_version: number;
};

type AppAccessRow = {
  app_user_id: string;
  contact: string;
  display_name: string;
  app_role: string;
  app_status: string;
  is_administrative: number;
  grant_role: string;
  grant_status: string;
  user_access_version: number;
  grant_access_version: number;
  medical_access_granted: number;
};

export type AuthenticatedRequestContext = {
  actor: string;
  apiRole: string;
  appUserId: string;
  appUserName: string;
  accessVersion: number;
  auth: { user: AuthUser; session: SessionRow; access: AppAccessRow };
};

export type TemporaryCredential = {
  userId: string;
  displayName: string;
  login: string;
  temporaryPassword: string;
  expiresAt: string;
  mustChangePassword: true;
};

export class ProductionAuthAdminError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProductionAuthAdminError";
  }
}

const SESSION_COOKIE = "__Host-arthello_session";
const CSRF_COOKIE = "__Host-arthello_csrf";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const TEMPORARY_PASSWORD_TTL_SECONDS = 48 * 60 * 60;
const PBKDF2_ITERATIONS = 310_000;
const ARTHELLO_SYSTEM_ID = "SYS-ARTHELLO-OS";

let authTablesPromise: Promise<void> | undefined;

const API_ROLE_BY_GRANT = API_ROLE_BY_APP_ROLE;

function runtimeEnv(): ProductionEnv {
  return env as unknown as ProductionEnv;
}

function database(): D1Database {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("Production database is unavailable");
  return db;
}

export function ensureAuthTables() {
  if (!authTablesPromise) {
    authTablesPromise = initializeAuthTables().catch((error) => {
      authTablesPromise = undefined;
      throw error;
    });
  }
  return authTablesPromise;
}

export async function ensureBootstrapOwnerAccess() {
  const bootstrapPassword = runtimeEnv().ARTHELLO_BOOTSTRAP_PASSWORD ?? "";
  if (!bootstrapPassword) return;
  const bootstrapLogin = normalizeLogin(runtimeEnv().ARTHELLO_BOOTSTRAP_LOGIN ?? "owner");
  if (!bootstrapLogin) throw new Error("Production bootstrap login is unavailable");

  const db = database();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO app_systems
      (id,system_key,name,description,status,sort_order)
      VALUES (?,?,?,?,?,?)`)
      .bind(ARTHELLO_SYSTEM_ID, "ARTHELLO_OS", "ArtHello OS", "Основная операционная система", "Активна", 10),
    db.prepare(`INSERT OR IGNORE INTO app_users
      (id,contact_type,contact,display_name,role,is_administrative,status,invitation_status,access_version,invited_by,activated_at)
      VALUES (?,?,?,?,?,1,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(
        "USR-OWNER",
        bootstrapLogin.includes("@") ? "email" : "login",
        bootstrapLogin,
        "Виталий Озолин",
        "Собственник",
        "Активен",
        "Активирован",
        1,
        "production-bootstrap",
      ),
  ]);
  await db.prepare(`INSERT OR IGNORE INTO user_system_access
    (user_id,system_id,role,status,access_version,last_sync_status,granted_by)
    SELECT id,?,'Собственник','Активен',access_version,'Не требуется','production-bootstrap'
    FROM app_users WHERE id='USR-OWNER'`)
    .bind(ARTHELLO_SYSTEM_ID).run();
}

async function initializeAuthTables() {
  const db = database();
  await db.prepare(`CREATE TABLE IF NOT EXISTS production_auth_credentials (
    user_id TEXT PRIMARY KEY NOT NULL,
    login TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    temporary_password_expires_at INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS production_auth_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    access_version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`).run();
  await ensureColumn(
    "production_auth_credentials",
    "temporary_password_expires_at",
    "ALTER TABLE production_auth_credentials ADD COLUMN temporary_password_expires_at INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    "production_auth_sessions",
    "access_version",
    "ALTER TABLE production_auth_sessions ADD COLUMN access_version INTEGER NOT NULL DEFAULT 0",
  );
  await db.prepare("DELETE FROM production_auth_sessions WHERE expires_at <= ?")
    .bind(nowSeconds()).run();
}

async function ensureColumn(table: "production_auth_credentials" | "production_auth_sessions", column: string, alterSql: string) {
  const db = database();
  const hasColumn = async () => {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    return result.results.some((item) => item.name === column);
  };
  if (await hasColumn()) return;
  try {
    await db.prepare(alterSql).run();
  } catch (error) {
    // Several Cloudflare isolates can initialize concurrently. A duplicate-column
    // error is safe only after the schema is read again and the column is present.
    if (await hasColumn()) return;
    throw error;
  }
}

export async function authenticate(loginValue: unknown, passwordValue: unknown): Promise<{ user: AuthUser; token: string; csrf: string }> {
  await ensureAuthTables();
  const login = normalizeLogin(loginValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  if (!login || !password || password.length > 512) throw new Error("Неверный логин или пароль");

  let credential = await findCredential(login);
  if (!credential) credential = await createBootstrapCredential(login, password);
  if (!credential) throw new Error("Неверный логин или пароль");

  if (credential.locked_until > nowSeconds()) {
    throw new Error("Слишком много попыток входа. Повторите через 15 минут.");
  }

  const calculated = await derivePasswordHash(password, credential.password_salt);
  if (!constantTimeEqual(calculated, credential.password_hash)) {
    const failedAt = nowSeconds();
    await database().prepare(`UPDATE production_auth_credentials
      SET
        locked_until=CASE WHEN failed_attempts + 1 >= 5 THEN ? ELSE 0 END,
        failed_attempts=CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
        updated_at=?
      WHERE user_id=? AND locked_until<=?`)
      .bind(failedAt + 15 * 60, failedAt, credential.user_id, failedAt).run();
    throw new Error("Неверный логин или пароль");
  }

  if (credential.must_change_password
    && credential.temporary_password_expires_at > 0
    && credential.temporary_password_expires_at <= nowSeconds()) {
    throw new Error("Временный пароль истёк. Попросите владельца выдать новый.");
  }

  const access = await loadAppAccessByAuthUserId(credential.user_id);
  if (!isActiveAccess(access)
    || !credentialLoginMatchesAccess(credential.user_id, credential.login, access)) {
    throw new Error("Доступ к ArtHello OS не активирован");
  }

  await database().prepare(`UPDATE production_auth_credentials
    SET failed_attempts=0, locked_until=0, updated_at=? WHERE user_id=?`)
    .bind(nowSeconds(), credential.user_id).run();

  const token = randomToken(32);
  const csrf = randomToken(24);
  const tokenHash = await sha256(token);
  await database().prepare(`INSERT INTO production_auth_sessions
    (token_hash,user_id,csrf_token,expires_at,access_version,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(tokenHash, credential.user_id, csrf, nowSeconds() + SESSION_TTL_SECONDS, access.grant_access_version, nowSeconds()).run();

  return { user: toAuthUser(credential, access), token, csrf };
}

export async function getAuthenticatedSession(request: Request): Promise<{ user: AuthUser; session: SessionRow; access: AppAccessRow } | null> {
  await ensureAuthTables();
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await database().prepare(`SELECT
      s.token_hash,s.user_id,s.csrf_token,s.expires_at,s.access_version,
      c.login,c.display_name,c.role,c.must_change_password,c.temporary_password_expires_at
    FROM production_auth_sessions s
    JOIN production_auth_credentials c ON c.user_id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(tokenHash, nowSeconds())
    .first<SessionRow & {
      display_name: string;
      login: string;
      role: AuthUser["role"];
      must_change_password: number;
      temporary_password_expires_at: number;
    }>();
  if (!row) return null;

  const access = await loadAppAccessByAuthUserId(row.user_id);
  const temporaryPasswordExpired = Boolean(
    row.must_change_password
    && row.temporary_password_expires_at > 0
    && row.temporary_password_expires_at <= nowSeconds(),
  );
  if (!isActiveAccess(access)
    || row.access_version !== access.grant_access_version
    || !credentialLoginMatchesAccess(row.user_id, row.login, access)
    || temporaryPasswordExpired) {
    await database().prepare("DELETE FROM production_auth_sessions WHERE token_hash=?")
      .bind(row.token_hash).run();
    return null;
  }

  return {
    user: authUserFromAccess(access.display_name, row.must_change_password, access),
    session: {
      token_hash: row.token_hash,
      user_id: row.user_id,
      csrf_token: row.csrf_token,
      expires_at: row.expires_at,
      access_version: row.access_version,
    },
    access,
  };
}

export async function getAuthenticatedRequestContext(request: Request): Promise<AuthenticatedRequestContext | null> {
  const auth = await getAuthenticatedSession(request);
  if (!auth) return null;
  const access = auth.access;
  return {
    actor: access.contact,
    apiRole: apiRoleForGrant(access.grant_role),
    appUserId: access.app_user_id,
    appUserName: access.display_name,
    accessVersion: access.grant_access_version,
    auth,
  };
}

export function verifyAuthenticatedRequestCsrf(request: Request, context: AuthenticatedRequestContext) {
  verifyCsrf(request, context.auth.session.csrf_token);
}

export function isCanonicalOwnerContext(context: AuthenticatedRequestContext) {
  return isCanonicalOwnerAccess(context.auth.access) && context.apiRole === "OWNER";
}

export async function issueTemporaryCredential(
  requester: AuthenticatedRequestContext,
  targetUserIdValue: unknown,
): Promise<TemporaryCredential> {
  await ensureAuthTables();
  if (!isCanonicalOwnerContext(requester)) {
    throw new ProductionAuthAdminError("Только собственник может выдавать временный пароль", 403);
  }

  const targetUserId = normalizeUserId(targetUserIdValue);
  if (!targetUserId) throw new ProductionAuthAdminError("Не выбран сотрудник", 400);
  if (targetUserId === "USR-OWNER" || targetUserId === requester.appUserId) {
    throw new ProductionAuthAdminError("Пароль владельца меняется только в собственном профиле", 409);
  }

  const target = await loadAppAccessByAppUserId(targetUserId);
  if (!target) throw new ProductionAuthAdminError("Пользователь или доступ ArtHello OS не найден", 404);
  if (!isActiveAccess(target)) {
    throw new ProductionAuthAdminError("Сначала активируйте пользователя и доступ к ArtHello OS", 409);
  }
  if (apiRoleForGrant(target.grant_role) === "OWNER") {
    throw new ProductionAuthAdminError("Пароль собственника меняется только в собственном профиле", 409);
  }

  const login = normalizeLogin(target.contact);
  if (login.length < 3 || login.length > 160) {
    throw new ProductionAuthAdminError("В карточке сотрудника нет корректного логина", 409);
  }

  const loginCredential = await findCredential(login);
  if (loginCredential && appUserIdForAuthUser(loginCredential.user_id) !== target.app_user_id) {
    throw new ProductionAuthAdminError("Этот логин уже используется другой учётной записью", 409);
  }

  const temporaryPassword = randomToken(18);
  const salt = randomToken(16);
  const hash = await derivePasswordHash(temporaryPassword, salt);
  const issuedAt = nowSeconds();
  const expiresAt = issuedAt + TEMPORARY_PASSWORD_TTL_SECONDS;
  const coarseRole = coarseAuthRole(apiRoleForGrant(target.grant_role));
  const db = database();

  await db.batch([
    db.prepare(`INSERT INTO production_auth_credentials
      (user_id,login,display_name,role,password_salt,password_hash,must_change_password,temporary_password_expires_at,failed_attempts,locked_until,updated_at)
      VALUES (?,?,?,?,?,?,1,?,0,0,?)
      ON CONFLICT(user_id) DO UPDATE SET
        login=excluded.login,
        display_name=excluded.display_name,
        role=excluded.role,
        password_salt=excluded.password_salt,
        password_hash=excluded.password_hash,
        must_change_password=1,
        temporary_password_expires_at=excluded.temporary_password_expires_at,
        failed_attempts=0,
        locked_until=0,
        updated_at=excluded.updated_at`)
      .bind(target.app_user_id, login, target.display_name, coarseRole, salt, hash, expiresAt, issuedAt),
    db.prepare("DELETE FROM production_auth_sessions WHERE user_id=?").bind(target.app_user_id),
    db.prepare(`UPDATE app_users SET invitation_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind("Временный пароль выдан · ожидается смена", target.app_user_id),
    db.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
      VALUES (?,?,?,?,?)`)
      .bind(requester.actor, "production_auth.temporary_credential_issued", "app_user", target.app_user_id, JSON.stringify({
        systemId: ARTHELLO_SYSTEM_ID,
        accessVersion: target.grant_access_version,
        coarseRole,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        sessionsRevoked: true,
        mustChangePassword: true,
      })),
  ]);

  return {
    userId: target.app_user_id,
    displayName: target.display_name,
    login,
    temporaryPassword,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    mustChangePassword: true,
  };
}

export async function changePassword(request: Request, currentValue: unknown, nextValue: unknown) {
  const context = await getAuthenticatedRequestContext(request);
  if (!context) throw new Error("Сессия истекла. Войдите заново.");
  verifyCsrf(request, context.auth.session.csrf_token);

  const currentPassword = typeof currentValue === "string" ? currentValue : "";
  const newPassword = typeof nextValue === "string" ? nextValue : "";
  if (newPassword.length < 12) throw new Error("Новый пароль должен содержать не менее 12 символов");
  if (newPassword.length > 256) throw new Error("Новый пароль должен содержать не более 256 символов");

  const credential = await database().prepare(`SELECT user_id,login,display_name,role,password_salt,password_hash,
    must_change_password,temporary_password_expires_at,failed_attempts,locked_until
    FROM production_auth_credentials WHERE user_id=?`)
    .bind(context.auth.session.user_id).first<CredentialRow>();
  if (!credential) throw new Error("Учётная запись не найдена");

  const currentHash = await derivePasswordHash(currentPassword, credential.password_salt);
  if (!constantTimeEqual(currentHash, credential.password_hash)) throw new Error("Текущий пароль указан неверно");

  const salt = randomToken(16);
  const hash = await derivePasswordHash(newPassword, salt);
  const db = database();
  await db.batch([
    db.prepare(`UPDATE production_auth_credentials SET password_salt=?,password_hash=?,
      must_change_password=0,temporary_password_expires_at=0,failed_attempts=0,locked_until=0,updated_at=? WHERE user_id=?`)
      .bind(salt, hash, nowSeconds(), credential.user_id),
    db.prepare("DELETE FROM production_auth_sessions WHERE user_id=?").bind(credential.user_id),
    db.prepare(`UPDATE app_users SET invitation_status='Активирован',
      activated_at=CASE WHEN activated_at='' THEN CURRENT_TIMESTAMP ELSE activated_at END,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(context.appUserId),
    db.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
      VALUES (?,?,?,?,?)`)
      .bind(context.actor, "production_auth.password_changed", "app_user", context.appUserId, JSON.stringify({ sessionsRevoked: true })),
  ]);
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
    must_change_password,temporary_password_expires_at,failed_attempts,locked_until
    FROM production_auth_credentials WHERE login=?`)
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
    (user_id,login,display_name,role,password_salt,password_hash,must_change_password,temporary_password_expires_at,failed_attempts,locked_until,updated_at)
    VALUES (?,?,?,?,?,?,1,0,0,0,?)`)
    .bind(userId, configuredLogin, "Владелец", "owner", salt, hash, nowSeconds()).run();
  return findCredential(configuredLogin);
}

async function loadAppAccessByAuthUserId(authUserId: string) {
  return loadAppAccessByAppUserId(appUserIdForAuthUser(authUserId));
}

async function loadAppAccessByAppUserId(appUserId: string) {
  return database().prepare(`SELECT
      u.id AS app_user_id,u.contact,u.display_name,u.role AS app_role,u.status AS app_status,
      u.is_administrative,u.access_version AS user_access_version,
      g.role AS grant_role,g.status AS grant_status,g.access_version AS grant_access_version,
      CASE WHEN g.role='Медработник' AND EXISTS (
        SELECT 1 FROM medical_access_grants medical_grant
        WHERE medical_grant.principal_ref='ROLE:MEDICAL'
          AND medical_grant.scope='MEDICAL_FULL_SYNTHETIC'
          AND medical_grant.status='Активен'
          AND medical_grant.valid_until>=date('now')
      ) THEN 1 ELSE 0 END AS medical_access_granted
    FROM app_users u
    JOIN user_system_access g ON g.user_id=u.id AND g.system_id=?
    WHERE u.id=?`)
    .bind(ARTHELLO_SYSTEM_ID, appUserId)
    .first<AppAccessRow>();
}

function isActiveAccess(access: AppAccessRow | null): access is AppAccessRow {
  if (!access
    || access.app_status !== "Активен"
    || access.grant_status !== "Активен"
    || access.user_access_version !== access.grant_access_version
    || access.app_role !== access.grant_role
    || !API_ROLE_BY_GRANT[access.grant_role]) return false;

  const isOwner = access.grant_role === "Собственник";
  if (isOwner) return isCanonicalOwnerAccess(access);
  return access.app_user_id !== "USR-OWNER";
}

function isCanonicalOwnerAccess(access: AppAccessRow) {
  return access.app_user_id === "USR-OWNER"
    && Boolean(access.is_administrative)
    && access.app_role === "Собственник"
    && access.grant_role === "Собственник";
}

function credentialLoginMatchesAccess(authUserId: string, credentialLogin: string, access: AppAccessRow) {
  // The bootstrap owner deliberately has an AUTH-OWNER credential whose login
  // comes from the production secret rather than the editable app-user contact.
  if (authUserId === "AUTH-OWNER") return access.app_user_id === "USR-OWNER";
  return normalizeLogin(access.contact) === credentialLogin;
}

function appUserIdForAuthUser(authUserId: string) {
  return authUserId === "AUTH-OWNER" ? "USR-OWNER" : authUserId;
}

function apiRoleForGrant(grantRole: string) {
  return API_ROLE_BY_GRANT[grantRole] ?? "VIEWER";
}

function coarseAuthRole(apiRole: string): AuthUser["role"] {
  if (apiRole === "OWNER") return "owner";
  if (apiRole === "ACCOUNTING") return "accountant";
  return "viewer";
}

function normalizeUserId(value: unknown) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(id) ? id : "";
}

function toAuthUser(row: CredentialRow, access: AppAccessRow): AuthUser {
  return authUserFromAccess(access.display_name || row.display_name, row.must_change_password, access);
}

function authUserFromAccess(name: string, mustChangePassword: number, access: AppAccessRow): AuthUser {
  const apiRole = apiRoleForGrant(access.grant_role);
  return {
    userId: access.app_user_id,
    role: coarseAuthRole(apiRole),
    name,
    mustChangePassword: Boolean(mustChangePassword),
    appRole: access.grant_role,
    apiRole,
    isAdministrative: Boolean(access.is_administrative),
    isSystemOwner: isCanonicalOwnerAccess(access) && apiRole === "OWNER",
    canAccessMedical: apiRole === "MEDICAL" && Boolean(access.medical_access_granted),
  };
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
