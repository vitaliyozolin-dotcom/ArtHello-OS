/**
 * AlphaCRM Coverage Audit API
 *
 * Endpoints:
 *   GET  /api/coverage/environment        — DB / env info
 *   GET  /api/coverage/registry           — endpoint registry
 *   GET  /api/coverage/batches            — sync batch history
 *   GET  /api/coverage/summary            — aggregate coverage stats
 *   GET  /api/coverage/field-inventory    — field inventory per entity type
 *   POST /api/coverage/discover           — run endpoint discovery
 *   POST /api/coverage/sync               — run raw sync (save full payloads)
 */

import { Router } from "express";
import { pool } from "@workspace/db";
import { authenticate, crmProbe } from "../../lib/alphaCrmClient.js";
import { createHash } from "crypto";
import { logger } from "../../lib/logger.js";

export const coverageRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function extractItems(json: unknown): unknown[] {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["items", "data", "result", "records", "list"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function extractTotal(json: unknown): number | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj["total"] === "number") return obj["total"];
  if (typeof obj["count"] === "number") return obj["count"];
  return null;
}

function extractFields(items: unknown[]): string[] {
  const fieldSet = new Set<string>();
  for (const item of items.slice(0, 20)) {
    if (item && typeof item === "object") {
      for (const k of Object.keys(item as Record<string, unknown>)) {
        fieldSet.add(k);
      }
    }
  }
  return Array.from(fieldSet).sort();
}

function extractAlphaId(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  const candidates = [
    "id",
    "alpha_id",
    "customer_id",
    "lesson_id",
    "pay_id",
    "group_id",
    "teacher_id",
  ];
  for (const key of candidates) {
    if (obj[key] !== undefined && obj[key] !== null) return String(obj[key]);
  }
  return null;
}

function computeStatus(
  httpStatus: number | null,
  itemCount: number | null,
  error: string | null,
): string {
  if (error) return "ERROR";
  if (!httpStatus) return "UNKNOWN";
  if (httpStatus === 401 || httpStatus === 403) return "FORBIDDEN";
  if (httpStatus === 404) return "NOT_FOUND";
  if (httpStatus === 405) return "NOT_EXPOSED";
  if (httpStatus >= 500) return "ERROR";
  if (httpStatus >= 200 && httpStatus < 300) {
    if (itemCount === null) return "UNKNOWN";
    if (itemCount === 0) return "EMPTY";
    return "OK";
  }
  return "UNKNOWN";
}

// ─── Candidate endpoint definitions ──────────────────────────────────────────

interface EndpointDef {
  entityKey: string;
  endpoint: string;
  method: "POST" | "GET";
  body?: Record<string, unknown>;
  notes?: string;
}

function buildCandidates(branchId: string): EndpointDef[] {
  const b = branchId;
  const base = (entity: string, extra: Record<string, unknown> = {}) => ({
    method: "POST" as const,
    body: { page: 0, count: 5, ...extra },
    endpoint: `${b}/${entity}/index`,
  });

  return [
    {
      entityKey: "branches",
      ...base("branch"),
      notes: "School branches/locations",
    },
    {
      entityKey: "students",
      ...base("customer"),
      notes: "Students / customers (is_study=1)",
    },
    {
      entityKey: "leads",
      ...base("lead"),
      notes: "Leads / prospects (is_study=0)",
    },
    {
      entityKey: "lessons",
      ...base("lesson"),
      notes: "Lessons — may contain visits[] attendance",
    },
    {
      entityKey: "regular_lessons",
      ...base("regular-lesson"),
      notes: "Recurring lesson schedule templates",
    },
    {
      entityKey: "payments",
      ...base("pay"),
      notes: "Payments / transactions from clients",
    },
    {
      entityKey: "subjects",
      ...base("subject"),
      notes: "Subjects / directions",
    },
    {
      entityKey: "teachers",
      ...base("teacher"),
      notes: "Teachers / instructors",
    },
    { entityKey: "groups", ...base("group"), notes: "Study groups" },
    {
      entityKey: "tariffs",
      ...base("tariff"),
      notes: "Tariff templates / subscription plans",
    },
    {
      entityKey: "customer_tariffs",
      ...base("customer-tariff"),
      notes: "Customer subscriptions / абонементы",
    },
    {
      entityKey: "communications",
      ...base("communication"),
      notes: "Notes / communications / comments",
    },
    { entityKey: "tasks", ...base("task"), notes: "Tasks / reminders" },
    { entityKey: "discounts", ...base("discount"), notes: "Discount records" },
    {
      entityKey: "absence_reasons",
      ...base("absence-reason"),
      notes: "Absence / skip reason codes",
    },
    {
      entityKey: "bonuses",
      ...base("bonus"),
      notes: "Bonus / loyalty records",
    },
    {
      entityKey: "study_statuses",
      ...base("study-status"),
      notes: "Study status codes (studying/paused/left)",
    },
    {
      entityKey: "cgi",
      ...base("cgi"),
      notes: "Customer-group index / enrollments",
    },
    {
      entityKey: "invoices",
      ...base("invoice"),
      notes: "Invoices / bills (if available)",
    },
    {
      entityKey: "contracts",
      ...base("contract"),
      notes: "Contracts / documents",
    },
    { entityKey: "rooms", ...base("room"), notes: "Rooms / classrooms" },
    {
      entityKey: "statuses",
      ...base("status"),
      notes: "Lead/customer status codes",
    },
    {
      entityKey: "tariff_movements",
      ...base("tariff-movement"),
      notes: "Subscription movements / burns / freezes",
    },
    {
      entityKey: "customer_notes",
      ...base("customer-note"),
      notes: "Customer notes",
    },
    {
      entityKey: "lesson_topics",
      ...base("lesson-topic"),
      notes: "Lesson topic / homework",
    },
    {
      entityKey: "sources",
      ...base("lead-source"),
      notes: "Lead source codes",
    },
    {
      entityKey: "directories",
      ...base("directory"),
      notes: "General directory entries",
    },
    {
      entityKey: "attendance",
      endpoint: `${b}/lesson/index`,
      method: "POST",
      body: { page: 0, count: 5 },
      notes:
        "Attendance extracted from lesson.visits[] — not a separate endpoint",
    },
  ];
}

// ─── GET /api/coverage/environment ───────────────────────────────────────────

