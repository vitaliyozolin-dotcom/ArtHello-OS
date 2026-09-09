import { ensureCoreTables } from "../../../../db";
import {
  appendAuthCookies,
  authenticate,
  ensureBootstrapOwnerAccess,
} from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureCoreTables();
    await ensureBootstrapOwnerAccess();
    const body = await request.json() as { login?: unknown; password?: unknown };
    const authenticated = await authenticate(body.login, body.password);
    const headers = privateHeaders();
    appendAuthCookies(headers, authenticated.token, authenticated.csrf);
    return Response.json(authenticated.user, { headers });
  } catch {
    return Response.json(
      { error: "Неверный логин или пароль" },
      { status: 401, headers: privateHeaders() },
    );
  }
}

function privateHeaders() {
  return new Headers({ "cache-control": "private, no-store, max-age=0" });
}
