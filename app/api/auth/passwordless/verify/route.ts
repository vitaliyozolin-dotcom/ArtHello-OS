import { assertSameOrigin } from "../../../../../server/auth";
import { verifyPasswordlessCode } from "../../../../../server/identity-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as {
      identifier?: string;
      challengeId?: string;
      code?: string;
    };
    const completed = await verifyPasswordlessCode(
      body.identifier,
      body.challengeId,
      body.code,
      request,
    );
    return Response.json(
      { ok: true, returnTo: completed.returnTo },
      {
        headers: {
          "set-cookie": completed.cookie,
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось войти";
    return Response.json(
      { error: message },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
}
