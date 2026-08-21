import { pool } from "@workspace/db";
import {
  REQUIRED_SECURITY_INDEXES,
  REQUIRED_SECURITY_MIGRATIONS,
  REQUIRED_SECURITY_TABLE_COLUMNS,
  SecuritySchemaNotReadyError,
  validateSecuritySchemaInventory,
} from "./security-schema-inventory.js";

interface QueryResult<Row> {
  rows: Row[];
}

export interface SecuritySchemaQueryable {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export async function assertSecuritySchemaReady(
  queryable: SecuritySchemaQueryable = pool,
): Promise<void> {
  try {
    const tableNames = Object.keys(
      REQUIRED_SECURITY_TABLE_COLUMNS,
    );
    const [columnResult, indexResult, migrationResult] =
      await Promise.all([
        queryable.query<{
          table_name: string;
          column_name: string;
        }>(
          `SELECT table_name, column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = ANY($1::text[])`,
          [tableNames],
        ),
        queryable.query<{ indexname: string }>(
          `SELECT indexname
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = ANY($1::text[])`,
          [[...REQUIRED_SECURITY_INDEXES]],
        ),
        queryable.query<{
          hash: string;
          created_at: string;
        }>(
          `SELECT hash, created_at::text AS created_at
           FROM drizzle.__drizzle_migrations
           WHERE created_at = ANY($1::bigint[])`,
          [
            REQUIRED_SECURITY_MIGRATIONS.map(
              ({ timestamp }) => timestamp,
            ),
          ],
        ),
      ]);

    validateSecuritySchemaInventory({
      columns: columnResult.rows.map((row) => ({
        tableName: row.table_name,
        columnName: row.column_name,
      })),
      indexes: indexResult.rows.map((row) => row.indexname),
      migrations: migrationResult.rows.map((row) => ({
        timestamp: row.created_at,
        hash: row.hash,
      })),
    });
  } catch (err) {
    if (err instanceof SecuritySchemaNotReadyError) throw err;
    throw new SecuritySchemaNotReadyError(
      "Required security schema could not be verified",
      { cause: err },
    );
  }
}
