import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Run from the assembled application root. These fixtures intentionally contain
// allowed, foreign, ambiguous and orphan records in the same database result.
const root = process.cwd();
const { scopeProcurementRows, scopeFoodRows } = await import(pathToFileURL(resolve(root, "lib/scoped-operational-reads.ts")));
const { assignedActiveBranchScope } = await import(pathToFileURL(resolve(root, "lib/section-read-scope.ts")));
const branches = [
  { id: "BR-A", name: "Школа А", status: "Активен" },
  { id: "BR-B", name: "Школа Б", status: "Активен" },
  { id: "BR-OLD", name: "Закрытый филиал", status: "Закрыт" },
  { id: "BR-DA", name: "Общее название", status: "Активен" },
  { id: "BR-DB", name: "Общее название", status: "Активен" },
];
const scope = (ids = ["BR-A", "BR-DA", "BR-OLD"]) => assignedActiveBranchScope({}, branches, ids.map((branchId) => ({ branchId })));
const ids = (rows) => rows.map((row) => row.id).sort();
const procurementFixture = () => {
  const request = (id, unit) => ({ id, unit, requesterEntityId: `PERSON-${id}`, approverEntityId: "APPROVER-A" });
  const offer = (id, requestId, supplierId = "SUPPLIER-A") => ({ id, requestId, supplierId, priceMinor: 1000, deliveryDays: 2, warrantyMonths: 12, qualityScore: 80 });
  const order = (id, requestId, offerId, supplierId = "SUPPLIER-A") => ({ id, requestId, offerId, supplierId, paymentOperationId: "PAYMENT-A" });
  const asset = (id, objectEntityId, extra = {}) => ({ id, objectEntityId, assignedToEntityId: "CUSTODIAN-A", itemId: "ITEM-B", warrantyUntil: "2030-01-01", ...extra });
  return {
    requests: [request("REQ-A", "BR-A"), request("REQ-AN", "Школа А"), request("REQ-B", "BR-B"), request("REQ-DUP", "Общее название"), request("REQ-OLD", "BR-OLD"), request("REQ-ORPHAN", "Неизвестный филиал")],
    offers: [offer("OFFER-A", "REQ-A"), offer("OFFER-AN", "REQ-AN"), offer("OFFER-B", "REQ-B", "SUPPLIER-B"), offer("OFFER-ORPHAN", "MISSING-REQUEST")],
    orders: [order("ORDER-A", "REQ-A", "OFFER-A"), order("ORDER-AN", "REQ-AN", ""), order("ORDER-CROSS", "REQ-A", "OFFER-B"), order("ORDER-WRONG-REQUEST", "REQ-A", "OFFER-AN"), order("ORDER-B", "REQ-B", "OFFER-B", "SUPPLIER-B"), order("ORDER-ORPHAN", "MISSING-REQUEST", "")],
    deliveries: [{ id: "DELIVERY-A", orderId: "ORDER-A" }, { id: "DELIVERY-B", orderId: "ORDER-B" }, { id: "DELIVERY-CROSS", orderId: "ORDER-CROSS" }, { id: "DELIVERY-ORPHAN", orderId: "MISSING-ORDER" }],
    suppliers: [{ id: "SUPPLIER-A", entityId: "ENTITY-SUPPLIER-A" }, { id: "SUPPLIER-B", entityId: "ENTITY-SUPPLIER-B" }, { id: "SUPPLIER-ORPHAN", entityId: "ENTITY-SUPPLIER-ORPHAN" }],
    items: [{ id: "ITEM-A", warehouse: "BR-A", quantity: 4, assetId: "ASSET-B" }, { id: "ITEM-AN", warehouse: "Школа А", quantity: 2, assetId: "ASSET-A" }, { id: "ITEM-B", warehouse: "BR-B", quantity: 10000, assetId: "ASSET-A" }, { id: "ITEM-DUP", warehouse: "Общее название", quantity: 10000 }, { id: "ITEM-OLD", warehouse: "BR-OLD", quantity: 10000 }, { id: "ITEM-ORPHAN", warehouse: "", quantity: 10000 }],
    events: [{ id: "EVENT-A", itemId: "ITEM-A", fromLocation: "", toLocation: "BR-A" }, { id: "EVENT-AN", itemId: "ITEM-AN", fromLocation: "Школа А", toLocation: "" }, { id: "EVENT-FOREIGN-TO", itemId: "ITEM-A", toLocation: "BR-B" }, { id: "EVENT-FOREIGN-FROM", itemId: "ITEM-A", fromLocation: "BR-B" }, { id: "EVENT-B", itemId: "ITEM-B" }, { id: "EVENT-ORPHAN", itemId: "MISSING-ITEM" }],
    assetRows: [asset("ASSET-A", "BR-A"), asset("ASSET-B", "BR-B"), asset("ASSET-NAME", "Школа А"), asset("ASSET-GUESS", "MISSING-BRANCH", { branchId: "BR-A", metadata: { branchId: "BR-A" } }), asset("ASSET-OLD", "BR-OLD")],
    maintenance: [{ id: "SERVICE-A", assetId: "ASSET-A", contractorId: "CONTRACTOR-A", relatedTaskId: "TASK-A", status: "План" }, { id: "SERVICE-B", assetId: "ASSET-B", relatedTaskId: "TASK-B" }, { id: "SERVICE-ORPHAN", assetId: "MISSING-ASSET", relatedTaskId: "TASK-ORPHAN" }],
    entityRows: ["BR-A", "BR-B", "PERSON-REQ-A", "PERSON-REQ-AN", "PERSON-REQ-B", "APPROVER-A", "ENTITY-SUPPLIER-A", "ENTITY-SUPPLIER-B", "ENTITY-SUPPLIER-ORPHAN", "CUSTODIAN-A", "CONTRACTOR-A", "UNRELATED-SECRET"].map((id) => ({ id, displayName: `Name ${id}` })),
    allTasks: [{ id: "TASK-A", sourceType: "Обслуживание имущества" }, { id: "TASK-B", sourceType: "Обслуживание имущества" }, { id: "TASK-ORPHAN", sourceType: "Обслуживание имущества" }],
  };
};
const foodFixture = () => {
  const production = (id, recipeId, shiftId) => ({ id, recipeId, shiftId, plannedPortions: 10, actualPortions: 10, materialCostMinor: 100 });
  const shipment = (id, productionId, destinationObjectId) => ({ id, productionId, destinationObjectId, shippedPortions: 5, consumedPortions: 4, returnedPortions: 0, writtenOffPortions: 1, revenueMinor: 500 });
  const batch = (id, purchaseRequestId, warehouse, productId = "PRODUCT-A") => ({ id, purchaseRequestId, warehouse, productId, expiresAt: "2030-01-01" });
  return {
    products: ["PRODUCT-A", "PRODUCT-SHIFT-A", "PRODUCT-B", "PRODUCT-SHARED", "PRODUCT-ORPHAN"].map((id) => ({ id, projectEntityId: "PROJECT-FOOD" })),
    batches: [batch("BATCH-A", "REQ-A", "BR-A"), batch("BATCH-NAME", "REQ-NAME", "Школа А"), batch("BATCH-FOREIGN-STOCK", "REQ-A", "BR-B"), batch("BATCH-FOREIGN-REQUEST", "REQ-B", "BR-A"), batch("BATCH-DUP", "REQ-DUP", "Общее название"), batch("BATCH-ORPHAN", "MISSING-REQUEST", "BR-A")],
    recipes: ["RECIPE-A", "RECIPE-SHIFT-A", "RECIPE-B", "RECIPE-SHARED", "RECIPE-ORPHAN"].map((id) => ({ id })),
    ingredients: ["A", "SHIFT-A", "B", "SHARED", "ORPHAN"].map((suffix) => ({ id: `INGREDIENT-${suffix}`, recipeId: `RECIPE-${suffix}`, productId: `PRODUCT-${suffix}` })),
    production: [production("PRODUCTION-A", "RECIPE-A", "SHIFT-A"), production("PRODUCTION-SHIFT-A", "RECIPE-SHIFT-A", "SHIFT-MIXED"), production("PRODUCTION-B", "RECIPE-B", "SHIFT-MIXED"), production("PRODUCTION-SHARED", "RECIPE-SHARED", "SHIFT-SHARED"), production("PRODUCTION-ORPHAN", "RECIPE-ORPHAN", "SHIFT-ORPHAN")],
    shipments: [shipment("SHIPMENT-A", "PRODUCTION-A", "BR-A"), shipment("SHIPMENT-SHIFT-A", "PRODUCTION-SHIFT-A", "BR-A"), shipment("SHIPMENT-B", "PRODUCTION-B", "BR-B"), shipment("SHIPMENT-SHARED-A", "PRODUCTION-SHARED", "BR-A"), shipment("SHIPMENT-SHARED-B", "PRODUCTION-SHARED", "BR-B"), shipment("SHIPMENT-NAME", "PRODUCTION-A", "Школа А"), shipment("SHIPMENT-OLD", "PRODUCTION-A", "BR-OLD"), shipment("SHIPMENT-MISSING-PRODUCTION", "MISSING-PRODUCTION", "BR-A")],
    shifts: ["A", "MIXED", "SHARED", "ORPHAN"].map((suffix) => ({ id: `SHIFT-${suffix}`, employeeEntityId: `EMPLOYEE-${suffix}`, rateMinor: suffix === "A" ? 50 : 990000 })),
    checks: [{ id: "CHECK-A", objectEntityId: "BR-A", relatedTaskId: "TASK-CHECK-A" }, { id: "CHECK-B", objectEntityId: "BR-B", relatedTaskId: "TASK-CHECK-B" }, { id: "CHECK-NAME", objectEntityId: "Школа А", relatedTaskId: "TASK-CHECK-NAME" }, { id: "CHECK-ORPHAN", objectEntityId: "MISSING-BRANCH" }],
    entityRows: ["BR-A", "BR-B", "EMPLOYEE-A", "EMPLOYEE-MIXED", "EMPLOYEE-SHARED", "EMPLOYEE-ORPHAN", "UNRELATED-SECRET"].map((id) => ({ id, displayName: `Name ${id}` })),
    allTasks: [{ id: "TASK-CHECK-A", sourceType: "Проверка кухни" }, { id: "TASK-CHECK-B", sourceType: "Проверка кухни" }, { id: "TASK-CHECK-NAME", sourceType: "Проверка кухни" }],
  };
};
const foodPurchases = [{ id: "REQ-A", unit: "BR-A" }, { id: "REQ-NAME", unit: "Школа А" }, { id: "REQ-B", unit: "BR-B" }, { id: "REQ-DUP", unit: "Общее название" }];

