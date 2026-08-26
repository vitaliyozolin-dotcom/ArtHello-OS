import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, safetyChecks, safetyEquipment, safetyFaults, safetyIncidents, safetyNextChecks, safetyRepairs, safetySystems, tasks } from "../../../db/schema";
import { nextSafetyCheck } from "../../../lib/safety";
import { getRequestUser } from "../../../lib/request-user";

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "SAFETY"]);

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!editors.has(role)) return Response.json({ error: "Нет прав на действие безопасности" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "createFaultTask") return faultTask(actor, body);
    if (action === "completeRepair") return completeRepair(actor, body);
    if (action === "recordIncident") return incident(actor, body);
    if (action === "scheduleCheck") return scheduleCheck(actor, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function faultTask(actor: string, body: Record<string, unknown>) {
  const id = clean(body.faultId, 80);
  const assigneeEntityId = clean(body.assigneeEntityId, 80);
  const db = getDb();
  const key = `SAFETY_FAULT:${id}`;
  const [fault] = await db.select().from(safetyFaults).where(eq(safetyFaults.id, id)).limit(1);
  if (!fault) return Response.json({ error: "Неисправность не найдена" }, { status: 404 });
  if (assigneeEntityId && !(await isWorkingEntity(assigneeEntityId))) return Response.json({ error: "Исполнитель не найден в рабочем справочнике" }, { status: 400 });
  const [existing] = await db.select().from(tasks).where(eq(tasks.automationKey, key)).limit(1);
  if (existing) return Response.json({ task: existing, reused: true });
  const dueDate = dateAfterDays(fault.severity === "Критичный" ? 1 : 3);
  const [task] = await db.insert(tasks).values({ title: `Устранить неисправность · ${fault.equipmentId}`, owner: actor, dueDate, priority: fault.severity, status: "Входящие", sourceType: "Неисправность безопасности", sourceId: id, description: fault.description, assigneeEntityId, kind: "Автозадача", automationKey: key, requiresApproval: true, createdBy: actor }).returning();
  await db.update(safetyFaults).set({ relatedTaskId: task.id, status: "В работе" }).where(eq(safetyFaults.id, id));
  await audit(actor, "safety.fault_task_created", "safety_fault", id, { taskId: task.id, assigneeEntityId });
  return Response.json({ task }, { status: 201 });
}

async function completeRepair(actor: string, body: Record<string, unknown>) {
  const id = clean(body.repairId, 80);
  const result = clean(body.result, 400);
  const act = clean(body.actDocumentId, 100);
  const db = getDb();
  if (result.length < 8 || act.length < 5 || isDemoReference(act)) return Response.json({ error: "Для завершения нужны результат и рабочий акт" }, { status: 400 });
  const [row] = await db.select().from(safetyRepairs).where(eq(safetyRepairs.id, id)).limit(1);
  if (!row) return Response.json({ error: "Ремонт не найден" }, { status: 404 });
  if (row.status === "Завершён") return Response.json({ repair: row, reused: true });
  const completedAt = new Date().toISOString();
  const scheduledAt = nextSafetyCheck(completedAt, 30);
  const [fault] = await db.select().from(safetyFaults).where(eq(safetyFaults.id, row.faultId)).limit(1);
  if (!fault) return Response.json({ error: "Связанная неисправность не найдена" }, { status: 409 });
  const [equipment] = await db.select().from(safetyEquipment).where(eq(safetyEquipment.id, fault.equipmentId)).limit(1);
  const [system] = equipment ? await db.select().from(safetySystems).where(eq(safetySystems.id, equipment.systemId)).limit(1) : [];
  const responsibleEntityId = clean(body.responsibleEntityId, 80) || system?.responsibleEntityId || "";
  if (!(await isWorkingEntity(responsibleEntityId))) return Response.json({ error: "Назначьте реального ответственного за следующую проверку" }, { status: 400 });
  const [updated] = await db.update(safetyRepairs).set({ completedAt, result, actDocumentId: act, status: "Завершён" }).where(eq(safetyRepairs.id, id)).returning();
  await db.update(safetyFaults).set({ status: "Устранена" }).where(eq(safetyFaults.id, fault.id));
  await db.update(safetyEquipment).set({ status: "Работает", nextCheckAt: scheduledAt }).where(eq(safetyEquipment.id, fault.equipmentId));
  await db.insert(safetyNextChecks).values({ id: `SAFE-NEXT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, equipmentId: fault.equipmentId, sourceRepairId: id, scheduledAt, checkType: "После ремонта", responsibleEntityId, status: "Запланирована" });
  await audit(actor, "safety.repair_completed", "safety_repair", id, { result, act, scheduledAt, responsibleEntityId });
  return Response.json({ repair: updated, scheduledAt });
}

async function incident(actor: string, body: Record<string, unknown>) {
  const description = clean(body.description, 500);
  const systemId = clean(body.systemId, 80);
  const objectId = clean(body.objectEntityId, 80);
  const category = clean(body.category, 80) || "Наблюдение";
  const severity = clean(body.severity, 30) || "Средняя";
  if (description.length < 8 || !systemId || !objectId || isDemoReference(systemId) || isDemoReference(objectId)) return Response.json({ error: "Выберите рабочую систему, объект и укажите описание" }, { status: 400 });
  const db = getDb();
  const [system] = await db.select().from(safetySystems).where(eq(safetySystems.id, systemId)).limit(1);
  if (!system || system.objectEntityId !== objectId) return Response.json({ error: "Система не связана с выбранным объектом" }, { status: 409 });
  const id = `SAFE-INC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(safetyIncidents).values({ id, objectEntityId: objectId, systemId, happenedAt: new Date().toISOString(), category, severity, description, response: "Назначена первичная проверка", status: "Открыт" }).returning();
  await audit(actor, "safety.incident_recorded", "safety_incident", id, { systemId, objectId, severity });
  return Response.json({ incident: row }, { status: 201 });
}

async function scheduleCheck(actor: string, body: Record<string, unknown>) {
  const equipmentId = clean(body.equipmentId, 80);
  const scheduledAt = clean(body.scheduledAt, 10);
  if (!isDate(scheduledAt)) return Response.json({ error: "Укажите дату проверки" }, { status: 400 });
  const db = getDb();
  const [equipment] = await db.select().from(safetyEquipment).where(eq(safetyEquipment.id, equipmentId)).limit(1);
  if (!equipment) return Response.json({ error: "Оборудование не найдено" }, { status: 404 });
  const [system] = await db.select().from(safetySystems).where(eq(safetySystems.id, equipment.systemId)).limit(1);
  const objectEntityId = clean(body.objectEntityId, 80) || system?.objectEntityId || "";
  const responsibleEntityId = clean(body.responsibleEntityId, 80) || system?.responsibleEntityId || "";
  if (!system || isDemoReference(system.id) || !(await isWorkingEntity(objectEntityId)) || !(await isWorkingEntity(responsibleEntityId))) return Response.json({ error: "Для проверки нужны рабочий объект и ответственный из справочника" }, { status: 400 });
  const id = `SAFE-CHK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(safetyChecks).values({ id, equipmentId, objectEntityId, checkType: "Внеплановая", scheduledAt, result: "Ожидает", evidence: "Назначено вручную", responsibleEntityId, status: "Запланирована" }).returning();
  await audit(actor, "safety.check_scheduled", "safety_check", id, { equipmentId, scheduledAt, objectEntityId, responsibleEntityId });
  return Response.json({ check: row }, { status: 201 });
}

async function isWorkingEntity(id: string) {
  if (!id || isDemoReference(id)) return false;
  const [entity] = await getDb().select({ id: entities.id }).from(entities).where(eq(entities.id, id)).limit(1);
  return Boolean(entity);
}

function isDemoReference(value: string) { return /(^|[-_])(T|TEST)([-_]|$)|SYNTHETIC/i.test(value); }
function isDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()); }
function dateAfterDays(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) { await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) }); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
