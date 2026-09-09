import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import {
  assertMigrationStateReady,
  REQUIRED_MIGRATION_STATE,
} from "../src/lib/migration-state-gate.ts";

test("read-only gate inventory matches the immutable manifest", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../lib/db/migration-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    REQUIRED_MIGRATION_STATE,
    manifest.migrations.map(({ timestamp, sha256 }) => ({ timestamp, sha256 })),
  );
});

test("migration state gate accepts the exact manifest history without mutation", async () => {
  const queries = [];
  const queryable = {
    async query(text) {
      queries.push(text);
      return {
        rows: [
          {
            hash: "expected-hash",
            created_at: "42",
          },
        ],
      };
    },
  };

  await assertMigrationStateReady(queryable, [
    { sha256: "expected-hash", timestamp: 42 },
  ]);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^SELECT hash, created_at::text/m);
  assert.doesNotMatch(
    queries[0],
    /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i,
  );
});

test("migration state gate rejects missing, unknown, or altered history", async () => {
  const expected = [{ sha256: "expected-hash", timestamp: 42 }];
  for (const rows of [
    [],
    [{ hash: "altered", created_at: "42" }],
    [
      { hash: "expected-hash", created_at: "42" },
      { hash: "unknown", created_at: "43" },
    ],
  ]) {
    await assert.rejects(
      assertMigrationStateReady(
        {
          async query() {
            return { rows };
          },
        },
        expected,
      ),
      /migration state/i,
    );
  }
});
