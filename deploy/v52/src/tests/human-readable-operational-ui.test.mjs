import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const workspaces = [
  "AccountingWorkspace",
  "AnalyticsWorkspace",
  "ContentWorkspace",
  "FinanceWorkspace",
  "FoodWorkspace",
  "MedicalWorkspace",
  "ProcurementWorkspace",
  "RegistryWorkspace",
].map((name) => read(`../app/components/${name}.tsx`));

test("operational workspaces use common human-readable record labels", () => {
  for (const source of workspaces) {
    assert.match(source, /lib\/record-labels/);
  }
  const rendered = workspaces.join("\n");
  assert.doesNotMatch(rendered, />TSK-|>CR-|placeholder="ID|>\{(?:document|operation|issue|request|supplier|asset|batch|shipment|medicalCase|entity)\.id\}</);
  assert.match(rendered, /taskRecordLabel/);
  for (const label of ["Договор", "Операция", "Карточка", "Публикация", "Проверка"]) {
    assert.match(rendered, new RegExp(label));
  }
});

test("image studio is restored on shared Design System surfaces", () => {
  const content = read("../app/components/ContentWorkspace.tsx");
  const styles = read("../app/components/ContentWorkspace.ds.css");
  assert.match(content, /aria-label="Студия создания изображений"/);
  assert.match(content, /className="ahCard content-panel studio-form"/);
  assert.match(content, /<Button type="submit" variant="primary"/);
  assert.match(styles, /\.ahContentPage \.content-studio\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(styles, /\.ahContentPage \.studio-form textarea:focus-visible/);
  assert.match(styles, /var\(--ah-color-primary\)/);
  assert.doesNotMatch(styles, /\.content-workspace/);
});

test("known technical audit remnants are no longer seeded or rendered", () => {
  const database = read("../db/index.ts");
  const analyticsRoute = read("../app/api/analytics/route.ts");
  const productionSources = `${database}\n${analyticsRoute}\n${workspaces.join("\n")}`;
  assert.doesNotMatch(productionSources, /rules-v0\.1|TEST-RULES-v0\.1|SUM\(payment amount\) по family_id|COUNT\(active family|2026-Q3|SAFE-031\/26|UPD-088\/26|["']FOOD-0821["']/i);
  assert.match(database, /Правила с ручным подтверждением/);
  assert.match(database, /3 квартал 2026/);
  assert.match(database, /human-readable-records-v1/);
});

test("strategy and education render human labels while keeping raw IDs for actions", () => {
  const strategy = read("../app/components/StrategyWorkspace.tsx");
  const education = read("../app/components/EducationWorkspace.tsx");

  assert.match(strategy, /recordLabel\("Проект", project\.id\)/);
  assert.match(strategy, /recordLabel\("Показатель", kpi\.id\)/);
  assert.match(strategy, /taskRecordLabel\(deviation\.relatedTaskId\)/);
  assert.match(strategy, /humanReferenceLabel\(project\.ownerEntityId, "Ответственный"\)/);
  assert.doesNotMatch(strategy, /<dd>\{project\.(?:initiativeId|budgetId|ownerEntityId)\}<\/dd>|<span>\{kpi\.id\}<\/span>|TSK-\{deviation\.relatedTaskId\}/);

  assert.match(education, /recordLabel\("Программа", item\.id\)/);
  assert.match(education, /recordLabel\("Занятие", row\.lessonId\)/);
  assert.match(education, /taskRecordLabel\(row\.relatedTaskId\)/);
  assert.match(education, /humanReferenceLabel\(row\.audienceId, "Получатель"\)/);
  assert.doesNotMatch(education, /<td>\{row\.lessonId\}<\/td>|<span>\{item\.id\}<\/span>|Задача TSK-/);

  assert.match(strategy, /kpiId: kpi\.id/);
  assert.match(education, /programId: item\.id/);
});

test("education editor offers named domain choices without exposing storage IDs", () => {
  const education = read("../app/components/EducationWorkspace.tsx");

  assert.doesNotMatch(education, /<input name="(?:methodistEntityId|teacherId|childId|familyId)"|<span>ID (?:методиста|педагога|ребёнка|семьи)<\/span>|placeholder="(?:EMP|CHD|FAM)-/);
  for (const field of ["methodistEntityId", "teacherId", "childId", "familyId"]) {
    assert.match(education, new RegExp(`<select name="${field}"`));
  }
  assert.match(education, /data\.groups\.map\(\(group\) => group\.teacherEntityId\)/);
  assert.match(education, /data\.lessons\.flatMap\(\(lesson\) => \[lesson\.teacherEntityId, lesson\.substituteEntityId\]\)/);
  assert.match(education, /data\.students\.map\(\(student\) => student\.childEntityId\)/);
  assert.match(education, /student\.childEntityId === selectedChildId/);
  assert.doesNotMatch(education, /Object\.entries\(data\.entityNames\)/);
  assert.match(education, /value=\{option\.id\}>\{option\.name\}/);
  assert.match(education, /Доступных педагогов пока нет/);
  assert.match(education, /Доступных карточек детей пока нет/);
  assert.match(education, /disabled=\{editorBlocked\}/);
});
