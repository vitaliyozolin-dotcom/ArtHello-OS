import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Role } from "../app/level-zero-types";
import {
  createSession,
  normalizePhone,
  type SessionUser,
} from "./auth";
import { ensureDatabaseReady, getDatabase } from "./database";

const PASSWORDLESS_TTL_SECONDS = 10 * 60;
const PASSWORDLESS_MAX_ATTEMPTS = 5;
const PASSWORDLESS_WINDOW_SECONDS = 10 * 60;
const PASSWORDLESS_MAX_REQUESTS_PER_TARGET = 3;
const PASSWORDLESS_MAX_REQUESTS_PER_IP = 12;
const GENERIC_PASSWORDLESS_MESSAGE =
  "Если доступ найден, код уже отправлен по указанному контакту.";

const staffRoles = new Set<Role>([
  "director",
  "deputy",
  "admin",
  "teacher",
  "tech_admin",
]);
const familyRoles = new Set<Role>(["parent", "student"]);

type Identifier = {
  kind: "phone" | "email";
  value: string;
};

type UserRow = SessionUser & {
  centralUserId: string | null;
  centralAccessVersion: number;
};

type ChallengeRow = {
  userId: string;
  returnTo: string;
};

export type CentralStaffIdentity = {
  centralUserId: string;
  displayName: string;
  contact: string;
  role: Role;
  accessVersion: number;
};

export type PasswordlessRequestResult = {
  challengeId: string;
  channel: "sms" | "email";
  maskedTarget: string;
  expiresInSeconds: number;
  message: string;
};

export type PasswordlessCompletion = {
  cookie: string;
  returnTo: string;
  user: SessionUser;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function safeReturnTo(value: unknown) {
  const route = typeof value === "string" ? value.trim() : "";
  return route.startsWith("/") && !route.startsWith("//") ? route : "/";
}

function publicOrigin(request: Request) {
  return (process.env.PUBLIC_APP_ORIGIN || new URL(request.url).origin).replace(
    /\/$/,
    "",
  );
}

function secretMaterial() {
  const value =
    process.env.PASSWORDLESS_PEPPER?.trim() ||
    process.env.CENTRAL_ACCESS_SECRET?.trim() ||
    "";
  if (value.length < 32)
    throw new Error("Защитный ключ passwordless-входа не настроен");
  return value;
}

function hmac(value: string) {
  return createHmac("sha256", secretMaterial()).update(value).digest("hex");
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeIdentifier(input: unknown): Identifier {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (raw.includes("@")) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))
      throw new Error("Введите корректный email");
    return { kind: "email", value: raw };
  }
  return { kind: "phone", value: normalizePhone(raw) };
}

function maskIdentifier(identifier: Identifier) {
  if (identifier.kind === "email") {
    const [local, domain] = identifier.value.split("@");
    const visible = local.length <= 2 ? local[0] || "*" : local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
  }
  return `${identifier.value.slice(0, 2)} *** *** ${identifier.value.slice(-4)}`;
}

function requestIpHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return hmac(`ip:${ip}`);
}

function deliveryConfig() {
  const urlText = process.env.PASSWORDLESS_DELIVERY_URL?.trim() || "";
  const token = process.env.PASSWORDLESS_DELIVERY_TOKEN?.trim() || "";
  if (!urlText || token.length < 32)
    throw new Error("Канал отправки кода временно недоступен");
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new Error("Канал отправки кода временно недоступен");
  }
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment)
    throw new Error("Канал отправки кода временно недоступен");
  return { url: url.toString(), token };
}

