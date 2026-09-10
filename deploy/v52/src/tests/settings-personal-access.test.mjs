import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canAccessApi, canAccessModule } from "../lib/access-policy.ts";
import { safeSettingsActionError } from "../lib/settings-error.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("manually assigned modules are enforced by the server and can expand read only", () => {
  const employee = { apiRole: "EMPLOYEE", isSystemOwner: false, allowedModules: ["finance"] };
  assert.equal(canAccessApi(employee, "/api/finance", "GET"), true);
  assert.equal(canAccessModule(employee, "finance"), true);
  assert.equal(canAccessApi(employee, "/api/finance-actions", "POST"), false);
  assert.equal(canAccessApi(employee, "/api/tasks", "GET"), false);
  assert.equal(canAccessApi(employee, "/api/tasks", "POST"), false);
  assert.equal(canAccessModule(employee, "tasks"), false);
  assert.equal(canAccessModule(employee, "access"), false, "self-service favorites must not grant access management");
  assert.equal(canAccessModule({ apiRole: "OWNER", isSystemOwner: true, allowedModules: ["finance"] }, "integrations"), false);
  assert.equal(canAccessApi({ apiRole: "OWNER", isSystemOwner: true, allowedModules: ["finance"] }, "/api/integrations", "GET"), false);
  assert.equal(canAccessApi({ apiRole: "OWNER", isSystemOwner: true, allowedModules: ["finance"] }, "/api/settings", "POST"), true);
});

test("user access and personal favorites are durable app-user fields", async () => {
  const [schema, database, auth] = await Promise.all([
    read("../db/schema.ts"),
    read("../db/index.ts"),
    read("../lib/production-auth.ts"),
  ]);
  for (const field of ["jobTitle", "allowedModules", "favoriteModules"]) {
    assert.match(schema, new RegExp(`${field}:`));
  }
  for (const column of ["job_title", "allowed_modules", "favorite_modules"]) {
    assert.match(database, new RegExp(column));
    assert.match(auth, new RegExp(column));
  }
  assert.match(auth, /allowedModules:/);
  assert.match(auth, /favoriteModules:/);
});

test("settings response does not expose manual business records", async () => {
  const route = await read("../app/api/settings/route.ts");
  const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(getHandler, /from\(manualRecords\)/);
  assert.doesNotMatch(getHandler, /\brecords[,\s]/);
});

