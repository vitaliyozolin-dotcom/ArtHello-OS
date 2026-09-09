import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyCheckedMigrations,
  verifyMigrationBundle,
} from "../../lib/db/scripts/checked-migration-runner.mjs";

function fixture(
  sql = "SELECT 1;\n",
  sha256 = createHash("sha256").update(sql).digest("hex"),
) {
  const root = mkdtempSync(join(tmpdir(), "arthello-migrations-"));
  mkdirSync(join(root, "drizzle"));
  writeFileSync(join(root, "drizzle", "0000_fixture.sql"), sql);
  writeFileSync(
    join(root, "migration-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      migrations: [{ tag: "0000_fixture", timestamp: 1, sha256 }],
    }),
  );
  return root;
}

test("rejects altered and unmanifested SQL before opening a database", async () => {
  await assert.rejects(
    verifyMigrationBundle(fixture("SELECT 1;\n", "invalid")),
    /SHA-256 mismatch/,
  );

  const root = fixture();
  writeFileSync(join(root, "drizzle", "0001_unmanifested.sql"), "SELECT 2;\n");
  await assert.rejects(verifyMigrationBundle(root), /unmanifested SQL/);
});

test("applies pending checked-in SQL sequentially and records its immutable identity", async () => {
  const sql = "CREATE TABLE proof (id integer);\n";
  const root = fixture(sql);
  const bundle = await verifyMigrationBundle(root);
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("SELECT hash")) return { rows: [] };
      return { rows: [] };
    },
  };

  await applyCheckedMigrations(client, bundle);
  assert.deepEqual(
    calls.map(({ text }) => text),
    [
      "SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id",
      "BEGIN",
      sql,
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
      "COMMIT",
    ],
  );
  assert.deepEqual(calls[3].values, [bundle.migrations[0].sha256, 1]);
});

test("fails closed when applied migration history differs from the manifest", async () => {
  const root = fixture();
  const bundle = await verifyMigrationBundle(root);
  const client = {
    async query(text) {
      if (text.includes("SELECT hash")) {
        return { rows: [{ hash: "altered", created_at: "1" }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    applyCheckedMigrations(client, bundle),
    /Applied migration hash mismatch/,
  );
});
