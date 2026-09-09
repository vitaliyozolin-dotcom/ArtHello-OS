import { asc, desc } from "drizzle-orm";
import {
  ensureCoreTables,
  getDb,
  getIntegrationSetups,
} from "../../../db";
import {
  integrationConflicts,
  integrationConnections,
  integrationLogEntries,
  integrationSyncRuns,
} from "../../../db/schema";
import { connectionState, credentialState } from "../../../lib/integrations";
import { getRequestUser } from "../../../lib/request-user";

const readers = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS", "FINANCE", "ACCOUNTING"]);

export async function GET(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!readers.has(role)) return Response.json({ error: "Нет доступа к Центру интеграций" }, { status: 403 });

  try {
    await ensureCoreTables();
    const db = getDb();
    const [connections, runs, logs, conflicts, setups] = await Promise.all([
      db.select().from(integrationConnections).orderBy(asc(integrationConnections.category), asc(integrationConnections.system)),
      db.select().from(integrationSyncRuns).orderBy(desc(integrationSyncRuns.startedAt)),
      db.select().from(integrationLogEntries).orderBy(desc(integrationLogEntries.createdAt), desc(integrationLogEntries.id)),
      db.select().from(integrationConflicts).orderBy(desc(integrationConflicts.detectedAt)),
      getIntegrationSetups(),
    ]);
    const enriched = connections.map((item) => ({
      ...item,
      connection: connectionState(item),
      credentialState: credentialState(item.authStatus, item.credentialExpiresAt),
    }));

    return Response.json({
      connections: enriched,
      runs: runs.slice(0, 30),
      logs: logs.slice(0, 60),
      conflicts,
      setups,
      summary: {
        total: connections.length,
        connected: enriched.filter((item) => item.connection.connected).length,
        snapshots: enriched.filter((item) => item.connection.state === "snapshot").length,
        waiting: enriched.filter((item) => item.connection.state === "disconnected" || item.connection.state === "unverified").length,
        openConflicts: conflicts.filter((item) => item.status !== "Закрыт").length,
        errors: connections.reduce((sum, item) => sum + item.errorCount, 0),
        accepted: connections.reduce((sum, item) => sum + item.acceptedCount, 0),
      },
      boundary: "Секреты не хранятся в D1 и не показываются в интерфейсе. Внешние системы без реальной авторизации и проверенной передачи отмечены как неподключённые.",
    });
  } catch (error) {
    console.error("integrations.load_failed", error);
    return Response.json({
      error: error instanceof Error && error.message.includes("D1 binding")
        ? "База интеграций ещё не подключена"
        : "Не удалось загрузить Центр интеграций",
    }, { status: 503 });
  }
}