test("procurement: only confirmed requests bring their valid supply chain; ambiguous, inactive and orphan rows disappear", () => {
  const output = scopeProcurementRows(procurementFixture(), scope());
  assert.deepEqual(ids(output.requests), ["REQ-A", "REQ-AN"]);
  assert.deepEqual(ids(output.offers), ["OFFER-A", "OFFER-AN"]);
  assert.deepEqual(ids(output.orders), ["ORDER-A", "ORDER-AN"]);
  assert.deepEqual(ids(output.deliveries), ["DELIVERY-A"]);
  assert.deepEqual(ids(output.suppliers), ["SUPPLIER-A"]);
});

test("procurement: warehouse owns stock, exact object ID owns assets, and foreign links or movements cannot extend scope", () => {
  const output = scopeProcurementRows(procurementFixture(), scope());
  assert.deepEqual(ids(output.items), ["ITEM-A", "ITEM-AN"]);
  assert.deepEqual(ids(output.events), ["EVENT-A", "EVENT-AN"]);
  assert.deepEqual(ids(output.assetRows), ["ASSET-A"]);
  assert.equal(output.items.find((row) => row.id === "ITEM-A").assetId, "");
  assert.equal(output.items.find((row) => row.id === "ITEM-AN").assetId, "ASSET-A");
  assert.equal(output.assetRows[0].itemId, "");
  assert.deepEqual(ids(output.maintenance), ["SERVICE-A"]);
  assert.deepEqual(ids(output.allTasks), ["TASK-A"]);
});

