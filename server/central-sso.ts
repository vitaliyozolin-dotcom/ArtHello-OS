import { randomBytes, randomUUID } from "node:crypto";
import type { Role } from "../app/level-zero-types";
import { createSession } from "./auth";
import {
  pkceChallenge,
  reconcileCentralStaff,
  signPayload,
  verifySignedPayload,
  type CentralStaffIdentity,
} from "./identity-broker";
import { getDatabase } from "./database";

const TRANSACTION_COOKIE = "school_sso_tx";
const TRANSACTION_TTL_SECONDS = 5 * 60;
const ARTHELLO_FALLBACK_ORIGIN =
  "https://arthello-188-225-38-55.sslip.io";

type SsoTransaction = {
  state: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
};

type ExchangePayload = {
  ok?: boolean;
  identity?: {
    centralUserId?: string;
    displayName?: string;
    contact?: string;
    role?: string;
    accessVersion?: number;
  };
  error?: string;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function safeReturnTo(value: unknown) {
  const route = typeof value === "string" ? value.trim() : "";
  return route.startsWith("/") && !route.startsWith("//") ? route : "/";
}

function arthelloOrigin() {
  const value =
    process.env.ARTHELLO_PUBLIC_ORIGIN?.trim() || ARTHELLO_FALLBACK_ORIGIN;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Центр авторизации ArtHello OS настроен некорректно");
  }
  const isolatedLocalTest =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !isolatedLocalTest) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Центр авторизации ArtHello OS настроен некорректно");
  return url.origin;
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const item of cookie.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function encodeTransaction(transaction: SsoTransaction) {
  const payload = Buffer.from(JSON.stringify(transaction)).toString("base64url");
  return `${payload}.${signPayload(payload, "school-sso-transaction")}`;
}

function decodeTransaction(request: Request) {
  const raw = cookieValue(request, TRANSACTION_COOKIE);
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) throw new Error("Сеанс входа истёк. Начните вход заново");
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!verifySignedPayload(payload, signature, "school-sso-transaction"))
    throw new Error("Сеанс входа повреждён. Начните вход заново");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Сеанс входа повреждён. Начните вход заново");
  }
  const transaction = parsed as Partial<SsoTransaction>;
  if (
    typeof transaction.state !== "string" ||
    typeof transaction.verifier !== "string" ||
    typeof transaction.returnTo !== "string" ||
    typeof transaction.expiresAt !== "number" ||
    transaction.expiresAt <= nowSeconds() ||
    !/^[A-Za-z0-9_-]{40,180}$/.test(transaction.state) ||
    !/^[A-Za-z0-9_-]{40,180}$/.test(transaction.verifier)
  )
    throw new Error("Сеанс входа истёк. Начните вход заново");
  return transaction as SsoTransaction;
}

export function clearCentralSsoTransactionCookie() {
  return `${TRANSACTION_COOKIE}=; Path=/auth/central; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function startCentralSso(returnToInput: unknown) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const returnTo = safeReturnTo(returnToInput);
  const transaction: SsoTransaction = {
    state,
    verifier,
    returnTo,
    expiresAt: nowSeconds() + TRANSACTION_TTL_SECONDS,
  };
  const authorize = new URL("/api/school-sso/authorize", arthelloOrigin());
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorize.searchParams.set("return_to", returnTo);
  return {
    authorizeUrl: authorize.toString(),
    cookie: `${TRANSACTION_COOKIE}=${encodeURIComponent(encodeTransaction(transaction))}; Path=/auth/central; HttpOnly; Secure; SameSite=Lax; Max-Age=${TRANSACTION_TTL_SECONDS}`,
  };
}

function validateIdentity(payload: ExchangePayload): CentralStaffIdentity {
  const identity = payload.identity;
  const allowedRoles = new Set<Role>([
    "director",
    "deputy",
    "methodist",
    "admin",
    "teacher",
    "tech_admin",
  ]);
  if (
    !payload.ok ||
    !identity ||
    typeof identity.centralUserId !== "string" ||
    typeof identity.displayName !== "string" ||
    typeof identity.contact !== "string" ||
    typeof identity.role !== "string" ||
    !allowedRoles.has(identity.role as Role) ||
    !Number.isInteger(identity.accessVersion) ||
    Number(identity.accessVersion) < 1
  )
    throw new Error(payload.error || "ArtHello OS не подтвердила доступ к дневнику");
  return {
    centralUserId: identity.centralUserId,
    displayName: identity.displayName,
    contact: identity.contact,
    role: identity.role as Role,
    accessVersion: Number(identity.accessVersion),
  };
}

export async function finishCentralSso(
  request: Request,
  codeInput: unknown,
  stateInput: unknown,
) {
  const transaction = decodeTransaction(request);
  const code = typeof codeInput === "string" ? codeInput.trim() : "";
  const state = typeof stateInput === "string" ? stateInput.trim() : "";
  if (!code || state !== transaction.state)
    throw new Error("ArtHello OS вернула недействительный сеанс входа");

  const exchangeUrl = new URL("/api/school-sso/exchange", arthelloOrigin());
  const response = await fetch(exchangeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: transaction.verifier }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = (await response.json().catch(() => ({}))) as ExchangePayload;
  if (!response.ok)
    throw new Error(payload.error || "ArtHello OS временно недоступна");

  const identity = validateIdentity(payload);
  const user = await reconcileCentralStaff(identity);
  await getDatabase()
    .prepare(
      "UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(user.id)
    .run();
  await getDatabase()
    .prepare(
      "INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'auth.central_sso', 'user', ?, ?)",
    )
    .bind(
      `audit-${randomUUID()}`,
      user.id,
      user.id,
      `ArtHello OS SSO: ${identity.centralUserId}`.slice(0, 500),
    )
    .run();
  return {
    cookie: await createSession(user, request),
    clearCookie: clearCentralSsoTransactionCookie(),
    returnTo: transaction.returnTo,
    user,
  };
}
