import { env } from "cloudflare:workers";
import { accessSyncClaimGuard, accessSyncCompletionStatement, batchChangeCount, claimAccessSyncEvent, deferAccessSyncEvent } from "./access-sync-outbox";
import { durableSchoolDiaryResult, resolveSchoolDiarySyncUrl, safeSchoolDiaryActivationLink, safeSchoolDiarySyncError, SCHOOL_DIARY_TIMEOUT_MS } from "./school-diary-sync-security";
import { SCHOOL_SYSTEM_ID } from "./staff-access-sync";

export type FamilyAccessEvent = "grant_access" | "block_access" | "restore_access" | "reset_password" | "revoke_access";

export type FamilySnapshot = {
  id: string;
  displayName: string;
  sourceSystem: string;
  sourceRecordId: string;
  members: Array<{
    id: string;
    displayName: string;
    entityType: string;
    relation: string;
    sourceSystem: string;
    sourceRecordId: string;
    scope: string;
  }>;
};

export type FamilyAccessSyncInput = {
  actor: string;
  eventType: FamilyAccessEvent;
  grant: {
    id: string;
    familyEntityId: string;
    principalEntityId: string;
    principalType: string;
    role: string;
    loginType: string;
    login: string;
    deliveryChannel: string;
    status: string;
    accessVersion: number;
  };
  family: FamilySnapshot;
};

export type PreparedFamilyAccessSyncEvent = {
  id: string;
  eventType: FamilyAccessEvent;
  userId: string;
  systemId: typeof SCHOOL_SYSTEM_ID;
  payload: string;
};

export type FamilyAccessSyncResult = {
  status: "Синхронизировано" | "Синхронизация выполняется" | "Ожидает подключения" | "Ошибка синхронизации";
  message: string;
  activationLink?: string;
  expiresAt?: string;
};

const FAMILY_EVENT_TYPES: readonly FamilyAccessEvent[] = ["grant_access", "block_access", "restore_access", "reset_password", "revoke_access"];

export function prepareFamilyDiaryAccessEvent(input: FamilyAccessSyncInput): PreparedFamilyAccessSyncEvent {
  const eventId = `FAMILY-ACCESS-${crypto.randomUUID()}`;
  return {
    id: eventId,
    eventType: input.eventType,
    userId: input.grant.principalEntityId,
    systemId: SCHOOL_SYSTEM_ID,
    payload: JSON.stringify({
      eventId,
      action: input.eventType,
      issuedAt: new Date().toISOString(),
      actor: input.actor,
      family: input.family,
      access: {
        centralAccessId: input.grant.id,
        centralFamilyId: input.grant.familyEntityId,
        centralPrincipalId: input.grant.principalEntityId,
        principalType: input.grant.principalType,
        role: input.grant.role,
        phone: input.grant.loginType === "phone" ? input.grant.login : "",
        email: input.grant.loginType === "email" ? input.grant.login : "",
        deliveryChannel: input.grant.deliveryChannel,
        status: input.grant.status,
        accessVersion: input.grant.accessVersion,
      },
    }),
  };
}

/** Dispatches an event that was already committed atomically with the access mutation. */
export async function dispatchFamilyDiaryAccessEvent(eventId: string): Promise<FamilyAccessSyncResult> {
  const endpoint = runtimeValue("SCHOOL_DIARY_SYNC_URL");
  const secret = runtimeValue("CENTRAL_ACCESS_SECRET");
  if (!endpoint || secret.length < 32) {
    const message = "Доступ сохранён в карточке семьи ArtHello OS. Отправка ссылки начнётся после подключения российского адреса дневника, общего ключа и SMS/email-канала.";
    const deferred = await deferAccessSyncEvent(eventId, FAMILY_EVENT_TYPES, message);
    if (deferred.status === "Синхронизировано" || deferred.status === "Синхронизация выполняется") {
      return alreadyClaimedResult(deferred.status, deferred.result);
    }
    return { status: "Ожидает подключения", message };
  }

  const claim = await claimAccessSyncEvent(eventId, FAMILY_EVENT_TYPES);
  if (!claim.claimed) return alreadyClaimedResult(claim.status, claim.result);
  const payload = parseFamilyPayload(claim.payload, eventId, claim.eventType, claim.userId);

  try {
    const syncUrl = resolveSchoolDiarySyncUrl(endpoint, "/api/internal/family-access-sync", runtimeValue("SCHOOL_DIARY_ALLOWED_ORIGINS"));
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
    const result = await response.json() as { activationLink?: string; expiresAt?: string; deliveryStatus?: string };
    const activationLink = safeSchoolDiaryActivationLink(result.activationLink, syncUrl);
    const durableResult = durableSchoolDiaryResult({ ...result, activationLink }, true);
    const message = payload.action === "reset_password"
      ? "Пароль сброшен. Новая одноразовая ссылка подготовлена для отправки."
      : payload.action === "grant_access"
        ? "Семья и право входа переданы в дневник. Одноразовая ссылка подготовлена для отправки."
        : "Изменение доступа применено в дневнике.";
    await mark(eventId, claim.claimToken, payload.access.centralAccessId, payload.access.centralPrincipalId, payload.access.accessVersion, "Синхронизировано", "", durableResult);
    return { status: "Синхронизировано", message, activationLink, expiresAt: durableResult.expiresAt };
  } catch (error) {
    const reason = safeSchoolDiarySyncError(error);
    await mark(eventId, claim.claimToken, payload.access.centralAccessId, payload.access.centralPrincipalId, payload.access.accessVersion, "Ошибка синхронизации", reason, {});
    return { status: "Ошибка синхронизации", message: `Доступ сохранён в ArtHello OS, но дневник не подтвердил синхронизацию: ${reason}` };
  }
}

async function mark(eventId: string, claimToken: string, grantId: string, principalId: string, accessVersion: number, status: string, error: string, durableResult: Record<string, unknown>) {
  const now = new Date().toISOString();
  const guard = accessSyncClaimGuard();
  const deliveryStatus = typeof durableResult.deliveryStatus === "string" ? durableResult.deliveryStatus : status;
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE family_system_access SET
      last_sync_status=?,last_synced_at=?,delivery_status=?,updated_at=?
      WHERE id=? AND principal_entity_id=? AND access_version=? AND ${guard}`)
      .bind(status, status === "Синхронизировано" ? now : "", deliveryStatus, now, grantId, principalId, accessVersion, eventId, claimToken),
    accessSyncCompletionStatement(eventId, claimToken, status, error, durableResult),
  ]);
  if (batchChangeCount(results.at(-1)) !== 1) throw new Error("Access sync lease was superseded");
}

function parseFamilyPayload(value: string, eventId: string, eventType: string, principalId: string) {
  const parsed = JSON.parse(value) as {
    eventId?: unknown;
    action?: unknown;
    access?: {
      centralAccessId?: unknown;
      centralPrincipalId?: unknown;
      accessVersion?: unknown;
    };
  };
  const accessVersion = Number(parsed.access?.accessVersion);
  if (
    parsed.eventId !== eventId
    || parsed.action !== eventType
    || parsed.access?.centralPrincipalId !== principalId
    || typeof parsed.access?.centralAccessId !== "string"
    || !Number.isSafeInteger(accessVersion)
    || accessVersion < 1
  ) throw new Error("Access sync payload is invalid");
  return parsed as {
    eventId: string;
    action: FamilyAccessEvent;
    access: { centralAccessId: string; centralPrincipalId: string; accessVersion: number };
  };
}

function alreadyClaimedResult(status: string, result: Record<string, unknown>): FamilyAccessSyncResult {
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
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
