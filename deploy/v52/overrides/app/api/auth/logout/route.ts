import {
  appendClearedAuthCookies,
  getAuthenticatedRequestContext,
  logout,
  verifyAuthenticatedRequestCsrf,
} from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authenticated = await getAuthenticatedRequestContext(request);
  if (!authenticated) {
    return Response.json({ error: "Требуется вход" }, { status: 401, headers: privateHeaders() });
  }

  try {
    verifyAuthenticatedRequestCsrf(request, authenticated);
  } catch {
    return Response.json({ error: "Защитная сессия устарела. Войдите заново." }, { status: 403, headers: privateHeaders() });
  }

  try {
    await logout(request);
    const headers = privateHeaders();
    appendClearedAuthCookies(headers);
    return Response.json({ message: "Вы вышли из ArtHello OS" }, { headers });
  } catch {
    return Response.json({ error: "Не удалось завершить сессию" }, { status: 503, headers: privateHeaders() });
  }
}

function privateHeaders() {
  return new Headers({ "cache-control": "private, no-store, max-age=0" });
}
