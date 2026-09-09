"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const scoped = require("./content-tasks-scoped.cjs");

const validEnvironment = () => ({
  PILOT_UPSTREAM: "http://visual-app:8081", VISUAL_OUTPUT: "/screens",
  TEMP_PASSWORD: "VisualTmp_" + "a".repeat(48),
  PERMANENT_PASSWORD: "VisualFinal_" + "b".repeat(48),
});
const tail = '})().catch((error) => { console.error(error); process.exit(1); });\n';

test("the exact pinned harness compiles without executing its full-suite entrypoint", () => {
  const sourcePath = process.env.HARNESS_TEST_SOURCE || path.join(__dirname, "contractors-design-system.cjs");
  const bytes = fs.readFileSync(sourcePath);
  let launches = 0;
  const harness = scoped.loadHarness(bytes, { chromium: { launch() { launches += 1; throw new Error("must not launch while loading"); } } });
  assert.equal(scoped.gitBlob(bytes), scoped.HARNESS_BLOB);
  assert.equal(launches, 0);
  assert.deepEqual(harness.manifest, []);
  assert.equal(harness.pilotUrl, "http://localhost:18082");
  for (const name of ["captureWaveRoute", "assertWaveStructure", "assertWaveEmptyTypography", "assertWavePopulated", "captureWorkflowDialog"]) {
    assert.equal(typeof harness[name], "function");
  }
  const source = bytes.toString("utf8");
  const original = source.slice(source.indexOf("async function captureWorkflowDialog("),
    source.indexOf("async function captureFinalMobileAcceptance(")).trim();
  assert.equal(harness.captureWorkflowDialog.toString(), scoped.instrumentHarness(original));
});

function goodDialog(viewport) {
  return {
    horizontalOverflow: false, portalParent: true, layerPosition: "fixed",
    layerCoversViewport: true, dialogContained: true,
    bodyOverflowY: "auto", bodyFooterOverlap: false, footerVisible: true,
    actionVisible: true, closeVisible: true, checklistHelpVisible: 0,
    helpLauncherVisible: false, dialogWidth: viewport[0], dialogHeight: viewport[1],
  };
}

function fakeHarness() {
  const calls = [];
  return {
    calls, pilotUrl: "http://localhost:18082", manifest: [],
    persist() { calls.push(["persist"]); },
    async captureWaveRoute(browser, base, state, label, viewport, route, mode) {
      calls.push(["capture", label, route, mode, ...viewport]);
      return { route, mode, tabsVerified: true };
    },
    assertWaveStructure(item) { calls.push(["structure", item.route, item.mode]); },
    assertWaveEmptyTypography(item) { calls.push(["typography", item.route, item.mode]); },
    assertWavePopulated(item) { calls.push(["populated", item.route, item.mode]); },
    async captureWorkflowDialog(browser, base, state, viewport) {
      calls.push(["dialog", ...viewport]);
      return goodDialog(viewport);
    },
  };
}

test("destinations and fresh synthetic credentials cannot be changed by environment", () => {
  scoped.validateEnvironment(validEnvironment());
  for (const patch of [
    { PILOT_UPSTREAM: "https://visual-app:8081" }, { PILOT_UPSTREAM: "http://other:8081" },
    { PILOT_UPSTREAM: "http://visual-app:8081/" }, { PILOT_UPSTREAM: "http://visual-app:8081?target=other" },
    { VISUAL_OUTPUT: "/other" }, { BASELINE_UPSTREAM: "http://visual-app:8081" },
    { TEMP_PASSWORD: "existing-password" }, { PERMANENT_PASSWORD: "existing-password" },
  ]) {
    assert.throws(() => scoped.validateEnvironment({ ...validEnvironment(), ...patch }));
  }
});

test("wrong Git blob and non-buffer source are rejected before dependency access or evaluation", () => {
  let dependencyRead = false;
  const core = { get chromium() { dependencyRead = true; throw new Error("must not load"); } };
  assert.throws(() => scoped.loadHarness(Buffer.from('globalThis.scopedUnsafe = true;'), core), /Git blob/);
  assert.throws(() => scoped.loadHarness("not a buffer", core), /Git blob/);
  assert.equal(dependencyRead, false);
  assert.equal(globalThis.scopedUnsafe, undefined);
});

