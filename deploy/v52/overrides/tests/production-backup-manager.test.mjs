import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  BACKUP_ERROR_CODES,
  BACKUP_KINDS,
  BACKUP_MANIFEST_FORMAT,
  ProductionBackupManager,
} from "../production/backup-manager.mjs";

const CORE_SCHEMA_VERSION = "arthello-core-test-v1";

async function createFixture(t, managerOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "arthello-backup-manager-"));
  const dataRoot = join(root, "data");
  const backupRoot = join(root, "backups");
  const tempRoot = join(root, "tmpfs-work");
  const databasePath = join(dataRoot, "arthello-production.sqlite");
  await mkdir(dataRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await mkdir(tempRoot, { recursive: true });
  t.after(async () => rm(root, { recursive: true, force: true }));

  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE system_runtime_state (
        state_key TEXT PRIMARY KEY NOT NULL,
        state_value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE organization_branches (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE app_users (
        id TEXT PRIMARY KEY NOT NULL,
        contact TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        is_administrative INTEGER NOT NULL,
        access_version INTEGER NOT NULL
      );
      CREATE TABLE app_systems (id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL);
      CREATE TABLE user_system_access (
        user_id TEXT NOT NULL,
        system_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        access_version INTEGER NOT NULL,
        PRIMARY KEY (user_id, system_id)
      );
      CREATE TABLE user_branch_access (user_id TEXT NOT NULL, branch_id TEXT NOT NULL);
      CREATE TABLE entities (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE hr_employees (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE hr_accesses (employee_id TEXT NOT NULL);
      CREATE TABLE production_auth_credentials (
        user_id TEXT PRIMARY KEY NOT NULL,
        login TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        temporary_password_expires_at INTEGER NOT NULL DEFAULT 0,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE production_auth_sessions (
        token_hash TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        access_version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE business_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);

      INSERT INTO system_runtime_state (state_key,state_value)
        VALUES ('core_schema','${CORE_SCHEMA_VERSION}');
      INSERT INTO organization_branches (id) VALUES ('BRANCH-1');
      INSERT INTO app_users
        (id,contact,display_name,role,status,is_administrative,access_version)
        VALUES ('USR-OWNER','owner-contact','Owner','Собственник','Активен',1,7);
      INSERT INTO app_systems (id,status) VALUES ('SYS-ARTHELLO-OS','Активна');
      INSERT INTO user_system_access
        (user_id,system_id,role,status,access_version)
        VALUES ('USR-OWNER','SYS-ARTHELLO-OS','Собственник','Активен',7);
      INSERT INTO production_auth_credentials
        (user_id,login,display_name,role,password_salt,password_hash,must_change_password,
          temporary_password_expires_at,failed_attempts,locked_until,updated_at)
        VALUES ('AUTH-OWNER','owner-snapshot','Owner','owner','snapshot-salt','snapshot-hash',0,0,0,0,100);
      INSERT INTO business_records (id,value) VALUES (1,'snapshot-value');
    `);
  } finally {
    db.close();
  }

  const encryptionKey = randomBytes(32);
  let stopped = true;
  const managerOptions = {
    dataRoot,
    backupRoot,
    tempRoot,
    databaseFixturePath: databasePath,
    encryptionKey,
    encryptionKeyId: "test-key-v1",
    applicationRevision: "test-release-v52",
    isApplicationStopped: () => stopped,
    ...managerOverrides,
  };
  return {
    root,
    dataRoot,
    backupRoot,
    tempRoot,
    databasePath,
    encryptionKey,
    managerOptions,
    manager: new ProductionBackupManager(managerOptions),
    setStopped(value) {
      stopped = value;
    },
  };
}

function withDatabase(databasePath, callback, readOnly = false) {
  const db = new DatabaseSync(databasePath, { readOnly });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function businessValue(databasePath) {
  return withDatabase(databasePath, (db) => String(db.prepare("SELECT value FROM business_records WHERE id=1").get().value), true);
}

test("create uses an online encrypted snapshot and list returns only safe verified metadata", async (t) => {
  const fixture = await createFixture(t);
  const created = await fixture.manager.create("manual");

  assert.equal(created.kind, "manual");
  assert.equal(created.verified, true);
  assert.equal(created.compatible, true);
  assert.equal(created.commitStatus, "committed");
  assert.equal(created.auditStatus, "recorded");
  assert.equal(created.coreSchemaVersion, CORE_SCHEMA_VERSION);
  assert.equal(created.applicationRevision, "test-release-v52");

  const encryptedPath = join(fixture.backupRoot, `${created.id}.sqlite.enc`);
  const encryptedHeader = (await readFile(encryptedPath)).subarray(0, 16).toString("utf8");
  assert.notEqual(encryptedHeader, "SQLite format 3\u0000");

  const manifest = JSON.parse(
    await readFile(join(fixture.backupRoot, `${created.id}.manifest.json`), "utf8"),
  );
  assert.equal(manifest.format, BACKUP_MANIFEST_FORMAT);
  assert.equal(manifest.manifestVersion, 2);
  assert.equal(manifest.encryption.algorithm, "aes-256-gcm");
  assert.equal(manifest.encryption.keyId, "test-key-v1");
  assert.match(manifest.encryption.iv, /^[A-Za-z0-9+/]+=*$/u);
  assert.match(manifest.encryption.tag, /^[A-Za-z0-9+/]+=*$/u);
  assert.equal(manifest.coreSchemaVersion, CORE_SCHEMA_VERSION);
  assert.equal(manifest.applicationRevision, "test-release-v52");
  assert.equal(manifest.authentication.algorithm, "hmac-sha256");
  assert.equal(manifest.authentication.keyId, "test-key-v1");
  assert.match(manifest.authentication.value, /^[0-9a-f]{64}$/u);

  const listed = await fixture.manager.list();
  assert.equal(listed.length, 1);
  const { commitStatus: _commitStatus, auditStatus: _auditStatus, ...createdSummary } = created;
  assert.deepEqual(listed[0], createdSummary);
  const serialized = JSON.stringify(listed);
  assert.equal(serialized.includes(fixture.root), false);
  assert.equal(serialized.includes("owner-snapshot"), false);
  assert.equal(serialized.includes("snapshot-hash"), false);

  const names = await readdir(fixture.backupRoot);
  assert.equal(names.some((name) => name.includes("plaintext") || name.endsWith(".tmp")), false);
  assert.deepEqual(await readdir(fixture.tempRoot), []);
  const operations = await fixture.manager.operations();
  assert.equal(operations.some((row) => row.operation === "create" && row.phase === "succeeded"), true);
  assert.equal(JSON.stringify(operations).includes(fixture.root), false);
});

test("corrupted encrypted backup is unverified and restore is rejected without changing production", async (t) => {
  const fixture = await createFixture(t);
  const created = await fixture.manager.create("automatic");
  const encryptedPath = join(fixture.backupRoot, `${created.id}.sqlite.enc`);
  const ciphertext = await readFile(encryptedPath);
  ciphertext[Math.floor(ciphertext.length / 2)] ^= 0xff;
  await writeFile(encryptedPath, ciphertext);

  const listed = await fixture.manager.list();
  const damaged = listed.find((item) => item.id === created.id);
  assert.equal(damaged.verified, false);
  assert.equal(damaged.compatible, false);
  assert.equal(damaged.failureCode, BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH);

  await assert.rejects(
    fixture.manager.restore(created.id),
    (error) => error?.code === BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH,
  );
  assert.equal(businessValue(fixture.databasePath), "snapshot-value");
  const after = await fixture.manager.list();
  assert.equal(after.filter((item) => item.kind === "pre_restore").length, 0);
});

test("restore requires stopped state, creates a safety backup, preserves current owner credential, and revokes sessions", async (t) => {
  const fixture = await createFixture(t);
  withDatabase(fixture.databasePath, (db) => {
    db.prepare(`INSERT INTO production_auth_credentials
      (user_id,login,display_name,role,password_salt,password_hash,must_change_password,
        temporary_password_expires_at,failed_attempts,locked_until,updated_at)
      VALUES ('EMP-REMOVED','former-employee','Former employee','viewer','former-salt','former-hash',0,0,0,0,50)`).run();
  });
  const selected = await fixture.manager.create("manual");

  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE business_records SET value='live-value' WHERE id=1").run();
    db.prepare(`UPDATE production_auth_credentials SET
      login='owner-live',role='owner-live-role',password_salt='live-salt',password_hash='live-hash',
      must_change_password=0,temporary_password_expires_at=0,failed_attempts=2,locked_until=123,updated_at=999
      WHERE user_id='AUTH-OWNER'`).run();
    db.prepare(`INSERT INTO production_auth_sessions
      (token_hash,user_id,csrf_token,expires_at,access_version,created_at)
      VALUES ('old-session','AUTH-OWNER','csrf',999999,7,1)`).run();
    db.prepare("DELETE FROM production_auth_credentials WHERE user_id='EMP-REMOVED'").run();
  });

  fixture.setStopped(false);
  await assert.rejects(
    fixture.manager.restore(selected.id),
    (error) => error?.code === BACKUP_ERROR_CODES.APPLICATION_NOT_STOPPED,
  );
  assert.equal(businessValue(fixture.databasePath), "live-value");

  fixture.setStopped(true);
  const restored = await fixture.manager.restore(selected.id);
  assert.equal(restored.backupId, selected.id);
  assert.match(restored.safetyBackupId, /^arthello-pre_restore-/u);
  assert.equal(restored.verified, true);
  assert.equal(restored.commitStatus, "committed");
  assert.equal(restored.auditStatus, "recorded");
  assert.equal(businessValue(fixture.databasePath), "snapshot-value");

  withDatabase(fixture.databasePath, (db) => {
    const owner = db.prepare(`SELECT login,role,password_salt,password_hash,failed_attempts,locked_until,updated_at
      FROM production_auth_credentials WHERE user_id='AUTH-OWNER'`).get();
    assert.deepEqual({ ...owner }, {
      login: "owner-live",
      role: "owner-live-role",
      password_salt: "live-salt",
      password_hash: "live-hash",
      failed_attempts: 2,
      locked_until: 123,
      updated_at: 999,
    });
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM production_auth_sessions").get().count), 0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM production_auth_credentials").get().count), 1);
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) AS count FROM production_auth_credentials WHERE user_id='EMP-REMOVED'").get().count),
      0,
    );
    const grant = db.prepare(`SELECT u.status AS user_status,u.role AS user_role,u.is_administrative,
      g.status AS grant_status,g.role AS grant_role
      FROM app_users u JOIN user_system_access g
        ON g.user_id=u.id AND g.system_id='SYS-ARTHELLO-OS'
      WHERE u.id='USR-OWNER'`).get();
    assert.equal(grant.user_status, "Активен");
    assert.equal(grant.grant_status, "Активен");
    assert.equal(grant.user_role, "Собственник");
    assert.equal(grant.grant_role, "Собственник");
    assert.equal(Number(grant.is_administrative), 1);
  }, true);

  const backups = await fixture.manager.list();
  const safety = backups.find((item) => item.id === restored.safetyBackupId);
  assert.equal(safety?.kind, "pre_restore");
  assert.equal(safety?.verified, true);

  await assert.rejects(
    fixture.manager.restoreSafetyBackup(selected.id),
    (error) => error?.code === BACKUP_ERROR_CODES.INVALID_SAFETY_BACKUP,
  );

  // Simulate a failed application start that partially changed both data and
  // the live core marker. The already-created safety point must still roll the
  // database back without attempting a nested pre_restore backup.
  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE business_records SET value='failed-start-value' WHERE id=1").run();
    db.prepare("UPDATE system_runtime_state SET state_value='failed-start-partial-v2' WHERE state_key='core_schema'").run();
  });
  const preRestoreCount = backups.filter((item) => item.kind === "pre_restore").length;
  const safetyRestored = await fixture.manager.restoreSafetyBackup(restored.safetyBackupId);
  assert.equal(safetyRestored.backupId, restored.safetyBackupId);
  assert.equal(safetyRestored.safetyBackupId, null);
  assert.equal(safetyRestored.restoreMode, "existing_safety");
  assert.equal(safetyRestored.commitStatus, "committed");
  assert.equal(businessValue(fixture.databasePath), "live-value");
  assert.equal(
    (await fixture.manager.list()).filter((item) => item.kind === "pre_restore").length,
    preRestoreCount,
  );
  const operations = await fixture.manager.operations({ limit: 500 });
  assert.equal(
    operations.some((row) => row.operation === "restore" && row.phase === "succeeded" && row.backupId === selected.id),
    true,
  );
  assert.equal(
    operations.some(
      (row) => row.operation === "safety_restore"
        && row.phase === "succeeded"
        && row.backupId === restored.safetyBackupId,
    ),
    true,
  );
});

test("post-replace failure automatically rolls the original SQLite files back", async (t) => {
  const fixture = await createFixture(t);
  const selected = await fixture.manager.create("manual");
  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE business_records SET value='must-survive' WHERE id=1").run();
    db.prepare("UPDATE production_auth_credentials SET password_hash='must-survive-hash' WHERE user_id='AUTH-OWNER'").run();
  });

  const failingManager = new ProductionBackupManager({
    ...fixture.managerOptions,
    hooks: {
      afterAtomicReplace() {
        throw new Error("synthetic post-replace failure");
      },
    },
  });
  await assert.rejects(
    failingManager.restore(selected.id),
    (error) => error?.code === BACKUP_ERROR_CODES.RESTORE_FAILED,
  );
  assert.equal(businessValue(fixture.databasePath), "must-survive");
  withDatabase(fixture.databasePath, (db) => {
    assert.equal(
      db.prepare("SELECT password_hash FROM production_auth_credentials WHERE user_id='AUTH-OWNER'").get().password_hash,
      "must-survive-hash",
    );
  }, true);
  const backups = await failingManager.list();
  assert.equal(backups.some((item) => item.kind === "pre_restore" && item.verified), true);
  const operations = await failingManager.operations({ limit: 500 });
  assert.equal(
    operations.some((row) => row.operation === "restore" && row.phase === "failed" && row.filesystemRollback === "succeeded"),
    true,
  );
});

test("failure immediately before atomic rename never removes the live database pathname", async (t) => {
  const fixture = await createFixture(t);
  const selected = await fixture.manager.create("manual");
  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE business_records SET value='live-before-rename' WHERE id=1").run();
  });

  let observedLivePath = false;
  const failingManager = new ProductionBackupManager({
    ...fixture.managerOptions,
    hooks: {
      async beforeAtomicRename() {
        const header = (await readFile(fixture.databasePath)).subarray(0, 16).toString("utf8");
        observedLivePath = header === "SQLite format 3\u0000";
        throw new Error("synthetic pre-rename crash boundary");
      },
    },
  });
  await assert.rejects(
    failingManager.restore(selected.id),
    (error) => error?.code === BACKUP_ERROR_CODES.RESTORE_FAILED,
  );
  assert.equal(observedLivePath, true);
  assert.equal(businessValue(fixture.databasePath), "live-before-rename");
  assert.equal((await readdir(fixture.dataRoot)).some((name) => name.includes(".rollback-")), false);
});

test("post-commit audit outage reports committed/degraded without false restore or create failure", async (t) => {
  const fixture = await createFixture(t);
  const createWithAuditOutage = new ProductionBackupManager({
    ...fixture.managerOptions,
    hooks: {
      beforeCreateSuccessAudit() {
        throw new Error("synthetic create audit outage");
      },
    },
  });
  const created = await createWithAuditOutage.create("manual");
  assert.equal(created.commitStatus, "committed");
  assert.equal(created.auditStatus, "degraded");
  assert.equal((await fixture.manager.list()).some((item) => item.id === created.id && item.verified), true);

  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE business_records SET value='post-create-live' WHERE id=1").run();
  });
  const restoreWithAuditOutage = new ProductionBackupManager({
    ...fixture.managerOptions,
    hooks: {
      beforeRestoreSuccessAudit() {
        throw new Error("synthetic restore audit outage");
      },
    },
  });
  const restored = await restoreWithAuditOutage.restore(created.id);
  assert.equal(restored.commitStatus, "committed");
  assert.equal(restored.auditStatus, "degraded");
  assert.equal(businessValue(fixture.databasePath), "snapshot-value");
  const operations = await fixture.manager.operations({ limit: 500 });
  assert.equal(
    operations.some((row) => row.operation === "restore" && row.phase === "commit_ready" && row.backupId === created.id),
    true,
  );
  assert.equal(
    operations.some((row) => row.operation === "restore" && row.phase === "failed" && row.backupId === created.id),
    false,
  );
});

test("a directory-sync outage after rollback archive unlink cannot report a committed restore as failed", async (t) => {
  const fixture = await createFixture(t);
  const created = await fixture.manager.create("manual");
  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE business_records SET value='live-before-cleanup-outage' WHERE id=1").run();
  });
  const manager = new ProductionBackupManager({
    ...fixture.managerOptions,
    hooks: {
      afterRollbackArchiveUnlink() {
        throw new Error("synthetic directory fsync outage after unlink");
      },
    },
  });

  const restored = await manager.restore(created.id);
  assert.equal(restored.commitStatus, "committed");
  assert.equal(restored.auditStatus, "degraded");
  assert.equal(businessValue(fixture.databasePath), "snapshot-value");
  assert.equal((await readdir(fixture.dataRoot)).some((name) => name.includes(".rollback-")), false);
  const operations = await fixture.manager.operations({ limit: 500 });
  assert.equal(
    operations.some((row) => row.operation === "restore" && row.phase === "failed" && row.backupId === created.id),
    false,
  );
});

test("a directory-sync outage after owned lock unlink cannot reject committed create or restore", async (t) => {
  const fixture = await createFixture(t);
  const manager = new ProductionBackupManager({
    ...fixture.managerOptions,
    hooks: {
      afterLockUnlink() {
        throw new Error("synthetic lock directory fsync outage");
      },
    },
  });

  const created = await manager.create("manual");
  assert.equal(created.commitStatus, "committed");
  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE business_records SET value='live-before-lock-cleanup-outage' WHERE id=1").run();
  });
  const restored = await manager.restore(created.id);
  assert.equal(restored.commitStatus, "committed");
  assert.equal(businessValue(fixture.databasePath), "snapshot-value");
  const operations = await fixture.manager.operations({ limit: 500 });
  assert.equal(
    operations.some((row) => row.operation === "restore" && row.phase === "failed" && row.backupId === created.id),
    false,
  );
});

test("monthly is a first-class kind and lightweight catalog trusts only authenticated creation metadata", async (t) => {
  const fixture = await createFixture(t);
  assert.equal(BACKUP_KINDS.includes("monthly"), true);
  const monthly = await fixture.manager.create("monthly");

  const lightweight = await fixture.manager.list({ verifyFiles: false });
  const point = lightweight.find((item) => item.id === monthly.id);
  assert.equal(point?.kind, "monthly");
  assert.equal(point?.verified, true);
  assert.equal(point?.compatible, true);
  assert.equal(point?.verification, "ciphertext");
  const fullyVerified = await fixture.manager.verify(monthly.id);
  assert.equal(fullyVerified.id, monthly.id);
  assert.equal(fullyVerified.verification, "full");
  assert.equal(fullyVerified.compatible, true);

  const incompatibleManager = new ProductionBackupManager({
    ...fixture.managerOptions,
    supportedCoreSchemaVersions: ["a-different-core-schema"],
  });
  const incompatible = await incompatibleManager.list({ verifyFiles: false });
  assert.equal(incompatible.find((item) => item.id === monthly.id)?.verified, true);
  assert.equal(incompatible.find((item) => item.id === monthly.id)?.compatible, false);
});

test("pinned supported-core allowlist permits verified rollback after a failed migration changed current core", async (t) => {
  const fixture = await createFixture(t);
  const preDeploy = await fixture.manager.create("pre_deploy");
  withDatabase(fixture.databasePath, (db) => {
    db.prepare("UPDATE system_runtime_state SET state_value='arthello-core-failed-v2' WHERE state_key='core_schema'").run();
    db.prepare("UPDATE business_records SET value='failed-migration-value' WHERE id=1").run();
  });

  const defaultCatalog = await fixture.manager.list({ verifyFiles: false });
  assert.equal(defaultCatalog.find((item) => item.id === preDeploy.id)?.compatible, false);

  const rollbackManager = new ProductionBackupManager({
    ...fixture.managerOptions,
    supportedCoreSchemaVersions: [CORE_SCHEMA_VERSION],
  });
  const rollbackCatalog = await rollbackManager.list({ verifyFiles: false });
  assert.equal(rollbackCatalog.find((item) => item.id === preDeploy.id)?.compatible, true);
  const result = await rollbackManager.restore(preDeploy.id);
  assert.equal(result.coreSchemaVersion, CORE_SCHEMA_VERSION);
  assert.equal(businessValue(fixture.databasePath), "snapshot-value");
  withDatabase(fixture.databasePath, (db) => {
    assert.equal(
      db.prepare("SELECT state_value FROM system_runtime_state WHERE state_key='core_schema'").get().state_value,
      CORE_SCHEMA_VERSION,
    );
  }, true);
});

test("retention is explicit by kind: daily and operational 30 days, monthly 12 months, manual forever", async (t) => {
  let clock = new Date("2026-08-26T12:00:00.000Z");
  const fixture = await createFixture(t, { now: () => new Date(clock) });
  const createAt = async (kind, timestamp) => {
    clock = new Date(timestamp);
    return fixture.manager.create(kind, { skipRetention: true });
  };

  const manualOld = await createAt("manual", "2020-01-01T03:00:00.000Z");
  const monthlyExpired = await createAt("monthly", "2025-08-15T03:00:00.000Z");
  const monthlyRetained = await createAt("monthly", "2025-09-01T03:00:00.000Z");
  const automaticExpired = await createAt("automatic", "2026-07-01T03:00:00.000Z");
  const automaticRetained = await createAt("automatic", "2026-08-10T03:00:00.000Z");
  const preDeployExpired = await createAt("pre_deploy", "2026-07-02T03:00:00.000Z");
  const preRestoreRetained = await createAt("pre_restore", "2026-08-05T03:00:00.000Z");

  clock = new Date("2026-08-26T12:00:00.000Z");
  const retention = await fixture.manager.applyRetention();
  assert.deepEqual(
    [...retention.deletedIds].sort(),
    [monthlyExpired.id, automaticExpired.id, preDeployExpired.id].sort(),
  );
  const remaining = new Set((await fixture.manager.list()).map((item) => item.id));
  for (const retained of [manualOld, monthlyRetained, automaticRetained, preRestoreRetained]) {
    assert.equal(remaining.has(retained.id), true);
  }
  for (const expired of [monthlyExpired, automaticExpired, preDeployExpired]) {
    assert.equal(remaining.has(expired.id), false);
  }
});

test("foreign-key corruption is rejected before an encrypted snapshot is committed", async (t) => {
  const fixture = await createFixture(t);
  withDatabase(fixture.databasePath, (db) => {
    db.exec(`
      PRAGMA foreign_keys=OFF;
      CREATE TABLE fk_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE fk_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES fk_parent(id));
      INSERT INTO fk_child (id,parent_id) VALUES (1,999);
    `);
  });
  await assert.rejects(
    fixture.manager.create("manual"),
    (error) => error?.code === BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED,
  );
  const names = await readdir(fixture.backupRoot);
  assert.equal(names.some((name) => name.endsWith(".sqlite.enc")), false);
});

test("database discovery excludes archive directories and fails closed on two live ArtHello databases", async (t) => {
  const fixture = await createFixture(t);
  const archiveDirectory = join(fixture.dataRoot, "archive");
  await mkdir(archiveDirectory);
  await copyFile(fixture.databasePath, join(archiveDirectory, "historical.sqlite"));
  const archivedCopyIgnored = await fixture.manager.create("manual");
  assert.equal(archivedCopyIgnored.commitStatus, "committed");

  await copyFile(fixture.databasePath, join(fixture.dataRoot, "second-live.sqlite"));
  await assert.rejects(
    fixture.manager.create("manual"),
    (error) => error?.code === BACKUP_ERROR_CODES.DATABASE_AMBIGUOUS,
  );
});

test("startup preflight removes only safe stale restore candidate and duplicate rollback inode before serving", async (t) => {
  const fixture = await createFixture(t);
  const candidateName = ".arthello-production.sqlite.restore-11111111-1111-4111-8111-111111111111.tmp";
  const duplicateArchiveName = ".arthello-production.sqlite.rollback-22222222-2222-4222-8222-222222222222";
  await copyFile(fixture.databasePath, join(fixture.dataRoot, candidateName));
  await link(fixture.databasePath, join(fixture.dataRoot, duplicateArchiveName));

  const preflight = await fixture.manager.startupPreflight();
  assert.equal(preflight.status, "ready");
  assert.equal(preflight.recoveryStatus, "clean");
  assert.equal(preflight.coreSchemaVersion, CORE_SCHEMA_VERSION);
  const dataNames = await readdir(fixture.dataRoot);
  assert.equal(dataNames.includes(candidateName), false);
  assert.equal(dataNames.includes(duplicateArchiveName), false);
  const operations = await fixture.manager.operations({ limit: 500 });
  assert.equal(
    operations.some((row) => row.operation === "restore_reconcile" && row.phase === "safe_cleanup"),
    true,
  );
});

test("startup preflight proves stopped state before touching crash artifacts", async (t) => {
  const fixture = await createFixture(t);
  const candidateName = ".arthello-production.sqlite.restore-44444444-4444-4444-8444-444444444444.tmp";
  await copyFile(fixture.databasePath, join(fixture.dataRoot, candidateName));
  fixture.setStopped(false);

  await assert.rejects(
    fixture.manager.startupPreflight(),
    (error) => error?.code === BACKUP_ERROR_CODES.APPLICATION_NOT_STOPPED,
  );
  assert.equal((await readdir(fixture.dataRoot)).includes(candidateName), true);
});

test("startup preflight retains a divergent crash rollback inode and fails serving closed", async (t) => {
  const fixture = await createFixture(t);
  const archiveName = ".arthello-production.sqlite.rollback-33333333-3333-4333-8333-333333333333";
  const archivePath = join(fixture.dataRoot, archiveName);
  await copyFile(fixture.databasePath, archivePath);
  withDatabase(archivePath, (db) => {
    db.prepare("UPDATE business_records SET value='pre-crash-alternate-state' WHERE id=1").run();
  });

  await assert.rejects(
    fixture.manager.startupPreflight(),
    (error) => error?.code === BACKUP_ERROR_CODES.RESTORE_RECOVERY_REQUIRED,
  );
  assert.equal((await readdir(fixture.dataRoot)).includes(archiveName), true);
  assert.equal(businessValue(fixture.databasePath), "snapshot-value");
  const operations = await fixture.manager.operations({ limit: 500 });
  const recovery = operations.find(
    (row) => row.operation === "restore_reconcile" && row.phase === "operator_action_required",
  );
  assert.equal(recovery?.failureCode, BACKUP_ERROR_CODES.RESTORE_RECOVERY_REQUIRED);
  assert.equal(recovery?.recoveryArchiveCount, 1);
  await assert.rejects(
    fixture.manager.create("manual"),
    (error) => error?.code === BACKUP_ERROR_CODES.RESTORE_RECOVERY_REQUIRED,
  );
});

test("tampered manifest metadata fails HMAC authentication and cannot influence catalog or retention", async (t) => {
  const fixture = await createFixture(t);
  const created = await fixture.manager.create("automatic", { skipRetention: true });
  const manifestPath = join(fixture.backupRoot, `${created.id}.manifest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.createdAt = "2000-01-01T00:00:00.000Z";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.equal((await fixture.manager.list({ verifyFiles: false })).some((item) => item.id === created.id), false);
  assert.deepEqual(await fixture.manager.applyRetention(), { deletedIds: [] });
  await assert.rejects(
    fixture.manager.restore(created.id),
    (error) => error?.code === BACKUP_ERROR_CODES.INVALID_MANIFEST,
  );
  assert.equal((await readdir(fixture.backupRoot)).includes(`${created.id}.sqlite.enc`), true);
});

test("a live cross-process lock refuses overlapping backup mutations", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.backupRoot, ".backup-manager.lock"), `${JSON.stringify({
    format: "arthello-backup-lock-v1",
    token: "owned-by-another-runtime",
    pid: process.pid,
    createdAt: new Date().toISOString(),
    operation: "create:automatic",
  })}\n`);
  await assert.rejects(
    fixture.manager.create("manual"),
    (error) => error?.code === BACKUP_ERROR_CODES.OPERATION_LOCKED,
  );
});

