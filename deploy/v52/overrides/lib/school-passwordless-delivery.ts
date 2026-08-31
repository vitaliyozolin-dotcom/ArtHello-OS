import { env } from "cloudflare:workers";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

type RuntimeEnv = {
  DB: D1Database;
  SCHOOL_PASSWORDLESS_DELIVERY_SECRET?: string;
  SMS_RU_API_ID?: string;
  RESEND_API_KEY?: string;
  SCHOOL_EMAIL_FROM?: string;
};

type DeliveryPayload = {
  eventId: string;
  purpose: "school_login";
  channel: "sms" | "email";
  target: string;
  code: string;
  magicLink: string;
  expiresAt: string;
  message: string;
};

type DeliveryRow = {
  status: string;
  provider: string;
  provider_message_id: string | null;
};

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function runtimeEnv() {
  return env as unknown as RuntimeEnv;
}

function database() {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("Production database is unavailable");
  return db;
}

function encoder(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return new Uint8Array();
  return new Uint8Array(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder(value))),
  );
}

async function sha256Hex(value: string) {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder(value))),
  );
}

function deliverySecret() {
  const secret = runtimeEnv().SCHOOL_PASSWORDLESS_DELIVERY_SECRET?.trim() || "";
  if (secret.length < 32)
    throw new Error("School delivery authentication is not configured");
  return secret;
}

async function verifySignature(request: Request, body: string) {
  const timestamp = request.headers.get("x-arthello-timestamp")?.trim() || "";
  const signature = request.headers.get("x-arthello-signature")?.trim() || "";
  const issuedAt = Number(timestamp);
  if (
    !Number.isInteger(issuedAt) ||
    Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > MAX_CLOCK_SKEW_SECONDS
  )
    throw new Error("School delivery request is expired");
  const expected = hexToBytes(await hmacHex(deliverySecret(), `${timestamp}.${body}`));
  const actual = hexToBytes(signature);
  if (!constantTimeEqual(expected, actual))
    throw new Error("School delivery signature is invalid");
}

function validatePayload(input: unknown): DeliveryPayload {
  const payload = input as Partial<DeliveryPayload> | null;
  if (!payload || payload.purpose !== "school_login")
    throw new Error("Unsupported delivery purpose");
  if (!/^passwordless-[0-9a-f-]{36}$/i.test(payload.eventId || ""))
    throw new Error("Invalid delivery event");
  if (payload.channel !== "sms" && payload.channel !== "email")
    throw new Error("Invalid delivery channel");
  if (!/^\d{6}$/.test(payload.code || ""))
    throw new Error("Invalid one-time code");
  if (typeof payload.message !== "string" || payload.message.length < 10 || payload.message.length > 1200)
    throw new Error("Invalid delivery message");
  const expiresAt = new Date(payload.expiresAt || "");
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
    throw new Error("Expired delivery event");
  let magicLink: URL;
  try {
    magicLink = new URL(payload.magicLink || "");
  } catch {
    throw new Error("Invalid magic link");
  }
  if (
    magicLink.protocol !== "https:" ||
    magicLink.hostname !== "school-188-225-38-55.sslip.io" ||
    magicLink.pathname !== "/api/auth/passwordless/magic"
  )
    throw new Error("Invalid magic link");
  if (payload.channel === "sms") {
    if (!/^\+7\d{10}$/.test(payload.target || ""))
      throw new Error("Invalid SMS target");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.target || "")) {
    throw new Error("Invalid email target");
  }
  return payload as DeliveryPayload;
}

async function ensureDeliveryTable() {
  await database()
    .prepare(
      `CREATE TABLE IF NOT EXISTS school_passwordless_deliveries (
        event_id TEXT PRIMARY KEY NOT NULL,
        channel TEXT NOT NULL,
        target_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_message_id TEXT,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )`,
    )
    .run();
  await database()
    .prepare(
      "CREATE INDEX IF NOT EXISTS school_passwordless_deliveries_created_idx ON school_passwordless_deliveries (created_at, status)",
    )
    .run();
  await database()
    .prepare(
      "DELETE FROM school_passwordless_deliveries WHERE created_at < ?",
    )
    .bind(Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60)
    .run();
}

