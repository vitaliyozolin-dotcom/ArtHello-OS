import { appendAuthCookies, authenticate } from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { login?: unknown; password?: unknown };
    const authenticated = await authenticate(payload.login, payload.password);
    const headers = new Headers({ "cache-control": "no-store" });
    appendAuthCookies(headers, authenticated.token, authenticated.csrf);
    return Response.json(authenticated.user, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось войти";
    return Response.json({ error: message }, { status: 401, headers: { "cache-control": "no-store" } });
  }
}
