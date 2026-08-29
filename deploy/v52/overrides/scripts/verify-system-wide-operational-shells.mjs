import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`System-wide verification failed: ${label}`);
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`System-wide verification failed: ${label}`);
}

const shell = read("app/components/ArtHelloShell.tsx");
const help = read("app/components/ContextualHelpSystem.tsx");
const helpCss = read("app/components/ContextualHelpSystem.css");
const helpDom = read("app/components/contextualHelpDom.ts");
const hr = read("app/components/HrWorkspace.tsx");
const sales = read("app/components/SalesWorkspace.tsx");
const family = read("app/components/FamilyWorkspace.tsx");
const content = read("app/components/ContentWorkspace.tsx");
const legal = read("app/components/LegalWorkspace.tsx");
const analytics = read("app/components/AnalyticsWorkspace.tsx");
const readiness = read("app/components/ReadinessWorkspace.tsx");
const accounting = read("app/components/AccountingWorkspace.tsx");
const procurement = read("app/components/ProcurementWorkspace.tsx");
const food = read("app/components/FoodWorkspace.tsx");
const safety = read("app/components/SafetyWorkspace.tsx");
const medical = read("app/components/MedicalWorkspace.tsx");
const strategy = read("app/components/StrategyWorkspace.tsx");
const integration = read("app/components/IntegrationWorkspace.tsx");
const polish = read("app/components/SystemWideMobilePolish.css");

