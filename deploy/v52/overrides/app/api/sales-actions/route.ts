import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, salesLeads, salesStageEvents, salesTouchpoints, tasks } from "../../../db/schema";
import { nextSalesStage } from "../../../lib/sales";
import { getRequestUser } from "../../../lib/request-user";

const salesRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "SALES"]);
const touchpointTypes = new Set(["Звонок", "Переписка", "Консультация", "Посещение"]);
const rejectionReasons = new Set(["Стоимость", "Не подошла программа", "Локация", "Срок", "Нет ответа", "Выбран конкурент", "Другое"]);

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!salesRoles.has(role)) return Response.json({ error: "Недостаточно прав для изменения продаж" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "advanceStage") return advanceStage(actor, body);
    if (action === "logTouchpoint") return logTouchpoint(actor, body);
    if (action === "recordRejection") return recordRejection(actor, body);
    if (action === "createFollowupTask") return createFollowupTask(actor, body);
    return Response.json({ error: "Неизвестное действие продаж" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function getLead(leadId: string) {
  const [lead] = await getDb().select().from(salesLeads).where(eq(salesLeads.id, leadId)).limit(1);
  return lead;
}

async function advanceStage(actor: string, body: Record<string, unknown>) {
  const leadId = clean(body.leadId, 80);
  const evidence = clean(body.evidence, 500);
  const lead = await getLead(leadId);
  if (!lead) return Response.json({ error: "Лид не найден" }, { status: 404 });
  if (lead.status !== "Активен") return Response.json({ error: "Закрытый лид нельзя продвинуть" }, { status: 409 });
  const nextStage = nextSalesStage(lead.stage);
  if (!nextStage) return Response.json({ error: "Лид уже на финальном этапе" }, { status: 409 });
  if (evidence.length < 8) return Response.json({ error: "Добавьте подтверждение перехода" }, { status: 400 });
  const db = getDb();
  const [event] = await db.insert(salesStageEvents).values({ leadId, fromStage: lead.stage, toStage: nextStage, outcome: "Успешно", reason: evidence, actor }).returning();
  await db.update(salesLeads).set({ stage: nextStage, updatedAt: new Date().toISOString() }).where(eq(salesLeads.id, leadId));
  await db.insert(auditEvents).values({ actor, action: "sales.stage_advanced", entityType: "sales_lead", entityId: leadId, payload: JSON.stringify({ from: lead.stage, to: nextStage, eventId: event.id }) });
  return Response.json({ event, stage: nextStage });
}

async function logTouchpoint(actor: string, body: Record<string, unknown>) {
  const leadId = clean(body.leadId, 80);
  const touchpointType = clean(body.touchpointType, 40);
  const summary = clean(body.summary, 500);
  const outcome = clean(body.outcome, 300);
  if (!touchpointTypes.has(touchpointType) || summary.length < 6 || outcome.length < 3) {
    return Response.json({ error: "Выберите тип и заполните итог контакта" }, { status: 400 });
  }
  const lead = await getLead(leadId);
  if (!lead) return Response.json({ error: "Лид не найден" }, { status: 404 });
  const id = `TP-${leadId}-${crypto.randomUUID().slice(0, 8)}`;
  const db = getDb();
  const [touchpoint] = await db.insert(salesTouchpoints).values({
    id, leadId, touchpointType, occurredAt: new Date().toISOString(), channel: "Ручная запись", direction: "Исходящий",
    summary, outcome, sourceRef: "MANUAL_UI", createdBy: actor,
  }).returning();
  await db.insert(auditEvents).values({ actor, action: "sales.touchpoint_logged", entityType: "sales_lead", entityId: leadId, payload: JSON.stringify({ touchpointId: id, touchpointType }) });
  return Response.json({ touchpoint }, { status: 201 });
}

async function recordRejection(actor: string, body: Record<string, unknown>) {
  const leadId = clean(body.leadId, 80);
  const reason = clean(body.reason, 80);
  const evidence = clean(body.evidence, 500);
  if (!rejectionReasons.has(reason) || evidence.length < 8) return Response.json({ error: "Укажите допустимую причину и комментарий" }, { status: 400 });
  const lead = await getLead(leadId);
  if (!lead) return Response.json({ error: "Лид не найден" }, { status: 404 });
  const db = getDb();
  await db.update(salesLeads).set({ status: "Закрыт", rejectionReason: reason, updatedAt: new Date().toISOString() }).where(eq(salesLeads.id, leadId));
  await db.insert(salesStageEvents).values({ leadId, fromStage: lead.stage, toStage: lead.stage, outcome: "Отказ", reason: `${reason}: ${evidence}`, actor });
  await db.insert(auditEvents).values({ actor, action: "sales.lead_rejected", entityType: "sales_lead", entityId: leadId, payload: JSON.stringify({ reason, evidence }) });
  return Response.json({ status: "Закрыт", rejectionReason: reason });
}

async function createFollowupTask(actor: string, body: Record<string, unknown>) {
  const leadId = clean(body.leadId, 80);
  const lead = await getLead(leadId);
  if (!lead) return Response.json({ error: "Лид не найден" }, { status: 404 });
  const db = getDb();
  const automationKey = `SALES_FOLLOWUP:${lead.id}:${lead.stage}`;
  const [existing] = await db.select().from(tasks).where(eq(tasks.automationKey, automationKey)).limit(1);
  if (existing) return Response.json({ task: existing, reused: true });
  const assigneeEntityId = await verifiedEntityId(lead.managerEntityId);
  const [task] = await db.insert(tasks).values({
    title: `Следующий шаг по ${lead.id} · ${lead.stage}`,
    owner: actor,
    dueDate: relativeDate(2),
    priority: lead.stage === "Заявка" ? "Высокий" : "Средний",
    status: "Входящие",
    sourceType: "Лид продаж",
    sourceId: lead.id,
    description: `Проверить историю контактов, зафиксировать доказательство и перевести лид только на следующий этап. Текущий этап: ${lead.stage}.`,
    assigneeEntityId,
    kind: "Автозадача",
    automationKey,
    createdBy: actor,
  }).returning();
  await db.insert(auditEvents).values({ actor, action: "sales.followup_task_created", entityType: "sales_lead", entityId: leadId, payload: JSON.stringify({ taskId: task.id }) });
  return Response.json({ task }, { status: 201 });
}

async function verifiedEntityId(candidate: string) {
  if (!candidate) return "";
  const [entity] = await getDb().select({ id: entities.id }).from(entities).where(eq(entities.id, candidate)).limit(1);
  return entity?.id ?? "";
}

function relativeDate(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
