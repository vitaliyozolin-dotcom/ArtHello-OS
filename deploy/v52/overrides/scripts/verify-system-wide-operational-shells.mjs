import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`System-wide verification failed: ${label}`);
  }
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error(`System-wide verification failed: ${label}`);
  }
}

const shell = read("app/components/ArtHelloShell.tsx");
const help = read("app/components/ContextualHelpSystem.tsx");
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

for (const [name, source] of [
  ["HR", hr],
  ["Sales", sales],
  ["Content", content],
  ["Legal", legal],
  ["Integrations", integration],
]) {
  requireText(source, "createPortal", `${name} dialogs are not rendered above the mobile shell`);
}

requireText(content, "Все рабочие разделы доступны сразу", "content still collapses to one empty card");
requireText(legal, "Реестр, версии, контроль сроков", "legal workspace still collapses when empty");
requireText(analytics, "Все аналитические разделы доступны сразу", "analytics still collapses when empty");
requireText(readiness, "Визуальная проверка, сценарии", "readiness still collapses when empty");
requireText(accounting, "accounting-start-panel", "accounting tabs are hidden by an empty-state branch");
requireText(procurement, "Заявки, поставщики, склад, имущество", "procurement still collapses when empty");
requireText(food, "Партии, ТТК, производство, отгрузки и экономика остаются доступными", "food still collapses when empty");
requireText(safety, "Системы, оборудование, проверки, инциденты, ремонты", "safety still collapses when empty");
requireText(medical, "Контроль, документы, ограничения, случаи, действия и аудит", "medical still collapses when empty");
requireText(strategy, "Календарь, проекты, цели, KPI, прогнозы", "strategy still collapses when empty");

requireText(family, "Импорт не равен доступу", "family import boundary is missing");
requireText(polish, 'input[placeholder*="Найти семью"]', "family search readability rule is missing");
requireText(polish, 'button[data-ah-help-inline="true"]', "static field help styling is missing");
requireText(polish, ".crm-toolbar > div:last-child > button:first-child", "sales mobile action layout is missing");
requireText(polish, ".modal-layer.staff-modal-layer", "employee dialog safe-area styling is missing");
requireText(polish, ".hr-tabs", "system tab alignment rules are missing");

const productionSources = [procurement, food, safety, medical, strategy].join("\n");
forbid(productionSources, /Тестовый комплект для класса/, "hard-coded procurement test request remains");
forbid(productionSources, /SAFE-SYS-T-ACS-01|OBJ-T-002|ACT-SAFE-T-032/, "hard-coded safety test references remain");
forbid(productionSources, /MEDICAL_FULL_SYNTHETIC|ЗАЩИЩЁННАЯ ЗОНА · ТЕСТ/, "medical test labels remain");
forbid(productionSources, /ТЕСТОВАЯ СТРАТЕГИЯ|STR-PRJ-T-014/, "strategy test references remain");
forbid(productionSources, /ТЕСТОВЫЙ РЫНОК|ТЕСТОВЫЙ КОНТУР/, "production modules still advertise a test contour");

const componentsDir = fileURLToPath(new URL("../app/components/", import.meta.url));
const blocking = [];
for (const file of readdirSync(componentsDir).filter((name) => name.endsWith("Workspace.tsx"))) {
  const source = read(`app/components/${file}`);
  const pattern = /if\s*\([^;]{0,900}(?:\.length|has[A-Z][A-Za-z]+Data)[^;]{0,900}\)\s*return\s*(?:<>\s*)?<section[^;]{0,2600}manual-module-empty/gs;
  if (pattern.test(source)) blocking.push(file);
}
if (blocking.length) {
  throw new Error(`System-wide verification failed: blocking empty-state returns remain in ${blocking.join(", ")}`);
}

console.log("System-wide operational shell verification passed");
