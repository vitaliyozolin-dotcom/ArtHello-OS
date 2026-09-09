import type { Request } from "express";
import { pool } from "@workspace/db";
import { logger } from "../../lib/logger.js";

const DEFAULT_BRANCH = "6";

export { logger, pool };

export function branchId(req: Request): string {
  return (req.query["branchId"] as string | undefined) ?? DEFAULT_BRANCH;
}

export async function sql<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query(query, params);
  return rows as T[];
}

export async function sqlOne<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await sql<T>(query, params);
  return rows[0] ?? null;
}
