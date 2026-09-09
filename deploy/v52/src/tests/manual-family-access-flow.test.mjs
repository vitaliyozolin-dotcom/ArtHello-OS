import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("manual family flows from creation through registry to an explicit access grant", async () => {
  const [familyApi, familyUi, registryApi, registryUi, policy, settingsApi, settingsUi, accessUi] = await Promise.all([
    read("../app/api/families/route.ts"),
    read("../app/components/FamilyWorkspace.tsx"),
    read("../app/api/entities/route.ts"),
    read("../app/components/RegistryWorkspace.tsx"),
    read("../lib/entity-provenance.ts"),
    read("../app/api/settings/route.ts"),
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/AccessWorkspace.tsx"),
  ]);

  for (const entityType of ["Семья", "Клиент", "Ребёнок"]) {
    assert.match(familyApi, new RegExp(`entityType:\"${entityType}\"[\\s\\S]*?status:\"Активна\"[\\s\\S]*?sourceSystem:\"MANUAL\"[\\s\\S]*?dataQuality:\"Проверено\"`));
  }
  assert.match(familyApi, /access:"not_granted"/);
  assert.match(registryApi, /entityDataState\(entity,/);
  assert.match(policy, /isManualEntitySource\(entity\.sourceSystem\)[\s\S]*?return "Создано вручную"/);
  assert.match(registryUi, /Создано вручную/);
  assert.match(settingsApi, /familyDataState\(family,[\s\S]*?duplicateCounts/);
  assert.match(settingsApi, /if \(familyNeedsReview\(family\)\)/);
  assert.match(settingsUi, /familyAccessNeedsReview\(family\)/);
  assert.match(accessUi, /familyAccessNeedsReview\(family\)/);
  assert.match(settingsUi, /Сам доступ всегда выдаётся здесь отдельным действием/);
  assert.match(familyUi, /Семья добавлена\. Доступ пока не выдан/);
});

test("import and duplicate reconciliation cannot be bypassed by manual provenance", async () => {
  const [familyApi, familyUi, settingsApi] = await Promise.all([
    read("../app/api/families/route.ts"),
    read("../app/components/FamilyWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);

  assert.match(familyApi, /duplicate\?"Требует сверки":isManual\?"Проверено":sourceConfirmed\?"Проверено":currentFamily\.dataQuality/);
  assert.match(familyUi, /detail\?\.hasDuplicate[\s\S]*?Самоподтверждение конфликт не снимает/);
  assert.match(familyUi, /family\?\.sourceSystem!=="MANUAL"[\s\S]*?name="sourceConfirmed"/);
  assert.match(settingsApi, /family\.sourceSystem !== "MANUAL" && family\.dataQuality !== "Проверено"/);
});
