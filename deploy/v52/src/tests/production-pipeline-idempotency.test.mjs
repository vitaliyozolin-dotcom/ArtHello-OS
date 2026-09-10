import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const fixtureFiles = [
  "app/components/ArtHelloShell.tsx",
  "app/components/ContentWorkspace.tsx",
  "app/components/HrWorkspace.tsx",
  "app/components/IntegrationWorkspace.tsx",
  "app/components/SalesWorkspace.tsx",
  "app/components/SystemWideMobilePolish.css",
  "app/components/ContextualHelpSystem.css",
  "app/components/ContextualHelpSystem.tsx",
  "app/components/contextualHelpDom.ts",
  "app/globals.css",
  "app/api/legal-actions/route.ts",
  "app/api/integration-actions/route.ts",
  "scripts/patch-system-foundation.mjs",
  "scripts/normalize-system-patch-inputs.mjs",
  "scripts/patch-system-content-legal.mjs",
  "scripts/patch-sales-operating-workspace.mjs",
  "scripts/patch-system-dialog-portals.mjs",
  "scripts/patch-help-finance-ux-v3.mjs",
  "scripts/patch-mobile-canonical-v5.mjs",
];

test("production UI patches are individually repeatable and keep canonical help clean", () => {
  const fixture = mkdtempSync(join(tmpdir(), "arthello-pipeline-idempotency-"));
  try {
    for (const relativePath of fixtureFiles) copyFixture(fixture, relativePath);

    assertRepeatable(fixture, "scripts/patch-system-foundation.mjs", [
      "app/components/ArtHelloShell.tsx",
      "app/components/HrWorkspace.tsx",
      "app/components/SalesWorkspace.tsx",
      "app/globals.css",
    ]);
    assertRepeatable(fixture, "scripts/patch-sales-operating-workspace.mjs", [
      "app/components/ArtHelloShell.tsx",
      "app/components/IntegrationWorkspace.tsx",
      "app/api/integration-actions/route.ts",
    ]);
    assertRepeatable(fixture, "scripts/patch-system-dialog-portals.mjs", [
      "app/components/ContentWorkspace.tsx",
      "app/components/IntegrationWorkspace.tsx",
    ]);
    assertRepeatable(fixture, "scripts/normalize-system-patch-inputs.mjs", [
      "scripts/patch-system-content-legal.mjs",
    ]);
    assertRepeatable(fixture, "scripts/patch-system-content-legal.mjs", [
      "app/components/ContentWorkspace.tsx",
      "app/api/legal-actions/route.ts",
    ]);
    assertRepeatable(fixture, "scripts/patch-help-finance-ux-v3.mjs", [
      "app/components/ArtHelloShell.tsx",
      "app/components/SystemWideMobilePolish.css",
    ]);
    appendFileSync(
      join(fixture, "app/components/SystemWideMobilePolish.css"),
      '\n/* ARTHELLO_MOBILE_CANONICAL_V5 */\n.stale-mobile [data-ah-help-inline]{display:block}\n/* ARTHELLO_MOBILE_CANONICAL_V5 */\n.stale-icon .ah-field-icon{display:block}\n',
    );
    appendFileSync(
      join(fixture, "app/components/ContextualHelpSystem.css"),
      '\n/* ARTHELLO_HELP_CANONICAL_V5 */\n.stale-help .ah-field-icon{display:block}\n/* ARTHELLO_HELP_CANONICAL_V5 */\n.stale-help [data-ah-help-inline]{display:block}\n',
    );
    assertRepeatable(fixture, "scripts/patch-mobile-canonical-v5.mjs", [
      "app/components/SystemWideMobilePolish.css",
      "app/components/ContextualHelpSystem.css",
    ]);

    const canonicalOutput = [
      "app/components/SystemWideMobilePolish.css",
      "app/components/ContextualHelpSystem.css",
      "app/components/ContextualHelpSystem.tsx",
      "app/components/contextualHelpDom.ts",
    ].map((relativePath) => readFixture(fixture, relativePath)).join("\n");
    assert.doesNotMatch(canonicalOutput, /data-ah-help-inline|ah-field-icon|fieldMarkers/);
    assert.equal(markerCount(canonicalOutput, "ARTHELLO_MOBILE_CANONICAL_V5"), 1);
    assert.equal(markerCount(canonicalOutput, "ARTHELLO_HELP_CANONICAL_V5"), 1);
    assert.doesNotMatch(
      canonicalOutput,
      /ARTHELLO_MOBILE_VISUAL_HELP_FOLLOWUP|ARTHELLO_OPERATIONAL_UX_V3|ARTHELLO_MOBILE_DESIGN_SYSTEM_V4|ARTHELLO_HELP_MARKER_RIGHT_EDGE|ARTHELLO_HELP_UX_V3|ARTHELLO_HELP_VISIBILITY_V4/,
    );

    const integrationPath = join(fixture, "app/components/IntegrationWorkspace.tsx");
    writeFileSync(
      integrationPath,
      readFileSync(integrationPath, "utf8").replace("function ConflictResolutionDialog(", "function IncompleteConflictDialog("),
      "utf8",
    );
    const partialPortalResult = runPatch(fixture, "scripts/patch-system-dialog-portals.mjs");
    assert.notEqual(partialPortalResult.status, 0);
    assert.match(partialPortalResult.stderr, /partial canonical IntegrationWorkspace portal implementation/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("production verifier accepts canonical atomic legal provenance", () => {
  const result = spawnSync(process.execPath, [join(projectRoot, "scripts/verify-system-wide-operational-shells.mjs")], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

function assertRepeatable(fixture, scriptPath, outputPaths) {
  const first = runPatch(fixture, scriptPath);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstOutput = outputPaths.map((relativePath) => readFixture(fixture, relativePath));
  const second = runPatch(fixture, scriptPath);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondOutput = outputPaths.map((relativePath) => readFixture(fixture, relativePath));
  assert.deepEqual(secondOutput, firstOutput, `${scriptPath} changed output on its second run`);
}

function runPatch(fixture, relativePath) {
  return spawnSync(process.execPath, [join(fixture, relativePath)], {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, ARTHELLO_PATCH_ROOT: fixture },
  });
}

function copyFixture(fixture, relativePath) {
  const target = join(fixture, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(projectRoot, relativePath), target);
}

function readFixture(fixture, relativePath) {
  return readFileSync(join(fixture, relativePath), "utf8");
}

function markerCount(source, marker) {
  return source.split(`/* ${marker} */`).length - 1;
}
