import { Router } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const companyOsRouter = Router();

type SafeQueryResult = {
  ok: boolean;
  rows: Array<Record<string, unknown>>;
  error?: string;
};

async function safeQuery(name: string, query: string): Promise<SafeQueryResult> {
  try {
    const result = await pool.query(query);
    return { ok: true, rows: result.rows as Array<Record<string, unknown>> };
  } catch (err) {
    logger.warn({ err, source: name }, "Company OS real-data source unavailable");
    return { ok: false, rows: [], error: "source-unavailable" };
  }
}

companyOsRouter.get("/company-os/data-health", async (_req, res) => {
  const [students, payments, leads, banking, connectors] = await Promise.all([
    safeQuery(
      "crm-students",
      `SELECT count(*)::int AS records, max(synced_at) AS fresh_at
       FROM crm_students WHERE record_state = 'current'`,
    ),
    safeQuery(
      "crm-payments",
      `SELECT count(*)::int AS records, max(synced_at) AS fresh_at
       FROM crm_payments WHERE record_state = 'current'`,
    ),
    safeQuery(
      "lead-events",
      `SELECT count(*)::int AS records, max(COALESCE(event_time, created_at)) AS fresh_at
       FROM lead_events`,
    ),
    safeQuery(
      "bank-transactions",
      `SELECT count(*)::int AS records, max(synced_at) AS fresh_at
       FROM bank_transactions_raw`,
    ),
    safeQuery(
      "bank-connectors",
      `SELECT bank_name, connector_status, last_success_at, last_error
       FROM bank_connectors ORDER BY bank_name`,
    ),
  ]);

  res.json({
    generatedAt: new Date().toISOString(),
    mode: "read-only-real-data",
    sources: {
      students,
      payments,
      leads,
      banking,
      connectors,
    },
  });
});

companyOsRouter.get("/company-os/revenue-leakage", async (_req, res) => {
  const [unmatchedLeads, spareCapacity, summary] = await Promise.all([
    safeQuery(
      "unmatched-leads",
      `SELECT
         COALESCE(branch_name, 'unknown') AS branch,
         COALESCE(channel, 'unknown') AS channel,
         count(*)::int AS leads
       FROM lead_events
       WHERE duplicate_candidate IS DISTINCT FROM TRUE
         AND matched_student_crm_id IS NULL
         AND COALESCE(event_time, created_at) >= now() - interval '90 days'
       GROUP BY COALESCE(branch_name, 'unknown'), COALESCE(channel, 'unknown')
       ORDER BY count(*) DESC
       LIMIT 100`,
    ),
    safeQuery(
      "spare-capacity",
      `WITH active_enrollments AS (
         SELECT class_group_id, count(*)::int AS students
         FROM enrollments
         WHERE status = 'active'
         GROUP BY class_group_id
       )
       SELECT
         cg.id,
         cg.name,
         cg.branch_crm_id AS branch,
         cg.max_students,
         COALESCE(ae.students, 0)::int AS active_students,
         GREATEST(COALESCE(cg.max_students, 0) - COALESCE(ae.students, 0), 0)::int AS spare_seats,
         p.price_per_month,
         CASE
           WHEN p.price_per_month IS NULL THEN NULL
           ELSE GREATEST(COALESCE(cg.max_students, 0) - COALESCE(ae.students, 0), 0)
                * p.price_per_month::numeric
         END AS theoretical_monthly_capacity_ceiling
       FROM class_groups cg
       LEFT JOIN active_enrollments ae ON ae.class_group_id = cg.id
       LEFT JOIN programs p ON p.id = cg.program_id
       WHERE cg.is_active = TRUE
         AND COALESCE(cg.is_test_data, FALSE) = FALSE
         AND GREATEST(COALESCE(cg.max_students, 0) - COALESCE(ae.students, 0), 0) > 0
       ORDER BY theoretical_monthly_capacity_ceiling DESC NULLS LAST, spare_seats DESC
       LIMIT 100`,
    ),
    safeQuery(
      "leakage-summary",
      `WITH active_enrollments AS (
         SELECT class_group_id, count(*)::int AS students
         FROM enrollments
         WHERE status = 'active'
         GROUP BY class_group_id
       ), capacity AS (
         SELECT
           GREATEST(COALESCE(cg.max_students, 0) - COALESCE(ae.students, 0), 0)::int AS spare_seats,
           p.price_per_month::numeric AS price_per_month
         FROM class_groups cg
         LEFT JOIN active_enrollments ae ON ae.class_group_id = cg.id
         LEFT JOIN programs p ON p.id = cg.program_id
         WHERE cg.is_active = TRUE
           AND COALESCE(cg.is_test_data, FALSE) = FALSE
       )
       SELECT
         (SELECT count(*)::int FROM lead_events
           WHERE duplicate_candidate IS DISTINCT FROM TRUE
             AND matched_student_crm_id IS NULL
             AND COALESCE(event_time, created_at) >= now() - interval '90 days') AS unmatched_leads_90d,
         COALESCE(sum(spare_seats), 0)::int AS spare_seats,
         COALESCE(sum(spare_seats * price_per_month) FILTER (WHERE price_per_month IS NOT NULL), 0)::numeric AS theoretical_monthly_capacity_ceiling
       FROM capacity`,
    ),
  ]);

  res.json({
    generatedAt: new Date().toISOString(),
    mode: "read-only-real-data",
    interpretation: {
      unmatchedLeads: "Leads not yet matched to a student are opportunities requiring review, not guaranteed lost revenue.",
      theoreticalMonthlyCapacityCeiling: "Spare seats multiplied by configured monthly program price. This is a capacity ceiling, not a revenue forecast.",
    },
    summary,
    unmatchedLeads,
    spareCapacity,
  });
});

