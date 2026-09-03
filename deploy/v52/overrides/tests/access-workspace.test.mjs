import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ASSIGNABLE_APP_ROLES } from "../lib/access-policy.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("access management lives inside settings without a duplicate shell route", async () => {
  const [shell, settings, workspace] = await Promise.all([
    read("../app/components/ArtHelloShell.tsx"),
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/AccessWorkspace.tsx"),
  ]);
  assert.match(shell, /if \(id === "access"\) return "Доступы"/);
  assert.doesNotMatch(shell, /routedActive === "access"[\s\S]+<AccessWorkspace/);
  assert.match(settings, /tab === "Доступы"/);
  for (const label of ["Пользователи", "Семьи и ученики", "Роли и права", "Журнал"]) assert.match(workspace, new RegExp(label));
  for (const action of ["inviteUser", "blockUser", "restoreUser", "resetPassword", "grantFamilyAccess"]) assert.match(workspace, new RegExp(action));
});

test("access UI exposes safe lifecycle and server authorization boundary", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/components/AccessWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);
  assert.match(workspace, /История и связанные записи сохранятся/);
  assert.match(workspace, /каждое чтение и изменение обязано повторно проверяться на сервере/i);
  assert.match(api, /requireOwner\(canManage\)/);
  assert.match(api, /canManageAccess\(requestAccessContext\(request\)\)/);
  assert.match(api, /accessHistory/);
  assert.match(api, /like\(auditEvents\.action, "settings\.%"\)/);
});

test("blocking closes stale access card and updates the linked employee", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/components/AccessWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);
  assert.match(workspace, /employeeId: confirm\.user\.employeeId/);
  assert.match(workspace, /setSelectedUser\(null\)/);
  assert.match(api, /employeeId \|\| userId/);
  assert.match(workspace, /Дневник ещё не подключён/);
});

test("operating access roles cover administration, education and protected domains", async () => {
  const [api, policy] = await Promise.all([
    read("../app/api/settings/route.ts"),
    read("../lib/access-policy.ts"),
  ]);
  assert.match(api, /ASSIGNABLE_APP_ROLES/);
  assert.equal(ASSIGNABLE_APP_ROLES.includes("Собственник"), false);
  for (const role of ["Администратор", "Завуч", "Закупки", "Медработник", "Интеграции", "Аналитика", "Проекты"]) assert.match(policy, new RegExp(role));
});

test("access settings keep domain data entry outside permissions and use branded menus", async () => {
  const [workspace, settings, select] = await Promise.all([
    read("../app/components/AccessWorkspace.tsx"),
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/SoftSelect.tsx"),
  ]);
  assert.doesNotMatch(settings, /Первичный ввод/);
  assert.doesNotMatch(settings, /createManualRecord/);
  assert.doesNotMatch(`${workspace}\n${settings}`, /<select/);
  assert.match(`${workspace}\n${settings}`, /SoftSelect/);
  assert.match(select, /createPortal/);
  assert.match(select, /aria-haspopup="listbox"/);
  assert.match(select, /event\.key === "Escape"/);
});
