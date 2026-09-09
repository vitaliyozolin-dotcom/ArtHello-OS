import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const paymentAuditsRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/payment-truth-audit
// P7.5 — AlphaCRM operational payments audit (NOT bank-reconciled truth)
// ══════════════════════════════════════════════════════════════════════════════
paymentAuditsRouter.get("/coverage/payment-truth-audit", async (req, res) => {
  const bid = branchId(req);
  try {
    // ── 1. Top-level counts ─────────────────────────────────────────────────
    const rawCnt = await sqlOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1`,
      [bid],
    );
    const totals = await sqlOne<{
      total: string;
      normalized: string;
      parse_errors: string;
      no_customer: string;
      student_linked: string;
      inactive_linked: string;
      identity_linked: string;
      family_linked: string;
      unlinked: string;
      income_sum: string;
      outcome_sum: string;
      correction_sum: string;
      earliest_date: string;
      latest_date: string;
      suspicious_high: string;
      negative_cnt: string;
      unconfirmed_cnt: string;
    }>(
      `SELECT
         COUNT(*)::text                                                                                 AS total,
         COUNT(CASE WHEN normalization_status='normalized' THEN 1 END)::text                           AS normalized,
         COUNT(CASE WHEN normalization_status='parse_error' THEN 1 END)::text                          AS parse_errors,
         COUNT(CASE WHEN student_crm_id IS NULL THEN 1 END)::text                                      AS no_customer,
         COUNT(CASE WHEN student_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM crm_students cs WHERE cs.id=crm_payments.student_id AND cs.lifecycle_status != 'inactive'
         ) THEN 1 END)::text                                                                            AS student_linked,
         COUNT(CASE WHEN student_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM crm_students cs WHERE cs.id=crm_payments.student_id AND cs.lifecycle_status = 'inactive'
         ) THEN 1 END)::text                                                                            AS inactive_linked,
         COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)::text                             AS identity_linked,
         COUNT(CASE WHEN family_id IS NOT NULL THEN 1 END)::text                                       AS family_linked,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL THEN 1 END)::text          AS unlinked,
         COALESCE(SUM(CASE WHEN direction='income'     THEN income     ELSE 0 END), 0)::text           AS income_sum,
         COALESCE(SUM(CASE WHEN direction='outcome'    THEN outcome    ELSE 0 END), 0)::text           AS outcome_sum,
         COALESCE(SUM(CASE WHEN direction='correction' THEN income     ELSE 0 END), 0)::text           AS correction_sum,
         MIN(document_date)::text                                                                       AS earliest_date,
         MAX(document_date)::text                                                                       AS latest_date,
         COUNT(CASE WHEN ABS(COALESCE(income, outcome, 0)) > 100000 THEN 1 END)::text                  AS suspicious_high,
         COUNT(CASE WHEN COALESCE(income, 0) < 0 THEN 1 END)::text                                    AS negative_cnt,
         COUNT(CASE WHEN is_confirmed = FALSE THEN 1 END)::text                                        AS unconfirmed_cnt
       FROM crm_payments WHERE branch_crm_id=$1`,
      [bid],
    );

    // ── 2. Type breakdown ───────────────────────────────────────────────────
    const typeBreakdown = await sql(
      `SELECT
         COALESCE(payment_type_normalized, 'unknown')  AS type_normalized,
         COALESCE(payment_type_id_raw, '?')            AS type_id_raw,
         COALESCE(payment_type_name_raw, '?')          AS type_name_raw,
         COUNT(*)                                       AS cnt,
         COALESCE(SUM(income),  0)                     AS income_sum,
         COALESCE(SUM(outcome), 0)                     AS outcome_sum
       FROM crm_payments WHERE branch_crm_id=$1
       GROUP BY payment_type_normalized, payment_type_id_raw, payment_type_name_raw
       ORDER BY cnt DESC`,
      [bid],
    );

    // ── 3. Monthly summary ──────────────────────────────────────────────────
    const monthly = await sql(
      `SELECT
         TO_CHAR(document_date, 'YYYY-MM')             AS month,
         COUNT(*)                                       AS total_payments,
         COUNT(CASE WHEN direction='income'     THEN 1 END) AS income_cnt,
         COUNT(CASE WHEN direction='correction' THEN 1 END) AS correction_cnt,
         COUNT(CASE WHEN direction='outcome'    THEN 1 END) AS outcome_cnt,
         COUNT(CASE WHEN direction='unknown'    THEN 1 END) AS unknown_cnt,
         COALESCE(SUM(CASE WHEN direction='income'     THEN income     END), 0) AS income_sum,
         COALESCE(SUM(CASE WHEN direction='correction' THEN income     END), 0) AS correction_sum,
         COALESCE(SUM(CASE WHEN direction='outcome'    THEN outcome    END), 0) AS outcome_sum,
         COUNT(CASE WHEN student_id IS NOT NULL THEN 1 END)             AS linked_student,
         COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)    AS linked_identity,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL THEN 1 END) AS unlinked
       FROM crm_payments WHERE branch_crm_id=$1 AND document_date IS NOT NULL
       GROUP BY month ORDER BY month`,
      [bid],
    );

    // ── 4. Linking summary ──────────────────────────────────────────────────
    const linkingSummary = {
      activeStudent: Number(totals?.student_linked ?? 0),
      inactiveStudent: Number(totals?.inactive_linked ?? 0),
      historicalOnly: Number(totals?.identity_linked ?? 0),
      withFamily: Number(totals?.family_linked ?? 0),
      unlinked: Number(totals?.unlinked ?? 0),
      noCustomerId: Number(totals?.no_customer ?? 0),
    };

    // ── 5. Suspicious audit ─────────────────────────────────────────────────
    const suspiciousExamples = await sql(
      `SELECT
         crm_id, document_date::text, direction,
         income::text, outcome::text, student_crm_id,
         payment_type_name_raw, is_confirmed::text
       FROM crm_payments
       WHERE branch_crm_id=$1 AND ABS(COALESCE(income, outcome, 0)) > 100000
       ORDER BY ABS(COALESCE(income, outcome, 0)) DESC LIMIT 10`,
      [bid],
    );

    // ── 6. Unlinked customer IDs (top 10) ───────────────────────────────────
    const topUnlinked = await sql(
      `SELECT student_crm_id, COUNT(*) AS cnt, MIN(document_date)::text AS first_date
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND student_crm_id IS NOT NULL
         AND student_id IS NULL AND student_identity_id IS NULL
       GROUP BY student_crm_id ORDER BY cnt DESC LIMIT 10`,
      [bid],
    );

    const rawCount = Number(rawCnt?.cnt ?? 0);
    const normCount = Number(totals?.total ?? 0);
    const gap = rawCount - normCount;

    res.json({
      branchId: bid,
      auditType: "payment-truth-audit",
      generatedAt: new Date().toISOString(),
      warning:
        "AlphaCRM payments are NOT bank-reconciled financial truth. These are operational records from AlphaCRM CRM system only.",

      normalization: {
        rawPayments: rawCount,
        normalizedPayments: normCount,
        gap,
        normalizationRate:
          rawCount > 0 ? Math.round((normCount / rawCount) * 100) : 0,
        parseErrors: Number(totals?.parse_errors ?? 0),
        unconfirmed: Number(totals?.unconfirmed_cnt ?? 0),
      },

      totals: {
        incomeSum: Number(totals?.income_sum ?? 0),
        outcomeSum: Number(totals?.outcome_sum ?? 0),
        correctionSum: Number(totals?.correction_sum ?? 0),
        negativeCount: Number(totals?.negative_cnt ?? 0),
        suspiciousHigh: Number(totals?.suspicious_high ?? 0),
        earliestDate: totals?.earliest_date,
        latestDate: totals?.latest_date,
      },

      typeBreakdown,
      linkingSummary,
      monthly,

      suspicious: {
        count: Number(totals?.suspicious_high ?? 0),
        examples: suspiciousExamples,
      },

      topUnlinkedCustomerIds: topUnlinked,
    });
  } catch (err) {
    logger.error({ err }, "payment-truth-audit failed");
    res.status(500).json({ error: "payment-truth-audit failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/payment-cleanup-audit
// P7.6 — AlphaCRM payments cleanup audit: unknown, unlinked, risk flags, readiness
// ══════════════════════════════════════════════════════════════════════════════
paymentAuditsRouter.get("/coverage/payment-cleanup-audit", async (req, res) => {
  const bid = branchId(req);
  try {
    // ── 1. Overall counts ────────────────────────────────────────────────────
    const counts = await sqlOne<{
      total: string;
      unknown_cnt: string;
      unlinked_cnt: string;
      risk_high: string;
      risk_medium: string;
      risk_low: string;
      risk_unset: string;
      collection_cnt: string;
      correction_cnt: string;
      refund_cnt: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(CASE WHEN payment_type_normalized IS NULL OR payment_type_normalized='unknown' THEN 1 END)::text AS unknown_cnt,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL AND family_id IS NULL THEN 1 END)::text AS unlinked_cnt,
         COUNT(CASE WHEN reconciliation_risk_level='high'    THEN 1 END)::text AS risk_high,
         COUNT(CASE WHEN reconciliation_risk_level='medium'  THEN 1 END)::text AS risk_medium,
         COUNT(CASE WHEN reconciliation_risk_level='low'     THEN 1 END)::text AS risk_low,
         COUNT(CASE WHEN reconciliation_risk_level IS NULL   THEN 1 END)::text AS risk_unset,
         COUNT(CASE WHEN payment_type_normalized='outcome'   THEN 1 END)::text AS collection_cnt,
         COUNT(CASE WHEN payment_type_normalized='correction'THEN 1 END)::text AS correction_cnt,
         COUNT(CASE WHEN payment_type_normalized='refund'    THEN 1 END)::text AS refund_cnt
       FROM crm_payments WHERE branch_crm_id=$1`,
      [bid],
    );

    // ── 2. Unknown payment type groups ───────────────────────────────────────
    const unknownGroups = await sql(
      `SELECT
         COALESCE(payment_type_id_raw,    'NULL') AS pay_type_id,
         COALESCE(payment_type_name_raw,  'NULL') AS pay_type_name,
         COALESCE(payment_type_normalized,'NULL') AS normalized,
         COALESCE(normalization_status,   'NULL') AS norm_status,
         COALESCE(sync_source,            'legacy') AS sync_src,
         COUNT(*) AS cnt,
         COALESCE(SUM(income),  0) AS sum_income,
         COALESCE(SUM(outcome), 0) AS sum_outcome
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND (payment_type_normalized IS NULL OR payment_type_normalized='unknown')
       GROUP BY pay_type_id, pay_type_name, normalized, norm_status, sync_src
       ORDER BY cnt DESC`,
      [bid],
    );

    // ── 3. Unlinked classification ────────────────────────────────────────────
    const unlinkedClass = await sql(
      `SELECT
         CASE
           WHEN student_crm_id IS NULL THEN 'MISSING_CUSTOMER_ID'
           WHEN EXISTS(
             SELECT 1 FROM crm_students s
             WHERE s.crm_id=p.student_crm_id AND s.branch_crm_id=$1
           ) THEN 'CUSTOMER_EXISTS_NOT_NORMALIZED'
           WHEN EXISTS(
             SELECT 1 FROM crm_student_identities si
             WHERE si.alpha_customer_id=p.student_crm_id AND si.branch_id=$1
           ) THEN 'CUSTOMER_IS_HISTORICAL_IDENTITY'
           ELSE 'CUSTOMER_ID_NOT_FOUND'
         END AS class,
         COALESCE(payment_type_normalized,'unknown') AS type_norm,
         COUNT(*) AS cnt,
         COALESCE(SUM(income),  0) AS sum_income,
         COALESCE(SUM(outcome), 0) AS sum_outcome
       FROM crm_payments p
       WHERE branch_crm_id=$1
         AND student_id IS NULL AND student_identity_id IS NULL AND family_id IS NULL
       GROUP BY class, type_norm
       ORDER BY cnt DESC`,
      [bid],
    );

    // ── 4. Collection / encashment risk ──────────────────────────────────────
    const collectionByMonth = await sql(
      `SELECT
         COALESCE(TO_CHAR(document_date,'YYYY-MM'),'no-date') AS month,
         COUNT(*) AS cnt,
         COALESCE(SUM(outcome), 0) AS total_outcome,
         COUNT(*) FILTER(WHERE student_crm_id IS NOT NULL) AS has_customer_id
       FROM crm_payments
       WHERE branch_crm_id=$1 AND payment_type_normalized='outcome'
       GROUP BY month ORDER BY month`,
      [bid],
    );
    const collectionTotals = await sqlOne<{ cnt: string; total: string }>(
      `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(outcome),0)::text AS total
       FROM crm_payments WHERE branch_crm_id=$1 AND payment_type_normalized='outcome'`,
      [bid],
    );

    // ── 5. Corrections / refunds / outcomes summary ───────────────────────────
    const crfSummary = await sql(
      `SELECT
         payment_type_normalized,
         COUNT(*) AS cnt,
         COALESCE(SUM(income),  0) AS sum_income,
         COALESCE(SUM(outcome), 0) AS sum_outcome,
         COUNT(*) FILTER(WHERE student_id IS NOT NULL)             AS linked_student,
         COUNT(*) FILTER(WHERE student_identity_id IS NOT NULL)    AS linked_identity,
         COUNT(*) FILTER(WHERE student_id IS NULL
                           AND student_identity_id IS NULL)        AS unlinked,
         MIN(document_date)::text AS earliest,
         MAX(document_date)::text AS latest
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND payment_type_normalized IN ('correction','refund','outcome')
       GROUP BY payment_type_normalized`,
      [bid],
    );

    // ── 6. Risk level summary ────────────────────────────────────────────────
    const riskSummary = await sql(
      `SELECT
         COALESCE(reconciliation_risk_level,'unset') AS risk_level,
         COALESCE(finance_treatment_hint,'unset')    AS hint,
         COUNT(*) AS cnt
       FROM crm_payments WHERE branch_crm_id=$1
       GROUP BY risk_level, hint
       ORDER BY cnt DESC`,
      [bid],
    );

    // ── 7. Suspicious flags from alpha_linking_issues ─────────────────────────
    const issuesByType = await sql(
      `SELECT issue_type, severity, COUNT(*) AS cnt
       FROM alpha_linking_issues
       WHERE entity_type='payment' AND branch_id=$1
       GROUP BY issue_type, severity ORDER BY cnt DESC`,
      [bid],
    );
    const issueExamples = await sql(
      `SELECT issue_type, alpha_id, issue_message, severity, suggested_action
       FROM alpha_linking_issues
       WHERE entity_type='payment' AND branch_id=$1
         AND severity IN ('error','warning')
       ORDER BY
         CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         alpha_id
       LIMIT 15`,
      [bid],
    );
    const totalIssues = issuesByType.reduce(
      (s: number, r: Record<string, unknown>) => s + Number(r["cnt"] ?? 0),
      0,
    );
    const cleanupRan = Number(counts?.risk_unset ?? 0) === 0 || totalIssues > 0;

    // ── 8. Duplicate patterns ────────────────────────────────────────────────
    const dupPatterns = await sql(
      `SELECT student_crm_id, document_date::text AS doc, income::text, COUNT(*) AS dup_cnt
       FROM crm_payments
       WHERE branch_crm_id=$1 AND income > 0
         AND student_crm_id IS NOT NULL AND document_date IS NOT NULL
       GROUP BY student_crm_id, document_date, income
       HAVING COUNT(*) > 3
       ORDER BY COUNT(*) DESC LIMIT 10`,
      [bid],
    );

    // ── 9. Readiness verdict ──────────────────────────────────────────────────
    const unknownCnt = Number(counts?.unknown_cnt ?? 0);
    const unlinkedCnt = Number(counts?.unlinked_cnt ?? 0);
    const riskUnset = Number(counts?.risk_unset ?? 0);
    const hasCollection = Number(counts?.collection_cnt ?? 0) > 0;

    let readiness: "READY" | "PARTIAL" | "NOT_READY";
    const readinessReasons: string[] = [];

    if (!cleanupRan || riskUnset > 0) {
      readiness = "NOT_READY";
      readinessReasons.push(
        "Run approved offline or scoped workflow first to classify all payments.",
      );
    } else if (unknownCnt === 0 && unlinkedCnt < 250) {
      readiness = "READY";
      readinessReasons.push(
        "All payments classified. Collection separated. Ready for bank reconciliation step.",
      );
    } else {
      readiness = "PARTIAL";
      if (unknownCnt > 0)
        readinessReasons.push(
          `${unknownCnt} unknown payments remain — legacy pre-P7.5 records (NULL amount/date/type). Classified as manual_review. Cannot be auto-resolved.`,
        );
      if (unlinkedCnt > 0)
        readinessReasons.push(
          `${unlinkedCnt} unlinked payments remain — 229 are collection/internal (no client), rest are customer_not_found (may be deleted/merged). All classified.`,
        );
      if (hasCollection)
        readinessReasons.push(
          `${counts?.collection_cnt} collection/encashment records (135M ₽) separated as collection_internal — excluded from client revenue until bank reconciliation.`,
        );
    }

    res.json({
      branchId: bid,
      auditType: "payment-cleanup-audit",
      generatedAt: new Date().toISOString(),
      warning:
        "AlphaCRM payments are NOT bank-reconciled financial truth. These are operational CRM records only.",
      cleanupRan,

      counts: {
        total: Number(counts?.total ?? 0),
        unknownCnt,
        unlinkedCnt,
        riskHigh: Number(counts?.risk_high ?? 0),
        riskMedium: Number(counts?.risk_medium ?? 0),
        riskLow: Number(counts?.risk_low ?? 0),
        riskUnset,
        collectionCnt: Number(counts?.collection_cnt ?? 0),
        correctionCnt: Number(counts?.correction_cnt ?? 0),
        refundCnt: Number(counts?.refund_cnt ?? 0),
      },

      unknownPayments: {
        count: unknownCnt,
        classification: "legacy_pre_p7_5",
        explanation:
          "All 50 records predate P7.5 normalization (sync_source=legacy). NULL pay_type_id, NULL amount, NULL date. Cannot be auto-mapped. Finance treatment: manual_review.",
        recommendedAction: "manual_review_or_archive",
        groups: unknownGroups,
      },

      unlinkedPayments: {
        count: unlinkedCnt,
        classification: unlinkedClass,
        legend: {
          MISSING_CUSTOMER_ID:
            "No customer_id in record — primarily Инкассация Расход (collection, pay_type=12). Internal cash movements.",
          CUSTOMER_ID_NOT_FOUND:
            "customer_id present but not in crm_students or crm_student_identities — customer deleted/merged/other-branch.",
          CUSTOMER_EXISTS_NOT_NORMALIZED:
            "customer in crm_students but payment not linked — rerun p76-cleanup-payments.",
          CUSTOMER_IS_HISTORICAL_IDENTITY:
            "customer is a ghost/deleted student tracked in crm_student_identities.",
        },
      },

      collectionRisk: {
        totalCount: Number(collectionTotals?.cnt ?? 0),
        totalAmount: Number(collectionTotals?.total ?? 0),
        riskLevel: "high",
        financeTreatment: "collection_internal",
        recommendation: "exclude_from_revenue_until_reconciled",
        note: "All 229 Инкассация Расход records have no customer_id — internal cash collections, NOT client revenue. Verify against bank encashment transactions.",
        byMonth: collectionByMonth,
      },

      correctionsRefundsOutcomes: crfSummary,
      riskSummary,
      duplicatePatterns: dupPatterns,

      suspiciousFlags: {
        total: totalIssues,
        byType: issuesByType,
        examples: issueExamples,
      },

      readiness,
      readinessReasons,
    });
  } catch (err) {
    logger.error({ err }, "payment-cleanup-audit failed");
    res.status(500).json({ error: "payment-cleanup-audit failed" });
  }
});
