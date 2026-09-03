import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationDirectory = new URL("../drizzle/", import.meta.url);
const migrationName = "0024_bright_bruce_banner";
const migrationSql = readFileSync(new URL(`${migrationName}.sql`, migrationDirectory), "utf8");

function executeMigration(database, sql) {
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

function databaseAtMigration23() {
  const database = new DatabaseSync(":memory:");
  const prior = readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < `${migrationName}.sql`)
    .sort();
  for (const name of prior) executeMigration(database, readFileSync(new URL(name, migrationDirectory), "utf8"));
  return database;
}

test("Tochka bank migration is additive and creates idempotent source registers", () => {
  const database = databaseAtMigration23();
  try {
    database.prepare(`INSERT INTO financial_operations
      (id,operation_date,period,direction,amount_minor,category,report_class,source_system,source_file,source_sheet,source_ref,data_quality,created_by)
      VALUES ('FIN-LEGACY','2026-09-01','2026-09','Поступление',10000,'Legacy','Не включено в ОПиУ','LEGACY','legacy.xlsx','Sheet1','1','legacy','test')`).run();
    executeMigration(database, migrationSql);

    assert.equal(database.prepare("SELECT amount_minor FROM financial_operations WHERE id='FIN-LEGACY'").get().amount_minor, 10000);
    for (const table of ["bank_accounts", "bank_statement_imports", "bank_transactions"]) {
      assert.equal(database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)["1"], 1);
    }
    const indices = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all().map((row) => row.name));
    for (const index of ["bank_accounts_provider_unique", "bank_statement_provider_unique", "bank_transactions_provider_unique", "bank_transactions_date_idx"]) {
      assert.equal(indices.has(index), true);
    }
    assert.doesNotMatch(migrationSql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  } finally {
    database.close();
  }
});

test("Drizzle journal and snapshot form a continuous schema chain", () => {
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  const previous = JSON.parse(readFileSync(new URL("../drizzle/meta/0023_snapshot.json", import.meta.url), "utf8"));
  const snapshot = JSON.parse(readFileSync(new URL("../drizzle/meta/0024_snapshot.json", import.meta.url), "utf8"));
  const latest = journal.entries.at(-1);

  assert.equal(latest.idx, 24);
  assert.equal(latest.tag, migrationName);
  assert.equal(snapshot.prevId, previous.id);
  assert.deepEqual(
    Object.keys(snapshot.tables).filter((name) => !previous.tables[name]).sort(),
    ["bank_accounts", "bank_statement_imports", "bank_transactions"],
  );
});
