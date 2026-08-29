import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const strategy = read("../app/components/StrategyWorkspace.tsx");
const strategyStyles = read("../app/components/StrategyWorkspace.ds.css");
const analytics = read("../app/components/AnalyticsWorkspace.tsx");
const analyticsStyles = read("../app/components/AnalyticsWorkspace.ds.css");
const readiness = read("../app/components/ReadinessWorkspace.tsx");
const readinessStyles = read("../app/components/ReadinessWorkspace.ds.css");
const designSystem = read("../app/components/design-system/index.tsx");
const operationalPatch = read("../scripts/patch-system-operational-modules.mjs");
const normalizeInputs = read("../scripts/normalize-system-patch-inputs.mjs");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSharedShell(source, name, root, css) {
  for (const component of ["PageContainer", "PageHeader", "Card", "KpiCard", "EmptyState", "Tabs"]) {
    assert.match(source, new RegExp(`\\b${component}\\b`), `${name} must use ${component}`);
  }
  assert.match(source, new RegExp(`className=["']${root}["']`));
  assert.match(source, new RegExp(`import\\s*["']\\./${css}["']`));
  assert.doesNotMatch(source, new RegExp(`\\b(?:strategy|analytics|readiness)-workspace\\b`));
  assert.doesNotMatch(source, /manual-module-empty|operational-inline-empty/);
}

