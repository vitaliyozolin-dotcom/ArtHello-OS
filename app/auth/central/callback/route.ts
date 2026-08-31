import {
  clearCentralSsoTransactionCookie,
  finishCentralSso,
} from "../../../../server/central-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("error"))
      throw new Error("ArtHello OS не подтвердила доступ к дневнику");
    const completed = await finishCentralSso(
      request,
      url.searchParams.get("code"),
      url.searchParams.get("state"),
    );
    const target = new URL(completed.returnTo, url.origin);
    const headers = new Headers({
      location: target.toString(),
      "cache-control": "no-store",
    });
    headers.append("set-cookie", completed.cookie);
    headers.append("set-cookie", completed.clearCookie);
    return new Response(null, { status: 303, headers });
  } catch {
    const login = new URL("/login", url.origin);
    login.searchParams.set("authError", "central_denied");
    const headers = new Headers({
      location: login.toString(),
      "cache-control": "no-store",
    });
    headers.append("set-cookie", clearCentralSsoTransactionCookie());
    return new Response(null, { status: 303, headers });
  }
}
