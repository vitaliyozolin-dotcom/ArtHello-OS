import { isTochkaAutosyncRequest } from './lib/tochka-autosync';
// TOCHKA_AUTOMATIC_READONLY_V1
import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { canAccessApi } from "./lib/access-policy";
import { getAuthenticatedRequestContext } from "./lib/production-auth";
import { authRouteDecision, hasTrustedMutationOrigin, publicApiRouteDecision } from "./lib/request-security";

export async function proxy(request: Request) {
  const pathname = new URL(request.url).pathname;
  const headers = sanitizedHeaders(request.headers);
  const authRoute = authRouteDecision(pathname, request.method);
  const publicRoute = publicApiRouteDecision(pathname, request.method);

  const rejectedRoute = authRoute?.kind === "reject" ? authRoute : publicRoute?.kind === "reject" ? publicRoute : null;
  if (rejectedRoute) {
    return privateJson(
      { error: rejectedRoute.status === 405 ? "Метод не поддерживается" : "Маршрут авторизации не найден" },
      rejectedRoute.status,
      rejectedRoute.allow ? { allow: rejectedRoute.allow } : undefined,
    );
  }

  if (publicRoute?.kind === "allow") {
    return NextResponse.next({ request: { headers } });
  }

  const schedulerSecret = (env as unknown as { TOCHKA_AUTOSYNC_SECRET?: string }).TOCHKA_AUTOSYNC_SECRET;
  if (schedulerSecret && await isTochkaAutosyncRequest(request, schedulerSecret)) {
    return NextResponse.next({ request: { headers } });
  }

  if (!hasTrustedMutationOrigin(request, runtimePublicOrigin(), runtimeTrustedWebOrigins())) {
    return privateJson({ error: "Запрос отклонён: источник страницы не совпадает" }, 403);
  }

  if (authRoute?.kind === "allow" && authRoute.access === "public") {
    return NextResponse.next({ request: { headers } });
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

  const isAuthSessionAction = authRoute?.kind === "allow" && authRoute.access === "session";
  if (context.auth.user.mustChangePassword && !isAuthSessionAction) {
    return privateJson({ error: "Сначала смените временный пароль" }, 403);
  }

  if (!isAuthSessionAction && !canAccessApi(context.auth.user, pathname, request.method)) {
    return privateJson({ error: "Нет доступа к этому разделу" }, 403);
  }

  headers.set("oai-authenticated-user-email", context.actor);
  headers.set("oai-authenticated-user-full-name", encodeURIComponent(context.appUserName));
  headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  headers.set("x-arthello-role", context.apiRole);
  headers.set("x-arthello-system-owner", context.auth.user.isSystemOwner ? "1" : "0");

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
  headers.delete("x-arthello-system-owner");
  return headers;
}

function runtimePublicOrigin() {
  return (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN?.trim() ?? "";
}

function runtimeTrustedWebOrigins() {
  return (env as unknown as { ARTHELLO_TRUSTED_WEB_ORIGINS?: string }).ARTHELLO_TRUSTED_WEB_ORIGINS?.trim() ?? "";
}

function privateJson(body: Record<string, string>, status: number, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "private, no-store");
  return Response.json(body, {
    status,
    headers,
  });
}