async function findFamilyUser(identifier: Identifier) {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, email, COALESCE(phone, '') AS phone,
        display_name AS displayName, role,
        linked_student_id AS linkedStudentId, status,
        auth_version AS authVersion,
        central_user_id AS centralUserId,
        central_access_version AS centralAccessVersion
      FROM users
      WHERE status = 'active'
        AND role IN ('parent', 'student')
        AND ((? = 'phone' AND phone = ?) OR (? = 'email' AND lower(email) = ?))
      LIMIT 1`,
    )
    .bind(identifier.kind, identifier.value, identifier.kind, identifier.value)
    .first<UserRow>();
}

async function findActiveUserById(userId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, email, COALESCE(phone, '') AS phone,
        display_name AS displayName, role,
        linked_student_id AS linkedStudentId, status,
        auth_version AS authVersion,
        central_user_id AS centralUserId,
        central_access_version AS centralAccessVersion
      FROM users WHERE id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(userId)
    .first<UserRow>();
}

async function assertRequestRate(
  identifierHash: string,
  ipHash: string,
  now: number,
) {
  const db = getDatabase();
  const since = now - PASSWORDLESS_WINDOW_SECONDS;
  const target = await db
    .prepare(
      "SELECT count(*) AS count FROM passwordless_challenges WHERE identifier_hash = ? AND created_at >= ?",
    )
    .bind(identifierHash, since)
    .first<{ count: number }>();
  const source = await db
    .prepare(
      "SELECT count(*) AS count FROM passwordless_challenges WHERE request_ip_hash = ? AND created_at >= ?",
    )
    .bind(ipHash, since)
    .first<{ count: number }>();
  if (
    Number(target?.count || 0) >= PASSWORDLESS_MAX_REQUESTS_PER_TARGET ||
    Number(source?.count || 0) >= PASSWORDLESS_MAX_REQUESTS_PER_IP
  )
    throw new Error("Слишком много запросов. Повторите через 10 минут");
}

async function createChallenge(
  user: UserRow,
  identifier: Identifier,
  request: Request,
  returnTo: string,
) {
  const now = nowSeconds();
  const id = `passwordless-${randomUUID()}`;
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const magicToken = randomBytes(32).toString("base64url");
  const identifierHash = hmac(`identifier:${identifier.kind}:${identifier.value}`);
  const ipHash = requestIpHash(request);
  await assertRequestRate(identifierHash, ipHash, now);

  const db = getDatabase();
  await db
    .prepare(
      "UPDATE passwordless_challenges SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
    )
    .bind(now, user.id)
    .run();
  await db
    .prepare(
      `INSERT INTO passwordless_challenges
        (id, user_id, identifier_hash, channel, code_hash,
         magic_token_hash, return_to, expires_at, attempts,
         max_attempts, request_ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(
      id,
      user.id,
      identifierHash,
      identifier.kind === "phone" ? "sms" : "email",
      hmac(`otp:${id}:${code}`),
      hmac(`magic:${magicToken}`),
      safeReturnTo(returnTo),
      now + PASSWORDLESS_TTL_SECONDS,
      PASSWORDLESS_MAX_ATTEMPTS,
      ipHash,
      now,
    )
    .run();

  const magicLink = `${publicOrigin(request)}/api/auth/passwordless/magic?token=${encodeURIComponent(magicToken)}`;
  return {
    id,
    code,
    magicLink,
    expiresAt: now + PASSWORDLESS_TTL_SECONDS,
    channel: identifier.kind === "phone" ? ("sms" as const) : ("email" as const),
  };
}

async function deliverChallenge(input: {
  challengeId: string;
  channel: "sms" | "email";
  target: string;
  code: string;
  magicLink: string;
  expiresAt: number;
}) {
  const config = deliveryConfig();
  const payload = JSON.stringify({
    eventId: input.challengeId,
    purpose: "school_login",
    channel: input.channel,
    target: input.target,
    code: input.code,
    magicLink: input.magicLink,
    expiresAt: new Date(input.expiresAt * 1000).toISOString(),
    message:
      input.channel === "sms"
        ? `Школа 1–11: код входа ${input.code}. Никому его не сообщайте.`
        : `Код входа в дневник: ${input.code}. Также можно открыть одноразовую ссылку: ${input.magicLink}`,
  });
  const timestamp = String(nowSeconds());
  const signature = createHmac("sha256", config.token)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-arthello-timestamp": timestamp,
      "x-arthello-signature": signature,
    },
    body: payload,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    await response.arrayBuffer();
    throw new Error("Канал отправки кода временно недоступен");
  }
}

