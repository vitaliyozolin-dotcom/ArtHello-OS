#!/usr/bin/env node
"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const HARNESS_PATH = "/source/deploy/v52/visual/contractors-design-system.cjs";
const HARNESS_BLOB = "eee9647d7f0e4799e293613c01eaa4199d80dc06";
const CORE_PATH = "/opt/arthello-e2e/node_modules/playwright-core";
const UPSTREAM = "http://visual-app:8081";
const OUTPUT = "/screens";
const IIFE_MARKER = "\n(async () => {\n";
const TASK_HEADING = '  await page.getByRole("heading", { name: "Проверить результат visual fixture", exact: true }).waitFor({ state: "visible", timeout: 30000 });\n';
const WORKFLOW_OVERVIEW_FIXTURE = `const emptyWorkflow = {
  tasks: [],
  notifications: [],
  escalations: [],
  documents: [],
  obligations: [],
  assignees: [],
  stats: { open: 0, overdue: 0, waitingApproval: 0, escalations: 0 },
};
`;
const WORKFLOW_DETAIL_FIXTURE = `const populatedWorkflowDetail = {
  task: { ...populatedWorkflow.tasks[0], priority: "Высокий", status: "Входящие" },
`;
const ROUTES = Object.freeze(["content", "tasks"]);
const VIEWPORTS = Object.freeze([Object.freeze([390, 844]), Object.freeze([1440, 900])]);
const EXPORTS = "\nmodule.exports = { chromium, pilotUrl, manifest, persist, startLoopbackProxy, closeServer, establishAuth, captureWaveRoute, assertWaveStructure, assertWaveEmptyTypography, assertWavePopulated, captureWorkflowDialog };\n";

function gitBlob(bytes) {
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

function detachHarness(source) {
  const parts = source.split(IIFE_MARKER);
  if (parts.length !== 2 || !parts[1].endsWith('})().catch((error) => { console.error(error); process.exit(1); });\n')) {
    throw new Error("Frozen harness entrypoint shape differs");
  }
  if (parts[0].split(TASK_HEADING).length !== 2) throw new Error("Frozen task heading boundary differs");
  return parts[0];
}

function instrumentHarness(prefix) {
  if (prefix.split(TASK_HEADING).length !== 2) throw new Error("Frozen task heading boundary differs");
  return prefix.replace(TASK_HEADING, TASK_HEADING + "  await assertTaskNumber(dialog);\n");
}

function adaptWorkflowFixtures(prefix) {
  if (prefix.split(WORKFLOW_OVERVIEW_FIXTURE).length !== 2 ||
      prefix.split(WORKFLOW_DETAIL_FIXTURE).length !== 2) {
    throw new Error("Frozen workflow fixture boundary differs");
  }
  // Accepted R12 /api/work-items emits these exact permissions for the existing
  // synthetic OWNER. populatedWorkflow inherits the overview object by spread.
  return prefix
    .replace(WORKFLOW_OVERVIEW_FIXTURE, WORKFLOW_OVERVIEW_FIXTURE.replace("\n",
      "\n  permissions: { canManageAll: true, canApprove: true, canManageDocuments: true },\n"))
    .replace(WORKFLOW_DETAIL_FIXTURE, WORKFLOW_DETAIL_FIXTURE.replace("\n",
      "\n  permissions: { canView: true, canManage: true, canComment: true, canApprove: true },\n"));
}

// This is the sole additional UI assertion. The existing header also contains
// source text after a middle dot, so an exact whole-paragraph match is unsuitable.
async function assertTaskNumber(dialog) {
  await dialog.locator(".workflow-drawer-head p")
    .filter({ hasText: /^Задача №801(?:\s*·|$)/ })
    .waitFor({ state: "visible", timeout: 30000 });
}

function harnessRequire(playwrightCore) {
  if (!playwrightCore || typeof playwrightCore.chromium?.launch !== "function") {
    throw new Error("Frozen Chromium dependency is unavailable");
  }
  const unusedPng = new Proxy(function unusedPng() { throw new Error("PNG comparison is outside scoped checks"); }, {
    get() { throw new Error("PNG comparison is outside scoped checks"); },
    construct() { throw new Error("PNG comparison is outside scoped checks"); },
  });
  const browser = Object.freeze({
    chromium: Object.freeze({
      launch(options) {
        if (!options || options.headless !== true || Object.keys(options).some((key) => key !== "headless")) {
          throw new Error("Scoped Chromium launch options differ");
        }
        return playwrightCore.chromium.launch({ headless: true, channel: "chromium", chromiumSandbox: true });
      },
    }),
  });
  return (name) => {
    if (name === "playwright") return browser;
    if (name === "pngjs") return Object.freeze({ PNG: unusedPng });
    if (["node:fs", "node:http", "node:path"].includes(name)) return require(name);
    throw new Error("Dependency is outside scoped checks");
  };
}

function loadHarness(bytes, playwrightCore) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024 || gitBlob(bytes) !== HARNESS_BLOB) {
    throw new Error("Frozen visual harness Git blob differs");
  }
  const source = bytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error("Frozen harness encoding differs");
  const prefix = detachHarness(source);
  const instrumented = instrumentHarness(adaptWorkflowFixtures(prefix));
  const compiled = new Module(HARNESS_PATH, module);
  compiled.filename = HARNESS_PATH;
  compiled.paths = [];
  compiled.require = harnessRequire(playwrightCore);
  // Only the verified source prefix is evaluated. Its changes are the two fixed
  // fixture permission objects and explicit task-number assertion; the full-suite
  // IIFE never executes, and all original UI assertions remain intact.
  compiled._compile(instrumented + "\n" + assertTaskNumber.toString() + "\n" + EXPORTS, HARNESS_PATH);
  return compiled.exports;
}

