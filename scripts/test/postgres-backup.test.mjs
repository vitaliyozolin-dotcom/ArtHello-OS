import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../../deploy/backup.sh", import.meta.url);

async function executable(path, body) {
  await writeFile(path, `#!/bin/sh\nset -eu\n${body}\n`);
  await chmod(path, 0o755);
}

async function fixture({ restoreFails = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "arthello-backup-"));
  const bin = join(root, "bin");
  const backups = join(root, "backups");
  await import("node:fs/promises").then(({ mkdir }) =>
    Promise.all([mkdir(bin), mkdir(backups)]),
  );
  await executable(
    join(bin, "date"),
    'case "${1:-}" in +%s) echo 1 ;; *) echo 20260910T120000Z ;; esac',
  );
  await executable(
    join(bin, "pg_dump"),
    'for arg in "$@"; do case "$arg" in --file=*) file=${arg#--file=} ;; esac; done; printf dump > "$file"',
  );
  await executable(
    join(bin, "pg_restore"),
    restoreFails ? "exit 7" : 'test "$1" = --list; test -s "$2"',
  );
  return { root, bin, backups };
}

function run({ bin, backups }, extra = {}) {
  return spawnSync("/bin/sh", [script.pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "postgres://fixture.invalid/arthello",
      BACKUP_DIR: backups,
      BACKUP_RUN_ONCE: "1",
      ...extra,
    },
  });
}

test("publishes a dump and portable checksum only after restore-list verification", async () => {
  const value = await fixture();
  const result = run(value);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(value.backups)).sort(), [
    "arthello-20260910T120000Z.dump",
    "arthello-20260910T120000Z.dump.sha256",
  ]);
  assert.match(
    await readFile(
      join(value.backups, "arthello-20260910T120000Z.dump.sha256"),
      "utf8",
    ),
    /^\w{64}  arthello-/,
  );
});

test("does not publish a dump or checksum when verification fails", async () => {
  const value = await fixture({ restoreFails: true });
  const result = run(value);
  assert.equal(result.status, 7);
  assert.deepEqual(await readdir(value.backups), []);
});

test("rejects non-positive scheduling and retention values before dumping", async () => {
  const value = await fixture();
  const result = run(value, { BACKUP_RETENTION_DAYS: "0" });
  assert.equal(result.status, 64);
  assert.deepEqual(await readdir(value.backups), []);
});
