import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  consumeTochkaCompanySelectionHandle,
  commitTochkaReadOnlySync,
  commitIntegrationBankProbe,
  createTochkaCompanySelectionHandles,
  ensureCoreTables,
  getDb,
  getIntegrationSetups,
  readIntegrationCredential,
  readTBankIntegrationCredential,
  revokeBankIntegrationCredential,
  saveIntegrationSetup,
  saveTBankSetupWithCredential,
  saveTochkaSetupWithCredential,
  validateIntegrationSetupReferences,
} from "../../../db";
import type { IntegrationSetup } from "../../../db";
import { ensureOperatingIntegrationCatalog } from "../../../lib/operating-integration-catalog";
import {
  auditEvents,
  entities,
  integrationConflicts,
  integrationConnections,
  integrationLogEntries,
  integrationSyncRuns,
  tasks,
} from "../../../db/schema";
import {
  canAccessAssignedIntegration,
  canResolveConflict,
  normalizePublicIntegrationIp,
  probeTBankToken,
  probeTochkaJwt,
  retryDecision,
  syncTochkaReadOnly,
  validateTBankToken,
  validateTochkaJwt,
} from "../../../lib/integrations";
import type { TBankProbeResult, TochkaReadOnlySyncResult } from "../../../lib/integrations";
import {
  getAuthenticatedRequestContext,
  isCanonicalOwnerContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../lib/production-auth";
import { canAccessModule } from "../../../lib/access-policy";
import { hasTrustedMutationOrigin } from "../../../lib/request-security";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";
import { resolveTaskAssignment } from "../../../lib/task-access";

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS"]);
const tochkaConnectionId = "INT-T-TOCHKA";
const tbankConnectionId = "INT-T-TBANK";
const protectedBankConnectionIds = new Set([tochkaConnectionId, tbankConnectionId]);
const protectedBankOwnerActions = new Set([
  "saveSetup",
  "testConnection",
  "retrySync",
  "pauseConnection",
  "resumeConnection",
  "revokeCredential",
]);
const tbankEgressRequiredActions = new Set(["saveSetup", "testConnection", "retrySync"]);
const connectionScopedActions = new Set([
  "saveSetup",
  "testConnection",
  "retrySync",
  "pauseConnection",
  "resumeConnection",
  "revokeCredential",
]);
type RequestContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedRequestContext>>>;
type RuntimeFetcher = {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
};

async function tochkaTransportFetch(input: Request | string | URL, init?: RequestInit) {
  const transport = (env as unknown as { TOCHKA_TRANSPORT?: RuntimeFetcher }).TOCHKA_TRANSPORT;
  if (!transport) throw new Error("TOCHKA_TRANSPORT binding is unavailable");
  return transport.fetch(input, init);
}

export async function POST(request: Request) {
  const publicOrigin = (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN?.trim() ?? "";
  if (!hasTrustedMutationOrigin(request, publicOrigin)) {
    return privateJson({ error: "Запрос отклонён: источник страницы не совпадает" }, 403);
  }
  let context: RequestContext | null;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return privateJson({ error: "Сервис авторизации временно недоступен" }, 503);
  }
  if (!context) return privateJson({ error: "Требуется вход" }, 401);
  if (!canAccessModule({
    apiRole: context.apiRole,
    isSystemOwner: context.auth.user.isSystemOwner,
    canAccessMedical: context.auth.user.canAccessMedical,
    allowedModules: context.auth.user.allowedModules,
  }, "integrations")) return privateJson({ error: "Раздел интеграций не назначен этому пользователю" }, 403);
  if (!editors.has(context.apiRole)) return privateJson({ error: "Нет прав на управление интеграциями" }, 403);
  try {
    verifyAuthenticatedRequestCsrf(request, context);
  } catch {
    return privateJson({ error: "Защитная сессия устарела. Войдите заново." }, 403);
  }
  let actor = context.actor;
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    const connectionId = action === "saveSetup" && body.setup && typeof body.setup === "object"
      ? clean((body.setup as Partial<IntegrationSetup>).connectionId, 80).toUpperCase()
      : clean(body.connectionId, 80).toUpperCase();
    if (protectedBankConnectionIds.has(connectionId) && protectedBankOwnerActions.has(action)) {
      const authorization = authorizeBankOwnerMutation(context, connectionId);
      if (authorization instanceof Response) return authorization;
      actor = authorization.actor;
    }
    if (connectionId === tbankConnectionId && tbankEgressRequiredActions.has(action)) {
      const configuredEgressIp = normalizePublicIntegrationIp(
        (env as unknown as { TBANK_EGRESS_IP?: string }).TBANK_EGRESS_IP,
      );
      if (!configuredEgressIp) {
        return privateJson({
          error: "Исходящий IP не подтверждён администратором сервера. Настройка и проверка Т‑Банка заблокированы.",
        }, 409);
      }
    }
    await ensureCoreTables();
    await ensureOperatingIntegrationCatalog();
    if (connectionScopedActions.has(action)) {
      const scopeDenial = await assignedIntegrationDenial(context, connectionId);
      if (scopeDenial) return scopeDenial;
    }
    if (action === "saveSetup") {
      return saveSetup(actor, body);
    }
    if (action === "testConnection") return testConnection(actor, body);
    if (action === "retrySync") return retrySync(actor, body);
    if (action === "pauseConnection") return pauseConnection(actor, body);
    if (action === "resumeConnection") return resumeConnection(actor, body);
    if (action === "revokeCredential") return revokeCredential(actor, body);
    if (action === "createConflictTask") return conflictTask(context, body);
    if (action === "resolveConflict") return resolveConflict(context, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("integration.action_failed");
    return privateJson({ error: safeIntegrationError(error) }, 500);
  }
}

function authorizeBankOwnerMutation(requester: RequestContext, connectionId: string): { actor: string } | Response {
  if (!isCanonicalOwnerContext(requester)) {
    return privateJson({
      error: connectionId === tochkaConnectionId
        ? "Настройка и проверка Точки доступны только собственнику"
        : "Настройка и проверка Т‑Банка доступны только собственнику",
    }, 403);
  }
  return { actor: requester.actor };
}

async function assignedIntegrationDenial(requester: RequestContext, connectionId: string) {
  if (!connectionId) return privateJson({ error: "Не выбрана интеграция" }, 400);
  if (isCanonicalOwnerContext(requester)) return null;
  const db = getDb();
  const [connection] = await db.select({ ownerEntityId: integrationConnections.ownerEntityId })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId))
    .limit(1);
  if (!connection) return privateJson({ error: "Интеграция не найдена" }, 404);
  const assigned = canAccessAssignedIntegration({
    apiRole: requester.apiRole,
    appUserId: requester.appUserId,
    isSystemOwner: requester.auth.user.isSystemOwner,
  }, connection.ownerEntityId);
  return assigned ? null : privateJson({ error: "Эта интеграция не назначена пользователю" }, 403);
}

