import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("shell and dashboard keep technical identifiers out of visible summaries", () => {
  const shell = read("../app/components/ArtHelloShell.tsx");
  const dashboard = read("../app/components/OwnerDashboard.tsx");
  const catalog = read("../data/test-snapshot.ts");

  assert.doesNotMatch(shell, /\?\?\s*branchId/);
  assert.match(dashboard, /humanFinanceClass\(operation\.reportClass\)/);
  assert.match(dashboard, /отчёт о прибылях и убытках/);
  assert.doesNotMatch(dashboard, /Проекты, KPI|"[^"\n]*ОДДС[^"\n]*"/);
  assert.match(catalog, /label: "Проекты и показатели"/);
  assert.doesNotMatch(catalog, /label: "Проекты и KPI"/);
});

test("family editor hides storage keys while preserving them in submitted fields", () => {
  const family = read("../app/components/FamilyWorkspace.tsx");

  assert.match(family, /Электронная почта/);
  assert.match(family, /type="hidden" name="operationIds"/);
  assert.doesNotMatch(family, /<textarea name="operationIds"/);
  assert.match(family, /extraProfileFields\(familyProfile/);
  assert.match(family, /restoreExtraLines\(String\(body\.familyOther/);
  assert.match(family, /isTechnicalProfileKey/);
  assert.match(family, /Дополнительный параметр/);
});

test("team views use readable paths, evidence and periods", () => {
  const hr = read("../app/components/HrWorkspace.tsx");

  assert.match(hr, /Настройки → Доступы/);
  assert.doesNotMatch(hr, /Настройки → Пользователи/);
  assert.match(hr, /humanHrEvidence\(x\.evidence\)/);
  assert.match(hr, /humanPeriodLabel\(x\.period\)/);
  assert.match(hr, /кадровой службы \$\{recordNumber\(reference\)\}/);
});

test("contractor and generic registries render readable record numbers", () => {
  const contractor = read("../app/components/ContractorWorkspace.tsx");
  const system = read("../app/components/SystemWorkspace.tsx");

  assert.match(contractor, /recordLabel\("Контрагент", row\.id\)/);
  assert.match(contractor, /humanReferenceLabel\(value, "Договор"\)/);
  assert.doesNotMatch(contractor, /placeholder="[^"]*\bID\b|\{row\.id\}\s*·/);
  assert.match(system, /recordLabel\(recordKinds\[module\], item\.id\)/);
  assert.match(system, /recordLabel\(recordKinds\[module\], selected\.id\)/);
  assert.match(system, /placeholder="Номер, объект, статус или ответственный"/);
  assert.doesNotMatch(system, /<small>\{item\.id\}<\/small>|<p>\{selected\.id\}<\/p>|История \$\{selected\.id\}/);
});

test("readiness seed uses full business names in visible scenario definitions", () => {
  const database = read("../db/index.ts");
  const start = database.indexOf("const scenarios:");
  const end = database.indexOf("const stepStatements", start);
  assert.ok(start >= 0 && end > start);
  const definitions = database.slice(start, end);

  for (const label of [
    "движение денег",
    "отчёт о прибылях и убытках",
    "адаптация",
    "электронный документооборот",
    "системы контроля доступа",
    "технологическая карта",
    "Показатель до нового результата",
  ]) assert.match(definitions, new RegExp(label, "i"));

  assert.doesNotMatch(definitions, /\["ДДС","Операция"\]|\["ОПиУ","Операция"\]|\["Онбординг","Задача"\]|\["ТТК","Рецепт"\]|\["KPI","KPI"\]/);
});
