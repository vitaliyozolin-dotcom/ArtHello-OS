import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const hr = read("../app/components/HrWorkspace.tsx");
const hrStyles = read("../app/components/HrWorkspace.ds.css");
const content = read("../app/components/ContentWorkspace.tsx");
const contentStyles = read("../app/components/ContentWorkspace.ds.css");
const foundation = read("../scripts/patch-system-foundation.mjs");
const dialogs = read("../scripts/patch-system-dialog-portals.mjs");

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

test("Wave 7 HR and content use the shared Design System shell", () => {
  for (const [name, source, className, stylesheet] of [
    ["HrWorkspace", hr, "ahHrPage", "HrWorkspace.ds.css"],
    ["ContentWorkspace", content, "ahContentPage", "ContentWorkspace.ds.css"],
  ]) {
    const names = importedNames(source, "./design-system");
    for (const component of ["Button", "Card", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "Tabs"]) {
      assert.ok(names.has(component), `${name} must import ${component}`);
    }
    assert.match(source, new RegExp(`import\\s*["']\\./${escapeRegExp(stylesheet)}["']`));
    assert.match(source, new RegExp(`<PageContainer\\b[^>]*className=["']${className}["']`));
    assert.equal(occurrences(source, /<KpiCard\b/g), 4);
    assert.equal(occurrences(source, /<Tabs\b/g), 1);
  }
});

test("Wave 7 keeps HR navigation and honest empty states visible", () => {
  for (const tab of ["Обзор", "Найм", "Сотрудники", "Развитие", "Увольнение"]) {
    assert.match(hr, new RegExp(escapeRegExp(tab)));
  }
  assert.doesNotMatch(hr, /if\s*\(\s*!\s*(?:data\.employees\.length|hasHrData)\s*\)\s*return\b/);
  assert.match(hr, /Связанных кадровых этапов пока нет/);
  assert.match(hr, /Вакансий и кандидатов пока нет/);
});

test("Wave 7 keeps content navigation and honest empty states visible", () => {
  for (const tab of ["Обзор", "Студия", "Контент-план", "Публикации", "До выручки", "Рекомендации"]) {
    assert.match(content, new RegExp(escapeRegExp(tab)));
  }
  assert.match(content, /\bhasContentData\b/);
  assert.doesNotMatch(content, /if\s*\(\s*!sourceOnly\s*&&\s*!hasContentData[\s\S]{0,40}?\)\s*return\b/);
  for (const text of ["Каналов и материалов пока нет", "Контент-план пока пуст", "Публикаций пока нет", "Сквозная цепочка пока не собрана", "Рекомендаций пока нет"]) {
    assert.match(content, new RegExp(escapeRegExp(text)));
  }
});

test("Wave 7 preserves HR reads, mutations, imports and document navigation", () => {
  assert.match(hr, /fetch\s*\(\s*["']\/api\/hr["']/);
  assert.match(hr, /fetch\s*\(\s*["']\/api\/hr-actions["']/);
  assert.match(hr, /["']x-arthello-role["']\s*:/);
  for (const action of ["advanceCandidate", "createOnboardingTask", "recordPersonnelEvent", "terminateEmployee", "createEmployee", "updateEmployee", "importEmployees"]) {
    assert.match(hr, new RegExp(`action\\s*:\\s*["']${action}["']`));
  }
  assert.match(hr, /function EmployeeModal/);
  assert.match(hr, /function ImportEmployeesModal/);
  assert.match(hr, /createPortal\s*\(/);
  assert.match(hr, /onOpenDocuments/);
  assert.match(hr, /onTasksChanged\s*\(\s*\)/);
});

test("Wave 7 preserves content actions, generation and source navigation", () => {
  assert.match(content, /fetch\s*\(\s*["']\/api\/content["']/);
  assert.match(content, /fetch\s*\(\s*["']\/api\/content-actions["']/);
  assert.match(content, /fetch\s*\(\s*["']\/api\/content-generate["']/);
  assert.match(content, /["']x-arthello-role["']\s*:/);
  for (const action of ["createPlanItem", "publishItem", "createRecommendationTask"]) {
    assert.match(content, new RegExp(`action\\s*:\\s*["']${action}["']`));
  }
  for (const callback of ["onOpenSales", "onOpenFinance", "onOpenIntegrations", "onTasksChanged"]) {
    assert.match(content, new RegExp(callback));
  }
  for (const field of ["scheduledAt", "accountId", "authorEntityId", "format", "campaignId", "topic", "brief"]) {
    assert.match(content, new RegExp(`name=["']${field}["']`));
  }
  assert.match(content, /createPortal\s*\(/);
});

test("Wave 7 is isolated from both legacy top-level shells", () => {
  for (const legacy of ['className="page hr-workspace"', "hr-heading", 'className="hr-kpis"', 'className="hr-tabs"']) {
    assert.equal(hr.includes(legacy), false, `HR still contains ${legacy}`);
  }
  for (const legacy of ['className="page content-workspace"', "content-heading", 'className="content-kpis"', 'className="content-tabs"']) {
    assert.equal(content.includes(legacy), false, `Content still contains ${legacy}`);
  }
  for (const [styles, prefix] of [[hrStyles, ".ahHr"], [contentStyles, ".ahContent"]]) {
    assert.doesNotMatch(styles, /!important/i);
    assert.doesNotMatch(styles, /\[\s*class\s*[*^$]\s*=/i);
    assert.doesNotMatch(styles, /display\s*:\s*contents\b/i);
    assert.doesNotMatch(styles, /\bmargin(?:-[a-z-]+)?\s*:\s*-/i);
    const selectors = cssSelectors(styles);
    assert.ok(selectors.length > 0);
    for (const selector of selectors) assert.match(selector, new RegExp(`^${escapeRegExp(prefix)}`), `unscoped selector: ${selector}`);
    assert.match(styles, /var\(\s*--ah-registry-kpi-mobile-/);
    assert.match(styles, /overflow-x\s*:\s*auto/);
  }
});

test("Wave 7 retires component-level dialog patching", () => {
  assert.match(foundation, /HrWorkspace Design System override already owns its dialog portals/);
  assert.match(dialogs, /ContentWorkspace Design System override already owns its dialog portal/);
  assert.match(foundation, /content integration navigation/);
});

test("Wave 7 production UI contains no fixed acceptance claims", () => {
  const sources = `${hr}\n${content}`;
  assert.doesNotMatch(sources, /CHAIN STATUS\s*·\s*PASS|ГОТОВО К ИТОГОВОЙ ПРОВЕРКЕ|SYNTHETIC TEST/i);
});
