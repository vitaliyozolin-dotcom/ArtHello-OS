import {
  clearCentralSsoTransactionCookie,
  finishCentralSso,
  schoolPublicOrigin,
} from "../../../../server/central-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = schoolPublicOrigin();
  try {
    if (url.searchParams.get("error"))
      throw new Error("ArtHello OS не подтвердила доступ к дневнику");
    const completed = await finishCentralSso(
      request,
      url.searchParams.get("code"),
      url.searchParams.get("state"),
    );
    const target = new URL(completed.returnTo, publicOrigin);
    const headers = new Headers({
      location: target.toString(),
      "cache-control": "no-store",
    });
    headers.append("set-cookie", completed.cookie);
    headers.append("set-cookie", completed.clearCookie);
    return new Response(null, { status: 303, headers });
  } catch (error) {
    console.error(
      "school_sso.callback_failed",
      error instanceof Error ? error.message : "unknown",
    );
    const login = new URL("/login", publicOrigin);
    login.searchParams.set("authError", "central_denied");
    const headers = new Headers({
      location: login.toString(),
      "cache-control": "no-store",
    });
    headers.append("set-cookie", clearCentralSsoTransactionCookie());
    return new Response(null, { status: 303, headers });
  }
}
