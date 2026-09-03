import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_ROLES, API_RULES, APP_ROLE_DEFINITIONS, accessibleModules, canAccessApi, canAccessModule, canManageAccess, permissionForRole, registryCapabilities, resolveModuleRoute } from "../lib/access-policy.ts";
import { moduleCatalog } from "../data/test-snapshot.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const moduleIds = moduleCatalog.map((moduleEntry) => moduleEntry.id);

test("canonical owner receives every ordinary module while medical remains separately granted", () => {
  const owner = { apiRole: "OWNER", isSystemOwner: true };
  const visible = accessibleModules(owner, moduleIds);

  assert.equal(visible.includes("medical"), false, "ownership must not auto-disclose protected health records");
  assert.deepEqual(visible, moduleIds.filter((moduleId) => moduleId !== "medical"));
  assert.equal(canAccessModule({ apiRole: "OWNER", isSystemOwner: false }, "access"), false);
});

test("role navigation exposes only modules whose production reads can succeed", () => {
  const employee = { apiRole: "EMPLOYEE", isSystemOwner: false };
  assert.equal(canAccessModule(employee, "home"), true);
  assert.equal(canAccessModule(employee, "tasks"), true);
  assert.equal(canAccessModule(employee, "events"), true);
  assert.equal(canAccessModule(employee, "finance"), false);
  assert.equal(canAccessModule(employee, "access"), false);

  const teacher = { apiRole: "TEACHER", isSystemOwner: false };
  assert.equal(canAccessModule(teacher, "education"), true);
  assert.equal(canAccessModule(teacher, "methods"), true);
  assert.equal(canAccessModule(teacher, "clients"), false);
  assert.equal(canAccessModule(teacher, "integrations"), false);

  const finance = { apiRole: "FINANCE", isSystemOwner: false };
  for (const moduleId of ["finance", "accounting", "sales", "procurement", "food", "safety", "projects", "analytics", "contractors", "integrations"]) {
    assert.equal(canAccessModule(finance, moduleId), true, `${moduleId} should be visible to FINANCE`);
  }
  for (const moduleId of ["education", "hr", "content", "access", "acceptance"]) {
    assert.equal(canAccessModule(finance, moduleId), false, `${moduleId} should be hidden from FINANCE`);
  }

  assert.equal(canAccessModule({ apiRole: "ANALYTICS", isSystemOwner: false }, "acceptance"), false);
  assert.equal(canAccessModule({ apiRole: "QUALITY", isSystemOwner: false }, "acceptance"), true);
  assert.equal(canAccessModule({ apiRole: "MEDICAL", isSystemOwner: false }, "medical"), false);
  assert.equal(canAccessModule({ apiRole: "MEDICAL", isSystemOwner: false, canAccessMedical: true }, "medical"), true);
});

test("unknown or stale roles fail closed to the safe home screen", () => {
  const stale = { apiRole: "VIEWER", isSystemOwner: false };
  assert.deepEqual(accessibleModules(stale, moduleIds), ["home"]);
});

test("registry controls mirror the write permissions enforced by the proxy", () => {
  const owner = registryCapabilities({ apiRole: "OWNER", isSystemOwner: true });
  assert.deepEqual(owner, { create: true, edit: true, relation: true, document: true, merge: true });
  assert.deepEqual(registryCapabilities({ apiRole: "FINANCE", isSystemOwner: false }), { create: false, edit: false, relation: false, document: false, merge: false });
  assert.deepEqual(registryCapabilities({ apiRole: "HR", isSystemOwner: false }), { create: false, edit: false, relation: false, document: true, merge: false });
  assert.deepEqual(registryCapabilities({ apiRole: "LEGAL", isSystemOwner: false }), { create: false, edit: false, relation: false, document: true, merge: false });
  assert.deepEqual(registryCapabilities({ apiRole: "ACCOUNTING", isSystemOwner: false }), { create: false, edit: false, relation: false, document: true, merge: false });
  assert.deepEqual(registryCapabilities({ apiRole: "PROCUREMENT", isSystemOwner: false }), { create: false, edit: false, relation: false, document: true, merge: false });
});