test("settings sync history omits queued PII and one-time activation links", async () => {
  const route = await read("../app/api/settings/route.ts");
  const selection = route.slice(route.indexOf("const syncEvents"), route.indexOf("const accessHistory"));
  assert.match(selection, /db\.select\(\{/);
  assert.doesNotMatch(selection, /payload:|result:|lastError:/);
});

test("every settings mutation verifies origin, authenticated session and CSRF before parsing an action", async () => {
  const route = await read("../app/api/settings/route.ts");
  const postHandler = route.slice(route.indexOf("export async function POST"), route.indexOf("async function ensureBranches"));
  assert.ok(postHandler.indexOf("assertSameOriginMutation(request)") < postHandler.indexOf("request.json()"));
  assert.match(route, /hasTrustedMutationOrigin\(request, publicOrigin\)/);
  assert.match(route, /getAuthenticatedRequestContext\(request\)/);
  assert.match(route, /verifyAuthenticatedRequestCsrf\(request, authenticated\)/);
});

test("settings exposes only allowlisted action errors and never exception or SQL details", async () => {
  const route = await read("../app/api/settings/route.ts");
  const secret = "database-token-secret";
  const internal = safeSettingsActionError(new Error(`SQLITE_CONSTRAINT at users; token=${secret}`));
  assert.deepEqual(internal, {
    message: "Действие временно не выполнено",
    status: 500,
    expected: false,
  });
  assert.doesNotMatch(JSON.stringify(internal), new RegExp(secret));
  assert.deepEqual(
    safeSettingsActionError(new Error("Нет прав на выбранный филиал")),
    { message: "Нет прав на выбранный филиал", status: 403, expected: true },
  );
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
  assert.match(route, /console\.error\("settings\.(?:load|action)_failed"\)/);
});

test("reading settings never auto-grants diary access to administrative users", async () => {
  const route = await read("../app/api/settings/route.ts");
  const helper = route.slice(route.indexOf("async function ensureCanonicalOwnerSystemGrant"), route.indexOf("async function prepareExistingStaffEvent"));
  assert.match(helper, /user\.id !== "USR-OWNER"/);
  assert.match(helper, /user\.role !== "Собственник"/);
  assert.match(helper, /entry\.systemKey === "ARTHELLO_OS"/);
  assert.doesNotMatch(helper, /defaultSystems\.map|SCHOOL_SYSTEM_ID|director/);
  assert.doesNotMatch(route, /ensureAdministrativeSystemGrants/);
});

test("canonical owner can explicitly manage only their School diary grant", async () => {
  const [route, settings] = await Promise.all([
    read("../app/api/settings/route.ts"),
    read("../app/components/SettingsWorkspace.tsx"),
  ]);
  const action = route.slice(
    route.indexOf('if (action === "saveOwnerDiaryAccess")'),
    route.indexOf('if (action === "createBranch")'),
  );
  assert.match(action, /isCanonicalOwnerContext\(authenticated\)/);
  assert.match(action, /authenticated\.appUserId !== "USR-OWNER"/);
  assert.match(action, /eq\(userSystemAccess\.systemId, CENTRAL_SYSTEM_ID\)/);
  assert.match(action, /SCHOOL_SYSTEM_ID/);
  assert.match(action, /env\.DB\.batch/);
  assert.match(action, /authenticated\.accessVersion !== accessVersion/);
  assert.match(action, /UPDATE app_users SET updated_at=\?/);
  assert.match(action, /WHERE id=\? AND access_version=\? AND updated_at=\?/);
  assert.doesNotMatch(action, /SET access_version=|UPDATE user_system_access SET.*system_id|body\.userId/);
  assert.match(settings, /Настроить дневник/);
  assert.match(settings, /action: "saveOwnerDiaryAccess"/);
  assert.match(settings, /Меняется только разрешение на вход в дневник/);
});

test("settings keeps integrations, access and system verification together", async () => {
  const [settings, shell, catalog] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/ArtHelloShell.tsx"),
    read("../data/test-snapshot.ts"),
  ]);
  for (const label of ["Доступы", "Избранное", "Интеграции", "Проверка системы"]) {
    assert.match(settings, new RegExp(label));
  }
  assert.match(settings, /<IntegrationWorkspace/);
  assert.match(settings, /<ReadinessWorkspace/);
  assert.match(shell, /settingsTabForModule/);
  assert.match(shell, /settingsModuleIds/);
  assert.doesNotMatch(shell, /routedActive === "(?:access|integrations|acceptance)"/);
  assert.match(catalog, /label: "Проверка системы"/);
});

test("favorites are edited in a chosen order and synchronized for the current user", async () => {
  const [settings, route, shell] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
    read("../app/components/ArtHelloShell.tsx"),
  ]);
  assert.match(settings, /action: "saveFavorites"/);
  assert.match(settings, /favoriteModules/);
  assert.match(settings, /Переместить выше/);
  assert.match(route, /action === "saveFavorites"/);
  assert.match(route, /favoriteModules:/);
  assert.match(shell, /setFavoriteModules/);
  assert.match(shell, /favoriteModules\.filter/);
  assert.match(shell, /taskRecordLabel\(task\.id\)/);
});

test("staff editor uses a role preset, free-form position and manual module checkboxes", async () => {
  const [settings, access, route] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/AccessWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);
  for (const ui of [settings, access]) {
    assert.match(ui, /name="position"/);
    assert.match(ui, /name="allowedModules"/);
    assert.match(ui, /Шаблон роли/);
    assert.match(ui, /Ручная настройка разделов/);
  }
  assert.match(route, /allowedModules/);
  assert.match(route, /jobTitle/);
  assert.match(route, /env\.DB\.batch/);
});

test("existing login is immutable in UI and in the settings route", async () => {
  const [settings, access, route] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/AccessWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);
  assert.match(settings, /input readOnly value=\{user\.contact\}/);
  assert.match(access, /name="contact" value=\{user\.contact\} readOnly/);
  assert.match(route, /Логин существующего пользователя нельзя изменить/);
  assert.doesNotMatch(route, /db\.update\(appUsers\)\.set\(\{ contactType, contact,/);
});

test("system owner sessions cannot be reset through access management", async () => {
  const [settings, access, route] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/AccessWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);
  assert.match(route, /userId === me\.id \|\| userId === "USR-OWNER"/);
  assert.match(settings, /data\.canManage && user\.id !== data\.me\.id/);
  assert.match(access, /data\.canManage && selectedUser\.id !== data\.me\.id/);
});

test("technical position and diary-role codes have human labels", async () => {
  const [settings, access] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/AccessWorkspace.tsx"),
  ]);
  assert.match(settings, /humanPosition/);
  assert.match(settings, /systemRoleLabel/);
  assert.match(access, /humanPosition/);
  assert.match(access, /systemRoleLabel/);
});
