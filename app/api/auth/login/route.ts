import {
  assertSameOrigin,
  authenticate,
  createSession,
} from "../../../../server/auth";
import { ensureDatabaseReady } from "../../../../server/database";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabaseReady();
    const body = (await request.json()) as {
      login?: string;
      phone?: string;
      password?: string;
    };
    const user = await authenticate(body.login ?? body.phone, body.password);
    const cookie = await createSession(user, request);
    return Response.json(
      { ok: true },
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
