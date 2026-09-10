import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const finance = read("../app/components/FinanceWorkspace.tsx");
const financeStyles = read("../app/components/FinanceWorkspace.ds.css");
const sales = read("../app/components/SalesWorkspace.tsx");
const salesStyles = read("../app/components/SalesWorkspace.ds.css");
const salesPatch = read("../scripts/patch-sales-operating-workspace.mjs");
const financePrepare = read("../scripts/prepare-help-finance-ux-v3.mjs");
const financePatch = read("../scripts/patch-help-finance-ux-v3.mjs");

const escapeRegExp = (value) => value.replace(/[.*+?^\$\{\}()|[\]\\]/g, "\\$&");

function importedNames(source, moduleName) {
  const match = source.match(new RegExp(`import\\s*\\{([^{}]*)\\}\\s*from\\s*["']${escapeRegExp(moduleName)}["']`));
  assert.ok(match, `named import from ${moduleName} is missing`);
  return new Set(match[1].split(",").map((name) => name.trim().split(/\\s+as\\s+/)[0]).filter(Boolean));
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function cssSelectors(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  let boundary = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === "{") {
      const prelude = clean.slice(boundary, index).trim();
      if (prelude && !prelude.startsWith("@")) {
        result.push(...prelude.split(",").map((selector) => selector.trim()).filter(Boolean));
      }
      boundary = index + 1;
    } else if (char === "}") {
      boundary = index + 1;
    }
  }
  return result.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector));
}

test("Wave 6 finance and sales use the shared Design System shell", () => {
  for (const [name, source, className, stylesheet] of [
    ["FinanceWorkspace", finance, "ahFinancePage", "FinanceWorkspace.ds.css"],
    ["SalesWorkspace", sales, "ahSalesPage", "SalesWorkspace.ds.css"],
  ]) {
    const names = importedNames(source, "./design-system");
    for (const component of ["Button", "Card", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "Tabs"]) {
      assert.ok(names.has(component), `${name} must import ${component}`);
    }
    assert.match(source, new RegExp(`import\\s*["']\\./${escapeRegExp(stylesheet)}["']`));
    assert.match(source, new RegExp(`<PageContainer\\b[^>]*className=["']${className}["']`));
    assert.equal(occurrences(source, /<KpiCard\b/g), 4);
    assert.equal(occurrences(source, /<Tabs\b/g), 1);
  }
});

