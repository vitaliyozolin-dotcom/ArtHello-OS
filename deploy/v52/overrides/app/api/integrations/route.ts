import { env } from "cloudflare:workers";
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
import { canAccessAssignedIntegration, normalizePublicIntegrationIp } from "../../../lib/integrations";
import { getAuthenticatedRequestContext, isCanonicalOwnerContext } from "../../../lib/production-auth";
import { canAccessModule } from "../../../lib/access-policy";
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
    if (!canAccessModule({
      apiRole: requester.apiRole,
      isSystemOwner: requester.auth.user.isSystemOwner,
      canAccessMedical: requester.auth.user.canAccessMedical,
      allowedModules: requester.auth.user.allowedModules,
    }, "integrations")) return privateJson({ error: "Раздел интеграций не назначен этому пользователю" }, 403);
    if (!readers.has(requester.apiRole)) return privateJson({ error: "Нет доступа к центру интеграций" }, 403);
    await ensureCoreTables();
    const requesterRole = requester.apiRole;
    const canManageCredentials = isCanonicalOwnerContext(requester);
    const configuredBankEgressIp = normalizePublicIntegrationIp(
      (env as unknown as { TBANK_EGRESS_IP?: string }).TBANK_EGRESS_IP,
    );
    const db = getDb();
    const [connectionRows, allRuns, allLogs, allConflicts, setups, legalEntityRows, branchRows, allTasks] = await Promise.all([
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

    const scopeContext = {
      apiRole: requester.apiRole,
      appUserId: requester.appUserId,
      isSystemOwner: requester.auth.user.isSystemOwner,
    };
    const scopedConnectionRows = connectionRows.filter((row) => (
      canAccessAssignedIntegration(scopeContext, row.ownerEntityId)
    ));
    const scopedConnectionIds = new Set(scopedConnectionRows.map((row) => row.id));
    const runs = allRuns.filter((row) => scopedConnectionIds.has(row.connectionId));
    const logs = allLogs.filter((row) => scopedConnectionIds.has(row.connectionId));
    const conflicts = allConflicts.filter((row) => scopedConnectionIds.has(row.connectionId));

    const connections = scopedConnectionRows.map((row) => {
      const connected = Boolean(row.verifiedTransfer) && Boolean(row.isEnabled) && row.status === "Работает";
      const paused = row.status === "На паузе";
      const accountAccessVerified = row.status === "Доступ к счетам подтверждён"
        || row.status === "Проверка чтения выполнена";
      const failed = row.errorCount > 0 || /ошиб|заблок/i.test(row.status);
      const state = connected ? "good" : failed ? "bad" : paused ? "paused" : "warn";
      const label = connected
        ? "Подключено"
        : paused
          ? "На паузе"
          : accountAccessVerified
            ? row.id === "INT-T-TBANK"
              ? "ArtHello OS успешно прочитал счета и короткую выписку"
              : "Ключ Точки и доступ к счетам подтверждены"
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
    const publicSetups = Object.fromEntries(Object.entries(setups)
      .filter(([connectionId]) => scopedConnectionIds.has(connectionId))
      .map(([connectionId, setup]) => [
      connectionId,
      {
        connectionId,
        authMethod: setup.authMethod,
        startDate: setup.startDate,
        syncIntervalMinutes: setup.syncIntervalMinutes,
        syncMinute: setup.syncMinute,
        endpoint: managers.has(requesterRole) ? setup.endpoint : "",
        legalEntityId: setup.legalEntityId,
        branchId: setup.branchId,
        allocationMode: setup.allocationMode,
        accountScope: setup.accountScope,
        channelType: setup.channelType,
        sourceMapping: setup.sourceMapping,
        dataScopes: setup.dataScopes,
        readOnlyScopeConfirmed: setup.readOnlyScopeConfirmed,
        secretStatus: setup.secretStatus,
        companySelectionConfirmed: Boolean(setup.customerCode),
        updatedAt: setup.updatedAt,
      },
      ]));
    const hasVisibleBank = scopedConnectionIds.has("INT-T-TOCHKA") || scopedConnectionIds.has("INT-T-TBANK");

    return privateJson({
      connections,
      runs: runs.map((row) => ({ ...row, dryRun: Boolean(row.dryRun) })),
      logs,
      conflicts: redactHiddenTaskReferences(conflicts, allTasks),
      setups: publicSetups,
      legalEntities: hasVisibleBank ? legalEntityRows : [],
      branches: branchRows,
      capabilities: {
        canManageSetup: managers.has(requesterRole),
        canRun: managers.has(requesterRole),
        canChangeState: managers.has(requesterRole),
        canResolve: managers.has(requesterRole),
        canManageCredentials,
        canManageTochka: canManageCredentials && scopedConnectionIds.has("INT-T-TOCHKA"),
        canManageTBank: canManageCredentials && scopedConnectionIds.has("INT-T-TBANK"),
      },
      infrastructure: {
        bankEgressIp: scopedConnectionIds.has("INT-T-TBANK") ? configuredBankEgressIp : "",
        bankEgressIpConfirmed: scopedConnectionIds.has("INT-T-TBANK") && Boolean(configuredBankEgressIp),
      },
      scopeMessage: connections.length ? "" : "Интеграции не назначены этому пользователю",
      summary: {
        total: connections.length,
        connected: connections.filter((item) => item.connection.connected).length,
        snapshots: connections.filter((item) => /snapshot|файл|импорт/i.test(`${item.mode} ${item.category}`)).length,
        waiting: connections.filter((item) => !item.connection.connected && item.connection.state !== "bad").length,
        openConflicts: conflicts.filter((item) => item.status !== "Закрыт").length,
        errors: connections.reduce((sum, item) => sum + item.errorCount, 0),
        accepted: connections.reduce((sum, item) => sum + item.acceptedCount, 0),
      },
      boundary: "Банковские ключи вводит только собственник: они проверяются запросами только на чтение, надёжно шифруются и больше не возвращаются в интерфейс или ответы системы. Для Точки доступен безопасный выбор компании, для Т‑Банка — проверка счетов и короткой выписки. Служебный код выбранной компании Точки хранится только на сервере для привязки ключа и не возвращается пользователям; номера счетов и операции не сохраняются. Импорт проводок и создание платежей не запускаются.",
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