coverageRouter.get("/coverage/environment", async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: dbInfo } = await client.query(
      `SELECT current_database() AS db_name, inet_server_addr() AS host, version() AS pg_version`,
    );
    const { rows: tableCounts } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM bank_accounts)      AS bank_accounts,
        (SELECT COUNT(*) FROM bank_transactions)  AS bank_transactions,
        (SELECT COUNT(*) FROM crm_students)       AS crm_students,
        (SELECT COUNT(*) FROM families)           AS families,
        (SELECT COUNT(*) FROM crm_lessons)        AS crm_lessons,
        (SELECT COUNT(*) FROM crm_payments)       AS crm_payments,
        (SELECT COUNT(*) FROM alpha_raw_records)  AS alpha_raw_records
    `);

    const dbName = dbInfo[0]?.db_name ?? "unknown";
    const isProduction =
      process.env.NODE_ENV === "production" || dbName.includes("prod");

    res.json({
      environment: process.env.NODE_ENV ?? "development",
      database: dbName,
      isProduction,
      pgVersion:
        (dbInfo[0]?.pg_version as string)?.split(" ").slice(0, 2).join(" ") ??
        "unknown",
      alfacrmDomain: process.env.ALFACRM_DOMAIN ?? null,
      tableCounts: tableCounts[0] ?? {},
      warning:
        "Bank data exists (accounts, balances, statements, transactions) but most transactions are NOT yet matched/classified/reconciled. AlphaCRM sync results are source coverage data only — NOT final financial truth.",
    });
  } catch (err) {
    req.log.error({ err }, "coverage: environment failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/coverage/registry ──────────────────────────────────────────────

coverageRouter.get("/coverage/registry", async (req, res) => {
  const client = await pool.connect();
  try {
    const { branchId } = req.query as Record<string, string>;
    const where = branchId ? `WHERE branch_id = $1` : "";
    const params = branchId ? [branchId] : [];
    const { rows } = await client.query(
      `SELECT * FROM alpha_endpoint_registry ${where} ORDER BY entity_key, branch_id`,
      params,
    );
    res.json({ registry: rows });
  } catch (err) {
    req.log.error({ err }, "coverage: registry failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/coverage/batches ───────────────────────────────────────────────

coverageRouter.get("/coverage/batches", async (req, res) => {
  const client = await pool.connect();
  try {
    const limit = Math.min(
      Number((req.query as Record<string, string>).limit ?? "20"),
      100,
    );
    const { rows } = await client.query(
      `SELECT * FROM alpha_sync_batches ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    res.json({ batches: rows });
  } catch (err) {
    req.log.error({ err }, "coverage: batches failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/coverage/summary ───────────────────────────────────────────────

coverageRouter.get("/coverage/summary", async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: byEntity } = await client.query(`
      SELECT
        entity_type,
        COUNT(*)                                               AS total_raw,
        COUNT(DISTINCT branch_id)                             AS branches,
        MIN(synced_at)                                        AS first_synced,
        MAX(synced_at)                                        AS last_synced,
        COUNT(*) FILTER (WHERE sync_status = 'normalized')    AS normalized,
        COUNT(*) FILTER (WHERE alpha_id IS NULL)              AS missing_id
      FROM alpha_raw_records
      GROUP BY entity_type
      ORDER BY entity_type
    `);

    const { rows: regStats } = await client.query(`
      SELECT
        status,
        COUNT(*) AS cnt
      FROM alpha_endpoint_registry
      GROUP BY status
    `);

    const { rows: issueStats } = await client.query(`
      SELECT
        severity,
        COUNT(*) AS cnt
      FROM alpha_linking_issues
      WHERE resolved_at IS NULL
      GROUP BY severity
    `);

    const { rows: lastBatch } = await client.query(
      `SELECT * FROM alpha_sync_batches ORDER BY started_at DESC LIMIT 1`,
    );

    res.json({
      byEntity,
      registryStatusCounts: regStats,
      openIssueCounts: issueStats,
      lastBatch: lastBatch[0] ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "coverage: summary failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/coverage/field-inventory ───────────────────────────────────────

coverageRouter.get("/coverage/field-inventory", async (req, res) => {
  const client = await pool.connect();
  try {
    const { entityType } = req.query as Record<string, string>;
    const limit = Math.min(
      Number((req.query as Record<string, string>).limit ?? "500"),
      2000,
    );

    const where = entityType ? `WHERE entity_type = $1` : "";
    const params = entityType ? [entityType] : [];
    const { rows: rawRows } = await client.query(
      `SELECT entity_type, source_payload FROM alpha_raw_records ${where} LIMIT $${params.length + 1}`,
      [...params, limit],
    );

    // Build field inventory per entity_type
    const inventory: Record<
      string,
      Record<string, { count: number; nullCount: number; samples: unknown[] }>
    > = {};

    for (const row of rawRows) {
      const et = row.entity_type as string;
      const payload = row.source_payload as Record<string, unknown>;
      if (!inventory[et]) inventory[et] = {};
      for (const [k, v] of Object.entries(payload)) {
        if (!inventory[et][k])
          inventory[et][k] = { count: 0, nullCount: 0, samples: [] };
        inventory[et][k].count++;
        if (v === null || v === undefined || v === "") {
          inventory[et][k].nullCount++;
        } else if (inventory[et][k].samples.length < 3) {
          inventory[et][k].samples.push(v);
        }
      }
    }

    const result: Record<string, unknown[]> = {};
    for (const [et, fields] of Object.entries(inventory)) {
      result[et] = Object.entries(fields)
        .map(([fieldName, stats]) => ({
          fieldName,
          appearedInRecordsCount: stats.count,
          emptyCount: stats.nullCount,
          sampleValues: stats.samples,
        }))
        .sort((a, b) => b.appearedInRecordsCount - a.appearedInRecordsCount);
    }

    res.json({ fieldInventory: result, totalRecordsAnalyzed: rawRows.length });
  } catch (err) {
    req.log.error({ err }, "coverage: field-inventory failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/coverage/issues ────────────────────────────────────────────────

coverageRouter.get("/coverage/issues", async (req, res) => {
  const client = await pool.connect();
  try {
    const { entityType, severity } = req.query as Record<string, string>;
    const limit = Math.min(
      Number((req.query as Record<string, string>).limit ?? "100"),
      500,
    );
    const conditions: string[] = ["resolved_at IS NULL"];
    const params: unknown[] = [];
    let idx = 1;
    if (entityType) {
      conditions.push(`entity_type = $${idx++}`);
      params.push(entityType);
    }
    if (severity) {
      conditions.push(`severity = $${idx++}`);
      params.push(severity);
    }
    params.push(limit);
    const { rows } = await client.query(
      `SELECT * FROM alpha_linking_issues WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    res.json({ issues: rows });
  } catch (err) {
    req.log.error({ err }, "coverage: issues failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/coverage/raw ───────────────────────────────────────────────────

coverageRouter.get("/coverage/raw", async (req, res) => {
  const client = await pool.connect();
  try {
    const { entityType, branchId, alphaId } = req.query as Record<
      string,
      string
    >;
    const limit = Math.min(
      Number((req.query as Record<string, string>).limit ?? "50"),
      200,
    );
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (entityType) {
      conditions.push(`entity_type = $${idx++}`);
      params.push(entityType);
    }
    if (branchId) {
      conditions.push(`branch_id = $${idx++}`);
      params.push(branchId);
    }
    if (alphaId) {
      conditions.push(`alpha_id = $${idx++}`);
      params.push(alphaId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await client.query(
      `SELECT id, alpha_id, entity_type, endpoint, branch_id, payload_hash, synced_at, sync_status, page,
              source_payload
       FROM alpha_raw_records ${where} ORDER BY synced_at DESC LIMIT $${idx}`,
      params,
    );
    res.json({ records: rows });
  } catch (err) {
    req.log.error({ err }, "coverage: raw records failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── POST /api/coverage/discover ─────────────────────────────────────────────
//
// Probes each candidate endpoint with page 0, count 5.
// Writes results to alpha_endpoint_registry.
// Creates an alpha_sync_batch of mode='discovery'.

coverageRouter.post("/coverage/discover", async (req, res) => {
  const {
    branchId: rawBranchId,
    fromDate,
    toDate,
  } = req.body as Record<string, string>;
  const client = await pool.connect();

  // Use active scope branchId if not explicitly provided — default is Atlas (6)
  const branchId =
    rawBranchId ??
    (await getActiveScopeBranchId(client as unknown as DbClient));

  // Create batch
  const { rows: batchRows } = await client.query(
    `INSERT INTO alpha_sync_batches (mode, branch_id, from_date, to_date, triggered_by, status)
     VALUES ('discovery', $1, $2, $3, 'manual', 'running') RETURNING id`,
    [branchId, fromDate ?? null, toDate ?? null],
  );
  const batchId = batchRows[0].id as string;
  client.release();

  // Respond immediately — discovery runs async in background
  res.json({
    batchId,
    status: "started",
    branchId,
    message: `Discovery started for branch ${branchId}`,
  });

  // ── Background discovery ─────────────────────────────────────────────────
  (async () => {
    const bgClient = (await pool.connect()) as unknown as DbClient;
    const candidates = buildCandidates(branchId);
    let checked = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: unknown[] = [];

    try {
      const token = await authenticate();

      for (const def of candidates) {
        try {
          // Skip attendance — it's embedded in lessons
          if (def.entityKey === "attendance") {
            await bgClient.query(
              `INSERT INTO alpha_endpoint_registry
                 (entity_key, endpoint, branch_id, method, request_body, status, notes, last_checked_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'EMBEDDED', $6, NOW(), NOW())
               ON CONFLICT (entity_key, branch_id) DO UPDATE SET
                 status = 'EMBEDDED', notes = EXCLUDED.notes, last_checked_at = NOW(), updated_at = NOW()`,
              [
                def.entityKey,
                def.endpoint,
                branchId,
                def.method,
                JSON.stringify(def.body ?? {}),
                def.notes ?? null,
              ],
            );
            checked++;
            continue;
          }

          const probe = await crmProbe(
            def.endpoint,
            def.method,
            def.body,
            token,
          );
          const items = extractItems(probe.parsedJson);
          const total = extractTotal(probe.parsedJson);
          const fields = extractFields(items);
          const status = computeStatus(probe.status, items.length, probe.error);

          if (status === "OK" || status === "EMPTY") succeeded++;
          else {
            failed++;
            if (probe.error)
              errors.push({ entityKey: def.entityKey, error: probe.error });
          }

          const nextAction =
            status === "NOT_FOUND"
              ? "Endpoint does not exist in this AlphaCRM version"
              : status === "FORBIDDEN"
                ? "Access denied — check API key permissions"
                : status === "NOT_EXPOSED"
                  ? "Endpoint not exposed via API — may need to request from AlphaCRM support"
                  : status === "EMPTY"
                    ? "Endpoint exists but returned 0 records — may be correct or need date filter"
                    : status === "ERROR"
                      ? "Check error message and retry"
                      : status === "OK"
                        ? "Ready for raw sync"
                        : "Investigate";

          await bgClient.query(
            `INSERT INTO alpha_endpoint_registry
               (entity_key, endpoint, branch_id, method, request_body, status, http_status,
                records_fetched, response_sample, discovered_fields, error_message,
                last_checked_at, next_action, notes, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12, $13, NOW())
             ON CONFLICT (entity_key, branch_id) DO UPDATE SET
               endpoint = EXCLUDED.endpoint,
               method = EXCLUDED.method,
               request_body = EXCLUDED.request_body,
               status = EXCLUDED.status,
               http_status = EXCLUDED.http_status,
               records_fetched = EXCLUDED.records_fetched,
               response_sample = EXCLUDED.response_sample,
               discovered_fields = EXCLUDED.discovered_fields,
               error_message = EXCLUDED.error_message,
               last_checked_at = NOW(),
               next_action = EXCLUDED.next_action,
               notes = EXCLUDED.notes,
               updated_at = NOW()`,
            [
              def.entityKey,
              def.endpoint,
              branchId,
              def.method,
              JSON.stringify(def.body ?? {}),
              status,
              probe.status,
              total !== null ? total : items.length,
              items.length > 0 ? JSON.stringify(items.slice(0, 2)) : null,
              fields.length > 0 ? JSON.stringify(fields) : null,
              probe.error ?? null,
              nextAction,
              def.notes ?? null,
            ],
          );
          checked++;
          logger.info(
            { entityKey: def.entityKey, status, httpStatus: probe.status },
            "discovery: endpoint checked",
          );
        } catch (err) {
          failed++;
          errors.push({ entityKey: def.entityKey, error: String(err) });
          logger.error(
            { err, entityKey: def.entityKey },
            "discovery: endpoint probe failed",
          );
        }
      }

      // Update batch
      await bgClient.query(
        `UPDATE alpha_sync_batches SET
           status = 'completed', finished_at = NOW(),
           entities_succeeded = $2, entities_failed = $3,
           endpoints_checked = $4, total_errors = $5,
           errors = $6, duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
         WHERE id = $1`,
        [
          batchId,
          succeeded,
          failed,
          checked,
          errors.length,
          JSON.stringify(errors),
        ],
      );
    } catch (err) {
      logger.error({ err, batchId }, "discovery: batch failed");
      await bgClient
        .query(
          `UPDATE alpha_sync_batches SET status = 'failed', finished_at = NOW(), errors = $2 WHERE id = $1`,
          [batchId, JSON.stringify([String(err)])],
        )
        .catch(() => {});
    } finally {
      bgClient.release();
    }
  })().catch((err) => logger.error({ err }, "discovery: unhandled error"));
});

// ─── POST /api/coverage/sync ─────────────────────────────────────────────────
//
// Raw sync: fetch all pages of known-OK endpoints and save full JSON payloads
// to alpha_raw_records. Idempotent (upserts by alpha_id+entity_type+branch_id+hash).

coverageRouter.post("/coverage/sync", async (req, res) => {
  const {
    branchId: rawBranchId,
    fromDate = "2025-01-01",
    toDate,
    entityKeys,
  } = req.body as {
    branchId?: string;
    fromDate?: string;
    toDate?: string;
    entityKeys?: string[];
  };

  const effectiveTo = toDate ?? new Date().toISOString().slice(0, 10);
  const client = await pool.connect();

  // Resolve active scope — use scope branchId if none provided
  const { rows: scopeRows } = await client.query(
    `SELECT branch_id, branch_name FROM alpha_sync_scope WHERE is_active = true LIMIT 1`,
  );
  const scopeBranchId = (scopeRows[0]?.branch_id as string) ?? "6";
  const scopeBranchName = (scopeRows[0]?.branch_name as string) ?? "Атлас";
  const branchId = rawBranchId ?? scopeBranchId;
  const outOfScope = branchId !== scopeBranchId;

  if (outOfScope) {
    logger.warn(
      { branchId, scopeBranchId },
      "raw sync: requested branch is outside active scope",
    );
  }

  // Get the OK endpoints to sync
  const registryFilter = entityKeys?.length
    ? `WHERE branch_id = $1 AND entity_key = ANY($2) AND status IN ('OK','PARTIAL','EMPTY')`
    : `WHERE branch_id = $1 AND status IN ('OK','PARTIAL','EMPTY')`;
  const registryParams = entityKeys?.length
    ? [branchId, entityKeys]
    : [branchId];
  const { rows: toSync } = await client.query(
    `SELECT entity_key, endpoint, method FROM alpha_endpoint_registry ${registryFilter}`,
    registryParams,
  );

  if (toSync.length === 0) {
    client.release();
    res.status(400).json({
      error: "No OK endpoints found — run discovery first",
      hint: outOfScope
        ? `Branch ${branchId} is outside scope (${scopeBranchId}/${scopeBranchName}). Run discovery for the Atlas branch first.`
        : undefined,
    });
    return;
  }

  // Create sync batch
  const { rows: batchRows } = await client.query(
    `INSERT INTO alpha_sync_batches (mode, branch_id, from_date, to_date, triggered_by, status, entities_requested)
     VALUES ('raw_sync', $1, $2, $3, 'manual', 'running', $4) RETURNING id`,
    [branchId, fromDate, effectiveTo, toSync.length],
  );
  const batchId = batchRows[0].id as string;
  client.release();

  const outOfScopeWarning = outOfScope
    ? `⚠ Sync requested for branch ${branchId} which is OUTSIDE active scope (${scopeBranchId}/${scopeBranchName}). Data will NOT be normalized into families/children.`
    : undefined;

  res.json({
    batchId,
    status: "started",
    branchId,
    outOfScope,
    outOfScopeWarning,
    entitiesRequested: toSync.length,
    message:
      outOfScopeWarning ??
      `Raw sync started for Atlas branch (${branchId}/${scopeBranchName})`,
  });

  // ── Background raw sync ──────────────────────────────────────────────────
  (async () => {
    const bgClient = (await pool.connect()) as unknown as DbClient;
    let totalFetched = 0;
    let totalSaved = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: unknown[] = [];
    const PAGE_SIZE = 50; // AlphaCRM enforces max 50 records/page regardless of requested count
    const dateFilter = { date_from: fromDate, date_to: effectiveTo };

    try {
      const token = await authenticate();

      for (const ep of toSync) {
        const entityKey = ep.entity_key as string;
        const endpoint = ep.endpoint as string;

        if (entityKey === "attendance") continue; // extracted from lessons

        try {
          let page = 0;
          let entityFetched = 0;
          let entitySaved = 0;
          let lastPage = 0;

          const MAX_PAGES = 1500; // safety ceiling
          // Track alpha_ids of previous page to detect true pagination loops
          // (some AlphaCRM endpoints return the same full dataset on every page)
          let prevPageIds: Set<string> | null = null;

          while (page < MAX_PAGES) {
            const probe = await crmProbe(
              endpoint,
              "POST",
              { page, count: PAGE_SIZE, ...dateFilter },
              token,
            );

            if (!probe.status || probe.status >= 400) {
              errors.push({
                entityKey,
                page,
                error: probe.error ?? `HTTP ${probe.status}`,
              });
              totalErrors++;
              break;
            }

            const items = extractItems(probe.parsedJson);
            if (items.length === 0) break;

            // Build current page's alpha_id set for loop detection
            const currPageIds = new Set<string>(
              items
                .map(extractAlphaId)
                .filter((id): id is string => id !== null),
            );

            // True pagination loop: same alpha_ids as previous page
            // (e.g. AlphaCRM discounts endpoint ignores page param and returns all records every call)
            if (
              prevPageIds !== null &&
              prevPageIds.size === currPageIds.size &&
              [...currPageIds].every((id) => prevPageIds!.has(id))
            ) {
              logger.warn(
                { entityKey, page, items: items.length },
                "raw sync: same alpha_ids as previous page — pagination loop detected, stopping",
              );
              break;
            }
            prevPageIds = currPageIds;

            entityFetched += items.length;
            totalFetched += items.length;
            lastPage = page;

            // Upsert each item
            for (const item of items) {
              try {
                const alphaId = extractAlphaId(item);
                const payload = JSON.stringify(item);
                const hash = md5(payload);

                const { rows: upsertRows } = await bgClient.query(
                  `INSERT INTO alpha_raw_records
                     (alpha_id, entity_type, endpoint, branch_id, source_payload, payload_hash,
                      sync_batch_id, page, period_from, period_to, synced_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
                   ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash) DO UPDATE SET
                     synced_at = NOW(), updated_at = NOW(), sync_batch_id = EXCLUDED.sync_batch_id
                   RETURNING (xmax = 0) AS is_insert`,
                  [
                    alphaId,
                    entityKey,
                    endpoint,
                    branchId,
                    JSON.stringify(item),
                    hash,
                    batchId,
                    page,
                    fromDate,
                    effectiveTo,
                  ],
                );

                const isInsert = upsertRows[0]?.is_insert === true;
                if (isInsert) {
                  entitySaved++;
                  totalSaved++;
                } else {
                  totalUpdated++;
                }
              } catch (rowErr) {
                totalErrors++;
                errors.push({
                  entityKey,
                  alphaId: extractAlphaId(item),
                  error: String(rowErr),
                });
              }
            }

            // Update registry with current page progress
            await bgClient.query(
              `UPDATE alpha_endpoint_registry SET
                 records_fetched = $2, pages_fetched = $3, last_successful_page = $4, updated_at = NOW()
               WHERE entity_key = $1 AND branch_id = $5`,
              [entityKey, entityFetched, page + 1, lastPage, branchId],
            );

            // Normal termination: fewer items than page size → this was the last page
            if (items.length < PAGE_SIZE) break;
            page++;
          }

          succeeded++;
          entitySaved > 0 &&
            logger.info(
              { entityKey, fetched: entityFetched, saved: entitySaved },
              "raw sync: entity done",
            );
        } catch (err) {
          failed++;
          totalErrors++;
          errors.push({ entityKey, error: String(err) });
          logger.error({ err, entityKey }, "raw sync: entity failed");
        }
      }

      // Run linking diagnostics after sync
      await runLinkingDiagnostics(bgClient, batchId, branchId);

      await bgClient.query(
        `UPDATE alpha_sync_batches SET
           status = 'completed', finished_at = NOW(),
           entities_succeeded = $2, entities_failed = $3,
           total_fetched = $4, total_saved = $5, total_updated = $6,
           total_skipped = $7, total_errors = $8, errors = $9,
           duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
         WHERE id = $1`,
        [
          batchId,
          succeeded,
          failed,
          totalFetched,
          totalSaved,
          totalUpdated,
          totalSkipped,
          totalErrors,
          JSON.stringify(errors),
        ],
      );
    } catch (err) {
      logger.error({ err, batchId }, "raw sync: batch failed");
      await bgClient
        .query(
          `UPDATE alpha_sync_batches SET status = 'failed', finished_at = NOW(), errors = $2 WHERE id = $1`,
          [batchId, JSON.stringify([String(err)])],
        )
        .catch(() => {});
    } finally {
      bgClient.release();
    }
  })().catch((err) => logger.error({ err }, "raw sync: unhandled error"));
});

// ─── GET /api/coverage/verification-report ────────────────────────────────────

coverageRouter.get("/coverage/verification-report", async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, status, from_date, to_date, report, started_at, finished_at
       FROM alpha_verification_reports
       ORDER BY started_at DESC LIMIT 1`,
    );
    if (rows.length === 0) {
      res.json({
        report: null,
        status: "not_run",
        reportId: null,
        startedAt: null,
        finishedAt: null,
      });
      return;
    }
    const row = rows[0];
    res.json({
      reportId: row.id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      report: row.report ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "coverage: verification-report failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── Scope helpers ────────────────────────────────────────────────────────────

async function getActiveScopeBranchId(client: DbClient): Promise<string> {
  try {
    const { rows } = await client.query(
      `SELECT branch_id FROM alpha_sync_scope WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`,
    );
    return (rows[0]?.branch_id as string) ?? "6";
  } catch {
    return "6"; // fallback: Atlas
  }
}

// ─── GET /api/coverage/scope ──────────────────────────────────────────────────

coverageRouter.get("/coverage/scope", async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: active } = await client.query(
      `SELECT * FROM alpha_sync_scope WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`,
    );
    const { rows: all } = await client.query(
      `SELECT * FROM alpha_sync_scope ORDER BY created_at ASC`,
    );

    // Known branches from last verification report
    const { rows: verRep } = await client.query(
      `SELECT report FROM alpha_verification_reports WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
    );
    type KnownBranch = { id: string; name: string };
    let knownBranches: KnownBranch[] = [];
    if (verRep.length > 0 && verRep[0].report) {
      const rep = verRep[0].report as Record<string, unknown>;
      const bc = rep.branchCoverage as Record<string, unknown> | undefined;
      if (bc && Array.isArray(bc.branches)) {
        knownBranches = bc.branches as KnownBranch[];
      }
    }

    const activeScopeId = (active[0]?.branch_id as string) ?? "6";
    const excludedBranches = knownBranches
      .filter((b) => b.id !== activeScopeId)
      .map((b) => ({
        branchId: b.id,
        branchName: b.name,
        reason: "Not in current Atlas-only scope",
      }));

    res.json({
      scope: active[0] ?? null,
      allScopes: all,
      excludedBranches,
      scopeWarning:
        "Current AlphaCRM audit scope is Atlas only. Other branches are discovered but excluded from current raw sync and normalization.",
    });
  } catch (err) {
    req.log.error({ err }, "coverage: scope GET failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── POST /api/coverage/scope ─────────────────────────────────────────────────

coverageRouter.post("/coverage/scope", async (req, res) => {
  const {
    branchId,
    branchName,
    scopeName = "Atlas only",
    reason,
    notes,
  } = req.body as {
    branchId: string;
    branchName: string;
    scopeName?: string;
    reason?: string;
    notes?: string;
  };

  if (!branchId || !branchName) {
    res.status(400).json({ error: "branchId and branchName are required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE alpha_sync_scope SET is_active = false, updated_at = NOW()`,
    );
    const { rows } = await client.query(
      `INSERT INTO alpha_sync_scope (scope_name, branch_id, branch_name, is_active, reason, notes, created_by, updated_at)
       VALUES ($1, $2, $3, true, $4, $5, 'user', NOW())
       ON CONFLICT (scope_name) DO UPDATE SET
         branch_id   = EXCLUDED.branch_id,
         branch_name = EXCLUDED.branch_name,
         is_active   = true,
         reason      = EXCLUDED.reason,
         notes       = EXCLUDED.notes,
         updated_at  = NOW()
       RETURNING *`,
      [scopeName, branchId, branchName, reason ?? null, notes ?? null],
    );
    req.log.info(
      { branchId, branchName, scopeName },
      "coverage: scope updated",
    );
    res.json({
      scope: rows[0],
      message: `Scope set to "${scopeName}" (branch ${branchId} — ${branchName})`,
    });
  } catch (err) {
    req.log.error({ err }, "coverage: scope POST failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/coverage/branches ──────────────────────────────────────────────

coverageRouter.get("/coverage/branches", async (req, res) => {
  const client = (await pool.connect()) as unknown as DbClient;
  try {
    const activeBranchId = await getActiveScopeBranchId(client);

    // Per-entity counts from raw records per branch
    const { rows: branchCounts } = await client.query(`
      SELECT
        branch_id,
        COUNT(*) FILTER (WHERE entity_type = 'students')        AS student_raw_count,
        COUNT(*) FILTER (WHERE entity_type = 'lessons')         AS lesson_raw_count,
        COUNT(*) FILTER (WHERE entity_type = 'payments')        AS payment_raw_count,
        COUNT(*) FILTER (WHERE entity_type = 'groups')          AS group_raw_count,
        COUNT(*) FILTER (WHERE entity_type = 'subjects')        AS subject_raw_count,
        COUNT(*) FILTER (WHERE entity_type = 'teachers')        AS teacher_raw_count,
        COUNT(*)                                                 AS total_raw,
        MIN(synced_at)                                           AS first_synced,
        MAX(synced_at)                                           AS last_synced
      FROM alpha_raw_records
      GROUP BY branch_id
    `);

    // Known branches from last verification report
    const { rows: verRep } = await client.query(
      `SELECT report FROM alpha_verification_reports WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
    );
    type KnownBranch = { id: string; name: string };
    let knownBranches: KnownBranch[] = [];
    if (verRep.length > 0 && verRep[0].report) {
      const rep = verRep[0].report as Record<string, unknown>;
      const bc = rep.branchCoverage as Record<string, unknown> | undefined;
      if (bc && Array.isArray(bc.branches)) {
        knownBranches = bc.branches as KnownBranch[];
      }
    }

    const branchCountMap = new Map(
      branchCounts.map((r) => [r.branch_id as string, r]),
    );
    const allIds = new Set([
      ...knownBranches.map((b) => b.id),
      ...branchCounts.map((r) => r.branch_id as string),
    ]);

    const SUSPECTED: Record<string, { meaning: string; use: string }> = {
      "1": { meaning: "Онлайн школа (основная, старая)", use: "EXCLUDE_NOW" },
      "2": { meaning: "Лиственная — физическая локация", use: "EXCLUDE_NOW" },
      "3": { meaning: "Остров — физическая локация", use: "EXCLUDE_NOW" },
      "4": { meaning: "Лыжный — сезонный/временный", use: "EXCLUDE_NOW" },
      "5": {
        meaning: "Онлайн Школа (дубль/новая) — LOW VOLUME",
        use: "EXCLUDE_NOW",
      },
      "6": {
        meaning: "Главный физический центр АртХелло (Атлас)",
        use: "CURRENT_SCOPE",
      },
      "7": { meaning: "Кемпинг — сезонный/временный", use: "EXCLUDE_NOW" },
      "8": {
        meaning: "Школа 1-11 — отдельная программа, нет оплат",
        use: "UNKNOWN_REVIEW_REQUIRED",
      },
    };

    const branches = Array.from(allIds)
      .map((bid) => {
        const known = knownBranches.find((b) => b.id === bid);
        const counts = branchCountMap.get(bid);
        const guess = SUSPECTED[bid];
        const name =
          known?.name ?? guess?.meaning?.split(" — ")[0] ?? `Branch ${bid}`;
        return {
          branchId: bid,
          branchName: name,
          isActiveScope: bid === activeBranchId,
          recommendedUse: guess?.use ?? "UNKNOWN_REVIEW_REQUIRED",
          suspectedMeaning:
            guess?.meaning ?? "Неизвестное назначение — требует проверки",
          notYetSynced: !branchCountMap.has(bid),
          rawCounts: counts
            ? {
                students: Number(counts.student_raw_count ?? 0),
                lessons: Number(counts.lesson_raw_count ?? 0),
                payments: Number(counts.payment_raw_count ?? 0),
                groups: Number(counts.group_raw_count ?? 0),
                subjects: Number(counts.subject_raw_count ?? 0),
                teachers: Number(counts.teacher_raw_count ?? 0),
                total: Number(counts.total_raw ?? 0),
                firstSynced: counts.first_synced,
                lastSynced: counts.last_synced,
              }
            : null,
        };
      })
      .sort((a, b) => {
        if (a.isActiveScope) return -1;
        if (b.isActiveScope) return 1;
        return Number(a.branchId) - Number(b.branchId);
      });

    const atlasBranch = branches.find(
      (b) => b.recommendedUse === "CURRENT_SCOPE",
    );
    const atlasIdentification = atlasBranch
      ? {
          atlasBranchId: atlasBranch.branchId,
          atlasBranchName: atlasBranch.branchName,
          confidence: "high",
          reason: `Branch name contains 'Атлас'. Confirmed in P6.1 verification run. branchId=${atlasBranch.branchId} is the main physical АртХелло location.`,
          isActiveScope: atlasBranch.isActiveScope,
        }
      : null;

    res.json({
      activeBranchId,
      branches,
      atlasIdentification,
      excludedBranches: branches.filter((b) => !b.isActiveScope),
      scopeNote: `Current sync scope is Atlas only (branchId=${activeBranchId}). All other branches are discovered but excluded from raw sync and normalization.`,
    });
  } catch (err) {
    req.log.error({ err }, "coverage: branches failed");
    res.status(500).json({ error: "internal" });
  } finally {
    (client as unknown as { release(): void }).release();
  }
});

// ─── GET /api/coverage/atlas-summary ─────────────────────────────────────────
//
// P6.3: Comprehensive Atlas-only readiness summary.
// Includes scope verification, raw counts, lesson/payment/subject analysis,
// customer-tariff status, endpoint status grid, and bigAlphaAuditReadiness.

coverageRouter.get("/coverage/atlas-summary", async (req, res) => {
  const client = (await pool.connect()) as unknown as DbClient;
  try {
    // ── 1. Scope ──────────────────────────────────────────────────────────────
    const { rows: scopeRows } = await client.query(
      `SELECT * FROM alpha_sync_scope WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`,
    );
    const scope = scopeRows[0] ?? null;
    const branchId = (scope?.branch_id as string) ?? "6";
    const branchName = (scope?.branch_name as string) ?? "Атлас";
    const scopeIsAtlas = branchId === "6";

    // ── 2. DB / env ───────────────────────────────────────────────────────────
    const { rows: dbInfo } = await client.query(
      `SELECT current_database() AS db_name, inet_server_addr() AS host`,
    );
    const dbName = (dbInfo[0]?.db_name as string) ?? "unknown";
    const dbHostRaw = String(dbInfo[0]?.host ?? "");
    const dbHostMasked =
      dbHostRaw.length > 3 ? dbHostRaw.substring(0, 3) + "***" : "***";
    const isProduction =
      process.env.NODE_ENV === "production" ||
      dbName.toLowerCase().includes("prod");

    // ── 3. Entity counts from raw records ─────────────────────────────────────
    const { rows: entityCounts } = await client.query(
      `
      SELECT entity_type, COUNT(*) AS raw_count
      FROM alpha_raw_records WHERE branch_id = $1 GROUP BY entity_type
    `,
      [branchId],
    );
    const countMap: Record<string, number> = {};
    for (const row of entityCounts)
      countMap[row.entity_type as string] = Number(row.raw_count);

    // ── 4. Lesson dates ───────────────────────────────────────────────────────
    // AlphaCRM lesson date field is 'date' (not 'lesson_date')
    const { rows: lsnDates } = await client.query(
      `
      SELECT
        MIN(source_payload->>'date') AS earliest,
        MAX(source_payload->>'date') AS latest
      FROM alpha_raw_records WHERE branch_id = $1 AND entity_type = 'lessons'
    `,
      [branchId],
    );

    // ── 5. Payment dates ──────────────────────────────────────────────────────
    // AlphaCRM payment date field is 'document_date' (format: DD.MM.YYYY)
    const { rows: payDates } = await client.query(
      `
      SELECT
        MIN(source_payload->>'document_date') AS earliest,
        MAX(source_payload->>'document_date') AS latest
      FROM alpha_raw_records WHERE branch_id = $1 AND entity_type = 'payments'
    `,
      [branchId],
    );

    // ── 6. Lessons by month ───────────────────────────────────────────────────
    const { rows: lsnByMonth } = await client.query(
      `
      SELECT SUBSTRING(source_payload->>'date', 1, 7) AS month, COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE branch_id = $1 AND entity_type = 'lessons'
        AND source_payload->>'date' IS NOT NULL
        AND source_payload->>'date' != ''
      GROUP BY 1 ORDER BY 1
    `,
      [branchId],
    );

    // ── 7. Lessons: attendance + field presence ────────────────────────────────
    const { rows: lsnStats } = await client.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE source_payload->'visits' IS NOT NULL
            AND jsonb_typeof(source_payload->'visits') = 'array'
            AND jsonb_array_length(source_payload->'visits') > 0
        ) AS with_visits,
        COALESCE(SUM(
          CASE
            WHEN source_payload->'visits' IS NOT NULL
              AND jsonb_typeof(source_payload->'visits') = 'array'
            THEN jsonb_array_length(source_payload->'visits')
            ELSE 0
          END
        ), 0) AS total_visits,
        COUNT(*) FILTER (
          WHERE source_payload->>'subject_id' IS NOT NULL
            AND source_payload->>'subject_id' NOT IN ('0','','null')
        ) AS with_subject_id,
        COUNT(*) FILTER (
          WHERE source_payload->'group_ids' IS NOT NULL
            AND jsonb_typeof(source_payload->'group_ids') = 'array'
            AND jsonb_array_length(source_payload->'group_ids') > 0
        ) AS with_group_id,
        COUNT(*) FILTER (
          WHERE source_payload->'teacher_ids' IS NOT NULL
            AND jsonb_typeof(source_payload->'teacher_ids') = 'array'
            AND jsonb_array_length(source_payload->'teacher_ids') > 0
        ) AS with_teacher_id,
        COUNT(*) FILTER (WHERE source_payload->>'status' = '3') AS cancelled_count,
        COUNT(*) AS total_lessons
      FROM alpha_raw_records WHERE branch_id = $1 AND entity_type = 'lessons'
    `,
      [branchId],
    );
    const lsn = lsnStats[0] ?? {};

    // ── 8. Payments by month ──────────────────────────────────────────────────
    // document_date format: DD.MM.YYYY — extract YYYY-MM for grouping
    // Note: PostgreSQL POSIX regex requires [0-9] not \d
    const { rows: payByMonth } = await client.query(
      `
      SELECT
        CONCAT(
          SPLIT_PART(source_payload->>'document_date', '.', 3), '-',
          SPLIT_PART(source_payload->>'document_date', '.', 2)
        ) AS month,
        COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE branch_id = $1 AND entity_type = 'payments'
        AND source_payload->>'document_date' IS NOT NULL
        AND source_payload->>'document_date' != ''
        AND source_payload->>'document_date' ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'
      GROUP BY 1 ORDER BY 1
    `,
      [branchId],
    );

    // ── 9. Payments: field presence ───────────────────────────────────────────
    // Payment fields: income (amount), customer_id, document_date, pay_type_id
    const { rows: payStats } = await client.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE source_payload->>'customer_id' IS NOT NULL
            AND source_payload->>'customer_id' NOT IN ('','0','null')
        ) AS with_customer_id,
        COUNT(*) FILTER (
          WHERE source_payload->>'customer_id' IS NULL
            OR source_payload->>'customer_id' IN ('','0','null')
        ) AS without_customer_id,
        COUNT(*) FILTER (
          WHERE source_payload->>'income' IS NOT NULL
            AND source_payload->>'income' NOT IN ('0','','null')
        ) AS with_income,
        COALESCE(SUM(NULLIF(source_payload->>'income','')::numeric), 0) AS total_income,
        BOOL_OR(source_payload ? 'note')       AS has_note_field,
        BOOL_OR(source_payload ? 'ctt_id')     AS has_ctt_field,
        BOOL_OR(source_payload ? 'pay_type_id') AS has_pay_type_field,
        COUNT(*) AS total_payments
      FROM alpha_raw_records WHERE branch_id = $1 AND entity_type = 'payments'
    `,
      [branchId],
    );
    const pay = payStats[0] ?? {};

    // ── 10. Subject resolution ────────────────────────────────────────────────
    const { rows: subjectIdRows } = await client.query(
      `
      SELECT ARRAY(
        SELECT DISTINCT source_payload->>'id'
        FROM alpha_raw_records
        WHERE branch_id = $1 AND entity_type = 'subjects'
          AND source_payload->>'id' IS NOT NULL
          AND source_payload->>'id' != ''
      ) AS ids
    `,
      [branchId],
    );

    const { rows: lessonSubjectRefRows } = await client.query(
      `
      SELECT ARRAY(
        SELECT DISTINCT source_payload->>'subject_id'
        FROM alpha_raw_records
        WHERE branch_id = $1 AND entity_type = 'lessons'
          AND source_payload->>'subject_id' IS NOT NULL
          AND source_payload->>'subject_id' NOT IN ('0','','null')
      ) AS ids
    `,
      [branchId],
    );

    const subjectIdSet = new Set<string>(
      (subjectIdRows[0]?.ids as string[] | null) ?? [],
    );
    const lessonSubjectRefs = new Set<string>(
      ((lessonSubjectRefRows[0]?.ids as string[] | null) ?? []).filter(Boolean),
    );
    const resolvedSubjectIds = [...lessonSubjectRefs].filter((id) =>
      subjectIdSet.has(id),
    );
    const unresolvedSubjectIds = [...lessonSubjectRefs].filter(
      (id) => !subjectIdSet.has(id),
    );

    // ── 11. Customer-tariff / абонементы ─────────────────────────────────────
    const { rows: ctRows } = await client.query(
      `
      SELECT status, records_fetched, discovered_fields, error_message
      FROM alpha_endpoint_registry
      WHERE entity_key = 'customer_tariffs' AND branch_id = $1 LIMIT 1
    `,
      [branchId],
    );
    const ct = ctRows[0];
    const ctStatus = ct ? String(ct.status ?? "UNKNOWN") : "NOT_DISCOVERED";
    const ctFields: string[] = ct?.discovered_fields
      ? Array.isArray(ct.discovered_fields)
        ? (ct.discovered_fields as string[])
        : (JSON.parse(String(ct.discovered_fields)) as string[])
      : [];
    const ABONEMENT_FIELD_KEYS = [
      "remaining_count",
      "paid_count",
      "next_lesson_date",
      "freeze_date",
      "sold_count",
      "paid_till",
      "expiry_date",
      "lessons_left",
      "balance",
    ];
    const abonementFieldsFound = ctFields.filter((f) =>
      ABONEMENT_FIELD_KEYS.includes(f),
    );

    // ── 12. Endpoint status summary ───────────────────────────────────────────
    const { rows: epStats } = await client.query(
      `
      SELECT status, COUNT(*) AS cnt
      FROM alpha_endpoint_registry WHERE branch_id = $1 GROUP BY status
    `,
      [branchId],
    );
    const epStatMap: Record<string, number> = {};
    for (const r of epStats) epStatMap[r.status as string] = Number(r.cnt);

    const { rows: registryRows } = await client.query(
      `
      SELECT entity_key, status, records_fetched, discovered_fields
      FROM alpha_endpoint_registry WHERE branch_id = $1 ORDER BY entity_key
    `,
      [branchId],
    );

    // ── 13. Batches ───────────────────────────────────────────────────────────
    const { rows: lastDiscRows } = await client.query(
      `
      SELECT * FROM alpha_sync_batches
      WHERE branch_id = $1 AND mode = 'discovery'
      ORDER BY started_at DESC LIMIT 1
    `,
      [branchId],
    );

    const { rows: lastSyncRows } = await client.query(
      `
      SELECT * FROM alpha_sync_batches
      WHERE branch_id = $1 AND mode = 'raw_sync'
      ORDER BY started_at DESC LIMIT 1
    `,
      [branchId],
    );

    // ── 14. Verification report (P6.1) — date filter status ──────────────────
    const { rows: verRep } = await client.query(
      `SELECT report FROM alpha_verification_reports WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
    );
    const lastReport = verRep[0]?.report as Record<string, unknown> | undefined;
    const atlasBranchAudit = lastReport?.branchAudits
      ? (lastReport.branchAudits as Record<string, unknown>)[branchId]
      : null;

    const verLessons = atlasBranchAudit
      ? ((atlasBranchAudit as Record<string, unknown>).lessons as
          Record<string, unknown> | undefined)
      : undefined;
    const dateFilterStatus = verLessons?.dateFilterStatus
      ? String(verLessons.dateFilterStatus)
      : "UNKNOWN";

    // ── 15. Derived values ────────────────────────────────────────────────────
    const totalLessons = Number(lsn.total_lessons ?? 0);
    const totalPayments = Number(pay.total_payments ?? 0);
    const totalStudents = countMap["students"] ?? 0;
    const totalGroups = countMap["groups"] ?? 0;
    const totalVisits = Number(lsn.total_visits ?? 0);
    const lessonsWithVisits = Number(lsn.with_visits ?? 0);
    const totalRaw = Object.values(countMap).reduce((s, v) => s + v, 0);

    const discoveryDone =
      lastDiscRows.length > 0 && lastDiscRows[0].status === "completed";
    const syncDone =
      lastSyncRows.length > 0 && lastSyncRows[0].status === "completed";
    const hasStudents = totalStudents > 0;
    const hasLessons = totalLessons > 0;
    const hasPayments = totalPayments > 0;
    const hasGroups = totalGroups > 0;
    const hasSubjects = (countMap["subjects"] ?? 0) > 0;
    const hasRegistry = registryRows.length > 0;

    // Big Alpha Audit Readiness
    const blockers: string[] = [];
    const notes: string[] = [];

    if (!scopeIsAtlas || !scope)
      blockers.push("Active scope is not Atlas (branchId=6)");
    if (!discoveryDone)
      blockers.push("Atlas Discovery has not been run (or not completed)");
    if (!syncDone)
      blockers.push("Atlas Raw Sync has not been run (or not completed)");
    if (!hasStudents)
      blockers.push("No student records in alpha_raw_records for Atlas");
    if (!hasRegistry)
      blockers.push("Endpoint registry empty — run Discovery first");

    if (!hasLessons)
      notes.push(
        "No lesson records yet — lesson endpoint may be EMPTY or date filter issue",
      );
    if (!hasPayments) notes.push("No payment records yet");
    if (unresolvedSubjectIds.length > 0)
      notes.push(
        `${unresolvedSubjectIds.length} subject IDs referenced by lessons but not in subjects table`,
      );
    if (["PERIOD_FILTER_IGNORED", "IGNORED"].includes(dateFilterStatus))
      notes.push(
        "AlphaCRM ignores lesson date filter — full dataset fetched regardless of date range",
      );
    if (!isProduction)
      notes.push(
        `Running in ${process.env.NODE_ENV ?? "development"} environment (not production DB)`,
      );

    const readinessStatus: "READY" | "PARTIAL" | "NOT_READY" =
      blockers.length === 0 && hasStudents && hasLessons && hasPayments
        ? "READY"
        : blockers.length === 0 && hasStudents
          ? "PARTIAL"
          : "NOT_READY";

    // ── Response ──────────────────────────────────────────────────────────────
    res.json({
      // Scope verification
      atlasBranchId: branchId,
      atlasBranchName: branchName,
      scopeStatus: scope
        ? scope.is_active
          ? "ACTIVE"
          : "INACTIVE"
        : "NOT_CONFIGURED",
      scopeName: scope?.scope_name ?? null,
      scopeReason: scope?.reason ?? null,
      scopeIsAtlas,

      // Environment
      syncEnvironment: process.env.NODE_ENV ?? "development",
      isProduction,
      dbName,
      dbHostMasked,
      alphaCrmBaseUrl: process.env.ALFACRM_DOMAIN
        ? `https://${process.env.ALFACRM_DOMAIN}/v2api/`
        : null,

      // Raw counts (all entity types)
      rawCounts: {
        students: countMap["students"] ?? 0,
        leads: countMap["leads"] ?? 0,
        groups: countMap["groups"] ?? 0,
        lessons: countMap["lessons"] ?? 0,
        attendanceExtracted: totalVisits,
        subjects: countMap["subjects"] ?? 0,
        teachers: countMap["teachers"] ?? 0,
        payments: countMap["payments"] ?? 0,
        tariffs: countMap["tariffs"] ?? 0,
        customerTariffs: countMap["customer_tariffs"] ?? 0,
        discounts: countMap["discounts"] ?? 0,
        tasks: countMap["tasks"] ?? 0,
        communications: countMap["communications"] ?? 0,
        regularLessons: countMap["regular_lessons"] ?? 0,
        cgi: countMap["cgi"] ?? 0,
        total: totalRaw,
      },

      // Lesson summary
      lessonSummary: {
        count: totalLessons,
        earliest: lsnDates[0]?.earliest ?? null,
        latest: lsnDates[0]?.latest ?? null,
        byMonth: lsnByMonth.map((r) => ({
          month: String(r.month),
          count: Number(r.cnt),
        })),
        lessonsWithVisits,
        attendanceExtracted: totalVisits,
        avgVisitsPerLesson:
          lessonsWithVisits > 0
            ? Math.round((totalVisits / lessonsWithVisits) * 10) / 10
            : 0,
        withSubjectId: Number(lsn.with_subject_id ?? 0),
        withGroupId: Number(lsn.with_group_id ?? 0),
        withTeacherId: Number(lsn.with_teacher_id ?? 0),
        cancelledCount: Number(lsn.cancelled_count ?? 0),
        dateFilterStatus,
      },

      // Payment summary
      paymentSummary: {
        count: totalPayments,
        earliest: payDates[0]?.earliest ?? null,
        latest: payDates[0]?.latest ?? null,
        byMonth: payByMonth.map((r) => ({
          month: String(r.month),
          count: Number(r.cnt),
        })),
        withCustomerId: Number(pay.with_customer_id ?? 0),
        withoutCustomerId: Number(pay.without_customer_id ?? 0),
        withIncome: Number(pay.with_income ?? 0),
        totalIncome: Number(pay.total_income ?? 0),
        hasNoteField: Boolean(pay.has_note_field),
        hasCttField: Boolean(pay.has_ctt_field),
        hasPayTypeField: Boolean(pay.has_pay_type_field),
      },

      // Subject summary
      subjectSummary: {
        count: countMap["subjects"] ?? 0,
        referencedByLessons: lessonSubjectRefs.size,
        resolved: resolvedSubjectIds.length,
        unresolved: unresolvedSubjectIds.length,
        unresolvedIds: unresolvedSubjectIds.slice(0, 20),
      },

      // Customer-tariff / абонементы
      customerTariffSummary: {
        endpointStatus: ctStatus,
        count: countMap["customer_tariffs"] ?? 0,
        fieldsDiscovered: ctFields,
        abonementFieldsFound,
        hasAbonementData: abonementFieldsFound.length > 0,
        errorMessage: ct?.error_message ?? null,
      },

      // Endpoint status summary
      endpointStatusSummary: {
        ok: epStatMap["OK"] ?? 0,
        empty: epStatMap["EMPTY"] ?? 0,
        embedded: epStatMap["EMBEDDED"] ?? 0,
        notFound: epStatMap["NOT_FOUND"] ?? 0,
        unknown: epStatMap["UNKNOWN"] ?? 0,
        error: epStatMap["ERROR"] ?? 0,
        forbidden: epStatMap["FORBIDDEN"] ?? 0,
        total: registryRows.length,
      },

      endpointRegistry: registryRows.map((r) => ({
        entityKey: r.entity_key,
        status: r.status,
        recordsFetched: r.records_fetched,
      })),
      unresolvedEndpoints: registryRows
        .filter(
          (r) => !["OK", "EMPTY", "EMBEDDED"].includes(r.status as string),
        )
        .map((r) => ({ entityKey: r.entity_key, status: r.status })),

      // Batches
      lastDiscoveryBatch: lastDiscRows[0] ?? null,
      lastRawSyncBatch: lastSyncRows[0] ?? null,
      lastSyncBatch: lastSyncRows[0] ?? null, // compat

      // Verification audit from P6.1
      verificationAudit: atlasBranchAudit ?? null,

      // Big Alpha Audit Readiness
      bigAlphaAuditReadiness: {
        status: readinessStatus,
        blockers,
        notes,
        checklist: {
          scopeIsAtlas,
          discoveryCompleted: discoveryDone,
          syncCompleted: syncDone,
          hasStudents,
          hasLessons,
          hasGroups,
          hasSubjects,
          hasPayments,
          endpointRegistryPresent: hasRegistry,
        },
      },

      // Legacy compat fields
      lessonDates: {
        earliest: lsnDates[0]?.earliest ?? null,
        latest: lsnDates[0]?.latest ?? null,
      },
      paymentDates: {
        earliest: payDates[0]?.earliest ?? null,
        latest: payDates[0]?.latest ?? null,
      },
      dataReadyForBigAlphaAudit: readinessStatus === "READY",
    });
  } catch (err) {
    req.log.error({ err }, "coverage: atlas-summary failed");
    res.status(500).json({ error: "internal" });
  } finally {
    (client as unknown as { release(): void }).release();
  }
});

// ─── POST /api/coverage/verify ────────────────────────────────────────────────
//
// Async deep audit: detect branches, probe all key entities with/without date
// filters, check pagination completeness, flag suspicious volumes.

coverageRouter.post("/coverage/verify", async (req, res) => {
  const { fromDate = "2025-01-01", toDate } = req.body as {
    fromDate?: string;
    toDate?: string;
  };

  const effectiveTo = toDate ?? new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  const { rows } = await client.query(
    `INSERT INTO alpha_verification_reports (status, from_date, to_date)
     VALUES ('running', $1, $2) RETURNING id`,
    [fromDate, effectiveTo],
  );
  const reportId = rows[0].id as string;
  client.release();

  res.json({
    reportId,
    status: "started",
    message: "Deep verification audit started in background",
  });

  (async () => {
    const bgClient = (await pool.connect()) as unknown as DbClient;
    try {
      const token = await authenticate();
      const report = await runVerification(token, fromDate, effectiveTo);
      await bgClient.query(
        `UPDATE alpha_verification_reports
         SET status = 'completed', finished_at = NOW(), report = $2 WHERE id = $1`,
        [reportId, JSON.stringify(report)],
      );
      logger.info({ reportId }, "verify: completed");
    } catch (err) {
      logger.error({ err, reportId }, "verify: failed");
      await bgClient
        .query(
          `UPDATE alpha_verification_reports
         SET status = 'failed', finished_at = NOW(), report = $2 WHERE id = $1`,
          [reportId, JSON.stringify({ error: String(err) })],
        )
        .catch(() => {});
    } finally {
      bgClient.release();
    }
  })().catch((err) => logger.error({ err }, "verify: unhandled"));
});

// ─── runVerification ──────────────────────────────────────────────────────────

interface BranchInfo {
  id: string;
  name: string;
}

async function runVerification(
  token: string,
  fromDate: string,
  toDate: string,
): Promise<Record<string, unknown>> {
  const PAGE_SIZE = 100;
  const suspiciousFlags: string[] = [];
  const nextActions: string[] = [];

  // ── 1. Detect branches ────────────────────────────────────────────────────
  const branchProbe = await crmProbe(
    "0/branch/index",
    "POST",
    { page: 0, count: 100 },
    token,
  );
  const branchRaw = extractItems(branchProbe.parsedJson);
  let branches: BranchInfo[] = branchRaw.map((b) => {
    const obj = b as Record<string, unknown>;
    return { id: String(obj.id ?? "?"), name: String(obj.name ?? "?") };
  });
  if (branches.length === 0) {
    branches = [
      { id: "1", name: "Branch 1 (assumed — branch endpoint returned empty)" },
    ];
    suspiciousFlags.push("BRANCH_LIST_EMPTY — using assumed branchId=1");
    nextActions.push(
      "Verify AlphaCRM branch endpoint access; try different branch URL patterns",
    );
  }

  const branchAudits: Record<string, unknown> = {};

  for (const branch of branches) {
    const bid = branch.id;

    // ── Students / customers ───────────────────────────────────────────────
    const stdAll = await crmProbe(
      `${bid}/customer/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const stdItems = extractItems(stdAll.parsedJson);
    const stdTotal = extractTotal(stdAll.parsedJson);

    const stdActive = await crmProbe(
      `${bid}/customer/index`,
      "POST",
      { page: 0, count: PAGE_SIZE, is_study: 1 },
      token,
    );
    const stdActItems = extractItems(stdActive.parsedJson);
    const stdActTotal = extractTotal(stdActive.parsedJson);

    const stdLeads = await crmProbe(
      `${bid}/customer/index`,
      "POST",
      { page: 0, count: PAGE_SIZE, is_study: 0 },
      token,
    );
    const stdLdTotal = extractTotal(stdLeads.parsedJson);

    // Date filter check on students
    const stdWithDate = await crmProbe(
      `${bid}/customer/index`,
      "POST",
      { page: 0, count: PAGE_SIZE, date_from: fromDate, date_to: toDate },
      token,
    );
    const stdWithDateTotal = extractTotal(stdWithDate.parsedJson);
    const stdDateFilter =
      stdWithDateTotal !== null &&
      stdTotal !== null &&
      stdWithDateTotal < stdTotal
        ? "SUPPORTED"
        : "PERIOD_FILTER_IGNORED";

    // Students without phone
    const studentsNoPhone = stdActItems.filter((s) => {
      const o = s as Record<string, unknown>;
      return !o.phone && !o.phones && !o.mobile;
    }).length;

    const effStudentTotal = stdActTotal ?? stdActItems.length;
    if (effStudentTotal < 100) {
      suspiciousFlags.push(
        `[branch ${bid}] STUDENT_ACTIVE_COUNT=${effStudentTotal} SUSPICIOUS_LOW_VOLUME`,
      );
      nextActions.push(
        `[branch ${bid}] Verify is_study filter — check if students are archived or in a different branch`,
      );
    }

    // ── Lessons ───────────────────────────────────────────────────────────
    const lsnWith = await crmProbe(
      `${bid}/lesson/index`,
      "POST",
      { page: 0, count: PAGE_SIZE, date_from: fromDate, date_to: toDate },
      token,
    );
    const lsnWithItems = extractItems(lsnWith.parsedJson);
    const lsnWithTotal = extractTotal(lsnWith.parsedJson);

    const lsnWithout = await crmProbe(
      `${bid}/lesson/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const lsnWithoutTotal = extractTotal(lsnWithout.parsedJson);

    const lsnDateFilter =
      lsnWithTotal !== null &&
      lsnWithoutTotal !== null &&
      lsnWithTotal < lsnWithoutTotal
        ? "SUPPORTED"
        : lsnWithTotal === lsnWithoutTotal
          ? "PERIOD_FILTER_IGNORED"
          : "UNKNOWN";

    // Extract lesson dates
    const lsnDates = lsnWithItems
      .map((l) => {
        const o = l as Record<string, unknown>;
        return (o.lesson_date ?? o.date) as string | undefined;
      })
      .filter(Boolean)
      .sort() as string[];

    // Status breakdown
    const lsnStatusMap: Record<string, number> = {};
    for (const l of lsnWithItems) {
      const s = String((l as Record<string, unknown>).status ?? "unknown");
      lsnStatusMap[s] = (lsnStatusMap[s] ?? 0) + 1;
    }

    // Attendance embedded check
    const lsnWithAttendance = lsnWithItems.filter((l) => {
      const o = l as Record<string, unknown>;
      const v = o.visits ?? o.attendance ?? o.lesson_visits;
      return Array.isArray(v) && (v as unknown[]).length > 0;
    }).length;

    // Regular lessons
    const regLsn = await crmProbe(
      `${bid}/regular-lesson/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const regLsnTotal = extractTotal(regLsn.parsedJson);
    const regLsnStatus = computeStatus(
      regLsn.status,
      extractItems(regLsn.parsedJson).length,
      regLsn.error,
    );

    const effLessonTotal = lsnWithTotal ?? lsnWithItems.length;
    if (effLessonTotal < 200) {
      suspiciousFlags.push(
        `[branch ${bid}] LESSON_COUNT=${effLessonTotal} SUSPICIOUS_LOW_VOLUME (from ${fromDate} to ${toDate})`,
      );
      nextActions.push(
        `[branch ${bid}] If lesson date filter is IGNORED, try fetching without filter; check lesson statuses (cancelled/draft may be excluded)`,
      );
    }

    // Pagination completeness for lessons
    const lsnPagination =
      lsnWithTotal !== null
        ? lsnWithTotal <= PAGE_SIZE
          ? "COMPLETE (fits in 1 page)"
          : lsnWithItems.length < lsnWithTotal
            ? `INCOMPLETE — fetched ${lsnWithItems.length} of ${lsnWithTotal} total (need ${Math.ceil(lsnWithTotal / PAGE_SIZE)} pages)`
            : "COMPLETE"
        : "UNKNOWN (no total in response)";

    // ── Payments ───────────────────────────────────────────────────────────
    const payWith = await crmProbe(
      `${bid}/pay/index`,
      "POST",
      { page: 0, count: PAGE_SIZE, date_from: fromDate, date_to: toDate },
      token,
    );
    const payWithItems = extractItems(payWith.parsedJson);
    const payWithTotal = extractTotal(payWith.parsedJson);

    const payWithout = await crmProbe(
      `${bid}/pay/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const payWithoutTotal = extractTotal(payWithout.parsedJson);

    const payDateFilter =
      payWithTotal !== null &&
      payWithoutTotal !== null &&
      payWithTotal < payWithoutTotal
        ? "SUPPORTED"
        : payWithTotal === payWithoutTotal
          ? "PERIOD_FILTER_IGNORED"
          : "UNKNOWN";

    const payDates = payWithItems
      .map((p) => (p as Record<string, unknown>).date as string | undefined)
      .filter(Boolean)
      .sort() as string[];

    const payFields = extractFields(payWithItems);
    const payHasBalance = payFields.some(
      (f) => f.includes("balance") || f.includes("debt"),
    );
    const payHasInvoice = payFields.some(
      (f) => f.includes("invoice") || f.includes("bill"),
    );

    const effPayTotal = payWithTotal ?? payWithItems.length;
    if (effPayTotal < 50) {
      suspiciousFlags.push(
        `[branch ${bid}] PAYMENT_COUNT=${effPayTotal} SUSPICIOUS_LOW_VOLUME`,
      );
    }

    // ── Subjects ───────────────────────────────────────────────────────────
    const subj = await crmProbe(
      `${bid}/subject/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const subjItems = extractItems(subj.parsedJson);
    const subjTotal = extractTotal(subj.parsedJson);
    const subjStatus = computeStatus(subj.status, subjItems.length, subj.error);
    const subjectIds = subjItems.map((s) =>
      String((s as Record<string, unknown>).id ?? "?"),
    );
    const subjectNames: Record<string, string> = {};
    for (const s of subjItems) {
      const o = s as Record<string, unknown>;
      const id = String(o.id ?? "?");
      subjectNames[id] = String(o.name ?? o.title ?? "?");
    }

    // Check if lessons reference subject IDs not in subjects list
    const lsnSubjectRefs = new Set<string>();
    for (const l of lsnWithItems) {
      const sid = String((l as Record<string, unknown>).subject_id ?? "");
      if (sid && sid !== "0" && sid !== "null") lsnSubjectRefs.add(sid);
    }
    const unresolvedSubjectIds = Array.from(lsnSubjectRefs).filter(
      (id) => !subjectIds.includes(id),
    );
    if (unresolvedSubjectIds.length > 0) {
      suspiciousFlags.push(
        `[branch ${bid}] ${unresolvedSubjectIds.length} UNRESOLVED_SUBJECT_IDS in lesson sample`,
      );
    }

    // ── Groups ─────────────────────────────────────────────────────────────
    const grp = await crmProbe(
      `${bid}/group/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const grpItems = extractItems(grp.parsedJson);
    const grpTotal = extractTotal(grp.parsedJson);
    const grpStatus = computeStatus(grp.status, grpItems.length, grp.error);

    // ── Customer-Tariffs (subscriptions) ───────────────────────────────────
    const ct = await crmProbe(
      `${bid}/customer-tariff/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const ctItems = extractItems(ct.parsedJson);
    const ctTotal = extractTotal(ct.parsedJson);
    const ctStatus = computeStatus(ct.status, ctItems.length, ct.error);
    const ctFields = extractFields(ctItems);
    const ctHasRemaining = ctFields.some(
      (f) =>
        f.includes("remain") ||
        f.includes("lesson_count") ||
        f.includes("left") ||
        f.includes("paid_count"),
    );
    const ctHasExpiry = ctFields.some(
      (f) =>
        f.includes("expire") ||
        f.includes("end_date") ||
        f.includes("to_date") ||
        f.includes("finish"),
    );
    const ctHasFreeze = ctFields.some(
      (f) => f.includes("freeze") || f.includes("pause") || f.includes("stop"),
    );
    const ctHasBurned = ctFields.some(
      (f) => f.includes("burned") || f.includes("spent") || f.includes("used"),
    );

    if (
      ctStatus === "NOT_FOUND" ||
      ctStatus === "FORBIDDEN" ||
      ctStatus === "NOT_EXPOSED"
    ) {
      suspiciousFlags.push(
        `[branch ${bid}] SUBSCRIPTIONS_NOT_ACCESSIBLE (customer-tariff status=${ctStatus})`,
      );
      nextActions.push(
        `[branch ${bid}] Check AlphaCRM plan — subscriptions (абонементы) may not be exposed via API in current plan`,
      );
    }

    // ── Tariff-movements ───────────────────────────────────────────────────
    const tm = await crmProbe(
      `${bid}/tariff-movement/index`,
      "POST",
      { page: 0, count: PAGE_SIZE },
      token,
    );
    const tmItems = extractItems(tm.parsedJson);
    const tmTotal = extractTotal(tm.parsedJson);
    const tmStatus = computeStatus(tm.status, tmItems.length, tm.error);

    // ── Debt/balance from customer payload ─────────────────────────────────
    const custFields = extractFields(stdActItems);
    const custHasBalance = custFields.some(
      (f) =>
        f.includes("balance") ||
        f.includes("debt") ||
        f.includes("paid") ||
        f.includes("balance_contract"),
    );
    const custHasDebt = custFields.some(
      (f) =>
        f.includes("debt") || f.includes("arrear") || f.includes("overdue"),
    );

    // ── Student coverage stats ─────────────────────────────────────────────
    const studentsWithPhone = stdActItems.filter((s) => {
      const o = s as Record<string, unknown>;
      return o.phone || o.phones || o.mobile;
    }).length;
    const studentsNoGroup = stdActItems.filter((s) => {
      const o = s as Record<string, unknown>;
      return !o.groups && !o.group_ids && !o.branch_group_id;
    }).length;

    branchAudits[bid] = {
      branchId: bid,
      branchName: branch.name,
      students: {
        apiReportedTotal: stdTotal,
        apiReportedActive: stdActTotal,
        apiReportedLeads: stdLdTotal,
        fetchedActive: stdActItems.length,
        dateFilterSupported: stdDateFilter,
        studentsWithPhone,
        studentsNoPhone,
        studentsNoGroup,
        suspiciousLowVolume: effStudentTotal < 100,
        custHasBalance,
        custHasDebt,
        discoveredFields: extractFields(stdActItems),
      },
      lessons: {
        apiReportedTotalWithFilter: lsnWithTotal,
        apiReportedTotalWithoutFilter: lsnWithoutTotal,
        fetchedWithFilter: lsnWithItems.length,
        dateFilterSupported: lsnDateFilter,
        earliestDate: lsnDates[0] ?? null,
        latestDate: lsnDates[lsnDates.length - 1] ?? null,
        statusBreakdown: lsnStatusMap,
        lessonsWithAttendanceEmbedded: lsnWithAttendance,
        paginationStatus: lsnPagination,
        suspiciousLowVolume: effLessonTotal < 200,
        regularLessons: { status: regLsnStatus, apiReportedTotal: regLsnTotal },
      },
      payments: {
        apiReportedTotalWithFilter: payWithTotal,
        apiReportedTotalWithoutFilter: payWithoutTotal,
        fetchedWithFilter: payWithItems.length,
        dateFilterSupported: payDateFilter,
        earliestDate: payDates[0] ?? null,
        latestDate: payDates[payDates.length - 1] ?? null,
        hasBalanceField: payHasBalance,
        hasInvoiceField: payHasInvoice,
        suspiciousLowVolume: effPayTotal < 50,
      },
      subjects: {
        status: subjStatus,
        apiReportedTotal: subjTotal,
        fetched: subjItems.length,
        subjectIds,
        subjectNames,
        unresolvedSubjectIdsInLessonSample: unresolvedSubjectIds,
      },
      groups: {
        status: grpStatus,
        apiReportedTotal: grpTotal,
        fetched: grpItems.length,
      },
      subscriptions: {
        customerTariffs: {
          status: ctStatus,
          apiReportedTotal: ctTotal,
          fetched: ctItems.length,
          hasRemainingLessonsField: ctHasRemaining,
          hasExpiryDateField: ctHasExpiry,
          hasFreezeField: ctHasFreeze,
          hasBurnedField: ctHasBurned,
          discoveredFields: ctFields,
        },
        tariffMovements: {
          status: tmStatus,
          apiReportedTotal: tmTotal,
          fetched: tmItems.length,
        },
      },
    };
  }

  // ── Final report ──────────────────────────────────────────────────────────
  if (nextActions.length === 0) {
    nextActions.push(
      "Run POST /coverage/sync to fetch all pages and save to alpha_raw_records",
    );
    nextActions.push(
      "Run POST /coverage/discover to re-probe all 28 endpoint candidates after verification",
    );
  }

  const overallStatus =
    suspiciousFlags.length > 3
      ? "suspicious"
      : suspiciousFlags.length > 0
        ? "warning"
        : "clean";

  return {
    generatedAt: new Date().toISOString(),
    requestedFromDate: fromDate,
    requestedToDate: toDate,
    environment: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      isProduction: process.env.NODE_ENV === "production",
      alfacrmDomain: process.env.ALFACRM_DOMAIN ?? null,
      credentialsSource:
        "environment secrets (ALFACRM_EMAIL + ALFACRM_API_KEY)",
      warningNotProduction:
        process.env.NODE_ENV !== "production"
          ? "⚠ This audit is NOT running against production data. NODE_ENV=" +
            (process.env.NODE_ENV ?? "development")
          : null,
    },
    branchCoverage: {
      branchesDetected: branches.length,
      branches,
      branchesAudited: Object.keys(branchAudits).length,
      multibranchNote:
        branches.length > 1
          ? `Multiple branches detected — audit run per branch separately`
          : `Single branch detected — auditing branch ${branches[0]?.id}`,
    },
    branchAudits,
    suspiciousFlags,
    nextActions,
    overallStatus,
  };
}

// ─── Linking diagnostics ──────────────────────────────────────────────────────

interface DbClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}

async function runLinkingDiagnostics(
  client: DbClient,
  batchId: string,
  branchId: string,
) {
  try {
    // Check payments without customer reference
    const { rows: paymentIssues } = await client.query(
      `
      SELECT alpha_id, source_payload
      FROM alpha_raw_records
      WHERE entity_type = 'payments' AND branch_id = $1
        AND (source_payload->>'customer_id' IS NULL OR source_payload->>'customer_id' = '')
      LIMIT 500
    `,
      [branchId],
    );

    for (const row of paymentIssues) {
      await client
        .query(
          `INSERT INTO alpha_linking_issues
           (sync_batch_id, entity_type, alpha_id, issue_type, issue_message,
            missing_reference_type, severity, suggested_action, created_at)
         VALUES ($1, 'payments', $2, 'payment_unlinked_missing_customer_id',
                 'Payment has no customer_id — cannot link to student or family',
                 'customer', 'warning',
                 'Inspect payment raw payload; check if customerId is in alternate field', NOW())
         ON CONFLICT DO NOTHING`,
          [batchId, row.alpha_id],
        )
        .catch(() => {});
    }

    // Check lessons without subject reference
    const { rows: lessonSubjectIssues } = await client.query(
      `
      SELECT alpha_id, source_payload
      FROM alpha_raw_records
      WHERE entity_type = 'lessons' AND branch_id = $1
        AND (source_payload->>'subject_id' IS NULL OR source_payload->>'subject_id' = '0' OR source_payload->>'subject_id' = '')
      LIMIT 500
    `,
      [branchId],
    );

    for (const row of lessonSubjectIssues) {
      await client
        .query(
          `INSERT INTO alpha_linking_issues
           (sync_batch_id, entity_type, alpha_id, issue_type, issue_message,
            missing_reference_type, severity, suggested_action, created_at)
         VALUES ($1, 'lessons', $2, 'lesson_unlinked_subject_not_found',
                 'Lesson has no subject_id — direction/subject cannot be resolved',
                 'subject', 'info',
                 'Cross-reference with group raw payload for subject name', NOW())
         ON CONFLICT DO NOTHING`,
          [batchId, row.alpha_id],
        )
        .catch(() => {});
    }

    logger.info({ batchId }, "Linking diagnostics complete");
  } catch (err) {
    logger.error({ err, batchId }, "Linking diagnostics failed");
  }
}