test("procurement: entity-name dictionary includes only entities referenced by retained records", () => {
  const output = scopeProcurementRows(procurementFixture(), scope());
  assert.deepEqual(ids(output.entityRows), ["APPROVER-A", "BR-A", "CONTRACTOR-A", "CUSTODIAN-A", "ENTITY-SUPPLIER-A", "PERSON-REQ-A", "PERSON-REQ-AN"]);
});

test("food: shared batches stay hidden, assigned shipments survive with blank hidden production references", () => {
  const input = foodFixture();
  // Separate malformed/foreign shipments on PRODUCTION-A are covered below.
  input.shipments = input.shipments.filter((row) => !["SHIPMENT-NAME", "SHIPMENT-OLD"].includes(row.id));
  const output = scopeFoodRows(input, scope(), foodPurchases);
  assert.deepEqual(ids(output.shipments), ["SHIPMENT-A", "SHIPMENT-MISSING-PRODUCTION", "SHIPMENT-SHARED-A", "SHIPMENT-SHIFT-A"]);
  assert.deepEqual(ids(output.production), ["PRODUCTION-A", "PRODUCTION-SHIFT-A"]);
  assert.equal(output.shipments.find((row) => row.id === "SHIPMENT-SHARED-A").productionId, "");
  assert.equal(output.shipments.find((row) => row.id === "SHIPMENT-MISSING-PRODUCTION").productionId, "");
  assert.deepEqual(ids(output.shifts), ["SHIFT-A"]);
  assert.equal(output.production.find((row) => row.id === "PRODUCTION-SHIFT-A").shiftId, "");
  assert.equal(output.economicsComplete, false);
});

