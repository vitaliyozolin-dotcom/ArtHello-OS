import { canAccessApi } from "../../../lib/access-policy";
import { asc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { entities, financialOperations, foodBatches, foodChecks, foodProduction, foodProducts, foodRecipeIngredients, foodRecipes, foodShipments, foodShifts, purchaseRequests, organizationBranches, userBranchAccess } from "../../../db/schema";
import { assignedActiveBranchScope, requiresAssignedReadScope } from "../../../lib/section-read-scope";
import { scopeFoodRows } from "../../../lib/scoped-operational-reads";
import { expiryBand, foodEconomics, shipmentBalance } from "../../../lib/food";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";


export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!canAccessApi(context.auth.user, "/api/food", "GET")) return Response.json({ error: "Нет доступа к проекту кухни" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const assignedRead = requiresAssignedReadScope(context.auth.user, "/api/food");
    const scope = assignedRead ? assignedActiveBranchScope(context.auth.user,
      await db.select().from(organizationBranches),
      await db.select({ branchId: userBranchAccess.branchId }).from(userBranchAccess).where(eq(userBranchAccess.userId, context.appUserId)),
    ) : null;
    const [allProducts, allBatches, allRecipes, allIngredients, allProduction, allShipments, allShifts, allChecks, allEntityRows, operations, taskRows, purchaseRows] = await Promise.all([
      db.select().from(foodProducts),
      db.select().from(foodBatches).orderBy(asc(foodBatches.expiresAt)),
      db.select().from(foodRecipes),
      db.select().from(foodRecipeIngredients),
      db.select().from(foodProduction),
      db.select().from(foodShipments),
      db.select().from(foodShifts),
      db.select().from(foodChecks),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      assignedRead ? Promise.resolve([]) : db.select().from(financialOperations),
      selectVisibleTasks(db, context),
      assignedRead ? db.select({ id: purchaseRequests.id, unit: purchaseRequests.unit }).from(purchaseRequests) : Promise.resolve([]),
    ]);
    const input = { products: allProducts, batches: allBatches, recipes: allRecipes, ingredients: allIngredients,
      production: allProduction, shipments: allShipments, shifts: allShifts, checks: allChecks, entityRows: allEntityRows, allTasks: taskRows };
    const scoped = scope ? scopeFoodRows(input, scope, purchaseRows) : { ...input, economicsComplete: true };
    const { products, batches, recipes, ingredients, production, shipments, shifts, checks, entityRows, allTasks } = scoped;
    const revenue = shipments.reduce((sum, item) => sum + item.revenueMinor, 0);
    const material = production.reduce((sum, item) => sum + item.materialCostMinor, 0);
    const labor = shifts.reduce((sum, item) => sum + item.rateMinor, 0);
    const shipment = shipments[0];
    const productionItem = (shipment ? production.find((item) => item.id === shipment.productionId) : undefined) ?? production[0];
    const recipe = (productionItem ? recipes.find((item) => item.id === productionItem.recipeId) : undefined) ?? recipes[0];
    const recipeProductIds = new Set(ingredients.filter((item) => item.recipeId === recipe?.id).map((item) => item.productId));
    const batch = batches.find((item) => recipeProductIds.has(item.productId)) ?? batches[0];
    const projectIds = new Set(products.map((item) => item.projectEntityId).filter(Boolean));
    const finance = operations.filter((item) => projectIds.has(item.projectEntityId));
    const cost = finance.find((item) => item.direction === "Списание");
    const income = finance.find((item) => item.direction === "Поступление");
    const today = new Date().toISOString().slice(0, 10);

    return Response.json({
      products,
      batches: batches.map((item) => ({ ...item, expiryBand: expiryBand(item.expiresAt, today) })),
      recipes,
      ingredients,
      production,
      shipments: shipments.map((item) => ({ ...item, balance: shipmentBalance(item) })),
      shifts,
      checks: redactHiddenTaskReferences(checks, allTasks),
      entityNames: Object.fromEntries(entityRows.map((item) => [item.id, item.displayName])),
      economics: scoped.economicsComplete ? foodEconomics(revenue, material, labor)
        : { revenueMinor: revenue, materialMinor: null, laborMinor: null, profitMinor: null, marginPercent: null },
      finance,
      tasks: allTasks.filter((item) => item.sourceType === "Проверка кухни"),
      summary: {
        products: products.length,
        batches: batches.length,
        urgentBatches: batches.filter((item) => expiryBand(item.expiresAt, today) === "Срочно").length,
        planned: production.reduce((sum, item) => sum + item.plannedPortions, 0),
        actual: production.reduce((sum, item) => sum + item.actualPortions, 0),
        consumed: shipments.reduce((sum, item) => sum + item.consumedPortions, 0),
        waste: shipments.reduce((sum, item) => sum + item.writtenOffPortions, 0),
      },
      chain: {
        purchaseId: batch?.purchaseRequestId ?? "",
        batchId: batch?.id ?? "",
        recipeId: recipe?.id ?? "",
        productionId: productionItem?.id ?? "",
        shipmentId: shipment?.id ?? "",
        costId: cost?.id ?? "",
        revenueId: income?.id ?? "",
      },
      boundary: scope ? "Показаны записи назначенных активных филиалов. Общие производственные партии и смены раскрываются только при подтверждённом доступе ко всем связанным отгрузкам; неполная себестоимость не превращается в нулевую." : "Поставщики, партии, производство и финансовые операции показываются только после сохранения или подтверждённого импорта.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "База кухни ещё не подключена" : "Не удалось загрузить кухню" }, { status: 503 });
  }
}
