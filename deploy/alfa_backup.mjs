import {
  cpSync,
  readdirSync,
  lstatSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  statfsSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { pathToFileURL } from "node:url";

function files(root, at = root) {
  return readdirSync(at)
    .sort()
    .flatMap((name) => {
      const path = join(at, name),
        stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw Error("unsupported data file");
      return stat.isDirectory() ? files(root, path) : [relative(root, path)];
    });
}
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export async function snapshot(source, target, system) {
  if (!["central", "atlas", "school"].includes(system))
    throw Error("unknown system");
  const raw = join(target, "raw");
  mkdirSync(raw, { recursive: false, mode: 0o700 });
  const before = files(source),
    hashes = before.map((file) => [file, hash(join(source, file))]);
  if (!before.length) throw Error("empty source");
  const bytes = before.reduce((sum, file) => sum + lstatSync(join(source, file)).size, 0);
  const capacity = statfsSync(target);
  if (capacity.bavail * capacity.bsize < bytes * 3 + 512 * 1024 * 1024)
    throw Error("insufficient snapshot capacity");
  // The caller has stopped the sole writer; source is mounted read-only.
  // Main databases and WAL sidecars are preserved together, before inspection.
  cpSync(source, raw, {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: false,
  });
  if (
    JSON.stringify(files(source)) !== JSON.stringify(before) ||
    JSON.stringify(files(raw)) !== JSON.stringify(before)
  )
    throw Error("snapshot inventory changed");
  for (const [file, sha] of hashes)
    if (hash(join(source, file)) !== sha || hash(join(raw, file)) !== sha)
      throw Error("snapshot content changed");
  const databases = before.filter((file) => file.endsWith(".sqlite"));
  if (!databases.length) throw Error("database missing");
  // The School controller verifies this exact DATABASE_PATH in runtime_plan.
  // Historical copies share its schema but are not the application's database.
  const primaryDatabase = system === "school" ? "school-1-11.sqlite" : null;
  if (primaryDatabase && !databases.includes(primaryDatabase))
    throw Error("database missing");
  let primary = 0;
  for (let i = 0; i < databases.length; i++) {
    const db = new DatabaseSync(join(raw, databases[i]), { readOnly: true });
    const tables = new Set(
      db
        .prepare("select name from sqlite_master where type='table'")
        .all()
        .map((row) => row.name),
    );
    if (db.prepare("pragma integrity_check").get().integrity_check !== "ok")
      throw Error("snapshot integrity");
    if (system === "school") {
      if (databases[i] === primaryDatabase) {
        if (!tables.has("students") || !tables.has("school_classes")) {
          db.close();
          throw Error("configured database schema");
        }
        primary++;
      }
    } else if (
      system === "central" &&
      tables.has("system_runtime_state") &&
      tables.has("alfacrm_import_records")
    ) {
      primary++;
      const row = db
        .prepare(
          "select state_value from system_runtime_state where state_key='alfacrm_connector:v1'",
        )
        .get();
      if (!row) throw Error("connector missing");
      const state = JSON.parse(row.state_value);
      if (!state.connected || state.autosync?.enabled)
        throw Error("AlfaCRM must be connected and paused");
    } else if (
      system !== "central" &&
      tables.has("students") &&
      tables.has("school_classes")
    ) {
      if (system === "atlas") {
        if (!tables.has("diary_identity") || db.prepare("SELECT institution_id FROM diary_identity WHERE id='primary'").get()?.institution_id !== "atlas-school")
          throw Error("diary identity mismatch");
      }
      primary++;
    }
    const standalone = join(target, `database-${i}.sqlite`);
    await backup(db, standalone);
    db.close();
    const verify = new DatabaseSync(standalone);
    verify.exec("PRAGMA journal_mode=DELETE");
    if (verify.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("standalone integrity");
    verify.close();
  }
  if (primary !== 1) throw Error("ambiguous application database");
  const receipt = {
    system,
    files: before.length,
    databases: databases.length,
    ...(primaryDatabase ? { primaryDatabase } : {}),
    integrity: "ok",
    walIncluded: before.some((f) => f.endsWith("-wal")),
    manifestSha256: createHash("sha256")
      .update(JSON.stringify(hashes))
      .digest("hex"),
  };
  writeFileSync(join(target, "receipt.json"), JSON.stringify(receipt), {
    flag: "wx",
    mode: 0o600,
  });
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await snapshot("/source", "/snapshot", process.env.SNAPSHOT_SYSTEM),
      ),
    );
  } catch (error) {
    const codes = { "ambiguous application database": "DATABASE_SCHEMA", "configured database schema": "DATABASE_SCHEMA", "diary identity mismatch": "DIARY_IDENTITY", "insufficient snapshot capacity": "CAPACITY", "snapshot integrity": "INTEGRITY", "database missing": "DATABASE_MISSING" };
    console.error("SNAPSHOT_REFUSED=" + (codes[error?.message] ?? (["EACCES", "EROFS", "ENOSPC"].includes(error?.code) ? error.code : "UNCONFIRMED")));
    process.exitCode = 2;
  }
}
