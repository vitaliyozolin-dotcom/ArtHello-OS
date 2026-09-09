"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { FILES, assembleBrowserContext, makeBrowserReadable, validateBrowserContext } = require("./assemble-browser-context.cjs");

test("real locked pnpm assembly remains portable and readable under the private launcher umask", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "arthello-browser-assembly-"));
  const previousMask = process.umask(0o077);
  try {
    const source = process.env.VISUAL_BROWSER_TEST_SOURCE || path.resolve(__dirname, "../../browser");
    const original = new Map(FILES.map((name) => [name, fs.readFileSync(path.join(source, name))]));
    const fixtureSource = path.join(work, "checkout", "deploy", "browser");
    fs.mkdirSync(fixtureSource, { recursive: true });
    for (const [name, bytes] of original) fs.writeFileSync(path.join(fixtureSource, name), bytes);
    fs.writeFileSync(path.join(work, "checkout", ".npmrc"), "registry=https://invalid.example/\n");
    fs.writeFileSync(path.join(fixtureSource, "unrelated-secret.env"), "synthetic-private-marker");
    const context = path.join(work, "context");
    assembleBrowserContext(fixtureSource, context);
    assert.equal(process.umask(), 0o077);
    fs.writeFileSync(path.join(work, "later-secret.env"), "synthetic-private-marker");
    assert.equal(fs.statSync(path.join(work, "later-secret.env")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(work).mode & 0o777, 0o700);
    assert.equal(fs.existsSync(path.join(context, "unrelated-secret.env")), false);
    assert.equal(fs.existsSync(path.join(context, ".npmrc")), false);
    for (const [name, bytes] of original) assert.deepEqual(fs.readFileSync(path.join(context, name)), bytes);
    validateBrowserContext(context);
    // Relocate exactly what Docker COPY includes; absolute/ancestor-store links
    // cannot accidentally resolve back into the install location after this.
    const relocated = path.join(work, "root-owned-image-copy");
    const copyingMask = process.umask(0o022);
    try { fs.cpSync(context, relocated, { recursive: true, verbatimSymlinks: true }); }
    finally { process.umask(copyingMask); }
    fs.rmSync(context, { recursive: true });
    validateBrowserContext(relocated);
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e",
      'import("playwright-core").then(m=>{if(typeof m.chromium.launch!=="function")process.exit(2)})'],
    { cwd: relocated, encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr);
    const packageJson = require.resolve("playwright-core/package.json", { paths: [relocated] });
    fs.chmodSync(path.dirname(packageJson), 0o700);
    fs.chmodSync(packageJson, 0o600);
    assert.throws(() => validateBrowserContext(relocated), /unreadable/);
    makeBrowserReadable(relocated);
    validateBrowserContext(relocated);
    assert.equal(fs.statSync(packageJson).mode & 0o004, 0o004);
  } finally {
    process.umask(previousMask);
    fs.rmSync(work, { recursive: true, force: true });
  }
});

function smallContext(work) {
  const root = path.join(work, "context");
  const modules = path.join(root, "node_modules");
  fs.mkdirSync(path.join(modules, "playwright-core"), { recursive: true });
  for (const file of FILES) fs.writeFileSync(path.join(root, file), file === "package.json"
    ? JSON.stringify({ dependencies: { "playwright-core": "1.62.1" } }) : "synthetic-public-input");
  fs.writeFileSync(path.join(modules, "playwright-core", "package.json"), JSON.stringify({ name: "playwright-core", version: "1.62.1" }));
  return root;
}

test("permission normalization rejects escaping, dangling and absolute links before touching private targets", () => {
  for (const kind of ["outside", "dangling", "absolute-internal"]) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "arthello-browser-links-"));
    try {
      const context = smallContext(work);
      const secret = path.join(work, "private.env");
      fs.writeFileSync(secret, "synthetic-private-marker", { mode: 0o600 });
      fs.chmodSync(context, 0o700);
      const target = kind === "outside" ? "../../private.env" : kind === "dangling" ? "../../absent"
        : path.join(context, "node_modules", "playwright-core", "package.json");
      fs.symlinkSync(target, path.join(context, "node_modules", "bad-link"));
      assert.throws(() => makeBrowserReadable(context));
      assert.equal(fs.statSync(secret).mode & 0o777, 0o600);
      assert.equal(fs.statSync(context).mode & 0o777, 0o700);
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  }
});

test("shared hardlinks are rejected before permission normalization changes a cache file", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "arthello-browser-hardlinks-"));
  try {
    const context = smallContext(work);
    const cacheFile = path.join(work, "cached-file");
    fs.writeFileSync(cacheFile, "synthetic-public-cache", { mode: 0o600 });
    fs.linkSync(cacheFile, path.join(context, "node_modules", "cache-link"));
    assert.throws(() => makeBrowserReadable(context), /shared hardlink/);
    assert.equal(fs.statSync(cacheFile).mode & 0o777, 0o600);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test("assembly refuses an existing context and restores the caller's private umask on failure", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "arthello-browser-existing-"));
  const previousMask = process.umask(0o077);
  try {
    fs.writeFileSync(path.join(work, "keep"), "existing-private-data", { mode: 0o600 });
    assert.throws(() => assembleBrowserContext("unused", work), /EEXIST/);
    assert.equal(process.umask(), 0o077);
    assert.equal(fs.readFileSync(path.join(work, "keep"), "utf8"), "existing-private-data");
  } finally {
    process.umask(previousMask);
    fs.rmSync(work, { recursive: true, force: true });
  }
});
