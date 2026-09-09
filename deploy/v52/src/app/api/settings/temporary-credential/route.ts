import {
  getAuthenticatedRequestContext,
  isCanonicalOwnerContext,
  issueTemporaryCredential,
  ProductionAuthAdminError,
  verifyAuthenticatedRequestCsrf,
} from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

export async function POST(request: Request) {
  try {
    const requester = await getAuthenticatedRequestContext(request);
    if (!requester) {
      return Response.json({ error: "Требуется вход" }, { status: 401, headers: privateHeaders });
    }
    if (requester.auth.user.mustChangePassword) {
      return Response.json({ error: "Сначала смените временный пароль" }, { status: 403, headers: privateHeaders });
    }
    if (!isCanonicalOwnerContext(requester)) {
      return Response.json(
        { error: "Только собственник может выдавать временный пароль" },
        { status: 403, headers: privateHeaders },
      );
    }

    verifyAuthenticatedRequestCsrf(request, requester);
    const payload = await request.json() as { userId?: unknown };
    const credential = await issueTemporaryCredential(requester, payload.userId);

    // The generated password exists in plaintext only in this one response.
    return Response.json(credential, { status: 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof ProductionAuthAdminError) {
      return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    }
    const isCsrfError = error instanceof Error && error.message.includes("Защитная сессия");
    return Response.json(
      { error: isCsrfError ? error.message : "Не удалось выдать временные данные входа" },
      { status: isCsrfError ? 403 : 500, headers: privateHeaders },
    );
  }
}