function validateEnvironment(env) {
  if (env.PILOT_UPSTREAM !== UPSTREAM || env.VISUAL_OUTPUT !== OUTPUT || env.BASELINE_UPSTREAM) {
    throw new Error("Scoped visual destination differs");
  }
  if (!/^VisualTmp_[a-f0-9]{48}$/.test(env.TEMP_PASSWORD || "") ||
      !/^VisualFinal_[a-f0-9]{48}$/.test(env.PERMANENT_PASSWORD || "")) {
    throw new Error("Synthetic visual credentials are unavailable");
  }
}

// These four assertion blocks are copied from the pinned full harness unchanged.
function assertWorkflowDialog(item, viewport) {
  if (item.horizontalOverflow || !item.portalParent || item.layerPosition !== "fixed" || !item.layerCoversViewport || !item.dialogContained) {
    throw new Error(`workflow-dialog: viewport containment failed at ${viewport.join("x")}`);
  }
  if (!["auto", "scroll"].includes(item.bodyOverflowY) || item.bodyFooterOverlap || !item.footerVisible || !item.actionVisible || !item.closeVisible) {
    throw new Error(`workflow-dialog: scroll/footer contract failed at ${viewport.join("x")}`);
  }
  if (item.checklistHelpVisible !== 0 || (viewport[0] <= 720 && item.helpLauncherVisible)) {
    throw new Error(`workflow-dialog: contextual help overlaps task content at ${viewport.join("x")}`);
  }
  if (viewport[0] <= 720 && (item.dialogWidth < viewport[0] - 20 || item.dialogHeight < viewport[1] - 20)) {
    throw new Error("workflow-dialog: mobile dialog does not own the visible viewport");
  }
}

async function runChecks(harness, browser, state, progress = () => {}) {
  for (const mode of ["empty", "populated"]) {
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        progress(route + "-" + mode + "-" + viewport.join("x"));
        const item = await harness.captureWaveRoute(browser, harness.pilotUrl, state, "pilot", viewport, route, mode);
        harness.manifest.push(item);
        harness.persist();
        if (mode === "empty") {
          harness.assertWaveStructure(item);
          harness.assertWaveEmptyTypography(item);
          if (viewport[0] === 390 && !item.tabsVerified) throw new Error(route + ": tab interaction contract did not pass");
        } else {
          harness.assertWavePopulated(item);
        }
      }
    }
  }
  for (const viewport of VIEWPORTS) {
    progress("task-dialog-" + viewport.join("x"));
    const item = await harness.captureWorkflowDialog(browser, harness.pilotUrl, state, viewport);
    harness.manifest.push(item);
    harness.persist();
    assertWorkflowDialog(item, viewport);
  }
}

