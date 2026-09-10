import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const safety = read("../app/components/SafetyWorkspace.tsx");
const safetyStyles = read("../app/components/SafetyWorkspace.ds.css");
const medical = read("../app/components/MedicalWorkspace.tsx");
const medicalStyles = read("../app/components/MedicalWorkspace.ds.css");
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
  for (const action of actions) assert.match(source, new RegExp(`action\\s*:\\s*["']${escapeRegExp(action)}["']`), `${workspace} action ${action} was removed or renamed`);
}

function assertFormFields(source, fields, workspace) {
  for (const field of fields) assert.match(source, new RegExp(`name\\s*=\\s*["']${escapeRegExp(field)}["']`), `${workspace} field ${field} is missing`);
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
    } else if (char === "}") boundary = index + 1;
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

test("Wave 3 workspaces use the shared protected-operations shell", () => {
  assertDesignSystemImports(safety, "SafetyWorkspace");
  assertDesignSystemImports(medical, "MedicalWorkspace");
  assert.match(safety, /import\s*["']\.\/SafetyWorkspace\.ds\.css["']/);
  assert.match(medical, /import\s*["']\.\/MedicalWorkspace\.ds\.css["']/);
  assert.match(safety, /<PageContainer\b[^>]*className=["']ahSafetyPage["']/);
  assert.match(medical, /<PageContainer\b[^>]*className=["']ahMedicalPage["']/);
  assert.equal(occurrences(safety, /<KpiCard\b/g), 4);
  assert.equal(occurrences(medical, /<KpiCard\b/g), 4);
  assert.equal(occurrences(safety, /<Tabs\b/g), 1);
  assert.equal(occurrences(medical, /<Tabs\b/g), 1);
  assert.match(designSystem, /designSystemVersion\s*=\s*["']1\.3-protected-operations["']/);
});

test("Wave 3 keeps five working sections visible before the first record", () => {
  assert.match(safety, /\bhasSafetyData\b/);
  assert.match(medical, /\bhasMedicalData\b/);
  assert.doesNotMatch(safety, /if\s*\(\s*!\s*hasSafetyData\s*\)\s*return\b/);
  assert.doesNotMatch(medical, /if\s*\(\s*!\s*hasMedicalData\s*\)\s*return\b/);
  for (const tab of ["Контур", "Системы и оборудование", "Проверки и неисправности", "Инциденты и охрана", "Ремонты и документы"]) assert.match(safety, new RegExp(escapeRegExp(tab)));
  for (const tab of ["Контроль", "Документы", "Ограничения", "Случаи и действия", "Аудит просмотров"]) assert.match(medical, new RegExp(escapeRegExp(tab)));
});

test("Wave 3 preserves safety reads, mutations, dialogs and cross-module navigation", () => {
  assert.match(safety, /fetch\s*\(\s*["']\/api\/safety["']/);
  assert.match(safety, /fetch\s*\(\s*["']\/api\/safety-actions["']/);
  assert.match(safety, /["']x-arthello-role["']\s*:/);
  assert.match(safety, /cache\s*:\s*["']no-store["']/);
  assert.match(safety, /method\s*:\s*["']POST["']/);
  assert.match(safety, /JSON\.stringify\s*\(\s*body\s*\)/);
  assertActionContract(safety, ["recordIncident", "scheduleCheck", "createFaultTask", "completeRepair"], "SafetyWorkspace");
  assertFormFields(safety, ["systemId", "category", "severity", "description", "result", "actDocumentId", "responsibleEntityId"], "SafetyWorkspace");
  assert.match(safety, /\bcreatePortal\s*\(/);
  assert.match(safety, /document\.body/);
  assert.match(safety, /\bonOpenFinance\b/);
  assert.match(safety, /onTasksChanged\s*\(\s*\)/);
  assert.match(safety, /await\s+load\s*\(\s*\)/);
});

test("Wave 3 preserves medical actions and fails closed without special access", () => {
  assert.match(medical, /fetch\s*\(\s*["']\/api\/medical["']/);
  assert.match(medical, /fetch\s*\(\s*["']\/api\/medical-actions["']/);
  assert.match(medical, /["']x-arthello-role["']\s*:/);
  assert.match(medical, /cache\s*:\s*["']no-store["']/);
  assert.match(medical, /method\s*:\s*["']POST["']/);
  assert.match(medical, /JSON\.stringify\s*\(\s*body\s*\)/);
  assertActionContract(medical, ["confirmDocument", "completeAction", "closeCase"], "MedicalWorkspace");
  assert.match(medical, /Медицинский контур закрыт/);
  assert.match(medical, /Нет счётчиков, списков, документов, диагнозов или косвенных признаков/);
  assert.match(medical, /confirmationRef:\s*`Подтверждено медработником \$\{new Date\(\)\.toLocaleDateString\("ru-RU"\)\}`/);
  assert.doesNotMatch(medical, /MED-CONF:\$\{/);
  assert.match(medical, /await\s+load\s*\(\s*\)/);
});

test("Wave 3 components and styles are isolated from legacy workspaces", () => {
  for (const legacy of ["safety-workspace", "safety-state", "safety-heading", "safety-kpis", "safety-tabs", "safety-panel", "operational-empty-workspace", "manual-module-empty"]) assert.equal(safety.includes(legacy), false, `Safety still contains ${legacy}`);
  for (const legacy of ["medical-workspace", "medical-state", "medical-heading", "medical-kpis", "medical-tabs", "medical-panel", "operational-empty-workspace", "manual-module-empty"]) assert.equal(medical.includes(legacy), false, `Medical still contains ${legacy}`);
  assertIsolatedCss(safetyStyles, "Safety");
  assertIsolatedCss(medicalStyles, "Medical");
  assert.match(safetyStyles, /var\(\s*--ah-registry-kpi-/);
  assert.match(medicalStyles, /var\(\s*--ah-registry-kpi-/);
  assert.match(safetyStyles, /overflow-x\s*:\s*auto/);
  assert.match(medicalStyles, /overflow-x\s*:\s*auto/);
});

test("migrated operational patch blocks stay retired", () => {
  assert.equal(patchesFile(operationalPatch, "app/components/SafetyWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/MedicalWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/StrategyWorkspace.tsx"), false);
  assert.doesNotMatch(normalizeInputs, /patch-system-operational-modules\.mjs/);
});

test("Wave 3 production source contains no synthetic labels or fixed test references", () => {
  const source = `${safety}\n${medical}`;
  assert.doesNotMatch(source, /SAFE-SYS-T-|OBJ-T-|ACT-SAFE-T-|MEDICAL_FULL_SYNTHETIC|ЗАЩИЩЁННАЯ ЗОНА · ТЕСТ|ТЕСТОВЫЙ КОНТУР|MED-CONF-T-/i);
});
