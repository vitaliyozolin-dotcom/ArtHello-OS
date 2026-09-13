import { ensureCoreTables } from "../../../../db";
import {
  appendAuthCookies,
  authenticate,
  ensureBootstrapOwnerAccess,
} from "../../../../lib/production-auth";
import { payPublicOrigin } from "../../../../lib/pay-sso";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (isPayOrigin(request)) {
      return Response.json(
        { error: "Вход в ArtHello Pay выполняется через ArtHello OS" },
        { status: 403, headers: privateHeaders() },
      );
    }
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

function isPayOrigin(request: Request) {
  try {
    const payOrigin = payPublicOrigin();
    const requestOrigin = new URL(request.url).origin;
    const source = request.headers.get("origin") ?? request.headers.get("referer");
    return requestOrigin === payOrigin || Boolean(source && new URL(source).origin === payOrigin);
  } catch {
    return false;
  }
}

function privateHeaders() {
  return new Headers({ "cache-control": "private, no-store, max-age=0" });
}