test("an expired foreign-container lease is never stolen while its owner cannot be disproved", async (t) => {
  const fixture = await createFixture(t, {
    lockStaleMs: 1_000,
    lockInstanceId: "current-container-instance",
    lockHostname: "current-container",
  });
  const lockPath = join(fixture.backupRoot, ".backup-manager.lock");
  await writeFile(lockPath, `${JSON.stringify({
    format: "arthello-backup-lock-v1",
    token: "crashed-foreign-helper",
    pid: process.pid,
    processStartTime: "1",
    instanceId: "foreign-container-instance",
    hostname: "foreign-container",
    createdAt: "2026-01-01T00:00:00.000Z",
    operation: "create:pre_deploy",
  })}\n`);
  const expired = new Date(Date.now() - 5_000);
  await utimes(lockPath, expired, expired);

  await assert.rejects(
    fixture.manager.create("manual"),
    (error) => error?.code === BACKUP_ERROR_CODES.OPERATION_LOCKED,
  );
  assert.equal((await readdir(fixture.backupRoot)).includes(".backup-manager.lock"), true);
});

test("a lock owned by a provably dead process on the same container is reclaimed", async (t) => {
  const fixture = await createFixture(t, {
    lockStaleMs: 60 * 60 * 1000,
    lockInstanceId: "new-process-instance",
    lockHostname: "stable-container-name",
  });
  const lockPath = join(fixture.backupRoot, ".backup-manager.lock");
  await writeFile(lockPath, `${JSON.stringify({
    format: "arthello-backup-lock-v1",
    token: "dead-process-lock",
    pid: 2_147_483_647,
    processStartTime: "123456",
    instanceId: "old-process-instance",
    hostname: "stable-container-name",
    createdAt: new Date().toISOString(),
    operation: "create:automatic",
  })}\n`);

  const created = await fixture.manager.create("manual");
  assert.equal(created.commitStatus, "committed");
  assert.equal((await readdir(fixture.backupRoot)).includes(".backup-manager.lock"), false);
});

