import { env } from "cloudflare:workers";
import { getAuthenticatedSession } from "./production-auth";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = { prepare: (query: string) => D1Statement };
type AccessEnv = { DB: D1Database };

export type AccessRole =
  | "administrator" | "accountant" | "hr" | "teacher" | "methodologist"
  | "sales" | "content" | "lawyer" | "kitchen" | "medical" | "viewer";

const INVITE_TTL_SECONDS = 48 * 60 * 60;
const PBKDF2_ITERATIONS = 310_000;

function database() {
  const db = (env as unknown as AccessEnv).DB;
  if (!db) throw new Error("Production database is unavailable");
  return db;
}

export async function ensureAccessTables() {
  const db = database();
  await db.prepare(`CREATE TABLE IF NOT EXISTS access_employees (
    id TEXT PRIMARY KEY NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    position TEXT NOT NULL,
    branch TEXT NOT NULL,
    access_role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'invited',
    auth_user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_access_employees_phone ON access_employees(phone)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS access_invitations (
    id TEXT PRIMARY KEY NOT NULL,
    employee_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  )`).run();
  await db.prepare("DELETE FROM access_invitations WHERE expires_at <= ? AND used_at IS NULL")
    .bind(nowSeconds()).run();
}

export async function requireAccessAdmin(request: Request) {
  const session = await getAuthenticatedSession(request);
  if (!session || session.user.role !== "owner") throw new Error("Недостаточно прав");
  return session;
}

export async function listEmployees() {
  await ensureAccessTables();
  const rows = await database().prepare(`SELECT id,full_name,phone,email,position,branch,access_role,status,auth_user_id,created_at,updated_at
    FROM access_employees ORDER BY full_name COLLATE NOCASE`).all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function createEmployeeAndInvitation(input: Record<string, unknown>, origin: string) {
  await ensureAccessTables();
  const fullName = text(input.fullName);
  const phone = normalizePhone(input.phone);
  const email = text(input.email).toLowerCase();
  const position = text(input.position);
  const branch = text(input.branch);
  const role = text(input.role) as AccessRole;
  if (!fullName || !phone || !position || !branch) throw new Error("Заполните ФИО, телефон, должность и филиал");
  if (!ALLOWED_ROLES.has(role)) throw new Error("Некорректная роль доступа");

  const db = database();
  const existing = await db.prepare("SELECT id FROM access_employees WHERE phone=?").bind(phone).first<{ id: string }>();
  const employeeId = existing?.id ?? `EMP-${crypto.randomUUID()}`;
  const now = nowSeconds();
  if (existing) {
    await db.prepare(`UPDATE access_employees SET full_name=?,email=?,position=?,branch=?,access_role=?,status='invited',updated_at=? WHERE id=?`)
      .bind(fullName,email,position,branch,role,now,employeeId).run();
  } else {
    await db.prepare(`INSERT INTO access_employees (id,full_name,phone,email,position,branch,access_role,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'invited',?,?)`)
      .bind(employeeId,fullName,phone,email,position,branch,role,now,now).run();
  }
  await db.prepare("UPDATE access_invitations SET revoked_at=? WHERE employee_id=? AND used_at IS NULL AND revoked_at IS NULL")
    .bind(now,employeeId).run();

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const inviteId = `INV-${crypto.randomUUID()}`;
  const expiresAt = now + INVITE_TTL_SECONDS;
  await db.prepare(`INSERT INTO access_invitations (id,employee_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)`)
    .bind(inviteId,employeeId,tokenHash,expiresAt,now).run();

  const invitationUrl = `${origin.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
  return {
    employeeId,
    invitationUrl,
    expiresAt,
    smsText: `ArtHello OS: доступ для ${fullName}. Установите пароль по ссылке: ${invitationUrl}`,
  };
}

export async function getInvitation(token: string) {
  await ensureAccessTables();
  const hash = await sha256(token);
  const row = await database().prepare(`SELECT i.id,i.employee_id,i.expires_at,i.used_at,i.revoked_at,
      e.full_name,e.phone,e.position,e.branch,e.access_role
    FROM access_invitations i JOIN access_employees e ON e.id=i.employee_id WHERE i.token_hash=?`)
    .bind(hash).first<Record<string, unknown>>();
  if (!row || row.used_at || row.revoked_at || Number(row.expires_at) <= nowSeconds()) throw new Error("Ссылка недействительна или истекла");
  return row;
}

export async function acceptInvitation(token: string, passwordValue: unknown) {
  const invitation = await getInvitation(token);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  if (password.length < 12) throw new Error("Пароль должен содержать не менее 12 символов");

  const db = database();
  const employeeId = String(invitation.employee_id);
  const phone = String(invitation.phone);
  const existing = await db.prepare("SELECT user_id FROM production_auth_credentials WHERE login=? OR user_id=?")
    .bind(phone,employeeId).first<{ user_id: string }>();
  if (existing) throw new Error("Учётная запись уже активирована");

  const salt = randomToken(16);
  const passwordHash = await derivePasswordHash(password, salt);
  const now = nowSeconds();
  await db.prepare(`INSERT INTO production_auth_credentials
    (user_id,login,display_name,role,password_salt,password_hash,must_change_password,failed_attempts,locked_until,updated_at)
    VALUES (?,?,?,?,?,?,0,0,0,?)`)
    .bind(employeeId,phone,String(invitation.full_name),"viewer",salt,passwordHash,now).run();
  await db.prepare("UPDATE access_employees SET status='active',auth_user_id=?,updated_at=? WHERE id=?")
    .bind(employeeId,now,employeeId).run();
  await db.prepare("UPDATE access_invitations SET used_at=? WHERE id=?").bind(now,String(invitation.id)).run();
  return { login: phone, fullName: String(invitation.full_name), role: String(invitation.access_role) };
}

const ALLOWED_ROLES = new Set<AccessRole>([
  "administrator","accountant","hr","teacher","methodologist","sales","content","lawyer","kitchen","medical","viewer",
]);

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function normalizePhone(value: unknown) { return text(value).replace(/[^+\d]/g, ""); }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
function randomToken(length: number) {
  const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return base64Url(bytes);
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return base64Url(new Uint8Array(digest));
}
async function derivePasswordHash(password: string, saltText: string) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt:new TextEncoder().encode(saltText), iterations:PBKDF2_ITERATIONS }, material, 256);
  return base64Url(new Uint8Array(bits));
}
function base64Url(bytes: Uint8Array) {
  let binary=""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