test("food: exact destination IDs and checks reject name aliases; any unproven destination hides a shared production run", () => {
  const output = scopeFoodRows(foodFixture(), scope(), foodPurchases);
  assert.equal(output.production.some((row) => row.id === "PRODUCTION-A"), false);
  assert.equal(output.shipments.some((row) => ["SHIPMENT-NAME", "SHIPMENT-OLD", "SHIPMENT-B"].includes(row.id)), false);
  assert.deepEqual(ids(output.checks), ["CHECK-A"]);
  assert.deepEqual(ids(output.allTasks), ["TASK-CHECK-A"]);
  assert.deepEqual(ids(output.entityRows), ["BR-A"]);
});

test("food: stock requires both an assigned purchase and warehouse; recipes and products follow visible production", () => {
  const input = foodFixture();
  input.shipments = input.shipments.filter((row) => !["SHIPMENT-NAME", "SHIPMENT-OLD"].includes(row.id));
  const output = scopeFoodRows(input, scope(), foodPurchases);
  assert.deepEqual(ids(output.batches), ["BATCH-A", "BATCH-NAME"]);
  assert.deepEqual(ids(output.recipes), ["RECIPE-A", "RECIPE-SHIFT-A"]);
  assert.deepEqual(ids(output.ingredients), ["INGREDIENT-A", "INGREDIENT-SHIFT-A"]);
  assert.deepEqual(ids(output.products), ["PRODUCT-A", "PRODUCT-SHIFT-A"]);
  assert.deepEqual(ids(output.entityRows), ["BR-A", "EMPLOYEE-A"]);
});

test("food: fully attributed isolated production and shift keep calculable costs", () => {
  const input = foodFixture();
  input.shipments = input.shipments.filter((row) => row.id === "SHIPMENT-A");
  input.production = input.production.filter((row) => row.id === "PRODUCTION-A");
  const output = scopeFoodRows(input, scope(), foodPurchases);
  assert.equal(output.economicsComplete, true);
  assert.deepEqual(ids(output.production), ["PRODUCTION-A"]);
  assert.deepEqual(ids(output.shifts), ["SHIFT-A"]);
  assert.equal(output.shifts[0].rateMinor, 50);
});

test("new assigned reads with no active grants expose no operational records, names or tasks", () => {
  const emptyScope = scope(["BR-OLD", "MISSING-BRANCH"]);
  const procurement = scopeProcurementRows(procurementFixture(), emptyScope);
  const food = scopeFoodRows(foodFixture(), emptyScope, foodPurchases);
  for (const rows of Object.values(procurement)) assert.deepEqual(rows, []);
  for (const [key, rows] of Object.entries(food)) if (key !== "economicsComplete") assert.deepEqual(rows, []);
});

