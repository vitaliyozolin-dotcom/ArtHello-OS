import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../app/globals.css");
const tokens = read("../app/design-tokens.css");
const shell = read("../app/components/ArtHelloShell.tsx");
const integrations = read("../app/components/IntegrationWorkspace.tsx");
const education = read("../app/components/EducationWorkspace.tsx");
const finance = read("../app/components/FinanceWorkspace.tsx");
const registry = read("../app/components/RegistryWorkspace.tsx");
const ownerDashboard = read("../app/components/OwnerDashboard.tsx");
const ownerChart = read("../app/components/OwnerDashboardChart.module.css");
const ownerStyles = read("../app/components/OwnerDashboard.module.css");
const shellFoundation = read("../app/components/ShellFoundation.css");
const airyLayout = read("../app/components/AiryLayout.css");
const contentModern = read("../app/components/ContentModern.css");
const mobilePatch = read("../scripts/patch-mobile-design-system-v4.mjs");
const db = read("../db/index.ts");

test("design tokens expose the required semantic system", () => {
  for (const token of [
    "background", "surface", "surface-elevated", "surface-muted", "border", "border-strong",
    "text-primary", "text-secondary", "text-muted", "brand-primary", "brand-hover", "brand-active",
    "success", "warning", "danger", "info", "focus", "disabled",
  ]) assert.match(tokens, new RegExp(`--${token}:`), `missing --${token}`);
});

