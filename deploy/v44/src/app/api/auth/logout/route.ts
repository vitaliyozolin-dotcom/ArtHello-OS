import { appendClearedAuthCookies, logout } from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await logout(request);
  } catch {
    // Clearing the browser session is safe even when a stale CSRF token is supplied.
  }
  const headers = new Headers({ "cache-control": "no-store" });
  appendClearedAuthCookies(headers);
  return Response.json({ status: "ok" }, { headers });
}
