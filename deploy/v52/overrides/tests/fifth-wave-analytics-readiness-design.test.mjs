import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const analytics = read("../app/components/AnalyticsWorkspace.tsx");
const analyticsStyles = read("../app/components/AnalyticsWorkspace.ds.css");
const readiness = read("../app/components/ReadinessWorkspace.tsx");
const readinessStyles = read("../app/components/ReadinessWorkspace.ds.css");
const analyticsReadinessPatch = read("../scripts/patch-system-analytics-readiness.mjs");
const normalizeInputs = read("../scripts/normalize-system-patch-inputs.mjs");

const escapeRegExp = (value) => value.replace(/[.*+?^\$\{\}()|[\]\\]/g, "\\$&");

function importedNames(source, moduleName) {
  const match = source.match(new RegExp(`import\\s*\\{([^{}]*)\\}\\s*from\\s*["']${escapeRegExp(moduleName)}["']`));
  assert.ok(match, `named import from ${moduleName} is missing`);
  return new Set(match[1].split(",").map((name) => name.trim().split(/\\s+as\\s+/)[0]).filter(Boolean));
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function cssSelectors(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  let boundary = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === "{") {
      const prelude = clean.slice(boundary, index).trim();
      if (prelude && !prelude.startsWith("@")) {
        result.push(...prelude.split(",").map((selector) => selector.trim()).filter(Boolean));
      }
      boundary = index + 1;
    } else if (char === "}") {
      boundary = index + 1;
    }
  }
  return result.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector));
}

test("Wave 5 analytics and readiness use the shared Design System shell", () => {
  for (const [name, source, className, stylesheet] of [
    ["AnalyticsWorkspace", analytics, "ahAnalyticsPage", "AnalyticsWorkspace.ds.css"],
    ["ReadinessWorkspace", readiness, "ahReadinessPage", "ReadinessWorkspace.ds.css"],
  ]) {
    const names = importedNames(source, "./design-system");
    for (const component of ["Button", "Card", "CompactListCard", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "Tabs"]) {
      assert.ok(names.has(component), `${name} must import ${component}`);
    }
    assert.match(source, new RegExp(`import\\s*["']\\./${escapeRegExp(stylesheet)}["']`));
    assert.match(source, new RegExp(`<PageContainer\\b[^>]*className=["']${className}["']`));
    assert.equal(occurrences(source, /<KpiCard\b/g), 4);
    assert.equal(occurrences(source, /<Tabs\b/g), 1);
  }
});

test("Wave 5 exposes all six analytics sections before the first record", () => {
  assert.match(analytics, /\bhasAnalyticsData\b/);
  assert.doesNotMatch(analytics, /if\s*\(\s*!\s*hasAnalyticsData\s*\)\s*return\b/);
  for (const tab of ["Обзор", "Деньги", "Сигналы", "Сценарии ИИ", "Решения и отказ", "Метрики"]) {
    assert.match(analytics, new RegExp(escapeRegExp(tab)));
  }
  for (const title of [
    "Данных для обзора пока нет",
    "Финансовых операций пока нет",
    "Сигналов пока нет",
    "Сценарии ИИ не созданы",
    "Запусков пока нет",
    "Словарь метрик пуст",
  ]) {
    assert.match(analytics, new RegExp(escapeRegExp(title)));
  }
});

test("Wave 5 exposes all six readiness sections before the first result", () => {
  assert.match(readiness, /\bhasReadinessData\b/);
  assert.doesNotMatch(readiness, /if\s*\(\s*!\s*hasReadinessData\s*\)\s*return\b/);
  for (const tab of ["Визуальная оболочка", "10 сценариев", "Матрица проверок", "Условия выпуска", "Восстановление", "Решение собственника"]) {
    assert.match(readiness, new RegExp(escapeRegExp(tab)));
  }
  for (const title of [
    "Результаты визуальной проверки не добавлены",
    "Сквозные сценарии не настроены",
    "Матрица проверок пуста",
    "Обязательные проверки не определены",
    "Учения восстановления не проводились",
    "Решение не зафиксировано",
  ]) {
    assert.match(readiness, new RegExp(escapeRegExp(title)));
  }
});