test("entrypoint extraction fails closed on missing, duplicate or changed boundaries", () => {
  const prefix = "prefix\n" + scoped.TASK_HEADING + "rest\n";
  const source = prefix + scoped.IIFE_MARKER + "unused\n" + tail;
  assert.equal(scoped.detachHarness(source), prefix);
  for (const changed of [
    source.replace(scoped.IIFE_MARKER, "\nother()\n"),
    source + scoped.IIFE_MARKER,
    source.replace(tail, "different tail\n"),
    source.replace(scoped.TASK_HEADING, ""),
    source.replace(scoped.TASK_HEADING, scoped.TASK_HEADING + scoped.TASK_HEADING),
  ]) assert.throws(() => scoped.detachHarness(changed));
});

test("instrumentation inserts only the one explicit number assertion after the existing heading", () => {
  const prefix = "before\n" + scoped.TASK_HEADING + "after\n";
  const injection = "  await assertTaskNumber(dialog);\n";
  const changed = scoped.instrumentHarness(prefix);
  assert.equal(changed, "before\n" + scoped.TASK_HEADING + injection + "after\n");
  assert.equal(changed.replace(injection, ""), prefix);
  assert.throws(() => scoped.instrumentHarness("no heading"));
  assert.throws(() => scoped.instrumentHarness(scoped.TASK_HEADING.repeat(2)));
});

test("dependency adapter permits only fixed imports and full Chromium sandbox launch", async () => {
  const launches = [];
  const load = scoped.harnessRequire({ chromium: { async launch(options) { launches.push(options); return "browser"; } } });
  assert.equal(load("node:path"), path);
  const browser = load("playwright");
  assert.equal(await browser.chromium.launch({ headless: true }), "browser");
  assert.deepEqual(launches, [{ headless: true, channel: "chromium", chromiumSandbox: true }]);
  for (const options of [{ headless: false }, { headless: true, args: ["--no-sandbox"] },
    { headless: true, chromiumSandbox: false }, { headless: true, channel: "other" }]) {
    assert.throws(() => browser.chromium.launch(options));
  }
  for (const dependency of ["pixelmatch", "node:child_process", "https", "/other"]) {
    assert.throws(() => load(dependency), /Dependency/);
  }
  const { PNG } = load("pngjs");
  assert.throws(() => PNG.sync, /outside scoped/);
  assert.throws(() => new PNG({}), /outside scoped/);
});

test("task number is required visibly in the existing dialog header, including an exact numeric boundary", async () => {
  function dialog(text, visible = true) {
    return {
      locator(selector) {
        assert.equal(selector, ".workflow-drawer-head p");
        return { filter({ hasText }) {
          return { async waitFor(options) {
            assert.deepEqual(options, { state: "visible", timeout: 30000 });
            if (!visible || !hasText.test(text)) throw new Error("number is not visible");
          } };
        } };
      },
    };
  }
  await scoped.assertTaskNumber(dialog("Задача №801 · Ручная задача · Запись №0001"));
  await scoped.assertTaskNumber(dialog("Задача №801"));
  for (const text of ["Задача №8010 · Ручная задача", "TSK-801", "Задача №802", "Нет номера"]) {
    await assert.rejects(scoped.assertTaskNumber(dialog(text)));
  }
  await assert.rejects(scoped.assertTaskNumber(dialog("Задача №801 · Ручная задача", false)));
});

