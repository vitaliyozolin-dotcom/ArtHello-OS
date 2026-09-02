import { env } from "cloudflare:workers";
import { ensureCoreTables } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await ensureCoreTables();
    const probe = await env.DB.prepare("SELECT 1 AS ready").first<{ ready: number }>();
    if (probe?.ready !== 1) throw new Error("Database readiness probe failed");

    return Response.json({
      status: "ok",
      database: "available",
      durationMs: Date.now() - startedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("health.failed", error);
    return Response.json({
      status: "error",
      database: "unavailable",
      message: "Системная база не прошла проверку готовности",
      durationMs: Date.now() - startedAt,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