function assertRequestContract(source, endpoint, actionsEndpoint) {
  assert.match(source, new RegExp(`fetch\\(["']${escapeRegExp(endpoint)}["']`));
  assert.match(source, new RegExp(`fetch\\(["']${escapeRegExp(actionsEndpoint)}["']`));
  assert.match(source, /cache:\s*["']no-store["']/);
  assert.match(source, /["']x-arthello-role["']/);
  assert.match(source, /method:\s*["']POST["']/);
  assert.match(source, /["']content-type["']:\s*["']application\/json["']/);
}

function assertActions(source, actions, name) {
  for (const action of actions) assert.match(source, new RegExp(`action:\\s*["']${escapeRegExp(action)}["']`), `${name} lost ${action}`);
}

function assertNoBlockingEmptyReturn(source, name) {
  assert.doesNotMatch(source, /if\s*\(\s*!data\.(?:contracts|scenarios|goals)\.length[\s\S]{0,180}?\)\s*(?:\{\s*)?return\s*<section/, `${name} must keep its full shell when empty`);
}

function assertScopedCss(source, prefix, name) {
  assert.match(source, new RegExp(`\\.${prefix}Page\\s*\\{`));
  assert.match(source, /--ah-registry-kpi-min-height/);
  assert.match(source, /font-size:\s*32px/);
  assert.match(source, /font-size:\s*12px;\s*font-weight:\s*500;\s*line-height:\s*15px/);
  assert.match(source, /font-size:\s*10px;\s*font-weight:\s*400;\s*line-height:\s*14px/);
  assert.doesNotMatch(source, /!important/, `${name} must not add specificity debt`);
  assert.doesNotMatch(source, /\[class\*=/, `${name} must not use wildcard class selectors`);
  assert.doesNotMatch(source, /margin(?:-\w+)?:\s*-/, `${name} must not use negative margins`);
}

test("Wave 4 uses the shared Design System management shell", () => {
  assertSharedShell(strategy, "StrategyWorkspace", "ahStrategyPage", "StrategyWorkspace.ds.css");
  assertSharedShell(analytics, "AnalyticsWorkspace", "ahAnalyticsPage", "AnalyticsWorkspace.ds.css");
  assertSharedShell(readiness, "ReadinessWorkspace", "ahReadinessPage", "ReadinessWorkspace.ds.css");
  assert.match(designSystem, /designSystemVersion\s*=\s*["']1\.4-management-insight["']/);
});

test("Wave 4 keeps complete shells and approved information hierarchy", () => {
  assertNoBlockingEmptyReturn(strategy, "StrategyWorkspace");
  assertNoBlockingEmptyReturn(analytics, "AnalyticsWorkspace");
  assertNoBlockingEmptyReturn(readiness, "ReadinessWorkspace");
  for (const source of [strategy, analytics, readiness]) {
    assert.match(source, /<PageHeader/);
    assert.match(source, /<div className="ah\w+Kpis">/);
    assert.match(source, /<Tabs/);
    assert.match(source, /density="compact"/);
  }
  for (const tab of ["Календарь", "Проекты", "Цели и инициативы", "KPI и прогноз", "Отклонения и решения"]) assert.match(strategy, new RegExp(escapeRegExp(tab)));
  for (const tab of ["Обзор", "Деньги", "Сигналы", "AI-контракты", "Решения и отказ", "Метрики"]) assert.match(analytics, new RegExp(escapeRegExp(tab)));
  for (const tab of ["Визуальная оболочка", "10 сценариев", "Матрица проверок", "Release gates", "Recovery и rollback", "Решение представителя"]) assert.match(readiness, new RegExp(escapeRegExp(tab)));
});

test("Strategy preserves its role, API and action contracts", () => {
  assertRequestContract(strategy, "/api/strategy", "/api/strategy-actions");
  assertActions(strategy, ["createEvent", "recordEventResult", "updateKpiActual", "createCorrectiveTask", "closeDeviation"], "StrategyWorkspace");
  assert.match(strategy, /onTasksChanged\(\)/);
  assert.match(strategy, /projectId:\s*data\.projects\[0\]\?\.id/);
  assert.doesNotMatch(strategy, /STR-PRJ-T-014|ТЕСТОВАЯ СТРАТЕГИЯ/);
});

test("Analytics preserves human control and opt-out contracts", () => {
  assertRequestContract(analytics, "/api/analytics", "/api/analytics-actions");
  assertActions(analytics, ["runScenario", "createSignalTask", "recordDecision", "optOut", "restoreContract"], "AnalyticsWorkspace");
  assert.match(analytics, /решение за человеком/i);
  assert.match(analytics, /fallbackFunctionality/);
  assert.match(analytics, /historicalDataPolicy/);
  assert.match(analytics, /onTasksChanged\(\)/);
});

test("Readiness preserves release, recovery and representative decisions", () => {
  assertRequestContract(readiness, "/api/readiness", "/api/readiness-actions");
  assert.match(readiness, /fetch\(["']\/api\/acceptance["']/);
  assertActions(readiness, ["runAllScenarios"], "ReadinessWorkspace");
  assert.match(readiness, /ПРИНЯТО ПРЕДСТАВИТЕЛЕМ/);
  assert.match(readiness, /ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ/);
  assert.match(readiness, /НЕ ЯВЛЯЕТСЯ РАЗРЕШЕНИЕМ НА PRODUCTION/);
  assert.match(readiness, /role !== ["']Представитель Виталия["']/);
});

test("Wave 4 CSS is scoped to the approved compact typography canon", () => {
  assertScopedCss(strategyStyles, "ahStrategy", "StrategyWorkspace");
  assertScopedCss(analyticsStyles, "ahAnalytics", "AnalyticsWorkspace");
  assertScopedCss(readinessStyles, "ahReadiness", "ReadinessWorkspace");
  for (const styles of [strategyStyles, analyticsStyles, readinessStyles]) {
    assert.match(styles, /grid-template-columns:\s*repeat\(4,/);
    assert.match(styles, /@media \(max-width:\s*720px\)/);
    assert.match(styles, /grid-template-columns:\s*repeat\(2,/);
  }
});

test("The legacy operational patch is fully retired", () => {
  assert.doesNotMatch(operationalPatch, /patch\s*\(/);
  assert.doesNotMatch(operationalPatch, /StrategyWorkspace\.tsx|AnalyticsWorkspace\.tsx|ReadinessWorkspace\.tsx/);
  assert.doesNotMatch(normalizeInputs, /patch-system-operational-modules\.mjs/);
});
