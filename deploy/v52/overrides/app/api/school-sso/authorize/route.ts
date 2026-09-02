import { getAuthenticatedSession } from "../../../../lib/production-auth";
import { loadSchoolSystemGrant } from "../../../../lib/school-sso-access";
import {
  issueSchoolSsoCode,
  schoolPublicOrigin,
  type SchoolRole,
} from "../../../../lib/school-sso";

export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null) {
  const route = value?.trim() || "/";
  return route.startsWith("/") && !route.startsWith("//") ? route : "/";
}

function validOpaque(value: string | null, min: number, max: number) {
  return Boolean(
    value &&
      value.length >= min &&
      value.length <= max &&
      /^[A-Za-z0-9_-]+$/.test(value),
  );
}

function activeStatus(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (
    normalized === "active" ||
    normalized === "enabled" ||
    normalized.includes("актив") ||
    normalized.includes("выдан")
  );
}

function schoolRole(value: unknown): SchoolRole | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized.includes("техничес") || normalized.includes("tech"))
    return "tech_admin";
  if (normalized.includes("директор") || normalized === "director")
    return "director";
  if (normalized.includes("завуч") || normalized.includes("deputy"))
    return "deputy";
  if (normalized.includes("методист") || normalized === "methodist")
    return "methodist";
  if (normalized.includes("администратор") || normalized === "admin")
    return "admin";
  if (
    normalized.includes("учитель") ||
    normalized.includes("педагог") ||
    normalized === "teacher"
  )
    return "teacher";
  return null;
}

function continuePath(url: URL) {
  return `${url.pathname}${url.search}`;
}

function loginRedirect(url: URL) {
  const login = new URL("/school-sso/login", url.origin);
  login.searchParams.set("continue", continuePath(url));
  return login;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));

  if (!validOpaque(state, 40, 180) || !validOpaque(codeChallenge, 43, 128))
    return Response.json(
      { error: "Некорректный запрос входа в дневник" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );

  const authenticated = await getAuthenticatedSession(request);
  if (!authenticated)
    return new Response(null, {
      status: 303,
      headers: {
        location: loginRedirect(url).toString(),
        "cache-control": "no-store",
      },
    });

  try {
    const me = authenticated.access;
    if (!me?.app_user_id || !me.display_name)
      throw new Error("Учётная запись ArtHello OS не найдена");

    const owner = authenticated.user.role === "owner";
    const grant = owner ? null : await loadSchoolSystemGrant(me.app_user_id);
    if (!owner && (!grant || !activeStatus(grant.status)))
      throw new Error("Доступ к электронному дневнику не выдан");

    const role = owner ? "director" : schoolRole(grant?.role);
    if (!role)
      throw new Error("Роль в электронном дневнике не настроена");

    const accessVersion = Number.isInteger(me.user_access_version)
      ? Math.max(1, Number(me.user_access_version))
      : 1;
    const authorization = await issueSchoolSsoCode(
      {
        centralUserId: me.app_user_id,
        displayName: me.display_name,
        contact: me.contact || "",
        role,
        accessVersion,
      },
      codeChallenge as string,
      returnTo,
    );

    const callback = new URL("/auth/central/callback", schoolPublicOrigin());
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
    const denied = new URL("/login", schoolPublicOrigin());
    denied.searchParams.set("authError", "central_denied");
    const message = error instanceof Error ? error.message : "Доступ не подтверждён";
    denied.searchParams.set("reason", message.slice(0, 160));
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