async function saveSetup(actor: string, body: Record<string, unknown>) {
  const setupInput = body.setup && typeof body.setup === "object"
    ? body.setup as Partial<IntegrationSetup>
    : {};
  const connectionId = clean(setupInput.connectionId, 80).toUpperCase();
  const credential = typeof body.credential === "string" ? body.credential.trim() : "";
  if (connectionId === tochkaConnectionId) setupInput.customerCode = "";
  if (connectionId === tochkaConnectionId && setupInput.authMethod !== "JWT") {
    return privateJson({ error: "Для Точки в этом релизе доступно только подключение готового ключа" }, 400);
  }
  if (connectionId === tbankConnectionId && setupInput.authMethod !== "Bearer token") {
    return privateJson({ error: "Для Т‑Банка доступно прямое подключение с токеном из раздела интеграций Т‑Бизнеса" }, 400);
  }
  if (connectionId === tbankConnectionId && setupInput.readOnlyScopeConfirmed !== true) {
    return privateJson({
      error: "Подтвердите, что токен Т‑Банка выпущен только с правами чтения счетов и операций без доступа к платежам.",
    }, 400);
  }
  if (protectedBankConnectionIds.has(connectionId)) await validateIntegrationSetupReferences(setupInput);
  const credentialBaseline = credential && protectedBankConnectionIds.has(connectionId)
    ? (await getIntegrationSetups())[connectionId] ?? null
    : null;

  if (credential) {
    if (connectionId === tochkaConnectionId) {
      const validation = validateTochkaJwt(credential);
      if (!validation.valid) return privateJson({ error: validation.reason }, 400);
      const choiceId = clean(body.customerChoiceId, 80);
      const selectedCompany = choiceId
        ? await consumeTochkaCompanySelectionHandle(actor, choiceId, clean(setupInput.legalEntityId, 80), credential)
        : null;
      if (selectedCompany && !selectedCompany.ok) {
        return privateJson({ error: selectedCompany.reason }, 409);
      }
      const candidateProbe = await probeTochkaJwt(
        credential,
        tochkaTransportFetch,
        Date.now(),
        selectedCompany?.customerCode ?? "",
      );
      if (!candidateProbe.valid) {
        const customerChoices = candidateProbe.customerChoices.length
          ? await createTochkaCompanySelectionHandles(
            actor,
            clean(setupInput.legalEntityId, 80),
            credential,
            candidateProbe.customerChoices,
          )
          : [];
        await audit(actor, "integration.tochka_candidate_rejected", "integration_connection", connectionId, {
          selectedLegalEntityId: clean(setupInput.legalEntityId, 80),
          availableCompanyCount: customerChoices.length,
          reason: candidateProbe.reason,
        });
        return privateJson({
          error: candidateProbe.reason,
          customerChoices,
        }, customerChoices.length ? 409 : 422);
      }
      setupInput.customerCode = candidateProbe.customerCode;
      const setup = await saveTochkaSetupWithCredential(actor, setupInput, credential, credentialBaseline);
      if (!setup) {
        return privateJson({ error: "Настройка банка изменилась во время проверки. Начните сохранение заново." }, 409);
      }
      return recordTochkaSync(actor, setup, "Первичная загрузка владельцем", await syncTochkaReadOnly({
        token: credential,
        customerCode: setup.customerCode,
        startDate: setup.startDate || "2026-01-01",
        request: tochkaTransportFetch,
      }));
    }
    if (connectionId === tbankConnectionId) {
      const validation = validateTBankToken(credential);
      if (!validation.valid) return privateJson({ error: validation.reason }, 400);
      const candidateProbe = await probeTBankToken(credential);
      if (!candidateProbe.valid) {
        await audit(actor, "integration.tbank_candidate_rejected", "integration_connection", connectionId, {
          selectedLegalEntityId: clean(setupInput.legalEntityId, 80),
          reason: candidateProbe.reason,
        });
        return privateJson({ error: candidateProbe.reason }, 422);
      }
      const setup = await saveTBankSetupWithCredential(actor, setupInput, credential, credentialBaseline);
      if (!setup) {
        return privateJson({ error: "Настройка банка изменилась во время проверки. Начните сохранение заново." }, 409);
      }
      return recordTBankProbe(actor, setup, "Настройка владельцем", candidateProbe);
    }
    return privateJson({ error: "Ключ через эту форму принимается только для Точки и Т‑Банка" }, 400);
  }

  const existing = (await getIntegrationSetups())[connectionId];
  if (protectedBankConnectionIds.has(connectionId) && existing?.secretStatus === "stored") {
    const nextLegalEntityId = clean(setupInput.legalEntityId, 80);
    if (existing.legalEntityId !== nextLegalEntityId) {
      return privateJson({
        error: "Для смены юрлица введите банковский ключ: новая привязка сначала проверяется банком, затем заменяет прежнюю атомарно.",
      }, 409);
    }
    if (connectionId === tochkaConnectionId) setupInput.customerCode = existing.customerCode;
  }
  const setup = await saveIntegrationSetup(actor, setupInput);

  if (setup.connectionId === tochkaConnectionId && setup.authMethod === "JWT") {
    return privateJson({
      setup: publicSetup(setup),
      message: setup.secretStatus === "stored"
        ? "Черновик распределения сохранён. Ключ не использовался; отдельную проверку счетов запускает собственник."
        : "Черновик сохранён. Введите ключ Точки: система определит доступные компании и попросит выбрать, если их несколько.",
    });
  }
  if (setup.connectionId === tbankConnectionId) {
    return privateJson({
      setup: publicSetup(setup),
      message: setup.secretStatus === "stored"
        ? "Параметры сохранены. Отдельную проверку доступа только для чтения запускает собственник."
        : "Параметры сохранены. Введите токен Т‑Банка для проверки счетов и короткой выписки.",
    });
  }

  return privateJson({ setup: publicSetup(setup), message: "Параметры и расписание сохранены." });
}

