import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const legal = read("../app/components/LegalWorkspace.tsx");
const legalStyles = read("../app/components/LegalWorkspace.ds.css");
const accounting = read("../app/components/AccountingWorkspace.tsx");
const accountingStyles = read("../app/components/AccountingWorkspace.ds.css");
const shell = read("../app/components/ArtHelloShell.tsx");
const designSystem = read("../app/components/design-system/index.tsx");
const tokens = read("../app/components/design-system/tokens.css");
const contractorStyles = read("../app/components/ContractorWorkspace.ds.css");

const normalizeInputs = read("../scripts/normalize-system-patch-inputs.mjs");
const contentLegalPatch = read("../scripts/patch-system-content-legal.mjs");
const dialogPortalsPatch = read("../scripts/patch-system-dialog-portals.mjs");
const operationalPatch = read("../scripts/patch-system-operational-modules.mjs");
const foundationPatch = read("../scripts/patch-system-foundation.mjs");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function importedNames(source, moduleName) {
  const modulePattern = escapeRegExp(moduleName);
  const match = source.match(new RegExp(`import\\s*\\{([^{}]*)\\}\\s*from\\s*["']${modulePattern}["']`));
  assert.ok(match, `named import from ${moduleName} is missing`);
  return new Set(match[1]
    .split(",")
    .map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
    .filter(Boolean));
}

