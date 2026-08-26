import { asc, desc } from "drizzle-orm";
import { ensureCoreTables, getDb, getIntegrationSetups } from "../../../db";
import {
  integrationConflicts,
  integrationConnections,
  integrationLogEntries,
  integrationSyncRuns,
} from "../../../db/schema";
import { ensureOperatingIntegrationCatalog } from "../../../lib/operating-integration-catalog";
import { getRequestUser } from "../../../lib/request-user";

const readers = new Set([
  "OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS", "FINANCE", "ACCOUNTING",
  "SALES", "MARKETING", "METHODIST", "SAFETY", "LEGAL", "PROJECTS",
]);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!readers.has(role)) return Response.json({ error: "Нет доступа к центру интеграций" }, { status: 403 });

  try {
    await ensureCoreTables();
    await ensureOperatingIntegrationCatalog();
    const db = getDb();
    const [connectionRows, runs, logs, conflicts, setups] = await Promise.all([
      db.select().from(integrationConnections).orderBy(asc(integrationConnections.category), asc(integrationConnections.system)),
      db.select().from(integrationSyncRuns).orderBy(desc(integrationSyncRuns.startedAt)).limit(100),
      db.select().from(integrationLogEntries).orderBy(desc(integrationLogEntries.createdAt)).limit(300),
      db.select().from(integrationConflicts).orderBy(desc(integrationConflicts.detectedAt)).limit(100),
      getIntegrationSetups(),
    ]);

    const connections = connectionRows.map((row) => {
      const connected = Boolean(row.verifiedTransfer) && Boolean(row.isEnabled) && row.status === "Работает";
      const paused = row.status === "На паузе";
      const failed = row.errorCount > 0 || /ошиб|заблок/i.test(row.status);
      const state = connected ? "good" : failed ? "bad" : paused ? "paused" : "warn";
      const label = connected ? "Подключено" : paused ? "На паузе" : setups[row.id] ? "Параметры сохранены" : "Нужно настроить";
      const credentialState = connected
        ? "good"
        : /истека|просроч/i.test(row.authStatus)
          ? "bad"
          : setups[row.id]
            ? "warn"
            : "empty";
      return {
        ...row,
        verifiedTransfer: Boolean(row.verifiedTransfer),
        isEnabled: Boolean(row.isEnabled),
        connection: { state, label, connected },
        credentialState,
      };
    });

    return Response.json({
      connections,
      runs: runs.map((row) => ({ ...row, dryRun: Boolean(row.dryRun) })),
      logs,
      conflicts,
      setups,
      summary: {
        total: connections.length,
        connected: connections.filter((item) => item.connection.connected).length,
        snapshots: connections.filter((item) => /snapshot|файл|импорт/i.test(`${item.mode} ${item.category}`)).length,
        waiting: connections.filter((item) => !item.connection.connected && item.connection.state !== "bad").length,
        openConflicts: conflicts.filter((item) => item.status !== "Закрыт").length,
        errors: connections.reduce((sum, item) => sum + item.errorCount, 0),
        accepted: connections.reduce((sum, item) => sum + item.acceptedCount, 0),
      },
      boundary: "Каталог показывает доступные способы подключения. Параметры и расписание можно сохранить в системе, но JWT, API-ключи и webhook-секреты передаются только через защищённое хранилище и никогда не отображаются в интерфейсе.",
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить центр интеграций" }, { status: 503 });
  }
}
