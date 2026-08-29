import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const strategy = read("../app/components/StrategyWorkspace.tsx");
const styles = read("../app/components/StrategyWorkspace.ds.css");
const operationalPatch = read("../scripts/patch-system-operational-modules.mjs");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
      if (prelude && !prelude.startsWith("@")) result.push(...prelude.split(",").map((selector) => selector.trim()).filter(Boolean));
      boundary = index + 1;
    } else if (char === "}") boundary = index + 1;
  }
  return result.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector));
}

test("Wave 4 strategy uses the shared Design System shell", () => {
  const names = importedNames(strategy, "./design-system");
  for (const name of ["Button", "Card", "CompactListCard", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "Tabs"]) {
    assert.ok(names.has(name), `StrategyWorkspace must import ${name}`);
  }
  assert.match(strategy, /import\s*["']\.\/StrategyWorkspace\.ds\.css["']/);
  assert.match(strategy, /<PageContainer\b[^>]*className=["']ahStrategyPage["']/);
  assert.equal(occurrences(strategy, /<KpiCard\b/g), 4);
  assert.equal(occurrences(strategy, /<Tabs\b/g), 1);
});

test("Wave 4 exposes all five working sections before the first record", () => {
  assert.match(strategy, /\bhasStrategyData\b/);
  assert.doesNotMatch(strategy, /if\s*\(\s*!\s*hasStrategyData\s*\)\s*return\b/);
  for (const tab of ["Календарь", "Проекты", "Цели и инициативы", "KPI и прогноз", "Отклонения и решения"]) {
    assert.match(strategy, new RegExp(escapeRegExp(tab)));
  }
  for (const title of ["Событий пока нет", "Проекты пока не созданы", "Целей и инициатив пока нет", "KPI пока не определены", "Отклонений и решений пока нет"]) {
    assert.match(strategy, new RegExp(escapeRegExp(title)));
  }
});

test("Wave 4 preserves reads, mutations and task refresh", () => {
  assert.match(strategy, /fetch\s*\(\s*["']\/api\/strategy["']/);
  assert.match(strategy, /fetch\s*\(\s*["']\/api\/strategy-actions["']/);
  assert.match(strategy, /["']x-arthello-role["']\s*:/);
  assert.match(strategy, /cache\s*:\s*["']no-store["']/);
  assert.match(strategy, /method\s*:\s*["']POST["']/);
  assert.match(strategy, /JSON\.stringify\s*\(\s*body\s*\)/);
  for (const action of ["createEvent", "recordEventResult", "updateKpiActual", "createCorrectiveTask", "closeDeviation"]) {
    assert.match(strategy, new RegExp(`action\\s*:\\s*["']${action}["']`));
  }
  for (const field of ["projectId", "title", "eventAt", "location", "budgetMinor"]) {
    assert.match(strategy, new RegExp(`${field}\\s*:`), `createEvent field ${field} is missing`);
  }
  assert.match(strategy, /await\s+load\s*\(\s*\)/);
  assert.match(strategy, /onTasksChanged\s*\(\s*\)/);
});

test("Wave 4 is isolated from the legacy strategy shell", () => {
  for (const legacy of ["strategy-workspace", "strategy-state", "strategy-heading", "strategy-kpis", "strategy-tabs", "strategy-panel", "manual-module-empty", "operational-empty-workspace"]) {
    assert.equal(strategy.includes(legacy), false, `Strategy still contains ${legacy}`);
  }
  assert.doesNotMatch(styles, /!important/i);
  assert.doesNotMatch(styles, /\[\s*class\s*[*^$]\s*=/i);
  assert.doesNotMatch(styles, /display\s*:\s*contents\b/i);
  assert.doesNotMatch(styles, /\bmargin(?:-[a-z-]+)?\s*:\s*-/i);
  const selectors = cssSelectors(styles);
  assert.ok(selectors.length > 0);
  for (const selector of selectors) assert.match(selector, /^\.ahStrategy/, `unscoped Strategy selector: ${selector}`);
  assert.match(styles, /var\(\s*--ah-registry-kpi-/);
  assert.match(styles, /overflow-x\s*:\s*auto/);
});

test("Wave 4 retires the final operational module patch", () => {
  assert.doesNotMatch(operationalPatch, /patch\s*\(/);
  assert.doesNotMatch(operationalPatch, /StrategyWorkspace\.tsx/);
});

test("Wave 4 production source contains no synthetic labels or fixed test references", () => {
  assert.doesNotMatch(strategy, /STR-PRJ-T-|ТЕСТОВАЯ СТРАТЕГИЯ|ТЕСТОВЫЙ КОНТУР|результатов пилота/i);
});
