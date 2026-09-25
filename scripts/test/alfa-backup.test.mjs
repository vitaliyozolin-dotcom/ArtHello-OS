import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot } from "../../deploy/alfa_backup.mjs";

test("School snapshots its configured database and preserves historical SQLite copies", async () => {
  const root = mkdtempSync(join(tmpdir(), "school-primary-"));
  const source = join(root, "source"), target = join(root, "target");
  mkdirSync(source); mkdirSync(target); mkdirSync(join(source, "history"));
  const current = new DatabaseSync(join(source, "school-1-11.sqlite"));
  const historical = new DatabaseSync(join(source, "history", "previous.sqlite"));
  try {
    for (const db of [current, historical]) db.exec("CREATE TABLE students(id TEXT); CREATE TABLE school_classes(id TEXT)");
    current.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO students VALUES ('current')");
    historical.exec("INSERT INTO students VALUES ('historical')");
    historical.close();
    const receipt = await snapshot(source, target, "school");
    assert.equal(receipt.databases, 2);
    assert.equal(receipt.integrity, "ok");
    assert.equal(receipt.walIncluded, true);
    assert.equal(receipt.primaryDatabase, "school-1-11.sqlite");
    const currentCopy = new DatabaseSync(join(target, "database-1.sqlite"), { readOnly: true });
    const historyCopy = new DatabaseSync(join(target, "database-0.sqlite"), { readOnly: true });
    assert.equal(currentCopy.prepare("SELECT id FROM students").get().id, "current");
    assert.equal(historyCopy.prepare("SELECT id FROM students").get().id, "historical");
    currentCopy.close(); historyCopy.close();
  } finally {
    current.close();
    try { historical.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("School never substitutes another SQLite file for a missing or invalid configured database", async () => {
  for (const primarySchema of [null, "CREATE TABLE unrelated(id TEXT)"]) {
    const root = mkdtempSync(join(tmpdir(), "school-invalid-primary-"));
    const source = join(root, "source"), target = join(root, "target");
    mkdirSync(source); mkdirSync(target);
    const other = new DatabaseSync(join(source, "other.sqlite"));
    other.exec("CREATE TABLE students(id TEXT); CREATE TABLE school_classes(id TEXT)"); other.close();
    if (primarySchema) {
      const primary = new DatabaseSync(join(source, "school-1-11.sqlite"));
      primary.exec(primarySchema); primary.close();
    }
    try { await assert.rejects(snapshot(source, target, "school"), /database/); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("offline snapshot preserves committed WAL, source bytes and a standalone database", async () => {
  const root = mkdtempSync(join(tmpdir(), "alfa-wal-")),
    source = join(root, "source"),
    target = join(root, "snapshot");
  mkdirSync(source);
  mkdirSync(target);
  const path = join(source, "school.sqlite"),
    db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE students(id TEXT); CREATE TABLE school_classes(id TEXT); CREATE TABLE diary_identity(id TEXT,institution_id TEXT); INSERT INTO diary_identity VALUES ('primary','atlas-school'); INSERT INTO students VALUES ('synthetic')",
    );
    const main = readFileSync(path),
      wal = readFileSync(path + "-wal");
    const receipt = await snapshot(source, target, "atlas");
    assert.equal(receipt.walIncluded, true);
    assert.deepEqual(readFileSync(path), main);
    assert.deepEqual(readFileSync(path + "-wal"), wal);
    const restored = new DatabaseSync(join(target, "database-0.sqlite"), {
      readOnly: true,
    });
    assert.equal(
      restored.prepare("select count(*) n from students").get().n,
      1,
    );
    assert.equal(
      restored.prepare("pragma journal_mode").get().journal_mode,
      "delete",
    );
    restored.close();
    await assert.rejects(snapshot(source, target, "atlas"));
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("enabled Alfa schedule requires a stopped writer and preserves source", async () => {
  const root = mkdtempSync(join(tmpdir(), "alfa-state-")),
    source = join(root, "source"),
    target = join(root, "snapshot");
  mkdirSync(source);
  mkdirSync(target);
  const db = new DatabaseSync(join(source, "os.sqlite"));
  db.exec(
    "CREATE TABLE alfacrm_import_records(id TEXT); CREATE TABLE system_runtime_state(state_key TEXT,state_value TEXT)",
  );
  db.prepare("INSERT INTO system_runtime_state VALUES (?,?)").run(
    "alfacrm_connector:v1",
    JSON.stringify({ connected: true, autosync: { enabled: true } }),
  );
  db.close();
  const before = process.env.SNAPSHOT_WRITER_STOPPED;
  try {
    delete process.env.SNAPSHOT_WRITER_STOPPED;
    await assert.rejects(snapshot(source, target, "central"), /paused/);
    process.env.SNAPSHOT_WRITER_STOPPED = "1";
    const accepted = join(root, "accepted");
    mkdirSync(accepted);
    const receipt = await snapshot(source, accepted, "central");
    assert.equal(receipt.integrity, "ok");
    assert.equal(receipt.databases, 1);
  } finally {
    if (before === undefined) delete process.env.SNAPSHOT_WRITER_STOPPED;
    else process.env.SNAPSHOT_WRITER_STOPPED = before;
    rmSync(root, { recursive: true, force: true });
  }
});

 test("a database with unrelated classes or wrong institution is refused", async () => {
  for (const schema of ["CREATE TABLE students(id TEXT); CREATE TABLE classes(id TEXT)", "CREATE TABLE students(id TEXT); CREATE TABLE school_classes(id TEXT); CREATE TABLE diary_identity(id TEXT,institution_id TEXT); INSERT INTO diary_identity VALUES ('primary','school-1-11')"]) {
    const root=mkdtempSync(join(tmpdir(),"alfa-wrong-"));
    mkdirSync(join(root,"source")); mkdirSync(join(root,"target"));
    const db=new DatabaseSync(join(root,"source","app.sqlite")); db.exec(schema); db.close();
    try { await assert.rejects(snapshot(join(root,"source"),join(root,"target"),"atlas"), /database|identity/); }
    finally { rmSync(root,{recursive:true,force:true}); }
  }
});
