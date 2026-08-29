import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const procurement = read("../app/components/ProcurementWorkspace.tsx");
const procurementStyles = read("../app/components/ProcurementWorkspace.ds.css");
const food = read("../app/components/FoodWorkspace.tsx");
const foodStyles = read("../app/components/FoodWorkspace.ds.css");
const operationalPatch = read("../scripts/patch-system-operational-modules.mjs");
const normalizeInputs = read("../scripts/normalize-system-patch-inputs.mjs");
const designSystem = read("../app/components/design-system/index.tsx");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function importedNames(source, moduleName) {
  const match = source.match(new RegExp(`import\\s*\\{([^{}]*)\\}\\s*from\\s*["']${escapeRegExp(moduleName)}["']`));
  assert.ok(match, `named import from ${moduleName} is missing`);
  return new Set(match[1].split(",").map((name) => name.trim().split(/\\s+as\\s+/)[0]).filter(Boolean));
}

function assertDesignSystemImports(source, workspace) {
  const names = importedNames(source, "./design-system");
  for (const name of ["Button", "Card", "CompactListCard", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "Tabs"]) {
    assert.ok(names.has(name), `${workspace} must import ${name}`);
  }
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function assertActionContract(source, actions, workspace) {
  for (const action of actions) {
    assert.match(source, new RegExp(`action\\s*:\\s*["']${escapeRegExp(action)}["']`), `${workspace} action ${action} was removed or renamed`);
  }
}

function assertFormFields(source, fields, workspace) {
  for (const field of fields) {
    assert.match(source, new RegExp(`name\\s*=\\s*["']${escapeRegExp(field)}["']`), `${workspace} field ${field} is missing`);
  }
}

function patchesFile(source, path) {
  return new RegExp(`patch\\s*\\(\\s*["']${escapeRegExp(path)}["']`).test(source);
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
    } else if (char === "}") {
      boundary = index + 1;
    }
  }
  return result.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector));
}

