import { ensureDatabaseReady, getDatabase } from "../../../server/database";
import { schoolDeployReadOnlyState } from "../../../lib/maintenance-gate.mjs";

export const runtime = "nodejs";

export async function GET() {
  const maintenance = schoolDeployReadOnlyState().active;
  try {
    await ensureDatabaseReady();
    await getDatabase().prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return Response.json(
      { status: "ok", maintenance },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error", maintenance },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
