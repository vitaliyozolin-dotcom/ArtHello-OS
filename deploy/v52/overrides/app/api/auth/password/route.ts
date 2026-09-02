import {
  appendClearedAuthCookies,
  changePassword,
  getAuthenticatedRequestContext,
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
    const body = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
    await changePassword(request, body.currentPassword, body.newPassword);
    const headers = privateHeaders();
    appendClearedAuthCookies(headers);
    return Response.json({ message: "Пароль изменён. Войдите снова." }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить пароль" },
      { status: 400, headers: privateHeaders() },
    );
  }
}

function privateHeaders() {
  return new Headers({ "cache-control": "private, no-store, max-age=0" });
}
