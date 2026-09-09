import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { accessSyncEvents, userSystemAccess } from "../db/schema";

export const SCHOOL_SYSTEM_ID = "SYS-SCHOOL-1-11";

export type StaffAccessEvent = "upsert" | "block" | "restore" | "reset_password" | "revoke";

type StaffSyncInput = {
  actor: string;
  eventType: StaffAccessEvent;
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

type StaffSyncResult = {
  status: "Синхронизировано" | "Ожидает подключения" | "Ошибка синхронизации";
  message: string;
  activationLink?: string;
  expiresAt?: string;
};

export async function syncSchoolDiaryAccess(input: StaffSyncInput): Promise<StaffSyncResult> {
  const db = getDb();
  const eventId = `ACCESS-${crypto.randomUUID()}`;
  const phone = input.user.contactType === "phone" ? input.user.contact : "";
  const email = input.user.contactType === "email" ? input.user.contact : "";
  const payload = {
    eventId,
    action: input.eventType,
    issuedAt: new Date().toISOString(),
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
  };
  const payloadText = JSON.stringify(payload);
  await db.insert(accessSyncEvents).values({
    id: eventId,
    eventType: input.eventType,
    userId: input.user.id,
    systemId: SCHOOL_SYSTEM_ID,
    payload: payloadText,
  });

  const endpoint = runtimeValue("SCHOOL_DIARY_SYNC_URL").replace(/\/$/, "");
  const secret = runtimeValue("CENTRAL_ACCESS_SECRET");
  if (!endpoint || secret.length < 32) {
    const message = "Доступ сохранён централизованно. Дневник применит его после подключения российского адреса и общего ключа синхронизации.";
    await mark(eventId, input.user.id, "Ожидает подключения", message, {});
    return { status: "Ожидает подключения", message };
  }

  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(`${timestamp}.${payloadText}`, secret);
    const response = await fetch(`${endpoint}/api/internal/staff-sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-arthello-timestamp": timestamp,
        "x-arthello-signature": signature,
      },
      body: payloadText,
    });
    const result = await response.json() as { error?: string; activationLink?: string; expiresAt?: string };
    if (!response.ok) throw new Error(result.error || `Дневник вернул HTTP ${response.status}`);
    const message = input.eventType === "reset_password"
      ? "Пароль сотрудника сброшен в дневнике. Передайте ему новую одноразовую ссылку."
      : "Права сотрудника применены в дневнике.";
    await mark(eventId, input.user.id, "Синхронизировано", "", result);
    return { status: "Синхронизировано", message, activationLink: result.activationLink, expiresAt: result.expiresAt };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "Неизвестная ошибка";
    await mark(eventId, input.user.id, "Ошибка синхронизации", reason, {});
    return {
      status: "Ошибка синхронизации",
      message: `Права сохранены в ArtHello OS, но дневник пока не подтвердил синхронизацию: ${reason}`,
    };
  }
}

async function mark(eventId: string, userId: string, status: string, error: string, result: unknown) {
  const now = new Date().toISOString();
  const db = getDb();
  await db.update(accessSyncEvents).set({
    status,
    attempts: 1,
    lastError: error,
    result: JSON.stringify(result),
    updatedAt: now,
  }).where(eq(accessSyncEvents.id, eventId));
  await db.update(userSystemAccess).set({
    lastSyncStatus: status,
    lastSyncedAt: status === "Синхронизировано" ? now : "",
    updatedAt: now,
  }).where(and(eq(userSystemAccess.userId, userId), eq(userSystemAccess.systemId, SCHOOL_SYSTEM_ID)));
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
