import { Miniflare, Log, LogLevel } from "miniflare";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";

import { createProductionBackupControl } from "./backup-control.mjs";
import { createProductionBackupManager } from "./backup-manager.mjs";

const applicationRoot = process.cwd();
const dataRoot = process.env.ARTHELLO_D1_PATH || "/data/d1";
const backupRoot = process.env.ARTHELLO_BACKUP_ROOT || "/backups";
const port = requiredPort(process.env.PORT || "8081", "PORT");
const backupControlPort = requiredPort(process.env.ARTHELLO_BACKUP_CONTROL_PORT || "8082", "ARTHELLO_BACKUP_CONTROL_PORT");
const backupControlToken = requiredSecret(process.env.ARTHELLO_BACKUP_CONTROL_TOKEN, "ARTHELLO_BACKUP_CONTROL_TOKEN", 32, 2_048);
const backupEncryptionKey = requiredSecret(process.env.ARTHELLO_BACKUP_ENCRYPTION_KEY, "ARTHELLO_BACKUP_ENCRYPTION_KEY", 32);
const applicationRevision = (process.env.ARTHELLO_APPLICATION_REVISION || "unknown").slice(0, 128);
const backupControlUrl = `http://127.0.0.1:${backupControlPort}`;

let runtime = null;
let validationRuntime = null;
let applicationLifecycleState = "stopped";
let shuttingDown = false;
let shutdownPromise = null;

function requiredPort(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${name} must be a valid TCP port`);
  return parsed;
}

function requiredSecret(value, name, minimumLength, maximumLength = 4_096) {
  if (typeof value !== "string" || value.length < minimumLength || value.length > maximumLength || !/^[\x21-\x7e]+$/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function lifecycleUncertain(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "APPLICATION_LIFECYCLE_UNCERTAIN";
  return error;
}

function miniflareOptions({ host = "0.0.0.0", listenerPort = port } = {}) {
  return {
    host,
    port: listenerPort,
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
      ARTHELLO_BACKUP_CONTROL_URL: backupControlUrl,
      ARTHELLO_BACKUP_CONTROL_TOKEN: backupControlToken,
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
  };
}

async function startApplication() {
  if (shuttingDown) throw new Error("Application is shutting down");
  if (applicationLifecycleState === "running" && runtime) return;
  if (applicationLifecycleState !== "stopped" || runtime || validationRuntime) {
    throw lifecycleUncertain("Application lifecycle is not safely stopped");
  }
  applicationLifecycleState = "starting";
  // Validate the restored database on an isolated loopback listener. No
  // public request can be admitted while this probe may still trigger a
  // safety rollback that would discard writes.
  let validation;
  try {
    validation = new Miniflare(miniflareOptions({ host: "127.0.0.1", listenerPort: 0 }));
    validationRuntime = validation;
  } catch (error) {
    applicationLifecycleState = "stopped";
    throw error;
  }
  try {
    const validationUrl = await validation.ready;
    await waitForApplicationHealth(validationUrl);
  } catch (error) {
    try {
      await validation.dispose();
    } catch (disposeError) {
      applicationLifecycleState = "lifecycle_uncertain";
      throw lifecycleUncertain("Validation runtime disposal could not be confirmed", disposeError);
    }
    validationRuntime = null;
    applicationLifecycleState = "stopped";
    throw error;
  }
  try {
    await validation.dispose();
  } catch (error) {
    applicationLifecycleState = "lifecycle_uncertain";
    throw lifecycleUncertain("Validation runtime disposal could not be confirmed", error);
  }
  validationRuntime = null;

  // Admission starts only after isolated validation has completed. There are
  // deliberately no rollback-capable health checks after this public bind.
  let publicRuntime;
  try {
    publicRuntime = new Miniflare(miniflareOptions());
    runtime = publicRuntime;
  } catch (error) {
    applicationLifecycleState = "stopped";
    throw error;
  }
  let publicUrl;
  try {
    publicUrl = await publicRuntime.ready;
  } catch (error) {
    try {
      await publicRuntime.dispose();
    } catch (disposeError) {
      applicationLifecycleState = "lifecycle_uncertain";
      throw lifecycleUncertain("Public runtime disposal could not be confirmed", disposeError);
    }
    runtime = null;
    applicationLifecycleState = "stopped";
    throw error;
  }
  applicationLifecycleState = "running";
  try {
    console.log(`ARTHELLO_NEW_UI_READY=${publicUrl}`);
  } catch {
    // Logging is not a rollback-capable readiness gate after public admission.
  }
}

async function waitForApplicationHealth(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const healthUrl = `${origin}/api/health`;
  const readinessUrl = `${origin}/api/health/ready`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const healthResponse = await fetch(healthUrl, {
        cache: "no-store",
        headers: { "cache-control": "no-store" },
        signal: AbortSignal.timeout(2_000),
      });
      if (healthResponse.ok && (await healthResponse.text()).includes('"status":"ok"')) {
        // The generic route can succeed before D1/auth initialization is usable.
        // This read-only route queries the core marker, owner grant, and owner
        // credential from the restored D1 database.
        const readinessResponse = await fetch(readinessUrl, {
          cache: "no-store",
          headers: { "cache-control": "no-store" },
          redirect: "error",
          signal: AbortSignal.timeout(2_000),
        });
        if (readinessResponse.ok && (await readinessResponse.text()).includes('"status":"ok"')) return;
      }
    } catch {
      // The listener can be ready shortly before application initialization.
    }
    await wait(500);
  }
  throw new Error("ArtHello application health check did not become ready");
}

async function stopApplication() {
  if (applicationLifecycleState === "stopped" && !runtime && !validationRuntime) return;
  const active = runtime;
  if (applicationLifecycleState !== "running" || !active || validationRuntime) {
    throw lifecycleUncertain("Application lifecycle cannot be stopped safely");
  }
  // Keep the authoritative reference until disposal succeeds. If dispose()
  // throws, startApplication() must not create a possible second writer while
  // the old listener/runtime may still be alive.
  applicationLifecycleState = "stopping";
  try {
    await active.dispose();
  } catch (error) {
    applicationLifecycleState = "lifecycle_uncertain";
    throw lifecycleUncertain("Public runtime disposal could not be confirmed", error);
  }
  if (runtime === active) runtime = null;
  applicationLifecycleState = "stopped";
}

const manager = createProductionBackupManager({
  dataRoot,
  backupRoot,
  encryptionKey: backupEncryptionKey,
  applicationRevision,
  dailyRetentionDays: 30,
  monthlyRetentionMonths: 12,
  isApplicationStopped: () => applicationLifecycleState === "stopped" && runtime === null && validationRuntime === null,
});

const backupControl = createProductionBackupControl({
  manager,
  token: backupControlToken,
  backupRoot,
  stopApplication,
  startApplication,
});

// Reconcile manager-owned crash artifacts before Miniflare can open or serve
// the D1 database. Divergent rollback archives fail startup closed and leave a
// sanitized operator-action audit record outside D1.
await manager.startupPreflight();
await startApplication();
try {
  await backupControl.listen({ port: backupControlPort });
  backupControl.startScheduler();
  console.log(`ARTHELLO_BACKUP_CONTROL=READY revision=${applicationRevision}`);
} catch (error) {
  await stopApplication().catch(() => {});
  throw error;
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    // Stop new backup requests first, then let an accepted create/restore reach
    // a durable outcome before Miniflare and the process are terminated.
    await backupControl.close({ drain: true }).catch(() => {});
    shuttingDown = true;
    await stopApplication().catch(() => {});
    process.exit(0);
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
