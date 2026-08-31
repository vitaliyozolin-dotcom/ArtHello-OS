import { assertSameOrigin } from "../../../../../server/auth";
import { requestPasswordlessLogin } from "../../../../../server/identity-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as {
      identifier?: string;
      returnTo?: string;
    };
    const result = await requestPasswordlessLogin(
      body.identifier,
      request,
      body.returnTo,
    );
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось отправить код";
    const status = message.includes("Слишком много")
      ? 429
      : message.includes("канал") || message.includes("Канал")
        ? 503
        : 400;
    return Response.json(
      { error: message },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
