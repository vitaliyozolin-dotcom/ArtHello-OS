import { openSandboxDatabase } from "./sandbox-db.js";
import {
  normalizeEntity,
  type ImportEntityOptions,
  type NormalizationContext,
} from "./import-alfacrm-sandbox.js";
import { asRecord, type JsonRecord } from "./alfacrm-safe.js";

const replayableTypes = [
  "students",
  "teachers",
  "groups",
  "payments",
  "lessons",
] as const;
const pageSize = 250;

interface ReplayRow {
  sequence: number;
  batch_id: string;
  raw_id: string;
  observation_id: string;
  endpoint: string;
  branch_id: string;
  entity_type: (typeof replayableTypes)[number];
  scope_key: string;
  source_payload: unknown;
}

const { database, migrationsApplied } = await openSandboxDatabase();
try {
  await database.exec(`
    CREATE TEMP TABLE arthello_alfa_rehydrate_queue AS
    WITH latest_observations AS (
      SELECT DISTINCT ON (
        observation.branch_id,
        observation.entity_type,
        raw.alpha_id
      )
        observation.id AS observation_id,
        observation.entity_type,
        observation.branch_id,
        raw.alpha_id
      FROM alpha_raw_observations AS observation
      JOIN alpha_raw_records AS raw
        ON raw.id = observation.raw_record_id
      WHERE observation.entity_type IN (
        'students',
        'teachers',
        'groups',
        'payments',
        'lessons'
      )
      ORDER BY
        observation.branch_id,
        observation.entity_type,
        raw.alpha_id,
        observation.observed_at DESC,
        observation.id DESC
    )
    SELECT
      row_number() OVER (
        ORDER BY entity_type, branch_id, alpha_id, observation_id
      )::int AS sequence,
      observation_id
    FROM latest_observations
  `);
  await database.exec(`
    CREATE UNIQUE INDEX arthello_alfa_rehydrate_queue_sequence_idx
      ON arthello_alfa_rehydrate_queue (sequence)
  `);

  const queued = await database.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM arthello_alfa_rehydrate_queue`,
  );
  const totalQueued = Number(queued.rows[0]?.count ?? 0);
  const normalizedByType: Record<string, number> = Object.fromEntries(
    replayableTypes.map((recordType) => [recordType, 0]),
  );
  let processed = 0;
  let normalized = 0;

  while (processed < totalQueued) {
    const page = await database.query<ReplayRow>(
      `SELECT
         queue.sequence,
         observation.sync_batch_id AS batch_id,
         raw.id AS raw_id,
         observation.id AS observation_id,
         observation.endpoint,
         observation.branch_id,
         observation.entity_type,
         observation.scope_key,
         raw.source_payload
       FROM arthello_alfa_rehydrate_queue AS queue
       JOIN alpha_raw_observations AS observation
         ON observation.id = queue.observation_id
       JOIN alpha_raw_records AS raw
         ON raw.id = observation.raw_record_id
       WHERE queue.sequence > $1
       ORDER BY queue.sequence
       LIMIT $2`,
      [processed, pageSize],
    );
    if (page.rows.length === 0) break;

    await database.exec("BEGIN");
    try {
      for (const row of page.rows) {
        const item = asRecord(row.source_payload) as JsonRecord | null;
        if (!item) {
          throw new Error("Stored AlfaCRM raw payload is not an object");
        }
        const options: ImportEntityOptions = {
          branchId: row.branch_id,
          endpoint: row.endpoint,
          recordType: row.entity_type,
          scopeKey: row.scope_key,
        };
        const context: NormalizationContext = {
          batchId: row.batch_id,
          rawId: row.raw_id,
          observationId: row.observation_id,
          scopeKey: row.scope_key,
        };
        if (await normalizeEntity(database, options, item, context)) {
          normalized += 1;
          normalizedByType[row.entity_type] += 1;
        }
      }
      await database.exec("COMMIT");
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
    processed = Number(page.rows.at(-1)?.sequence ?? processed);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: processed === totalQueued ? "completed" : "incomplete",
        migrationsApplied,
        queued: totalQueued,
        processed,
        normalized,
        normalizedByType,
        sourceWritesAttempted: false,
        personalDataPrinted: false,
      },
      null,
      2,
    )}\n`,
  );
  if (processed !== totalQueued) process.exitCode = 2;
} finally {
  await database.close();
}