function providerFor(channel: "sms" | "email") {
  const config = runtimeEnv();
  if (channel === "sms" && config.SMS_RU_API_ID?.trim()) return "sms_ru";
  if (
    channel === "email" &&
    config.RESEND_API_KEY?.trim() &&
    config.SCHOOL_EMAIL_FROM?.trim()
  )
    return "resend";
  throw new Error(
    channel === "sms"
      ? "SMS delivery provider is not configured"
      : "Email delivery provider is not configured",
  );
}

async function deliverSms(payload: DeliveryPayload) {
  const apiId = runtimeEnv().SMS_RU_API_ID?.trim() || "";
  const phone = payload.target.replace(/^\+/, "");
  const form = new URLSearchParams({
    api_id: apiId,
    to: phone,
    msg: payload.message,
    json: "1",
  });
  const response = await fetch("https://sms.ru/sms/send", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = (await response.json().catch(() => null)) as
    | {
        status_code?: number;
        sms?: Record<string, { status_code?: number; sms_id?: string }>;
      }
    | null;
  const item = result?.sms?.[phone];
  if (!response.ok || result?.status_code !== 100 || item?.status_code !== 100)
    throw new Error("SMS provider rejected the message");
  return item.sms_id || payload.eventId;
}

async function deliverEmail(payload: DeliveryPayload) {
  const config = runtimeEnv();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.RESEND_API_KEY?.trim() || ""}`,
      "content-type": "application/json",
      "idempotency-key": payload.eventId,
    },
    body: JSON.stringify({
      from: config.SCHOOL_EMAIL_FROM?.trim(),
      to: [payload.target],
      subject: "Код входа в электронный дневник",
      text: payload.message,
      tags: [{ name: "purpose", value: "school_login" }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = (await response.json().catch(() => null)) as
    | { id?: string }
    | null;
  if (!response.ok || !result?.id)
    throw new Error("Email provider rejected the message");
  return result.id;
}

export async function processSchoolPasswordlessDelivery(request: Request) {
  const body = await request.text();
  await verifySignature(request, body);
  const payload = validatePayload(JSON.parse(body));
  await ensureDeliveryTable();
  const existing = await database()
    .prepare(
      "SELECT status, provider, provider_message_id FROM school_passwordless_deliveries WHERE event_id = ?",
    )
    .bind(payload.eventId)
    .first<DeliveryRow>();
  if (existing?.status === "completed")
    return {
      ok: true,
      duplicate: true,
      provider: existing.provider,
      messageId: existing.provider_message_id,
    };

  const provider = providerFor(payload.channel);
  const now = Math.floor(Date.now() / 1000);
  await database()
    .prepare(
      `INSERT INTO school_passwordless_deliveries
        (event_id, channel, target_hash, status, provider, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         status = 'pending', provider = excluded.provider, last_error = NULL`,
    )
    .bind(
      payload.eventId,
      payload.channel,
      await sha256Hex(payload.target),
      provider,
      now,
    )
    .run();

  try {
    const messageId =
      provider === "sms_ru"
        ? await deliverSms(payload)
        : await deliverEmail(payload);
    await database()
      .prepare(
        `UPDATE school_passwordless_deliveries
         SET status = 'completed', provider_message_id = ?, completed_at = ?, last_error = NULL
         WHERE event_id = ?`,
      )
      .bind(messageId, Math.floor(Date.now() / 1000), payload.eventId)
      .run();
    return { ok: true, duplicate: false, provider, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery failed";
    await database()
      .prepare(
        `UPDATE school_passwordless_deliveries
         SET status = 'failed', last_error = ? WHERE event_id = ?`,
      )
      .bind(message.slice(0, 240), payload.eventId)
      .run();
    throw error;
  }
}