for (const failurePoint of ["beforeLockReleaseRead", "beforeLockReleaseUnlink"]) {
  test(`a post-commit ${failurePoint} outage returns committed/degraded and quarantines mutations`, async (t) => {
    let inject = true;
    const fixture = await createFixture(t, {
      hooks: {
        [failurePoint]() {
          if (!inject) return;
          inject = false;
          throw new Error(`synthetic-${failurePoint}`);
        },
      },
    });

    const created = await fixture.manager.create("manual");
    assert.equal(created.commitStatus, "committed");
    assert.equal(created.auditStatus, "degraded");
    assert.equal(created.lockStatus, "degraded");
    assert.equal(created.recoveryStatus, "operator_action_required");
    assert.equal(
      (await fixture.manager.list()).some((item) => item.id === created.id && item.verified),
      true,
    );
    assert.equal((await readdir(fixture.backupRoot)).includes(".backup-manager.quarantine"), true);
    await assert.rejects(
      fixture.manager.create("manual"),
      (error) => error?.code === BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
    );
    const operations = await fixture.manager.operations({ limit: 500 });
    assert.equal(
      operations.some(
        (row) => row.operation === "lock_reconcile"
          && row.phase === "operator_action_required"
          && row.failureCode === BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
      ),
      true,
    );
  });
}

