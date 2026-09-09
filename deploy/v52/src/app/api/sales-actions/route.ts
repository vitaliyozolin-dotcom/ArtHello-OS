import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, salesLeads, salesStageEvents, salesTouchpoints, tasks } from "../../../db/schema";
import { nextSalesStage } from "../../../lib/sales";
import { recordLabel } from "../../../lib/record-labels";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { isTaskManager, resolveTaskAssignment, type TaskAccessContext } from "../../../lib/task-access";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";

const salesRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "SALES"]);
const touchpointTypes = new Set(["Звонок", "Переписка", "Консультация", "Посещение"]);
const rejectionReasons = new Set(["Стоимость", "Не подошла программа", "Локация", "Срок", "Нет ответа", "Выбран конкурент", "Другое"]);
const manualLeadSources = new Set(["Ручной ввод", "Сайт", "Телефон", "WhatsApp", "Telegram", "VK", "Яндекс", "Email", "Рекомендация", "Другое"]);

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const actor = context.actor;
  if (!salesRoles.has(context.apiRole)) return Response.json({ error: "Недостаточно прав для изменения продаж" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "createLead") return createLead(actor, body);
    if (action === "advanceStage") return advanceStage(actor, body);
    if (action === "logTouchpoint") return logTouchpoint(actor, body);
    if (action === "recordRejection") return recordRejection(actor, body);
    if (action === "createFollowupTask") return createFollowupTask(context, body);
    return Response.json({ error: "Неизвестное действие продаж" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function createLead(actor: string, body: Record<string, unknown>) {
  const name = clean(body.name, 160);
  const phone = clean(body.phone, 60);
  const email = clean(body.email, 160).toLocaleLowerCase("ru");
  const requestedSource = clean(body.source, 60);
  const source = manualLeadSources.has(requestedSource) ? requestedSource : "Ручной ввод";
  const interest = clean(body.interest, 240);
  const branchId = clean(body.branchId, 80);
  const comment = clean(body.comment, 800);
  const utmSource = clean(body.utmSource, 100);
  const utmMedium = clean(body.utmMedium, 100);
  const utmCampaign = clean(body.utmCampaign, 120);
  const consent = body.consent === true;

  if (name.length < 2) return Response.json({ error: "Укажите имя потенциального клиента" }, { status: 400 });
  if (!phone && !email) return Response.json({ error: "Укажите телефон или email" }, { status: 400 });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Проверьте email" }, { status: 400 });
  if (!consent) return Response.json({ error: "Нужно подтвердить согласие на обработку контактных данных" }, { status: 400 });

  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const leadId = `LEAD-M-${suffix}`;
  const contactId = `PROSPECT-M-${suffix}`;
  const touchpointId = `TP-${leadId}-01`;
  const now = new Date().toISOString();
  const tags = ["ручной ввод", interest || source].filter(Boolean).slice(0, 5);
  const db = getDb();

  try {
    await db.insert(entities).values({
      id: contactId,
      entityType: "Потенциальный клиент",
      displayName: name,
      status: "На квалификации",
      sourceSystem: "MANUAL_SALES",
      sourceRecordId: leadId,
      dataQuality: "Проверено",
      scope: branchId || "Продажи",
      metadata: JSON.stringify({ phone, email, interest, branchId, comment, consentAt: now }),
      createdBy: actor,
      updatedAt: now,
    });
    await db.insert(salesLeads).values({
      id: leadId,
      firstClickAt: now,
      source,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent: "",
      campaignId: "",
      creativeId: "",
      offerId: interest,
      formId: "MANUAL_UI",
      managerEntityId: "",
      stage: "Заявка",
      status: "Активен",
      familyEntityId: contactId,
      childEntityId: "",
      contractId: "",
      serviceEntityId: "",
      rejectionReason: "",
      tags: JSON.stringify(tags),
      dataQuality: "Ручной ввод · ожидает квалификации",
      updatedAt: now,
    });
    await db.insert(salesTouchpoints).values({
      id: touchpointId,
      leadId,
      touchpointType: "Заявка",
      occurredAt: now,
      channel: source,
      direction: "Входящий",
      summary: [name, phone, email, interest].filter(Boolean).join(" · "),
      outcome: comment || "Лид создан вручную",
      sourceRef: "MANUAL_UI",
      createdBy: actor,
    });
    await db.insert(salesStageEvents).values({
      leadId,
      fromStage: "Первый клик",
      toStage: "Заявка",
      outcome: "Создано",
      reason: `Ручной ввод · ${source}`,
      actor,
      occurredAt: now,
    });
    await db.insert(auditEvents).values({
      actor,
      action: "sales.lead_created",
      entityType: "sales_lead",
      entityId: leadId,
      payload: JSON.stringify({ contactId, source, branchId, contactProvenance: "Создано вручную", contactDataQuality: "Проверено", hasPhone: Boolean(phone), hasEmail: Boolean(email), consent: true }),
    });
    return Response.json({ lead: { id: leadId, contactId, name, stage: "Заявка", source } }, { status: 201 });
  } catch (error) {
    await db.delete(salesTouchpoints).where(eq(salesTouchpoints.leadId, leadId)).catch(() => undefined);
    await db.delete(salesStageEvents).where(eq(salesStageEvents.leadId, leadId)).catch(() => undefined);
    await db.delete(salesLeads).where(eq(salesLeads.id, leadId)).catch(() => undefined);
    await db.delete(entities).where(eq(entities.id, contactId)).catch(() => undefined);
    throw error;
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

async function createFollowupTask(context: TaskAccessContext, body: Record<string, unknown>) {
  const actor = context.actor;
  const leadId = clean(body.leadId, 80);
  const lead = await getLead(leadId);
  if (!lead) return Response.json({ error: "Лид не найден" }, { status: 404 });
  const db = getDb();
  const automationKey = `SALES_FOLLOWUP:${lead.id}:${lead.stage}`;
  const existing = await findScopedAutomationTask(db, context, automationKey);
  const existingResponse = scopedAutomationTaskResponse(existing);
  if (existingResponse) return existingResponse;
  const assignment = resolveTaskAssignment(context, lead.managerEntityId, actor);
  if (!assignment.ok) return Response.json({ error: assignment.error }, { status: assignment.status });
  if (isTaskManager(context) && assignment.assigneeEntityId && !(await verifiedEntityId(assignment.assigneeEntityId))) {
    return Response.json({ error: "Ответственный не найден" }, { status: 400 });
  }
  const [task] = await db.insert(tasks).values({
    title: `Следующий шаг: ${recordLabel("лид", lead.id).toLocaleLowerCase("ru")} · ${lead.stage}`,
    owner: assignment.owner,
    dueDate: relativeDate(2),
    priority: lead.stage === "Заявка" ? "Высокий" : "Средний",
    status: "Входящие",
    sourceType: "Лид продаж",
    sourceId: lead.id,
    description: `Проверить историю контактов, зафиксировать доказательство и перевести лид только на следующий этап. Текущий этап: ${lead.stage}.`,
    assigneeEntityId: assignment.assigneeEntityId,
    kind: "Автозадача",
    automationKey,
    createdByUserId: context.appUserId,
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
