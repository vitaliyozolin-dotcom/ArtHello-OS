import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  findDbAccessViolations,
  LEGACY_POOL_QUERY_BASELINE,
} from "../lib/db-access-policy.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "arthello-db-access-policy-"));
  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
  return root;
}

test("rejects new pool.query usage and PGlite outside scripts", () => {
  const root = fixture({
    "artifacts/api-server/src/new-route.ts": "await pool.query('select 1');\n",
    "lib/db/src/runtime.ts": 'import { PGlite } from "@electric-sql/pglite";\n',
    "scripts/src/sandbox.ts":
      'import { PGlite } from "@electric-sql/pglite";\n',
  });

  assert.deepEqual(findDbAccessViolations(root, {}), [
    "artifacts/api-server/src/new-route.ts: pool.query 1 > 0",
    "lib/db/src/runtime.ts: PGlite is restricted to scripts/",
  ]);
});

test("accepts db.execute and an exact legacy pool.query baseline", () => {
  const root = fixture({
    "artifacts/api-server/src/report.ts":
      "await db.execute(sql`select 1`);\nawait pool.query('select 1');\n",
  });

  assert.deepEqual(
    findDbAccessViolations(root, {
      "artifacts/api-server/src/report.ts": 1,
    }),
    [],
  );
});

test("rejects a stale pool.query baseline after legacy usage shrinks", () => {
  const root = fixture({
    "artifacts/api-server/src/report.ts": "await pool.query('select 1');\n",
  });

  assert.deepEqual(
    findDbAccessViolations(root, {
      "artifacts/api-server/src/report.ts": 2,
      "artifacts/api-server/src/deleted.ts": 1,
    }),
    [
      "artifacts/api-server/src/deleted.ts: baseline 1 > actual 0",
      "artifacts/api-server/src/report.ts: baseline 2 > actual 1",
    ],
  );
});

test("the checked-in baseline exactly describes the current application tree", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  assert.deepEqual(
    findDbAccessViolations(root, LEGACY_POOL_QUERY_BASELINE),
    [],
  );
});

test("the aggregate refactoring gate includes the database access policy", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    manifest.scripts["test:refactoring"],
    /db-access-policy\.test\.mjs/,
  );
  assert.match(manifest.scripts.lint, /db-access-policy\.mjs/);
});
