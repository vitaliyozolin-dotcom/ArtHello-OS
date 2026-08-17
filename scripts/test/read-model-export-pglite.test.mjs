import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("owner read-model SQL executes on a migrated disposable database", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "arthello-read-model-"));
  const databasePath = join(temporaryRoot, "pglite");
  const scriptsRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "./src/export-sites-read-model-sandbox.ts"],
      {
        cwd: scriptsRoot,
        env: {
          ...process.env,
          ARTHELLO_ALLOW_PII_EXPORT: "owner_authorized",
          ARTHELLO_SANDBOX_DB_PATH: databasePath,
        },
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.safety.partialAlfaRowsPublished, false);
    assert.deepEqual(payload.datasets.alpha_students, []);
    assert.deepEqual(payload.datasets.family_candidates, []);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