async function revokeCredential(actor: string, body: Record<string, unknown>) {
  const connectionId = clean(body.connectionId, 80).toUpperCase();
  if (!protectedBankConnectionIds.has(connectionId)) {
    return privateJson({ error: "Удаление сохранённого ключа доступно только для подключённых банков" }, 400);
  }
  const setup = await revokeBankIntegrationCredential(actor, connectionId);
  return privateJson({
    setup: setup ? publicSetup(setup) : null,
    message: `${connectionId === tochkaConnectionId ? "Ключ Точки" : "Токен Т‑Банка"} удалён только из ArtHello OS. Чтобы ключ перестал действовать, отдельно отзовите его ${connectionId === tochkaConnectionId ? "в личном кабинете Точки" : "в Т‑Бизнесе"}.`,
  });
}

async function testConnection(actor: string, body: Record<string, unknown>) {
  const connectionId = clean(body.connectionId, 80).toUpperCase();
  if (!protectedBankConnectionIds.has(connectionId)) return retrySync(actor, body);
  const setups = await getIntegrationSetups();
  const setup = setups[connectionId];
  if (!setup) return privateJson({ error: "Сначала сохраните параметры подключения" }, 409);
  return connectionId === tochkaConnectionId
    ? verifyTochkaConnection(actor, setup, "Ручная проверка")
    : verifyTBankConnection(actor, setup, "Ручная read-only проверка");
}

