import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "./lib/production-auth";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

type AppUserRow = {
  contact: string;
  status: string;
  is_administrative: number;
};

type AuthenticatedSession = NonNullable<Awaited<ReturnType<typeof getAuthenticatedSession>>>;

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/integrations/tochka/callback",
]);

const ROLE_CODES = {
  owner: "OWNER",
  accountant: "ACCOUNTING",
  viewer: "VIEWER",
} as const;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OWNER_CONTACT = "vitaliyozolin@gmail.com";

export async function proxy(request: Request) {
  const pathname = new URL(request.url).pathname;
  const headers = sanitizedHeaders(request.headers);

  if (pathname.startsWith("/api/auth/") || PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  if (!hasTrustedMutationOrigin(request)) {
    return privateJson({ error: "Запрос отклонён: источник страницы не совпадает" }, 403);
  }

  let authenticated: AuthenticatedSession | null;
  try {
    authenticated = await getAuthenticatedSession(request);
  } catch {
    return privateJson({ error: "Сервис авторизации временно недоступен" }, 503);
  }

  if (!authenticated) {
    return privateJson({ error: "Требуется вход" }, 401);
  }

  let actor: string | null;
  try {
    actor = await resolveActor(authenticated);
  } catch {
    return privateJson({ error: "Не удалось проверить права пользователя" }, 503);
  }

  if (!actor) {
    return privateJson({ error: "Доступ пользователя приостановлен или не назначен" }, 403);
  }

  headers.set("oai-authenticated-user-email", actor);
  headers.set("oai-authenticated-user-full-name", encodeURIComponent(authenticated.user.name));
  headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  headers.set("x-arthello-role", ROLE_CODES[authenticated.user.role]);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};

function sanitizedHeaders(source: Headers) {
  const headers = new Headers(source);
  headers.delete("oai-authenticated-user-email");
  headers.delete("oai-authenticated-user-full-name");
  headers.delete("oai-authenticated-user-full-name-encoding");
  headers.delete("x-arthello-role");
  return headers;
}

async function resolveActor(authenticated: AuthenticatedSession) {
  const appUserId = authenticated.session.user_id === "AUTH-OWNER"
    ? "USR-OWNER"
    : authenticated.session.user_id;

  const row = await database().prepare(
    "SELECT contact,status,is_administrative FROM app_users WHERE id=?",
  ).bind(appUserId).first<AppUserRow>();

  if (!row) {
    return authenticated.user.role === "owner" ? OWNER_CONTACT : null;
  }

  if (row.status !== "Активен") return null;
  if (authenticated.user.role === "owner" && !row.is_administrative) return null;

  const contact = row.contact.trim().toLowerCase();
  return contact || null;
}

function database() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("Production database is unavailable");
  return db;
}

function hasTrustedMutationOrigin(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const expectedHost = (
    request.headers.get("x-forwarded-host")
    ?? request.headers.get("host")
    ?? new URL(request.url).host
  ).split(",")[0].trim().toLowerCase();

  const expectedProtocol = (
    request.headers.get("x-forwarded-proto")
    ?? new URL(request.url).protocol.replace(":", "")
  ).split(",")[0].trim().toLowerCase();

  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return false;

  try {
    const sourceUrl = new URL(source);
    return sourceUrl.host.toLowerCase() === expectedHost
      && sourceUrl.protocol.toLowerCase() === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}

function privateJson(body: Record<string, string>, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}
