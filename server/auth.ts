import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import type { Role } from "../app/level-zero-types";
import { getDatabase } from "./database";

const SESSION_COOKIE = "atlas_school_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAX_FAILED_LOGINS = 5;

function derivePassword(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export type SessionUser = {
  id: string;
  email: string;
  phone: string;
  displayName: string;
  role: Role;
  linkedStudentId: string | null;
  status: string;
  authVersion: number;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePhone(value: unknown) {
  const input = typeof value === "string" ? value.trim() : "";
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8"))
    digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length < 8 || digits.length > 15)
    throw new Error("Введите корректный номер телефона");
  return `+${digits}`;
}

export function validatePassword(password: unknown) {
  const value = typeof password === "string" ? password : "";
  if (value.length < 10 || value.length > 128)
    throw new Error("Пароль должен содержать от 10 до 128 символов");
  if (!/[\p{L}]/u.test(value) || !/\d/.test(value))
    throw new Error("Добавьте в пароль хотя бы одну букву и одну цифру");
  return value;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, n, r, p, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltValue || !hashValue)
    return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await derivePassword(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    },
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

const ORIGIN_REJECTED = "Запрос отклонён системой безопасности";

function parseCanonicalOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(ORIGIN_REJECTED);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(ORIGIN_REJECTED);
  return url.origin;
}

function expectedRequestOrigin(request: Request) {
  const configuredOrigin = process.env.PUBLIC_APP_ORIGIN?.trim();
  return configuredOrigin
    ? parseCanonicalOrigin(configuredOrigin)
    : new URL(request.url).origin;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (parseCanonicalOrigin(origin) !== expectedRequestOrigin(request))
    throw new Error(ORIGIN_REJECTED);
}

export async function getSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const db = getDatabase();
  return db
    .prepare(
      `SELECT u.id, u.email, u.phone, u.display_name AS displayName, u.role,
      u.linked_student_id AS linkedStudentId, u.status, u.auth_version AS authVersion
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
      AND s.auth_version = u.auth_version AND u.status = 'active'`,
    )
    .bind(sha256(token))
    .first<SessionUser>();
}

export async function createSession(user: SessionUser, request: Request) {
  const db = getDatabase();
  const token = randomBytes(32).toString("base64url");
  const id = `session-${crypto.randomUUID()}`;
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();
  await db
    .prepare(
      "INSERT INTO auth_sessions (id, user_id, token_hash, auth_version, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, user.id, sha256(token), user.authVersion, expiresAt)
    .run();
  const secure = expectedRequestOrigin(request).startsWith("https://")
    ? "; Secure"
    : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export async function destroySession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token)
    await getDatabase()
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(sha256(token))
      .run();
  const secure = expectedRequestOrigin(request).startsWith("https://")
    ? "; Secure"
    : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function authenticate(
  loginInput: unknown,
  passwordInput: unknown,
) {
  const rawLogin = typeof loginInput === "string" ? loginInput.trim().toLowerCase() : "";
  const isEmail = rawLogin.includes("@");
  const phone = isEmail ? "" : normalizePhone(rawLogin);
  const email = isEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawLogin) ? rawLogin : "";
  if (isEmail && !email) throw new Error("Введите корректный email");
  const password = typeof passwordInput === "string" ? passwordInput : "";
  const db = getDatabase();
  const user = await db
    .prepare(
      `SELECT id, email, phone, display_name AS displayName, role,
      linked_student_id AS linkedStudentId, status, auth_version AS authVersion,
      password_hash AS passwordHash, password_state AS passwordState,
      failed_login_count AS failedLoginCount, locked_until AS lockedUntil
    FROM users WHERE ((? != '' AND phone = ?) OR (? != '' AND lower(email) = ?)) AND status = 'active'`,
    )
    .bind(phone, phone, email, email)
    .first<
      SessionUser & {
        passwordHash: string | null;
        passwordState: string;
        failedLoginCount: number;
        lockedUntil: string | null;
      }
    >();
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    throw new Error("Неверный логин или пароль");
  }
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now())
    throw new Error("Слишком много попыток. Повторите вход через 15 минут");
  if (user.passwordState !== "active")
    throw new Error("Сначала откройте одноразовую ссылку активации от школы");
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failures = Number(user.failedLoginCount || 0) + 1;
    const lockedUntil =
      failures >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : null;
    await db
      .prepare(
        "UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(failures, lockedUntil, user.id)
      .run();
    throw new Error("Неверный логин или пароль");
  }
  await db
    .prepare(
      "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(user.id)
    .run();
  return user;
}

export async function createCredentialToken(
  userId: string,
  createdByUserId: string,
  purpose: "activate" | "reset",
  origin: string,
) {
  const db = getDatabase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (purpose === "activate" ? 48 : 2) * 60 * 60 * 1000,
  ).toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE credential_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
      )
      .bind(userId, purpose),
    db
      .prepare(
        "INSERT INTO credential_tokens (id, user_id, token_hash, purpose, created_by_user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        `credential-${crypto.randomUUID()}`,
        userId,
        sha256(token),
        purpose,
        createdByUserId,
        expiresAt,
      ),
  ]);
  return {
    activationLink: `${origin}/activate?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

export async function activateCredential(
  tokenInput: unknown,
  passwordInput: unknown,
) {
  const token = typeof tokenInput === "string" ? tokenInput : "";
  if (token.length < 32 || token.length > 180)
    throw new Error("Ссылка активации недействительна");
  const password = validatePassword(passwordInput);
  const db = getDatabase();
  const credential = await db
    .prepare(
      `SELECT c.id, c.user_id AS userId, c.purpose, c.expires_at AS expiresAt,
      u.id, u.email, u.phone, u.display_name AS displayName, u.role,
      u.linked_student_id AS linkedStudentId, u.status, u.auth_version AS authVersion
    FROM credential_tokens c JOIN users u ON u.id = c.user_id
    WHERE c.token_hash = ? AND c.used_at IS NULL AND c.expires_at > CURRENT_TIMESTAMP AND u.status = 'active'`,
    )
    .bind(sha256(token))
    .first<
      SessionUser & { userId: string; purpose: string; expiresAt: string }
    >();
  if (!credential)
    throw new Error("Ссылка активации недействительна или уже использована");
  const passwordHash = await hashPassword(password);
  await db.batch([
    db
      .prepare(
        "UPDATE users SET password_hash = ?, password_state = 'active', auth_version = auth_version + 1, failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(passwordHash, credential.userId),
    db
      .prepare(
        "UPDATE credential_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(credential.id),
    db
      .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
      .bind(credential.userId),
  ]);
  return { ...credential, authVersion: Number(credential.authVersion) + 1 };
}
