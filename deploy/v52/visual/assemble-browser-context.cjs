"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const FILES = Object.freeze([
  ".dockerignore", "Dockerfile", "package.json", "pnpm-lock.yaml",
  "run.mjs", "flow.mjs", "smoke.mjs", "proxy.mjs",
]);
const inside = (root, item) => item === root || item.startsWith(root + path.sep);

function contextEntries(context) {
  const root = fs.realpathSync(context);
  const modules = path.join(root, "node_modules");
  const expected = [...FILES, "node_modules"].sort();
  if (JSON.stringify(fs.readdirSync(root).sort()) !== JSON.stringify(expected)) {
    throw new Error("Browser context contains missing or unexpected entries");
  }
  const entries = [];
  function visit(item) {
    const stat = fs.lstatSync(item);
    if (stat.isSymbolicLink()) {
      if (path.isAbsolute(fs.readlinkSync(item)) || !inside(modules, item) || !inside(modules, fs.realpathSync(item))) {
        throw new Error("Browser dependency link is not portable within the copied context");
      }
      return;
    }
    if (!stat.isDirectory() && !stat.isFile()) throw new Error("Browser context contains a special file");
    if (stat.isFile() && stat.nlink !== 1) throw new Error("Browser context contains a shared hardlink");
    entries.push({ item, stat });
    if (stat.isDirectory()) for (const name of fs.readdirSync(item)) visit(path.join(item, name));
  }
  visit(root);
  const resolved = fs.realpathSync(require.resolve("playwright-core/package.json", { paths: [root] }));
  if (!inside(modules, resolved)) throw new Error("Browser package resolved outside the copied context");
  const wanted = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const installed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (wanted.dependencies?.["playwright-core"] !== "1.62.1" ||
      installed.name !== "playwright-core" || installed.version !== "1.62.1") {
    throw new Error("Browser package differs from the frozen version");
  }
  return entries;
}

function validateBrowserContext(context) {
  for (const { stat } of contextEntries(context)) {
    const required = stat.isDirectory() ? 0o005 : 0o004;
    if ((stat.mode & required) !== required) throw new Error("Browser context is unreadable after root-owned Docker COPY");
  }
}

function makeBrowserReadable(context) {
  // Inspect the complete graph before chmod: no path may reach a cache, secret,
  // source checkout or other object outside this invocation's public context.
  const entries = contextEntries(context);
  for (const { item, stat } of entries) fs.chmodSync(item, (stat.mode & 0o777) | (stat.isDirectory() ? 0o555 : 0o444));
  validateBrowserContext(context);
}

function assembleBrowserContext(source, destination) {
  const context = path.resolve(destination);
  const previousMask = process.umask(0o022);
  try {
    fs.mkdirSync(context, { mode: 0o755 }); // Existing contexts are never reused.
    for (const name of FILES) {
      const input = path.join(source, name);
      if (!fs.lstatSync(input).isFile()) throw new Error("Browser source input is not a regular file");
      fs.copyFileSync(input, path.join(context, name), fs.constants.COPYFILE_EXCL);
    }
    const result = spawnSync("corepack", ["pnpm@11.7.0", "--dir", context, "install",
      "--ignore-workspace", "--frozen-lockfile", "--package-import-method=copy"],
    { cwd: context, stdio: "inherit", timeout: 120000 });
    if (result.error || result.status !== 0) throw new Error("Locked browser dependency assembly failed");
    // Cached package files can retain 0600 from a previous private install.
    // Copy import keeps normalization from changing shared cache hardlinks.
    makeBrowserReadable(context);
  } finally {
    process.umask(previousMask);
  }
}

if (require.main === module) {
  if (process.argv.length !== 4) throw new Error("Browser source and new context directories required");
  assembleBrowserContext(process.argv[2], process.argv[3]);
  console.log("ARTHELLO_BROWSER_CONTEXT=READY");
}
module.exports = { FILES, assembleBrowserContext, makeBrowserReadable, validateBrowserContext };