test("a quarantine-write outage after post-commit lock failure still returns committed and fails closed", async (t) => {
  const fixture = await createFixture(t, {
    hooks: {
      beforeLockReleaseRead() {
        throw new Error("synthetic-lock-read-failure");
      },
      beforeQuarantinePersist() {
        throw new Error("synthetic-quarantine-write-failure");
      },
    },
  });

  const created = await fixture.manager.create("manual");
  assert.equal(created.commitStatus, "committed");
  assert.equal(created.auditStatus, "degraded");
  assert.equal(created.lockStatus, "degraded");
  assert.equal((await readdir(fixture.backupRoot)).includes(".backup-manager.quarantine"), false);
  assert.equal((await readdir(fixture.backupRoot)).includes(".backup-manager.lock"), true);
  await assert.rejects(
    fixture.manager.create("manual"),
    (error) => error?.code === BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
  );
  const restartedManager = new ProductionBackupManager(fixture.managerOptions);
  await assert.rejects(
    restartedManager.startupPreflight(),
    (error) => error?.code === BACKUP_ERROR_CODES.OPERATION_LOCKED,
  );
});

test("secondary create cleanup failure cannot false-fail a durable backup and quarantines mutations", async (t) => {
  let inject = true;
  const fixture = await createFixture(t, {
    hooks: {
      beforeCreateFinalCleanup({ committed }) {
        if (!committed || !inject) return;
        inject = false;
        throw new Error("synthetic-secondary-cleanup-failure");
      },
    },
  });

  const created = await fixture.manager.create("manual");
  assert.equal(created.commitStatus, "committed");
  assert.equal(created.auditStatus, "degraded");
  assert.equal(created.cleanupStatus, "degraded");
  assert.equal(created.recoveryStatus, "operator_action_required");
  assert.equal((await readdir(fixture.tempRoot)).length, 0);
  assert.equal(
    (await fixture.manager.list()).some((item) => item.id === created.id && item.verified),
    true,
  );
  await assert.rejects(
    fixture.manager.startupPreflight(),
    (error) => error?.code === BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
  );
});
