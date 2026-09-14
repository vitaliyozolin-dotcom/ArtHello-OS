import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const artifactDeliveryUrl = new URL(
  "../../../../.github/scripts/download-v52-artifact-r17.py",
  import.meta.url,
);
const artifactDeliveryFixtureUrl = new URL(
  "./contract-fixtures/download-v52-artifact-r17.py",
  import.meta.url,
);
const repositoryDeployUrl = new URL(
  "../../../../.github/workflows/deploy-arthello-finance-d182.yml",
  import.meta.url,
);
const deployFixtureUrl = new URL(
  "./contract-fixtures/deploy-d182.yml",
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

test("D182 deploys the verified mobile Finance fix over the exact D181 production receipt", () => {
  const workflow = sourceText(repositoryDeployUrl, deployFixtureUrl);
  const artifactDelivery = readFileSync(artifactDeliveryFixtureUrl, "utf8");
  if (existsSync(fileURLToPath(artifactDeliveryUrl))) {
    assert.equal(
      readFileSync(artifactDeliveryUrl, "utf8"),
      readFileSync(artifactDeliveryFixtureUrl, "utf8"),
    );
  }
  const egressProof = workflow.indexOf("ARTHELLO_D182_ALFACRM_EGRESS=VERIFIED");
  const productionStop = workflow.indexOf('docker stop --time 30 "$live_id"');
  const snapshotProof = workflow.indexOf(
    "ARTHELLO_D182_ROLLBACK_SNAPSHOT=VERIFIED",
  );
  const predecessorProof = workflow.indexOf(
    "ARTHELLO_D182_PREDECESSOR_IDENTITY=VERIFIED",
  );
  const productionProof = workflow.indexOf("ARTHELLO_D182_PRODUCTION=VERIFIED");
  const lockedRouteProof = workflow.indexOf(
    "ARTHELLO_D182_LOCKED_ROUTE=VERIFIED",
  );
  const externalProof = workflow.indexOf("ARTHELLO_D182_EXTERNAL=VERIFIED");
  const manualCutoverProof = workflow.indexOf(
    "ARTHELLO_D182_MANUAL_CUTOVER=AUTHORIZED",
  );
  const verifyRunLookup = workflow.indexOf(
    '"https://api.github.com/repos/$GITHUB_REPOSITORY/actions/runs/$TRIGGER_VERIFY_RUN_ID"',
  );
  const mainRefRetry = workflow.indexOf("for attempt in 1 2 3 4 5 6; do");
  const artifactDownload = workflow.indexOf(
    "python3 -I -B .github/scripts/download-v52-artifact-r17.py",
  );

  assert.match(workflow, /D182: restore mobile finance branch/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /verify_run_id:/);
  assert.match(workflow, /confirmation:/);
  assert.match(workflow, /DEPLOY D182 TO PRODUCTION/);
  assert.match(workflow, /ARTHELLO_ARTIFACT_DELIVERY_EVENT: workflow_dispatch/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /environment: production-ru/);
  assert.match(workflow, /github\.sha == inputs\.release_sha/);
  assert.match(workflow, /github\.actor == 'vitaliyozolin-dotcom'/);
  assert.match(workflow, /github\.triggering_actor == 'vitaliyozolin-dotcom'/);
  assert.match(workflow, /\.name == "Verify ArtHello v52 release"/);
  assert.match(
    workflow,
    /\.path == "\.github\/workflows\/verify-arthello-v52\.yml"/,
  );
  assert.match(workflow, /\.head_branch == "main" and \.head_sha == \$release/);
  assert.match(
    workflow,
    /\.status == "completed" and \.conclusion == "success"/,
  );
  assert.match(
    artifactDelivery,
    /env\.get\('ARTHELLO_ARTIFACT_DELIVERY_EVENT', 'workflow_run'\)/,
  );
  assert.match(
    artifactDelivery,
    /env\.get\('GITHUB_WORKFLOW'\) == 'Deploy ArtHello mobile finance branch D182'/,
  );
  assert.match(
    artifactDelivery,
    /env\.get\('CUTOVER_CONFIRMATION'\) == 'DEPLOY D182 TO PRODUCTION'/,
  );
  assert.match(
    workflow,
    /EXPECTED_LIVE_RELEASE_SHA: eea35ebe384f1039324ad083fcdfa74e0d2217c4/,
  );
  assert.match(workflow, /production-d181-\$EXPECTED_LIVE_RELEASE_SHA\.json/);
  assert.match(workflow, /\.decision=="D181"/);
  assert.match(workflow, /D182_FINANCE_MOBILE_BRANCH/);
  assert.match(workflow, /FAMILY_DIRECTORY_PAGE_SIZE = 25/);
  assert.match(workflow, /searchParams\.get\("section"\) === "families"/);
  assert.match(workflow, /FAMILY_COUNT = 2_887/);
  assert.ok(mainRefRetry > 0 && artifactDownload > mainRefRetry);
  assert.match(workflow, /sleep 5/);
  assert.match(workflow, /mobile_branch_recovery/);
  assert.match(workflow, /mobile_branch_failure/);
  assert.match(workflow, /activeRouteSha256/);
  assert.match(workflow, /payAssetSha256/);
  assert.match(workflow, /group: gateway-38-55-arthello-production-d182/);
  assert.match(
    workflow,
    /deploy:\n    concurrency:\n      group: gateway-38-55-arthello-production/,
  );
  assert.ok(
    egressProof > 0 &&
      predecessorProof > 0 &&
      verifyRunLookup > 0 &&
      productionStop > verifyRunLookup &&
      manualCutoverProof > predecessorProof &&
      productionStop > manualCutoverProof &&
      productionStop > predecessorProof &&
      productionStop > egressProof &&
      snapshotProof > productionStop,
  );
  assert.ok(
    productionProof > snapshotProof &&
      lockedRouteProof > productionProof &&
      externalProof > lockedRouteProof,
  );
  assert.match(workflow, /decision:"D182"/);
  assert.match(workflow, /previousDecision:"D181"/);
  assert.match(workflow, /production-d182-\$RELEASE_SHA\.json/);
  assert.match(workflow, /ALFACRM_IMPORT_ENABLED=true/);
  assert.match(workflow, /TOCHKA_AUTOSYNC_ENABLED=1/);
  assert.match(workflow, /moneyAcceptanceEnabled:false/);
  assert.match(workflow, /fiscalizationEnabled:false/);
  assert.doesNotMatch(
    workflow,
    /TOCHKA_TOKEN|PAYMENT_SECRET|FISCALIZATION_SECRET/,
  );
});

test("artifact delivery keeps the workflow_run default and narrowly authorizes D182 dispatch", () => {
  const artifactDeliveryPath = fileURLToPath(artifactDeliveryFixtureUrl);
  const result = spawnSync(
    "python3",
    [
      "-I",
      "-B",
      "-c",
      String.raw`
import importlib.util
import pathlib
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("delivery", path)
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)
source = "a" * 40
delivery.subprocess.run = lambda *args, **kwargs: type("Result", (), {"stdout": (source + "\n").encode()})()

with tempfile.TemporaryDirectory() as temporary:
    base = {
        "GITHUB_REPOSITORY": delivery.REPOSITORY,
        "EXPECTED_REPOSITORY": delivery.REPOSITORY,
        "GITHUB_ACTOR": delivery.OWNER,
        "GITHUB_TRIGGERING_ACTOR": delivery.OWNER,
        "RELEASE_SHA": source,
        "CHECKED_SOURCE_SHA": source,
        "TRIGGER_VERIFY_RUN_ID": "1",
        "GITHUB_RUN_ID": "2",
        "GITHUB_RUN_ATTEMPT": "1",
        "RUNNER_TEMP": temporary,
    }
    legacy = dict(base, GITHUB_EVENT_NAME="workflow_run")
    assert delivery.context(legacy)[:2] == (source, 1)

    manual = dict(
        base,
        GITHUB_EVENT_NAME="workflow_dispatch",
        ARTHELLO_ARTIFACT_DELIVERY_EVENT="workflow_dispatch",
        GITHUB_WORKFLOW="Deploy ArtHello mobile finance branch D182",
        CUTOVER_CONFIRMATION="DEPLOY D182 TO PRODUCTION",
    )
    assert delivery.context(manual)[:2] == (source, 1)
    for key, value in (
        ("CUTOVER_CONFIRMATION", "wrong"),
        ("GITHUB_WORKFLOW", "other"),
        ("GITHUB_EVENT_NAME", "workflow_run"),
    ):
        rejected = dict(manual, **{key: value})
        try:
            delivery.context(rejected)
        except delivery.Refused as error:
            assert str(error) == "PROTECTED_CONTEXT"
        else:
            raise AssertionError(key)
`,
      artifactDeliveryPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
  assert.match(workspace, /data-d182-marker="D182_FINANCE_MOBILE_BRANCH"/);
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
