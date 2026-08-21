import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = new URL("../../lib/db/drizzle/", import.meta.url);

export async function migrationSources(maximum = 14) {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= maximum)
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      source: await readFile(new URL(name, migrationsDirectory), "utf8"),
    })),
  );
}

export async function executeMigrationSource(database, source) {
  for (const statement of source
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    await database.exec(statement);
  }
}

export async function openAlfaTestDatabase(maximum = 14) {
  const database = new PGlite();
  for (const migration of await migrationSources(maximum)) {
    await executeMigrationSource(database, migration.source);
  }
  return database;
}

export async function createBatch(database, mode = "full_sandbox_read_only") {
  const result = await database.query(
    `INSERT INTO alpha_sync_batches (status, mode, triggered_by)
     VALUES ('running', $1, 'automated_test')
     RETURNING id`,
    [mode],
  );
  return result.rows[0].id;
}

export async function createRawContext(
  database,
  batchId,
  {
    branchId = "branch-test",
    entityType = "test_entity",
    alphaId = "record-test",
    scopeKey = "branch-test:test",
    payload = { id: alphaId },
  } = {},
) {
  const raw = await database.query(
    `INSERT INTO alpha_raw_records (
       alpha_id,
       entity_type,
       endpoint,
       branch_id,
       source_payload,
       payload_hash,
       sync_batch_id,
       page
     ) VALUES ($1, $2, 'test/index', $3, $4::jsonb, $5, $6, 0)
     RETURNING id`,
    [
      alphaId,
      entityType,
      branchId,
      JSON.stringify(payload),
      `${entityType}:${alphaId}`,
      batchId,
    ],
  );
  return {
    batchId,
    rawId: raw.rows[0].id,
    scopeKey,
  };
}
