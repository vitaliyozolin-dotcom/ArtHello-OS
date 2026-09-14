import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const componentUrl = new URL(
  "../app/components/FinanceBranchSelector.tsx",
  import.meta.url,
);
const branchAccessUrl = new URL("../lib/branch-access.ts", import.meta.url);
const shellUrl = new URL(
  "../app/components/ArtHelloShell.tsx",
  import.meta.url,
);
const workspaceUrl = new URL(
  "../app/components/FinanceWorkspace.tsx",
  import.meta.url,
);
const stylesUrl = new URL(
  "../app/components/FinanceWorkspace.ds.css",
  import.meta.url,
);
const browserFlowUrl = new URL(
  "../../../../.github/scripts/finance-ci-browser.mjs",
  import.meta.url,
);
const repositoryDeployUrl = new URL(
  "../../../../.github/workflows/deploy-arthello-finance-d181.yml",
  import.meta.url,
);
const deployFixtureUrl = new URL(
  "./contract-fixtures/deploy-d181.yml",
  import.meta.url,
);

function sourceText(...urls) {
  for (const url of urls) {
    if (existsSync(fileURLToPath(url))) return readFileSync(url, "utf8");
  }
  throw new Error(
    `Required source is unavailable: ${urls.map(String).join(", ")}`,
  );
}