export async function requestPasswordlessLogin(
  identifierInput: unknown,
  request: Request,
  returnToInput: unknown,
): Promise<PasswordlessRequestResult> {
  await ensureDatabaseReady();
  deliveryConfig();
  const identifier = normalizeIdentifier(identifierInput);
  const user = await findFamilyUser(identifier);
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 260));
    return {
      challengeId: `unresolved-${randomBytes(18).toString("base64url")}`,
      channel: identifier.kind === "phone" ? "sms" : "email",
      maskedTarget: maskIdentifier(identifier),
      expiresInSeconds: PASSWORDLESS_TTL_SECONDS,
      message: GENERIC_PASSWORDLESS_MESSAGE,
    };
  }

  const challenge = await createChallenge(
    user,
    identifier,
    request,
    safeReturnTo(returnToInput),
  );
  try {
    await deliverChallenge({
      challengeId: challenge.id,
      channel: challenge.channel,
      target: identifier.value,
      code: challenge.code,
      magicLink: challenge.magicLink,
      expiresAt: challenge.expiresAt,
    });
  } catch (error) {
    await getDatabase()
      .prepare(
        "UPDATE passwordless_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL",
      )
      .bind(nowSeconds(), challenge.id)
      .run();
    throw error;
  }

  return {
    challengeId: challenge.id,
    channel: challenge.channel,
    maskedTarget: maskIdentifier(identifier),
    expiresInSeconds: PASSWORDLESS_TTL_SECONDS,
    message: GENERIC_PASSWORDLESS_MESSAGE,
  };
}