test("orchestration is restricted to one pilot and the requested two routes and viewports", async () => {
  const harness = fakeHarness();
  await scoped.runChecks(harness, {}, {});
  assert.deepEqual(harness.calls.filter((call) => call[0] === "capture"), [
    ["capture", "pilot", "content", "empty", 390, 844],
    ["capture", "pilot", "content", "empty", 1440, 900],
    ["capture", "pilot", "tasks", "empty", 390, 844],
    ["capture", "pilot", "tasks", "empty", 1440, 900],
    ["capture", "pilot", "content", "populated", 390, 844],
    ["capture", "pilot", "content", "populated", 1440, 900],
    ["capture", "pilot", "tasks", "populated", 390, 844],
    ["capture", "pilot", "tasks", "populated", 1440, 900],
  ]);
  assert.deepEqual(harness.calls.filter((call) => call[0] === "dialog"), [["dialog", 390, 844], ["dialog", 1440, 900]]);
  assert.equal(harness.calls.filter((call) => call[0] === "structure").length, 4);
  assert.equal(harness.calls.filter((call) => call[0] === "typography").length, 4);
  assert.equal(harness.calls.filter((call) => call[0] === "populated").length, 4);
  assert.equal(harness.manifest.length, 10);
  assert.equal(scoped.expectedPngNames().length, 14);
  assert.equal(new Set(scoped.expectedPngNames()).size, 14);
});

test("existing route and modal failures stop the scoped run", async () => {
  const badRoute = fakeHarness();
  badRoute.assertWaveStructure = () => { throw new Error("original geometry assertion"); };
  await assert.rejects(scoped.runChecks(badRoute, {}, {}), /original geometry/);
  assert.equal(badRoute.calls.filter((call) => call[0] === "capture").length, 1);
  const badTabs = fakeHarness();
  badTabs.captureWaveRoute = async () => ({ tabsVerified: false });
  await assert.rejects(scoped.runChecks(badTabs, {}, {}), /tab interaction/);
  const badDialog = fakeHarness();
  badDialog.captureWorkflowDialog = async () => ({ ...goodDialog([390, 844]), footerVisible: false });
  await assert.rejects(scoped.runChecks(badDialog, {}, {}), /scroll\/footer/);
});

test("original dialog invariants reject overflow, unreachable controls, contextual help and cramped mobile dialogs", () => {
  scoped.assertWorkflowDialog(goodDialog([390, 844]), [390, 844]);
  for (const patch of [
    { horizontalOverflow: true }, { portalParent: false }, { layerPosition: "absolute" },
    { layerCoversViewport: false }, { dialogContained: false }, { bodyOverflowY: "hidden" },
    { bodyFooterOverlap: true }, { footerVisible: false }, { actionVisible: false }, { closeVisible: false },
    { checklistHelpVisible: 1 }, { helpLauncherVisible: true }, { dialogWidth: 369 }, { dialogHeight: 823 },
  ]) assert.throws(() => scoped.assertWorkflowDialog({ ...goodDialog([390, 844]), ...patch }, [390, 844]));
});

test("exact synthetic artifacts and bounded receipt remain uploader-readable under restrictive umask", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-visual-test-"));
  const previous = process.umask(0o077);
  try {
    const names = [...scoped.expectedPngNames(), "manifest.json"];
    for (const name of names) fs.writeFileSync(path.join(directory, name), "synthetic");
    scoped.verifyArtifacts(directory);
    scoped.writeScopedResult({ kind: "synthetic-content-tasks-scoped", result: "blocked" }, directory);
    for (const name of [...names, "scoped-result.json"]) {
      assert.equal(fs.statSync(path.join(directory, name)).mode & 0o777, 0o644);
    }
    assert.throws(() => scoped.writeScopedResult({ result: "pass" }, directory), /EEXIST/);
  } finally {
    process.umask(previous);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unknown, missing, empty or symlinked artifact entries fail before permission changes", () => {
  for (const mode of ["unknown", "missing", "empty", "symlink"]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-visual-negative-"));
    try {
      for (const name of [...scoped.expectedPngNames(), "manifest.json"]) {
        fs.writeFileSync(path.join(directory, name), "synthetic", { mode: 0o600 });
      }
      const target = path.join(directory, scoped.expectedPngNames()[0]);
      if (mode === "unknown") fs.writeFileSync(path.join(directory, "unexpected.txt"), "synthetic");
      if (mode === "missing") fs.unlinkSync(target);
      if (mode === "empty") fs.truncateSync(target);
      if (mode === "symlink") { fs.unlinkSync(target); fs.symlinkSync("manifest.json", target); }
      assert.throws(() => scoped.verifyArtifacts(directory));
      assert.equal(fs.statSync(path.join(directory, "manifest.json")).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
