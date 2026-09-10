import { eq } from "drizzle-orm";
import {
  ensureCoreTables,
  getDb,
  saveIntegrationSetup,
} from "../../../db";
import type { IntegrationSetup } from "../../../db";
import {
  auditEvents,
  entities,
  integrationConflicts,
  integrationConnections,
  integrationLogEntries,
  integrationSyncRuns,
  tasks,
} from "../../../db/schema";
import { canResolveConflict, retryDecision } from "../../../lib/integrations";
import { getRequestUser } from "../../../lib/request-user";

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS"]);

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!editors.has(role)) return Response.json({ error: "Нет прав на управление интеграциями" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "saveSetup") {
      const setup = await saveIntegrationSetup(actor, body.setup as Partial<IntegrationSetup>);
      return Response.json({ setup, message: "Расписание сохранено. Для реального запуска нужен секрет в защищённом хранилище." });
    }
    if (action === "retrySync") return retrySync(actor, body);
    if (action === "pauseConnection") return pauseConnection(actor, body);
    if (action === "resumeConnection") return resumeConnection(actor, body);
    if (action === "createConflictTask") return conflictTask(actor, body);
    if (action === "resolveConflict") return resolveConflict(actor, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("integration.action_failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function retrySync(actor: string, body: Record<string, unknown>) {
  const id = clean(body.connectionId, 80);
  const db = getDb();
  const [connection] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, id)).limit(1);
  if (!connection) return Response.json({ error: "Интеграция не найдена" }, { status: 404 });
  const current = new Date().toISOString();
  const runId = `INT-RUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const correlationId = `CORR-${crypto.randomUUID()}`;
  const decision = retryDecision(connection);
  if (!decision.allowed || id !== "INT-T-D1") {
    const reason = id === "INT-T-D1"
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
  if (id === "INT-T-D1") return Response.json({ error: "Ядро D1 нельзя остановить из интерфейса" }, { status: 409 });
  const [row] = await db.update(integrationConnections).set({ status: "На паузе", isEnabled: false, updatedAt: new Date().toISOString() }).where(eq(integrationConnections.id, id)).returning();
  if (!row) return Response.json({ error: "Интеграция не найдена" }, { status: 404 });
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

async function conflictTask(actor: string, body: Record<string, unknown>) {
  const id = clean(body.conflictId, 80);
  const db = getDb();
  const key = `INTEGRATION_CONFLICT:${id}`;
  const [row] = await db.select().from(integrationConflicts).where(eq(integrationConflicts.id, id)).limit(1);
  if (!row) return Response.json({ error: "Конфликт не найден" }, { status: 404 });
  const [existing] = await db.select().from(tasks).where(eq(tasks.automationKey, key)).limit(1);
  if (existing) return Response.json({ task: existing, reused: true });
  const [task] = await db.insert(tasks).values({
    title: `Разобрать конфликт · ${row.fieldName}`,
    owner: "Владелец источника",
    dueDate: "2026-08-24",
    priority: row.conflictType === "Свежесть" ? "Высокий" : "Средний",
    status: "Входящие",
    sourceType: "Конфликт интеграции",
    sourceId: id,
    description: `${row.sourceValue} ↔ ${row.targetValue}`,
    assigneeEntityId: row.ownerEntityId,
    kind: "Контроль данных",
    automationKey: key,
    requiresApproval: true,
    createdBy: actor,
  }).returning();
  await db.update(integrationConflicts).set({ relatedTaskId: task.id, status: "В работе" }).where(eq(integrationConflicts.id, id));
  await audit(actor, "integration.conflict_task_created", "integration_conflict", id, { taskId: task.id });
  return Response.json({ task }, { status: 201 });
}

async function resolveConflict(actor: string, body: Record<string, unknown>) {
  const id = clean(body.conflictId, 80);
  const resolution = clean(body.resolution, 400);
  const evidence = clean(body.evidence, 400);
  const db = getDb();
  if (!canResolveConflict(resolution, evidence)) return Response.json({ error: "Нужны решение и проверяемое доказательство" }, { status: 400 });
  const [row] = await db.update(integrationConflicts).set({ status: "Закрыт", resolution, evidence, resolvedAt: new Date().toISOString() }).where(eq(integrationConflicts.id, id)).returning();
  if (!row) return Response.json({ error: "Конфликт не найден" }, { status: 404 });
  await audit(actor, "integration.conflict_resolved", "integration_conflict", id, { resolution, evidence });
  return Response.json({ conflict: row });
}

async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) {
  await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) });
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