async function completeUserSession(
  userId: string,
  request: Request,
  returnTo: string,
): Promise<PasswordlessCompletion> {
  const user = await findActiveUserById(userId);
  if (!user || !familyRoles.has(user.role))
    throw new Error("Ссылка или код недействительны");
  await getDatabase()
    .prepare(
      "UPDATE users SET last_login_at = CURRENT_TIMESTAMP, failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(user.id)
    .run();
  return {
    cookie: await createSession(user, request),
    returnTo: safeReturnTo(returnTo),
    user,
  };
}

export async function verifyPasswordlessCode(
  identifierInput: unknown,
  challengeIdInput: unknown,
  codeInput: unknown,
  request: Request,
): Promise<PasswordlessCompletion> {
  await ensureDatabaseReady();
  const identifier = normalizeIdentifier(identifierInput);
  const challengeId =
    typeof challengeIdInput === "string" ? challengeIdInput.trim() : "";
  const code = typeof codeInput === "string" ? codeInput.trim() : "";
  if (!/^passwordless-[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code))
    throw new Error("Введите шестизначный код");

  const now = nowSeconds();
  const identifierHash = hmac(`identifier:${identifier.kind}:${identifier.value}`);
  const db = getDatabase();
  const completed = await db
    .prepare(
      `UPDATE passwordless_challenges
       SET used_at = ?
       WHERE id = ? AND identifier_hash = ? AND code_hash = ?
         AND used_at IS NULL AND expires_at > ? AND attempts < max_attempts
       RETURNING user_id AS userId, return_to AS returnTo`,
    )
    .bind(
      now,
      challengeId,
      identifierHash,
      hmac(`otp:${challengeId}:${code}`),
      now,
    )
    .first<ChallengeRow>();

  if (!completed) {
    await db
      .prepare(
        `UPDATE passwordless_challenges
         SET attempts = attempts + 1
         WHERE id = ? AND identifier_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(challengeId, identifierHash, now)
      .run();
    throw new Error("Код недействителен или срок его действия истёк");
  }
  return completeUserSession(
    completed.userId,
    request,
    completed.returnTo,
  );
}

export async function verifyPasswordlessMagicToken(
  tokenInput: unknown,
  request: Request,
): Promise<PasswordlessCompletion> {
  await ensureDatabaseReady();
  const token = typeof tokenInput === "string" ? tokenInput.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,180}$/.test(token))
    throw new Error("Ссылка недействительна или уже использована");
  const now = nowSeconds();
  const completed = await getDatabase()
    .prepare(
      `UPDATE passwordless_challenges
       SET used_at = ?
       WHERE magic_token_hash = ? AND used_at IS NULL AND expires_at > ?
       RETURNING user_id AS userId, return_to AS returnTo`,
    )
    .bind(now, hmac(`magic:${token}`), now)
    .first<ChallengeRow>();
  if (!completed)
    throw new Error("Ссылка недействительна или уже использована");
  return completeUserSession(
    completed.userId,
    request,
    completed.returnTo,
  );
}

export async function createPasswordlessInvitation(
  userId: string,
  identifierInput: unknown,
  request: Request,
  returnToInput: unknown = "/",
) {
  await ensureDatabaseReady();
  const user = await findActiveUserById(userId);
  if (!user || !familyRoles.has(user.role))
    throw new Error("Семейный доступ не найден");
  const identifier = normalizeIdentifier(identifierInput);
  const challenge = await createChallenge(
    user,
    identifier,
    request,
    safeReturnTo(returnToInput),
  );
  return {
    loginLink: challenge.magicLink,
    expiresAt: new Date(challenge.expiresAt * 1000).toISOString(),
    channel: challenge.channel,
  };
}

function normalizeCentralContact(value: string) {
  const raw = value.trim().toLowerCase();
  if (!raw) return { phone: "", email: "" };
  if (raw.includes("@")) {
    const email = normalizeIdentifier(raw);
    return { phone: "", email: email.value };
  }
  return { phone: normalizePhone(raw), email: "" };
}

export async function reconcileCentralStaff(
  identity: CentralStaffIdentity,
): Promise<SessionUser> {
  await ensureDatabaseReady();
  if (!identity.centralUserId || !identity.displayName.trim())
    throw new Error("ArtHello OS передала неполную учётную запись");
  if (!staffRoles.has(identity.role))
    throw new Error("Роль не имеет доступа к кабинету сотрудника");
  if (!Number.isInteger(identity.accessVersion) || identity.accessVersion < 1)
    throw new Error("Версия доступа ArtHello OS некорректна");

  const contact = normalizeCentralContact(identity.contact || "");
  const fallbackEmail = `central_${identity.centralUserId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")}@school.local`;
  const email = contact.email || fallbackEmail;
  const db = getDatabase();
  let target = await db
    .prepare(
      `SELECT id, email, COALESCE(phone, '') AS phone,
        display_name AS displayName, role,
        linked_student_id AS linkedStudentId, status,
        auth_version AS authVersion,
        central_user_id AS centralUserId,
        central_access_version AS centralAccessVersion
      FROM users
      WHERE central_user_id = ?
        OR (? != '' AND phone = ?)
        OR (? != '' AND lower(email) = ?)
      LIMIT 1`,
    )
    .bind(
      identity.centralUserId,
      contact.phone,
      contact.phone,
      contact.email,
      contact.email,
    )
    .first<UserRow>();

  if (target && familyRoles.has(target.role))
    throw new Error("Этот контакт уже принадлежит семье или ученику");
  if (target?.centralUserId && target.centralUserId !== identity.centralUserId)
    throw new Error("Контакт уже связан с другим сотрудником");
  if (
    target &&
    identity.accessVersion < Number(target.centralAccessVersion || 0)
  )
    throw new Error("Получена устаревшая версия доступа");

  if (!target) {
    const id = `staff-${randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO users
          (id, email, phone, display_name, role, status,
           password_hash, password_state, central_user_id,
           identity_source, central_access_version)
         VALUES (?, ?, ?, ?, ?, 'active', NULL, 'external', ?, 'arthello_os', ?)`,
      )
      .bind(
        id,
        email,
        contact.phone || null,
        identity.displayName.trim(),
        identity.role,
        identity.centralUserId,
        identity.accessVersion,
      )
      .run();
    target = await findActiveUserById(id);
  } else {
    const versionChanged =
      Number(target.centralAccessVersion || 0) !== identity.accessVersion;
    await db
      .prepare(
        `UPDATE users SET email = ?, phone = ?, display_name = ?, role = ?,
          status = 'active', password_hash = NULL, password_state = 'external',
          central_user_id = ?, identity_source = 'arthello_os',
          central_access_version = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        email,
        contact.phone || null,
        identity.displayName.trim(),
        identity.role,
        identity.centralUserId,
        identity.accessVersion,
        target.id,
      )
      .run();
    if (versionChanged)
      await db
        .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
        .bind(target.id)
        .run();
    target = await findActiveUserById(target.id);
  }

  if (!target || !staffRoles.has(target.role))
    throw new Error("Не удалось создать техническую сессию сотрудника");
  return target;
}

export function verifySignedPayload(
  payload: string,
  signature: string,
  context: string,
) {
  return constantTimeEqual(hmac(`${context}:${payload}`), signature);
}

export function signPayload(payload: string, context: string) {
  return hmac(`${context}:${payload}`);
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}
