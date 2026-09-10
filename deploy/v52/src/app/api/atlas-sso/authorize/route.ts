import { getAuthenticatedSession } from "../../../../lib/production-auth";
import {
  artHelloPublicOrigin,
  issueAtlasSsoCode,
  requireCurrentAtlasSsoIdentity,
  atlasPublicOrigin,
} from "../../../../lib/atlas-sso";

export const dynamic = "force-dynamic";

const expectedAccessErrors = new Set([
  "Учётная запись ArtHello OS не найдена",
  "Доступ к электронному дневнику не выдан",
  "Роль в электронном дневнике не настроена",
  "Права доступа изменились. Начните вход в дневник заново",
]);

function safeReturnTo(value: string | null) {
  const route = value?.trim() || "/";
  return route.startsWith("/") &&
    !route.startsWith("//") &&
    !route.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(route)
    ? route
    : "/";
}

function validOpaque(value: string | null, min: number, max: number) {
  return Boolean(
    value &&
      value.length >= min &&
      value.length <= max &&
      /^[A-Za-z0-9_-]+$/.test(value),
  );
}

function continuePath(url: URL) {
  return `${url.pathname}${url.search}`;
}

function loginRedirect(url: URL, centralOrigin: string) {
  const login = new URL("/school-sso/login", centralOrigin);
  login.searchParams.set("continue", continuePath(url));
  return login;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));

  if (url.searchParams.get("system_id") !== "SYS-SCHOOL-ATLAS" || !validOpaque(state, 40, 180) || !validOpaque(codeChallenge, 43, 128))
    return Response.json(
      { error: "Некорректный запрос входа в дневник" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );

  let centralOrigin: string;
  let atlasOrigin: string;
  try {
    centralOrigin = artHelloPublicOrigin();
    atlasOrigin = atlasPublicOrigin();
  } catch {
    return Response.json(
      { error: "Вход в электронный дневник ещё не настроен" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const authenticated = await getAuthenticatedSession(request);
  if (!authenticated)
    return new Response(null, {
      status: 303,
      headers: {
        location: loginRedirect(url, centralOrigin).toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });

  if (authenticated.user.mustChangePassword)
    return new Response(null, {
      status: 303,
      headers: {
        location: loginRedirect(url, centralOrigin).toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });

  try {
    const identity = await requireCurrentAtlasSsoIdentity(
      authenticated.user.userId,
    );
    const authorization = await issueAtlasSsoCode(
      identity,
      codeChallenge as string,
      returnTo,
    );

    const callback = new URL("/auth/central/callback", atlasOrigin);
    callback.searchParams.set("code", authorization.code);
    callback.searchParams.set("state", state as string);
    return new Response(null, {
      status: 303,
      headers: {
        location: callback.toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    const denied = new URL("/login", atlasOrigin);
    denied.searchParams.set("authError", "central_denied");
    const message = error instanceof Error ? error.message : "Доступ не подтверждён";
    if (!expectedAccessErrors.has(message)) console.error("atlas_sso.authorize_failed");
    denied.searchParams.set(
      "reason",
      expectedAccessErrors.has(message) ? message : "Доступ не подтверждён",
    );
    return new Response(null, {
      status: 303,
      headers: {
        location: denied.toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }
}
