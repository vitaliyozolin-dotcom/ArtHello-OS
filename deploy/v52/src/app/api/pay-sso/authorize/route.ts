import { getAuthenticatedSession } from "../../../../lib/production-auth";
import {
  artHelloPublicOrigin,
  issuePaySsoCode,
  payPublicOrigin,
  requireCurrentPaySsoIdentity,
} from "../../../../lib/pay-sso";

export const dynamic = "force-dynamic";

function validOpaque(value: string | null, min: number, max: number) {
  return Boolean(value && value.length >= min && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value));
}

function safeReturnTo(value: string | null) {
  const route = value?.trim() || "/";
  return route.startsWith("/") && !route.startsWith("//") && !route.includes("\\") && !/[\u0000-\u001f\u007f]/.test(route)
    ? route
    : "/";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const challenge = url.searchParams.get("code_challenge");
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));
  if (url.searchParams.get("system_id") !== "SYS-ARTHELLO-PAY" || !validOpaque(state, 40, 180) || !validOpaque(challenge, 43, 128)) {
    return Response.json({ error: "Некорректный запрос входа в ArtHello Pay" }, { status: 400, headers: noStore() });
  }

  let centralOrigin: string;
  let payOrigin: string;
  try {
    centralOrigin = artHelloPublicOrigin();
    payOrigin = payPublicOrigin();
  } catch {
    return Response.json({ error: "Вход в ArtHello Pay ещё не настроен" }, { status: 503, headers: noStore() });
  }
  const authenticated = await getAuthenticatedSession(request);
  if (!authenticated || authenticated.user.mustChangePassword) {
    const login = new URL("/school-sso/login", centralOrigin);
    login.searchParams.set("target", "pay");
    login.searchParams.set("continue", `${url.pathname}${url.search}`);
    return redirect(login);
  }

  try {
    const identity = await requireCurrentPaySsoIdentity(authenticated.user.userId);
    const authorization = await issuePaySsoCode(identity, challenge as string, returnTo);
    const callback = new URL("/auth/central/callback", payOrigin);
    callback.searchParams.set("code", authorization.code);
    callback.searchParams.set("state", state as string);
    return redirect(callback);
  } catch (error) {
    const denied = new URL("/auth/central/denied", payOrigin);
    denied.searchParams.set("reason", error instanceof Error ? error.message : "Доступ к ArtHello Pay не выдан");
    return redirect(denied);
  }
}

function redirect(target: URL) {
  return new Response(null, { status: 303, headers: { location: target.toString(), ...noStore(), "referrer-policy": "no-referrer" } });
}

function noStore() {
  return { "cache-control": "private, no-store, max-age=0" };
}
