import { Miniflare, Log, LogLevel } from "miniflare";
import { readFileSync } from "node:fs";
import process from "node:process";

const applicationRoot = process.cwd();
const dataRoot = process.env.ARTHELLO_D1_PATH || "/data/d1";
const port = Number(process.env.PORT || 8081);
const publicOrigin = process.env.ARTHELLO_PUBLIC_ORIGIN || "https://arthello-188-225-38-55.sslip.io";
const integrationCredentialsKey = readRuntimeSecret(
  "INTEGRATION_CREDENTIALS_KEY",
  "INTEGRATION_CREDENTIALS_KEY_FILE",
);

if (integrationCredentialsKey.length < 32) {
  throw new Error("INTEGRATION_CREDENTIALS_KEY must contain at least 32 characters");
}

const runtime = new Miniflare({
  host: "0.0.0.0",
  port,
  inspectorPort: 0,
  log: new Log(LogLevel.INFO),
  logRequests: false,
  telemetry: { enabled: false },
  cf: false,
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
    ARTHELLO_PUBLIC_ORIGIN: publicOrigin,
    ARTHELLO_BOOTSTRAP_LOGIN: process.env.ARTHELLO_BOOTSTRAP_LOGIN || "owner",
    ARTHELLO_BOOTSTRAP_PASSWORD: readRuntimeSecret(
      "ARTHELLO_BOOTSTRAP_PASSWORD",
      "ARTHELLO_BOOTSTRAP_PASSWORD_FILE",
    ),
    INTEGRATION_CREDENTIALS_KEY: integrationCredentialsKey,
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

function readRuntimeSecret(valueName, fileName) {
  const direct = process.env[valueName] || "";
  const filePath = process.env[fileName] || "";
  if (!filePath) return direct;
  let fromFile = "";
  try {
    fromFile = readFileSync(filePath, "utf8").trim();
  } catch {
    throw new Error(`${fileName} cannot be read`);
  }
  if (direct && direct !== fromFile) {
    throw new Error(`${valueName} conflicts with ${fileName}`);
  }
  return fromFile;
}

const url = await runtime.ready;
console.log(`ARTHELLO_NEW_UI_READY=${url}`);

async function shutdown() {
  await runtime.dispose();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
