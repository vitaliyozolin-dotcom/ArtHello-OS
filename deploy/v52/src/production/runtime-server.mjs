import { randomBytes } from 'node:crypto';
import { startTochkaAutosyncTimer } from './tochka-autosync-timer.mjs';
// TOCHKA_AUTOMATIC_READONLY_V1
import { Miniflare, Log, LogLevel } from "miniflare";
import { readFileSync } from "node:fs";
import process from "node:process";
import { createTochkaTransport } from "./tochka-transport.mjs";
import { createBackupTransport } from "./backup-transport.mjs";

const applicationRoot = process.cwd();
const dataRoot = process.env.ARTHELLO_D1_PATH || "/data/d1";
const port = Number(process.env.PORT || 8081);
const publicOrigin = process.env.ARTHELLO_PUBLIC_ORIGIN || "https://arthello-188-225-38-55.sslip.io";
const integrationCredentialsKey = readRuntimeSecret(
  "INTEGRATION_CREDENTIALS_KEY",
  "INTEGRATION_CREDENTIALS_KEY_FILE",
);
const centralAccessSecret = readRuntimeSecret(
  "CENTRAL_ACCESS_SECRET",
  "CENTRAL_ACCESS_SECRET_FILE",
);
const openAiApiKey = readRuntimeSecret(
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_FILE",
);
const openAiOcrModel = allowedOpenAiOcrModel(process.env.OPENAI_OCR_MODEL);

if (integrationCredentialsKey.length < 32) {
  throw new Error("INTEGRATION_CREDENTIALS_KEY must contain at least 32 characters");
}

const tochkaAutosyncEnabled = process.env.TOCHKA_AUTOSYNC_ENABLED === '1';
const tochkaAutosyncSecret = tochkaAutosyncEnabled ? randomBytes(32).toString('hex') : '';

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
    ATLAS_PUBLIC_ORIGIN: process.env.ATLAS_PUBLIC_ORIGIN || "",
    ATLAS_CENTRAL_ACCESS_SECRET: readRuntimeSecret("ATLAS_CENTRAL_ACCESS_SECRET", "ATLAS_CENTRAL_ACCESS_SECRET_FILE"),
    SCHOOL_PUBLIC_ORIGIN: process.env.SCHOOL_PUBLIC_ORIGIN || "",
    SCHOOL_DIARY_SYNC_URL: process.env.SCHOOL_DIARY_SYNC_URL || "",
    SCHOOL_DIARY_ALLOWED_ORIGINS: process.env.SCHOOL_DIARY_ALLOWED_ORIGINS || "",
    CENTRAL_ACCESS_SECRET: centralAccessSecret,
    OPENAI_API_KEY: openAiApiKey,
    OPENAI_OCR_MODEL: openAiOcrModel,
    INTEGRATION_CREDENTIALS_KEY: integrationCredentialsKey,
    TBANK_EGRESS_IP: process.env.TBANK_EGRESS_IP || "",
    TOCHKA_AUTOSYNC_SECRET: tochkaAutosyncSecret,
    ALFACRM_IMPORT_ENABLED: process.env.ALFACRM_IMPORT_ENABLED || "",
  },
  serviceBindings: { TOCHKA_TRANSPORT: createTochkaTransport(), BACKUP_TRANSPORT: createBackupTransport() },
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

function allowedOpenAiOcrModel(value) {
  const requested = (value || "").trim();
  return new Set(["gpt-4.1-mini"]).has(requested)
    ? requested
    : "gpt-4.1-mini";
}

const url = await runtime.ready;
console.log(`ARTHELLO_NEW_UI_READY=${url}`);

const tochkaAutosyncTimer = startTochkaAutosyncTimer({ runtime, secret: tochkaAutosyncSecret, publicOrigin, enabled: tochkaAutosyncEnabled, releaseSha: process.env.RELEASE_SHA || "", activationId: process.env.TOCHKA_AUTOSYNC_ACTIVATION_ID || "" });

async function shutdown() {
  tochkaAutosyncTimer.stop();
  await runtime.dispose();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
