import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../app/components/OwnerDashboard.tsx");
const styles = read("../app/components/OwnerDashboard.module.css");
const globals = read("../app/globals.css");
const shell = read("../app/components/ArtHelloShell.tsx");
const authGate = read("../app/components/ProductionAuthGate.tsx");
const personalizationPatch = read("../scripts/patch-dashboard-personalization.mjs");
const mobileHelpPatch = read("../scripts/patch-mobile-visual-help-followup.mjs");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("owner dashboard does not collide with the analytics owner-dashboard grid", () => {
  assert.match(globals, /\.owner-dashboard,.money-analytics,.decision-run-grid\{display:grid/);
  assert.match(dashboard, /className=\{`\$\{styles\.dashboard\} owner-home-dashboard`\}/);
  assert.doesNotMatch(dashboard, /className=\{`\$\{styles\.dashboard\} owner-dashboard`\}/);
  assert.match(styles, /\.widgetGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(12, minmax\(0, 1fr\)\)/);
});

test("layout is versioned, isolated by canonical user and role, and validated", () => {
  assert.match(dashboard, /DASHBOARD_LAYOUT_VERSION,[\s\S]*?from "\.\.\/\.\.\/lib\/dashboard-layout"/);
  assert.match(dashboard, /DASHBOARD_STORAGE_PREFIX.*dashboard-layout:v/);
  assert.match(dashboard, /function dashboardStorageKey\(roleLabel: string, userKey: string\)/);
  assert.match(dashboard, /return dashboardBrowserStorageKey\(userKey, roleLabel, DASHBOARD_STORAGE_PREFIX\)/);
  assert.match(authGate, /userId:\s*string/);
  assert.match(shell, /userKey=\{authenticatedUser\?\.userId \?\? ""\}/);
  assert.match(dashboard, /userKey\?\.trim\(\) \|\| displayName\.trim\(\)/);
  assert.match(dashboard, /stored\.version !== DASHBOARD_LAYOUT_VERSION/);
  assert.match(dashboard, /allowed\.has\(candidate\.id\)/);
  assert.match(dashboard, /validSizes\.has\(candidate\.size\)/);
  assert.match(dashboard, /window\.localStorage\.setItem/);
  assert.match(dashboard, /customizableLayout = layout\.filter\(\(item\) => allowedVisibleWidgets\.has\(item\.id\) && widgetIsAvailable\(item\.id\)\)/);
  assert.match(dashboard, /visibleWidgets = customizableLayout\.filter\(\(item\) => item\.visible\)/);
});

test("every product role has a distinct source-backed home profile", () => {
  const appRoles = ["Собственник", "Представитель Виталия", "Директор", "Администратор", "Завуч", "Финансы", "Бухгалтерия", "Продажи", "Маркетинг", "HR", "Педагог", "Методист", "Кухня", "Закупки", "Безопасность", "Медработник", "Юрист", "Интеграции", "Аналитика", "Проекты", "Контроль качества", "Сотрудник"];
  for (const role of appRoles) assert.match(dashboard, new RegExp(`"${role}": \\{ title:`), `${role} has no explicit home profile`);
  assert.match(dashboard, /"Педагог":[^\n]+preferredModules: \["education", "methods", "tasks", "events"\][^\n]+widgets: \["roleFocus", "kpis", "milestones", "decisions"\]/);
  assert.match(dashboard, /"HR":[^\n]+preferredModules: \["hr", "registry", "tasks", "events"\][^\n]+widgets: \["kpis", "roleFocus", "decisions", "milestones"\]/);
  assert.match(dashboard, /"Кухня":[^\n]+preferredModules: \["food", "tasks", "events"\][^\n]+widgets: \["roleFocus", "kpis", "decisions", "milestones"\]/);
  assert.match(dashboard, /const byId = new Map\(availableModules\.map/);
  assert.match(dashboard, /if \(!moduleEntry\) return \[\]/);
  assert.match(dashboard, /onClick=\{\(\) => navigate\(moduleEntry\.id\)\}/);
  assert.match(shell, /availableModules=\{availableDashboardModules\}/);
  assert.match(shell, /\.filter\(\(moduleEntry\) => allowedModuleIds\.has\(moduleEntry\.id\)\)/);
});

test("non-finance roles do not request finance and KPI-only finance layouts still do", () => {
  assert.match(dashboard, /FINANCE_WIDGETS = new Set<DashboardWidgetId>\(\["kpis", "cashflow", "operations"\]\)/);
  assert.match(dashboard, /preset !== "work" && availableModuleIds\.has\("finance"\)/);
  assert.match(dashboard, /const needsFinance = canUseFinanceWidgets && layout\.some/);
  assert.match(dashboard, /if \(!needsFinance\) return;[\s\S]*?fetch\(`\/api\/finance/);
  assert.match(dashboard, /fetch\(`\/api\/finance\$\{periodQuery\}`/);
  assert.match(dashboard, /finance\.monthly\.filter\(\(item\) => cashPeriods\.has\(item\.period\)\)\.slice\(-12\)/);
  assert.match(dashboard, /label: "Поступления"[\s\S]*?module: "finance" as ModuleId/);
  assert.match(dashboard, /label: "Списания"[\s\S]*?module: "finance" as ModuleId/);
  assert.match(dashboard, /label: "Задолженность"[\s\S]*?module: "finance" as ModuleId/);
});

test("restricted roles get a full-width real task overview instead of an empty canvas", () => {
  assert.match(dashboard, /allowedDashboardWidgetIds\(roleLabel\)/);
  assert.match(dashboard, /const taskMetrics = \[/);
  assert.match(dashboard, /label: "Просрочено"[\s\S]*?openTasks\.filter/);
  assert.match(dashboard, /label: "Высокий приоритет"[\s\S]*?task\.priority/);
  assert.match(dashboard, /const metrics = canUseFinanceWidgets \? financeMetrics : taskMetrics/);
  assert.match(dashboard, /\{ id: "kpis"[\s\S]*?defaultSize: "full" \}/);
  assert.match(dashboard, /presetName === "work" && id === "decisions"\) size = "wide"/);
});

test("owner can show, hide, reorder and resize dashboard widgets", () => {
  assert.match(dashboard, /Настроить экран/);
  assert.equal((dashboard.match(/const \[selectedId, setSelectedId\] = useState\(""\)/g) ?? []).length, 1);
  assert.match(dashboard, /checked=\{item\.visible\}/);
  assert.match(dashboard, /function moveWidget\(/);
  assert.match(dashboard, /\[next\[index\], next\[nextIndex\]\] = \[next\[nextIndex\], next\[index\]\]/);
  assert.match(dashboard, /выше`}>↑<\/button>/);
  assert.match(dashboard, /ниже`}>↓<\/button>/);
  assert.match(dashboard, /<option value="compact">Компактный<\/option>/);
  assert.match(dashboard, /<option value="wide">Широкий<\/option>/);
  assert.match(dashboard, /<option value="full">На всю ширину<\/option>/);
  assert.match(styles, /\.sizeCompact\s*\{\s*grid-column:\s*span 4/);
  assert.match(styles, /\.sizeWide\s*\{\s*grid-column:\s*span 8/);
  assert.match(styles, /\.sizeFull\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.equal((dashboard.match(/function persistDashboardLayout\(/g) ?? []).length, 1);
  assert.equal((dashboard.match(/<path d=\{chartGeometry\.receiptsPath\}/g) ?? []).length, 1);
});

test("dashboard hydrates from the server and keeps a fast role-user local fallback", () => {
  assert.match(dashboard, /fetch\("\/api\/dashboard-layout", \{/);
  assert.match(dashboard, /credentials: "same-origin"/);
  assert.match(dashboard, /syncDashboardLayout\(method, widgets\)/);
  assert.match(dashboard, /queueServerLayoutSync\("PUT", next\)/);
  assert.match(dashboard, /queueServerLayoutSync\("DELETE"\)/);
  assert.match(dashboard, /x-csrf-token/);
  assert.match(dashboard, /layoutRevisionRef\.current !== startRevision/);
  assert.match(dashboard, /layoutRef\.current = next;[\s\S]*?setLayout\(next\)/);
  assert.doesNotMatch(dashboard, /setLayout\(\(current\) => \{[\s\S]*?queueServerLayoutSync/);
  assert.match(dashboard, /Экран синхронизирован/);
  assert.match(dashboard, /Сохранено локально/);
  assert.match(styles, /\.syncStatus_synced i/);
});

test("empty states stay compact and never invent production figures", () => {
  assert.match(styles, /\.inlineEmpty,[\s\S]*?min-height:\s*132px/);
  assert.doesNotMatch(styles, /\.inlineEmpty[^}]*min-height:\s*(?:[3-9]\d\d|[12]\d{3,})px/);
  assert.match(dashboard, /const financeValue = \(minor: number \| undefined, available: boolean\) => available/);
  assert.match(dashboard, /const hasDebtData = Boolean\(finance\?\.accruals\.length\)/);
  assert.match(dashboard, /const periodOperations = useMemo\(\(\) => finance\?\.operations\.filter\(\(operation\) => operation\.period === finance\.selectedPeriod\)/);
  assert.match(dashboard, /Записей: <strong>\{periodOperations\.length\}/);
  assert.match(dashboard, /Система не будет придумывать риски/);
  assert.match(dashboard, /milestones = useMemo\(\(\) => openTasks/);
});

test("calendar dates, registry interaction and rendering stay deterministic", () => {
  assert.equal((dashboard.match(/timeZone: MOSCOW_TIME_ZONE/g) ?? []).length >= 4, true);
  assert.match(dashboard, /if \(widget\.id === "operations"\) return/);
  assert.match(dashboard, /return null;\n  \}/);
  assert.match(dashboard, /role="button" aria-pressed=/);
  assert.match(dashboard, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(styles, /\.registrySearch:focus-within/);
});

test("deployment patches recognize the source-native personalized dashboard", () => {
  assert.match(personalizationPatch, /if \(!dashboard\.includes\('const MOSCOW_TIME_ZONE = "Europe\/Moscow";'\)\)/);
  assert.match(mobileHelpPatch, /if \(!source\.includes\("const DASHBOARD_STORAGE_PREFIX ="\)\)/);
  assert.match(mobileHelpPatch, /if \(!source\.includes\("export const DASHBOARD_GUIDE"\)\)/);
});

test("dashboard deployment patch pipeline is idempotent", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "arthello-dashboard-patch-"));
  const fixtureFiles = [
    "app/components/OwnerDashboard.tsx",
    "app/components/ArtHelloShell.tsx",
    "app/components/contextualHelpCatalog.ts",
    "app/components/SystemWideMobilePolish.css",
  ];
  try {
    for (const relativePath of fixtureFiles) {
      const destination = join(fixtureRoot, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(projectRoot, relativePath), destination);
    }
    const scripts = ["scripts/patch-dashboard-personalization.mjs", "scripts/patch-mobile-visual-help-followup.mjs"];
    const runPipeline = () => scripts.forEach((relativePath) => {
      const result = spawnSync(process.execPath, [join(projectRoot, relativePath)], {
        env: { ...process.env, ARTHELLO_PATCH_ROOT: fixtureRoot },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${relativePath} failed: ${result.stderr}`);
    });
    runPipeline();
    const first = fixtureFiles.map((relativePath) => readFileSync(join(fixtureRoot, relativePath), "utf8"));
    runPipeline();
    const second = fixtureFiles.map((relativePath) => readFileSync(join(fixtureRoot, relativePath), "utf8"));
    assert.deepEqual(second, first);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
