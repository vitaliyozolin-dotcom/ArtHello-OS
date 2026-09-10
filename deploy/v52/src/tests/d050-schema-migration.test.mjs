import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationDirectory = new URL("../drizzle/", import.meta.url);
const migrationName = "0023_d050_schema";
const migrationSql = readFileSync(new URL(`${migrationName}.sql`, migrationDirectory), "utf8");

function executeMigration(database, sql) {
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

function applyRecordedMigration(database, tag, sql) {
  database.exec("CREATE TABLE IF NOT EXISTS migration_test_journal (tag TEXT PRIMARY KEY NOT NULL)");
  if (database.prepare("SELECT 1 FROM migration_test_journal WHERE tag = ?").get(tag)) return false;
  database.exec("BEGIN");
  try {
    executeMigration(database, sql);
    database.prepare("INSERT INTO migration_test_journal (tag) VALUES (?)").run(tag);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function databaseAtMigration22() {
  const database = new DatabaseSync(":memory:");
  const priorMigrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < `${migrationName}.sql`)
    .sort();
  for (const name of priorMigrations) {
    executeMigration(database, readFileSync(new URL(name, migrationDirectory), "utf8"));
  }
  return database;
}

test("D-050 migration is additive, preserves existing rows, and is journal-idempotent", () => {
  const database = databaseAtMigration22();
  try {
    database.prepare(`INSERT INTO app_users
      (id,contact_type,contact,display_name,role,invited_by)
      VALUES ('USER-LEGACY','email','legacy@example.test','Legacy user','OWNER','system')`).run();
    database.prepare(`INSERT INTO tasks (title,owner,created_by)
      VALUES ('Legacy task','Legacy owner','legacy@example.test')`).run();

    assert.equal(applyRecordedMigration(database, migrationName, migrationSql), true);
    assert.equal(applyRecordedMigration(database, migrationName, migrationSql), false);

    const user = database.prepare(`SELECT job_title,allowed_modules,favorite_modules
      FROM app_users WHERE id='USER-LEGACY'`).get();
    assert.deepEqual({ ...user }, { job_title: "", allowed_modules: "", favorite_modules: "" });
    assert.equal(
      database.prepare("SELECT created_by_user_id FROM tasks WHERE title='Legacy task'").get().created_by_user_id,
      "",
    );

    const columns = database.prepare("PRAGMA table_info(legal_contract_text_versions)").all();
    assert.deepEqual(columns.map((column) => column.name), [
      "id", "stable_id", "contract_id", "document_item_id", "version", "body_text",
      "source_mode", "model_version", "policy_version", "protection_class", "confirmed_by", "confirmed_at",
    ]);
    const index = database.prepare(`SELECT sql FROM sqlite_schema
      WHERE type='index' AND name='legal_contract_text_stable_version_unique'`).get();
    assert.match(index.sql, /UNIQUE INDEX/);
  } finally {
    database.close();
  }
});

test("D-050 migration and Drizzle metadata describe only the current schema delta", () => {
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  const previousSnapshot = JSON.parse(readFileSync(new URL("../drizzle/meta/0022_snapshot.json", import.meta.url), "utf8"));
  const snapshot = JSON.parse(readFileSync(new URL("../drizzle/meta/0023_snapshot.json", import.meta.url), "utf8"));
  const migrationEntry = journal.entries.find((entry) => entry.idx === 23);

  assert.deepEqual(migrationEntry, {
    idx: 23,
    version: "6",
    when: 1788402753435,
    tag: migrationName,
    breakpoints: true,
  });
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.deepEqual(
    Object.keys(snapshot.tables.app_users.columns).filter((name) => !previousSnapshot.tables.app_users.columns[name]),
    ["job_title", "allowed_modules", "favorite_modules"],
  );
  assert.deepEqual(
    Object.keys(snapshot.tables.tasks.columns).filter((name) => !previousSnapshot.tables.tasks.columns[name]),
    ["created_by_user_id"],
  );
  assert.ok(snapshot.tables.legal_contract_text_versions);
  assert.doesNotMatch(migrationSql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  for (const column of ["job_title", "allowed_modules", "favorite_modules", "created_by_user_id"]) {
    assert.match(migrationSql, new RegExp("ADD `" + column + "` [^;]+DEFAULT '' NOT NULL"));
  }
});
