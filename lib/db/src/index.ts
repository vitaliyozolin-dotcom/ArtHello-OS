import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

export function createDb(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  return { pool, db };
}

type DatabaseConnection = ReturnType<typeof createDb>;

let defaultConnection: DatabaseConnection | undefined;

function getDefaultConnection(): DatabaseConnection {
  defaultConnection ??= createDb();
  return defaultConnection;
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const resolved = resolve();
      const value = Reflect.get(resolved, property, resolved);
      return typeof value === "function" ? value.bind(resolved) : value;
    },
  });
}

export const pool = lazyProxy(() => getDefaultConnection().pool);
export const db = lazyProxy(() => getDefaultConnection().db);

export * from "./schema/index.js";
