import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("branch context is role-assigned instead of client role simulation", async () => {
  const [shell, settings, schema] = await Promise.all([read("../app/components/ArtHelloShell.tsx"), read("../app/api/settings/route.ts"), read("../db/schema.ts")]);
  assert.match(shell, /aria-label="Выбрать филиал"/);
  assert.doesNotMatch(shell, /<option>Представитель Виталия<\/option>/);
  assert.match(settings, /isAdministrative/);
  assert.match(settings, /assertBranchAccess/);
  assert.match(schema, /organizationBranches/);
  assert.match(schema, /userBranchAccess/);
});

test("the operating branch directory matches the real ArtHello structure", async () => {
  const [settings, integrations] = await Promise.all([read("../app/api/settings/route.ts"), read("../app/components/IntegrationWorkspace.tsx")]);
  for (const branch of ["Атлас — садик", "Атлас — школа", "1–11", "Небо", "Лиственная"]) {
    assert.match(settings, new RegExp(branch));
    assert.match(integrations, new RegExp(branch));
  }
  assert.match(settings, /status: "Архив"[^\n]+"BR-EXTRA"/);
});

test("manual startup records are branch-scoped and cover required domains", async () => {
  const [settings, ui] = await Promise.all([read("../app/api/settings/route.ts"), read("../app/components/SettingsWorkspace.tsx")]);
  for (const label of ["Заработная плата", "ДДС", "ОПиУ", "Сотрудник", "Ребёнок", "Семья", "Класс или группа", "Занятие", "Дополнительное занятие"]) {
    assert.match(`${settings}\n${ui}`, new RegExp(label));
  }
  assert.match(settings, /branchId/);
  assert.match(settings, /manual_record\.created/);
});

test("technical card reuse banner and synthetic source choices are absent from operating cards", async () => {
  const registry = await read("../app/components/RegistryWorkspace.tsx");
  assert.doesNotMatch(registry, /Одна карточка используется в/);
  assert.doesNotMatch(registry, /<option>SYNTHETIC<\/option>/);
});

test("empty registries do not replace implemented workspaces", async () => {
  const shell = await read("../app/components/ArtHelloShell.tsx");
  assert.match(shell, /const manualFirstModules: ReadonlySet<ModuleId> = new Set\(\)/);
  for (const workspace of ["SalesWorkspace", "EducationWorkspace", "HrWorkspace", "LegalWorkspace", "AccountingWorkspace", "AnalyticsWorkspace"]) {
    assert.match(shell, new RegExp(`<${workspace}`));
  }
});

test("the verified site owner is reconciled with the administrative owner record", async () => {
  const settings = await read("../app/api/settings/route.ts");
  assert.match(settings, /ARTHELLO_OWNER_EMAILS/);
  assert.match(settings, /vitaliyozolin@gmail\.com/);
  assert.match(settings, /where\(eq\(appUsers\.id, "USR-OWNER"\)\)/);
  assert.match(settings, /isAdministrative: true/);
});