async function verifyTochkaConnection(actor: string, setup: IntegrationSetup, trigger: string) {
  if (!setup.customerCode) return privateJson({ error: "Сначала подтвердите компанию с помощью ключа Точки" }, 409);
  const token = await readIntegrationCredential(setup.connectionId, setup.legalEntityId, setup.customerCode);
  if (!token) return privateJson({ error: "Введите ключ Точки для выбранной карточки и компании" }, 409);
  return recordTochkaSync(actor, setup, trigger, await syncTochkaReadOnly({
    token,
    customerCode: setup.customerCode,
    startDate: setup.startDate || "2026-01-01",
    request: tochkaTransportFetch,
  }));
}

async function recordTochkaSync(actor: string, setup: IntegrationSetup, trigger: string, sync: TochkaReadOnlySyncResult) {
  const commit = await commitTochkaReadOnlySync(actor, setup, sync, trigger);
  if (!commit.committed) {
    return privateJson({ error: "Банковский ключ или настройка изменились во время проверки. Запустите проверку заново." }, 409);
  }
  if (!sync.valid) return privateJson({ error: sync.reason }, 422);
  return privateJson({
    setup: publicSetup({ ...setup, secretStatus: "stored" }),
    test: {
      ok: true,
      companySelectionConfirmed: true,
      accountCount: sync.accounts.length,
      statementCount: sync.statements.length,
      transactionCount: sync.transactions.length,
      financialOperationCount: commit.financialOperationCount,
      expiresAt: sync.expiresAt,
      complete: sync.complete,
    },
    message: sync.complete
      ? `Точка подключена: загружено счетов — ${sync.accounts.length}, выписок — ${sync.statements.length}, операций — ${sync.transactions.length}. ${commit.financialOperationCount} проведённых рублёвых операций добавлено в финансовый реестр.`
      : `Ключ и счета подтверждены. Точка ещё формирует часть выписок; повторите синхронизацию через несколько минут.`,
  });
}

async function verifyTBankConnection(actor: string, setup: IntegrationSetup, trigger: string) {
  if (!setup.readOnlyScopeConfirmed) {
    return privateJson({
      error: "Сначала подтвердите, что токен выдан только для чтения счетов и операций без доступа к платежам.",
    }, 409);
  }
  const token = await readTBankIntegrationCredential(setup.legalEntityId);
  if (!token) return privateJson({ error: "Введите токен Т‑Банка для выбранной карточки юрлица" }, 409);
  return recordTBankProbe(actor, setup, trigger, await probeTBankToken(token));
}

