import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ProductionBackupControl } from "../production/backup-control.mjs";
import { ProductionBackupManager } from "../production/backup-manager.mjs";

const TOKEN = "integration-control-token-longer-than-32-characters";

function openDatabase(databasePath, callback, readOnly = false) {
  const database = new DatabaseSync(databasePath, { readOnly });
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

async function createIntegrationFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "arthello-backup-integration-"));
  const dataRoot = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  const tempRoot = path.join(root, "temporary");
  const databasePath = path.join(dataRoot, "arthello.sqlite");
  await Promise.all([mkdir(dataRoot), mkdir(backupRoot), mkdir(tempRoot)]);
  openDatabase(databasePath, (database) => database.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE system_runtime_state (state_key TEXT PRIMARY KEY, state_value TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE organization_branches (id TEXT PRIMARY KEY);
    CREATE TABLE app_users (id TEXT PRIMARY KEY, contact TEXT, display_name TEXT, role TEXT, status TEXT, is_administrative INTEGER, access_version INTEGER);
    CREATE TABLE app_systems (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE user_system_access (user_id TEXT, system_id TEXT, role TEXT, status TEXT, access_version INTEGER, PRIMARY KEY(user_id,system_id));
    CREATE TABLE user_branch_access (user_id TEXT, branch_id TEXT);
    CREATE TABLE entities (id TEXT PRIMARY KEY);
    CREATE TABLE hr_employees (id TEXT PRIMARY KEY);
    CREATE TABLE hr_accesses (employee_id TEXT);
    CREATE TABLE production_auth_credentials (
      user_id TEXT PRIMARY KEY, login TEXT UNIQUE, display_name TEXT, role TEXT,
      password_salt TEXT, password_hash TEXT, must_change_password INTEGER,
      temporary_password_expires_at INTEGER, failed_attempts INTEGER,
      locked_until INTEGER, updated_at INTEGER
    );
    CREATE TABLE production_auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT, csrf_token TEXT,
      expires_at INTEGER, access_version INTEGER, created_at INTEGER
    );
    CREATE TABLE business_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO system_runtime_state VALUES ('core_schema','integration-v1',CURRENT_TIMESTAMP);
    INSERT INTO organization_branches VALUES ('BRANCH-1');
    INSERT INTO app_users VALUES ('USR-OWNER','owner','Owner','Собственник','Активен',1,1);
    INSERT INTO app_systems VALUES ('SYS-ARTHELLO-OS','Активна');
    INSERT INTO user_system_access VALUES ('USR-OWNER','SYS-ARTHELLO-OS','Собственник','Активен',1);
    INSERT INTO production_auth_credentials VALUES ('AUTH-OWNER','owner','Owner','owner','salt','owner-hash',0,0,0,0,1);
    INSERT INTO production_auth_credentials VALUES ('EMP-OLD','former','Former','viewer','salt','old-hash',0,0,0,0,1);
    INSERT INTO production_auth_sessions VALUES ('snapshot-session','EMP-OLD','csrf',999999,1,1);
    INSERT INTO business_records VALUES (1,'selected-state');
  `));

  let applicationStopped = false;
  const manager = new ProductionBackupManager({
    dataRoot,
    backupRoot,
    tempRoot,
    databaseFixturePath: databasePath,
    encryptionKey: randomBytes(32),
    encryptionKeyId: "integration-key-v1",
    applicationRevision: "integration-release",
    isApplicationStopped: () => applicationStopped,
  });
  return {
    backupRoot,
    databasePath,
    manager,
    root,
    setApplicationStopped(value) { applicationStopped = value; },
  };
}

async function waitForStatus(url, status) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${url}/v1/backups`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const catalog = await response.json();
    if (catalog.activeOperation?.status === status) return catalog;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Control operation did not reach ${status}`);
}

test("real encrypted manager and control complete a listed manual restore end to end", async () => {
  const fixture = await createIntegrationFixture();
  let control;
  try {
    const selected = await fixture.manager.create("manual");
    openDatabase(fixture.databasePath, (database) => {
      database.prepare("UPDATE business_records SET value='newer-live-state' WHERE id=1").run();
      database.prepare("UPDATE production_auth_credentials SET password_hash='current-owner-hash' WHERE user_id='AUTH-OWNER'").run();
      database.prepare("INSERT INTO production_auth_sessions VALUES ('live-session','AUTH-OWNER','csrf',999999,1,2)").run();
    });

    control = new ProductionBackupControl({
      manager: fixture.manager,
      token: TOKEN,
      backupRoot: fixture.backupRoot,
      operationStartDelayMs: 0,
      now: () => new Date("2026-08-26T01:00:00.000Z"),
      async stopApplication() { fixture.setApplicationStopped(true); },
      async startApplication() { fixture.setApplicationStopped(false); },
    });
    const url = await control.listen({ port: 0 });
    const before = await fetch(`${url}/v1/backups`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((response) => response.json());
    const point = before.points.find((item) => item.id === selected.id);
    assert.equal(point.integrity, "verified");
    assert.equal(point.compatible, true);
    assert.equal(point.kind, "manual");

    const accepted = await fetch(`${url}/v1/restores`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "integration-restore-key",
      },
      body: JSON.stringify({ backupId: selected.id, actor: "USR-OWNER" }),
    });
    assert.equal(accepted.status, 202);
    const after = await waitForStatus(url, "succeeded");
    assert.equal(after.activeOperation.backupId, selected.id);

    openDatabase(fixture.databasePath, (database) => {
      assert.equal(database.prepare("SELECT value FROM business_records WHERE id=1").get().value, "selected-state");
      assert.equal(database.prepare("SELECT password_hash FROM production_auth_credentials WHERE user_id='AUTH-OWNER'").get().password_hash, "current-owner-hash");
      assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM production_auth_credentials WHERE user_id<>'AUTH-OWNER'").get().count), 0);
      assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM production_auth_sessions").get().count), 0);
    }, true);
  } finally {
    await control?.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
