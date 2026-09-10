import { env } from "cloudflare:workers";
import { accessSyncClaimGuard, accessSyncCompletionStatement, batchChangeCount, claimAccessSyncEvent, deferAccessSyncEvent } from "./access-sync-outbox";
import { durableSchoolDiaryResult, resolveSchoolDiarySyncUrl, safeSchoolDiaryActivationLink, safeSchoolDiarySyncError, SCHOOL_DIARY_TIMEOUT_MS } from "./school-diary-sync-security";

export const SCHOOL_SYSTEM_ID = "SYS-SCHOOL-1-11";

export type StaffAccessEvent = "upsert" | "block" | "restore" | "reset_password" | "revoke";

export type StaffSyncInput = {
  actor: string;
  eventType: StaffAccessEvent;
  accessRevision: string;
  user: {
    id: string;
    displayName: string;
    contact: string;
    contactType: string;
    status: string;
    accessVersion: number;
  };
  diaryRole: string;
  branches: Array<{ id: string; name: string }>;
};

export type PreparedStaffAccessSyncEvent = {
  id: string;
  eventType: StaffAccessEvent;
  userId: string;
  systemId: typeof SCHOOL_SYSTEM_ID;
  payload: string;
};

export type StaffSyncResult = {
  status: "Синхронизировано" | "Синхронизация выполняется" | "Ожидает подключения" | "Ошибка синхронизации";
  message: string;
  activationLink?: string;
  expiresAt?: string;
};

const STAFF_EVENT_TYPES: readonly StaffAccessEvent[] = ["upsert", "block", "restore", "reset_password", "revoke"];

export function prepareSchoolDiaryAccessEvent(input: StaffSyncInput): PreparedStaffAccessSyncEvent {
  const eventId = `ACCESS-${crypto.randomUUID()}`;
  const phone = input.user.contactType === "phone" ? input.user.contact : "";
  const email = input.user.contactType === "email" ? input.user.contact : "";
  return {
    id: eventId,
    eventType: input.eventType,
    userId: input.user.id,
    systemId: SCHOOL_SYSTEM_ID,
    payload: JSON.stringify({
      eventId,
      action: input.eventType,
      issuedAt: new Date().toISOString(),
      accessRevision: input.accessRevision,
      actor: input.actor,
      user: {
        centralUserId: input.user.id,
        displayName: input.user.displayName,
        phone,
        email,
        role: input.diaryRole,
        status: input.user.status,
        accessVersion: input.user.accessVersion,
        branches: input.branches,
      },
    }),
  };
}

/** Dispatches an event that was already committed atomically with the access mutation. */
export async function dispatchSchoolDiaryAccessEvent(eventId: string): Promise<StaffSyncResult> {
  const endpoint = runtimeValue("SCHOOL_DIARY_SYNC_URL");
  const secret = runtimeValue("CENTRAL_ACCESS_SECRET");
  if (!endpoint || secret.length < 32) {
    const message = "Доступ сохранён централизованно. Дневник применит его после подключения российского адреса и общего ключа синхронизации.";
    const deferred = await deferAccessSyncEvent(eventId, STAFF_EVENT_TYPES, message);
    if (deferred.status === "Синхронизировано" || deferred.status === "Синхронизация выполняется") {
      return alreadyClaimedResult(deferred.status, deferred.result);
    }
    return { status: "Ожидает подключения", message };
  }

  const claim = await claimAccessSyncEvent(eventId, STAFF_EVENT_TYPES);
  if (!claim.claimed) return alreadyClaimedResult(claim.status, claim.result);
  const payload = parseStaffPayload(claim.payload, eventId, claim.eventType, claim.userId);

  try {
    const syncUrl = resolveSchoolDiarySyncUrl(endpoint, "/api/internal/staff-sync", runtimeValue("SCHOOL_DIARY_ALLOWED_ORIGINS"));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(`${timestamp}.${claim.payload}`, secret);
    const response = await fetch(syncUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(SCHOOL_DIARY_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "x-arthello-timestamp": timestamp,
        "x-arthello-signature": signature,
      },
      body: claim.payload,
    });
    if (!response.ok) throw new Error("diary-sync-rejected");
    const result = await response.json() as { activationLink?: string; expiresAt?: string };
    const activationLink = safeSchoolDiaryActivationLink(result.activationLink, syncUrl);
    const durableResult = durableSchoolDiaryResult({ ...result, activationLink });
    const message = payload.action === "reset_password"
      ? "Пароль сотрудника сброшен в дневнике. Передайте ему новую одноразовую ссылку."
      : "Права сотрудника применены в дневнике.";
    await mark(eventId, claim.claimToken, payload.user.centralUserId, payload.user.accessVersion, payload.accessRevision, "Синхронизировано", "", durableResult);
    return { status: "Синхронизировано", message, activationLink, expiresAt: durableResult.expiresAt };
  } catch (error) {
    const reason = safeSchoolDiarySyncError(error);
    await mark(eventId, claim.claimToken, payload.user.centralUserId, payload.user.accessVersion, payload.accessRevision, "Ошибка синхронизации", reason, {});
    return {
      status: "Ошибка синхронизации",
      message: `Права сохранены в ArtHello OS, но дневник пока не подтвердил синхронизацию: ${reason}`,
    };
  }
}

async function mark(eventId: string, claimToken: string, userId: string, accessVersion: number, accessRevision: string, status: string, error: string, durableResult: Record<string, unknown>) {
  const now = new Date().toISOString();
  const guard = accessSyncClaimGuard();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE user_system_access SET
      last_sync_status=?,last_synced_at=?
      WHERE user_id=? AND system_id=? AND access_version=? AND updated_at=? AND ${guard}`)
      .bind(status, status === "Синхронизировано" ? now : "", userId, SCHOOL_SYSTEM_ID, accessVersion, accessRevision, eventId, claimToken),
    accessSyncCompletionStatement(eventId, claimToken, status, error, durableResult),
  ]);
  if (batchChangeCount(results.at(-1)) !== 1) throw new Error("Access sync lease was superseded");
}

function parseStaffPayload(value: string, eventId: string, eventType: string, userId: string) {
  const parsed = JSON.parse(value) as {
    eventId?: unknown;
    action?: unknown;
    accessRevision?: unknown;
    user?: { centralUserId?: unknown; accessVersion?: unknown };
  };
  const accessVersion = Number(parsed.user?.accessVersion);
  if (
    parsed.eventId !== eventId
    || parsed.action !== eventType
    || typeof parsed.accessRevision !== "string"
    || parsed.accessRevision.length < 20
    || parsed.accessRevision.length > 50
    || !Number.isFinite(Date.parse(parsed.accessRevision))
    || parsed.user?.centralUserId !== userId
    || !Number.isSafeInteger(accessVersion)
    || accessVersion < 1
  ) throw new Error("Access sync payload is invalid");
  return parsed as {
    eventId: string;
    action: StaffAccessEvent;
    accessRevision: string;
    user: { centralUserId: string; accessVersion: number };
  };
}

function alreadyClaimedResult(status: string, result: Record<string, unknown>): StaffSyncResult {
  if (status === "Синхронизировано") {
    return {
      status,
      message: "Это изменение уже подтверждено дневником; повторная отправка не требуется.",
      expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : undefined,
    };
  }
  return { status: "Синхронизация выполняется", message: "Это изменение уже отправляется в дневник." };
}

function runtimeValue(key: string) {
  const runtime = env as unknown as Record<string, unknown>;
  const direct = runtime[key];
  if (typeof direct === "string") return direct.trim();
  if (typeof process !== "undefined") return (process.env[key] || "").trim();
  return "";
}

async function sign(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
