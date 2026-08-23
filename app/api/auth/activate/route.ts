import {
  activateCredential,
  assertSameOrigin,
  createSession,
} from "../../../../server/auth";
import { ensureDatabaseReady } from "../../../../server/database";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabaseReady();
    const body = (await request.json()) as {
      token?: string;
      password?: string;
    };
    const user = await activateCredential(body.token, body.password);
    const cookie = await createSession(user, request);
    return Response.json(
      { ok: true },
      { headers: { "set-cookie": cookie, "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось активировать доступ";
    return Response.json(
      { error: message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
