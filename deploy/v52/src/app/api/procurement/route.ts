import { canAccessApi } from "../../../lib/access-policy";
import { asc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import {
  assetMaintenance, assets, entities, financialOperations, inventoryEvents, inventoryItems,
  procurementDeliveries, procurementSuppliers, purchaseOrders, purchaseRequests, supplierOffers,
  organizationBranches, userBranchAccess,
} from "../../../db/schema";
import { offerScore, warrantyState } from "../../../lib/procurement";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";
import { assignedActiveBranchScope, requiresAssignedReadScope } from "../../../lib/section-read-scope";
import { scopeProcurementRows } from "../../../lib/scoped-operational-reads";

export async function GET(request: Request) {
  let context;
  try { context = await getAuthenticatedRequestContext(request); }
  catch { return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 }); }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!canAccessApi(context.auth.user, "/api/procurement", "GET")) return Response.json({ error: "Нет доступа к закупкам и имуществу" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const assignedRead = requiresAssignedReadScope(context.auth.user, "/api/procurement");
    const scope = assignedRead ? assignedActiveBranchScope(context.auth.user,
      await db.select().from(organizationBranches),
      await db.select({ branchId: userBranchAccess.branchId }).from(userBranchAccess).where(eq(userBranchAccess.userId, context.appUserId)),
    ) : null;
    const [allSuppliers, allRequests, allOffers, allOrders, allDeliveries, allItems, allEvents, allAssets, allMaintenance, allEntityRows, operations, taskRows] = await Promise.all([
      db.select().from(procurementSuppliers), db.select().from(purchaseRequests), db.select().from(supplierOffers),
      db.select().from(purchaseOrders), db.select().from(procurementDeliveries), db.select().from(inventoryItems),
      db.select().from(inventoryEvents).orderBy(asc(inventoryEvents.occurredAt)), db.select().from(assets),
      db.select().from(assetMaintenance), db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      // A section checkbox is not legal-entity authority to read financial operations.
      assignedRead ? Promise.resolve([]) : db.select().from(financialOperations), selectVisibleTasks(db, context),
    ]);
    const input = { suppliers: allSuppliers, requests: allRequests, offers: allOffers, orders: allOrders, deliveries: allDeliveries,
      items: allItems, events: allEvents, assetRows: allAssets, maintenance: allMaintenance, entityRows: allEntityRows, allTasks: taskRows };
    const { suppliers, requests, offers, orders, deliveries, items, events, assetRows, maintenance, entityRows, allTasks } = scope ? scopeProcurementRows(input, scope) : input;
    const minPrice = offers.length ? Math.min(...offers.map((row) => row.priceMinor)) : 0;
    const payment = operations.find((operation) => orders.some((order) => "paymentOperationId" in order && order.paymentOperationId === operation.id));
    return Response.json({
      suppliers, requests, offers: offers.map((row) => ({ ...row, score: offerScore(row, minPrice) })).sort((a, b) => b.score - a.score),
      orders, deliveries, items, events,
      assets: assetRows.map((row) => ({ ...row, warrantyState: warrantyState(row.warrantyUntil, new Date().toISOString().slice(0, 10)) })),
      maintenance: redactHiddenTaskReferences(maintenance, allTasks), entityNames: Object.fromEntries(entityRows.map((row) => [row.id, row.displayName])), payment,
      tasks: allTasks.filter((row) => row.sourceType === "Обслуживание имущества"),
      summary: { requests: requests.length, offers: offers.length, stockUnits: items.reduce((sum, row) => sum + row.quantity, 0), assets: assetRows.length, serviceDue: maintenance.filter((row) => row.status !== "Завершено").length },
      chain: { requestId: requests[0]?.id ?? "", approvalId: requests[0]?.approverEntityId ?? "", offerId: offers[0]?.id ?? "", supplierId: suppliers[0]?.id ?? "", orderId: orders[0]?.id ?? "", deliveryId: deliveries[0]?.id ?? "", itemId: items[0]?.id ?? "", assetId: assetRows[0]?.id ?? "", documentId: deliveries[0] && "actDocumentId" in deliveries[0] ? deliveries[0].actDocumentId : "", paymentId: payment?.id ?? "" },
      boundary: scope ? "Показаны записи с подтверждённой принадлежностью к назначенным активным филиалам. Финансовые операции и записи без однозначной привязки не включены."
        : "Внешний рынок и учётная система ещё не подключены. Показываются только сохранённые заявки, предложения, поставки и связанные финансовые операции.",
    });
  } catch (error) { return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "База закупок ещё не подключена" : "Не удалось загрузить закупки" }, { status: 503 }); }
}
