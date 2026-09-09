import type { SectionReadScope } from "./section-read-scope";
import type {
  procurementSuppliers, purchaseRequests, supplierOffers, purchaseOrders, procurementDeliveries,
  inventoryItems, inventoryEvents, assets, assetMaintenance, tasks,
  foodProducts, foodBatches, foodRecipes, foodRecipeIngredients, foodProduction, foodShipments, foodShifts, foodChecks,
} from "../db/schema";

type EntityName = { id: string; displayName: string };
function visibleEntityNames(rows: EntityName[], scope: SectionReadScope, ids: ReadonlySet<string>) {
  const visible = rows.filter((row) => ids.has(row.id));
  // A branch ID is a first-class reference; its label comes from the branch catalogue.
  for (const branch of scope.branches) if (ids.has(branch.id)) visible.push({ id: branch.id, displayName: branch.name });
  return [...new Map(visible.map((row) => [row.id, row])).values()];
}
type ProcurementRows = {
  suppliers: Array<typeof procurementSuppliers.$inferSelect>;
  requests: Array<typeof purchaseRequests.$inferSelect>;
  offers: Array<typeof supplierOffers.$inferSelect>;
  orders: Array<typeof purchaseOrders.$inferSelect>;
  deliveries: Array<typeof procurementDeliveries.$inferSelect>;
  items: Array<typeof inventoryItems.$inferSelect>;
  events: Array<typeof inventoryEvents.$inferSelect>;
  assetRows: Array<typeof assets.$inferSelect>;
  maintenance: Array<typeof assetMaintenance.$inferSelect>;
  entityRows: EntityName[];
  allTasks: Array<typeof tasks.$inferSelect>;
};

/** Only established IDs/FKs and an unambiguous branch unit are authority. */
export function scopeProcurementRows(input: ProcurementRows, scope: SectionReadScope): ProcurementRows {
  const requests = input.requests.filter((row) => scope.allowsBranch(row.unit));
  const requestIds = new Set(requests.map((row) => row.id));
  const offers = input.offers.filter((row) => requestIds.has(row.requestId));
  const orders = input.orders.filter((row) => requestIds.has(row.requestId)
    && (!row.offerId || offers.some((offer) => offer.id === row.offerId && offer.requestId === row.requestId)));
  const orderIds = new Set(orders.map((row) => row.id));
  const deliveries = input.deliveries.filter((row) => orderIds.has(row.orderId));
  const supplierIds = new Set([...offers, ...orders].map((row) => row.supplierId));
  const suppliers = input.suppliers.filter((row) => supplierIds.has(row.id));
  const assetRows = input.assetRows.filter((row) => scope.branchIds.has(row.objectEntityId));
  const assetIds = new Set(assetRows.map((row) => row.id));
  const maintenance = input.maintenance.filter((row) => assetIds.has(row.assetId));
  // A referenced SKU does not prove where the remaining stock is held.
  const items = input.items.filter((row) => scope.allowsBranch(row.warehouse));
  const itemIds = new Set(items.map((row) => row.id));
  const events = input.events.filter((row) => itemIds.has(row.itemId)
    && (!row.fromLocation || scope.allowsBranch(row.fromLocation))
    && (!row.toLocation || scope.allowsBranch(row.toLocation)));
  const visibleTaskIds = new Set(maintenance.map((row) => row.relatedTaskId).filter((id) => id !== null));
  const allTasks = input.allTasks.filter((row) => visibleTaskIds.has(row.id));
  const names = new Set([
    ...requests.flatMap((row) => [row.requesterEntityId, row.approverEntityId]),
    ...suppliers.map((row) => row.entityId),
    ...assetRows.flatMap((row) => [row.objectEntityId, row.assignedToEntityId]),
    ...maintenance.map((row) => row.contractorId),
  ].filter(Boolean));
  return {
    suppliers, requests, offers, orders, deliveries,
    items: items.map((row) => ({ ...row, assetId: assetIds.has(row.assetId) ? row.assetId : "" })),
    events,
    assetRows: assetRows.map((row) => ({ ...row, itemId: itemIds.has(row.itemId) ? row.itemId : "" })),
    maintenance, allTasks, entityRows: visibleEntityNames(input.entityRows, scope, names),
  };
}

type FoodRows = {
  products: Array<typeof foodProducts.$inferSelect>;
  batches: Array<typeof foodBatches.$inferSelect>;
  recipes: Array<typeof foodRecipes.$inferSelect>;
  ingredients: Array<typeof foodRecipeIngredients.$inferSelect>;
  production: Array<typeof foodProduction.$inferSelect>;
  shipments: Array<typeof foodShipments.$inferSelect>;
  shifts: Array<typeof foodShifts.$inferSelect>;
  checks: Array<typeof foodChecks.$inferSelect>;
  entityRows: EntityName[];
  allTasks: Array<typeof tasks.$inferSelect>;
};

export function scopeFoodRows(input: FoodRows, scope: SectionReadScope, purchaseRows: readonly { id: string; unit: string }[]) {
  const shipments = input.shipments.filter((row) => scope.branchIds.has(row.destinationObjectId));
  const shipmentIds = new Set(shipments.map((row) => row.id));
  const production = input.production.filter((row) => {
    const destinations = input.shipments.filter((shipment) => shipment.productionId === row.id);
    return destinations.length > 0 && destinations.every((shipment) => shipmentIds.has(shipment.id));
  });
  const productionIds = new Set(production.map((row) => row.id));
  const shifts = input.shifts.filter((row) => {
    const related = input.production.filter((batch) => batch.shiftId === row.id);
    return related.length > 0 && related.every((batch) => productionIds.has(batch.id));
  });
  const shiftIds = new Set(shifts.map((row) => row.id));
  const recipeIds = new Set(production.map((row) => row.recipeId));
  const recipes = input.recipes.filter((row) => recipeIds.has(row.id));
  const ingredients = input.ingredients.filter((row) => recipeIds.has(row.recipeId));
  const requestIds = new Set(purchaseRows.filter((row) => scope.allowsBranch(row.unit)).map((row) => row.id));
  const batches = input.batches.filter((row) => requestIds.has(row.purchaseRequestId) && scope.allowsBranch(row.warehouse));
  const productIds = new Set([...ingredients, ...batches].map((row) => row.productId));
  const products = input.products.filter((row) => productIds.has(row.id));
  const checks = input.checks.filter((row) => scope.branchIds.has(row.objectEntityId));
  const visibleTaskIds = new Set(checks.map((row) => row.relatedTaskId).filter((id) => id !== null));
  const allTasks = input.allTasks.filter((row) => visibleTaskIds.has(row.id));
  const names = new Set([
    ...shipments.map((row) => row.destinationObjectId), ...shifts.map((row) => row.employeeEntityId),
    ...checks.map((row) => row.objectEntityId),
  ].filter(Boolean));
  // A shared production run or shift must not turn a hidden cost into a zero cost.
  const economicsComplete = shipments.every((row) => productionIds.has(row.productionId))
    && production.every((row) => Boolean(row.shiftId) && shiftIds.has(row.shiftId));
  return {
    products, batches, recipes, ingredients,
    production: production.map((row) => ({ ...row, shiftId: shiftIds.has(row.shiftId) ? row.shiftId : "" })),
    shipments: shipments.map((row) => ({ ...row, productionId: productionIds.has(row.productionId) ? row.productionId : "" })),
    shifts, checks, allTasks, entityRows: visibleEntityNames(input.entityRows, scope, names), economicsComplete,
  };
}