async function recordTBankProbe(actor: string, setup: IntegrationSetup, trigger: string, probe: TBankProbeResult) {
  const current = new Date().toISOString();
  const runId = `INT-RUN-${crypto.randomUUID().toUpperCase()}`;
  const correlationId = `CORR-${crypto.randomUUID()}`;
  const committed = await commitIntegrationBankProbe(actor, setup, {
    valid: probe.valid,
    runId,
    correlationId,
    occurredAt: current,
    trigger,
    reason: probe.reason,
    receivedCount: probe.accountCount + probe.operationCount,
    checkpoint: `read-only:${probe.accountCount}:${probe.operationCount}`,
    logEvent: probe.valid ? "tbank.readonly_access_verified" : "tbank.readonly_probe_rejected",
    logMessage: `Прочитано счетов: ${probe.accountCount}; операций в короткой выписке: ${probe.operationCount}`,
    logRecordRef: probe.valid ? "accounts-and-short-statement" : "read-only-check",
    successStatus: "Проверка чтения выполнена",
    successAuthStatus: "Токен принят · ArtHello OS успешно прочитал счета и короткую выписку",
    failureAuthStatus: "Токен Т‑Банка сохранён · проверка чтения не пройдена",
    credentialExpiresAt: "",
    auditAction: probe.valid ? "integration.tbank_read_probe_succeeded" : "integration.tbank_read_probe_failed",
    auditPayload: probe.valid ? {
      selectedLegalEntityId: setup.legalEntityId,
      accountCount: probe.accountCount,
      operationCount: probe.operationCount,
      statementWindowDays: probe.statementWindowDays,
      limitedPermissionsConfirmedByOwner: setup.readOnlyScopeConfirmed,
    } : {
      selectedLegalEntityId: setup.legalEntityId,
      reason: probe.reason,
    },
  });
  if (!committed) {
    return privateJson({ error: "Банковский ключ или настройка изменились во время проверки. Запустите проверку заново." }, 409);
  }
  if (!probe.valid) return privateJson({ error: probe.reason }, 422);
  return privateJson({
    setup: publicSetup({ ...setup, secretStatus: "stored" }),
    test: {
      ok: true,
      accountCount: probe.accountCount,
      operationCount: probe.operationCount,
      statementWindowDays: probe.statementWindowDays,
    },
    message: `ArtHello OS выполнил только чтение данных Т‑Банка: ${probe.accountCount} счетов и ${probe.operationCount} операций в короткой выписке за ${probe.statementWindowDays} дней. Это не доказывает отсутствие у токена иных прав; их ограничение подтвердил собственник. Номера счетов и операции не сохранены, платежные методы не вызывались.`,
  });
}

