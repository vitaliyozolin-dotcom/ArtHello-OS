import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";

const routePaths = [
  "../app/api/food-actions/route.ts",
  "../app/api/accounting-actions/route.ts",
  "../app/api/analytics-actions/route.ts",
  "../app/api/sales-actions/route.ts",
  "../app/api/finance-actions/route.ts",
  "../app/api/medical-actions/route.ts",
  "../app/api/integration-actions/route.ts",
  "../app/api/hr-actions/route.ts",
];
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sources = routePaths.map(read).join("\n");

test("production actions do not recreate demo references or frozen dates", () => {
  assert.doesNotMatch(sources, /EMP-T|FAM-T|OBJ-T|FIN-TEST|MANUAL_SYNTHETIC|SYNTHETIC|TEST-RULES|ANALYTICS-SNAPSHOT|SHIFT-T|INT-T-D1/);
  assert.doesNotMatch(sources, /(?:dueDate|documentDate|productionDate|period|completedAt|closedAt|confirmedAt)\s*:\s*["`]2026-/);
  assert.doesNotMatch(sources, /assigneeEntityId\s*:\s*["`](?:EMP-|ROLE:)/);
});

test("new operational records use live timestamps, real actors and validated references", () => {
  const food = read("../app/api/food-actions/route.ts");
  const accounting = read("../app/api/accounting-actions/route.ts");
  const analytics = read("../app/api/analytics-actions/route.ts");
  const sales = read("../app/api/sales-actions/route.ts");
  const finance = read("../app/api/finance-actions/route.ts");
  const integration = read("../app/api/integration-actions/route.ts");
  const hr = read("../app/api/hr-actions/route.ts");

  assert.match(food, /productionDate=.*today\(\)/);
  assert.match(accounting, /sourceType:"MANUAL"/);
  assert.match(accounting, /entities\.id,counterparty/);
  assert.match(analytics, /modelVersion: "MANUAL-CONTROL-v1"/);
  assert.match(analytics, /inputSnapshotRef: `CONTRACT:/);
  assert.match(sales, /resolveTaskAssignment\(context, lead\.managerEntityId, actor\)/);
  assert.match(finance, /owner: assignment\.owner/);
  assert.match(integration, /isCoreConnection\(connection\)/);
  assert.match(hr, /period:new Date\(\)\.toISOString\(\)\.slice\(0,7\)/);
});

function transpileAnalytics(source) {
  const replacements = [
    ['import { eq } from "drizzle-orm";', "const eq=()=>({});"],
    ['import { ensureAnalyticsDemoBootstrap, ensureCoreTables, getDb, getSystemDataMode } from "../../../db";', "const {ensureAnalyticsDemoBootstrap,ensureCoreTables,getDb,getSystemDataMode}=globalThis.__ARTHELLO_ANALYTICS_ACTION_TEST__;"],
    ['import { aiModelRuns, aiOptOuts, aiProcessContracts, analyticsSignals, auditEvents, tasks } from "../../../db/schema";', "const aiModelRuns={},aiOptOuts={},aiProcessContracts={id:{}},analyticsSignals={id:{}},auditEvents={},tasks={automationKey:{}};"],
    ['import { canRecordHumanDecision, canRunContract } from "../../../lib/analytics";', "const canRecordHumanDecision=()=>true,canRunContract=()=>true;"],
    ['import { getAuthenticatedRequestContext } from "../../../lib/production-auth";', "const {getAuthenticatedRequestContext}=globalThis.__ARTHELLO_ANALYTICS_ACTION_TEST__;"],
    ['import { resolveTaskAssignment, type TaskAccessContext } from "../../../lib/task-access";', "const resolveTaskAssignment=()=>({ok:true,assigneeEntityId:'USR-LIVE',owner:'Live user'});"],
    ['import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";', "const findScopedAutomationTask=async()=>({state:'missing'}),scopedAutomationTaskResponse=()=>null;"],
  ];
  let transformed = source;
  for (const [from, to] of replacements) {
    assert.ok(transformed.includes(from), `analytics action source changed: ${from}`);
    transformed = transformed.replace(from, to);
  }
  assert.doesNotMatch(transformed, /^import\s/m);
  return ts.transpileModule(transformed, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "analytics-actions/route.ts",
  }).outputText;
}

test("empty production rejects only the model run before database access", async () => {
  let databaseCalls = 0;
  let bootstrapCalls = 0;
  const emptySelect = {
    from() {
      return { where() { return { limit: async () => [] }; } };
    },
  };
  globalThis.__ARTHELLO_ANALYTICS_ACTION_TEST__ = {
    ensureCoreTables: async () => {},
    ensureAnalyticsDemoBootstrap: async () => { bootstrapCalls += 1; },
    getSystemDataMode: async () => "empty",
    getDb: () => {
      databaseCalls += 1;
      return { select: () => emptySelect };
    },
    getAuthenticatedRequestContext: async () => ({ actor: "live@example.test", apiRole: "OWNER", appUserId: "USR-LIVE", appUserName: "Live user" }),
  };
  try {
    const code = transpileAnalytics(read("../app/api/analytics-actions/route.ts"));
    const route = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#analytics-actions-${Date.now()}`);
    const makeRequest = (action) => new Request("https://example.test/api/analytics-actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-arthello-role": "OWNER" },
      body: JSON.stringify({ action, contractId: "CONTRACT-LIVE", signalId: "SIGNAL-LIVE" }),
    });

    const runResponse = await route.POST(makeRequest("runScenario"));
    assert.equal(runResponse.status, 409);
    assert.match((await runResponse.json()).error, /пустом production-контуре/);
    assert.equal(databaseCalls, 0);
    assert.equal(bootstrapCalls, 0);

    const manualResponse = await route.POST(makeRequest("createSignalTask"));
    assert.equal(manualResponse.status, 404, "manual actions remain routed and fail only when their real record is absent");
    assert.equal(databaseCalls, 1);
    assert.equal(bootstrapCalls, 0);
  } finally {
    delete globalThis.__ARTHELLO_ANALYTICS_ACTION_TEST__;
  }
});
