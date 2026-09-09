import { arthelloOrigin } from "../../../../server/central-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Navigation only: no session mutation, no destination from query or referrer.
export async function GET() {
  try {
    return new Response(null, {
      status: 303,
      headers: {
        location: new URL("/", arthelloOrigin()).toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  } catch {
    return new Response("Не удалось открыть ArtHello OS. Адрес системы настроен некорректно.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