async function retrySync(actor: string, body: Record<string, unknown>) {
  const id = clean(body.connectionId, 80);
  if (id === "INT-T-TOCHKA") {
    const setup = (await getIntegrationSetups())[id];
    if (!setup) return privateJson({ error: "Сначала сохраните параметры подключения" }, 409);
    return verifyTochkaConnection(actor, setup, "Ручная загрузка выписок и операций");
  }
  if (id === tbankConnectionId) {
    const setup = (await getIntegrationSetups())[id];
    if (!setup) return privateJson({ error: "Сначала сохраните параметры подключения" }, 409);
    return verifyTBankConnection(actor, setup, "Ручная проверка счетов и короткой выписки");
  }
  const db = getDb();
  const [connection] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, id)).limit(1);
  if (!connection) return Response.json({ error: "Интеграция не найдена" }, { status: 404 });
  const current = new Date().toISOString();
  const runId = `INT-RUN-${crypto.randomUUID().toUpperCase()}`;
  const correlationId = `CORR-${crypto.randomUUID()}`;
  const decision = retryDecision(connection);
  const coreConnection = isCoreConnection(connection);
  if (!decision.allowed || !coreConnection) {
    const reason = coreConnection
      ? decision.reason
      : connection.authStatus.includes("секрет требуется")
        ? "Расписание сохранено, но секрет не передан. Добавьте его в защищённое хранилище и переподключите интеграцию."
        : connection.mode.includes("snapshot")
          ? "Исходный файл недоступен в runtime; нужен новый контролируемый импорт"
          : decision.reason;
    await db.insert(integrationSyncRuns).values({
      id: runId,
      connectionId: id,
      startedAt: current,
      finishedAt: current,
      trigger: "Ручной повтор",
      status: "Заблокировано",
      errorCount: 1,
      errorMessage: reason,
      initiatedBy: actor,
      correlationId,
      dryRun: true,
    });
    await db.insert(integrationLogEntries).values({ runId, connectionId: id, level: "ERROR", event: "retry.blocked", message: reason, recordRef: "preflight" });
    await db.update(integrationConnections).set({ errorCount: connection.errorCount + 1, updatedAt: current }).where(eq(integrationConnections.id, id));
    await audit(actor, "integration.retry_blocked", "integration_connection", id, { runId, reason });
    return Response.json({ runId, blocked: true, message: reason });
  }
  const allEntities = await db.select({ id: entities.id }).from(entities);
  const count = allEntities.length;
  await db.insert(integrationSyncRuns).values({
    id: runId,
    connectionId: id,
    startedAt: current,
    finishedAt: current,
    trigger: "Ручная проверка",
    status: "Успешно",
    receivedCount: count,
    acceptedCount: count,
    checkpoint: `entities:${count}`,
    initiatedBy: actor,
    correlationId,
  });
  await db.insert(integrationLogEntries).values({ runId, connectionId: id, level: "INFO", event: "health.verified", message: `D1 отвечает; доступно карточек: ${count}`, recordRef: "entities" });
  await db.update(integrationConnections).set({
    lastSuccessAt: current,
    nextSyncAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    receivedCount: count,
    acceptedCount: count,
    rejectedCount: 0,
    errorCount: 0,
    conflictCount: 0,
    status: "Работает",
    verifiedTransfer: true,
    isEnabled: true,
    updatedAt: current,
  }).where(eq(integrationConnections.id, id));
  await audit(actor, "integration.sync_succeeded", "integration_connection", id, { runId, count });
  return Response.json({ runId, count });
}

async function pauseConnection(actor: string, body: Record<string, unknown>) {
  const id = clean(body.connectionId, 80);
  const db = getDb();
  const [connection] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, id)).limit(1);
  if (!connection) return Response.json({ error: "Интеграция не найдена" }, { status: 404 });
  if (isCoreConnection(connection)) return Response.json({ error: "Встроенное хранилище нельзя остановить из интерфейса" }, { status: 409 });
  const [row] = await db.update(integrationConnections).set({ status: "На паузе", isEnabled: false, updatedAt: new Date().toISOString() }).where(eq(integrationConnections.id, id)).returning();
  await audit(actor, "integration.paused", "integration_connection", id, {});
  return Response.json({ connection: row });
}

async function resumeConnection(actor: string, body: Record<string, unknown>) {
  const id = clean(body.connectionId, 80);
  const db = getDb();
  const [row] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, id)).limit(1);
  if (!row) return Response.json({ error: "Интеграция не найдена" }, { status: 404 });
  const ready = row.verifiedTransfer && row.authStatus.includes("активна");
  const [updated] = await db.update(integrationConnections).set({ status: ready ? "Работает" : "Ожидает доступ", isEnabled: ready, updatedAt: new Date().toISOString() }).where(eq(integrationConnections.id, id)).returning();
  await audit(actor, "integration.resumed", "integration_connection", id, { ready });
  return Response.json({ connection: updated, needsAccess: !ready });
}