test("desktop typography and KPI cards do not depend on clipped microcopy", () => {
  assert.match(css, /content-frame[^\n]+font-size:max\(14px,1em\)/);
  assert.match(css, /metric-strip span,.metric-strip small\{overflow:visible;text-overflow:clip;white-space:normal/);
  assert.match(tokens, /--text-body:\s*1rem/);
  assert.match(tokens, /--font-ui:\s*"Onest"/);
  assert.match(css, /fonts\.googleapis\.com\/css2\?family=Onest/);
  assert.match(css, /body\{background:[^\n]+font-family:var\(--font-ui\)/);
  assert.match(css, /:where\(strong,b\)\{font-weight:500!important\}/);
  assert.match(ownerStyles, /\.kpiCopy strong,.operationHero strong\{font-weight:600!important\}/);
  assert.match(ownerStyles, /\.tableWrap table\{font-size:12px\}/);
  assert.match(ownerStyles, /\.kpiCopy small\{font-size:13px\}/);
  assert.match(shellFoundation, /\.nav-item\{min-height:36px;font-size:14px!important\}/);
  assert.match(css, /:not\(\[data-ah-compact-card\],\s*\[data-ah-compact-card\] \*\)\{font-size:15px!important\}/);
});

test("owner cash flow is a source-backed interactive chart instead of decorative lines", () => {
  assert.match(ownerDashboard, /finance\?\.monthly \?\? \[\]/);
  assert.match(ownerDashboard, /chartGeometry\.ticks\.map/);
  assert.match(ownerDashboard, /Фактическая динамика поступлений и списаний из ОДДС/);
  assert.match(ownerDashboard, /onMouseEnter=\{\(\) => setActiveChartIndex\(index\)\}/);
  assert.match(ownerDashboard, /navigate\("finance"\)/);
  assert.match(ownerChart, /\.gridLine/);
  assert.match(ownerChart, /\.chartTooltip/);
  assert.match(ownerDashboard, /C\$\{midpoint\.toFixed\(1\)\}/);
  assert.match(ownerDashboard, /const width = 720/);
  assert.match(ownerDashboard, /const left = 38/);
  assert.match(ownerDashboard, /const right = 8/);
  assert.match(ownerChart, /height: 184px/);
});

test("desktop shell uses one symmetric spacing rhythm and a split navigation rail", () => {
  assert.match(shell, /import "\.\/AiryLayout\.css"/);
  assert.match(airyLayout, /--shell-gap:\s*16px/);
  assert.match(airyLayout, /--shell-pad:\s*28px/);
  assert.match(airyLayout, /\.sidebar::before/);
  assert.match(airyLayout, /linear-gradient\(180deg, #6661fb 0%, #514cf0 100%\)/);
  assert.match(ownerStyles, /grid-template-columns:1\.05fr 1\.12fr 1\.62fr 1\.03fr/);
});

test("content studio shares the modern airy card system", () => {
  assert.match(shell, /import "\.\/ContentModern\.css"/);
  assert.match(contentModern, /content-studio\{grid-template-columns:minmax\(0,1\.05fr\) minmax\(420px,\.95fr\)/);
  assert.match(contentModern, /studio-placeholder\{flex:1;min-height:480px/);
  assert.match(contentModern, /border-radius:16px/);
});

test("mobile shell uses a dedicated composition with touch-sized controls", () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.mobile-dock\{position:fixed/);
  assert.match(css, /\.mobile-dock button\{height:50px/);
  assert.match(css, /\.top-icon-action\.create\{width:42px;height:42px\}/);
  assert.match(shell, /aria-label="Мобильная навигация"/);
});

test("mobile owner KPIs remain readable two-column cards", () => {
  assert.match(ownerDashboard, /owner-dashboard-kpis/);
  assert.match(ownerDashboard, /owner-dashboard-kpi-icon/);
  assert.match(ownerDashboard, /owner-dashboard-kpi-copy/);
  assert.match(mobilePatch, /owner-dashboard-kpis\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(mobilePatch, /owner-dashboard-kpi\{[^\n]*min-height:104px!important/);
  assert.match(mobilePatch, /owner-dashboard-kpi-copy\{display:grid!important/);
});

test("family search has one search affordance without detached inline help", () => {
  assert.doesNotMatch(mobilePatch, /content:"⌕"/);
  assert.match(mobilePatch, /input\[placeholder\*="Найти семью"\][^\n]*padding-right:16px!important/);
  assert.match(mobilePatch, /::before\{content:none!important;display:none!important\}/);
  assert.match(mobilePatch, /:has\(input\[placeholder\*="Найти семью"\]\)>button\[data-ah-help-inline=true\]\.ah-field-icon\{display:none!important\}/);
});

test("required personal dashboards have independent role profiles", () => {
  for (const role of ["Собственник", "Директор", "Финансы", "Продажи", "HR", "Кухня", "Сотрудник", "Представитель Виталия"]) {
    assert.match(shell, new RegExp(`"${role}": \\{`), `${role} dashboard profile is missing`);
  }
});

test("clients and methods are independent workspaces instead of shared placeholders", () => {
  assert.match(shell, /const FamilyWorkspace = lazy/);
  assert.match(shell, /active === "clients"/);
  assert.match(shell, /<FamilyWorkspace/);
  assert.match(education, /workspace\s*===\s*"methods"\s*\?\s*"Методики"\s*:\s*"Обучение"/);
  assert.match(shell, /<SalesWorkspace workspace="sales"/);
  assert.match(shell, /<EducationWorkspace key=\{active\} workspace=\{active\}/);
});

test("integration center exposes mandatory actions and selective import controls", () => {
  for (const label of [
    "Проверить соединение", "Запустить синхронизацию", "Посмотреть журнал", "Посмотреть ошибки",
    "Переподключить", "Отключить", "Какие данные получать", "Сохранить выбор и расписание",
  ]) assert.ok(integrations.includes(label), `${label} is missing`);
  assert.doesNotMatch(integrations, /Добавить тестовые данные/);
  assert.match(integrations, /dataScopes/);
  assert.match(integrations, /Каждый час/);
});

test("finance operation opens in a viewport portal and drills into linked entities without inventing family attribution", () => {
  assert.match(finance, /createPortal\(<div className="finance-drawer-layer"/);
  assert.match(finance, /className="operation-links lineage-section"/);
  assert.match(finance, /<EntityPanel key=\{linkedEntityId\}/);
  assert.doesNotMatch(finance, /FAM-T-014|Тестовая семья/);
  assert.match(finance, /Связанные данные/);
  assert.match(registry, /onNavigate\?\.\(relation\.peer\.id\)/);
  assert.match(db, /ensureFinanceEntityLinksBootstrap/);
  assert.match(css, /\.finance-drawer-layer,.registry-drawer-layer,.sales-drawer-layer,.workflow-drawer-layer,.drawer-layer,.integration-modal-layer\{position:fixed;inset:0;z-index:180/);
  assert.match(css, /place-items:center/);
});
