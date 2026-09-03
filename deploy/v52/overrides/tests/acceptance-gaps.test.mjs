import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { accessibleModules, canAccessModule, resolveModuleRoute } from "../lib/access-policy.ts";
import { moduleCatalog } from "../data/test-snapshot.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const moduleIds = moduleCatalog.map((moduleEntry) => moduleEntry.id);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("RBAC acceptance: role menus and direct URLs fail closed, including the medical boundary", () => {
  const owner = { apiRole: "OWNER", isSystemOwner: true };
  const medicalWorker = { apiRole: "MEDICAL", isSystemOwner: false, canAccessMedical: true };
  const employee = { apiRole: "EMPLOYEE", isSystemOwner: false };
  const teacher = { apiRole: "TEACHER", isSystemOwner: false };

  assert.deepEqual(
    accessibleModules(owner, moduleIds),
    moduleIds.filter((moduleId) => moduleId !== "medical"),
    "canonical owner should control every ordinary module without automatically reading medical records",
  );
  assert.equal(canAccessModule(owner, "access"), true, "owner must be able to manage product access");
  assert.equal(canAccessModule(owner, "integrations"), true, "owner must be able to configure integrations");
  assert.equal(canAccessModule(owner, "medical"), false, "ownership is not an implicit medical grant");
  assert.equal(canAccessModule(medicalWorker, "medical"), true, "ROLE:MEDICAL is the explicit protected grant");
  assert.equal(canAccessModule(medicalWorker, "access"), false, "medical access does not confer owner authority");

  assert.deepEqual(accessibleModules(employee, moduleIds), ["home", "tasks", "events"]);
  assert.equal(canAccessModule(teacher, "education"), true);
  assert.equal(canAccessModule(teacher, "finance"), false);
  assert.equal(canAccessModule(teacher, "integrations"), false);

  assert.equal(resolveModuleRoute(teacher, "education", moduleIds), "education");
  assert.equal(resolveModuleRoute(teacher, "finance", moduleIds), "home");
  assert.equal(resolveModuleRoute(owner, "medical", moduleIds), "home");
  assert.equal(resolveModuleRoute({ apiRole: "OWNER", isSystemOwner: false }, "access", moduleIds), "home");
  assert.equal(resolveModuleRoute(employee, "not-a-real-module", moduleIds), "home");
});

