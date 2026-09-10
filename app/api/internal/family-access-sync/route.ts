import { assertInstitution } from "../../../../lib/institution.mjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "../../../level-zero-types";
import { normalizePhone } from "../../../../server/auth";
import { createPasswordlessInvitation } from "../../../../server/identity-broker";
import { ensureDatabaseReady, getDatabase } from "../../../../server/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const actions = new Set([
  "grant_access",
  "block_access",
  "restore_access",
  "reset_password",
  "revoke_access",
]);

type Member = {
  id: string;
  displayName: string;
  entityType: string;
  relation: string;
  sourceSystem: string;
  sourceRecordId: string;
  scope: string;
};

type FamilyAccessPayload = {
  systemId: string;
  branchId: string;
  eventId: string;
  action:
    | "grant_access"
    | "block_access"
    | "restore_access"
    | "reset_password"
    | "revoke_access";
  issuedAt: string;
  actor: string;
  family: {
    id: string;
    displayName: string;
    sourceSystem: string;
    sourceRecordId: string;
    members: Member[];
  };
  access: {
    centralAccessId: string;
    centralFamilyId: string;
    centralPrincipalId: string;
    principalType: "guardian" | "student";
    role: "parent" | "student";
    phone: string;
    email: string;
    deliveryChannel: "sms" | "email";
    status: string;
    accessVersion: number;
  };
};

