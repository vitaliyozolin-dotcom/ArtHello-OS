import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "../../../level-zero-types";
import { normalizePhone } from "../../../../server/auth";
import { ensureDatabaseReady, getDatabase } from "../../../../server/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const staffRoles = new Set<Role>([
  "director",
  "deputy",
  "admin",
  "teacher",
  "tech_admin",
]);
const actions = new Set([
  "upsert",
  "block",
  "restore",
  "reset_password",
  "revoke",
]);

type StaffAccessPayload = {
  eventId: string;
  action: "upsert" | "block" | "restore" | "reset_password" | "revoke";
  issuedAt: string;
  actor: string;
  user: {
    centralUserId: string;
    displayName: string;
    phone: string;
    email: string;
    role: Role;
    status: string;
    accessVersion: number;
    branches: Array<{ id: string; name: string }>;
  };
};

type StaffRow = {
  id: string;
  role: Role;
  phone: string | null;
  email: string;
  status: string;
  centralUserId: string | null;
  centralAccessVersion: number;
};

export async function POST(request: Request) {
  try {
    const bodyText = await request.text();
    verifySignature(request, bodyText);
    const payload = JSON.parse(bodyText) as StaffAccessPayload;
    validatePayload(payload);
    await ensureDatabaseReady();
    const db = getDatabase();
    const previous = await db
      .prepare(
        "SELECT result, status FROM central_access_events WHERE id = ?",
      )
      .bind(payload.eventId)
      .first<{ result: string; status: string }>();
    if (previous?.status === "processed")
      return Response.json(JSON.parse(previous.result));
    if (!previous)
      await db
        .prepare(
          "INSERT INTO central_access_events (id, action, central_user_id, payload) VALUES (?, ?, ?, ?)",
        )
        .bind(
          payload.eventId,
          payload.action,
          payload.user.centralUserId,
          bodyText,
        )
        .run();

    const result = await applyAccess(payload);
    await db
      .prepare(
        "UPDATE central_access_events SET status = 'processed', result = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(JSON.stringify(result), payload.eventId)
      .run();
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Синхронизация доступа не выполнена";
    return Response.json(
      { error: message },
      {
        status:
          message.includes("подпись") || message.includes("просрочен")
            ? 401
            : 400,
      },
    );
  }
}

async function applyAccess(payload: StaffAccessPayload) {
  const db = getDatabase();
  const centralId = payload.user.centralUserId;
  const phone = payload.user.phone ? normalizePhone(payload.user.phone) : "";
  const email = payload.user.email.trim().toLowerCase();
  let target = await db
    .prepare(
      `SELECT id, role, phone, email, status,
        central_user_id AS centralUserId,
        central_access_version AS centralAccessVersion
       FROM users
       WHERE central_user_id = ?
         OR (? != '' AND phone = ?)
         OR (? != '' AND lower(email) = ?)
       LIMIT 1`,
    )
    .bind(centralId, phone, phone, email, email)
    .first<StaffRow>();

  if (target && (target.role === "parent" || target.role === "student"))
    throw new Error(
      "Этот контакт уже принадлежит родителю или ученику; семейный доступ нельзя заменить доступом сотрудника",
    );
  if (target?.centralUserId && target.centralUserId !== centralId)
    throw new Error("Контакт уже связан с другим сотрудником ArtHello OS");
  if (
    target &&
    Number(payload.user.accessVersion) < Number(target.centralAccessVersion)
  )
    return {
      ok: true,
      id: target.id,
      stale: true,
      message: "Более новая версия доступа уже применена",
    };

  if (payload.action === "block" || payload.action === "revoke") {
    if (!target) return { ok: true, missing: true, ssoOnly: true };
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      db
        .prepare(
          "UPDATE users SET status = ?, password_hash = NULL, password_state = 'external', central_user_id = ?, identity_source = 'arthello_os', central_access_version = ?, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(
          payload.action === "block" ? "blocked" : "revoked",
          centralId,
          payload.user.accessVersion,
          target.id,
        ),
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(target.id),
      db
        .prepare(
          "UPDATE passwordless_challenges SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
        )
        .bind(now, target.id),
      db
        .prepare(
          "UPDATE credential_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL",
        )
        .bind(target.id),
    ]);
    await centralAudit(target.id, payload.action, centralId, payload.actor);
    return { ok: true, id: target.id, ssoOnly: true };
  }

  if (!phone && !email)
    throw new Error("Для сотрудника нужен телефон или email в ArtHello OS");
  if (!staffRoles.has(payload.user.role))
    throw new Error("Недопустимая роль сотрудника в дневнике");
  if (!payload.user.branches.some((branch) => branch.id === "BR-SCHOOL"))
    throw new Error("Сотруднику не назначен филиал «Школа 1–11»");

  const storedEmail =
    email ||
    `central_${centralId.toLowerCase().replace(/[^a-z0-9]+/g, "_")}@school.local`;
  if (!target) {
    const id = `staff-${crypto.randomUUID()}`;
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
        storedEmail,
        phone || null,
        payload.user.displayName,
        payload.user.role,
        centralId,
        payload.user.accessVersion,
      )
      .run();
    target = {
      id,
      role: payload.user.role,
      phone: phone || null,
      email: storedEmail,
      status: "active",
      centralUserId: centralId,
      centralAccessVersion: payload.user.accessVersion,
    };
  } else {
    const versionChanged =
      Number(target.centralAccessVersion) !== payload.user.accessVersion;
    await db
      .prepare(
        `UPDATE users SET email = ?, phone = ?, display_name = ?, role = ?,
          status = 'active', password_hash = NULL, password_state = 'external',
          central_user_id = ?, identity_source = 'arthello_os',
          central_access_version = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        storedEmail,
        phone || null,
        payload.user.displayName,
        payload.user.role,
        centralId,
        payload.user.accessVersion,
        target.id,
      )
      .run();
    if (versionChanged)
      await db
        .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
        .bind(target.id)
        .run();
  }

  if (payload.action === "reset_password") {
    await db.batch([
      db
        .prepare(
          "UPDATE users SET password_hash = NULL, password_state = 'external', auth_version = auth_version + 1, failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(target.id),
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(target.id),
    ]);
  }

  await centralAudit(
    target.id,
    payload.action === "reset_password" ? "revoke_sso_sessions" : payload.action,
    centralId,
    payload.actor,
  );
  return {
    ok: true,
    id: target.id,
    ssoOnly: true,
    requiresPassword: false,
    loginMode: "arthello_os_sso",
  };
}

async function centralAudit(
  userId: string,
  action: string,
  centralUserId: string,
  actor: string,
) {
  await getDatabase()
    .prepare(
      "INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, 'user', ?, ?)",
    )
    .bind(
      `audit-${crypto.randomUUID()}`,
      userId,
      `central_access.${action}`,
      userId,
      `ArtHello OS: ${centralUserId}; инициатор ${actor}`.slice(0, 500),
    )
    .run();
}

function validatePayload(payload: StaffAccessPayload) {
  if (!payload || typeof payload !== "object" || !actions.has(payload.action))
    throw new Error("Неизвестное действие синхронизации");
  if (
    !payload.eventId ||
    !payload.user?.centralUserId ||
    !payload.user.displayName
  )
    throw new Error("Неполные данные сотрудника");
  if (
    !Number.isInteger(payload.user.accessVersion) ||
    payload.user.accessVersion < 1
  )
    throw new Error("Некорректная версия доступа");
}

function verifySignature(request: Request, body: string) {
  const secret = process.env.CENTRAL_ACCESS_SECRET || "";
  if (secret.length < 32)
    throw new Error("Общий ключ синхронизации не настроен");
  const timestamp = request.headers.get("x-arthello-timestamp") || "";
  const signature = request.headers.get("x-arthello-signature") || "";
  const issuedAt = Number(timestamp) * 1000;
  if (
    !Number.isFinite(issuedAt) ||
    Math.abs(Date.now() - issuedAt) > 5 * 60 * 1000
  )
    throw new Error("Запрос синхронизации просрочен");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = /^[a-f0-9]{64}$/i.test(signature)
    ? Buffer.from(signature, "hex")
    : Buffer.alloc(0);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  )
    throw new Error("Неверная подпись синхронизации");
}