function assertIsolatedCss(source, scope) {
  assert.doesNotMatch(source, /!important/i);
  assert.doesNotMatch(source, /\[\s*class\s*[*^$]\s*=/i);
  assert.doesNotMatch(source, /display\s*:\s*contents\b/i);
  assert.doesNotMatch(source, /\bmargin(?:-[a-z-]+)?\s*:\s*-/i);
  const selectors = cssSelectors(source);
  assert.ok(selectors.length > 0);
  for (const selector of selectors) assert.match(selector, new RegExp(`^\\.ah${scope}`), `unscoped ${scope} selector: ${selector}`);
}

test("Wave 2 workspaces use the shared operational-registry shell", () => {
  assertDesignSystemImports(procurement, "ProcurementWorkspace");
  assertDesignSystemImports(food, "FoodWorkspace");
  assert.match(procurement, /import\s*["']\.\/ProcurementWorkspace\.ds\.css["']/);
  assert.match(food, /import\s*["']\.\/FoodWorkspace\.ds\.css["']/);
  assert.match(procurement, /<PageContainer\b[^>]*className=["']ahProcurementPage["']/);
  assert.match(food, /<PageContainer\b[^>]*className=["']ahFoodPage["']/);
  assert.equal(occurrences(procurement, /<KpiCard\b/g), 4);
  assert.equal(occurrences(food, /<KpiCard\b/g), 4);
  assert.equal(occurrences(procurement, /<Tabs\b/g), 1);
  assert.equal(occurrences(food, /<Tabs\b/g), 1);
  assert.match(designSystem, /designSystemVersion\s*=\s*["']1\.4-management-insight["']/);
});

test("Wave 2 does not collapse its navigation when data is empty", () => {
  assert.match(procurement, /\bhasProcurementData\b/);
  assert.match(food, /\bhasFoodData\b/);
  assert.doesNotMatch(procurement, /if\s*\(\s*!\s*hasProcurementData\s*\)\s*return\b/);
  assert.doesNotMatch(food, /if\s*\(\s*!\s*hasFoodData\s*\)\s*return\b/);
  for (const tab of ["Закупка", "Поставщики", "Склад", "Имущество", "Сквозная цепочка"]) assert.match(procurement, new RegExp(escapeRegExp(tab)));
  for (const tab of ["Сегодня", "Партии и склад", "ТТК и меню", "Отгрузки", "Экономика и проверки"]) assert.match(food, new RegExp(escapeRegExp(tab)));
});

test("Wave 2 preserves procurement reads, mutations, forms and navigation", () => {
  assert.match(procurement, /fetch\s*\(\s*["']\/api\/procurement["']/);
  assert.match(procurement, /fetch\s*\(\s*["']\/api\/procurement-actions["']/);
  assert.match(procurement, /["']x-arthello-role["']\s*:/);
  assert.match(procurement, /cache\s*:\s*["']no-store["']/);
  assert.match(procurement, /method\s*:\s*["']POST["']/);
  assert.match(procurement, /JSON\.stringify\s*\(\s*body\s*\)/);
  assertActionContract(procurement, ["createRequest", "approveRequest", "inventoryEvent", "createMaintenanceTask"], "ProcurementWorkspace");
  assertFormFields(procurement, ["requesterEntityId", "unit", "itemName", "quantity", "budgetRubles", "needBy", "justification"], "ProcurementWorkspace");
  assert.match(procurement, /budgetMinor\s*:\s*Math\.round/);
  assert.match(procurement, /approverEntityId/);
  assert.match(procurement, /\bcreatePortal\s*\(/);
  assert.match(procurement, /document\.body/);
  assert.match(procurement, /\bonOpenFinance\b/);
  assert.match(procurement, /await\s+load\s*\(\s*\)/);
  assert.match(procurement, /onTasksChanged\s*\(\s*\)/);
  assert.doesNotMatch(procurement, /Date\.now\s*\(/, "ProcurementWorkspace must stay pure during render");
});

test("Wave 2 preserves food reads, mutations and finance navigation", () => {
  assert.match(food, /fetch\s*\(\s*["']\/api\/food["']/);
  assert.match(food, /fetch\s*\(\s*["']\/api\/food-actions["']/);
  assert.match(food, /["']x-arthello-role["']\s*:/);
  assert.match(food, /cache\s*:\s*["']no-store["']/);
  assert.match(food, /method\s*:\s*["']POST["']/);
  assert.match(food, /JSON\.stringify\s*\(\s*body\s*\)/);
  assertActionContract(food, ["writeOffBatch", "createRecipeVersion", "createCheckTask"], "FoodWorkspace");
  assert.match(food, /\bonOpenFinance\b/);
  assert.match(food, /await\s+load\s*\(\s*\)/);
  assert.match(food, /onTasksChanged\s*\(\s*\)/);
  assert.match(food, /data-label=["']Отгружено["']/);
  assert.match(food, /data-label=["']Выручка["']/);
});

test("Wave 2 components and styles are isolated from legacy workspaces", () => {
  for (const legacy of ["proc-workspace", "proc-state", "proc-heading", "proc-kpis", "proc-tabs", "proc-panel", "operational-empty-workspace", "manual-module-empty"]) assert.equal(procurement.includes(legacy), false, `Procurement still contains ${legacy}`);
  for (const legacy of ["food-workspace", "food-state", "food-heading", "food-kpis", "food-tabs", "food-panel", "operational-empty-workspace", "manual-module-empty"]) assert.equal(food.includes(legacy), false, `Food still contains ${legacy}`);
  assertIsolatedCss(procurementStyles, "Procurement");
  assertIsolatedCss(foodStyles, "Food");
  assert.match(procurementStyles, /var\(\s*--ah-registry-kpi-/);
  assert.match(foodStyles, /var\(\s*--ah-registry-kpi-/);
  assert.match(foodStyles, /overflow-x\s*:\s*auto/);
});

test("migrated component patch blocks are retired and later operational patches remain", () => {
  assert.equal(patchesFile(operationalPatch, "app/components/ProcurementWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/FoodWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/SafetyWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/MedicalWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/StrategyWorkspace.tsx"), false);
  assert.doesNotMatch(normalizeInputs, /patch-system-operational-modules\.mjs/);
});

test("Wave 2 source contains no synthetic production labels", () => {
  const source = `${procurement}\n${food}`;
  assert.doesNotMatch(source, /Тестовый комплект|ТЕСТОВЫЙ|ТЕСТОВАЯ|PRJ-T-|CFR-T-|по тестовым складам/i);
});