requireText(shell, 'import "./SystemWideMobilePolish.css";', "global polish stylesheet is not loaded");
requireText(shell, "onOpenIntegrations={() => openModule(\"integrations\")}", "operational modules cannot open integrations");
requireText(help, "data-ah-help-inline=\"true\"", "field help markers are not anchored inline");
requireText(help, "createPortal", "inline field help is not portaled into labels");
requireText(helpDom, "inlineHelpTargetFor", "inline field help target discovery is missing");
forbid(help, /fieldMarkers\.map\(\(\{\s*field,\s*left,\s*top\s*\}\)/, "legacy floating field markers remain");

for (const [name, source] of [["HR", hr],["Sales", sales],["Content", content],["Legal", legal],["Integrations", integration]]) {
  requireText(source, "createPortal", `${name} dialogs are not rendered above the mobile shell`);
}

requireText(content, "Все рабочие разделы доступны сразу", "content still collapses to one empty card");
requireText(legal, "ahLegalPage", "legal workspace is not mounted on the design-system shell");
requireText(legal, "<PageContainer", "legal page container is missing");
requireText(legal, "<PageHeader", "legal page header is missing");
requireText(legal, "<Tabs", "legal tabs are hidden by an empty-state branch");
requireText(legal, "<KpiCard", "legal registry KPI cards are missing");
forbid(legal, /\blegal-workspace\b/, "legacy legal workspace wrapper remains");
forbid(legal, /if\s*\(\s*!\s*(?:hasData|hasLegalData)\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "legal workspace still collapses when empty");
requireText(analytics, "ahAnalyticsPage", "analytics workspace is not mounted on the design-system shell");
requireText(analytics, "<PageContainer", "analytics page container is missing");
requireText(analytics, "<PageHeader", "analytics page header is missing");
requireText(analytics, "<Tabs", "analytics tabs are hidden by an empty-state branch");
requireText(analytics, "<KpiCard", "analytics registry KPI cards are missing");
forbid(analytics, /\banalytics-workspace\b/, "legacy analytics workspace wrapper remains");
forbid(analytics, /if\s*\(\s*!\s*hasAnalyticsData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "analytics workspace still collapses when empty");
requireText(readiness, "ahReadinessPage", "readiness workspace is not mounted on the design-system shell");
requireText(readiness, "<PageContainer", "readiness page container is missing");
requireText(readiness, "<PageHeader", "readiness page header is missing");
requireText(readiness, "<Tabs", "readiness tabs are hidden by an empty-state branch");
requireText(readiness, "<KpiCard", "readiness registry KPI cards are missing");
forbid(readiness, /\breadiness-workspace\b/, "legacy readiness workspace wrapper remains");
forbid(readiness, /if\s*\(\s*!\s*hasReadinessData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "readiness workspace still collapses when empty");
requireText(accounting, "ahAccountingPage", "accounting workspace is not mounted on the design-system shell");
requireText(accounting, "<PageContainer", "accounting page container is missing");
requireText(accounting, "<PageHeader", "accounting page header is missing");
requireText(accounting, "<Tabs", "accounting tabs are hidden by an empty-state branch");
requireText(accounting, "<KpiCard", "accounting registry KPI cards are missing");
forbid(accounting, /\baccounting-workspace\b/, "legacy accounting workspace wrapper remains");
forbid(accounting, /if\s*\(\s*!\s*hasAccountingData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "accounting workspace still collapses when empty");
requireText(procurement, "ahProcurementPage", "procurement workspace is not mounted on the design-system shell");
requireText(procurement, "<PageContainer", "procurement page container is missing");
requireText(procurement, "<PageHeader", "procurement page header is missing");
requireText(procurement, "<Tabs", "procurement tabs are hidden by an empty-state branch");
requireText(procurement, "<KpiCard", "procurement registry KPI cards are missing");
forbid(procurement, /\bproc-workspace\b/, "legacy procurement workspace wrapper remains");
forbid(procurement, /if\s*\(\s*!\s*hasProcurementData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "procurement workspace still collapses when empty");
requireText(food, "ahFoodPage", "food workspace is not mounted on the design-system shell");
requireText(food, "<PageContainer", "food page container is missing");
requireText(food, "<PageHeader", "food page header is missing");
requireText(food, "<Tabs", "food tabs are hidden by an empty-state branch");
requireText(food, "<KpiCard", "food registry KPI cards are missing");
forbid(food, /\bfood-workspace\b/, "legacy food workspace wrapper remains");
forbid(food, /if\s*\(\s*!\s*hasFoodData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "food workspace still collapses when empty");
requireText(safety, "ahSafetyPage", "safety workspace is not mounted on the design-system shell");
requireText(safety, "<PageContainer", "safety page container is missing");
requireText(safety, "<PageHeader", "safety page header is missing");
requireText(safety, "<Tabs", "safety tabs are hidden by an empty-state branch");
requireText(safety, "<KpiCard", "safety registry KPI cards are missing");
forbid(safety, /\bsafety-workspace\b/, "legacy safety workspace wrapper remains");
forbid(safety, /if\s*\(\s*!\s*hasSafetyData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "safety workspace still collapses when empty");
requireText(medical, "ahMedicalPage", "medical workspace is not mounted on the design-system shell");
requireText(medical, "<PageContainer", "medical page container is missing");
requireText(medical, "<PageHeader", "medical page header is missing");
requireText(medical, "<Tabs", "medical tabs are hidden by an empty-state branch");
requireText(medical, "<KpiCard", "medical registry KPI cards are missing");
requireText(medical, "Нет счётчиков, списков, документов", "medical denied state can leak indirect data");
forbid(medical, /\bmedical-workspace\b/, "legacy medical workspace wrapper remains");
forbid(medical, /if\s*\(\s*!\s*hasMedicalData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "medical workspace still collapses when empty");
requireText(strategy, "ahStrategyPage", "strategy workspace is not mounted on the design-system shell");
requireText(strategy, "<PageContainer", "strategy page container is missing");
requireText(strategy, "<PageHeader", "strategy page header is missing");
requireText(strategy, "<Tabs", "strategy tabs are hidden by an empty-state branch");
requireText(strategy, "<KpiCard", "strategy registry KPI cards are missing");
forbid(strategy, /\bstrategy-workspace\b/, "legacy strategy workspace wrapper remains");
forbid(strategy, /if\s*\(\s*!\s*hasStrategyData\s*\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/, "strategy workspace still collapses when empty");
requireText(family, "Импорт не равен доступу", "family import boundary is missing");

requireText(polish, 'input[placeholder*="Найти семью"]', "family search readability rule is missing");
requireText(polish, 'button[data-ah-help-inline="true"]', "static field help styling is missing");
requireText(polish, ".crm-toolbar > div:last-child > button:first-child", "sales mobile action layout is missing");
requireText(polish, ".modal-layer.staff-modal-layer", "employee dialog safe-area styling is missing");
requireText(polish, ".hr-tabs", "system tab alignment rules are missing");
requireText(polish, "/* ARTHELLO_MOBILE_CANONICAL_V5 */", "canonical mobile design system is missing");
requireText(helpCss, "/* ARTHELLO_HELP_CANONICAL_V5 */", "canonical help styling is missing");
forbid(polish, /ARTHELLO_MOBILE_VISUAL_HELP_FOLLOWUP|ARTHELLO_OPERATIONAL_UX_V3|ARTHELLO_MOBILE_DESIGN_SYSTEM_V4|ARTHELLO_HELP_MARKER_RIGHT_EDGE/, "legacy mobile CSS layers remain after canonical cleanup");
forbid(helpCss, /ARTHELLO_HELP_UX_V3|ARTHELLO_HELP_VISIBILITY_V4/, "legacy help CSS layers remain after canonical cleanup");

const productionSources = [procurement, food, safety, medical, strategy, analytics, readiness].join("\n");
forbid(productionSources, /Тестовый комплект для класса/, "hard-coded procurement test request remains");
forbid(productionSources, /SAFE-SYS-T-ACS-01|OBJ-T-002|ACT-SAFE-T-032/, "hard-coded safety test references remain");
forbid(productionSources, /MEDICAL_FULL_SYNTHETIC|ЗАЩИЩЁННАЯ ЗОНА · ТЕСТ/, "medical test labels remain");
forbid(productionSources, /ТЕСТОВАЯ СТРАТЕГИЯ|STR-PRJ-T-014/, "strategy test references remain");
forbid(productionSources, /ОПУБЛИКОВАННЫЙ ТЕСТОВЫЙ СНИМОК|SCN-T-09|25\/25|84\/84/, "fixed analytics or readiness acceptance claims remain");
forbid(productionSources, /ТЕСТОВЫЙ РЫНОК|ТЕСТОВЫЙ КОНТУР/, "production modules still advertise a test contour");

const componentsDir = fileURLToPath(new URL("../app/components/", import.meta.url));
const blocking = [];
for (const file of readdirSync(componentsDir).filter((name) => name.endsWith("Workspace.tsx"))) {
  const source = read(`app/components/${file}`);
  const pattern = /if\s*\([^;]{0,900}(?:\.length|has[A-Z][A-Za-z]+Data)[^;]{0,900}\)\s*return\s*(?:<>\s*)?<section[^;]{0,2600}manual-module-empty/gs;
  if (pattern.test(source)) blocking.push(file);
}
if (blocking.length) throw new Error(`System-wide verification failed: blocking empty-state returns remain in ${blocking.join(", ")}`);

console.log("System-wide operational shell verification passed");