test("Wave 5 preserves analytics reads, mutations and task refresh", () => {
  assert.match(analytics, /fetch\s*\(\s*["']\/api\/analytics["']/);
  assert.match(analytics, /fetch\s*\(\s*["']\/api\/analytics-actions["']/);
  assert.match(analytics, /["']x-arthello-role["']\s*:/);
  assert.match(analytics, /cache\s*:\s*["']no-store["']/);
  assert.match(analytics, /method\s*:\s*["']POST["']/);
  assert.match(analytics, /JSON\.stringify\s*\(\s*body\s*\)/);
  for (const action of ["runScenario", "createSignalTask", "recordDecision", "optOut", "restoreContract"]) {
    assert.match(analytics, new RegExp(`action\\s*:\\s*["']${action}["']`));
  }
  assert.match(analytics, /await\s+load\s*\(\s*\)/);
  assert.match(analytics, /onTasksChanged\s*\(\s*\)/);
  assert.match(analytics, /onOpenIntegrations/);
});

test("Wave 5 preserves readiness runs and owner decisions", () => {
  assert.match(readiness, /fetch\s*\(\s*["']\/api\/readiness["']/);
  assert.match(readiness, /fetch\s*\(\s*["']\/api\/readiness-actions["']/);
  assert.match(readiness, /fetch\s*\(\s*["']\/api\/acceptance["']/);
  assert.match(readiness, /["']x-arthello-role["']\s*:/);
  assert.match(readiness, /cache\s*:\s*["']no-store["']/);
  assert.match(readiness, /action\s*:\s*["']runAllScenarios["']/);
  assert.match(readiness, /ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ/);
  assert.match(readiness, /ТРЕБУЕТ ДОРАБОТКИ/);
  assert.match(readiness, /comment\.trim\(\)\.length\s*<\s*8/);
  assert.match(readiness, /await\s+load\s*\(\s*\)/);
});

test("Wave 5 is isolated from both legacy shells", () => {
  for (const legacy of ["analytics-workspace", "analytics-state", "analytics-heading", "analytics-tabs", "manual-module-empty", "operational-empty-workspace"]) {
    assert.equal(analytics.includes(legacy), false, `Analytics still contains ${legacy}`);
  }
  for (const legacy of ["readiness-workspace", "readiness-state", "readiness-heading", "readiness-tabs", "manual-module-empty", "operational-empty-workspace"]) {
    assert.equal(readiness.includes(legacy), false, `Readiness still contains ${legacy}`);
  }
  for (const [styles, prefix] of [[analyticsStyles, ".ahAnalytics"], [readinessStyles, ".ahReadiness"]]) {
    assert.doesNotMatch(styles, /!important/i);
    assert.doesNotMatch(styles, /\[\s*class\s*[*^$]\s*=/i);
    assert.doesNotMatch(styles, /display\s*:\s*contents\b/i);
    assert.doesNotMatch(styles, /\bmargin(?:-[a-z-]+)?\s*:\s*-/i);
    const selectors = cssSelectors(styles);
    assert.ok(selectors.length > 0);
    for (const selector of selectors) assert.match(selector, new RegExp(`^${escapeRegExp(prefix)}`), `unscoped selector: ${selector}`);
    assert.match(styles, /var\(\s*--ah-registry-kpi-/);
    assert.match(styles, /overflow-x\s*:\s*auto/);
  }
});

test("Wave 5 retires the analytics/readiness patch", () => {
  assert.doesNotMatch(analyticsReadinessPatch, /patch\s*\(/);
  assert.doesNotMatch(analyticsReadinessPatch, /AnalyticsWorkspace\.tsx|ReadinessWorkspace\.tsx/);
  assert.doesNotMatch(normalizeInputs, /patch-system-analytics-readiness\.mjs/);
});

test("Wave 5 production UI contains no fixed acceptance or snapshot claims", () => {
  const sources = `${analytics}\n${readiness}`;
  assert.doesNotMatch(sources, /ОПУБЛИКОВАННЫЙ ТЕСТОВЫЙ СНИМОК|ТЕСТОВЫЙ КОНТУР|SCN-T-09|25\/25|84\/84|181\b/i);
});