test("finance branch options expose only branches granted to a non-administrative user", async (t) => {
  assert.ok(existsSync(fileURLToPath(branchAccessUrl)));
  const temp = mkdtempSync(join(tmpdir(), "arthello-finance-access-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = readFileSync(branchAccessUrl, "utf8");
  const result = ts.transpileModule(source, {
    fileName: fileURLToPath(branchAccessUrl),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  assert.deepEqual(
    result.diagnostics?.filter(
      (item) => item.category === ts.DiagnosticCategory.Error,
    ),
    [],
  );
  const output = join(temp, "branch-access.mjs");
  writeFileSync(output, result.outputText);
  const { filterAccessibleBranches } = await import(pathToFileURL(output));
  const branches = [
    { id: "BR-ATLAS-SCHOOL", name: "Школа Атлас" },
    { id: "BR-NEBO", name: "Садик Небо" },
  ];

  assert.deepEqual(
    filterAccessibleBranches(branches, [{ branchId: "BR-NEBO" }], false),
    [branches[1]],
  );
  assert.deepEqual(filterAccessibleBranches(branches, [], false), []);
  assert.deepEqual(filterAccessibleBranches(branches, [], true), branches);
});

test("mobile finance scope renders every available branch when the shared scope is ALL", async (t) => {
  assert.ok(
    existsSync(fileURLToPath(componentUrl)),
    "FinanceBranchSelector must exist for the blocked mobile state",
  );
  const temp = mkdtempSync(join(tmpdir(), "arthello-finance-branch-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));

  const source = readFileSync(componentUrl, "utf8");
  const result = ts.transpileModule(source, {
    fileName: fileURLToPath(componentUrl),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  });
  assert.deepEqual(
    result.diagnostics?.filter(
      (item) => item.category === ts.DiagnosticCategory.Error,
    ),
    [],
  );
  const output = join(temp, "FinanceBranchSelector.mjs");
  writeFileSync(
    output,
    result.outputText.replaceAll(
      '"react/jsx-runtime"',
      JSON.stringify(import.meta.resolve("react/jsx-runtime")),
    ),
  );
  const { FinanceBranchSelector } = await import(pathToFileURL(output));
  const branches = [
    { id: "BR-ATLAS-SCHOOL", name: "Школа Атлас" },
    { id: "BR-NEBO", name: "Садик Небо" },
  ];

  const blocked = renderToStaticMarkup(
    React.createElement(FinanceBranchSelector, {
      selectedBranch: "ALL",
      branches,
      onChange() {},
    }),
  );
  assert.match(blocked, /aria-label="Выбрать филиал для финансового отчёта"/);
  assert.match(
    blocked,
    /<option value=""[^>]*selected="">Выберите филиал<\/option>/,
  );
  assert.match(blocked, /Школа Атлас/);
  assert.match(blocked, /Садик Небо/);

  const selected = renderToStaticMarkup(
    React.createElement(FinanceBranchSelector, {
      selectedBranch: "BR-NEBO",
      branches,
      onChange() {},
    }),
  );
  assert.match(
    selected,
    /<option value="BR-NEBO" selected="">Садик Небо<\/option>/,
  );

  const unavailable = renderToStaticMarkup(
    React.createElement(FinanceBranchSelector, {
      selectedBranch: "ALL",
      branches: [],
      onChange() {},
    }),
  );
  assert.match(unavailable, /<select[^>]*disabled=""/);
  assert.match(unavailable, /Филиалы недоступны/);
});

test("D181 deploys only the verified mobile Finance fix over the exact D180 production receipt", () => {
  const workflow = sourceText(repositoryDeployUrl, deployFixtureUrl);
  const egressProof = workflow.indexOf("ARTHELLO_D181_ALFACRM_EGRESS=VERIFIED");
  const productionStop = workflow.indexOf('docker stop --time 30 "$live_id"');
  const snapshotProof = workflow.indexOf(
    "ARTHELLO_D181_ROLLBACK_SNAPSHOT=VERIFIED",
  );
  const predecessorProof = workflow.indexOf(
    "ARTHELLO_D181_PREDECESSOR_IDENTITY=VERIFIED",
  );
  const productionProof = workflow.indexOf("ARTHELLO_D181_PRODUCTION=VERIFIED");
  const lockedRouteProof = workflow.indexOf(
    "ARTHELLO_D181_LOCKED_ROUTE=VERIFIED",
  );
  const externalProof = workflow.indexOf("ARTHELLO_D181_EXTERNAL=VERIFIED");

  assert.match(workflow, /D181: restore mobile finance branch/);
  assert.match(
    workflow,
    /EXPECTED_LIVE_RELEASE_SHA: 511d467763b7ca050c096df23cfcdcd1f62fe51d/,
  );
  assert.match(workflow, /production-d180-\$EXPECTED_LIVE_RELEASE_SHA\.json/);
  assert.match(workflow, /\.decision=="D180"/);
  assert.match(workflow, /D181_FINANCE_MOBILE_BRANCH/);
  assert.match(workflow, /mobile_branch_recovery/);
  assert.match(workflow, /mobile_branch_failure/);
  assert.match(workflow, /activeRouteSha256/);
  assert.match(workflow, /payAssetSha256/);
  assert.match(workflow, /group: gateway-38-55-arthello-production-d181/);
  assert.match(
    workflow,
    /deploy:\n    concurrency:\n      group: gateway-38-55-arthello-production/,
  );
  assert.ok(
    egressProof > 0 &&
      predecessorProof > 0 &&
      productionStop > predecessorProof &&
      productionStop > egressProof &&
      snapshotProof > productionStop,
  );
  assert.ok(
    productionProof > snapshotProof &&
      lockedRouteProof > productionProof &&
      externalProof > lockedRouteProof,
  );
  assert.match(workflow, /decision:"D181"/);
  assert.match(workflow, /previousDecision:"D180"/);
  assert.match(workflow, /production-d181-\$RELEASE_SHA\.json/);
  assert.match(workflow, /ALFACRM_IMPORT_ENABLED=true/);
  assert.match(workflow, /TOCHKA_AUTOSYNC_ENABLED=1/);
  assert.match(workflow, /moneyAcceptanceEnabled:false/);
  assert.match(workflow, /fiscalizationEnabled:false/);
  assert.doesNotMatch(
    workflow,
    /TOCHKA_TOKEN|PAYMENT_SECRET|FISCALIZATION_SECRET/,
  );
});

test("finance workspace keeps the branch picker reachable in its blocked and loaded states", () => {
  const shell = readFileSync(shellUrl, "utf8");
  const workspace = readFileSync(workspaceUrl, "utf8");
  const styles = readFileSync(stylesUrl, "utf8");

  assert.match(shell, /branches=\{branches\}/);
  assert.match(shell, /onBranchChange=\{changeBranch\}/);
  assert.match(shell, /key=\{`finance:\$\{selectedBranch\}`\}/);
  assert.match(
    shell,
    /filterAccessibleBranches\(context\.branches, context\.access, context\.me\.isAdministrative\)/,
  );
  assert.match(
    shell,
    /next === "finance" && selectedBranch === "ALL" && branches\[0\]/,
  );
  assert.match(shell, /changeBranch\(branches\[0\]\.id\)/);
  assert.match(
    workspace,
    /<FinanceBranchSelector[\s\S]*?selectedBranch=\{selectedBranch\}[\s\S]*?branches=\{branches\}[\s\S]*?onChange=\{onBranchChange\}/,
  );
  assert.match(workspace, /ahFinanceMobileBranchScope/);
  assert.match(workspace, /data-d181-marker="D181_FINANCE_MOBILE_BRANCH"/);
  assert.match(workspace, /data\?\.branch\.id !== selectedBranch/);
  assert.match(
    styles,
    /\.ahFinanceMobileBranchScope\s*\{[\s\S]*?display:\s*none/,
  );
  assert.match(
    styles,
    /@media \(max-width: 767px\)\s*\{[\s\S]*?\.ahFinanceMobileBranchScope\s*\{[\s\S]*?display:\s*block/,
  );
  if (existsSync(fileURLToPath(browserFlowUrl))) {
    const browserFlow = readFileSync(browserFlowUrl, "utf8");
    assert.match(browserFlow, /mobile_branch_recovery/);
    assert.match(
      browserFlow,
      /getByLabel\('Выбрать филиал для финансового отчёта'/,
    );
    assert.match(browserFlow, /mobileBranchOptions>=3/);
    assert.match(browserFlow, /stage='mobile_branch_failure'/);
    assert.match(browserFlow, /financeFailureBranch/);
    assert.match(browserFlow, /locator\('\.ahFinancePulse'\)\.count\(\),0/);
  }
});
