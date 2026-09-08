import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { assignedActiveBranchScope, requiresAssignedReadScope } from "../lib/section-read-scope.ts";
import { scopeStrategyRows } from "../lib/strategy-read-scope.ts";

const data = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const key = "__scopedSectionFixture";
const adapters = {
  "drizzle-orm": data("export const asc=x=>x,desc=x=>x,eq=(column,value)=>({column,value}),and=(...conditions)=>({conditions});"),
  "../../../db": data(`export const getDb=()=>globalThis.${key}.db,ensureCoreTables=async()=>{},getSystemDataMode=async()=>"source_only",ensureAnalyticsDemoBootstrap=async()=>{};`),
  "../../../lib/production-auth": data(`export const getAuthenticatedRequestContext=async()=>globalThis.${key}.context,verifyAuthenticatedRequestCsrf=()=>{};`),
  "../../../lib/task-access-query": data("export const selectVisibleTasks=async()=>[],redactHiddenTaskReferences=rows=>rows.map(row=>({...row,relatedTaskId:0}));"),
  "cloudflare:workers": data(`export const env={DB:{prepare:()=>({bind(){return this},all:async()=>({results:[{id:"UNSCOPED-PRIVATE-DECISION",comment:"PRIVATE-PII"}]}),first:async()=>null})}};`),
};
async function handler(route) {
  const raw = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
  const source = stripTypeScriptTypes(raw, { mode: "strip" }).replace(/from\s*["']([^"']+)["']/g, (_match, path) => {
    let mapped = adapters[path];
    if (path === "../../../db/schema") {
      const names = raw.match(/import\s*\{([^}]+)\}\s*from\s*["']\.\.\/\.\.\/\.\.\/db\/schema["']/)[1].split(",").map((x) => x.trim()).filter(Boolean);
      mapped = data(names.map((name) => `export const ${name}=new Proxy({name:"${name}"},{get:(target,field)=>field==="name"?target.name:{table:target.name,field}});`).join("\n"));
    } else if (!mapped && path.startsWith("../../../lib/")) mapped = new URL(`../lib/${path.slice(13)}.ts`, import.meta.url).href;
    assert.ok(mapped, path);
    return `from "${mapped}"`;
  });
  return import(data(source));
}
function evaluate(condition, row) {
  if (condition.conditions) return condition.conditions.every((item) => evaluate(item, row));
  return row[condition.column.table]?.[condition.column.field] === (condition.value?.table ? row[condition.value.table]?.[condition.value.field] : condition.value);
}
function database(tables) {
  return { select(projection) { return { from(table) {
    let rows = (tables[table.name] ?? []).map((row) => ({ [table.name]: row }));
    const query = {
      innerJoin(joined, condition) { rows = rows.flatMap((row) => (tables[joined.name] ?? []).map((entry) => ({ ...row, [joined.name]: entry }))).filter((row) => evaluate(condition, row)); return query; },
      where(condition) { rows = rows.filter((row) => evaluate(condition, row)); return query; },
      orderBy() { return query; }, limit() { return query; },
      then(resolve, reject) { return Promise.resolve(rows.map((row) => projection ? Object.fromEntries(Object.entries(projection).map(([name, column]) => [name, row[column.table]?.[column.field]])) : row[table.name])).then(resolve, reject); },
    };
    return query;
  } }; } };
}
const branches = [{ id: "BR-A", name: "Филиал А", status: "Активен" }, { id: "BR-B", name: "Филиал Б", status: "Активен" }, { id: "BR-CLOSED", name: "Закрытый филиал", status: "Закрыт" }];
function fixture(apiRole = "EMPLOYEE", allowedModules = ["hr"], extra = {}) {
  const tables = {
    organizationBranches: branches,
    userBranchAccess: [{ userId: "USER-1", branchId: "BR-A" }, { userId: "OTHER", branchId: "BR-B" }, { userId: "USER-1", branchId: "BR-CLOSED" }],
    hrVacancies: ["A", "B", "UNKNOWN"].map((id) => ({ id: `VAC-${id}`, unit: `BR-${id}`, status: "В работе" })),
    hrCandidates: ["A", "B"].map((id) => ({ id: `CAN-${id}`, vacancyId: `VAC-${id}`, entityId: `PERSON-${id}`, stage: "Новый", rejectionReason: id === "B" ? "PRIVATE-PII" : "" })),
    hrInterviews: ["A", "B"].map((id) => ({ id: `INT-${id}`, candidateId: `CAN-${id}`, interviewerEntityId: `EMP-${id}` })),
    hrEmployees: ["A", "B", "CLOSED", "UNKNOWN", "MULTI", "MALFORMED"].map((id) => ({ id: `EMP-${id}`, unit: `BR-${id}`, candidateId: `CAN-${id}`, contractId: `DOC-${id}`, positionId: "POSITION-1", status: "Работает", rateMinor: id === "B" ? 987654321 : 100, hireDate: "2026-09-01" })),
    entities: ["A", "B", "CLOSED", "UNKNOWN", "MULTI", "MALFORMED"].map((id) => ({ id: `EMP-${id}`, displayName: id === "B" ? "PRIVATE-PII" : `Employee ${id}`, sourceSystem: "MANUAL", dataQuality: "Проверено", metadata: JSON.stringify({ branchIds: id === "MULTI" ? ["BR-A", "BR-B"] : id === "MALFORMED" ? "BR-A" : [`BR-${id}`], contact: `contact-${id}`, note: "DO-NOT-DISCLOSE-NOTE", unrelatedPrivateRecord: "PRIVATE-PII", branches: ["FORGED-OTHER-BRANCH"], position: { secret: "PRIVATE-PII" } }) })),
    hrOnboarding: ["A", "B"].map((id) => ({ id: `ON-${id}`, employeeId: `EMP-${id}` })),
    hrDevelopment: ["A", "B"].map((id) => ({ id: `DEV-${id}`, employeeId: `EMP-${id}` })),
    hrRewards: ["A", "B"].map((id) => ({ id: `REWARD-${id}`, employeeId: `EMP-${id}` })),
    hrAccesses: ["A", "B"].map((id) => ({ id: `ACCESS-${id}`, employeeId: `EMP-${id}`, status: "Активен" })),
    workflowDocuments: [{ id: "DOC-A", title: "PRIVATE-LEGAL-CONTRACT" }],
    financialOperations: [{ id: "PAY-A", counterpartyEntityId: "EMP-A", objectEntityId: "BR-A", legalEntityId: "OTHER-LEGAL-ENTITY", amountMinor: 987654321, direction: "Поступление", period: "2026-09", sourceSystem: "BANK", sourceRef: "PRIVATE-PII" }],
  };
  const user = { apiRole, allowedModules, isSystemOwner: apiRole === "OWNER", ...extra };
  const value = { tables, context: { apiRole, appUserId: "USER-1", actor: "fixture@example.test", auth: { user } }, db: database(tables) };
  globalThis[key] = value;
  return value;
}
const request = (route) => new Request(`https://arthello.example.test/api/${route}`, { headers: { "x-arthello-role": "OWNER" } });
const ids = (rows) => rows.map((row) => row.id);
const { GET: hrGET } = await handler("hr");
for (const role of ["EMPLOYEE", "HR", "DIRECTOR"]) test(`HR ${role}: actual GET excludes other branches, unknown/multiple assignments, unrelated metadata and legal-entity payroll`, async () => {
  fixture(role);
  const response = await hrGET(request("hr"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(ids(body.employees), ["EMP-A"]);
  assert.deepEqual(ids(body.vacancies), ["VAC-A"]);
  assert.deepEqual(ids(body.candidates), ["CAN-A"]);
  assert.deepEqual(ids(body.interviews), ["INT-A"]);
  assert.deepEqual(ids(body.branches), ["BR-A"]);
  assert.deepEqual(ids(body.onboarding), ["ON-A"]);
  assert.deepEqual(ids(body.rewards), ["REWARD-A"]);
  assert.deepEqual(body.documents, []);
  assert.deepEqual(body.payroll, []);
  assert.equal(body.employees[0].contractId, "");
  assert.equal(body.summary.activeEmployees, 1);
  assert.deepEqual(body.employeeProfiles["EMP-A"].branches, ["Филиал А"]);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-PII|987654321|DO-NOT-DISCLOSE-NOTE|FORGED-OTHER-BRANCH|OTHER-LEGAL-ENTITY|PRIVATE-LEGAL-CONTRACT/);
});
test("HR: absent branch grants expose no people, rates, counts or related rows", async () => {
  fixture().tables.userBranchAccess = [];
  const body = await (await hrGET(request("hr"))).json();
  assert.deepEqual(body.employees, []);
  assert.deepEqual(body.entityNames, {});
  assert.deepEqual(body.employeeProfiles, {});
  assert.equal(body.summary.activeEmployees, 0);
});
test("HR: administrative assignment includes active branches, canonical owner keeps its existing complete model", async () => {
  fixture("EMPLOYEE", ["hr"], { isAdministrative: true });
  const admin = await (await hrGET(request("hr"))).json();
  assert.deepEqual(ids(admin.employees), ["EMP-A", "EMP-B", "EMP-MULTI"]);
  assert.deepEqual(admin.payroll, []);
  fixture("OWNER", ["hr"]);
  const owner = await (await hrGET(request("hr"))).json();
  assert.equal(owner.employees.length, 6);
  assert.equal(owner.payroll.length, 1);
  assert.match(JSON.stringify(owner.employeeProfiles), /DO-NOT-DISCLOSE-NOTE/);
});
test("exact active branch scope does not infer ambiguous names or grant another user's branch", () => {
  const scope = assignedActiveBranchScope({}, [...branches, { id: "BR-DUP", name: "Филиал А", status: "Активен" }], [{ branchId: "BR-A" }, { branchId: "BR-CLOSED" }]);
  assert.equal(scope.allowsBranch("BR-A"), true);
  assert.equal(scope.allowsBranch("Филиал А"), false);
  for (const value of ["BR-B", "BR-CLOSED", "BR-UNKNOWN", "", null]) assert.equal(scope.allowsBranch(value), false);
  for (const name of ["BR-B", "BR-CLOSED"]) {
    const collision = assignedActiveBranchScope({}, [...branches, { id: "BR-NAMED", name, status: "Активен" }], [{ branchId: "BR-NAMED" }]);
    assert.equal(collision.allowsBranch(name), false, "a known denied ID cannot be reinterpreted as an allowed name");
  }
  assert.equal(requiresAssignedReadScope({ apiRole: "FINANCE", isSystemOwner: false, allowedModules: ["accounting"] }, "/api/accounting"), false);
  assert.equal(requiresAssignedReadScope({ apiRole: "EMPLOYEE", isSystemOwner: false, allowedModules: ["accounting"] }, "/api/accounting"), true);
});

for (const route of ["accounting", "analytics", "readiness", "acceptance", "legal"]) {
  const { GET } = await handler(route);
  test(`${route}: new checked read never returns non-scoped business rows or owner decisions`, async () => {
    const state = fixture("EMPLOYEE", [route === "readiness" ? "quality" : route]);
    for (const table of ["accountingDocuments", "accountingDocumentLinks", "accountingCompletenessChecks", "accountingExports", "accountingIntegrations", "analyticsMetricDefinitions", "analyticsSignals", "aiProcessContracts", "aiModelRuns", "aiOptOuts", "legalContracts", "legalDocumentItems", "legalChecks"]) state.tables[table] = [{ id: "UNSCOPED-PRIVATE-ROW", title: "PRIVATE-PII" }];
    const response = await GET(request(route));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE-PII|UNSCOPED-PRIVATE|987654321|OTHER-LEGAL-ENTITY/);
    assert.ok(body.scopeBoundary || body.boundary);
    if (route === "analytics") assert.equal(body.owner.cashForecastFloorMinor, 0);
    if (route === "readiness") assert.equal(body.summary.productionReady, false);
  });
}

test("strategy graph requires a scoped goal and consistent KPI/initiative/project relationships", () => {
  const model = scopeStrategyRows({
    goals: [{ id: "G-A", unitEntityId: "BR-A" }, { id: "G-B", unitEntityId: "BR-B" }, { id: "G-UNKNOWN", unitEntityId: "" }],
    kpis: [{ id: "K-A", goalId: "G-A" }, { id: "K-B", goalId: "G-B" }],
    initiatives: [{ id: "I-A", goalId: "G-A", kpiId: "K-A" }, { id: "I-CROSS", goalId: "G-A", kpiId: "K-B" }],
    projects: [{ id: "P-A", goalId: "G-A", initiativeId: "I-A", budgetId: "UNSCOPED-LEDGER" }, { id: "P-CROSS", goalId: "G-A", initiativeId: "I-CROSS" }],
    events: [{ id: "E-A", projectId: "P-A" }, { id: "E-B", projectId: "P-CROSS" }],
    participants: [{ id: "PART-A", eventId: "E-A" }, { id: "PART-B", eventId: "E-B" }],
    results: [{ id: "RES-A", projectId: "P-A", eventId: "E-A" }, { id: "RES-CROSS", projectId: "P-A", eventId: "E-B" }],
    deviations: [{ id: "D-A", projectId: "P-A", kpiId: "K-A", relatedTaskId: 1 }, { id: "D-CROSS", projectId: "P-A", kpiId: "K-B" }],
    allTasks: [{ id: 1, sourceType: "Отклонение KPI", sourceId: "D-A" }, { id: 2, sourceType: "Отклонение KPI", sourceId: "D-CROSS" }],
  }, new Set(["BR-A"]));
  for (const [field, expected] of Object.entries({ goals: ["G-A"], kpis: ["K-A"], initiatives: ["I-A"], projects: ["P-A"], events: ["E-A"], participants: ["PART-A"], results: ["RES-A"], deviations: ["D-A"], allTasks: [1] })) assert.deepEqual(ids(model[field]), expected, field);
  assert.equal(model.projects[0].budgetId, "");
});

test("strategy actual GET applies branch grants before exposing project budgets and counts", async () => {
  const { GET } = await handler("strategy");
  const state = fixture("EMPLOYEE", ["projects"]);
  state.tables.strategyGoals = ["A", "B"].map((id) => ({ id: `G-${id}`, unitEntityId: `BR-${id}` }));
  state.tables.strategyKpis = ["A", "B"].map((id) => ({ id: `K-${id}`, goalId: `G-${id}` }));
  state.tables.strategyInitiatives = ["A", "B"].map((id) => ({ id: `I-${id}`, goalId: `G-${id}`, kpiId: `K-${id}` }));
  state.tables.strategyProjects = ["A", "B"].map((id) => ({ id: `P-${id}`, goalId: `G-${id}`, initiativeId: `I-${id}`, budgetPlanMinor: 1000, budgetActualMinor: id === "B" ? 987654321 : 200, budgetId: `LEDGER-${id}` }));
  const response = await GET(request("strategy"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(ids(body.projects), ["P-A"]);
  assert.deepEqual(ids(body.goals), ["G-A"]);
  assert.equal(body.summary.projects, 1);
  assert.equal(body.chain.budgetId, "");
  assert.doesNotMatch(JSON.stringify(body), /987654321|P-B|G-B|LEDGER/);
});

test("legal actual GET reveals only assigned responsibility zones and no contract or unrelated identity", async () => {
  const { GET } = await handler("legal");
  const state = fixture("EMPLOYEE", ["legal"]);
  state.tables.legalResponsibilityZones = ["A", "B", "CLOSED", "UNKNOWN"].map((id) => ({ id: `ZONE-${id}`, scope: `BR-${id}`, contractId: `CONTRACT-${id}`, responsibleEntityId: `EMP-${id}` }));
  state.tables.legalContracts = [{ id: "CONTRACT-A", limitMinor: 987654321, partyEntityId: "PRIVATE-PII" }];
  const response = await GET(request("legal"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(ids(body.zones), ["ZONE-A"]);
  assert.equal(body.zones[0].contractId, "");
  assert.deepEqual(Object.keys(body.entityNames), ["EMP-A"]);
  assert.deepEqual(body.contracts, []);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-PII|987654321|CONTRACT-A|ZONE-B|ZONE-CLOSED|ZONE-UNKNOWN/);
});
