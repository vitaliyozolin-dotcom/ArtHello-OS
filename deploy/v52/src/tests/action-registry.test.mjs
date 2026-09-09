import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const registry = JSON.parse(readFileSync(new URL("../data/action-registry.json", import.meta.url), "utf8"));
const shell = readFileSync(new URL("../app/components/ArtHelloShell.tsx", import.meta.url), "utf8");

test("every required module registers first click, breadcrumbs, back, KPI and row actions", () => {
  assert.equal(registry.moduleCount, 25);
  assert.equal(registry.actionCount, 181);
  const required = ["home", "tasks", "finance", "sales", "clients", "content", "methods", "education", "legal", "food", "safety", "hr", "events", "contractors", "medical", "accounting", "integrations", "access", "assets", "procurement", "quality", "projects", "analytics", "registry", "acceptance"];
  for (const moduleId of required) {
    for (const suffix of ["NAV", "BREADCRUMB", "SECTION_HOME", "BACK", "KPI", "ROW"]) {
      assert.ok(registry.actions.some((action) => action.id === `ACT-${moduleId.toUpperCase()}-${suffix}`), `${moduleId} missing ${suffix}`);
    }
  }
});

test("action identifiers are unique and include integrations plus all cross-module scenarios", () => {
  assert.equal(new Set(registry.actions.map((action) => action.id)).size, registry.actionCount);
  for (const id of [
    "ACT-INTEGRATIONS-CHECK", "ACT-INTEGRATIONS-SYNC", "ACT-INTEGRATIONS-ADD-TEST", "ACT-INTEGRATIONS-DELETE-TEST",
    "ACT-SCENARIO-CONTENT-MONEY", "ACT-SCENARIO-CANDIDATE-SALARY", "ACT-SCENARIO-PROGRAM-RESULT", "ACT-SCENARIO-DEFECT-REPAIR",
    "ACT-SCENARIO-PURCHASE-PNL", "ACT-SCENARIO-DISH-PROFIT", "ACT-SCENARIO-COMPLAINT-FIX", "ACT-SCENARIO-RISK-ACTION",
  ]) assert.ok(registry.actions.some((action) => action.id === id), `${id} is missing`);
});

test("action records expose the complete auditable contract", () => {
  const fields = ["id", "screen", "element", "role", "expectedAction", "expectedRoute", "expectedResult", "loadingState", "errorState", "test", "actualResult"];
  for (const action of registry.actions) for (const field of fields) assert.ok(String(action[field] ?? "").length > 0, `${action.id} missing ${field}`);
});

test("shell source contains browser history, command palette, context bar and mobile navigation", () => {
  for (const evidence of ["window.history.pushState", "function CommandPalette", "context-bar", "mobile-dock", "arthello:sidebar", "arthello:recent-modules"]) assert.match(shell, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