test("Wave 6 exposes every core finance section before the first operation", () => {
  for (const tab of ["Реестр", "ДДС", "ОПиУ", "План и прогноз", "Начисления и долги", "Сверка"]) {
    assert.match(finance, new RegExp(escapeRegExp(tab)));
  }
  assert.doesNotMatch(finance, /if\s*\(\s*!\s*data\.operations\.length\s*\)\s*return\b/);
  assert.match(finance, /Операций за период пока нет/);
  assert.match(finance, /Math\.max\(1,\s*\.\.\.data\.monthly/);
  assert.match(finance, /ahFinancePeriod/);
});

test("Wave 6 keeps an explicit month selector above mobile finance KPIs", () => {
  const mobilePeriodIndex = finance.indexOf('className="ahFinancePeriod ahFinancePeriodMobile"');
  const kpiIndex = finance.indexOf('className="ahFinanceKpis"');
  assert.ok(mobilePeriodIndex >= 0, "mobile finance period selector is missing");
  assert.ok(mobilePeriodIndex < kpiIndex, "mobile finance period must appear before KPI values");
  assert.match(finance, /Период отчёта/);
  assert.match(finance, /aria-label="Месяц финансового отчёта"/);
  assert.match(finance, /className="ahFinancePeriod ahFinancePeriodDesktop"/);
  assert.doesNotMatch(financeStyles, /\.ahFinancePeriod\s*\{\s*display:\s*none/);
  assert.match(financeStyles, /@media \(max-width: 767px\)[\s\S]*\.ahFinancePeriodMobile \{\s*display: grid;/);
  assert.match(financeStyles, /\.ahFinancePeriodDesktop \{\s*display: none;/);
  assert.doesNotMatch(financeStyles, /data-ah-help-inline|ah-field-icon/);
});

test("Wave 6 exposes every core sales section before the first lead", () => {
  for (const tab of ["Воронка", "Лиды и контакты", "Сквозная цепочка", "Семьи и услуги", "LTV и лояльность"]) {
    assert.match(sales, new RegExp(escapeRegExp(tab)));
  }
  assert.match(sales, /\bhasSalesData\b/);
  assert.doesNotMatch(sales, /if\s*\(\s*!\s*data\.leads\.length\s*\)\s*return\b/);
  assert.match(sales, /Лидов и этапов пока нет/);
  assert.match(sales, /Сквозная цепочка пока не собрана/);
  assert.match(sales, /chainLead\s*\?/);
});

test("Wave 6 preserves finance reads, mutations, drill-down and audit trail", () => {
  assert.match(finance, /fetch\s*\(\s*`\/api\/finance\?period=\$\{period\}`/);
  assert.match(finance, /fetch\s*\(\s*["']\/api\/finance-actions["']/);
  assert.match(finance, /["']x-arthello-role["']\s*:/);
  assert.match(finance, /method\s*:\s*["']POST["']/);
  for (const action of ["addCorrection", "createIssueTask", "resolveIssue"]) {
    assert.match(finance, new RegExp(`action\\s*:\\s*["']${action}["']`));
  }
  assert.match(finance, /onTasksChanged\s*\(\s*\)/);
  assert.match(finance, /<EntityPanel\b/);
  assert.match(finance, /createPortal\s*\(/);
  assert.match(finance, /operationCorrections/);
});

test("Wave 6 preserves sales actions, source navigation and manual lead creation", () => {
  assert.match(sales, /fetch\s*\(\s*["']\/api\/sales["']/);
  assert.match(sales, /fetch\s*\(\s*["']\/api\/sales-actions["']/);
  assert.match(sales, /["']x-arthello-role["']\s*:/);
  for (const action of ["createLead", "advanceStage", "logTouchpoint", "createFollowupTask"]) {
    assert.match(sales, new RegExp(`action\\s*:\\s*["']${action}["']`));
  }
  assert.match(sales, /function LeadCreateModal/);
  assert.match(sales, /onOpenFinance/);
  assert.match(sales, /onOpenIntegrations/);
  assert.match(sales, /onTasksChanged\s*\(\s*\)/);
});

test("Wave 6 is isolated from both legacy top-level shells", () => {
  for (const legacy of ['className="page finance-page"', "finance-heading", "finance-source-boundary", 'className="finance-kpis"', 'className="finance-tabs"']) {
    assert.equal(finance.includes(legacy), false, `Finance still contains ${legacy}`);
  }
  for (const legacy of ['className="page sales-workspace"', "sales-heading", "sales-source-boundary", 'className="sales-kpis"', 'className="sales-tabs"']) {
    assert.equal(sales.includes(legacy), false, `Sales still contains ${legacy}`);
  }
  for (const [styles, prefix] of [[financeStyles, ".ahFinance"], [salesStyles, ".ahSales"]]) {
    assert.doesNotMatch(styles, /!important/i);
    assert.doesNotMatch(styles, /\[\s*class\s*[*^$]\s*=/i);
    assert.doesNotMatch(styles, /display\s*:\s*contents\b/i);
    assert.doesNotMatch(styles, /\bmargin(?:-[a-z-]+)?\s*:\s*-/i);
    const selectors = cssSelectors(styles);
    assert.ok(selectors.length > 0);
    for (const selector of selectors) assert.match(selector, new RegExp(`^${escapeRegExp(prefix)}`), `unscoped selector: ${selector}`);
    assert.match(styles, /var\(\s*--ah-registry-kpi-/);
    assert.match(styles, /overflow-x\s*:\s*auto/);
  }
});

test("Wave 6 retires component-level legacy patching without dropping integration setup", () => {
  assert.doesNotMatch(salesPatch, /const\s+salesTarget\b|let\s+sales\s*=|writeFileSync\(salesTarget/);
  assert.match(salesPatch, /complete source starter catalog/);
  assert.match(salesPatch, /ensureOperatingIntegrationCatalog/);
  assert.doesNotMatch(financePrepare, /readFileSync|writeFileSync|patch-help-finance-ux-v3\.mjs/);
  assert.doesNotMatch(financePatch, /app\/components\/FinanceWorkspace\.tsx|current finance period|visible finance period bar/);
});

test("Wave 6 production UI contains no synthetic snapshot or fixed pass claims", () => {
  const sources = `${finance}\n${sales}`;
  assert.doesNotMatch(sources, /SYNTHETIC TEST|CHAIN STATUS\s*·\s*PASS|MODEL STATUS\s*·\s*PASS|ГОТОВО К ИТОГОВОЙ ПРОВЕРКЕ/i);
});