test("RBAC acceptance: every shell discovery surface uses the same allow-list before rendering", async () => {
  const shell = await read("app/components/ArtHelloShell.tsx");
  const search = section(shell, "const searchResults = useMemo", "const routedActive");
  const navigation = section(shell, "const routedActive", "const renderNavItem");
  const routeStage = section(shell, '<div className="route-stage"', "</Suspense>");
  const palette = section(shell, "function CommandPalette", "function DetailDrawer");

  assert.match(shell, /const next = resolveModuleRoute\(accessContext, requested, knownModuleIds\)/);
  assert.match(shell, /if \(requested && next !== requested\) window\.history\.replaceState\([^\n]+"#home"\)/);
  assert.match(shell, /function openModule\([^)]*\) \{\s*const settingsTab = settingsTabForModule\(id\)/);
  assert.match(shell, /const next = isModuleAllowed\(id\) \? id : "home"/);
  assert.match(shell, /if \(next !== id\) setNotice\("Этот раздел не входит в права вашей роли"\)/);
  assert.match(shell, /const routedActive = isModuleAllowed\(active\) \? active : "home"/);
  assert.match(routeStage, /key=\{routedActive\}/);
  assert.doesNotMatch(routeStage, /\bactive\s*===/, "a stale forbidden state must never mount a workspace");

  assert.match(navigation, /const primaryNav = [^\n]+\.filter\(\(id\) => isModuleAllowed\(id\) && !settingsModuleIds\.has\(id\)\)/);
  assert.match(navigation, /const favoriteNav = favoriteModules\.filter\(\(id\) => isModuleAllowed\(id\) && !settingsModuleIds\.has\(id\)\)/);
  assert.match(navigation, /const extraNav = moduleCatalog\.filter\(\(item\) => isModuleAllowed\(item\.id\)/);
  assert.match(search, /moduleCatalog\s*\.filter\(\(module\) => isModuleAllowed\(module\.id\)\)/);
  assert.match(search, /entitySearchIndex\.filter\(\(item\) => isModuleAllowed\(item\.module\)/);
  assert.match(search, /isModuleAllowed\("tasks"\)/);

  assert.match(shell, /<CommandPalette tasks=\{tasks\} allowedModules=\{allowedModuleIds\}/);
  assert.match(palette, /moduleCatalog\.filter\(\(item\) => allowedModules\.has\(item\.id\)\)/);
  assert.match(palette, /entitySearchIndex\.filter\(\(item\) => allowedModules\.has\(item\.module\)\)/);
  for (const moduleId of ["tasks", "integrations", "analytics"]) {
    assert.match(palette, new RegExp(`allowedModules\\.has\\("${moduleId}"\\)`));
  }
  assert.match(shell, /className="mobile-dock"[\s\S]*?isModuleAllowed\("tasks"\)/);
  assert.match(shell, /isModuleAllowed\("integrations"\) \? <button className="freshness"/);
});

test("dashboard acceptance: the exact authenticated role reaches isolated role defaults", async () => {
  const [auth, gate, shell, dashboard] = await Promise.all([
    read("lib/production-auth.ts"),
    read("app/components/ProductionAuthGate.tsx"),
    read("app/components/ArtHelloShell.tsx"),
    read("app/components/OwnerDashboard.tsx"),
  ]);
  const authProjection = section(auth, "function authUserFromAccess", "function verifyCsrf");
  const home = section(shell, "function HomeView", "const manualTypesByModule");

  for (const field of ["userId", "appRole", "apiRole", "isAdministrative", "isSystemOwner", "canAccessMedical"]) {
    assert.match(auth, new RegExp(`${field}:`), `auth response must expose ${field}`);
    assert.match(gate, new RegExp(`${field}:`), `client auth type must preserve ${field}`);
  }
  assert.match(authProjection, /appRole:\s*access\.grant_role/);
  assert.match(authProjection, /apiRole/);
  assert.match(authProjection, /isSystemOwner:\s*isCanonicalOwnerAccess\(access\) && apiRole === "OWNER"/);
  assert.match(shell, /useState\(authenticatedUser\?\.appRole \?\? ""\)/);
  assert.doesNotMatch(shell, /useState\("Собственник"\)|authenticatedUser\?\.role \?\? "Собственник"/);
  assert.match(home, /dashboardProfiles\[role\] \?\? \{ label: role \|\| dashboardProfiles\.Сотрудник\.label \}/);
  assert.match(shell, /userKey=\{authenticatedUser\?\.userId \?\? ""\}/);
  assert.match(home, /userKey=\{userKey\}/);
  assert.match(home, /roleLabel=\{profile\.label\}/);

  assert.match(dashboard, /function rolePreset\(roleLabel: string\)/);
  assert.match(dashboard, /role\.includes\("собствен"\)[^\n]+return "owner"/);
  assert.match(dashboard, /role\.includes\("директор"\)[^\n]+return "director"/);
  assert.match(dashboard, /role\.includes\("финанс"\) \|\| role\.includes\("бухгал"\)[^\n]+return "finance"/);
  assert.match(dashboard, /return "work" as const/);
  assert.match(dashboard, /defaultDashboardLayout\(roleLabel\)/);
  assert.match(dashboard, /dashboardStorageKey\(roleLabel, dashboardUserKey\)/);
  assert.match(dashboard, /const canUseFinanceWidgets = preset !== "work"/);
  assert.match(dashboard, /if \(!needsFinance\) return;[\s\S]*?fetch\(`\/api\/finance/);
});

test("owner integration acceptance: bank key entry is direct, protected and never delegated to an administrator", async () => {
  const [workspace, helpDom, helpSystem, integrationsApi, actions] = await Promise.all([
    read("app/components/IntegrationWorkspace.tsx"),
    read("app/components/contextualHelpDom.ts"),
    read("app/components/ContextualHelpSystem.tsx"),
    read("app/api/integrations/route.ts"),
    read("app/api/integration-actions/route.ts"),
  ]);
  const wizard = section(workspace, "function ConnectionWizard", "function Empty");

  assert.match(integrationsApi, /const requester = await getAuthenticatedRequestContext\(request\)/);
  assert.match(integrationsApi, /if \(!readers\.has\(requester\.apiRole\)\)/);
  assert.match(integrationsApi, /const canManageCredentials = isCanonicalOwnerContext\(requester\)/);
  assert.doesNotMatch(integrationsApi, /getRequestUser|request\.headers\.get\("x-arthello-role"\)/);
  assert.match(integrationsApi, /Банковские ключи вводит только собственник/);
  assert.match(wizard, /canManageCredentials \? <label className="wide"><span>\{tochka \? "Ключ Точки" : "Токен Т‑Банка"\}<\/span><input type="password"/);
  assert.doesNotMatch(wizard, /ключ добавляет собственник/i);
  assert.match(workspace, /wizardId && data\.capabilities\.canManageSetup && currentBankCapability\(wizardId, data\.capabilities\)/);
  assert.match(workspace, /id === TOCHKA_CONNECTION_ID \? data\.capabilities\.canManageTochka/);
  assert.match(actions, /if \(!isCanonicalOwnerContext\(requester\)\)/);
  assert.match(actions, /Настройка и проверка Точки доступны только собственнику/);
  assert.match(actions, /verifyAuthenticatedRequestCsrf\(request, context\)/);
  assert.match(actions, /"revokeCredential"/);
  assert.match(workspace, />Удалить из ArtHello OS<\/button>/);
  assert.match(workspace, /Для прекращения его действия потребуется отдельно отозвать ключ в банке/);
  assert.doesNotMatch(`${wizard}\n${integrationsApi}\n${actions}`, /добав(?:ит|ляет|ить) администратор|переда(?:йте|ть)[^\n]{0,60}администратор/i);

  assert.match(wizard, /Один ключ Точки для выбранной карточки юрлица — не отдельный ключ на каждый счёт или филиал/);
  assert.match(wizard, /Все счета, разрешённые ключом Точки/);
  assert.match(wizard, /accountScope:\s*bank \? "all_permitted"/);
  assert.doesNotMatch(wizard, /<form[^>]*data-ah-help-root/);
  assert.match(helpDom, /if \(element\.closest\("\[data-ah-help-root\]"\)\) return false/);
  assert.doesNotMatch(helpSystem, /fieldMarkers|data-ah-help-inline|ah-field-icon/);
});

test("registry acceptance: self-entered cards show provenance, while only imports and conflicts need review", async () => {
  const [api, registry, policy] = await Promise.all([
    read("app/api/entities/route.ts"),
    read("app/components/RegistryWorkspace.tsx"),
    read("lib/entity-provenance.ts"),
  ]);
  const getHandler = section(api, "export async function GET", "export async function POST");
  const postHandler = section(api, "export async function POST", "export async function PATCH");

  assert.match(postHandler, /const dataQuality = initialEntityDataQuality\(sourceSystem\)/);
  assert.match(postHandler, /provenance:\s*isManualEntitySource\(sourceSystem\) \? "Создано вручную" : "Внешний источник"/);
  assert.match(getHandler, /const reviewStates = new Set|reviewStates\.has\(row\.dataQuality\)/);
  assert.match(api, /const reviewStates = new Set\(\["Требует сверки", "На проверке"\]\)/);
  assert.doesNotMatch(getHandler, /dataQuality !== "Проверено"/, "manual records must not be counted as unreviewed by exclusion");

  assert.match(policy, /if \(hasDuplicate \|\| entity\.dataQuality === "Требует сверки"\) return "Требует сверки"/);
  assert.match(policy, /if \(isManualEntitySource\(entity\.sourceSystem\)\) return "Создано вручную"/);
  assert.match(policy, /return entity\.dataQuality === "Проверено" \? "Проверено" : "На проверке"/);
  assert.match(registry, /источник записи — пользователь; статус карточки и доступ управляются отдельно/);
  assert.match(registry, /label="Нужна сверка"[^\n]+note="только импорт, интеграция или конфликт"/);
  assert.match(registry, /<th>Состояние данных<\/th>/);
  assert.match(registry, /отдельная самопроверка не нужна/);
  assert.match(registry, /Основание сверки с источником/);
  assert.doesNotMatch(registry, />Качество<|Любое качество|Фильтр по качеству/);
});
