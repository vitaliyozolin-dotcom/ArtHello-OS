import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BACKUP_POLICY,
  DEPLOY_GATE_RECONCILE_AFTER_MS,
  ProductionBackupControl,
} from "../production/backup-control.mjs";

const TOKEN = "control-token-that-is-longer-than-32-characters";

function backup(overrides = {}) {
  return {
    id: "automatic-20260826",
    kind: "automatic",
    createdAt: "2026-08-26T00:05:00.000Z",
    sizeBytes: 4096,
    verified: true,
    compatible: true,
    applicationRevision: "abc123",
    coreSchemaVersion: "52",
    ...overrides,
  };
}

async function fixture({ points = [backup()], now = new Date("2026-08-26T01:00:00.000Z") } = {}) {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-test-"));
  const calls = [];
  const manager = {
    async list() { return points; },
    async create(kind) {
      calls.push(["create", kind]);
      const created = backup({ id: `${kind}-created`, kind, createdAt: now.toISOString() });
      points.push(created);
      return created;
    },
    async restore(id) {
      calls.push(["restore", id]);
      return { backupId: id, safetyBackupId: "pre_restore-safety", restoredAt: now.toISOString() };
    },
    async restoreSafetyBackup(id) {
      calls.push(["restore-safety", id]);
      return { backupId: id, safetyBackupId: null, restoredAt: now.toISOString() };
    },
    async startupPreflight() {
      calls.push(["preflight"]);
      return { status: "ready" };
    },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    now: () => new Date(now),
    operationStartDelayMs: 0,
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() { calls.push(["application", "start"]); },
  });
  const url = await control.listen({ port: 0 });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  return {
    backupRoot,
    calls,
    control,
    headers,
    manager,
    points,
    url,
    async cleanup() {
      await control.close();
      await rm(backupRoot, { recursive: true, force: true });
    },
  };
}

async function waitForOperation(url, headers, expectedStatus = "succeeded") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${url}/v1/backups`, { headers });
    const payload = await response.json();
    if (payload.activeOperation?.status === expectedStatus) return payload.activeOperation;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Operation did not reach ${expectedStatus}`);
}

test("control token and listener are fail-closed", async () => {
  assert.throws(() => new ProductionBackupControl({
    manager: { create() {}, list() {}, restore() {}, restoreSafetyBackup() {} },
    token: TOKEN,
    backupRoot: "/tmp/backups",
    stopApplication() {},
    startApplication() {},
  }), /production backup manager/);

  assert.throws(() => new ProductionBackupControl({
    manager: { create() {}, list() {}, restore() {}, restoreSafetyBackup() {}, startupPreflight() {} },
    token: "short",
    backupRoot: "/tmp/backups",
    stopApplication() {},
    startApplication() {},
  }), /32-2048/);

  const context = await fixture();
  try {
    const missing = await fetch(`${context.url}/v1/backups`);
    assert.equal(missing.status, 401);
    const forged = await fetch(`${context.url}/v1/backups`, { headers: { authorization: `Bearer ${TOKEN}x` } });
    assert.equal(forged.status, 401);
    await assert.rejects(context.control.listen({ host: "0.0.0.0", port: 0 }), /loopback/);
  } finally {
    await context.cleanup();
  }
});

