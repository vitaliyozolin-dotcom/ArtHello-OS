import { env } from "cloudflare:workers";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

type ProductionEnv = {
  DB: D1Database;
};

type SchoolGrantRow = {
  role: string;
  status: string;
  access_version: number;
};

export type SchoolSystemGrant = {
  role: string;
  status: string;
  accessVersion: number;
};

const SCHOOL_SYSTEM_ID = "SYS-SCHOOL-1-11";

function database(): D1Database {
  const db = (env as unknown as ProductionEnv).DB;
  if (!db) throw new Error("Production database is unavailable");
  return db;
}

export async function loadSchoolSystemGrant(
  appUserIdValue: unknown,
): Promise<SchoolSystemGrant | null> {
  const appUserId =
    typeof appUserIdValue === "string" ? appUserIdValue.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(appUserId)) return null;

  const row = await database()
    .prepare(`SELECT role,status,access_version
      FROM user_system_access
      WHERE user_id=? AND system_id=?`)
    .bind(appUserId, SCHOOL_SYSTEM_ID)
    .first<SchoolGrantRow>();

  if (!row) return null;
  return {
    role: row.role,
    status: row.status,
    accessVersion: Number.isInteger(row.access_version)
      ? Math.max(1, Number(row.access_version))
      : 1,
  };
}