test("direct hashes resolve to an allowed module or the safe home screen", () => {
  const teacher = { apiRole: "TEACHER", isSystemOwner: false };
  assert.equal(resolveModuleRoute(teacher, "education", moduleIds), "education");
  assert.equal(resolveModuleRoute(teacher, "finance", moduleIds), "home");
  assert.equal(resolveModuleRoute(teacher, "not-a-module", moduleIds), "home");

  const owner = { apiRole: "OWNER", isSystemOwner: true };
  assert.equal(resolveModuleRoute(owner, "medical", moduleIds), "home");
  assert.equal(resolveModuleRoute({ apiRole: "OWNER", isSystemOwner: false }, "access", moduleIds), "home");
});

test("medical API is denied before the general owner bypass and remains role-granted", async () => {
  const owner = { apiRole: "OWNER", isSystemOwner: true };
  assert.equal(canAccessApi(owner, "/api/medical", "GET"), false);
  assert.equal(canAccessApi(owner, "/api/medical-actions", "POST"), false);
  assert.equal(canAccessApi({ apiRole: "DIRECTOR", isSystemOwner: false }, "/api/medical", "GET"), false);
  assert.equal(canAccessApi({ apiRole: "MEDICAL", isSystemOwner: false }, "/api/medical", "GET"), false);
  assert.equal(canAccessApi({ apiRole: "MEDICAL", isSystemOwner: false, canAccessMedical: true }, "/api/medical", "GET"), true);
  assert.equal(canAccessApi(owner, "/api/finance", "GET"), true);

  const proxy = await read("../proxy.ts");
  assert.match(proxy, /import \{ canAccessApi \} from "\.\/lib\/access-policy"/);
  assert.match(proxy, /canAccessApi\(context\.auth\.user, pathname, request\.method\)/);
  assert.deepEqual(API_RULES.find(({ prefix }) => prefix === "/api/medical-actions")?.write, ["MEDICAL"]);
  assert.deepEqual(API_RULES.find(({ prefix }) => prefix === "/api/medical")?.read, ["MEDICAL"]);
});