type UserRow = {
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
    const payload = JSON.parse(bodyText) as FamilyAccessPayload;
    assertInstitution(payload);
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
          payload.access.centralPrincipalId,
          bodyText,
        )
        .run();
    const result = await applyAccess(payload, request);
    await db
      .prepare(
        "UPDATE central_access_events SET status = 'processed', result = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(JSON.stringify(result), payload.eventId)
      .run();
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Синхронизация семьи не выполнена";
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

async function applyAccess(payload: FamilyAccessPayload, request: Request) {
  const db = getDatabase();
  const access = payload.access;
  const phone = access.phone ? normalizePhone(access.phone) : "";
  const email = access.email.trim().toLowerCase();
  const login = phone || email;
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
    .bind(
      access.centralPrincipalId,
      phone,
      phone,
      email,
      email,
    )
    .first<UserRow>();

  if (target && !["parent", "student"].includes(target.role))
    throw new Error("Логин уже принадлежит сотруднику");
  if (
    target?.centralUserId &&
    target.centralUserId !== access.centralPrincipalId
  )
    throw new Error("Логин уже связан с другой карточкой ArtHello OS");
  if (
    target &&
    access.accessVersion < Number(target.centralAccessVersion)
  )
    return {
      ok: true,
      id: target.id,
      stale: true,
      message: "Более новая версия доступа уже применена",
    };

  await syncFamilyProjection(payload.family);
  if (payload.action === "block_access" || payload.action === "revoke_access") {
    if (!target) return { ok: true, missing: true };
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      db
        .prepare(
          "UPDATE users SET status = ?, password_hash = NULL, password_state = 'external', central_user_id = ?, identity_source = 'arthello_os', central_access_version = ?, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(
          payload.action === "block_access" ? "blocked" : "revoked",
          access.centralPrincipalId,
          access.accessVersion,
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
    await centralAudit(
      target.id,
      payload.action,
      access.centralPrincipalId,
      payload.actor,
    );
    return { ok: true, id: target.id, passwordless: true };
  }

  if (!login) throw new Error("Для входа нужен телефон или email");
  const principal = payload.family.members.find(
    (member) => member.id === access.centralPrincipalId,
  );
  if (!principal) throw new Error("Пользователь не связан с семьёй");
  if (
    (access.role === "student") !== (principal.entityType === "Ребёнок")
  )
    throw new Error("Роль не соответствует карточке ArtHello OS");

  const principalEmail =
    email ||
    `central_${access.centralPrincipalId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")}@school.local`;
  const linkedStudentId = access.role === "student" ? principal.id : null;
  if (!target) {
    const id = `family-user-${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO users
          (id, email, phone, display_name, role, linked_student_id,
           status, password_hash, password_state, central_user_id,
           identity_source, central_access_version)
         VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, 'external', ?, 'arthello_os', ?)`,
      )
      .bind(
        id,
        principalEmail,
        phone || null,
        principal.displayName,
        access.role,
        linkedStudentId,
        access.centralPrincipalId,
        access.accessVersion,
      )
      .run();
    target = {
      id,
      email: principalEmail,
      phone: phone || null,
      role: access.role,
      status: "active",
      centralUserId: access.centralPrincipalId,
      centralAccessVersion: access.accessVersion,
    };
  } else {
    const versionChanged =
      Number(target.centralAccessVersion) !== access.accessVersion;
    await db
      .prepare(
        `UPDATE users SET email = ?, phone = ?, display_name = ?, role = ?,
          linked_student_id = ?, status = 'active', password_hash = NULL,
          password_state = 'external', central_user_id = ?,
          identity_source = 'arthello_os', central_access_version = ?,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(
        principalEmail,
        phone || null,
        principal.displayName,
        access.role,
        linkedStudentId,
        access.centralPrincipalId,
        access.accessVersion,
        target.id,
      )
      .run();
    if (versionChanged)
      await db
        .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
        .bind(target.id)
        .run();
  }
  await syncFamilyLinks(
    target.id,
    access.role,
    access.centralPrincipalId,
    payload.family,
  );

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

  const invitation = await createPasswordlessInvitation(
    target.id,
    login,
    request,
  );
  await centralAudit(
    target.id,
    payload.action === "reset_password"
      ? "reissue_passwordless_link"
      : payload.action,
    access.centralPrincipalId,
    payload.actor,
  );
  return {
    ok: true,
    id: target.id,
    passwordless: true,
    requiresPassword: false,
    loginLink: invitation.loginLink,
    activationLink: invitation.loginLink,
    expiresAt: invitation.expiresAt,
    deliveryChannel: invitation.channel,
    deliveryStatus: `Одноразовая ссылка готова к отправке: ${invitation.channel}`,
  };
}

async function syncFamilyProjection(family: FamilyAccessPayload["family"]) {
  const db = getDatabase();
  for (const member of family.members.filter(
    (item) => item.entityType === "Ребёнок",
  )) {
    const { firstName, lastName } = splitName(member.displayName);
    const className = normalizeClassName(member.scope);
    const grade = Number(className.match(/^(1[01]|[1-9])/)?.[1] ?? 1);
    await db
      .prepare(
        `INSERT INTO school_classes (id, name, grade, status)
         VALUES (?, ?, ?, 'active')
         ON CONFLICT(name) DO UPDATE SET grade = excluded.grade,
           status = 'active', updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(classId(className), className, grade)
      .run();
    await db
      .prepare(
        `INSERT INTO students
          (id, first_name, last_name, class_name, status)
         VALUES (?, ?, ?, ?, 'active')
         ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name,
           last_name = excluded.last_name, class_name = excluded.class_name,
           status = 'active', updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(member.id, firstName, lastName, className)
      .run();
  }
}

async function syncFamilyLinks(
  userId: string,
  role: "parent" | "student",
  principalId: string,
  family: FamilyAccessPayload["family"],
) {
  const db = getDatabase();
  await db
    .prepare("DELETE FROM user_student_links WHERE user_id = ?")
    .bind(userId)
    .run();
  const students = family.members.filter(
    (member) => member.entityType === "Ребёнок",
  );
  const linked =
    role === "student"
      ? students.filter((member) => member.id === principalId)
      : students;
  for (const student of linked) {
    await db
      .prepare(
        "INSERT INTO user_student_links (id, user_id, student_id, relation) VALUES (?, ?, ?, ?)",
      )
      .bind(
        `central-link-${userId}-${student.id}`,
        userId,
        student.id,
        role === "student" ? "self" : "guardian",
      )
      .run();
  }
}

async function centralAudit(
  userId: string,
  action: string,
  centralId: string,
  actor: string,
) {
  await getDatabase()
    .prepare(
      "INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, 'family_access', ?, ?)",
    )
    .bind(
      `audit-${crypto.randomUUID()}`,
      userId,
      `central_family_access.${action}`,
      userId,
      `ArtHello OS: ${centralId}; инициатор ${actor}`.slice(0, 500),
    )
    .run();
}

function validatePayload(payload: FamilyAccessPayload) {
  if (!payload || typeof payload !== "object" || !actions.has(payload.action))
    throw new Error("Неизвестное действие синхронизации");
  if (
    !payload.eventId ||
    !payload.family?.id ||
    !payload.access?.centralPrincipalId
  )
    throw new Error("Неполные данные семьи");
  if (payload.family.id !== payload.access.centralFamilyId)
    throw new Error("Карточка семьи не совпадает с доступом");
  if (
    !Number.isInteger(payload.access.accessVersion) ||
    payload.access.accessVersion < 1
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

function splitName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Ученик",
    lastName: parts.slice(1).join(" ") || "ArtHello",
  };
}

function normalizeClassName(scope: string) {
  const value = scope.split("·")[0]?.trim() || "Не назначен";
  return value.length <= 30 ? value : value.slice(0, 30);
}

function classId(name: string) {
  return `central-class-${
    name
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/giu, "-")
      .replace(/^-|-$/g, "") || "unassigned"
  }`;
}
