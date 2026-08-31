import { verifyPasswordlessMagicToken } from "../../../../../server/identity-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const completed = await verifyPasswordlessMagicToken(
      url.searchParams.get("token"),
      request,
    );
    const target = new URL(completed.returnTo, url.origin);
    return new Response(null, {
      status: 303,
      headers: {
        location: target.toString(),
        "set-cookie": completed.cookie,
        "cache-control": "no-store",
      },
    });
  } catch {
    const login = new URL("/login", url.origin);
    login.searchParams.set("authError", "expired_link");
    return new Response(null, {
      status: 303,
      headers: {
        location: login.toString(),
        "cache-control": "no-store",
      },
    });
  }
}