function expectedPngNames() {
  const names = [];
  for (const route of ROUTES) {
    for (const viewport of VIEWPORTS) {
      const stem = "pilot-" + route;
      names.push(stem + "-empty-" + viewport.join("x") + "-full.png");
      names.push(stem + "-empty-" + viewport.join("x") + "-viewport.png");
      names.push(stem + "-populated-" + viewport.join("x") + "-full.png");
    }
  }
  for (const viewport of VIEWPORTS) names.push("pilot-workflow-dialog-" + viewport.join("x") + ".png");
  return names.sort();
}

function verifyArtifacts(directory = OUTPUT) {
  const expected = expectedPngNames();
  const files = fs.readdirSync(directory).sort();
  if (JSON.stringify(files) !== JSON.stringify([...expected, "manifest.json"].sort())) {
    throw new Error("Scoped artifact inventory differs");
  }
  for (const name of files) {
    const stat = fs.lstatSync(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error("Scoped artifact is not an ordinary nonempty file");
  }
  // Only this invocation's exact synthetic artifact set is exposed to upload.
  for (const name of files) fs.chmodSync(path.join(directory, name), 0o644);
}

function writeScopedResult(result, directory = OUTPUT) {
  const filename = path.join(directory, "scoped-result.json");
  fs.writeFileSync(filename, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  fs.chmodSync(filename, 0o644);
}

async function main() {
  let stage = "configuration";
  let harness, browser, proxy;
  let outputReady = false;
  let failure;
  try {
    validateEnvironment(process.env);
    const directory = fs.lstatSync(OUTPUT);
    if (!directory.isDirectory() || directory.isSymbolicLink() || fs.readdirSync(OUTPUT).length) {
      throw new Error("Scoped output must be a fresh directory");
    }
    outputReady = true;
    stage = "frozen-harness";
    harness = loadHarness(fs.readFileSync(HARNESS_PATH), require(CORE_PATH));
    stage = "browser";
    proxy = await harness.startLoopbackProxy(UPSTREAM, 18082);
    browser = await harness.chromium.launch({ headless: true });
    stage = "synthetic-authentication";
    const state = await harness.establishAuth(browser, harness.pilotUrl);
    await runChecks(harness, browser, state, (value) => { stage = value; });
    stage = "artifact-inventory";
    verifyArtifacts();
  } catch (error) {
    failure = error;
  } finally {
    for (const cleanup of [
      async () => { if (browser) await browser.close(); },
      async () => { if (proxy) await harness.closeServer(proxy); },
      async () => { if (harness) harness.persist(); },
    ]) {
      try { await cleanup(); } catch (error) { if (!failure) { failure = error; stage = "cleanup"; } }
    }
  }
  const result = {
    kind: "synthetic-content-tasks-scoped",
    result: failure ? "blocked" : "pass",
    stage: failure ? stage : "complete",
    harnessBlob: HARNESS_BLOB,
    routes: ROUTES,
    viewports: VIEWPORTS,
    pngCount: failure ? null : 14,
    completedCaptures: harness?.manifest.length || 0,
    taskNumberAssertion: failure ? "not_confirmed" : "visible-literal-Задача №801",
    savePersistence: "not_tested",
    liveAcceptance: "not_run",
  };
  if (outputReady) writeScopedResult(result);
  if (failure) throw new Error("Scoped visual checks blocked");
  console.log("ARTHELLO_CONTENT_TASKS_SCOPED=PASS png=14");
}

module.exports = { HARNESS_BLOB, IIFE_MARKER, TASK_HEADING, detachHarness, instrumentHarness, gitBlob,
  WORKFLOW_OVERVIEW_FIXTURE, WORKFLOW_DETAIL_FIXTURE, adaptWorkflowFixtures,
  harnessRequire, loadHarness, validateEnvironment, assertTaskNumber, assertWorkflowDialog,
  runChecks, expectedPngNames, verifyArtifacts, writeScopedResult };

if (require.main === module) main().catch(() => {
  console.error("ARTHELLO_CONTENT_TASKS_SCOPED=BLOCKED");
  process.exitCode = 1;
});
