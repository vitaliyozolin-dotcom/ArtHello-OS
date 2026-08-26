import { NextResponse } from "next/server";
import { getAuthenticatedRequestContext } from "./lib/production-auth";

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/integrations/tochka/callback",
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const API_ROLES = [
  "OWNER", "DIRECTOR", "ADMIN", "DEPUTY", "FINANCE", "ACCOUNTING", "HR", "SALES", "MARKETING",
  "TEACHER", "METHODIST", "KITCHEN", "PROCUREMENT", "SAFETY", "MEDICAL", "LEGAL", "INTEGRATIONS",
  "ANALYTICS", "PROJECTS", "EMPLOYEE", "QUALITY",
] as const;

type ApiRole = typeof API_ROLES[number];
type ApiRule = { prefix: string; read: readonly ApiRole[]; write: readonly ApiRole[] };

const withOwner = (...roles: Exclude<ApiRole, "OWNER">[]) => ["OWNER", ...roles] as const;
const allRoles = [...API_ROLES];

const API_RULES: ApiRule[] = [
  { prefix: "/api/settings/temporary-credential", read: [], write: withOwner() },
  { prefix: "/api/settings", read: allRoles, write: withOwner() },
  { prefix: "/api/finance-actions", read: [], write: withOwner("DIRECTOR", "FINANCE") },
  { prefix: "/api/finance", read: withOwner("DIRECTOR", "FINANCE", "ACCOUNTING", "ANALYTICS"), write: [] },
  { prefix: "/api/accounting-actions", read: [], write: withOwner("DIRECTOR", "ACCOUNTING") },
  { prefix: "/api/accounting", read: withOwner("DIRECTOR", "ACCOUNTING", "FINANCE", "LEGAL"), write: [] },
  { prefix: "/api/sales-actions", read: [], write: withOwner("DIRECTOR", "SALES") },
  { prefix: "/api/sales", read: withOwner("DIRECTOR", "SALES", "MARKETING", "FINANCE", "ANALYTICS"), write: [] },
  { prefix: "/api/content-actions", read: [], write: withOwner("DIRECTOR", "MARKETING") },
  { prefix: "/api/content-generate", read: [], write: withOwner("DIRECTOR", "MARKETING") },
  { prefix: "/api/content", read: withOwner("DIRECTOR", "ADMIN", "MARKETING", "ANALYTICS"), write: [] },
  { prefix: "/api/education-actions", read: [], write: withOwner("DIRECTOR", "ADMIN", "DEPUTY", "METHODIST", "TEACHER") },
  { prefix: "/api/education", read: withOwner("DIRECTOR", "ADMIN", "DEPUTY", "METHODIST", "TEACHER"), write: [] },
  { prefix: "/api/hr-actions", read: [], write: withOwner("DIRECTOR", "HR") },
  { prefix: "/api/hr", read: withOwner("DIRECTOR", "HR"), write: [] },
  { prefix: "/api/legal-actions", read: [], write: withOwner("DIRECTOR", "LEGAL") },
  { prefix: "/api/legal", read: withOwner("DIRECTOR", "LEGAL"), write: [] },
  { prefix: "/api/medical-actions", read: [], write: withOwner("DIRECTOR", "MEDICAL") },
  { prefix: "/api/medical", read: withOwner("DIRECTOR", "MEDICAL"), write: [] },
  { prefix: "/api/integration-actions", read: [], write: withOwner("DIRECTOR", "INTEGRATIONS") },
  { prefix: "/api/integrations", read: withOwner("DIRECTOR", "INTEGRATIONS", "FINANCE", "ACCOUNTING"), write: [] },
  { prefix: "/api/analytics-actions", read: [], write: withOwner("DIRECTOR", "ANALYTICS") },
  { prefix: "/api/analytics", read: withOwner("DIRECTOR", "ANALYTICS", "FINANCE"), write: [] },
  { prefix: "/api/procurement-actions", read: [], write: withOwner("DIRECTOR", "PROCUREMENT") },
  { prefix: "/api/procurement", read: withOwner("DIRECTOR", "PROCUREMENT", "FINANCE"), write: [] },
  { prefix: "/api/food-actions", read: [], write: withOwner("DIRECTOR", "KITCHEN") },
  { prefix: "/api/food", read: withOwner("DIRECTOR", "KITCHEN", "FINANCE"), write: [] },
  { prefix: "/api/safety-actions", read: [], write: withOwner("DIRECTOR", "SAFETY") },
  { prefix: "/api/safety", read: withOwner("DIRECTOR", "SAFETY", "FINANCE"), write: [] },
  { prefix: "/api/strategy-actions", read: [], write: withOwner("DIRECTOR", "PROJECTS") },
  { prefix: "/api/strategy", read: withOwner("DIRECTOR", "PROJECTS", "FINANCE"), write: [] },
  { prefix: "/api/readiness-actions", read: [], write: withOwner("DIRECTOR", "QUALITY") },
  { prefix: "/api/readiness", read: withOwner("DIRECTOR", "QUALITY", "ANALYTICS", "INTEGRATIONS"), write: [] },
  { prefix: "/api/acceptance", read: withOwner("DIRECTOR", "QUALITY"), write: withOwner() },
  { prefix: "/api/contractors", read: withOwner("DIRECTOR", "ADMIN", "PROCUREMENT", "FINANCE", "ACCOUNTING", "LEGAL"), write: [] },
  { prefix: "/api/families", read: withOwner("DIRECTOR", "ADMIN", "DEPUTY", "SALES"), write: withOwner("DIRECTOR", "ADMIN", "SALES") },
  { prefix: "/api/entity-detail", read: withOwner("DIRECTOR", "ADMIN", "SALES", "HR", "FINANCE", "ACCOUNTING", "LEGAL", "PROCUREMENT"), write: [] },
  { prefix: "/api/entity-relations", read: [], write: withOwner("DIRECTOR", "ADMIN") },
  { prefix: "/api/entity-documents", read: [], write: withOwner("DIRECTOR", "ADMIN", "HR", "LEGAL", "ACCOUNTING", "PROCUREMENT") },
  { prefix: "/api/entity-merge", read: [], write: withOwner("DIRECTOR", "ADMIN") },
  { prefix: "/api/entities", read: withOwner("DIRECTOR", "ADMIN", "SALES", "HR", "FINANCE", "ACCOUNTING", "LEGAL", "PROCUREMENT"), write: withOwner("DIRECTOR", "ADMIN") },
  { prefix: "/api/workflow-documents", read: withOwner("DIRECTOR", "ADMIN", "HR", "LEGAL", "ACCOUNTING", "FINANCE", "PROCUREMENT"), write: withOwner("DIRECTOR", "ADMIN", "HR", "LEGAL", "ACCOUNTING", "PROCUREMENT") },
  { prefix: "/api/audit", read: withOwner("DIRECTOR", "ADMIN", "QUALITY", "LEGAL"), write: [] },
  { prefix: "/api/data-mode", read: withOwner("DIRECTOR", "ANALYTICS", "QUALITY"), write: [] },
  { prefix: "/api/task-actions", read: allRoles, write: allRoles },
  { prefix: "/api/tasks", read: allRoles, write: allRoles },
  { prefix: "/api/work-items", read: allRoles, write: [] },
  { prefix: "/api/notifications", read: allRoles, write: allRoles },
].sort((left, right) => right.prefix.length - left.prefix.length);

