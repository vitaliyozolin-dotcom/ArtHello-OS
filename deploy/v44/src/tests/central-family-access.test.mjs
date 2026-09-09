import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("family access is granted centrally from the family card", async () => {
  const [settings, route, sync, schema] = await Promise.all([
    readFile(new URL("../app/components/SettingsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/family-access-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(settings, /Семьи и доступы/);
  assert.match(settings, /Пароль человек создаст сам по одноразовой ссылке/);
  assert.match(route, /grantFamilyAccess/);
  assert.match(route, /ArtHello OS — единый источник сотрудников, семей, родителей, учеников, классов/);
  assert.match(sync, /api\/internal\/family-access-sync/);
  assert.match(schema, /familySystemAccess/);
});
