import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, businessEvents, entities, strategyDeviations, strategyKpis, strategyProjects, strategyResults, tasks } from "../../../db/schema";
import { canCloseStrategyDeviation, kpiState } from "../../../lib/strategy";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { isTaskManager, resolveTaskAssignment, type TaskAccessContext } from "../../../lib/task-access";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "PROJECTS"]);

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const actor = context.actor;
  if (!editors.has(context.apiRole)) return Response.json({ error: "Нет прав на изменение стратегии" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "createEvent") return createEvent(actor, body);
    if (action === "recordEventResult") return recordEventResult(actor, body);
    if (action === "updateKpiActual") return updateKpi(actor, body);
    if (action === "createCorrectiveTask") return correctiveTask(context, body);
    if (action === "closeDeviation") return closeDeviation(actor, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function createEvent(actor: string, body: Record<string, unknown>) {
  const title = clean(body.title, 180);
  const projectId = clean(body.projectId, 80);
  const eventAt = clean(body.eventAt, 40);
  const location = clean(body.location, 180);
  const requestedResponsible = clean(body.responsibleEntityId, 80);
  const budgetMinor = Number(body.budgetMinor ?? 0);
  if (title.length < 5 || !projectId || !eventAt || Number.isNaN(new Date(eventAt).getTime()) || !Number.isInteger(budgetMinor) || budgetMinor < 0) return Response.json({ error: "Укажите проект, событие, дату и корректный бюджет" }, { status: 400 });
  const db = getDb();
  const [project] = await db.select().from(strategyProjects).where(eq(strategyProjects.id, projectId)).limit(1);
  if (!project || isDemoReference(project.id)) return Response.json({ error: "Рабочий проект не найден" }, { status: 404 });
  const responsibleEntityId = requestedResponsible || project.ownerEntityId;
  if (!(await isWorkingEntity(responsibleEntityId))) return Response.json({ error: "Назначьте ответственного из рабочего справочника" }, { status: 400 });
  const id = `EVENT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(businessEvents).values({ id, projectId, title, eventAt: new Date(eventAt).toISOString(), location, responsibleEntityId, budgetMinor, actualMinor: 0, status: "Запланировано" }).returning();
  await audit(actor, "strategy.event_created", "business_event", id, { projectId, title, responsibleEntityId });
  return Response.json({ event: row }, { status: 201 });
}

async function recordEventResult(actor: string, body: Record<string, unknown>) {
  const id = clean(body.eventId, 80);
  const result = clean(body.result, 400);
  const score = Number(body.feedbackScore);
  const db = getDb();
  if (result.length < 8 || !Number.isInteger(score) || score < 0 || score > 100) return Response.json({ error: "Нужны результат и оценка 0–100" }, { status: 400 });
  const [event] = await db.select().from(businessEvents).where(eq(businessEvents.id, id)).limit(1);
  if (!event) return Response.json({ error: "Событие не найдено" }, { status: 404 });
  if (event.status === "Проведено") return Response.json({ event, reused: true });
  const [updated] = await db.update(businessEvents).set({ status: "Проведено", result, feedbackScore: score }).where(eq(businessEvents.id, id)).returning();
  const resultId = `STR-RES-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await db.insert(strategyResults).values({ id: resultId, projectId: event.projectId, eventId: id, resultType: "Событие", metricName: "Обратная связь", metricValue: score, unit: "%", evidence: result, recordedAt: new Date().toISOString() });
  await audit(actor, "strategy.event_result_recorded", "business_event", id, { score, resultId });
  return Response.json({ event: updated, resultId });
}

async function updateKpi(actor: string, body: Record<string, unknown>) {
  const id = clean(body.kpiId, 80);
  const actual = Number(body.actualValue);
  const forecast = Number(body.forecastValue);
  const db = getDb();
  if (!Number.isInteger(actual) || !Number.isInteger(forecast)) return Response.json({ error: "Значения KPI должны быть целыми" }, { status: 400 });
  const [row] = await db.select().from(strategyKpis).where(eq(strategyKpis.id, id)).limit(1);
  if (!row) return Response.json({ error: "KPI не найден" }, { status: 404 });
  const state = kpiState(row.targetValue, actual, forecast);
  const [updated] = await db.update(strategyKpis).set({ actualValue: actual, forecastValue: forecast, varianceValue: state.variance, status: state.status, updatedAt: new Date().toISOString() }).where(eq(strategyKpis.id, id)).returning();
  await audit(actor, "strategy.kpi_updated", "strategy_kpi", id, { actual, forecast, ...state });
  return Response.json({ kpi: updated });
}

async function correctiveTask(context: TaskAccessContext, body: Record<string, unknown>) {
  const actor = context.actor;
  const id = clean(body.deviationId, 80);
  const requestedAssignee = clean(body.assigneeEntityId, 80);
  const db = getDb();
  const key = `STRATEGY_DEVIATION:${id}`;
  const [row] = await db.select().from(strategyDeviations).where(eq(strategyDeviations.id, id)).limit(1);
  if (!row) return Response.json({ error: "Отклонение не найдено" }, { status: 404 });
  const [project] = await db.select().from(strategyProjects).where(eq(strategyProjects.id, row.projectId)).limit(1);
  const assignment = resolveTaskAssignment(context, requestedAssignee || project?.ownerEntityId || "", actor);
  if (!assignment.ok) return Response.json({ error: assignment.error }, { status: assignment.status });
  if (isTaskManager(context) && assignment.assigneeEntityId && !(await isWorkingEntity(assignment.assigneeEntityId))) return Response.json({ error: "Назначьте исполнителя из рабочего справочника" }, { status: 400 });
  const existing = await findScopedAutomationTask(db, context, key);
  const existingResponse = scopedAutomationTaskResponse(existing);
  if (existingResponse) return existingResponse;
  const [task] = await db.insert(tasks).values({ title: `Корректирующее действие · ${row.kpiId}`, owner: assignment.owner, dueDate: dateAfterDays(7), priority: "Высокий", status: "Входящие", sourceType: "Отклонение KPI", sourceId: id, description: `${row.explanation}. Решение: ${row.decision}`, assigneeEntityId: assignment.assigneeEntityId, kind: "Корректирующее действие", automationKey: key, requiresApproval: true, createdByUserId: context.appUserId, createdBy: actor }).returning();
  await db.update(strategyDeviations).set({ relatedTaskId: task.id, status: "В работе" }).where(eq(strategyDeviations.id, id));
  await audit(actor, "strategy.corrective_task_created", "strategy_deviation", id, { taskId: task.id, assigneeEntityId: assignment.assigneeEntityId });
  return Response.json({ task }, { status: 201 });
}

async function closeDeviation(actor: string, body: Record<string, unknown>) {
  const id = clean(body.deviationId, 80);
  const evidence = clean(body.evidence, 400);
  const decision = clean(body.decision, 300);
  if (!canCloseStrategyDeviation(evidence, decision)) return Response.json({ error: "Нужны доказательство и решение" }, { status: 400 });
  const db = getDb();
  const [row] = await db.select().from(strategyDeviations).where(eq(strategyDeviations.id, id)).limit(1);
  if (!row) return Response.json({ error: "Отклонение не найдено" }, { status: 404 });
  const [updated] = await db.update(strategyDeviations).set({ explanation: `${row.explanation} · Доказательство: ${evidence}`, decision, status: "Закрыто" }).where(eq(strategyDeviations.id, id)).returning();
  await audit(actor, "strategy.deviation_closed", "strategy_deviation", id, { evidence, decision });
  return Response.json({ deviation: updated });
}

async function isWorkingEntity(id: string) {
  if (!id || isDemoReference(id)) return false;
  const [entity] = await getDb().select({ id: entities.id }).from(entities).where(eq(entities.id, id)).limit(1);
  return Boolean(entity);
}

function isDemoReference(value: string) { return /(^|[-_])(T|TEST)([-_]|$)|SYNTHETIC/i.test(value); }
function dateAfterDays(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) { await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) }); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
