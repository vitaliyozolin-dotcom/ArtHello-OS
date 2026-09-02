import { eq } from "drizzle-orm";
import {
  ensureCoreTables,
  getDb,
  getIntegrationSetups,
  readIntegrationCredential,
  revokeTochkaIntegrationCredential,
  saveIntegrationSetup,
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
import { canResolveConflict, probeTochkaJwt, retryDecision, validateTochkaJwt } from "../../../lib/integrations";
import type { TochkaProbeResult } from "../../../lib/integrations";
import {
  getAuthenticatedRequestContext,
  isCanonicalOwnerContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../lib/production-auth";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";
import { resolveTaskAssignment } from "../../../lib/task-access";

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS"]);
const tochkaConnectionId = "INT-T-TOCHKA";
const tochkaOwnerActions = new Set([
  "saveSetup",
  "testConnection",
  "retrySync",
  "pauseConnection",
  "resumeConnection",
  "revokeCredential",
]);
type RequestContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedRequestContext>>>;

export async function POST(request: Request) {
  let context: RequestContext | null;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return privateJson({ error: "Сервис авторизации временно недоступен" }, 503);
  }
  if (!context) return privateJson({ error: "Требуется вход" }, 401);
  if (!editors.has(context.apiRole)) return privateJson({ error: "Нет прав на управление интеграциями" }, 403);
  let actor = context.actor;
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    const connectionId = action === "saveSetup" && body.setup && typeof body.setup === "object"
      ? clean((body.setup as Partial<IntegrationSetup>).connectionId, 80).toUpperCase()
      : clean(body.connectionId, 80).toUpperCase();
    if (connectionId === tochkaConnectionId && tochkaOwnerActions.has(action)) {
      const authorization = authorizeTochkaOwnerMutation(request, context);
      if (authorization instanceof Response) return authorization;
      actor = authorization.actor;
    }
    await ensureCoreTables();
    await ensureOperatingIntegrationCatalog();
    if (action === "saveSetup") {
      return saveSetup(actor, body);
    }
    if (action === "testConnection") return testConnection(actor, body);
    if (action === "retrySync") return retrySync(actor, body);
    if (action === "pauseConnection") return pauseConnection(actor, body);
    if (action === "resumeConnection") return resumeConnection(actor, body);
    if (action === "revokeCredential") return revokeCredential(actor, body);
    if (action === "createConflictTask") return conflictTask(request, context, body);
    if (action === "resolveConflict") return resolveConflict(request, context, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("integration.action_failed");
    return privateJson({ error: safeIntegrationError(error) }, 500);
  }
}

function authorizeTochkaOwnerMutation(request: Request, requester: RequestContext): { actor: string } | Response {
  if (!isCanonicalOwnerContext(requester)) {
    return privateJson({ error: "Настройка и проверка Точки доступны только собственнику" }, 403);
  }
  try {
    verifyAuthenticatedRequestCsrf(request, requester);
  } catch {
    return privateJson({ error: "Защитная сессия устарела. Войдите заново." }, 403);
  }
  return { actor: requester.actor };
}

async function saveSetup(actor: string, body: Record<string, unknown>) {
  const setupInput = body.setup && typeof body.setup === "object"
    ? body.setup as Partial<IntegrationSetup>
    : {};
  const connectionId = clean(setupInput.connectionId, 80).toUpperCase();
  const credential = typeof body.credential === "string" ? body.credential.trim() : "";
  let candidateProbe: TochkaProbeResult | null = null;
  if (connectionId === tochkaConnectionId && setupInput.authMethod !== "JWT") {
    return privateJson({ error: "Для Точки в этом релизе доступно только подключение готового JWT" }, 400);
  }
  if (connectionId === tochkaConnectionId) await validateIntegrationSetupReferences(setupInput);

  if (credential) {
    if (connectionId !== tochkaConnectionId) {
      return privateJson({ error: "JWT принимается только для подключения банка Точка" }, 400);
    }
    const validation = validateTochkaJwt(credential);
    if (!validation.valid) return privateJson({ error: validation.reason }, 400);
    candidateProbe = await probeTochkaJwt(
      credential,
      fetch,
      Date.now(),
      clean(setupInput.customerCode, 80),
    );
    if (!candidateProbe.valid) {
      await audit(actor, "integration.tochka_candidate_rejected", "integration_connection", connectionId, {
        selectedLegalEntityId: clean(setupInput.legalEntityId, 80),
        requestedCustomerCode: clean(setupInput.customerCode, 80),
        bankResolvedCustomerCode: candidateProbe.customerCode,
        availableCustomerCodes: candidateProbe.customerChoices.map((customer) => customer.code),
        reason: candidateProbe.reason,
      });
      return privateJson({
        error: candidateProbe.reason,
        customerChoices: candidateProbe.customerChoices,
      }, candidateProbe.customerChoices.length ? 409 : 422);
    }
    setupInput.customerCode = candidateProbe.customerCode;
    const setup = await saveTochkaSetupWithCredential(actor, setupInput, credential);
    return recordTochkaProbe(actor, setup, "Настройка владельцем", candidateProbe);
  }

  const existing = (await getIntegrationSetups())[connectionId];
  if (connectionId === tochkaConnectionId && existing?.secretStatus === "stored") {
    const nextLegalEntityId = clean(setupInput.legalEntityId, 80);
    const nextCustomerCode = clean(setupInput.customerCode, 80);
    if (existing.legalEntityId !== nextLegalEntityId || existing.customerCode !== nextCustomerCode) {
      return privateJson({
        error: "Для смены юрлица или customerCode введите JWT: новая привязка сначала проверяется банком, затем заменяет прежнюю атомарно.",
      }, 409);
    }
  }
  const setup = await saveIntegrationSetup(actor, setupInput);

  if (setup.connectionId === tochkaConnectionId && setup.authMethod === "JWT") {
    return privateJson({
      setup,
      message: setup.secretStatus === "stored"
        ? "Черновик распределения сохранён. JWT не использовался; отдельную проверку счетов запускает собственник."
        : setup.customerCode
          ? "Черновик сохранён. Для проверки customerCode и счетов введите JWT."
          : "Черновик сохранён. Введите JWT: система получит customerCode из банка и попросит выбрать, если доступно несколько.",
    });
  }

  return privateJson({ setup, message: "Параметры и расписание сохранены." });
}

async function revokeCredential(actor: string, body: Record<string, unknown>) {
  const connectionId = clean(body.connectionId, 80).toUpperCase();
  if (connectionId !== tochkaConnectionId) {
    return privateJson({ error: "Отзыв ключа через интерфейс доступен только для Точки" }, 400);
  }
  const setup = await revokeTochkaIntegrationCredential(actor);
  return privateJson({
    setup,
    message: "JWT Точки отозван и удалён из защищённого хранилища. Для новой проверки потребуется ввести ключ заново.",
  });
}

async function testConnection(actor: string, body: Record<string, unknown>) {
  const connectionId = clean(body.connectionId, 80).toUpperCase();
  if (connectionId !== "INT-T-TOCHKA") return retrySync(actor, body);
  const setups = await getIntegrationSetups();
  const setup = setups[connectionId];
  if (!setup) return privateJson({ error: "Сначала сохраните параметры подключения" }, 409);
  return verifyTochkaConnection(actor, setup, "Ручная проверка");
}

async function verifyTochkaConnection(actor: string, setup: IntegrationSetup, trigger: string) {
  if (!setup.customerCode) return privateJson({ error: "Сначала подтвердите customerCode с помощью JWT" }, 409);
  const token = await readIntegrationCredential(setup.connectionId, setup.legalEntityId, setup.customerCode);
  if (!token) return privateJson({ error: "Введите JWT для выбранной карточки и customerCode" }, 409);
  return recordTochkaProbe(actor, setup, trigger, await probeTochkaJwt(token, fetch, Date.now(), setup.customerCode));
}

async function recordTochkaProbe(actor: string, setup: IntegrationSetup, trigger: string, probe: TochkaProbeResult) {
  const current = new Date().toISOString();
  const runId = `INT-RUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const correlationId = `CORR-${crypto.randomUUID()}`;
  const db = getDb();
  const [connection] = await db.select().from(integrationConnections)
    .where(eq(integrationConnections.id, setup.connectionId)).limit(1);
  if (!connection) return privateJson({ error: "Интеграция не найдена" }, 404);

  if (!probe.valid) {
    await db.insert(integrationSyncRuns).values({
      id: runId,
      connectionId: setup.connectionId,
      startedAt: current,
      finishedAt: current,
      trigger,
      status: "Заблокировано",
      errorCount: 1,
      errorMessage: probe.reason,
      initiatedBy: actor,
      correlationId,
      dryRun: true,
    });
    await db.insert(integrationLogEntries).values({
      runId,
      connectionId: setup.connectionId,
      level: "ERROR",
      event: "tochka.credential_rejected",
      message: probe.reason,
      recordRef: "accounts:probe",
    });
    await db.update(integrationConnections).set({
      status: "Ожидает проверку",
      authStatus: "JWT сохранён · проверка банка не пройдена",
      credentialExpiresAt: probe.expiresAt,
      verifiedTransfer: false,
      isEnabled: false,
      errorCount: connection.errorCount + 1,
      updatedAt: current,
    }).where(eq(integrationConnections.id, setup.connectionId));
    await audit(actor, "integration.tochka_probe_failed", "integration_connection", setup.connectionId, {
      runId,
      selectedLegalEntityId: setup.legalEntityId,
      selectedCustomerCode: setup.customerCode,
      reason: probe.reason,
    });
    return privateJson({ error: probe.reason }, 422);
  }

  await db.insert(integrationSyncRuns).values({
    id: runId,
    connectionId: setup.connectionId,
    startedAt: current,
    finishedAt: current,
    trigger,
    status: "Проверка пройдена",
    receivedCount: probe.accountCount,
    acceptedCount: 0,
    checkpoint: `accounts:${probe.accountCount}`,
    initiatedBy: actor,
    correlationId,
    dryRun: true,
  });
  await db.insert(integrationLogEntries).values({
    runId,
    connectionId: setup.connectionId,
    level: "INFO",
    event: "tochka.accounts_verified",
    message: probe.accountCountScope === "selected_customer"
      ? `Банк подтвердил JWT и customerCode; счетов для кода: ${probe.accountCount}`
      : `Банк подтвердил JWT и customerCode; всего доступно счетов: ${probe.accountCount}`,
    recordRef: probe.accountCountScope === "selected_customer" ? "accounts:selected-customer" : "accounts:all-permitted",
  });
  await db.update(integrationConnections).set({
    status: "Доступ к счетам подтверждён",
    authStatus: "JWT и customerCode подтверждены · доступ к счетам проверен",
    credentialExpiresAt: probe.expiresAt,
    lastSuccessAt: "",
    nextSyncAt: "",
    receivedCount: 0,
    acceptedCount: 0,
    errorCount: 0,
    verifiedTransfer: false,
    isEnabled: false,
    updatedAt: current,
  }).where(eq(integrationConnections.id, setup.connectionId));
  await audit(actor, "integration.tochka_accounts_verified", "integration_connection", setup.connectionId, {
    runId,
    selectedLegalEntityId: setup.legalEntityId,
    selectedCustomerCode: setup.customerCode,
    accountScope: probe.accountCountScope,
    accountCount: probe.accountCount,
    allocationMode: setup.allocationMode,
  });
  return privateJson({
    setup: { ...setup, secretStatus: "stored" },
    test: {
      ok: true,
      customerCode: setup.customerCode,
      accountCount: probe.accountCount,
      accountCountScope: probe.accountCountScope,
      expiresAt: probe.expiresAt,
    },
    message: probe.accountCountScope === "selected_customer"
      ? `Банк подтвердил customerCode ${setup.customerCode} и доступ JWT к ${probe.accountCount} счетам этого кода. Связь с выбранной внутренней карточкой зафиксировал владелец; импорт операций ещё не запускался.`
      : `Банк подтвердил customerCode ${setup.customerCode} и доступ JWT к счетам: ${probe.accountCount} всего. Ответ по счетам не содержит customerCode для каждого счёта, поэтому принадлежность выбранной карточке сверяет владелец; импорт операций ещё не запускался.`,
  });
}

async function retrySync(actor: string, body: Record<string, unknown>) {
  const id = clean(body.connectionId, 80);
  if (id === "INT-T-TOCHKA") {
    const setup = (await getIntegrationSetups())[id];
    if (!setup) return privateJson({ error: "Сначала сохраните параметры подключения" }, 409);
    return verifyTochkaConnection(actor, setup, "Ручное обновление списка счетов");
  }
  const db = getDb();
  const [connection] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, id)).limit(1);
  if (!connection) return Response.json({ error: "Интеграция не найдена" }, { status: 404 });
  const current = new Date().toISOString();
  const runId = `INT-RUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
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
  if (isCoreConnection(connection)) return Response.json({ error: "Ядро D1 нельзя остановить из интерфейса" }, { status: 409 });
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

async function conflictTask(request: Request, context: RequestContext, body: Record<string, unknown>) {
  let actor = context.actor;
  const id = clean(body.conflictId, 80);
  const db = getDb();
  const key = `INTEGRATION_CONFLICT:${id}`;
  const [row] = await db.select().from(integrationConflicts).where(eq(integrationConflicts.id, id)).limit(1);
  if (!row) return Response.json({ error: "Конфликт не найден" }, { status: 404 });
  if (row.connectionId === tochkaConnectionId) {
    const authorization = authorizeTochkaOwnerMutation(request, context);
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

async function resolveConflict(request: Request, context: RequestContext, body: Record<string, unknown>) {
  let actor = context.actor;
  const id = clean(body.conflictId, 80);
  const resolution = clean(body.resolution, 400);
  const evidence = clean(body.evidence, 400);
  const db = getDb();
  if (!canResolveConflict(resolution, evidence)) return Response.json({ error: "Нужны решение и проверяемое доказательство" }, { status: 400 });
  const [existing] = await db.select().from(integrationConflicts).where(eq(integrationConflicts.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Конфликт не найден" }, { status: 404 });
  if (existing.connectionId === tochkaConnectionId) {
    const authorization = authorizeTochkaOwnerMutation(request, context);
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
    "Защищённый JWT недоступен. Введите ключ заново.",
  ]);
  return controlled.has(message) ? message : "Действие не выполнено";
}
