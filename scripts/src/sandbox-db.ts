import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const workspaceRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const migrationsDirectory = resolve(workspaceRoot, "lib/db/drizzle");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function resolveSandboxDatabasePath(
  explicitPath = process.env.ARTHELLO_SANDBOX_DB_PATH,
): string {
  const candidate = explicitPath?.trim();
  if (!candidate) {
    throw new Error(
      "ARTHELLO_SANDBOX_DB_PATH is required for the isolated data sandbox",
    );
  }
  if (!isAbsolute(candidate)) {
    throw new Error("ARTHELLO_SANDBOX_DB_PATH must be an absolute path");
  }

  const resolved = resolve(candidate);
  if (resolved === "/" || isWithin(workspaceRoot, resolved)) {
    throw new Error(
      "The sandbox database must live outside the source checkout",
    );
  }
  return resolved;
}

async function applyMigrations(database: PGlite): Promise<number> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS arthello_sandbox_migrations (
      name text PRIMARY KEY,
      content_hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  let applied = 0;

  for (const name of files) {
    const source = await readFile(resolve(migrationsDirectory, name), "utf8");
    const contentHash = sha256(source);
    const existing = await database.query<{
      content_hash: string;
    }>(
      `SELECT content_hash
       FROM arthello_sandbox_migrations
       WHERE name = $1`,
      [name],
    );
    const existingHash = existing.rows[0]?.content_hash;
    if (existingHash) {
      if (existingHash !== contentHash) {
        throw new Error(`Applied migration ${name} has changed`);
      }
      continue;
    }

    await database.exec("BEGIN");
    try {
      for (const statement of source
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await database.exec(statement);
      }
      await database.query(
        `INSERT INTO arthello_sandbox_migrations (name, content_hash)
         VALUES ($1, $2)`,
        [name, contentHash],
      );
      await database.exec("COMMIT");
      applied += 1;
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
  }

  return applied;
}

export interface OpenSandboxDatabaseResult {
  database: PGlite;
  migrationsApplied: number;
}

export async function openSandboxDatabase(
  explicitPath?: string,
): Promise<OpenSandboxDatabaseResult> {
  const databasePath = resolveSandboxDatabasePath(explicitPath);
  const database = new PGlite(databasePath);
  const migrationsApplied = await applyMigrations(database);
  return { database, migrationsApplied };
}

export async function sandboxTableCount(database: PGlite): Promise<number> {
  const result = await database.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.tables
     WHERE table_schema = 'public'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
