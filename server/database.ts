import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";

export type QueryResult = { meta: { changes: number } };

function sqlValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  )
    return value;
  throw new Error("Неподдерживаемое значение SQL");
}

export class PreparedQuery {
  constructor(
    private readonly statement: StatementSync,
    readonly sql: string,
    readonly bindings: SQLInputValue[] = [],
  ) {}

  bind(...bindings: unknown[]) {
    return new PreparedQuery(this.statement, this.sql, bindings.map(sqlValue));
  }

  async first<T>() {
    return (this.statement.get(...this.bindings) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.statement.all(...this.bindings) as T[] };
  }

  async run(): Promise<QueryResult> {
    const result = this.statement.run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

export class SchoolDatabase {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    return new PreparedQuery(this.sqlite.prepare(sql), sql);
  }

  async batch(statements: PreparedQuery[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: QueryResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

let databaseInstance: SchoolDatabase | null = null;
let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

export function getDatabase() {
  if (databaseInstance) return databaseInstance;
  const databasePath =
    process.env.DATABASE_PATH ||
    join(process.cwd(), "data", "school-1-11.sqlite");
  if (databasePath !== ":memory:")
    mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  databaseInstance = new SchoolDatabase(sqlite);
  return databaseInstance;
}

export function loadMigrationSql() {
  const filenames = [
    "0000_motionless_goblin_queen.sql",
    "0001_white_nighthawk.sql",
    "0002_mature_psylocke.sql",
    "0003_daffy_quentin_quire.sql",
    "0004_phone_auth.sql",
    "0005_central_staff_access.sql",
    "0006_identity_broker.sql",
  ];
  return filenames.map((filename) =>
    readFileSync(join(process.cwd(), "drizzle", filename), "utf8"),
  );
}

export async function ensureDatabaseReady() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = initializeDatabase();
  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

async function initializeDatabase() {
  const db = getDatabase();
  const statements = loadMigrationSql()
    .join("\n--> statement-breakpoint\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim().replace(/;$/, ""))
    .filter(Boolean);
  const tables = statements
    .filter((statement) => /^CREATE TABLE /i.test(statement))
    .map((statement) =>
      statement.replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS "),
    );
  await db.batch(tables.map((statement) => db.prepare(statement)));

  const ensureColumn = async (table: string, column: string, sql: string) => {
    const info = await db
      .prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string }>();
    if (!info.results.some((item) => item.name === column))
      await db.prepare(sql).run();
  };
  await ensureColumn(
    "subjects",
    "status",
    "ALTER TABLE subjects ADD status text DEFAULT 'active' NOT NULL",
  );
  await ensureColumn(
    "users",
    "profile_status",
    "ALTER TABLE users ADD profile_status text DEFAULT 'confirmed' NOT NULL",
  );
  await ensureColumn(
    "users",
    "notes",
    "ALTER TABLE users ADD notes text DEFAULT '' NOT NULL",
  );
  await ensureColumn("users", "phone", "ALTER TABLE users ADD phone text");
  await ensureColumn(
    "users",
    "password_hash",
    "ALTER TABLE users ADD password_hash text",
  );
  await ensureColumn(
    "users",
    "password_state",
    "ALTER TABLE users ADD password_state text DEFAULT 'pending' NOT NULL",
  );
  await ensureColumn(
    "users",
    "auth_version",
    "ALTER TABLE users ADD auth_version integer DEFAULT 1 NOT NULL",
  );
  await ensureColumn(
    "users",
    "failed_login_count",
    "ALTER TABLE users ADD failed_login_count integer DEFAULT 0 NOT NULL",
  );
  await ensureColumn(
    "users",
    "locked_until",
    "ALTER TABLE users ADD locked_until text",
  );
  await ensureColumn(
    "users",
    "last_login_at",
    "ALTER TABLE users ADD last_login_at text",
  );
  await ensureColumn(
    "users",
    "central_user_id",
    "ALTER TABLE users ADD central_user_id text",
  );
  await ensureColumn(
    "users",
    "identity_source",
    "ALTER TABLE users ADD identity_source text DEFAULT 'school_diary' NOT NULL",
  );
  await ensureColumn(
    "users",
    "central_access_version",
    "ALTER TABLE users ADD central_access_version integer DEFAULT 0 NOT NULL",
  );

  const indexes = statements
    .filter((statement) => /^CREATE (UNIQUE )?INDEX /i.test(statement))
    .map((statement) =>
      statement
        .replace(/^CREATE UNIQUE INDEX /i, "CREATE UNIQUE INDEX IF NOT EXISTS ")
        .replace(/^CREATE INDEX /i, "CREATE INDEX IF NOT EXISTS "),
    );
  await db.batch(indexes.map((statement) => db.prepare(statement)));
  schemaReady = true;
}