function assertDesignSystemImports(source, workspace) {
  const names = importedNames(source, "./design-system");
  for (const name of ["Button", "Card", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "Tabs"]) {
    assert.ok(names.has(name), `${workspace} must import ${name} from the shared Design System`);
  }
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function assertActionContract(source, actions, workspace) {
  for (const action of actions) {
    assert.match(
      source,
      new RegExp(`action\\s*:\\s*["']${escapeRegExp(action)}["']`),
      `${workspace} action ${action} was removed or renamed`,
    );
  }
}

function assertFormFields(source, fields, workspace) {
  for (const field of fields) {
    assert.match(
      source,
      new RegExp(`name\\s*=\\s*["']${escapeRegExp(field)}["']`),
      `${workspace} form field ${field} is missing`,
    );
  }
}

function componentTag(source, component) {
  const matches = source.match(new RegExp(`<${component}\\b[\\s\\S]*?\\/>`, "g")) ?? [];
  assert.equal(matches.length, 1, `ArtHelloShell must render exactly one ${component}`);
  return matches[0];
}

function patchesFile(source, path) {
  return new RegExp(`patch\\s*\\(\\s*["']${escapeRegExp(path)}["']`).test(source);
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

function assertIsolatedCss(source, scope) {
  assert.doesNotMatch(source, /!important/i, `${scope} CSS must not use !important`);
  assert.doesNotMatch(source, /\[\s*class\s*[*^$]\s*=/i, `${scope} CSS must not use wildcard class selectors`);
  assert.doesNotMatch(source, /display\s*:\s*contents\b/i, `${scope} CSS must not erase component boxes`);
  assert.doesNotMatch(source, /\bmargin(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?\s*:\s*-\s*(?:\d|\.)/i, `${scope} CSS must not use negative margins`);
  assert.doesNotMatch(source, /\.(?:page|legal-|accounting-|operational-|manual-)/, `${scope} CSS must not reach legacy workspaces`);

  const selectors = cssSelectors(source);
  assert.ok(selectors.length > 0, `${scope} CSS must contain scoped rules`);
  for (const selector of selectors) {
    assert.match(selector, new RegExp(`^\\.ah${scope}`), `unscoped ${scope} selector: ${selector}`);
  }
}

function assertNoLegacyWorkspaceClasses(source, forbidden, workspace) {
  for (const className of forbidden) {
    assert.equal(source.includes(className), false, `${workspace} still contains legacy class ${className}`);
  }
}

function staticClassTokens(source) {
  const tokens = [];
  let cursor = 0;

  while ((cursor = source.indexOf("className", cursor)) !== -1) {
    const tagEnd = source.indexOf(">", cursor);
    if (tagEnd === -1) break;
    const expression = source.slice(cursor, tagEnd);
    for (const match of expression.matchAll(/(["'`])([\s\S]*?)\1/g)) {
      tokens.push(...match[2].split(/\s+/).filter(Boolean));
    }
    cursor = tagEnd + 1;
  }

  return tokens;
}

function assertNoLegacyClassTokens(source, workspace) {
  const forbidden = staticClassTokens(source).filter((token) => (
    token === "page"
    || token === "primary-action"
    || /^(?:legal|accounting|operational|manual)-/.test(token)
  ));
  assert.deepEqual([...new Set(forbidden)], [], `${workspace} contains legacy class tokens`);
}

test("Wave 1 workspaces are built from shared Design System primitives", () => {
  assertDesignSystemImports(legal, "LegalWorkspace");
  assertDesignSystemImports(accounting, "AccountingWorkspace");

  assert.match(legal, /import\s*["']\.\/LegalWorkspace\.ds\.css["']/);
  assert.match(accounting, /import\s*["']\.\/AccountingWorkspace\.ds\.css["']/);

  assert.match(legal, /<PageContainer\b[^>]*className\s*=\s*["']ahLegalPage["']/);
  assert.match(accounting, /<PageContainer\b[^>]*className\s*=\s*["']ahAccountingPage["']/);
  assert.match(legal, /title\s*=\s*["']Юридический контур["']/);
  assert.match(accounting, /title\s*=\s*["']Бухгалтерия и первичка["']/);

  assert.equal(occurrences(legal, /<KpiCard\b/g), 4, "Legal must expose the four approved KPIs in its shared shell");
  assert.equal(occurrences(legal, /<Tabs\b/g), 1, "Legal must have one shared tab controller");
  assert.equal(occurrences(accounting, /<KpiCard\b/g), 4, "Accounting must expose the four approved KPIs");
  assert.equal(occurrences(accounting, /<Tabs\b/g), 1, "Accounting must have one shared tab controller");

  assert.match(legal, /<EmptyState\b[\s\S]*?density\s*=\s*["']compact["']/);
  assert.match(accounting, /<EmptyState\b[\s\S]*?density\s*=\s*["']compact["']/);
});

test("Wave 1 components are isolated from legacy workspace typography", () => {
  assertNoLegacyWorkspaceClasses(legal, [
    "page legal-workspace",
    "legal-state",
    "legal-heading",
    "legal-heading-actions",
    "legal-boundary",
    "legal-kpis",
    "legal-tabs",
    "legal-panel",
    "legal-panel-head",
    "legal-registry",
    "legal-create-layer",
    "legal-create-modal",
    "operational-empty-workspace",
    "operational-inline-empty",
    "manual-module-empty",
    "primary-action",
  ], "LegalWorkspace");

  assertNoLegacyWorkspaceClasses(accounting, [
    "page accounting-workspace",
    "accounting-state",
    "accounting-heading",
    "accounting-boundary",
    "accounting-kpis",
    "accounting-tabs",
    "accounting-panel",
    "accounting-panel-head",
    "accounting-table",
    "accounting-checks",
    "accounting-chain",
    "accounting-links",
    "accounting-start-panel",
    "integration-status-grid",
    "export-create",
    "export-list",
    "operational-empty-workspace",
    "operational-inline-empty",
    "manual-module-empty",
    "primary-action",
  ], "AccountingWorkspace");

  assertNoLegacyClassTokens(legal, "LegalWorkspace");
  assertNoLegacyClassTokens(accounting, "AccountingWorkspace");

  assert.doesNotMatch(legal, /className\s*=\s*(?:\{\s*)?["'`]page(?:\s|["'`])/);
  assert.doesNotMatch(accounting, /className\s*=\s*(?:\{\s*)?["'`]page(?:\s|["'`])/);
});

test("Wave 1 CSS is locally scoped and uses the approved registry density", () => {
  assertIsolatedCss(legalStyles, "Legal");
  assertIsolatedCss(accountingStyles, "Accounting");
  assert.match(legalStyles, /var\(\s*--ah-registry-kpi-/);
  assert.match(accountingStyles, /var\(\s*--ah-registry-kpi-/);
  assert.match(legalStyles, /overflow-x\s*:\s*auto/);
  assert.match(accountingStyles, /overflow-x\s*:\s*auto/);
});

test("approved operational-registry KPI scale is a shared token contract", () => {
  assert.match(designSystem, /designSystemVersion\s*=\s*["']1\.3-protected-operations["']/);
  const expected = {
    "--ah-registry-kpi-min-height": "98px",
    "--ah-registry-kpi-radius": "16px",
    "--ah-registry-kpi-padding-block": "16px",
    "--ah-registry-kpi-padding-inline": "16px",
    "--ah-registry-kpi-label-size": "13px",
    "--ah-registry-kpi-label-line": "18px",
    "--ah-registry-kpi-value-size": "24px",
    "--ah-registry-kpi-value-line": "28px",
    "--ah-registry-kpi-note-size": "12px",
    "--ah-registry-kpi-note-line": "17px",
    "--ah-registry-kpi-mobile-min-height": "84px",
    "--ah-registry-kpi-mobile-radius": "13px",
    "--ah-registry-kpi-mobile-padding-block": "11px",
    "--ah-registry-kpi-mobile-padding-inline": "12px",
    "--ah-registry-kpi-mobile-label-size": "11px",
    "--ah-registry-kpi-mobile-label-line": "13px",
    "--ah-registry-kpi-mobile-value-size": "26px",
    "--ah-registry-kpi-mobile-value-line": "28px",
    "--ah-registry-kpi-mobile-note-size": "11px",
    "--ah-registry-kpi-mobile-note-line": "13px",
  };
  const tokenMap = Object.fromEntries([...tokens.matchAll(/(--ah-registry-kpi-[a-z-]+):([^;]+);/g)].map(([, key, value]) => [key, value]));
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(tokenMap[key], value, `${key} drifted from the approved scale`);
    for (const [name, styles] of [["Contractors", contractorStyles], ["Legal", legalStyles], ["Accounting", accountingStyles]]) {
      assert.ok(styles.includes(`var(${key})`), `${name} must consume ${key}`);
    }
  }
});

test("Legal migration preserves reads, mutations, navigation and contract fields", () => {
  assert.match(legal, /fetch\s*\(\s*["']\/api\/legal["']/);
  assert.match(legal, /fetch\s*\(\s*["']\/api\/legal-actions["']/);
  assert.match(legal, /["']x-arthello-role["']\s*:/);
  assert.match(legal, /cache\s*:\s*["']no-store["']/);
  assert.match(legal, /method\s*:\s*["']POST["']/);
  assert.match(legal, /JSON\.stringify\s*\(\s*body\s*\)/);
  assertActionContract(legal, ["createContract", "createDocumentVersion", "createSignalTask"], "LegalWorkspace");
  assertFormFields(legal, [
    "partyName",
    "partyType",
    "contractType",
    "number",
    "validFrom",
    "validUntil",
    "limitRubles",
    "signedStatus",
    "closingRequired",
  ], "LegalWorkspace");
  assert.match(legal, /\bonOpenIntegrations\b/);
  assert.match(legal, /onOpenIntegrations\s*\}/);
  assert.match(legal, /\bcreatePortal\s*\(/);
  assert.match(legal, /document\.body/);
  assert.match(legal, /await\s+load\s*\(\s*\)/);
  assert.match(legal, /onTasksChanged\s*\(\s*\)/);
  assert.match(legal, /\bfocusId\b/);
});

test("Legal empty mode remains a complete, actionable registry shell", () => {
  assert.match(legal, /const\s+hasData\s*=\s*Boolean\s*\(/);
  assert.doesNotMatch(legal, /if\s*\(\s*!\s*hasData\s*\)\s*return\b/);
  assert.match(legal, /\bcreateOpen\b/);
  assert.match(legal, /<ContractModal\b/);
  assert.match(legal, /\+\s*Договор/);
  assert.match(legal, /Подключить ЭДО/);
  for (const tab of ["Реестр", "Документы", "Контроль", "Ответственность", "Сквозная цепочка"]) {
    assert.match(legal, new RegExp(escapeRegExp(tab)));
  }
});

test("Accounting migration preserves reads, mutations, finance navigation and document fields", () => {
  assert.match(accounting, /fetch\s*\(\s*["']\/api\/accounting["']/);
  assert.match(accounting, /fetch\s*\(\s*["']\/api\/accounting-actions["']/);
  assert.match(accounting, /["']x-arthello-role["']\s*:/);
  assert.match(accounting, /cache\s*:\s*["']no-store["']/);
  assert.match(accounting, /method\s*:\s*["']POST["']/);
  assert.match(accounting, /JSON\.stringify\s*\(\s*body\s*\)/);
  assertActionContract(accounting, ["createDocument", "confirmSignature", "createMissingTask", "prepareExport"], "AccountingWorkspace");
  assertFormFields(accounting, [
    "documentType",
    "number",
    "documentDate",
    "amountRub",
    "counterpartyEntityId",
    "contractId",
  ], "AccountingWorkspace");
  assert.match(accounting, /\brublesToMinorUnits\s*\(\s*values\.amountRub\s*\)/);
  assert.match(accounting, /\bcurrentAccountingPeriod\s*\(\s*\)/);
  assert.match(accounting, /period\s*:\s*currentPeriod\b/);
  assert.match(accounting, /Реквизиты и подпись сверены бухгалтером по оригиналу/);
  assert.match(accounting, /\bonOpenFinance\b/);
  assert.match(accounting, /onOpenFinance\s*\}/);
  assert.match(accounting, /\bcreatePortal\s*\(/);
  assert.match(accounting, /document\.body/);
  assert.match(accounting, /await\s+load\s*\(\s*\)/);
  assert.match(accounting, /onTasksChanged\s*\(\s*\)/);
});

test("Accounting empty state does not hide the operational tabs", () => {
  assert.match(accounting, /\bhasAccountingData\b/);
  assert.doesNotMatch(accounting, /if\s*\(\s*!\s*hasAccountingData\s*\)\s*return\b/);
  assert.match(accounting, /!\s*hasAccountingData\s*\?[\s\S]{0,3000}?<EmptyState\b[\s\S]{0,3000}?:\s*null/);
  assert.match(accounting, /className\s*=\s*["']ahAccountingBoundary["']/);
  assert.match(accounting, /className\s*=\s*["']ahAccountingKpis["']/);
  assert.match(accounting, /className\s*=\s*["']ahAccountingTabs["']/);
});

test("ArtHelloShell passes Wave 1 navigation contracts directly", () => {
  assert.match(shell, /routedActive\s*===\s*["']legal["']/);
  assert.match(shell, /routedActive\s*===\s*["']accounting["']/);

  const legalTag = componentTag(shell, "LegalWorkspace");
  for (const prop of ["role", "notify", "onTasksChanged", "onOpenIntegrations", "focusId"]) {
    assert.match(legalTag, new RegExp(`\\b${prop}\\s*=`), `LegalWorkspace shell prop ${prop} is missing`);
  }
  assert.match(legalTag, /onOpenIntegrations\s*=\s*\{\s*\(\s*\)\s*=>\s*openModule\s*\(\s*["']integrations["']\s*\)\s*\}/);

  const accountingTag = componentTag(shell, "AccountingWorkspace");
  for (const prop of ["role", "notify", "onTasksChanged", "onOpenFinance"]) {
    assert.match(accountingTag, new RegExp(`\\b${prop}\\s*=`), `AccountingWorkspace shell prop ${prop} is missing`);
  }
  assert.match(accountingTag, /onOpenFinance\s*=\s*\{\s*\(\s*\)\s*=>\s*openModule\s*\(\s*["']finance["']\s*\)\s*\}/);
});

test("component-specific build patches are retired without deleting unrelated patches", () => {
  assert.doesNotMatch(normalizeInputs, /LegalWorkspace(?:\.tsx)?/);
  assert.equal(patchesFile(contentLegalPatch, "app/components/LegalWorkspace.tsx"), false);
  assert.equal(patchesFile(dialogPortalsPatch, "app/components/LegalWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/AccountingWorkspace.tsx"), false);
  assert.doesNotMatch(foundationPatch, /LegalWorkspace(?:\.tsx)?/);

  assert.equal(patchesFile(contentLegalPatch, "app/components/ContentWorkspace.tsx"), true);
  assert.equal(patchesFile(contentLegalPatch, "app/api/legal-actions/route.ts"), true);
  assert.match(contentLegalPatch, /createContract/);
  assert.equal(patchesFile(dialogPortalsPatch, "app/components/ContentWorkspace.tsx"), true);
  assert.match(dialogPortalsPatch, /const integrationPath = "app\/components\/IntegrationWorkspace\.tsx"/);
  assert.equal(patchesFile(operationalPatch, "app/components/ProcurementWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/FoodWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/SafetyWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/MedicalWorkspace.tsx"), false);
  assert.equal(patchesFile(operationalPatch, "app/components/StrategyWorkspace.tsx"), false);
  assert.equal(patchesFile(foundationPatch, "app/components/ArtHelloShell.tsx"), true);
  assert.doesNotMatch(normalizeInputs, /patch-system-operational-modules\.mjs/);
});
