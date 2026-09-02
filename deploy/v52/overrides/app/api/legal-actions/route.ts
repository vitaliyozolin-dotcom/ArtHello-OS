import { desc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, legalChecks, legalContracts, legalDocumentItems, tasks } from "../../../db/schema";
import { nextLegalVersion } from "../../../lib/legal";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { isTaskManager, resolveTaskAssignment, type TaskAccessContext } from "../../../lib/task-access";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "LEGAL"]);

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const actor = context.actor;
  const role = context.apiRole;
  if (!editors.has(role)) return Response.json({ error: "Нет прав на юридическое действие" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "createDocumentVersion") return version(actor, body);
    if (action === "addDocument") return addDocument(actor, body);
    if (action === "createSignalTask") return signalTask(context, body);
    if (action === "resolveSignal") return resolve(actor, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function version(actor: string, body: Record<string, unknown>) {
  const stableId = clean(body.stableId, 80);
  const reference = clean(body.reference, 300);
  const db = getDb();
  if (reference.length < 5) return Response.json({ error: "Укажите основание или ссылку новой версии" }, { status: 400 });
  const [latest] = await db.select().from(legalDocumentItems).where(eq(legalDocumentItems.stableId, stableId)).orderBy(desc(legalDocumentItems.version)).limit(1);
  if (!latest) return Response.json({ error: "Документ не найден" }, { status: 404 });
  const nextVersion = nextLegalVersion(latest.version);
  const id = `${stableId}-V${nextVersion}`;
  const [row] = await db.insert(legalDocumentItems).values({ ...latest, id, version: nextVersion, reference, status: "На проверке", createdAt: new Date().toISOString() }).returning();
  await audit(actor, "legal.document_version_added", "legal_document", stableId, { from: latest.version, to: nextVersion, reference });
  return Response.json({ document: row }, { status: 201 });
}

async function addDocument(actor: string, body: Record<string, unknown>) {
  const contractId = clean(body.contractId, 80);
  const itemType = clean(body.itemType, 40);
  const title = clean(body.title, 200);
  const reference = clean(body.reference, 300);
  const db = getDb();
  if (!contractId || isDemoReference(contractId) || !itemType || title.length < 4) return Response.json({ error: "Укажите рабочий договор, тип и название" }, { status: 400 });
  const [contract] = await db.select().from(legalContracts).where(eq(legalContracts.id, contractId)).limit(1);
  if (!contract) return Response.json({ error: "Договор не найден" }, { status: 404 });
  const stableId = `LGLDOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const id = `${stableId}-V1`;
  const [row] = await db.insert(legalDocumentItems).values({ id, stableId, contractId, itemType, title, version: 1, required: false, signedStatus: "Не подписано", status: reference ? "На проверке" : "Метаданные", reference }).returning();
  await audit(actor, "legal.document_added", "legal_document", stableId, { contractId, itemType });
  return Response.json({ document: row }, { status: 201 });
}

async function signalTask(context: TaskAccessContext, body: Record<string, unknown>) {
  const actor = context.actor;
  const id = clean(body.signalId, 80);
  const assigneeEntityId = clean(body.assigneeEntityId, 80);
  const db = getDb();
  const key = `LEGAL_SIGNAL:${id}`;
  const [signal] = await db.select().from(legalChecks).where(eq(legalChecks.id, id)).limit(1);
  if (!signal) return Response.json({ error: "Сигнал не найден" }, { status: 404 });
  const assignment = resolveTaskAssignment(context, assigneeEntityId, actor);
  if (!assignment.ok) return Response.json({ error: assignment.error }, { status: assignment.status });
  if (isTaskManager(context) && assignment.assigneeEntityId) {
    if (isDemoReference(assignment.assigneeEntityId)) return Response.json({ error: "Выберите исполнителя из рабочего справочника" }, { status: 400 });
    const [assignee] = await db.select({ id: entities.id }).from(entities).where(eq(entities.id, assignment.assigneeEntityId)).limit(1);
    if (!assignee) return Response.json({ error: "Исполнитель не найден" }, { status: 404 });
  }
  const existing = await findScopedAutomationTask(db, context, key);
  const existingResponse = scopedAutomationTaskResponse(existing);
  if (existingResponse) return existingResponse;
  const [task] = await db.insert(tasks).values({ title: signal.recommendation, owner: assignment.owner, dueDate: dateAfterDays(signal.severity === "Критичный" ? 1 : 5), priority: signal.severity === "Критичный" ? "Критичный" : "Высокий", status: "Входящие", sourceType: "Юридический сигнал", sourceId: id, description: `${signal.evidence}. Проверить документы и зафиксировать решение без обвинений.`, assigneeEntityId: assignment.assigneeEntityId, kind: "Автозадача", automationKey: key, requiresApproval: true, createdByUserId: context.appUserId, createdBy: actor }).returning();
  await db.update(legalChecks).set({ relatedTaskId: task.id, status: "В работе" }).where(eq(legalChecks.id, id));
  await audit(actor, "legal.signal_task_created", "legal_check", id, { taskId: task.id, assigneeEntityId: assignment.assigneeEntityId });
  return Response.json({ task }, { status: 201 });
}

async function resolve(actor: string, body: Record<string, unknown>) {
  const id = clean(body.signalId, 80);
  const resolution = clean(body.resolution, 600);
  if (resolution.length < 12) return Response.json({ error: "Нужно проверяемое основание закрытия" }, { status: 400 });
  const db = getDb();
  const [signal] = await db.select().from(legalChecks).where(eq(legalChecks.id, id)).limit(1);
  if (!signal) return Response.json({ error: "Сигнал не найден" }, { status: 404 });
  if (signal.status === "Закрыт") return Response.json({ signal, reused: true });
  const [row] = await db.update(legalChecks).set({ status: "Закрыт", resolution, resolvedAt: new Date().toISOString() }).where(eq(legalChecks.id, id)).returning();
  await audit(actor, "legal.signal_resolved", "legal_check", id, { resolution });
  return Response.json({ signal: row });
}

function isDemoReference(value: string) { return /(^|[-_])(T|TEST)([-_]|$)|SYNTHETIC/i.test(value); }
function dateAfterDays(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) { await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) }); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
