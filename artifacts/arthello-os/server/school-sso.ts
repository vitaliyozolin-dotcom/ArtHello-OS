import { createHmac, randomUUID } from "node:crypto";
import * as centralAuth from "./auth";

const DEFAULT_SCHOOL_ORIGIN = "https://school-188-225-38-55.sslip.io";
const AUTH_FUNCTION_CANDIDATES = [
  "requireAuthenticatedUser",
  "requireSessionUser",
  "requireUser",
  "getAuthenticatedUser",
  "getCurrentUser",
  "getSessionUser",
  "getAuthUser",
  "currentUser",
] as const;

type UnknownRecord = Record<string, unknown>;

type CentralIdentity = {
  centralUserId: string;
  status: string;
};

function sharedSecret() {
  const value =
    process.env.SCHOOL_IDENTITY_SECRET?.trim() ||
    process.env.CENTRAL_ACCESS_SECRET?.trim() ||
    "";
  if (value.length < 32)
    throw new Error("Связь с электронным дневником не настроена");
  return value;
}

function schoolOrigin() {
  const raw =
    process.env.SCHOOL_DIARY_ORIGIN?.trim() || DEFAULT_SCHOOL_ORIGIN;
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Некорректный адрес электронного дневника");
  return url.origin;
}

function safeReturnTo(value: unknown) {
  const route = typeof value === "string" ? value.trim() : "";
  if (!route.startsWith("/") || route.startsWith("//")) return "/";
  try {
    const target = new URL(route, "https://school.invalid");
    if (target.origin !== "https://school.invalid") return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function unwrapUser(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  return (
    asRecord(record.user) ||
    asRecord(record.sessionUser) ||
    asRecord(record.account) ||
    record
  );
}

async function callAuthFunction(
  fn: (...args: unknown[]) => unknown,
  request: Request,
) {
  let firstError: unknown = null;
  try {
    const result = await fn(request);
    if (result) return result;
  } catch (error) {
    firstError = error;
  }
  try {
    const result = await fn();
    if (result) return result;
  } catch (error) {
    if (firstError) throw firstError;
    throw error;
  }
  if (firstError) throw firstError;
  return null;
}

export async function requireCentralIdentity(
  request: Request,
): Promise<CentralIdentity> {
  const module = centralAuth as unknown as Record<string, unknown>;
  let rawIdentity: unknown = null;
  for (const name of AUTH_FUNCTION_CANDIDATES) {
    const candidate = module[name];
    if (typeof candidate !== "function") continue;
    rawIdentity = await callAuthFunction(
      candidate as (...args: unknown[]) => unknown,
      request,
    );
    if (rawIdentity) break;
  }
  const user = unwrapUser(rawIdentity);
  if (!user) throw new Error("Требуется вход в ArtHello OS");

  const centralUserId = String(
    user.centralUserId ?? user.userId ?? user.id ?? user.sub ?? "",
  ).trim();
  if (centralUserId.length < 3)
    throw new Error("Не удалось определить пользователя ArtHello OS");

  const status = String(user.status ?? "active").toLowerCase();
  if (["blocked", "revoked", "disabled", "inactive"].includes(status))
    throw new Error("Доступ пользователя отключён");
  if (user.canAccessSchool === false || user.schoolAccess === false)
    throw new Error("Доступ к дневнику не назначен");
  return { centralUserId, status };
}

export async function createSchoolSsoUrl(
  request: Request,
  returnToInput: unknown,
) {
  const identity = await requireCentralIdentity(request);
  const requestId = `sso-${randomUUID()}`;
  const body = JSON.stringify({
    requestId,
    issuedAt: new Date().toISOString(),
    centralUserId: identity.centralUserId,
    returnTo: safeReturnTo(returnToInput),
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", sharedSecret())
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const origin = schoolOrigin();
  const response = await fetch(
    `${origin}/api/internal/staff-sso/authorize-v2`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-arthello-timestamp": timestamp,
        "x-arthello-signature": signature,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { callbackPath?: string; error?: string }
    | null;
  if (
    !response.ok ||
    !payload?.callbackPath ||
    !payload.callbackPath.startsWith("/api/auth/staff-sso?token=")
  )
    throw new Error(payload?.error || "Дневник не подтвердил доступ");
  return new URL(payload.callbackPath, origin).toString();
}
