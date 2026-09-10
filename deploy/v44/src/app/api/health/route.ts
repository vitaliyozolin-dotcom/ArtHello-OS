import { env } from "cloudflare:workers";
import { ensureCoreTables, getIntegrationTestDataStatus } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await ensureCoreTables();
    const [schema, tables, tasks, testData] = await Promise.all([
      env.DB.prepare("SELECT state_value,updated_at FROM system_runtime_state WHERE state_key='core_schema'").first<{ state_value: string; updated_at: string }>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").first<{ total: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM tasks").first<{ total: number }>(),
      getIntegrationTestDataStatus(),
    ]);

    return Response.json({
      status: "ok",
      database: "available",
      schema: schema?.state_value ?? "unknown",
      schemaUpdatedAt: schema?.updated_at ?? "",
      tables: Number(tables?.total ?? 0),
      tasks: Number(tasks?.total ?? 0),
      integrationTestData: {
        active: testData.active,
        records: testData.total,
        connections: testData.connections,
        runs: testData.runs,
        logs: testData.logs,
        conflicts: testData.conflicts,
      },
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
