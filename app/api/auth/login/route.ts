import {
  assertSameOrigin,
  authenticate,
  createSession,
} from "../../../../server/auth";
import { ensureDatabaseReady } from "../../../../server/database";

export const runtime = "nodejs";

const staffRoles = new Set([
  "director",
  "deputy",
  "admin",
  "teacher",
  "tech_admin",
]);

function legacyPasswordEnabled() {
  const value = (process.env.ENABLE_LEGACY_PASSWORD_LOGIN || "").
    trim().
    toLowerCase();
  return value !== "false" && value !== "0";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabaseReady();

    if (!legacyPasswordEnabled())
      return Response.json(
        {
          error:
            "Вход по постоянному паролю отключён. Используйте одноразовый код.",
        },
        { status: 410, headers: { "cache-control": "no-store" } },
      );

    const body = (await request.json()) as {
      login?: string;
      phone?: string;
      password?: string;
    };
    const user = await authenticate(body.login ?? body.phone, body.password);

    if (staffRoles.has(user.role))
      return Response.json(
        {
          error:
            "Сотрудники входят через ArtHello OS. Второй пароль дневника не используется.",
        },
        { status: 410, headers: { "cache-control": "no-store" } },
      );

    const cookie = await createSession(user, request);
    return Response.json(
      { ok: true, legacy: true },
      { headers: { "set-cookie": cookie, "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось войти";
    return Response.json(
      { error: message },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
}
