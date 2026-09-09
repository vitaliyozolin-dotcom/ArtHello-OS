#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const DB_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function verifyMigrationBundle(dbRoot = DB_ROOT) {
  const manifestPath = path.join(dbRoot, "migration-manifest.json");
  const migrationsRoot = path.join(dbRoot, "drizzle");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.migrations)) {
    throw new Error("Unsupported migration manifest schema");
  }

  const sqlFiles = (await readdir(migrationsRoot))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const expectedFiles = manifest.migrations.map(({ tag }) => `${tag}.sql`);
  const unmanifested = sqlFiles.filter((name) => !expectedFiles.includes(name));
  const missing = expectedFiles.filter((name) => !sqlFiles.includes(name));
  if (unmanifested.length) {
    throw new Error(
      `Migration bundle contains unmanifested SQL: ${unmanifested.join(", ")}`,
    );
  }
  if (missing.length) {
    throw new Error(
      `Migration manifest references missing SQL: ${missing.join(", ")}`,
    );
  }

  const timestamps = new Set();
  const migrations = [];
  for (const entry of manifest.migrations) {
    if (
      !Number.isSafeInteger(entry.timestamp) ||
      timestamps.has(entry.timestamp)
    ) {
      throw new Error(
        `Migration timestamp is invalid or duplicated at ${entry.tag}`,
      );
    }
    timestamps.add(entry.timestamp);
    const sql = await readFile(
      path.join(migrationsRoot, `${entry.tag}.sql`),
      "utf8",
    );
    const actualHash = sha256(sql);
    if (actualHash !== entry.sha256) {
      throw new Error(`Migration SHA-256 mismatch for ${entry.tag}`);
    }
    migrations.push({ ...entry, sql });
  }
  return { migrations };
}

export async function ensureMigrationLedger(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id serial PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
}

export async function applyCheckedMigrations(client, bundle) {
  const applied = await client.query(
    "SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id",
  );
  if (applied.rows.length > bundle.migrations.length) {
    throw new Error("Applied migration state contains unknown entries");
  }
  for (let index = 0; index < applied.rows.length; index += 1) {
    const actual = applied.rows[index];
    const expected = bundle.migrations[index];
    if (
      actual.created_at !== String(expected.timestamp) ||
      actual.hash !== expected.sha256
    ) {
      throw new Error(`Applied migration hash mismatch at position ${index}`);
    }
  }

  for (const migration of bundle.migrations.slice(applied.rows.length)) {
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        [migration.sha256, migration.timestamp],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new Error("DATABASE_URL is required for checked migrations");
  const bundle = await verifyMigrationBundle();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureMigrationLedger(client);
    await applyCheckedMigrations(client, bundle);
  } finally {
    await client.end();
  }
  console.log(
    `Checked migration runner: ${bundle.migrations.length} migrations verified and applied.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Checked migration runner failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