test("catalog exposes the canonical sanitized policy and storage state", async () => {
  const context = await fixture();
  try {
    const response = await fetch(`${context.url}/v1/backups`, { headers: context.headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const payload = await response.json();
    assert.deepEqual(payload.policy, BACKUP_POLICY);
    assert.equal(payload.health.lastAutomaticAt, "2026-08-26T00:05:00.000Z");
    assert.equal(payload.health.storage.local, "ready");
    assert.equal(payload.health.storage.offsite, "not_configured");
    assert.equal(payload.health.status, "degraded");
    assert.equal(payload.points[0].integrity, "verified");
    assert.equal(payload.points[0].expiresAt, "2026-09-25T00:05:00.000Z");
    assert.equal("sha256" in payload.points[0], false);
  } finally {
    await context.cleanup();
  }
});

test("authenticated status is constant-time and never reads the backup catalog", async () => {
  const context = await fixture();
  let listCalls = 0;
  context.manager.list = async () => {
    listCalls += 1;
    return new Promise(() => {});
  };
  try {
    const response = await fetch(`${context.url}/v1/status`, { headers: context.headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { closing: false, activeOperation: null, mutationState: "ready" });
    assert.equal(listCalls, 0);

    const unauthenticated = await fetch(`${context.url}/v1/status`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(listCalls, 0);
  } finally {
    await context.cleanup();
  }
});

test("manual backup is asynchronous, idempotent, and externally audited", async () => {
  const context = await fixture();
  try {
    const body = JSON.stringify({ kind: "manual", actor: "USR-OWNER" });
    const headers = { ...context.headers, "idempotency-key": "manual-test-key" };
    const accepted = await fetch(`${context.url}/v1/backups`, { method: "POST", headers, body });
    assert.equal(accepted.status, 202);
    const first = await accepted.json();
    assert.equal(first.operation.status, "queued");

    const operation = await waitForOperation(context.url, context.headers);
    assert.equal(operation.id, first.operation.id);
    assert.deepEqual(context.calls, [["create", "manual"]]);

    const duplicate = await fetch(`${context.url}/v1/backups`, { method: "POST", headers, body });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).operation.id, first.operation.id);
    assert.deepEqual(context.calls, [["create", "manual"]]);

    const conflicting = await fetch(`${context.url}/v1/restores`, {
      method: "POST",
      headers,
      body: JSON.stringify({ backupId: "automatic-20260826", actor: "USR-OWNER" }),
    });
    assert.equal(conflicting.status, 409);

    const audit = await readFile(path.join(context.backupRoot, "control-operations.ndjson"), "utf8");
    assert.match(audit, /"actor":"USR-OWNER"/);
    assert.match(audit, /"status":"succeeded"/);
    assert.doesNotMatch(audit, /sha256|password|encryption/i);
  } finally {
    await context.cleanup();
  }
});

test("durable terminal idempotency replays across restart and rejects a conflicting fingerprint", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-idempotency-terminal-"));
  const firstCalls = [];
  const manager = (calls) => ({
    async list() { return []; },
    async create(kind) {
      calls.push(["create", kind]);
      return { backupId: "arthello-manual-terminal", commitStatus: "committed", auditStatus: "recorded" };
    },
    async restore(id) { calls.push(["restore", id]); },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() { calls.push(["preflight"]); },
  });
  const controlOptions = (backupManager) => ({
    manager: backupManager,
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    now: () => new Date("2026-08-26T01:00:00.000Z"),
    async stopApplication() {},
    async startApplication() {},
  });
  const first = new ProductionBackupControl(controlOptions(manager(firstCalls)));
  const firstUrl = await first.listen({ port: 0 });
  const key = "durable-terminal-key-never-persist-raw";
  const headers = {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "idempotency-key": key,
  };
  try {
    const accepted = await fetch(`${firstUrl}/v1/backups`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    const acceptedOperation = (await accepted.json()).operation;
    await waitForOperation(firstUrl, { authorization: `Bearer ${TOKEN}` }, "succeeded");
    await first.close({ drain: true });
    assert.deepEqual(firstCalls, [["create", "manual"]]);

    const secondCalls = [];
    const second = new ProductionBackupControl(controlOptions(manager(secondCalls)));
    const secondUrl = await second.listen({ port: 0 });
    try {
      const replay = await fetch(`${secondUrl}/v1/backups`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
      });
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).operation.id, acceptedOperation.id);
      const conflict = await fetch(`${secondUrl}/v1/restores`, {
        method: "POST",
        headers,
        body: JSON.stringify({ backupId: "arthello-manual-terminal", actor: "USR-OWNER" }),
      });
      assert.equal(conflict.status, 409);
      assert.deepEqual(secondCalls, []);
    } finally {
      await second.close();
    }

    const journal = await readFile(path.join(backupRoot, "control-idempotency.ndjson"), "utf8");
    assert.match(journal, /"event":"registered"/);
    assert.match(journal, /"event":"terminal"/);
    assert.match(journal, /"keyHash":"[0-9a-f]{64}"/);
    assert.match(journal, /"fingerprintHash":"[0-9a-f]{64}"/);
    assert.doesNotMatch(journal, new RegExp(key));
    assert.doesNotMatch(journal, /USR-OWNER|password/i);
  } finally {
    await first.close().catch(() => {});
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("registered restore without terminal outcome blocks every mutation after restart", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-idempotency-uncertain-"));
  const firstCalls = [];
  const makeManager = (calls) => ({
    async list() { return [backup({ id: "manual-ambiguous", kind: "manual" })]; },
    async create(kind) { calls.push(["create", kind]); },
    async restore(id) { calls.push(["restore", id]); },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() { calls.push(["preflight"]); },
  });
  const makeControl = (calls, delay) => new ProductionBackupControl({
    manager: makeManager(calls),
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: delay,
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() { calls.push(["application", "start"]); },
  });
  const first = makeControl(firstCalls, 60_000);
  const firstUrl = await first.listen({ port: 0 });
  const ambiguousKey = "ambiguous-restore-key-never-persist-raw";
  const request = (url, key, endpoint = "/v1/restores") => fetch(`${url}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: endpoint === "/v1/restores"
      ? JSON.stringify({ backupId: "manual-ambiguous", actor: "USR-OWNER" })
      : JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
  });
  try {
    assert.equal((await request(firstUrl, ambiguousKey)).status, 202);
    await first.close({ drain: false });
    assert.deepEqual(firstCalls, []);

    const secondCalls = [];
    const second = makeControl(secondCalls, 0);
    const secondUrl = await second.listen({ port: 0 });
    try {
      const status = await fetch(`${secondUrl}/v1/status`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(status.status, 200);
      assert.equal((await status.json()).mutationState, "blocked");
      const sameKey = await request(secondUrl, ambiguousKey);
      assert.equal(sameKey.status, 409);
      assert.equal((await sameKey.json()).error.code, "idempotency_outcome_uncertain");
      const newKey = await request(secondUrl, "brand-new-key-must-also-block", "/v1/backups");
      assert.equal(newKey.status, 409);
      assert.equal((await newKey.json()).error.code, "idempotency_outcome_uncertain");
      assert.deepEqual(secondCalls, []);
    } finally {
      await second.close();
    }

    const journal = await readFile(path.join(backupRoot, "control-idempotency.ndjson"), "utf8");
    assert.match(journal, /"event":"registered"/);
    assert.doesNotMatch(journal, /"event":"terminal"/);
    assert.doesNotMatch(journal, new RegExp(ambiguousKey));
    assert.doesNotMatch(journal, /USR-OWNER|password/i);
  } finally {
    await first.close({ drain: false }).catch(() => {});
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("registration directory-sync ambiguity refuses 202 and poisons same-process and restart retries", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-idempotency-register-sync-"));
  const calls = [];
  let inject = true;
  const makeManager = () => ({
    async list() { return []; },
    async create(kind) { calls.push(["create", kind]); },
    async restore(id) { calls.push(["restore", id]); },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() { calls.push(["preflight"]); },
  });
  const makeControl = (hooks = {}) => new ProductionBackupControl({
    manager: makeManager(),
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    hooks,
    async stopApplication() {},
    async startApplication() {},
  });
  const first = makeControl({
    beforeIdempotencyRegistrationDirectorySync() {
      if (!inject) return;
      inject = false;
      throw new Error("synthetic-registration-directory-sync-failure");
    },
  });
  const firstUrl = await first.listen({ port: 0 });
  const key = "registration-sync-ambiguous-key";
  const request = (url, requestKey) => fetch(`${url}/v1/backups`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": requestKey,
    },
    body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
  });
  try {
    assert.equal((await request(firstUrl, key)).status, 503);
    const sameProcessRetry = await request(firstUrl, key);
    assert.equal(sameProcessRetry.status, 409);
    assert.equal((await sameProcessRetry.json()).error.code, "idempotency_outcome_uncertain");
    assert.deepEqual(calls, []);
    await first.close({ drain: false });

    const restarted = makeControl();
    const restartedUrl = await restarted.listen({ port: 0 });
    try {
      const afterRestart = await request(restartedUrl, key);
      assert.equal(afterRestart.status, 409);
      assert.equal((await afterRestart.json()).error.code, "idempotency_outcome_uncertain");
      assert.deepEqual(calls, []);
    } finally {
      await restarted.close();
    }
  } finally {
    await first.close({ drain: false }).catch(() => {});
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("terminal journal failure keeps committed success in memory and uncertain after restart", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-idempotency-terminal-sync-"));
  const calls = [];
  let inject = true;
  const manager = {
    async list() { return []; },
    async create(kind) {
      calls.push(["create", kind]);
      return { backupId: "arthello-manual-committed", commitStatus: "committed", auditStatus: "recorded" };
    },
    async restore(id) { calls.push(["restore", id]); },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const options = (hooks = {}) => ({
    manager,
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    hooks,
    async stopApplication() {},
    async startApplication() {},
  });
  const first = new ProductionBackupControl(options({
    beforeIdempotencyTerminalAppend() {
      if (!inject) return;
      inject = false;
      throw new Error("synthetic-terminal-append-failure");
    },
  }));
  const firstUrl = await first.listen({ port: 0 });
  const key = "terminal-sync-ambiguous-key";
  const headers = {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "idempotency-key": key,
  };
  try {
    const accepted = await fetch(`${firstUrl}/v1/backups`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    await waitForOperation(firstUrl, { authorization: `Bearer ${TOKEN}` }, "succeeded");
    await first.close({ drain: true });
    assert.equal(first.activeOperation.status, "succeeded");
    assert.equal(first.activeOperation.auditStatus, "degraded");
    assert.deepEqual(calls, [["create", "manual"]]);

    const restarted = new ProductionBackupControl(options());
    const restartedUrl = await restarted.listen({ port: 0 });
    try {
      const retry = await fetch(`${restartedUrl}/v1/backups`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
      });
      assert.equal(retry.status, 409);
      assert.equal((await retry.json()).error.code, "idempotency_outcome_uncertain");
      assert.deepEqual(calls, [["create", "manual"]]);
    } finally {
      await restarted.close();
    }
  } finally {
    await first.close().catch(() => {});
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("a second mutation is refused while the first terminal outcome is being fsynced", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-idempotency-finalizing-"));
  const calls = [];
  let releaseTerminal;
  let terminalReached;
  const terminalGate = new Promise((resolve) => { releaseTerminal = resolve; });
  const reached = new Promise((resolve) => { terminalReached = resolve; });
  const manager = {
    async list() { return []; },
    async create(kind) {
      calls.push(["create", kind]);
      return { backupId: "arthello-manual-finalizing", commitStatus: "committed", auditStatus: "recorded" };
    },
    async restore(id) { calls.push(["restore", id]); },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    hooks: {
      async beforeIdempotencyTerminalAppend() {
        terminalReached();
        await terminalGate;
      },
    },
    async stopApplication() {},
    async startApplication() {},
  });
  const url = await control.listen({ port: 0 });
  const request = (key) => fetch(`${url}/v1/backups`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
  });
  try {
    assert.equal((await request("finalizing-first-key")).status, 202);
    await reached;
    const statusWhileFinalizing = await fetch(`${url}/v1/status`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(statusWhileFinalizing.status, 200);
    assert.equal((await statusWhileFinalizing.json()).mutationState, "blocked");
    const overlapping = await request("finalizing-second-key");
    assert.equal(overlapping.status, 409);
    assert.equal((await overlapping.json()).error.code, "operation_in_progress");
    assert.deepEqual(calls, [["create", "manual"]]);
    releaseTerminal();
    await control.operationPromise;
    const statusAfterFinalizing = await fetch(`${url}/v1/status`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(statusAfterFinalizing.status, 200);
    assert.equal((await statusAfterFinalizing.json()).mutationState, "ready");
    await control.close({ drain: true });
  } finally {
    releaseTerminal();
    await control.close().catch(() => {});
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("a terminal control-audit outage cannot misreport a committed backup as failed", async () => {
  const context = await fixture();
  const originalAudit = context.control.audit.bind(context.control);
  context.control.audit = async (operation, status, extra) => {
    if (status === "succeeded") throw new Error("terminal-audit-failed");
    return originalAudit(operation, status, extra);
  };
  try {
    const accepted = await fetch(`${context.url}/v1/backups`, {
      method: "POST",
      headers: { ...context.headers, "idempotency-key": "audit-degraded-key" },
      body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    const operation = await waitForOperation(context.url, context.headers);
    assert.equal(operation.status, "succeeded");
    assert.equal(context.control.activeOperation.auditStatus, "degraded");
    assert.equal(context.control.lastError, "audit_write_failed");
    assert.deepEqual(context.calls, [["create", "manual"]]);
  } finally {
    await context.cleanup();
  }
});

test("operation reservation is race-safe and a deploy gate blocks new mutations", async () => {
  const context = await fixture();
  try {
    const request = (key) => fetch(`${context.url}/v1/backups`, {
      method: "POST",
      headers: { ...context.headers, "idempotency-key": key },
      body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
    });
    const [first, second] = await Promise.all([request("race-key-one"), request("race-key-two")]);
    assert.deepEqual([first.status, second.status].sort(), [202, 409]);
    await waitForOperation(context.url, context.headers);
    assert.deepEqual(context.calls, [["create", "manual"]]);

    await writeFile(path.join(context.backupRoot, ".deploy-gate"), JSON.stringify({
      format: "arthello-deploy-gate-v1",
      createdAt: "2026-08-26T01:00:00.000Z",
      runId: "test-run-1",
    }), { mode: 0o600 });
    const blocked = await request("deploy-gate-key");
    assert.equal(blocked.status, 409);
    assert.deepEqual(context.calls, [["create", "manual"]]);
  } finally {
    await context.cleanup();
  }
});

test("a stale deploy gate stays fail-closed until an operator reconciles it", async () => {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const context = await fixture({ now });
  try {
    const createdAt = new Date(now.getTime() - DEPLOY_GATE_RECONCILE_AFTER_MS - 1).toISOString();
    await writeFile(path.join(context.backupRoot, ".deploy-gate"), JSON.stringify({
      format: "arthello-deploy-gate-v1",
      createdAt,
      runId: "stale-test-run",
    }), { mode: 0o600 });

    const blocked = await fetch(`${context.url}/v1/backups`, {
      method: "POST",
      headers: { ...context.headers, "idempotency-key": "stale-deploy-gate-key" },
      body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
    });

    assert.equal(blocked.status, 409);
    assert.equal(context.control.lastError, "deploy_gate_stale_requires_reconciliation");
    assert.deepEqual(context.calls, []);
  } finally {
    await context.cleanup();
  }
});

test("graceful close drains an accepted operation before returning", async () => {
  const context = await fixture();
  try {
    const accepted = await fetch(`${context.url}/v1/backups`, {
      method: "POST",
      headers: { ...context.headers, "idempotency-key": "drain-test-key" },
      body: JSON.stringify({ kind: "manual", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    await context.control.close({ drain: true });
    assert.equal(context.control.activeOperation?.status, "succeeded");
    assert.deepEqual(context.calls, [["create", "manual"]]);
  } finally {
    await context.cleanup();
  }
});

test("restore validates the point before stopping the app and restarts after replacement", async () => {
  const context = await fixture({ points: [backup({ id: "manual-safe", kind: "manual" })] });
  try {
    const headers = { ...context.headers, "idempotency-key": "restore-test-key" };
    const accepted = await fetch(`${context.url}/v1/restores`, {
      method: "POST",
      headers,
      body: JSON.stringify({ backupId: "manual-safe", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    await waitForOperation(context.url, context.headers);
    assert.deepEqual(context.calls, [
      ["application", "stop"],
      ["restore", "manual-safe"],
      ["application", "start"],
    ]);
    await context.control.operationPromise;

    const missing = await fetch(`${context.url}/v1/restores`, {
      method: "POST",
      headers: { ...context.headers, "idempotency-key": "restore-missing-key" },
      body: JSON.stringify({ backupId: "missing", actor: "USR-OWNER" }),
    });
    assert.equal(missing.status, 202);
    const failed = await waitForOperation(context.url, context.headers, "failed");
    assert.equal(failed.backupId, "missing");
    assert.deepEqual(context.calls, [
      ["application", "stop"],
      ["restore", "manual-safe"],
      ["application", "start"],
    ]);
  } finally {
    await context.cleanup();
  }
});

test("failed post-restore startup rolls data back to the safety point and brings the app back", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-rollback-test-"));
  const calls = [];
  let startAttempts = 0;
  const manager = {
    async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
    async create() { throw new Error("not-used"); },
    async restore(id) {
      calls.push(["restore", id]);
      assert.equal(id, "manual-target", "ordinary restore must not be reused for safety rollback");
      return { backupId: id, safetyBackupId: "pre_restore-safety" };
    },
    async restoreSafetyBackup(id) {
      calls.push(["restore-safety", id]);
      assert.equal(id, "pre_restore-safety");
      return { backupId: id, safetyBackupId: null, restoreMode: "existing_safety" };
    },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    now: () => new Date("2026-08-26T01:00:00.000Z"),
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() {
      startAttempts += 1;
      calls.push(["application", `start-${startAttempts}`]);
      if (startAttempts === 1) throw new Error("health-check-failed");
    },
  });
  const url = await control.listen({ port: 0 });
  const headers = {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "idempotency-key": "restore-rollback-key",
  };
  try {
    const accepted = await fetch(`${url}/v1/restores`, {
      method: "POST",
      headers,
      body: JSON.stringify({ backupId: "manual-target", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    await waitForOperation(url, { authorization: `Bearer ${TOKEN}` }, "failed");
    assert.deepEqual(calls, [
      ["application", "stop"],
      ["restore", "manual-target"],
      ["application", "start-1"],
      ["restore-safety", "pre_restore-safety"],
      ["preflight"],
      ["application", "start-2"],
    ]);
  } finally {
    await control.close();
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("a stop failure never starts a possible second writer", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-stop-failure-test-"));
  const calls = [];
  const manager = {
    async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
    async create() { throw new Error("not-used"); },
    async restore(id) { calls.push(["restore", id]); },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    now: () => new Date("2026-08-26T01:00:00.000Z"),
    async stopApplication() {
      calls.push(["application", "stop-failed-after-runtime-cleared"]);
      throw new Error("dispose-failed");
    },
    async startApplication() { calls.push(["application", "restart"]); },
  });
  const url = await control.listen({ port: 0 });
  try {
    const accepted = await fetch(`${url}/v1/restores`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "restore-stop-failure-key",
      },
      body: JSON.stringify({ backupId: "manual-target", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    await waitForOperation(url, { authorization: `Bearer ${TOKEN}` }, "failed");
    assert.deepEqual(calls, [["application", "stop-failed-after-runtime-cleared"]]);
  } finally {
    await control.close();
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("failed safety restore followed by a healthy target retry reports committed target success", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-target-retry-test-"));
  const calls = [];
  let startAttempts = 0;
  const manager = {
    async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
    async create() { throw new Error("nested-create-must-not-run"); },
    async restore(id) {
      calls.push(["restore", id]);
      return {
        backupId: id,
        safetyBackupId: "pre_restore-safety",
        commitStatus: "committed",
        auditStatus: "recorded",
      };
    },
    async restoreSafetyBackup(id) {
      calls.push(["restore-safety", id]);
      const error = new Error("synthetic-safety-restore-failure");
      error.code = "RESTORE_FAILED";
      throw error;
    },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    now: () => new Date("2026-08-26T01:00:00.000Z"),
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() {
      startAttempts += 1;
      calls.push(["application", `start-${startAttempts}`]);
      if (startAttempts === 1) throw new Error("target-health-failed-once");
    },
  });
  const url = await control.listen({ port: 0 });
  try {
    const accepted = await fetch(`${url}/v1/restores`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "target-retry-after-safety-failure",
      },
      body: JSON.stringify({ backupId: "manual-target", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    const operation = await waitForOperation(url, { authorization: `Bearer ${TOKEN}` }, "succeeded");
    assert.equal(operation.backupId, "manual-target");
    assert.equal(control.activeOperation.auditStatus, "degraded");
    assert.deepEqual(calls, [
      ["application", "stop"],
      ["restore", "manual-target"],
      ["application", "start-1"],
      ["restore-safety", "pre_restore-safety"],
      ["preflight"],
      ["application", "start-2"],
    ]);
  } finally {
    await control.close();
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("failed safety application start retries the safety DB then reports target restore failed", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-safety-retry-test-"));
  const calls = [];
  let startAttempts = 0;
  const manager = {
    async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
    async create() { throw new Error("nested-create-must-not-run"); },
    async restore(id) {
      calls.push(["restore", id]);
      return { backupId: id, safetyBackupId: "pre_restore-safety", commitStatus: "committed" };
    },
    async restoreSafetyBackup(id) {
      calls.push(["restore-safety", id]);
      return { backupId: id, safetyBackupId: null, commitStatus: "committed" };
    },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    operationStartDelayMs: 0,
    now: () => new Date("2026-08-26T01:00:00.000Z"),
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() {
      startAttempts += 1;
      calls.push(["application", `start-${startAttempts}`]);
      if (startAttempts < 3) throw new Error(`health-failed-${startAttempts}`);
    },
  });
  const url = await control.listen({ port: 0 });
  try {
    const accepted = await fetch(`${url}/v1/restores`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "safety-db-start-retry",
      },
      body: JSON.stringify({ backupId: "manual-target", actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    await waitForOperation(url, { authorization: `Bearer ${TOKEN}` }, "failed");
    assert.deepEqual(calls, [
      ["application", "stop"],
      ["restore", "manual-target"],
      ["application", "start-1"],
      ["restore-safety", "pre_restore-safety"],
      ["preflight"],
      ["application", "start-2"],
      ["preflight"],
      ["application", "start-3"],
    ]);
  } finally {
    await control.close();
    await rm(backupRoot, { recursive: true, force: true });
  }
});

for (const failureCode of ["RESTORE_ROLLBACK_FAILED", "RESTORE_RECOVERY_REQUIRED"]) {
  test(`${failureCode} leaves the application stopped without a recovery start`, async () => {
    const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-fail-closed-test-"));
    const calls = [];
    const manager = {
      async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
      async create() { throw new Error("not-used"); },
      async restore(id) {
        calls.push(["restore", id]);
        const error = new Error(failureCode);
        error.code = failureCode;
        throw error;
      },
      async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
      async startupPreflight() { calls.push(["preflight"]); },
    };
    const control = new ProductionBackupControl({
      manager,
      token: TOKEN,
      backupRoot,
      operationStartDelayMs: 0,
      async stopApplication() { calls.push(["application", "stop"]); },
      async startApplication() { calls.push(["application", "start"]); },
    });
    try {
      await assert.rejects(
        control.performRestore("manual-target"),
        (error) => error?.code === failureCode,
      );
      assert.deepEqual(calls, [
        ["application", "stop"],
        ["restore", "manual-target"],
      ]);
    } finally {
      await rm(backupRoot, { recursive: true, force: true });
    }
  });
}

test("a lifecycle-uncertain target start performs no safety restore, preflight, or second start", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-lifecycle-uncertain-"));
  const calls = [];
  const manager = {
    async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
    async create() { throw new Error("not-used"); },
    async restore(id) {
      calls.push(["restore", id]);
      return { backupId: id, safetyBackupId: "pre_restore-safety", commitStatus: "committed" };
    },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() {
      calls.push(["application", "start-uncertain"]);
      const error = new Error("validation-dispose-uncertain");
      error.code = "APPLICATION_LIFECYCLE_UNCERTAIN";
      throw error;
    },
  });
  try {
    await assert.rejects(
      control.performRestore("manual-target"),
      (error) => error?.code === "APPLICATION_LIFECYCLE_UNCERTAIN",
    );
    assert.deepEqual(calls, [
      ["application", "stop"],
      ["restore", "manual-target"],
      ["application", "start-uncertain"],
    ]);
  } finally {
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("divergence during safety restore keeps the target stopped without recovery preflight", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-safety-divergence-"));
  const calls = [];
  const manager = {
    async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
    async create() { throw new Error("not-used"); },
    async restore(id) {
      calls.push(["restore", id]);
      return { backupId: id, safetyBackupId: "pre_restore-safety", commitStatus: "committed" };
    },
    async restoreSafetyBackup(id) {
      calls.push(["restore-safety", id]);
      const error = new Error("divergent-rollback-archive");
      error.code = "RESTORE_RECOVERY_REQUIRED";
      throw error;
    },
    async startupPreflight() { calls.push(["preflight"]); },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() {
      calls.push(["application", "start-target-failed"]);
      throw new Error("target-health-failed");
    },
  });
  try {
    await assert.rejects(
      control.performRestore("manual-target"),
      (error) => error?.code === "RESTORE_RECOVERY_REQUIRED",
    );
    assert.deepEqual(calls, [
      ["application", "stop"],
      ["restore", "manual-target"],
      ["application", "start-target-failed"],
      ["restore-safety", "pre_restore-safety"],
    ]);
  } finally {
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("recovery preflight divergence blocks restart after an ordinary restore failure", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "arthello-control-preflight-divergence-"));
  const calls = [];
  const manager = {
    async list() { return [backup({ id: "manual-target", kind: "manual" })]; },
    async create() { throw new Error("not-used"); },
    async restore(id) {
      calls.push(["restore", id]);
      const error = new Error("ordinary-restore-failed-after-filesystem-rollback");
      error.code = "RESTORE_FAILED";
      throw error;
    },
    async restoreSafetyBackup(id) { calls.push(["restore-safety", id]); },
    async startupPreflight() {
      calls.push(["preflight"]);
      const error = new Error("divergent-rollback-archive");
      error.code = "RESTORE_RECOVERY_REQUIRED";
      throw error;
    },
  };
  const control = new ProductionBackupControl({
    manager,
    token: TOKEN,
    backupRoot,
    async stopApplication() { calls.push(["application", "stop"]); },
    async startApplication() { calls.push(["application", "start"]); },
  });
  try {
    await assert.rejects(
      control.performRestore("manual-target"),
      (error) => error?.code === "RESTORE_RECOVERY_REQUIRED",
    );
    assert.deepEqual(calls, [
      ["application", "stop"],
      ["restore", "manual-target"],
      ["preflight"],
    ]);
  } finally {
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("first successful daily run of a month also creates the monthly point after downtime", async () => {
  const now = new Date("2026-09-04T00:15:00.000Z");
  const context = await fixture({ points: [], now });
  try {
    assert.equal(await context.control.tickSchedule(), true);
    await waitForOperation(context.url, context.headers);
    assert.deepEqual(context.calls, [["create", "automatic"], ["create", "monthly"]]);
    assert.equal(await context.control.tickSchedule(), false);
  } finally {
    await context.cleanup();
  }
});

test("scheduler retries a missing monthly point after the daily point already succeeded", async () => {
  const now = new Date("2026-09-04T00:15:00.000Z");
  const context = await fixture({
    points: [backup({ id: "automatic-existing", createdAt: now.toISOString() })],
    now,
  });
  let listCalls = 0;
  const originalList = context.manager.list.bind(context.manager);
  context.manager.list = async (...arguments_) => {
    listCalls += 1;
    return originalList(...arguments_);
  };
  try {
    assert.equal(await context.control.tickSchedule(), true);
    await waitForOperation(context.url, context.headers);
    assert.deepEqual(context.calls, [["create", "monthly"]]);
    const callsBeforeSameDayTick = listCalls;
    assert.equal(await context.control.tickSchedule(), false);
    assert.equal(listCalls, callsBeforeSameDayTick);
  } finally {
    await context.cleanup();
  }
});

test("scheduler never treats incompatible daily or monthly points as a recoverable run", async () => {
  const now = new Date("2026-09-04T00:15:00.000Z");
  const context = await fixture({
    points: [
      backup({ id: "automatic-new-schema", createdAt: now.toISOString(), compatible: false }),
      backup({ id: "monthly-new-schema", kind: "monthly", createdAt: now.toISOString(), compatible: false }),
    ],
    now,
  });
  try {
    assert.equal(await context.control.tickSchedule(), true);
    await waitForOperation(context.url, context.headers);
    assert.deepEqual(context.calls, [["create", "automatic"], ["create", "monthly"]]);
  } finally {
    await context.cleanup();
  }
});

test("runtime reconciles first and validates restored D1 on loopback before public admission", async () => {
  const [runtimeSource, readinessSource, proxySource] = await Promise.all([
    readFile(new URL("../production/runtime-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/ready/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  ]);

  const preflight = runtimeSource.indexOf("await manager.startupPreflight()");
  const initialStart = runtimeSource.indexOf("await startApplication()", preflight);
  assert.ok(preflight >= 0 && initialStart > preflight, "startup preflight must precede application admission");
  assert.match(runtimeSource, /host: "127\.0\.0\.1", listenerPort: 0/);
  assert.match(runtimeSource, /await waitForApplicationHealth\(validationUrl\)/);
  const publicBind = runtimeSource.indexOf("publicRuntime = new Miniflare");
  const healthFunction = runtimeSource.indexOf("async function waitForApplicationHealth");
  assert.ok(publicBind > runtimeSource.indexOf("await validation.dispose()"));
  assert.doesNotMatch(runtimeSource.slice(publicBind, healthFunction), /waitForApplicationHealth/);
  assert.match(runtimeSource, /if \(readinessResponse\.ok[^]*"status":"ok"[^]*\) return/);
  const readinessLoop = runtimeSource.slice(
    runtimeSource.indexOf("async function waitForApplicationHealth"),
    runtimeSource.indexOf("async function stopApplication"),
  );
  assert.doesNotMatch(readinessLoop, /\bcontinue\b/);
  assert.match(readinessLoop, /await wait\(500\)/);
  assert.match(runtimeSource, /let validationRuntime = null/);
  assert.match(runtimeSource, /let applicationLifecycleState = "stopped"/);
  assert.match(runtimeSource, /APPLICATION_LIFECYCLE_UNCERTAIN/);
  assert.match(runtimeSource, /isApplicationStopped: \(\) => applicationLifecycleState === "stopped"/);
  assert.doesNotMatch(runtimeSource, /validation\.dispose\(\)\.catch/);
  const stopLifecycle = runtimeSource.slice(
    runtimeSource.indexOf("async function stopApplication"),
    runtimeSource.indexOf("const manager = createProductionBackupManager"),
  );
  assert.ok(
    stopLifecycle.indexOf("await active.dispose()") < stopLifecycle.indexOf("runtime = null"),
    "runtime reference must remain authoritative until dispose succeeds",
  );

  assert.match(readinessSource, /FROM system_runtime_state/);
  assert.match(readinessSource, /state_key='core_schema'/);
  assert.match(readinessSource, /JOIN user_system_access/);
  assert.match(readinessSource, /u\.id='USR-OWNER'/);
  assert.match(readinessSource, /FROM production_auth_credentials/);
  assert.match(readinessSource, /user_id='AUTH-OWNER'/);
  assert.match(readinessSource, /response\("ok", 200\)/);
  assert.match(readinessSource, /response\("not_ready", 503\)/);
  assert.match(proxySource, /"\/api\/health\/ready"/);
});