companyOsRouter.get("/company-os/owner-exceptions", async (_req, res) => {
  const [syncFailures, bankProblems, staleLeads, overCapacity] = await Promise.all([
    safeQuery(
      "sync-failures",
      `SELECT entity, status, message, started_at, finished_at
       FROM sync_logs
       WHERE started_at >= now() - interval '7 days'
         AND lower(status) NOT IN ('success', 'ok', 'completed')
       ORDER BY started_at DESC
       LIMIT 20`,
    ),
    safeQuery(
      "bank-problems",
      `SELECT bank_name, connector_status, last_success_at, last_error
       FROM bank_connectors
       WHERE connector_status = 'error'
          OR (connector_status = 'active' AND (last_success_at IS NULL OR last_success_at < now() - interval '24 hours'))
       ORDER BY bank_name`,
    ),
    safeQuery(
      "stale-unmatched-leads",
      `SELECT
         COALESCE(branch_name, 'unknown') AS branch,
         count(*)::int AS leads
       FROM lead_events
       WHERE duplicate_candidate IS DISTINCT FROM TRUE
         AND matched_student_crm_id IS NULL
         AND COALESCE(event_time, created_at) < now() - interval '7 days'
         AND COALESCE(event_time, created_at) >= now() - interval '90 days'
       GROUP BY COALESCE(branch_name, 'unknown')
       ORDER BY count(*) DESC`,
    ),
    safeQuery(
      "over-capacity-groups",
      `WITH active_enrollments AS (
         SELECT class_group_id, count(*)::int AS students
         FROM enrollments WHERE status = 'active'
         GROUP BY class_group_id
       )
       SELECT cg.id, cg.name, cg.max_students, COALESCE(ae.students, 0)::int AS active_students
       FROM class_groups cg
       LEFT JOIN active_enrollments ae ON ae.class_group_id = cg.id
       WHERE cg.is_active = TRUE
         AND COALESCE(cg.is_test_data, FALSE) = FALSE
         AND COALESCE(ae.students, 0) > COALESCE(cg.max_students, 0)
       ORDER BY COALESCE(ae.students, 0) - COALESCE(cg.max_students, 0) DESC`,
    ),
  ]);

  const exceptions = [
    { type: "sync-failure", severity: "high", source: syncFailures },
    { type: "bank-health", severity: "critical", source: bankProblems },
    { type: "stale-unmatched-leads", severity: "medium", source: staleLeads },
    { type: "group-over-capacity", severity: "high", source: overCapacity },
  ]
    .filter((entry) => !entry.source.ok || entry.source.rows.length > 0)
    .slice(0, 5);

  res.json({
    generatedAt: new Date().toISOString(),
    scope: "ArtHello OS",
    portfolioCoverage: "partial",
    mode: "exceptions-only",
    exceptions,
    note: "Cross-project owner brief remains partial until other projects expose verified status/financial adapters.",
  });
});
