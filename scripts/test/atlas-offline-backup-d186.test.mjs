import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createOfflineAtlasBackup } from "../../deploy/atlas-offline-backup-d186.mjs";

const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

test("D186 folds a stable WAL snapshot into a standalone immutable backup", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-d186-backup-"));
  const dataDir = join(root, "data");
  const workDir = join(root, "work");
  const backupDir = join(root, "backups");
  mkdirSync(dataDir);
  mkdirSync(workDir);
  mkdirSync(backupDir);
  const sourcePath = join(dataDir, "atlas-school.sqlite");
  const workspacePath = join(workDir, "atlas-school.sqlite");
  const destinationPath = join(backupDir, "pre-d186-123-1.sqlite");
  const source = new DatabaseSync(sourcePath);
  try {
    source.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence(id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    source
      .prepare("INSERT INTO evidence(value) VALUES (?)")
      .run("checkpointed");
    source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    source
      .prepare("INSERT INTO evidence(value) VALUES (?)")
      .run("committed-in-wal");
    assert.equal(existsSync(`${sourcePath}-wal`), true);
    const mainBefore = digest(sourcePath);
    const walBefore = digest(`${sourcePath}-wal`);

    const result = await createOfflineAtlasBackup({
      sourcePath,
      workspacePath,
      destinationPath,
    });

    assert.deepEqual(result, {
      integrity: "ok",
      journalMode: "delete",
      walIncluded: true,
    });
    assert.equal(digest(sourcePath), mainBefore);
    assert.equal(digest(`${sourcePath}-wal`), walBefore);
    assert.equal(statSync(destinationPath).mode & 0o777, 0o444);
    chmodSync(backupDir, 0o555);
    const backup = new DatabaseSync(destinationPath, { readOnly: true });
    try {
      assert.equal(
        backup.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
      assert.equal(
        backup.prepare("PRAGMA journal_mode").get().journal_mode,
        "delete",
      );
      assert.deepEqual(
        backup
          .prepare("SELECT value FROM evidence ORDER BY id")
          .all()
          .map((row) => row.value),
        ["checkpointed", "committed-in-wal"],
      );
    } finally {
      backup.close();
    }
  } finally {
    source.close();
    chmodSync(backupDir, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("D186 never overwrites an existing backup target", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-d186-existing-"));
  const sourcePath = join(root, "source.sqlite");
  const workspacePath = join(root, "work.sqlite");
  const destinationPath = join(root, "backup.sqlite");
  const source = new DatabaseSync(sourcePath);
  try {
    source.exec("CREATE TABLE evidence(id INTEGER PRIMARY KEY)");
    source.close();
    writeFileSync(destinationPath, "existing-backup", { mode: 0o444 });
    await assert.rejects(
      createOfflineAtlasBackup({ sourcePath, workspacePath, destinationPath }),
      /backup destination already exists/,
    );
    assert.equal(readFileSync(destinationPath, "utf8"), "existing-backup");
  } finally {
    try {
      source.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
