import { Miniflare, Log, LogLevel } from "miniflare";
import process from "node:process";

const applicationRoot = process.cwd();
const dataRoot = process.env.ARTHELLO_D1_PATH || "/data/d1";
const port = Number(process.env.PORT || 8081);

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
  modules: true,
  scriptPath: `${applicationRoot}/dist/server/index.js`,
  modulesRoot: `${applicationRoot}/dist/server`,
  modulesRules: [
    { type: "ESModule", include: ["**/*.js", "**/*.mjs"], fallthrough: true },
  ],
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
