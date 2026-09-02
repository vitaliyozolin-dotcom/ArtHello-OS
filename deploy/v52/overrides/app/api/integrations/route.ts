import { asc, desc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb, getIntegrationSetups } from "../../../db";
import {
  integrationConflicts,
  integrationConnections,
  integrationLogEntries,
  integrationSyncRuns,
  entities,
  organizationBranches,
} from "../../../db/schema";
import { ensureOperatingIntegrationCatalog } from "../../../lib/operating-integration-catalog";
import { getAuthenticatedRequestContext, isCanonicalOwnerContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";

const readers = new Set([
  "OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS", "FINANCE", "ACCOUNTING",
  "SALES", "MARKETING", "METHODIST", "SAFETY", "LEGAL", "PROJECTS",
]);
const managers = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS"]);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const requester = await getAuthenticatedRequestContext(request);
    if (!requester) return privateJson({ error: "Требуется вход" }, 401);
    if (!readers.has(requester.apiRole)) return privateJson({ error: "Нет доступа к центру интеграций" }, 403);
    await ensureCoreTables();
    await ensureOperatingIntegrationCatalog();
    const requesterRole = requester.apiRole;
    const canManageCredentials = isCanonicalOwnerContext(requester);
    const db = getDb();
    const [connectionRows, runs, logs, conflicts, setups, legalEntityRows, branchRows, allTasks] = await Promise.all([
      db.select().from(integrationConnections).orderBy(asc(integrationConnections.category), asc(integrationConnections.system)),
      db.select().from(integrationSyncRuns).orderBy(desc(integrationSyncRuns.startedAt)).limit(100),
      db.select().from(integrationLogEntries).orderBy(desc(integrationLogEntries.createdAt)).limit(300),
      db.select().from(integrationConflicts).orderBy(desc(integrationConflicts.detectedAt)).limit(100),
      getIntegrationSetups(),
      db.select({ id: entities.id, name: entities.displayName }).from(entities)
        .where(eq(entities.entityType, "Юрлицо")).orderBy(asc(entities.displayName)),
      db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches)
        .where(eq(organizationBranches.status, "Активен")).orderBy(asc(organizationBranches.sortOrder), asc(organizationBranches.name)),
      selectVisibleTasks(db, requester),
    ]);

    const connections = connectionRows.map((row) => {
      const connected = Boolean(row.verifiedTransfer) && Boolean(row.isEnabled) && row.status === "Работает";
      const paused = row.status === "На паузе";
      const accountAccessVerified = row.status === "Доступ к счетам подтверждён";
      const failed = row.errorCount > 0 || /ошиб|заблок/i.test(row.status);
      const state = connected ? "good" : failed ? "bad" : paused ? "paused" : "warn";
      const label = connected
        ? "Подключено"
        : paused
          ? "На паузе"
          : accountAccessVerified
            ? "JWT, customerCode и доступ к счетам подтверждены"
            : setups[row.id]
              ? "Параметры сохранены"
              : "Нужно настроить";
      const credentialState = connected || accountAccessVerified
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

    return privateJson({
      connections,
      runs: runs.map((row) => ({ ...row, dryRun: Boolean(row.dryRun) })),
      logs,
      conflicts: redactHiddenTaskReferences(conflicts, allTasks),
      setups,
      legalEntities: legalEntityRows,
      branches: branchRows,
      capabilities: {
        canManageSetup: managers.has(requesterRole),
        canRun: managers.has(requesterRole),
        canChangeState: managers.has(requesterRole),
        canResolve: managers.has(requesterRole),
        canManageCredentials,
        canManageTochka: canManageCredentials,
      },
      summary: {
        total: connections.length,
        connected: connections.filter((item) => item.connection.connected).length,
        snapshots: connections.filter((item) => /snapshot|файл|импорт/i.test(`${item.mode} ${item.category}`)).length,
        waiting: connections.filter((item) => !item.connection.connected && item.connection.state !== "bad").length,
        openConflicts: conflicts.filter((item) => item.status !== "Закрыт").length,
        errors: connections.reduce((sum, item) => sum + item.errorCount, 0),
        accepted: connections.reduce((sum, item) => sum + item.acceptedCount, 0),
      },
      boundary: "Параметры и расписание можно сохранить для источников с реализованной синхронизацией. Для Точки владелец вводит JWT прямо в защищённой форме; только собственник может настроить или отозвать ключ и запустить проверку счетов. Система сначала подтверждает customerCode через банк и проверяет доступ к счетам, затем шифрует ключ и больше не возвращает его в интерфейс или API. Связь подтверждённого customerCode с выбранной внутренней карточкой юрлица фиксирует и аудирует собственник. Импорт выписок и распределение операций Точки пока не запускаются.",
    });
  } catch {
    return privateJson({ error: "Не удалось загрузить центр интеграций" }, 503);
  }
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      expires: "0",
    },
  });
}
