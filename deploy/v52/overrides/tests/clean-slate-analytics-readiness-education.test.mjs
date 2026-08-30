import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("analytics empty mode has no phantom cash, snapshot or model source claims", () => {
  const api = read("../app/api/analytics/route.ts");
  const ui = read("../app/components/AnalyticsWorkspace.tsx");

  assert.match(api, /const isEmptyMode = dataMode === "empty"/);
  assert.match(api, /const openingBalanceMinor = isEmptyMode \? currentNetMinor : 120000000/);
  assert.doesNotMatch(api, /forecastCash\(forecastItems,\s*120000000\)/);
  assert.match(api, /sourceCoverage: isEmptyMode \? \{ fact: \[\], synthetic: \[\], unavailable: \[\] \}/);
  assert.match(api, /Аналитика строится только по сохранённым рабочим записям/);
  assert.match(api, /Модельные расчёты появятся только после подключения источника/);
  assert.match(ui, /\bhasAnalyticsData\b/);
  assert.doesNotMatch(ui, /if\s*\(\s*!\s*hasAnalyticsData\s*\)\s*return\b/);
  assert.doesNotMatch(ui, /isDemo|ОПУБЛИКОВАННЫЙ ТЕСТОВЫЙ СНИМОК/);
  assert.match(ui, /data\.owner\.cashPeriod/);
});

test("readiness empty mode returns no demo scenarios or fixed test matrix", () => {
  const api = read("../app/api/readiness/route.ts");
  const ui = read("../app/components/ReadinessWorkspace.tsx");
  const emptyGuard = api.indexOf('if (dataMode === "empty")');
  const firstScenarioQuery = api.indexOf('SELECT * FROM readiness_scenarios');
  const emptyResponse = api.slice(emptyGuard, firstScenarioQuery);

  assert.ok(emptyGuard > -1, "readiness empty-mode guard is missing");
  assert.ok(firstScenarioQuery > emptyGuard, "demo readiness rows are queried before the empty guard");
  assert.match(emptyResponse, /scenarios: \[\]/);
  assert.match(emptyResponse, /testLayers: \[\]/);
  assert.doesNotMatch(emptyResponse, /Unit|Browser compatibility|Тестовый контур|синтетическ/);
  assert.match(ui, /\bhasReadinessData\b/);
  assert.doesNotMatch(ui, /if\s*\(\s*!\s*hasReadinessData\s*\)\s*return\b/);
  assert.doesNotMatch(ui, /isDemo|SCN-T-09|Этап 19/);
});

test("education can create the first real program before the first group", () => {
  const api = read("../app/api/education/route.ts");
  const actions = read("../app/api/education-actions/route.ts");
  const ui = read("../app/components/EducationWorkspace.tsx");

  assert.match(api, /scope\.kind==="all"\?programs/);
  assert.match(actions, /action === "createProgram"/);
  assert.match(actions, /async function createProgram/);
  assert.match(actions, /sourceType: "MANUAL"/);
  assert.match(actions, /`PRG-M-\$\{crypto\.randomUUID/);
  assert.match(ui, /data\.programs\.length \? "group" : "program"/);
  assert.match(ui, /action: kind === "program" \? "createProgram"/);
  assert.match(ui, /Учебных программ пока нет/);
});

test("education CSV template contains headings and an empty row only", () => {
  const ui = read("../app/components/EducationWorkspace.tsx");
  const templateStart = ui.indexOf("function template()");
  const templateEnd = ui.indexOf("return <div", templateStart);
  const template = ui.slice(templateStart, templateEnd);

  assert.match(template, /type;name;branchId;programId;teacherId;room;childId;familyId;groupId;scheduledAt;topic;homework\\n;;;;;;;;;;;/);
  assert.doesNotMatch(template, /3Б|PRG-001|EMP-001|Кабинет 14/);
});
