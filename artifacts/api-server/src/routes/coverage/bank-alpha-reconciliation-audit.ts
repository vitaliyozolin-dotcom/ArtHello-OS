import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const bankAlphaReconciliationAuditRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// P8.4b — Bank ↔ AlphaCRM Reconciliation Audit
// ══════════════════════════════════════════════════════════════════════════════
bankAlphaReconciliationAuditRouter.get(
  "/coverage/bank-alpha-reconciliation-audit",
  async (_req, res) => {
    try {
      // ── 0. Environment guard ─────────────────────────────────────────────────
      const dbNameRow = await sqlOne<{ db: string }>(
        "SELECT current_database() AS db",
      );
      const dbName = dbNameRow?.db ?? "";
      const nodeEnv = process.env["NODE_ENV"] ?? "";
      const isProduction =
        nodeEnv === "production" ||
        dbName.includes("neon") ||
        dbName.includes("prod") ||
        (!dbName.includes("dev") &&
          !dbName.includes("test") &&
          !dbName.includes("local"));

      if (!isProduction) {
        return res.json({
          auditType: "bank-alpha-reconciliation-audit-p84b",
          generatedAt: new Date().toISOString(),
          environment: { dbKind: "dev", isProduction: false, dbName, nodeEnv },
          bankAlphaReconciliationReadiness: "NOT_APPLICABLE_DEV",
          readinessReason: "Only valid against production bank data.",
        });
      }

      // ── 1. Check if any reconciliation runs exist ─────────────────────────────
      const runsCountRow = await sqlOne<{ cnt: string }>(
        "SELECT COUNT(*)::text AS cnt FROM bank_alpha_reconciliation_runs",
      );
      const runsCount = Number(runsCountRow?.cnt ?? 0);

      if (runsCount === 0) {
        return res.json({
          auditType: "bank-alpha-reconciliation-audit-p84b",
          generatedAt: new Date().toISOString(),
          environment: {
            dbKind: "production",
            isProduction: true,
            dbName,
            nodeEnv,
          },
          bankAlphaReconciliationReadiness: "NOT_RUN",
          readinessReason:
            "No reconciliation runs found. Run approved offline or scoped workflow to start.",
          p85CanStart: false,
          warnings: [
            "Run approved offline or scoped workflow to build the reconciliation layer.",
          ],
        });
      }

      // ── 2. Latest completed run ────────────────────────────────────────────────
      const latestRun = await sqlOne<{
        id: string;
        started_at: string;
        finished_at: string | null;
        status: string;
        bank_transactions_checked: number;
        crm_payments_checked: number;
        matched_count: number;
        partial_count: number;
        possible_count: number;
        unmatched_bank_count: number;
        unmatched_crm_count: number;
        excluded_internal_count: number;
        excluded_collection_count: number;
        excluded_bank_fee_count: number;
        needs_review_count: number;
      }>(`
      SELECT id, started_at, finished_at, status,
             bank_transactions_checked, crm_payments_checked,
             matched_count, partial_count, possible_count,
             unmatched_bank_count, unmatched_crm_count,
             excluded_internal_count, excluded_collection_count, excluded_bank_fee_count,
             needs_review_count
      FROM bank_alpha_reconciliation_runs
      ORDER BY created_at DESC LIMIT 1
    `);

      if (!latestRun) {
        return res.json({
          auditType: "bank-alpha-reconciliation-audit-p84b",
          generatedAt: new Date().toISOString(),
          environment: {
            dbKind: "production",
            isProduction: true,
            dbName,
            nodeEnv,
          },
          bankAlphaReconciliationReadiness: "NOT_RUN",
          readinessReason: "No reconciliation runs found.",
          p85CanStart: false,
        });
      }

      const runId = latestRun.id;

      // ── 3. Match breakdown by status and confidence ───────────────────────────
      const [byStatus, byConf, byMethod] = await Promise.all([
        sql<{ s: string; cnt: string; total_bank: string }>(
          `
        SELECT match_status AS s, COUNT(*)::text AS cnt,
               COALESCE(SUM(bank_amount),0)::numeric(15,2)::text AS total_bank
        FROM bank_alpha_reconciliation_matches
        WHERE run_id = $1
        GROUP BY match_status ORDER BY COUNT(*) DESC
      `,
          [runId],
        ),
        sql<{ c: string; cnt: string }>(
          `
        SELECT match_confidence AS c, COUNT(*)::text AS cnt
        FROM bank_alpha_reconciliation_matches
        WHERE run_id = $1
        GROUP BY match_confidence ORDER BY COUNT(*) DESC
      `,
          [runId],
        ),
        sql<{ m: string; cnt: string }>(
          `
        SELECT match_method AS m, COUNT(*)::text AS cnt
        FROM bank_alpha_reconciliation_matches
        WHERE run_id = $1
        GROUP BY match_method ORDER BY COUNT(*) DESC
      `,
          [runId],
        ),
      ]);

      const matchStatusBreakdown: Record<
        string,
        { count: number; totalBankAmount: number }
      > = {};
      for (const r of byStatus) {
        matchStatusBreakdown[r.s] = {
          count: Number(r.cnt),
          totalBankAmount: Number(r.total_bank),
        };
      }
      const matchConfidenceBreakdown: Record<string, number> = {};
      for (const r of byConf) matchConfidenceBreakdown[r.c] = Number(r.cnt);
      const matchMethodBreakdown: Record<string, number> = {};
      for (const r of byMethod) matchMethodBreakdown[r.m] = Number(r.cnt);

      // ── 4. Unmatched bank transactions sample ─────────────────────────────────
      const unmatchedBankSample = await sql<{
        bank_transaction_id: string;
        bank_amount: string;
        bank_date: string | null;
        bank_counterparty_name: string | null;
        reasons: unknown;
      }>(
        `
      SELECT bank_transaction_id, bank_amount::text, bank_date::text,
             bank_counterparty_name, reasons
      FROM bank_alpha_reconciliation_matches
      WHERE run_id = $1 AND match_status = 'unmatched_bank'
      ORDER BY bank_amount::numeric DESC LIMIT 20
    `,
        [runId],
      );

      // ── 5. Needs-review sample ─────────────────────────────────────────────────
      const needsReviewSample = await sql<{
        bank_transaction_id: string;
        bank_amount: string;
        bank_date: string | null;
        bank_counterparty_name: string | null;
        reasons: unknown;
      }>(
        `
      SELECT bank_transaction_id, bank_amount::text, bank_date::text,
             bank_counterparty_name, reasons
      FROM bank_alpha_reconciliation_matches
      WHERE run_id = $1 AND match_status = 'needs_review'
      ORDER BY bank_amount::numeric DESC LIMIT 20
    `,
        [runId],
      );

      // ── 6. Matched records sample ──────────────────────────────────────────────
      const matchedSample = await sql<{
        bank_transaction_id: string;
        crm_payment_id: string | null;
        match_confidence: string | null;
        bank_amount: string;
        bank_date: string | null;
        crm_date: string | null;
        date_delta_days: number | null;
        bank_counterparty_name: string | null;
      }>(
        `
      SELECT bank_transaction_id, crm_payment_id::text, match_confidence,
             bank_amount::text, bank_date::text, crm_date::text, date_delta_days,
             bank_counterparty_name
      FROM bank_alpha_reconciliation_matches
      WHERE run_id = $1 AND match_status IN ('matched','possible_match')
      ORDER BY bank_amount::numeric DESC LIMIT 20
    `,
        [runId],
      );

      // ── 7. Compute totals and amounts ──────────────────────────────────────────
      const totalBankRow = await sqlOne<{ total: string; income: string }>(
        "SELECT COUNT(*)::text AS total, COALESCE(SUM(CASE WHEN direction='income' THEN amount ELSE 0 END),0)::numeric(15,2)::text AS income FROM bank_transactions",
      );

      // ── 8. Issues ──────────────────────────────────────────────────────────────
      const issues: Array<{
        issueType: string;
        severity: string;
        count: number;
        description: string;
        recommendedAction: string;
      }> = [];

      const unmatchedBankCnt = latestRun.unmatched_bank_count;
      const needsRevCnt = latestRun.needs_review_count;
      const possibleCnt = latestRun.possible_count;
      const matchedCnt = latestRun.matched_count;
      const unmatchedCrmCnt = latestRun.unmatched_crm_count;

      if (unmatchedBankCnt > 50) {
        issues.push({
          issueType: "high_unmatched_bank",
          severity: "HIGH",
          count: unmatchedBankCnt,
          description: `${unmatchedBankCnt} bank income transactions have no CRM payment match.`,
          recommendedAction:
            "Review for missing AlphaCRM payments, bank-only income, or data entry errors.",
        });
      } else if (unmatchedBankCnt > 0) {
        issues.push({
          issueType: "unmatched_bank",
          severity: "MEDIUM",
          count: unmatchedBankCnt,
          description: `${unmatchedBankCnt} bank income transactions unmatched.`,
          recommendedAction: "Review unmatched sample above.",
        });
      }
      if (needsRevCnt > 0) {
        issues.push({
          issueType: "multiple_crm_candidates",
          severity: "MEDIUM",
          count: needsRevCnt,
          description: `${needsRevCnt} bank transactions have multiple same-amount CRM candidates — ambiguous match.`,
          recommendedAction:
            "Manual review required per transaction. Look at student/purpose context.",
        });
      }
      if (possibleCnt > 20) {
        issues.push({
          issueType: "low_confidence_matches",
          severity: "LOW",
          count: possibleCnt,
          description: `${possibleCnt} possible matches (medium/low confidence: amount match but date >1 day apart).`,
          recommendedAction:
            "Review date-discrepancy records. May indicate recording date vs posting date lag.",
        });
      }
      if (unmatchedCrmCnt > 500) {
        issues.push({
          issueType: "high_unmatched_crm",
          severity: "MEDIUM",
          count: unmatchedCrmCnt,
          description: `${unmatchedCrmCnt} eligible CRM income payments have no bank transaction match.`,
          recommendedAction:
            "Normal for prior-period CRM payments and cash/card-not-in-bank transactions.",
        });
      }

      // ── 9. Readiness verdict ───────────────────────────────────────────────────
      const eligibleBankIncome =
        matchedCnt + unmatchedBankCnt + needsRevCnt + possibleCnt;
      const matchRatePct =
        eligibleBankIncome > 0
          ? Math.round(((matchedCnt + possibleCnt) / eligibleBankIncome) * 100)
          : 0;

      let bankAlphaReconciliationReadiness: string;
      let readinessReason: string;

      if (latestRun.status !== "completed") {
        bankAlphaReconciliationReadiness = "NOT_READY";
        readinessReason = `Latest run status: ${latestRun.status}. Wait for completion or re-run.`;
      } else if (matchRatePct >= 80 && unmatchedBankCnt < 50) {
        bankAlphaReconciliationReadiness = "READY_FOR_P85";
        readinessReason = `${matchRatePct}% of eligible bank income transactions matched. ${unmatchedBankCnt} unmatched — acceptable for P8.5.`;
      } else if (matchedCnt > 0 || possibleCnt > 0) {
        bankAlphaReconciliationReadiness = "PARTIAL_READY";
        readinessReason = `${matchRatePct}% match rate (${matchedCnt} confirmed + ${possibleCnt} possible). ${unmatchedBankCnt} unmatched bank + ${needsRevCnt} needs_review. More review needed before P8.5.`;
      } else {
        bankAlphaReconciliationReadiness = "NOT_READY";
        readinessReason =
          "No matches found. Check that CRM payments have income payments for Atlas branch and bank transactions have income ops.";
      }

      return res.json({
        auditType: "bank-alpha-reconciliation-audit-p84b",
        generatedAt: new Date().toISOString(),
        environment: {
          dbKind: "production",
          isProduction: true,
          dbName,
          nodeEnv,
        },
        latestRun: {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.started_at,
          finishedAt: latestRun.finished_at,
          bankTransactionsChecked: latestRun.bank_transactions_checked,
          crmPaymentsChecked: latestRun.crm_payments_checked,
          matchedCount: matchedCnt,
          possibleCount: possibleCnt,
          needsReviewCount: needsRevCnt,
          unmatchedBankCount: unmatchedBankCnt,
          unmatchedCrmCount: unmatchedCrmCnt,
          excludedInternalCount: latestRun.excluded_internal_count,
          excludedCollectionCount: latestRun.excluded_collection_count,
          excludedBankFeeCount: latestRun.excluded_bank_fee_count,
        },
        summary: {
          totalBankTransactions: Number(totalBankRow?.total ?? 0),
          totalBankIncome: Number(totalBankRow?.income ?? 0),
          eligibleBankIncomeCount: eligibleBankIncome,
          matchRatePct,
          runsTotal: runsCount,
        },
        matchBreakdown: {
          byStatus: matchStatusBreakdown,
          byConfidence: matchConfidenceBreakdown,
          byMethod: matchMethodBreakdown,
        },
        unmatchedBankSample: unmatchedBankSample.map((r) => ({
          bankTransactionId: r.bank_transaction_id,
          bankAmount: Number(r.bank_amount),
          bankDate: r.bank_date,
          bankCounterpartyName: r.bank_counterparty_name,
          reasons: r.reasons,
        })),
        needsReviewSample: needsReviewSample.map((r) => ({
          bankTransactionId: r.bank_transaction_id,
          bankAmount: Number(r.bank_amount),
          bankDate: r.bank_date,
          bankCounterpartyName: r.bank_counterparty_name,
          reasons: r.reasons,
        })),
        matchedSample: matchedSample.map((r) => ({
          bankTransactionId: r.bank_transaction_id,
          crmPaymentId: r.crm_payment_id,
          matchConfidence: r.match_confidence,
          bankAmount: Number(r.bank_amount),
          bankDate: r.bank_date,
          crmDate: r.crm_date,
          dateDeltaDays: r.date_delta_days,
          bankCounterpartyName: r.bank_counterparty_name,
        })),
        issues,
        issueSummary: {
          total: issues.length,
          high: issues.filter((i) => i.severity === "HIGH").length,
          medium: issues.filter((i) => i.severity === "MEDIUM").length,
          low: issues.filter((i) => i.severity === "LOW").length,
        },
        bankAlphaReconciliationReadiness,
        readinessReason,
        p85CanStart:
          bankAlphaReconciliationReadiness === "READY_FOR_P85" ||
          bankAlphaReconciliationReadiness === "PARTIAL_READY",
        warnings: [
          "⚠️ Do NOT treat this reconciliation as final ДДС/ОПиУ truth. P8.5 Verified ДДС requires full reconciliation review.",
          "⚠️ collection_internal payments (229 records, ~135M ₽) remain excluded — not client revenue until bank reconciliation confirmed.",
          "⚠️ Internal companies (ООО АРТХЕЛЛО etc.) excluded from all matching.",
          `ℹ️ Match method: amount+date window only. Customer/family matching not yet implemented (future P8.4c enhancement).`,
          `ℹ️ Possible matches (medium/low confidence) need manual date-discrepancy review.`,
        ],
      });
    } catch (err) {
      logger.error({ err }, "bank-alpha-reconciliation-audit failed");
      return void res.status(500).json({ error: String(err) });
    }
  },
);

// ─── GET /api/coverage/lesson-eu-diagnostic ───────────────────────────────────
// Temporary P9 diagnostic: checks overlap between crm_lessons.group_crm_id
// and educational_units.crm_group_id to debug map-educational-units = 0.
