import { artHelloPublicOrigin, payPublicOrigin } from "../../../../lib/pay-sso";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const centralOrigin = artHelloPublicOrigin();
    return Response.json({
      centralOrigin,
      payOrigin: payPublicOrigin(),
      authorizeUrl: new URL("/api/pay-sso/authorize", centralOrigin).toString(),
      systemId: "SYS-ARTHELLO-PAY",
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch {
    return Response.json(
      { error: "Вход в ArtHello Pay ещё не настроен" },
      { status: 503, headers: { "cache-control": "private, no-store, max-age=0" } },
    );
  }
}