export async function proxy(request: Request) {
  const pathname = new URL(request.url).pathname;
  const headers = sanitizedHeaders(request.headers);

  if (pathname.startsWith("/api/auth/") || PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  if (!hasTrustedMutationOrigin(request)) {
    return privateJson({ error: "Запрос отклонён: источник страницы не совпадает" }, 403);
  }

  let context: Awaited<ReturnType<typeof getAuthenticatedRequestContext>>;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return privateJson({ error: "Сервис авторизации временно недоступен" }, 503);
  }

  if (!context) {
    return privateJson({ error: "Требуется вход" }, 401);
  }

  if (context.auth.user.mustChangePassword) {
    return privateJson({ error: "Сначала смените временный пароль" }, 403);
  }

  if (!canAccessApi(context.apiRole, pathname, request.method)) {
    return privateJson({ error: "Нет доступа к этому разделу" }, 403);
  }

  headers.set("oai-authenticated-user-email", context.actor);
  headers.set("oai-authenticated-user-full-name", encodeURIComponent(context.appUserName));
  headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  headers.set("x-arthello-role", context.apiRole);

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

function canAccessApi(role: string, pathname: string, method: string) {
  if (role === "OWNER") return true;
  if (!API_ROLES.includes(role as ApiRole)) return false;
  const rule = API_RULES.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  if (!rule) return false;
  const allowed = SAFE_METHODS.has(method.toUpperCase()) ? rule.read : rule.write;
  return allowed.includes(role as ApiRole);
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
