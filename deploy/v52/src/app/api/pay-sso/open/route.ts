import { getAuthenticatedSession } from "../../../../lib/production-auth";
import { artHelloPublicOrigin, payPublicOrigin, requireCurrentPaySsoIdentity } from "../../../../lib/pay-sso";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const requestedAction = requestUrl.searchParams.get("action");
  const payAction = requestedAction === "invoice" || requestedAction === "payment" ? requestedAction : "";
  const continuePath = payAction ? `/api/pay-sso/open?action=${payAction}` : "/api/pay-sso/open";
  let centralOrigin: string;
  let payOrigin: string;
  try {
    centralOrigin = artHelloPublicOrigin();
    payOrigin = payPublicOrigin();
  } catch {
    return Response.json({ error: "ArtHello Pay ещё не настроен" }, { status: 503, headers: noStore() });
  }
  const authenticated = await getAuthenticatedSession(request);
  if (!authenticated || authenticated.user.mustChangePassword) {
    const login = new URL("/school-sso/login", centralOrigin);
    login.searchParams.set("target", "pay");
    login.searchParams.set("continue", continuePath);
    return redirect(login);
  }
  try {
    await requireCurrentPaySsoIdentity(authenticated.user.userId);
    const target = new URL("/", payOrigin);
    target.searchParams.set("from", "arthello");
    if (payAction) target.searchParams.set("action", payAction);
    return redirect(target);
  } catch (error) {
    const target = new URL("/auth/central/denied", payOrigin);
    target.searchParams.set("reason", error instanceof Error ? error.message : "Доступ к ArtHello Pay не выдан");
    return redirect(target);
  }
}

function redirect(target: URL) {
  return new Response(null, { status: 303, headers: { location: target.toString(), ...noStore(), "referrer-policy": "no-referrer" } });
}

function noStore() {
  return { "cache-control": "private, no-store, max-age=0" };
}
