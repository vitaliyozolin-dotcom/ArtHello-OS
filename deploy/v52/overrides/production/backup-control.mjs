import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

export const BACKUP_POLICY = Object.freeze({
  automaticEnabled: true,
  time: "03:00",
  timezone: "Europe/Moscow",
  dailyRetentionDays: 30,
  monthlyRetentionMonths: 12,
  scope: "Вся база данных ArtHello OS (D1/SQLite). Файлы, расположенные вне базы, в копию не входят.",
});

const OPERATION_MESSAGES = Object.freeze({
  create: "Создание резервной копии выполняется.",
  restore: "Восстановление базы выполняется.",
});
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const STOPPED_RECOVERY_REQUIRED_CODES = new Set([
  "RESTORE_ROLLBACK_FAILED",
  "RESTORE_RECOVERY_REQUIRED",
  "LOCK_RECOVERY_REQUIRED",
  "APPLICATION_LIFECYCLE_UNCERTAIN",
  "APPLICATION_NOT_STOPPED",
]);
const BACKUP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const MAX_BODY_BYTES = 8 * 1024;
const MOSCOW_UTC_OFFSET_HOURS = 3;
const DEPLOY_GATE_FORMAT = "arthello-deploy-gate-v1";
const IDEMPOTENCY_FORMAT = "arthello-control-idempotency-v1";
const IDEMPOTENCY_JOURNAL_FILE = "control-idempotency.ndjson";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const DEPLOY_GATE_RECONCILE_AFTER_MS = 8 * 60 * 60 * 1000;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function domainHash(domain, value) {
  return createHash("sha256").update(`${domain}\0`, "utf8").update(value, "utf8").digest("hex");
}

function idempotencyKeyHash(value) {
  return domainHash("arthello-control-idempotency-key-v1", value);
}

function operationFingerprintHash({ type, actor, backupId }) {
  return domainHash(
    "arthello-control-idempotency-fingerprint-v1",
    JSON.stringify({ type, actor, backupId: backupId ?? null }),
  );
}

function publicOperation(operation) {
  if (!operation) return null;
  const result = {
    id: operation.id,
    type: operation.type,
    status: operation.status,
    message: OPERATION_MESSAGES[operation.type],
  };
  if (operation.backupId) result.backupId = operation.backupId;
  if (operation.startedAt) result.startedAt = operation.startedAt;
  if (operation.finishedAt) result.finishedAt = operation.finishedAt;
  return result;
}

function asIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function moscowParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BACKUP_POLICY.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function localDayKey(value) {
  const parts = moscowParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localMonthKey(value) {
  return localDayKey(value).slice(0, 7);
}

function scheduledUtc(parts) {
  const [hour, minute] = BACKUP_POLICY.time.split(":").map(Number);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - MOSCOW_UTC_OFFSET_HOURS, minute));
}

function nextLocalDay(parts) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function addRetention(createdAt, kind) {
  const value = new Date(createdAt);
  if (Number.isNaN(value.getTime())) return null;
  if (kind === "automatic" || kind === "pre_deploy" || kind === "pre_restore") {
    value.setUTCDate(value.getUTCDate() + BACKUP_POLICY.dailyRetentionDays);
    return value.toISOString();
  }
  if (kind === "monthly") {
    value.setUTCMonth(value.getUTCMonth() + BACKUP_POLICY.monthlyRetentionMonths);
    return value.toISOString();
  }
  return null;
}

