import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { accessSyncEvents, familySystemAccess } from "../db/schema";
import { SCHOOL_SYSTEM_ID } from "./staff-access-sync";

export type FamilyAccessEvent = "grant_access" | "block_access" | "restore_access" | "reset_password" | "revoke_access";

type FamilySnapshot = {
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

type FamilyAccessSyncInput = {
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

export type FamilyAccessSyncResult = {
  status: "Синхронизировано" | "Ожидает подключения" | "Ошибка синхронизации";
  message: string;
  activationLink?: string;
  expiresAt?: string;
};

export async function syncFamilyDiaryAccess(input: FamilyAccessSyncInput): Promise<FamilyAccessSyncResult> {
  const db = getDb();
  const eventId = `FAMILY-ACCESS-${crypto.randomUUID()}`;
  const payload = {
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
  };
  const payloadText = JSON.stringify(payload);
  await db.insert(accessSyncEvents).values({
    id: eventId,
    eventType: input.eventType,
    userId: input.grant.principalEntityId,
    systemId: SCHOOL_SYSTEM_ID,
    payload: payloadText,
  });

  const endpoint = runtimeValue("SCHOOL_DIARY_SYNC_URL").replace(/\/$/, "");
  const secret = runtimeValue("CENTRAL_ACCESS_SECRET");
  if (!endpoint || secret.length < 32) {
    const message = "Доступ сохранён в карточке семьи ArtHello OS. Отправка ссылки начнётся после подключения российского адреса дневника, общего ключа и SMS/email-канала.";
    await mark(eventId, input.grant.id, input.grant.principalEntityId, "Ожидает подключения", message, {});
    return { status: "Ожидает подключения", message };
  }

  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(`${timestamp}.${payloadText}`, secret);
    const response = await fetch(`${endpoint}/api/internal/family-access-sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-arthello-timestamp": timestamp,
        "x-arthello-signature": signature,
      },
      body: payloadText,
    });
    const result = await response.json() as { error?: string; activationLink?: string; expiresAt?: string; deliveryStatus?: string };
    if (!response.ok) throw new Error(result.error || `Дневник вернул HTTP ${response.status}`);
    const message = input.eventType === "reset_password"
      ? "Пароль сброшен. Новая одноразовая ссылка подготовлена для отправки."
      : input.eventType === "grant_access"
        ? "Семья и право входа переданы в дневник. Одноразовая ссылка подготовлена для отправки."
        : "Изменение доступа применено в дневнике.";
    await mark(eventId, input.grant.id, input.grant.principalEntityId, "Синхронизировано", "", result);
    return { status: "Синхронизировано", message, activationLink: result.activationLink, expiresAt: result.expiresAt };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "Неизвестная ошибка";
    await mark(eventId, input.grant.id, input.grant.principalEntityId, "Ошибка синхронизации", reason, {});
    return { status: "Ошибка синхронизации", message: `Доступ сохранён в ArtHello OS, но дневник не подтвердил синхронизацию: ${reason}` };
  }
}

async function mark(eventId: string, grantId: string, principalId: string, status: string, error: string, result: Record<string, unknown>) {
  const now = new Date().toISOString();
  const db = getDb();
  await db.update(accessSyncEvents).set({ status, attempts: 1, lastError: error, result: JSON.stringify(result), updatedAt: now }).where(eq(accessSyncEvents.id, eventId));
  await db.update(familySystemAccess).set({
    lastSyncStatus: status,
    lastSyncedAt: status === "Синхронизировано" ? now : "",
    deliveryStatus: typeof result.deliveryStatus === "string" ? result.deliveryStatus : status,
    updatedAt: now,
  }).where(and(eq(familySystemAccess.id, grantId), eq(familySystemAccess.principalEntityId, principalId)));
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