test("shell applies the same role filter to menus, search, commands and hash navigation", async () => {
  const shell = await read("../app/components/ArtHelloShell.tsx");

  assert.match(shell, /canAccessModule/);
  assert.match(shell, /resolveModuleRoute/);
  assert.match(shell, /allowedModuleIds/);
  assert.match(shell, /const primaryNav = [^\n]+\.filter\(\(id\) => isModuleAllowed\(id\) && !settingsModuleIds\.has\(id\)\)/);
  assert.match(shell, /const favoriteNav = favoriteModules\.filter\(\(id\) => isModuleAllowed\(id\) && !settingsModuleIds\.has\(id\)\)/);
  assert.match(shell, /moduleCatalog[\s\S]*?\.filter\(\(module\) => isModuleAllowed\(module\.id\)\)/);
  assert.match(shell, /allowedModules=\{allowedModuleIds\}/);
  assert.match(shell, /availableModules=\{availableDashboardModules\}/);
  assert.match(shell, /const next = resolveModuleRoute\(accessContext, requested, knownModuleIds\)/);
  assert.match(shell, /const routedActive = isModuleAllowed\(active\) \? active : "home"/);
  assert.match(shell, /history\.replaceState\([^\n]+#home/);
  assert.doesNotMatch(shell, /useState\("Собственник"\)/);
  assert.doesNotMatch(shell, /useState\(true\)/);
});

test("registry renders only actions allowed to the authenticated API role", async () => {
  const [shell, registry] = await Promise.all([
    read("../app/components/ArtHelloShell.tsx"),
    read("../app/components/RegistryWorkspace.tsx"),
  ]);

  assert.match(shell, /registryCapabilities\(accessContext\)/);
  assert.match(shell, /<RegistryWorkspace notify=\{setNotice\} capabilities=\{registryAccess\}/);
  assert.match(registry, /capabilities\.create \? <Button[\s\S]*?>Новая карточка<\/Button> : undefined/);
  assert.match(registry, /capabilities\.edit \? <button[\s\S]*?>Редактировать<\/button> : null/);
  assert.match(registry, /capabilities\.relation \? <button[\s\S]*?>\+ Связь<\/button> : null/);
  assert.match(registry, /capabilities\.document \? <button[\s\S]*?>\+ Документ<\/button> : null/);
  assert.match(registry, /capabilities\.merge \? <button[\s\S]*?>Объединить дубль<\/button> : null/);
  assert.match(registry, /capabilities\?\.\[localAction\]/);
});

test("authenticated identity carries exact product authority into the shell", async () => {
  const [auth, gate, me, shell, settingsApi, accessWorkspace] = await Promise.all([
    read("../lib/production-auth.ts"),
    read("../app/components/ProductionAuthGate.tsx"),
    read("../app/api/auth/me/route.ts"),
    read("../app/components/ArtHelloShell.tsx"),
    read("../app/api/settings/route.ts"),
    read("../app/components/AccessWorkspace.tsx"),
  ]);

  for (const field of ["userId", "appRole", "apiRole", "isAdministrative", "isSystemOwner", "canAccessMedical"]) {
    assert.match(auth, new RegExp(`${field}:`));
    assert.match(gate, new RegExp(`${field}:`));
  }
  assert.match(auth, /isCanonicalOwnerAccess/);
  assert.match(auth, /app_user_id === "USR-OWNER"/);
  assert.match(auth, /grant_role === "Собственник"/);
  assert.match(auth, /medical_access_granted/);
  assert.match(auth, /valid_until\s*>=\s*date\('now'\)/);
  assert.match(me, /context\.auth\.user/);
  assert.match(shell, /userKey=\{authenticatedUser\?\.userId/);
  assert.match(settingsApi, /ASSIGNABLE_APP_ROLES/);
  assert.match(settingsApi, /existing\?\.id === "USR-OWNER"/);
  assert.match(settingsApi, /Роль собственника нельзя назначить/);
  assert.match(accessWorkspace, /APP_ROLE_DEFINITIONS/);
});

test("proxy, navigation and displayed role matrix share one typed policy", async () => {
  const [proxy, shell, accessWorkspace, settingsApi] = await Promise.all([
    read("../proxy.ts"),
    read("../app/components/ArtHelloShell.tsx"),
    read("../app/components/AccessWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);

  assert.equal(APP_ROLE_DEFINITIONS.length, 21);
  for (const roleName of ["Бухгалтерия", "Продажи", "Маркетинг", "Кухня", "Закупки", "Безопасность", "Юрист", "Интеграции", "Аналитика", "Проекты", "Контроль качества"]) {
    assert.equal(APP_ROLE_DEFINITIONS.some(({ appRole }) => appRole === roleName), true, `${roleName} must have a policy template`);
  }
  assert.equal(permissionForRole("DIRECTOR", "access"), "Нет доступа");
  assert.equal(permissionForRole("ADMIN", "access"), "Нет доступа");
  assert.equal(permissionForRole("HR", "access"), "Нет доступа");
  assert.equal(permissionForRole("FINANCE", "clients"), "Нет доступа");
  assert.equal(permissionForRole("FINANCE", "hr"), "Нет доступа");
  assert.equal(permissionForRole("FINANCE", "legal"), "Нет доступа");
  assert.equal(permissionForRole("TEACHER", "clients"), "Нет доступа");
  assert.equal(canManageAccess({ apiRole: "OWNER", isSystemOwner: true }), true);
  assert.equal(canManageAccess({ apiRole: "DIRECTOR", isSystemOwner: false }), false);

  assert.match(proxy, /from "\.\/lib\/access-policy"/);
  assert.match(shell, /from "\.\.\/\.\.\/lib\/access-policy"/);
  assert.match(accessWorkspace, /from "\.\.\/\.\.\/lib\/access-policy"/);
  assert.match(accessWorkspace, /permissionForRole\(definition\.apiRole, moduleId\)/);
  assert.match(settingsApi, /canManageAccess\(requestAccessContext\(request\)\)/);
  assert.doesNotMatch(settingsApi, /canManage:\s*me\.isAdministrative/);
  assert.match(settingsApi, /requireOwner\(canManage\)/);
});

test("every authenticated role can persist only its own role-scoped dashboard layout", () => {
  const rule = API_RULES.find(({ prefix }) => prefix === "/api/dashboard-layout");
  assert.deepEqual(rule?.read, [...API_ROLES]);
  assert.deepEqual(rule?.write, [...API_ROLES]);
  for (const apiRole of API_ROLES) {
    const context = { apiRole, isSystemOwner: apiRole === "OWNER", canAccessMedical: apiRole === "MEDICAL" };
    assert.equal(canAccessApi(context, "/api/dashboard-layout", "GET"), true);
    assert.equal(canAccessApi(context, "/api/dashboard-layout", "PUT"), true);
    assert.equal(canAccessApi(context, "/api/dashboard-layout", "DELETE"), true);
  }
});
