import { ensureDatabaseReady, getDatabase } from "../../../server/database";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureDatabaseReady();
    await getDatabase().prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return Response.json(
      { status: "ok" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
