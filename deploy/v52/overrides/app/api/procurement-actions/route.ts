import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { assetMaintenance, auditEvents, entities, inventoryEvents, inventoryItems, procurementDeliveries, procurementSuppliers, purchaseOrders, purchaseRequests, supplierOffers, tasks } from "../../../db/schema";
import { stockAfter } from "../../../lib/procurement";
import { getRequestUser } from "../../../lib/request-user";

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "PROCUREMENT"]);
const leaders = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE"]);

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!editors.has(role)) return Response.json({ error: "Нет прав на действие закупки" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "createRequest") return createRequest(actor, body);
    if (action === "approveRequest") return approve(actor, role, body);
    if (action === "selectOffer") return selectOffer(actor, body);
    if (action === "receiveDelivery") return receive(actor, body);
    if (action === "inventoryEvent") return inventory(actor, body);
    if (action === "createMaintenanceTask") return maintenanceTask(actor, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function createRequest(actor: string, body: Record<string, unknown>) {
  const requesterEntityId = clean(body.requesterEntityId, 80);
  const itemName = clean(body.itemName, 160);
  const unit = clean(body.unit, 120);
  const justification = clean(body.justification, 400);
  const needBy = clean(body.needBy, 10) || dateAfterDays(21);
  const quantity = Number(body.quantity);
  const budgetMinor = Number(body.budgetMinor);
  if (!requesterEntityId || isDemoReference(requesterEntityId)) return Response.json({ error: "Выберите реального заявителя из справочника сотрудников" }, { status: 400 });
  if (itemName.length < 4 || !unit || justification.length < 8 || !Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(budgetMinor) || budgetMinor <= 0 || !isDate(needBy)) {
    return Response.json({ error: "Заполните предмет, подразделение, количество, бюджет, срок и обоснование" }, { status: 400 });
  }
  const db = getDb();
  if (!(await entityExists(requesterEntityId))) return Response.json({ error: "Заявитель не найден в справочнике" }, { status: 404 });
  const id = `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(purchaseRequests).values({ id, requesterEntityId, unit, itemName, quantity, budgetMinor, needBy, status: "На согласовании", justification }).returning();
  await audit(actor, "procurement.request_created", "purchase_request", id, { quantity, budgetMinor, requesterEntityId });
  return Response.json({ request: row }, { status: 201 });
}

async function approve(actor: string, role: string, body: Record<string, unknown>) {
  if (!leaders.has(role)) return Response.json({ error: "Заявку согласует руководитель" }, { status: 403 });
  const id = clean(body.requestId, 80);
  const approverEntityId = clean(body.approverEntityId, 80);
  if (!approverEntityId || isDemoReference(approverEntityId)) return Response.json({ error: "Выберите реального согласующего из справочника сотрудников" }, { status: 400 });
  const db = getDb();
  const [row] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, id)).limit(1);
  if (!row) return Response.json({ error: "Заявка не найдена" }, { status: 404 });
  if (!(await entityExists(approverEntityId))) return Response.json({ error: "Согласующий не найден в справочнике" }, { status: 404 });
  if (row.status === "Согласована") return Response.json({ request: row, reused: true });
  const approvedAt = new Date().toISOString();
  const [updated] = await db.update(purchaseRequests).set({ status: "Согласована", approverEntityId, approvedAt, updatedAt: approvedAt }).where(eq(purchaseRequests.id, id)).returning();
  await audit(actor, "procurement.request_approved", "purchase_request", id, { budgetMinor: row.budgetMinor, approverEntityId });
  return Response.json({ request: updated });
}

async function selectOffer(actor: string, body: Record<string, unknown>) {
  const requestId = clean(body.requestId, 80);
  const offerId = clean(body.offerId, 80);
  const db = getDb();
  const [request] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, requestId)).limit(1);
  const [offer] = await db.select().from(supplierOffers).where(eq(supplierOffers.id, offerId)).limit(1);
  if (!request || !offer) return Response.json({ error: "Заявка или предложение не найдены" }, { status: 404 });
  if (request.status !== "Согласована") return Response.json({ error: "Сначала нужно согласование" }, { status: 409 });
  const [supplier] = await db.select().from(procurementSuppliers).where(eq(procurementSuppliers.id, offer.supplierId)).limit(1);
  if (!supplier?.contractId || isDemoReference(supplier.contractId)) return Response.json({ error: "У поставщика нет действующего рабочего договора" }, { status: 409 });
  const existingId = `ORD-${requestId.replace("REQ-", "")}`;
  const [existing] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, existingId)).limit(1);
  if (existing) return Response.json({ order: existing, reused: true });
  const orderedAt = new Date();
  const expectedAt = new Date(orderedAt);
  expectedAt.setUTCDate(expectedAt.getUTCDate() + Math.max(1, offer.deliveryDays));
  const [order] = await db.insert(purchaseOrders).values({
    id: existingId,
    requestId,
    offerId,
    supplierId: offer.supplierId,
    orderNumber: `PO-${orderedAt.getUTCFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    amountMinor: offer.priceMinor,
    status: "Заказан",
    orderedAt: orderedAt.toISOString(),
    expectedAt: expectedAt.toISOString().slice(0, 10),
    contractId: supplier.contractId,
  }).returning();
  await db.update(supplierOffers).set({ status: "Выбрано" }).where(eq(supplierOffers.id, offerId));
  await audit(actor, "procurement.offer_selected", "purchase_order", order.id, { requestId, offerId });
  return Response.json({ order }, { status: 201 });
}

async function receive(actor: string, body: Record<string, unknown>) {
  const deliveryId = clean(body.deliveryId, 80);
  const qualityNote = clean(body.qualityNote, 400);
  const db = getDb();
  if (qualityNote.length < 8) return Response.json({ error: "Укажите результат приёмки" }, { status: 400 });
  const [row] = await db.select().from(procurementDeliveries).where(eq(procurementDeliveries.id, deliveryId)).limit(1);
  if (!row) return Response.json({ error: "Поставка не найдена" }, { status: 404 });
  if (row.status === "Принято") return Response.json({ delivery: row, reused: true });
  const [updated] = await db.update(procurementDeliveries).set({ status: "Принято", acceptedQuantity: row.quantity, acceptedBy: actor, qualityNote, deliveredAt: new Date().toISOString() }).where(eq(procurementDeliveries.id, deliveryId)).returning();
  await audit(actor, "procurement.delivery_accepted", "delivery", deliveryId, { quantity: row.quantity, qualityNote });
  return Response.json({ delivery: updated });
}

async function inventory(actor: string, body: Record<string, unknown>) {
  const itemId = clean(body.itemId, 80);
  const eventType = clean(body.eventType, 30);
  const quantity = Number(body.quantity);
  const toLocation = clean(body.toLocation, 120);
  const documentId = clean(body.documentId, 80);
  const db = getDb();
  if (!['Приёмка', 'Выдача', 'Перемещение', 'Списание', 'Инвентаризация'].includes(eventType) || !Number.isInteger(quantity) || quantity <= 0) return Response.json({ error: "Некорректное складское событие" }, { status: 400 });
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).limit(1);
  if (!item) return Response.json({ error: "Номенклатура не найдена" }, { status: 404 });
  let next: number;
  try { next = stockAfter(item.quantity, eventType, quantity); } catch { return Response.json({ error: "Недостаточно остатка" }, { status: 409 }); }
  const id = `INV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [event] = await db.insert(inventoryEvents).values({ id, itemId, eventType, quantity, fromLocation: item.warehouse, toLocation, documentId, occurredAt: new Date().toISOString(), actor }).returning();
  await db.update(inventoryItems).set({ quantity: next, warehouse: eventType === "Перемещение" && toLocation ? toLocation : item.warehouse, updatedAt: new Date().toISOString() }).where(eq(inventoryItems.id, itemId));
  return Response.json({ event, quantity: next }, { status: 201 });
}

async function maintenanceTask(actor: string, body: Record<string, unknown>) {
  const id = clean(body.maintenanceId, 80);
  const assigneeEntityId = clean(body.assigneeEntityId, 80);
  const db = getDb();
  const key = `ASSET_MAINT:${id}`;
  const [row] = await db.select().from(assetMaintenance).where(eq(assetMaintenance.id, id)).limit(1);
  if (!row) return Response.json({ error: "Обслуживание не найдено" }, { status: 404 });
  if (assigneeEntityId && (isDemoReference(assigneeEntityId) || !(await entityExists(assigneeEntityId)))) return Response.json({ error: "Исполнитель не найден в рабочем справочнике" }, { status: 400 });
  const [existing] = await db.select().from(tasks).where(eq(tasks.automationKey, key)).limit(1);
  if (existing) return Response.json({ task: existing, reused: true });
  const [task] = await db.insert(tasks).values({ title: `${row.maintenanceType} · ${row.assetId}`, owner: actor, dueDate: row.scheduledAt, priority: "Средний", status: "Входящие", sourceType: "Обслуживание имущества", sourceId: id, description: "Проверить гарантию, подрядчика, результат и закрывающий документ", assigneeEntityId, kind: "Автозадача", automationKey: key, requiresApproval: false, createdBy: actor }).returning();
  await db.update(assetMaintenance).set({ relatedTaskId: task.id, status: "Задача создана" }).where(eq(assetMaintenance.id, id));
  return Response.json({ task }, { status: 201 });
}

async function entityExists(id: string) {
  const [entity] = await getDb().select({ id: entities.id }).from(entities).where(eq(entities.id, id)).limit(1);
  return Boolean(entity);
}

function isDemoReference(value: string) { return /(^|[-_])(T|TEST)([-_]|$)|SYNTHETIC/i.test(value); }
function isDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()); }
function dateAfterDays(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) { await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) }); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
