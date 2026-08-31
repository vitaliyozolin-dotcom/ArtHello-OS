import { startCentralSso } from "../../../../server/central-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const transaction = startCentralSso(url.searchParams.get("returnTo"));
    return new Response(null, {
      status: 303,
      headers: {
        location: transaction.authorizeUrl,
        "set-cookie": transaction.cookie,
        "cache-control": "no-store",
      },
    });
  } catch {
    const login = new URL("/login", url.origin);
    login.searchParams.set("authError", "central_unavailable");
    return new Response(null, {
      status: 303,
      headers: { location: login.toString(), "cache-control": "no-store" },
    });
  }
}
