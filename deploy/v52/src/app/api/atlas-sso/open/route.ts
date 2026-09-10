import { atlasPublicOrigin } from "../../../../lib/atlas-sso";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return new Response(null, { status: 303, headers: { location: new URL("/auth/central/start", atlasPublicOrigin()).toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } }); }
  catch { return Response.json({ error: "Дневник Атласа ещё не подключён" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