function pointFromSummary(summary) {
  return {
    id: String(summary.id),
    kind: summary.kind,
    createdAt: asIso(summary.createdAt) ?? new Date(0).toISOString(),
    sizeBytes: Number.isSafeInteger(summary.sizeBytes) && summary.sizeBytes >= 0 ? summary.sizeBytes : 0,
    integrity: summary.verified === true ? "verified" : "failed",
    compatible: summary.compatible === true,
    applicationRevision: typeof summary.applicationRevision === "string" ? summary.applicationRevision.slice(0, 128) : "unknown",
    coreSchemaVersion: summary.coreSchemaVersion == null ? null : String(summary.coreSchemaVersion).slice(0, 128),
    expiresAt: addRetention(summary.createdAt, summary.kind),
  };
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw Object.assign(new Error("invalid_content_type"), { status: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("body_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

async function appendAudit(path, record, { beforeDirectorySync } = {}) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await open(path, "a", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await beforeDirectorySync?.();
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

export class ProductionBackupControl {
  constructor({
    manager,
    token,
    backupRoot,
    stopApplication,
    startApplication,
    now = () => new Date(),
    operationStartDelayMs = 100,
    hooks = {},
  }) {
    if (
      !manager
      || typeof manager.create !== "function"
      || typeof manager.list !== "function"
      || typeof manager.restore !== "function"
      || typeof manager.restoreSafetyBackup !== "function"
      || typeof manager.startupPreflight !== "function"
    ) {
      throw new TypeError("A production backup manager is required");
    }
    if (typeof token !== "string" || token.length < 32 || token.length > 2048 || !/^[\x21-\x7e]+$/.test(token)) {
      throw new TypeError("ARTHELLO_BACKUP_CONTROL_TOKEN must contain 32-2048 printable ASCII characters");
    }
    if (typeof backupRoot !== "string" || !backupRoot.startsWith("/")) throw new TypeError("An absolute backup root is required");
    if (typeof stopApplication !== "function" || typeof startApplication !== "function") {
      throw new TypeError("Application lifecycle callbacks are required");
    }
    this.manager = manager;
    this.token = token;
    this.backupRoot = backupRoot;
    this.stopApplication = stopApplication;
    this.startApplication = startApplication;
    this.now = now;
    this.operationStartDelayMs = operationStartDelayMs;
    this.hooks = hooks;
    this.operationsLogPath = join(backupRoot, "control-operations.ndjson");
    this.idempotencyJournalPath = join(backupRoot, IDEMPOTENCY_JOURNAL_FILE);
    this.deploymentGatePath = join(backupRoot, ".deploy-gate");
    this.activeOperation = null;
    this.idempotentOperations = new Map();
    this.idempotencyLoaded = false;
    this.idempotencyLoadPromise = null;
    this.idempotencyOutcomeUncertain = false;
    this.lastError = null;
    this.server = null;
    this.scheduleTimer = null;
    this.lastScheduleAttemptAt = null;
    this.lastSuccessfulAutomaticDay = null;
    this.pendingOperationTimer = null;
    this.pendingOperationStart = null;
    this.operationPromise = null;
    this.operationFinalizing = false;
    this.closing = false;
    this.catalogCache = null;
  }

  authorized(request) {
    const value = String(request.headers.authorization ?? "");
    return value.startsWith("Bearer ") && safeEqual(value.slice(7), this.token);
  }

  async audit(operation, status, extra = {}) {
    await appendAudit(this.operationsLogPath, {
      occurredAt: this.now().toISOString(),
      operationId: operation.id,
      operationType: operation.type,
      status,
      actor: operation.actor,
      backupId: operation.backupId ?? null,
      ...extra,
    });
  }

  async ensureIdempotencyLoaded() {
    if (this.idempotencyLoaded) return;
    if (!this.idempotencyLoadPromise) {
      this.idempotencyLoadPromise = this.loadIdempotencyJournal().finally(() => {
        this.idempotencyLoadPromise = null;
      });
    }
    await this.idempotencyLoadPromise;
  }

  async loadIdempotencyJournal() {
    let body;
    try {
      body = await readFile(this.idempotencyJournalPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.idempotencyLoaded = true;
        return;
      }
      throw error;
    }

    let corrupt = false;
    for (const line of body.split("\n")) {
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        corrupt = true;
        continue;
      }
      const commonValid = row?.format === IDEMPOTENCY_FORMAT
        && typeof row?.occurredAt === "string"
        && Number.isFinite(Date.parse(row.occurredAt))
        && SHA256_PATTERN.test(row?.keyHash ?? "")
        && SHA256_PATTERN.test(row?.fingerprintHash ?? "")
        && OPERATION_ID_PATTERN.test(row?.operationId ?? "")
        && (row?.operationType === "create" || row?.operationType === "restore")
        && (row?.backupId === null || BACKUP_ID_PATTERN.test(row?.backupId ?? ""));
      if (!commonValid) {
        corrupt = true;
        continue;
      }
      const existing = this.idempotentOperations.get(row.keyHash);
      if (row.event === "registered") {
        if (existing) {
          corrupt = true;
          continue;
        }
        this.idempotentOperations.set(row.keyHash, {
          accepted: true,
          durableState: "registered",
          fingerprintHash: row.fingerprintHash,
          live: false,
          operation: {
            id: row.operationId,
            type: row.operationType,
            status: "queued",
            backupId: BACKUP_ID_PATTERN.test(row.backupId ?? "") ? row.backupId : undefined,
          },
        });
        continue;
      }
      const terminalValid = row.event === "terminal"
        && (row.status === "succeeded" || row.status === "failed")
        && typeof row.finishedAt === "string"
        && Number.isFinite(Date.parse(row.finishedAt))
        && (row.startedAt === null || (typeof row.startedAt === "string" && Number.isFinite(Date.parse(row.startedAt))))
        && (row.backupId === null || BACKUP_ID_PATTERN.test(row.backupId ?? ""))
        && (row.auditStatus === "recorded" || row.auditStatus === "degraded");
      if (
        !terminalValid
        || !existing
        || existing.durableState !== "registered"
        || existing.fingerprintHash !== row.fingerprintHash
        || existing.operation.id !== row.operationId
        || existing.operation.type !== row.operationType
      ) {
        corrupt = true;
        continue;
      }
      existing.durableState = "terminal";
      existing.operation.status = row.status;
      existing.operation.backupId = row.backupId ?? existing.operation.backupId;
      existing.operation.startedAt = row.startedAt ?? undefined;
      existing.operation.finishedAt = row.finishedAt;
      existing.operation.auditStatus = row.auditStatus;
      existing.operation.failureCode = typeof row.failureCode === "string" ? row.failureCode.slice(0, 80) : undefined;
    }

    if (corrupt || [...this.idempotentOperations.values()].some((entry) => entry.durableState !== "terminal")) {
      this.idempotencyOutcomeUncertain = true;
      this.lastError = corrupt ? "idempotency_journal_invalid" : "idempotency_outcome_uncertain";
    }
    this.idempotencyLoaded = true;
  }

  async appendIdempotency(record) {
    const beforeAppend = record.event === "registered"
      ? this.hooks.beforeIdempotencyRegistrationAppend
      : this.hooks.beforeIdempotencyTerminalAppend;
    const beforeDirectorySync = record.event === "registered"
      ? this.hooks.beforeIdempotencyRegistrationDirectorySync
      : this.hooks.beforeIdempotencyTerminalDirectorySync;
    await beforeAppend?.();
    await appendAudit(
      this.idempotencyJournalPath,
      {
        format: IDEMPOTENCY_FORMAT,
        occurredAt: this.now().toISOString(),
        ...record,
      },
      { beforeDirectorySync },
    );
  }

  async appendIdempotencyRegistration(operation) {
    await this.appendIdempotency({
      event: "registered",
      keyHash: operation.idempotencyKeyHash,
      fingerprintHash: operation.fingerprintHash,
      operationId: operation.id,
      operationType: operation.type,
      backupId: operation.backupId ?? null,
    });
  }

  async appendIdempotencyTerminal(operation, failureCode = null) {
    await this.appendIdempotency({
      event: "terminal",
      keyHash: operation.idempotencyKeyHash,
      fingerprintHash: operation.fingerprintHash,
      operationId: operation.id,
      operationType: operation.type,
      status: operation.status,
      backupId: operation.backupId ?? null,
      startedAt: operation.startedAt ?? null,
      finishedAt: operation.finishedAt,
      auditStatus: operation.auditStatus === "degraded" ? "degraded" : "recorded",
      failureCode: typeof failureCode === "string" ? failureCode.slice(0, 80) : null,
    });
    const entry = this.idempotentOperations.get(operation.idempotencyKeyHash);
    if (entry?.operation === operation) entry.durableState = "terminal";
  }

  operationRunning() {
    return this.operationFinalizing
      || (this.activeOperation && ACTIVE_STATUSES.has(this.activeOperation.status));
  }

  async deploymentGateActive() {
    try {
      const details = await lstat(this.deploymentGatePath);
      if (!details.isFile() || details.isSymbolicLink() || details.size < 2 || details.size > 2_048) {
        this.lastError = "deploy_gate_invalid";
        return true;
      }
      const record = JSON.parse(await readFile(this.deploymentGatePath, "utf8"));
      const createdAt = new Date(record?.createdAt);
      if (record?.format !== DEPLOY_GATE_FORMAT
        || typeof record?.runId !== "string"
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(record.runId)
        || !Number.isFinite(createdAt.getTime())) {
        this.lastError = "deploy_gate_invalid";
        return true;
      }
      const age = this.now().getTime() - createdAt.getTime();
      if (age < -5 * 60 * 1000) {
        this.lastError = "deploy_gate_invalid";
        return true;
      }
      if (age > DEPLOY_GATE_RECONCILE_AFTER_MS) {
        this.lastError = "deploy_gate_stale_requires_reconciliation";
      }
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      this.lastError = "deploy_gate_unavailable";
      return true;
    }
  }

  async beginOperation({ type, actor, backupId, idempotencyKey, task }) {
    if (this.closing) throw Object.assign(new Error("service_closing"), { status: 503 });
    await this.ensureIdempotencyLoaded();
    const keyHash = idempotencyKeyHash(idempotencyKey);
    const fingerprintHash = operationFingerprintHash({ type, actor, backupId });
    const existing = this.idempotentOperations.get(keyHash);
    if (existing) {
      if (existing.fingerprintHash !== fingerprintHash) throw Object.assign(new Error("idempotency_key_conflict"), { status: 409 });
      if (!existing.live && existing.durableState !== "terminal") {
        throw Object.assign(new Error("idempotency_outcome_uncertain"), { status: 409 });
      }
      if (!existing.accepted) throw Object.assign(new Error("operation_registration_in_progress"), { status: 409 });
      return { operation: existing.operation, reused: true };
    }
    if (this.idempotencyOutcomeUncertain) {
      throw Object.assign(new Error("idempotency_outcome_uncertain"), { status: 409 });
    }
    if (this.operationRunning()) throw Object.assign(new Error("operation_in_progress"), { status: 409 });

    const operation = {
      id: randomUUID(),
      type,
      status: "queued",
      actor,
      backupId,
      idempotencyKeyHash: keyHash,
      fingerprintHash,
    };
    this.activeOperation = operation;
    this.idempotentOperations.set(keyHash, {
      accepted: false,
      durableState: "registering",
      fingerprintHash,
      live: true,
      operation,
    });
    let registrationAttempted = false;
    try {
      if (await this.deploymentGateActive()) throw Object.assign(new Error("deployment_in_progress"), { status: 409 });
      await this.audit(operation, "queued");
      registrationAttempted = true;
      await this.appendIdempotencyRegistration(operation);
      const reserved = this.idempotentOperations.get(keyHash);
      if (reserved?.operation === operation) {
        reserved.accepted = true;
        reserved.durableState = "registered";
      }
    } catch (error) {
      if (this.activeOperation === operation) this.activeOperation = null;
      const reserved = this.idempotentOperations.get(keyHash);
      if (reserved?.operation === operation) {
        if (registrationAttempted) {
          // Once append has started, write/close/directory-sync failures cannot
          // prove whether the durable registration exists. Retain a poisoned
          // reservation and block all mutations; deleting it could duplicate a
          // restore in this same process.
          reserved.accepted = true;
          reserved.durableState = "registered";
          reserved.live = false;
          this.idempotencyOutcomeUncertain = true;
          this.lastError = "idempotency_registration_uncertain";
        } else {
          this.idempotentOperations.delete(keyHash);
        }
      }
      throw error;
    }
    const start = () => {
      this.pendingOperationTimer = null;
      this.pendingOperationStart = null;
      const promise = this.runOperation(operation, task);
      this.operationPromise = promise;
      void promise.finally(() => {
        if (this.operationPromise === promise) this.operationPromise = null;
      });
    };
    this.pendingOperationStart = start;
    this.pendingOperationTimer = setTimeout(start, this.operationStartDelayMs);
    this.pendingOperationTimer.unref?.();
    return { operation, reused: false };
  }

  async runOperation(operation, task) {
    this.operationFinalizing = true;
    operation.status = "running";
    operation.startedAt = this.now().toISOString();
    this.catalogCache = null;
    let result;
    try {
      await this.audit(operation, "running");
      result = await task();
    } catch (error) {
      operation.status = "failed";
      operation.finishedAt = this.now().toISOString();
      const failureCode = typeof error?.code === "string" ? error.code.slice(0, 80) : "operation_failed";
      this.lastError = failureCode;
      operation.auditStatus = "recorded";
      try {
        await this.audit(operation, "failed", { failureCode });
      } catch {
        operation.auditStatus = "degraded";
        this.lastError = "audit_write_failed";
      }
      try {
        await this.appendIdempotencyTerminal(operation, failureCode);
      } catch {
        // The registered record intentionally remains without a terminal
        // outcome. This process knows the result, but a restart must treat it
        // as uncertain and refuse every new mutation until reconciliation.
        operation.auditStatus = "degraded";
        this.idempotencyOutcomeUncertain = true;
        this.lastError = "idempotency_journal_write_failed";
      }
      this.operationFinalizing = false;
      return;
    }

    if (result?.backupId) operation.backupId = result.backupId;
    operation.status = "succeeded";
    operation.finishedAt = this.now().toISOString();
    operation.auditStatus = result?.auditStatus === "degraded" ? "degraded" : "recorded";
    try {
      await this.audit(operation, "succeeded", {
        safetyBackupId: result?.safetyBackupId ?? null,
      });
      this.lastError = operation.auditStatus === "degraded" ? "manager_audit_degraded" : null;
    } catch {
      // The manager task has already returned a durable commit. A secondary
      // control-audit outage must not turn that committed create/restore into
      // a reported failure or invite a destructive retry.
      operation.auditStatus = "degraded";
      this.lastError = "audit_write_failed";
    }
    try {
      await this.appendIdempotencyTerminal(operation);
    } catch {
      operation.auditStatus = "degraded";
      this.idempotencyOutcomeUncertain = true;
      this.lastError = "idempotency_journal_write_failed";
    } finally {
      this.catalogCache = null;
      this.operationFinalizing = false;
    }
  }

  async create(kind, actor, idempotencyKey) {
    return this.beginOperation({
      type: "create",
      actor,
      idempotencyKey,
      task: () => this.manager.create(kind),
    });
  }

  async restore(backupId, actor, idempotencyKey) {
    return this.beginOperation({
      type: "restore",
      actor,
      backupId,
      idempotencyKey,
      task: () => this.performRestore(backupId),
    });
  }

  async performRestore(backupId) {
    let applicationStopped = false;
    let restoreResult = null;
    let safetyRestoreFailed = false;
    let safetyRestoreCommitted = false;
    let recoveryPreflightFailed = false;
    try {
      const target = typeof this.manager.verify === "function"
        ? await this.manager.verify(backupId)
        : (await this.manager.list({ verifyFiles: true })).find((point) => point.id === backupId);
      if (!target) throw Object.assign(new Error("backup_not_found"), { code: "BACKUP_NOT_FOUND" });
      if (target.verified !== true || target.compatible !== true) {
        throw Object.assign(new Error("backup_not_restorable"), { code: "BACKUP_NOT_RESTORABLE" });
      }
      await this.stopApplication();
      applicationStopped = true;
      restoreResult = await this.manager.restore(backupId);
      try {
        await this.startApplication();
        applicationStopped = false;
      } catch (startError) {
        if (STOPPED_RECOVERY_REQUIRED_CODES.has(startError?.code)) throw startError;
        if (!restoreResult?.safetyBackupId) throw startError;
        // The original restore already created and verified this pre_restore
        // point. Reusing the ordinary restore path here would attempt a nested
        // safety backup and can fail precisely when rollback is needed under
        // storage pressure.
        try {
          await this.manager.restoreSafetyBackup(restoreResult.safetyBackupId);
          safetyRestoreCommitted = true;
        } catch (safetyError) {
          if (STOPPED_RECOVERY_REQUIRED_CODES.has(safetyError?.code)) throw safetyError;
          safetyRestoreFailed = true;
          const recovery = await this.tryRecoveryStart();
          if (recovery.status === "started") {
            applicationStopped = false;
            return {
              ...restoreResult,
              auditStatus: "degraded",
              recoveryStatus: "target_running_safety_restore_failed",
              safetyRollbackStatus: "failed",
            };
          }
          if (recovery.status === "preflight_failed") recoveryPreflightFailed = true;
          throw recovery.error;
        }

        const safetyStart = await this.tryRecoveryStart();
        if (safetyStart.status === "started") {
          applicationStopped = false;
          const error = new Error("restored_application_failed_health_check");
          error.code = "restored_application_failed_health_check";
          throw error;
        }
        if (safetyStart.status === "preflight_failed") recoveryPreflightFailed = true;
        throw safetyStart.error;
      }
      return restoreResult;
    } catch (error) {
      if (applicationStopped) {
        if (recoveryPreflightFailed || STOPPED_RECOVERY_REQUIRED_CODES.has(error?.code)) throw error;
        const recovery = await this.tryRecoveryStart();
        if (recovery.status === "preflight_failed") throw recovery.error;
        if (recovery.status === "start_failed") {
          if (STOPPED_RECOVERY_REQUIRED_CODES.has(recovery.error?.code)) throw recovery.error;
          const restartError = new Error("application_restart_failed");
          restartError.code = "application_restart_failed";
          throw restartError;
        }
        applicationStopped = false;
        if (safetyRestoreFailed && restoreResult) {
          return {
            ...restoreResult,
            auditStatus: "degraded",
            recoveryStatus: "target_running_safety_restore_failed",
            safetyRollbackStatus: "failed",
          };
        }
        if (safetyRestoreCommitted) {
          const restoredError = new Error("restored_application_failed_health_check");
          restoredError.code = "restored_application_failed_health_check";
          throw restoredError;
        }
      }
      throw error;
    }
  }

  async tryRecoveryStart() {
    try {
      await this.manager.startupPreflight();
    } catch (error) {
      return { status: "preflight_failed", error };
    }
    try {
      await this.startApplication();
      return { status: "started", error: null };
    } catch (error) {
      return { status: "start_failed", error };
    }
  }

  async catalog() {
    let summaries = [];
    let local = "ready";
    try {
      const nowMs = this.now().getTime();
      if (this.catalogCache && nowMs - this.catalogCache.createdAt < 60_000) {
        summaries = this.catalogCache.summaries;
      } else {
        summaries = await this.manager.list({ verifyFiles: false });
        this.catalogCache = { createdAt: nowMs, summaries };
      }
      if (this.lastError === "backup_catalog_unavailable") this.lastError = null;
    } catch {
      local = "error";
      this.lastError = "backup_catalog_unavailable";
    }
    const points = summaries.map(pointFromSummary).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const automatic = points.filter((point) => point.kind === "automatic" && point.integrity === "verified" && point.compatible);
    const lastAutomaticAt = automatic[0]?.createdAt ?? null;
    const now = this.now();
    const parts = moscowParts(now);
    const todaySchedule = scheduledUtc(parts);
    const hasToday = automatic.some((point) => localDayKey(new Date(point.createdAt)) === localDayKey(now));
    const nextAutomaticAt = !hasToday && now >= todaySchedule
      ? now.toISOString()
      : (now < todaySchedule ? todaySchedule : scheduledUtc(nextLocalDay(parts))).toISOString();
    const stale = !lastAutomaticAt || now.getTime() - new Date(lastAutomaticAt).getTime() > 26 * 60 * 60 * 1000;
    const offsite = "not_configured";

    return {
      policy: BACKUP_POLICY,
      health: {
        status: local === "ready" && !stale && !this.lastError && offsite === "configured" ? "ok" : "degraded",
        lastAutomaticAt,
        nextAutomaticAt,
        lastError: this.lastError,
        storage: { local, offsite },
      },
      points,
      activeOperation: publicOperation(this.activeOperation),
    };
  }

  async tickSchedule() {
    if (!BACKUP_POLICY.automaticEnabled || this.operationRunning()) return false;
    const now = this.now();
    const parts = moscowParts(now);
    if (now < scheduledUtc(parts)) return false;
    const dayKey = localDayKey(now);
    if (this.lastSuccessfulAutomaticDay === dayKey) return false;
    if (this.lastScheduleAttemptAt && now.getTime() - this.lastScheduleAttemptAt.getTime() < 5 * 60 * 1000) return false;
    let summaries;
    try {
      summaries = await this.manager.list({ verifyFiles: false });
    } catch {
      this.lastError = "backup_catalog_unavailable";
      return false;
    }
    const hasTodayAutomatic = summaries.some((point) => point.kind === "automatic" && point.verified === true && point.compatible === true && localDayKey(new Date(point.createdAt)) === dayKey);
    const monthKey = localMonthKey(now);
    const hasMonthly = summaries.some((point) => point.kind === "monthly" && point.verified === true && point.compatible === true && localMonthKey(new Date(point.createdAt)) === monthKey);
    if (hasTodayAutomatic && hasMonthly) {
      this.lastSuccessfulAutomaticDay = dayKey;
      return false;
    }

    this.lastScheduleAttemptAt = now;
    const idempotencyKey = `automatic:${dayKey}:${now.toISOString().slice(11, 16)}`;
    await this.beginOperation({
      type: "create",
      actor: "system:scheduler",
      idempotencyKey,
      task: async () => {
        const automatic = hasTodayAutomatic ? null : await this.manager.create("automatic");
        const monthly = hasMonthly ? null : await this.manager.create("monthly");
        this.lastSuccessfulAutomaticDay = dayKey;
        return automatic ?? monthly;
      },
    });
    return true;
  }

  startScheduler(intervalMs = 60_000) {
    if (this.scheduleTimer) return;
    void this.tickSchedule().catch(() => { this.lastError = "automatic_backup_failed"; });
    this.scheduleTimer = setInterval(() => {
      void this.tickSchedule().catch(() => { this.lastError = "automatic_backup_failed"; });
    }, intervalMs);
    this.scheduleTimer.unref?.();
  }

  async handle(request, response) {
    if (!this.authorized(request)) {
      jsonResponse(response, 401, { error: { code: "unauthorized" } });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/v1/status") {
        jsonResponse(response, 200, {
          closing: this.closing,
          activeOperation: publicOperation(this.activeOperation),
          mutationState: this.idempotencyOutcomeUncertain || this.operationFinalizing ? "blocked" : "ready",
        });
        return;
      }
      if (this.closing) {
        jsonResponse(response, 503, { error: { code: "service_closing" } });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/backups") {
        jsonResponse(response, 200, await this.catalog());
        return;
      }
      if (request.method === "POST" && (url.pathname === "/v1/backups" || url.pathname === "/v1/restores")) {
        const key = String(request.headers["idempotency-key"] ?? "");
        if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw Object.assign(new Error("invalid_idempotency_key"), { status: 400 });
        const body = await readJson(request);
        if (!body || typeof body !== "object" || !ACTOR_PATTERN.test(body.actor ?? "")) {
          throw Object.assign(new Error("invalid_actor"), { status: 400 });
        }
        let result;
        if (url.pathname === "/v1/backups") {
          if (body.kind !== "manual") throw Object.assign(new Error("invalid_backup_kind"), { status: 400 });
          result = await this.create("manual", body.actor, key);
        } else {
          if (!BACKUP_ID_PATTERN.test(body.backupId ?? "")) throw Object.assign(new Error("invalid_backup_id"), { status: 400 });
          result = await this.restore(body.backupId, body.actor, key);
        }
        jsonResponse(response, result.reused ? 200 : 202, { operation: publicOperation(result.operation) });
        return;
      }
      jsonResponse(response, 404, { error: { code: "not_found" } });
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      jsonResponse(response, status, { error: { code: status === 503 ? "service_unavailable" : String(error.message).slice(0, 80) } });
    }
  }

  async listen({ host = "127.0.0.1", port = 8082 } = {}) {
    if (host !== "127.0.0.1") throw new TypeError("Backup control server must bind to loopback");
    if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError("Invalid backup control port");
    if (this.server) throw new Error("Backup control server is already listening");
    await this.ensureIdempotencyLoaded();
    this.closing = false;
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    return `http://${host}:${address.port}`;
  }

  async close({ drain = true } = {}) {
    this.closing = true;
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
    let closeError = null;
    if (this.server) {
      const server = this.server;
      this.server = null;
      try {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } catch (error) {
        closeError = error;
      }
    }
    if (drain) {
      if (this.pendingOperationTimer && this.pendingOperationStart) {
        clearTimeout(this.pendingOperationTimer);
        const start = this.pendingOperationStart;
        start();
      }
      if (this.operationPromise) await this.operationPromise;
    } else if (this.pendingOperationTimer) {
      // Used only for abrupt/undrained shutdown semantics. The durable
      // registration is intentionally left without a terminal record so a
      // restarted control fails closed instead of guessing whether it ran.
      clearTimeout(this.pendingOperationTimer);
      this.pendingOperationTimer = null;
      this.pendingOperationStart = null;
    }
    if (closeError) throw closeError;
  }
}

export function createProductionBackupControl(options) {
  return new ProductionBackupControl(options);
}
