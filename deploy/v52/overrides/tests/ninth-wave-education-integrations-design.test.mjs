import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const education = read("../app/components/EducationWorkspace.tsx");
const educationStyles = read("../app/components/EducationWorkspace.ds.css");
const integrations = read("../app/components/IntegrationWorkspace.tsx");
const integrationStyles = read("../app/components/IntegrationWorkspace.ds.css");

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
      if (prelude && !prelude.startsWith("@")) result.push(...prelude.split(",").map((selector) => selector.trim()).filter(Boolean));
      boundary = index + 1;
    } else if (char === "}") {
      boundary = index + 1;
    }
  }
  return result.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector));
}

test("Wave 9 education and integrations use the shared Design System shell", () => {
  const educationNames = importedNames(education, "./design-system");
  for (const component of ["Button", "Card", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "Tabs"]) assert.ok(educationNames.has(component), `EducationWorkspace must import ${component}`);
  const integrationNames = importedNames(integrations, "./design-system");
  for (const component of ["Button", "Card", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "SearchField", "Tabs"]) assert.ok(integrationNames.has(component), `IntegrationWorkspace must import ${component}`);
  assert.match(education, /import\s*["']\.\/EducationWorkspace\.ds\.css["']/);
  assert.match(integrations, /import\s*["']\.\/IntegrationWorkspace\.ds\.css["']/);
  assert.match(education, /<PageContainer\b[^>]*className=["']ahEducationPage["']/);
  assert.match(integrations, /<PageContainer\b[^>]*className=["']ahIntegrationPage["']/);
  assert.equal(occurrences(education, /<KpiCard\b/g), 4);
  assert.equal(occurrences(integrations, /<KpiCard\b/g), 4);
  assert.equal(occurrences(education, /<Tabs\b/g), 2);
  assert.equal(occurrences(integrations, /<Tabs\b/g), 1);
  assert.equal(occurrences(integrations, /<SearchField\b/g), 1);
});

test("Wave 9 keeps the full education navigation, reads and mutations", () => {
  assert.match(education, /fetch\s*\(\s*["']\/api\/education["']/);
  assert.match(education, /fetch\s*\(\s*["']\/api\/education-actions["']/);
  for (const tab of ["Структура", "Сегодня", "Журнал", "Прогресс", "Программы", "Семья и коммуникации"]) assert.match(education, new RegExp(escapeRegExp(tab)));
  for (const action of ["createProgram", "createGroup", "createLesson", "enrollStudent", "recordAttendance", "createProgramVersion", "createFeedbackTask", "importEducationRows"]) assert.match(education, new RegExp(`["']${action}["']`));
  for (const field of ["title", "scope", "methodistEntityId", "expectedResult", "materialRef", "name", "branchId", "programId", "teacherId", "groupId", "childId", "familyId"]) assert.match(education, new RegExp(`name=["']${field}["']`));
  assert.match(education, /Учебных данных пока нет/);
  assert.match(education, /data-ah-compact-card=["']true["']/);
});

test("Wave 9 keeps all integration views, setup boundaries and operations", () => {
  assert.match(integrations, /fetch\s*\(\s*["']\/api\/integrations["']/);
  assert.match(integrations, /fetch\s*\(\s*["']\/api\/integration-actions["']/);
  for (const tab of ["Контур", "Каталог", "Журнал", "Конфликты", "Авторизация"]) assert.match(integrations, new RegExp(escapeRegExp(tab)));
  for (const action of ["retrySync", "resumeConnection", "pauseConnection", "createConflictTask", "resolveConflict", "saveSetup"]) assert.match(integrations, new RegExp(`["']${action}["']`));
  for (const boundary of ["БЕЗ СЕКРЕТОВ", "Секрет не запрашивается", "защищённую переменную"]) assert.match(integrations, new RegExp(escapeRegExp(boundary), "i"));
  assert.equal(integrations.includes("if (!data.connections.length)"), false, "empty integrations must keep the common header, KPI and tabs visible");
  assert.match(integrations, /Подключения появятся после добавления источника/);
});

test("Wave 9 is isolated from both legacy top-level shells", () => {
  for (const legacy of ['className="page edu-workspace"', "edu-heading", 'className="edu-kpis"', 'className="edu-tabs"']) assert.equal(education.includes(legacy), false, `Education still contains ${legacy}`);
  for (const legacy of ['className="page integration-workspace"', "integration-heading", 'className="integration-kpis"', 'className="integration-tabs"', 'className="integration-toolbar"']) assert.equal(integrations.includes(legacy), false, `Integrations still contains ${legacy}`);

  for (const [styles, prefix] of [[educationStyles, ".ahEducation"], [integrationStyles, ".ahIntegration"]]) {
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

test("Wave 9 keeps education tables and integration boards contained on mobile", () => {
  assert.match(educationStyles, /@media\s*\(max-width:\s*720px\)/);
  assert.match(educationStyles, /tbody\s+tr\s*\{[\s\S]*?display\s*:\s*grid/);
  assert.match(educationStyles, /overflow-x\s*:\s*visible/);
  assert.match(integrationStyles, /@media\s*\(max-width:\s*720px\)/);
  assert.match(integrationStyles, /integration-catalog[\s\S]*?grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
});

test("Wave 9 production UI contains no fixed acceptance claims", () => {
  const sources = `${education}\n${integrations}`;
  assert.doesNotMatch(sources, /CHAIN STATUS\s*·\s*PASS|ГОТОВО К ИТОГОВОЙ ПРОВЕРКЕ|SYNTHETIC TEST/i);
});