async function conflictTask(context: RequestContext, body: Record<string, unknown>) {
  let actor = context.actor;
  const id = clean(body.conflictId, 80);
  const db = getDb();
  const key = `INTEGRATION_CONFLICT:${id}`;
  const [row] = await db.select().from(integrationConflicts).where(eq(integrationConflicts.id, id)).limit(1);
  if (!row) return Response.json({ error: "Конфликт не найден" }, { status: 404 });
  const scopeDenial = await assignedIntegrationDenial(context, row.connectionId);
  if (scopeDenial) return scopeDenial;
  if (protectedBankConnectionIds.has(row.connectionId)) {
    const authorization = authorizeBankOwnerMutation(context, row.connectionId);
    if (authorization instanceof Response) return authorization;
    actor = authorization.actor;
  }
  const existing = await findScopedAutomationTask(db, context, key);
  const existingResponse = scopedAutomationTaskResponse(existing);
  if (existingResponse) return existingResponse;
  const assignment = resolveTaskAssignment(context, row.ownerEntityId, actor);
  if (!assignment.ok) return privateJson({ error: assignment.error }, assignment.status);
  const [task] = await db.insert(tasks).values({
    title: `Разобрать конфликт · ${row.fieldName}`,
    owner: assignment.owner,
    dueDate: relativeDate(3),
    priority: row.conflictType === "Свежесть" ? "Высокий" : "Средний",
    status: "Входящие",
    sourceType: "Конфликт интеграции",
    sourceId: id,
    description: `${row.sourceValue} ↔ ${row.targetValue}`,
    assigneeEntityId: assignment.assigneeEntityId,
    kind: "Контроль данных",
    automationKey: key,
    requiresApproval: true,
    createdBy: actor,
    createdByUserId: context.appUserId,
  }).returning();
  await db.update(integrationConflicts).set({ relatedTaskId: task.id, status: "В работе" }).where(eq(integrationConflicts.id, id));
  await audit(actor, "integration.conflict_task_created", "integration_conflict", id, { taskId: task.id });
  return Response.json({ task }, { status: 201 });
}

async function resolveConflict(context: RequestContext, body: Record<string, unknown>) {
  let actor = context.actor;
  const id = clean(body.conflictId, 80);
  const resolution = clean(body.resolution, 400);
  const evidence = clean(body.evidence, 400);
  const db = getDb();
  if (!canResolveConflict(resolution, evidence)) return Response.json({ error: "Нужны решение и проверяемое доказательство" }, { status: 400 });
  const [existing] = await db.select().from(integrationConflicts).where(eq(integrationConflicts.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Конфликт не найден" }, { status: 404 });
  const scopeDenial = await assignedIntegrationDenial(context, existing.connectionId);
  if (scopeDenial) return scopeDenial;
  if (protectedBankConnectionIds.has(existing.connectionId)) {
    const authorization = authorizeBankOwnerMutation(context, existing.connectionId);
    if (authorization instanceof Response) return authorization;
    actor = authorization.actor;
  }
  const [row] = await db.update(integrationConflicts).set({ status: "Закрыт", resolution, evidence, resolvedAt: new Date().toISOString() }).where(eq(integrationConflicts.id, id)).returning();
  await audit(actor, "integration.conflict_resolved", "integration_conflict", id, { resolution, evidence });
  return Response.json({ conflict: row });
}

function isCoreConnection(connection: { system: string; category: string; mode: string; adapterVersion: string }) {
  return connection.system === "ArtHello OS D1"
    && connection.category === "Внутренняя платформа"
    && connection.mode.toLowerCase().includes("binding")
    && connection.adapterVersion.toLowerCase().startsWith("d1-core@");
}

function relativeDate(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) {
  await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) });
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function publicSetup(setup: IntegrationSetup) {
  return {
    connectionId: setup.connectionId,
    authMethod: setup.authMethod,
    startDate: setup.startDate,
    syncIntervalMinutes: setup.syncIntervalMinutes,
    syncMinute: setup.syncMinute,
    endpoint: setup.endpoint,
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
  };
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

function safeIntegrationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const controlled = new Set([
    "Не выбрана интеграция",
    "Интеграция не найдена",
    "Укажите дату начала загрузки",
    "Выберите юридическое лицо",
    "Выберите филиал назначения",
    "Выберите, какие данные получать",
    "Защищённое хранилище не настроено: задайте INTEGRATION_CREDENTIALS_KEY",
    "Защищённый ключ Точки недоступен. Введите ключ заново.",
    "Защищённый токен Т‑Банка недоступен. Введите ключ заново.",
    "Выберите существующую карточку юридического лица",
    "Выберите действующий филиал",
    "Адрес подключения должен быть HTTPS-ссылкой без логина, пароля, параметров или служебной части",
    "Подтвердите ограниченные права токена Т‑Банка",
    "Настройка банка изменилась во время сохранения. Повторите действие.",
  ]);
  return controlled.has(message) ? message : "Действие не выполнено";
}