// Schema-aware thenable adapter applies the route's actual grant predicate and
// records every table read. Financial reads throw for new section assignments.
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const fixtureKey = "__operationalAssignedScopeFixture";
const dbAdapter = dataModule(`
  function matches(row, clause) { if(!clause)return true; if(clause.op==='eq')return row[clause.left.column]===clause.right; throw Error('Unsupported predicate'); }
  export const ensureCoreTables=async()=>{globalThis.${fixtureKey}.ensureCalls++};
  export const getDb=()=>({select:(projection)=>{
    let table, predicate;
    return {from(value){table=value;return this},where(value){predicate=value;return this},orderBy(){return this},then(resolve,reject){
      const f=globalThis.${fixtureKey}; f.reads.push(table.tableName);
      if(table.tableName==='financialOperations'&&f.forbidFinancialReads)return Promise.reject(Error('Financial read prohibited')).then(resolve,reject);
      let rows=structuredClone(f.tables[table.tableName]??[]).filter(row=>matches(row,predicate));
      if(projection)rows=rows.map(row=>Object.fromEntries(Object.entries(projection).map(([key,column])=>[key,row[column.column]])));
      return Promise.resolve(rows).then(resolve,reject);
    }};
  }});
`);
const authAdapter = dataModule(`export const getAuthenticatedRequestContext=async()=>globalThis.${fixtureKey}.context;`);
const tasksAdapter = dataModule(`
  export const selectVisibleTasks=async()=>structuredClone(globalThis.${fixtureKey}.tasks);
  export const redactHiddenTaskReferences=(rows,tasks)=>rows.map(row=>({...row,relatedTaskId:tasks.some(task=>task.id===row.relatedTaskId)?row.relatedTaskId:null}));
`);
async function loadHandler(name) {
  const raw = await readFile(resolve(root, `app/api/${name}/route.ts`), "utf8");
  const compiled = stripTypeScriptTypes(raw, { mode: "strip" }).replace(/from\s*["']([^"']+)["']/g, (_match, dependency) => {
    let mapped;
    if (dependency === "../../../db") mapped = dbAdapter;
    else if (dependency === "../../../lib/production-auth") mapped = authAdapter;
    else if (dependency === "drizzle-orm") mapped = dataModule("export const asc=x=>x,eq=(left,right)=>({op:'eq',left,right});");
    else if (dependency === "../../../lib/task-access-query") mapped = tasksAdapter;
    else if (dependency === "../../../db/schema") {
      const imports = raw.match(/import\s*\{([^}]+)\}\s*from\s*["']\.\.\/\.\.\/\.\.\/db\/schema["']/)[1];
      mapped = dataModule(imports.split(",").map((name) => name.trim()).filter(Boolean).map((name) => `export const ${name}=new Proxy({tableName:'${name}'},{get:(target,key)=>key==='tableName'?target.tableName:{table:target.tableName,column:key}});`).join("\n"));
    } else if (dependency.startsWith("../../../lib/")) mapped = pathToFileURL(resolve(root, `lib/${dependency.slice("../../../lib/".length)}.ts`)).href;
    assert.ok(mapped, `Unmapped route dependency: ${dependency}`);
    return `from "${mapped}"`;
  });
  return import(dataModule(compiled));
}
function handlerFixture(route, apiRole = "EMPLOYEE", allowedModules = [route], grants = ["BR-A", "BR-DA", "BR-OLD"]) {
  const input = route === "procurement" ? procurementFixture() : foodFixture();
  const map = route === "procurement" ? {
    suppliers: "procurementSuppliers", requests: "purchaseRequests", offers: "supplierOffers", orders: "purchaseOrders", deliveries: "procurementDeliveries", items: "inventoryItems", events: "inventoryEvents", assetRows: "assets", maintenance: "assetMaintenance", entityRows: "entities",
  } : { products: "foodProducts", batches: "foodBatches", recipes: "foodRecipes", ingredients: "foodRecipeIngredients", production: "foodProduction", shipments: "foodShipments", shifts: "foodShifts", checks: "foodChecks", entityRows: "entities" };
  const tables = Object.fromEntries(Object.entries(map).map(([key, table]) => [table, input[key]]));
  tables.organizationBranches = branches;
  tables.userBranchAccess = [...grants.map((branchId) => ({ userId: "USER-A", branchId })), { userId: "OTHER-USER", branchId: "BR-B" }];
  tables.financialOperations = [{ id: "PAYMENT-A", projectEntityId: "PROJECT-FOOD", direction: "Списание", amountMinor: 123456 }, { id: "FINANCE-FOREIGN", projectEntityId: "PROJECT-FOREIGN", amountMinor: 987654 }];
  if (route === "food") tables.purchaseRequests = foodPurchases;
  const user = { apiRole, isSystemOwner: false, allowedModules };
  return (globalThis[fixtureKey] = { tables, tasks: input.allTasks, reads: [], ensureCalls: 0, forbidFinancialReads: apiRole === "EMPLOYEE", context: { apiRole, appUserId: "USER-A", actor: "synthetic@example.test", auth: { user } } });
}
const handlers = { procurement: await loadHandler("procurement"), food: await loadHandler("food") };
const request = (route) => new Request(`https://synthetic.example.test/api/${route}`, { headers: { "x-arthello-role": "OWNER", "x-arthello-system-owner": "1" } });

test("actual procurement GET: explicit EMPLOYEE assignment scopes returned rows, names, summary and chain without reading finance", async () => {
  const state = handlerFixture("procurement");
  const response = await handlers.procurement.GET(request("procurement"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(ids(body.requests), ["REQ-A", "REQ-AN"]);
  assert.deepEqual(ids(body.assets), ["ASSET-A"]);
  assert.deepEqual(ids(body.tasks), ["TASK-A"]);
  assert.equal(body.summary.stockUnits, 6);
  assert.equal(body.summary.requests, 2);
  assert.equal(body.chain.paymentId, "");
  assert.equal(Object.hasOwn(body, "payment"), false);
  assert.equal(Object.hasOwn(body.entityNames, "UNRELATED-SECRET"), false);
  assert.equal(Object.hasOwn(body.entityNames, "BR-B"), false);
  assert.equal(state.reads.includes("financialOperations"), false);
});

test("actual food GET: partial cost is unavailable rather than zero, foreign names and finance are absent", async () => {
  const state = handlerFixture("food");
  const response = await handlers.food.GET(request("food"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(ids(body.shipments), ["SHIPMENT-A", "SHIPMENT-MISSING-PRODUCTION", "SHIPMENT-SHARED-A", "SHIPMENT-SHIFT-A"]);
  assert.deepEqual(body.economics, { revenueMinor: 2000, materialMinor: null, laborMinor: null, profitMinor: null, marginPercent: null });
  assert.deepEqual(body.finance, []);
  assert.deepEqual(body.entityNames, { "BR-A": "Школа А" });
  assert.deepEqual(ids(body.tasks), ["TASK-CHECK-A"]);
  assert.equal(body.chain.costId, "");
  assert.equal(body.chain.revenueId, "");
  assert.equal(state.reads.includes("financialOperations"), false);
});

test("actual food GET: fully attributed local production returns its material and labor totals", async () => {
  const state = handlerFixture("food");
  state.tables.foodShipments = state.tables.foodShipments.filter((row) => row.id === "SHIPMENT-A");
  state.tables.foodProduction = state.tables.foodProduction.filter((row) => row.id === "PRODUCTION-A");
  const response = await handlers.food.GET(request("food"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.economics, { revenueMinor: 500, materialMinor: 100, laborMinor: 50, profitMinor: 350, marginPercent: 70 });
});

for (const route of ["procurement", "food"]) {
  test(`actual ${route} GET: another user's grant never opens foreign records`, async () => {
    handlerFixture(route, "EMPLOYEE", [route], []);
    const response = await handlers[route].GET(request(route));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.entityNames, {});
    assert.deepEqual(body.tasks, []);
    for (const value of Object.values(body)) if (Array.isArray(value)) assert.deepEqual(value, []);
  });
  test(`actual ${route} GET: removing the checkbox denies before database access despite forged owner headers`, async () => {
    const state = handlerFixture(route, "EMPLOYEE", []);
    const response = await handlers[route].GET(request(route));
    assert.equal(response.status, 403);
    assert.equal(state.ensureCalls, 0);
    assert.deepEqual(state.reads, []);
  });
  test(`actual ${route} GET: native role retains the existing full operational catalogue`, async () => {
    const state = handlerFixture(route, route === "procurement" ? "PROCUREMENT" : "KITCHEN", undefined, []);
    state.context.auth.user.allowedModules = undefined;
    const response = await handlers[route].GET(request(route));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(state.reads.includes("financialOperations"), true);
    assert.equal(state.reads.includes("organizationBranches"), false);
    assert.ok(Object.hasOwn(body.entityNames, "UNRELATED-SECRET"));
    assert.ok((route === "procurement" ? body.requests : body.shipments).some((row) => row.id === (route === "procurement" ? "REQ-B" : "SHIPMENT-B")));
    if (route === "procurement") assert.equal(body.payment.id, "PAYMENT-A");
    else assert.equal(body.finance[0].id, "PAYMENT-A");
  });
}
