import { Miniflare, Log, LogLevel } from "miniflare";
import process from "node:process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const applicationRoot = process.cwd();
const serverRoot = join(applicationRoot, "dist/server");
const dataRoot = process.env.ARTHELLO_D1_PATH || "/data/d1";
const port = Number(process.env.PORT || 8081);

async function collectModules(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const modules = [];
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      modules.push(...await collectModules(absolute));
      continue;
    }
    if (!entry.isFile() || (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs"))) continue;
    modules.push({ type: "ESModule", path: absolute });
  }
  return modules;
}

const collected = await collectModules(serverRoot);
const entryPath = join(serverRoot, "index.js");
const entry = collected.find((module) => module.path === entryPath);
if (!entry) throw new Error("dist/server/index.js is missing");
const modules = [entry, ...collected.filter((module) => module.path !== entryPath)];

const runtime = new Miniflare({
  host: "0.0.0.0",
  port,
  inspectorPort: 0,
  log: new Log(LogLevel.INFO),
  logRequests: false,
  telemetry: { enabled: false },
  defaultPersistRoot: dataRoot,
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  modules,
  modulesRoot: serverRoot,
  bindings: {
    ARTHELLO_BOOTSTRAP_LOGIN: process.env.ARTHELLO_BOOTSTRAP_LOGIN || "owner",
    ARTHELLO_BOOTSTRAP_PASSWORD: process.env.ARTHELLO_BOOTSTRAP_PASSWORD || "",
  },
  d1Databases: { DB: "arthello-production" },
  d1Persist: dataRoot,
  assets: {
    directory: `${applicationRoot}/dist/client`,
    binding: "ASSETS",
    routerConfig: {
      invoke_user_worker_ahead_of_assets: false,
      has_user_worker: true,
    },
  },
});

const url = await runtime.ready;
console.log(`ARTHELLO_NEW_UI_READY=${url}`);

async function shutdown() {
  await runtime.dispose();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
