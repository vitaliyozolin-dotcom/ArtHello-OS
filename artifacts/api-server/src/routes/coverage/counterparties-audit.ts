import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const counterpartiesAuditRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/counterparties-audit
// P8.3 — Counterparty Foundation Audit
// ══════════════════════════════════════════════════════════════════════════════
counterpartiesAuditRouter.get(
  "/coverage/counterparties-audit",
  async (req, res) => {
    try {
      // ── 0. Environment guard ─────────────────────────────────────────────────
      const dbNameRow = await sqlOne<{ db: string }>(
        "SELECT current_database() AS db",
      );
      const dbName = dbNameRow?.db ?? "";
      const nodeEnv = process.env["NODE_ENV"] ?? "";
      const isProduction =
        nodeEnv === "production" ||
        dbName.includes("prod") ||
        dbName.includes("neon") ||
        (!dbName.includes("dev") &&
          !dbName.includes("test") &&
          !dbName.includes("local"));

      if (!isProduction) {
        return res.json({
          auditType: "counterparties-audit-p83",
          generatedAt: new Date().toISOString(),
          environment: {
            dbKind: "dev",
            auditValidity: "NOT_VALID_OUTSIDE_PRODUCTION",
            isProduction: false,
            dbName,
            nodeEnv,
          },
          counterpartyFoundationReadiness: "NOT_APPLICABLE_DEV",
          readinessReason:
            "Counterparty foundation audit only valid against production bank data.",
          warnings: [
            "🚫 P8.3 NOT VALID IN DEV — bank_transactions data exists only in production.",
          ],
        });
      }

      // ── 1. Core counts ───────────────────────────────────────────────────────
      const [
        totals,
        byType,
        byConfidence,
        txLinkCoverage,
        internalTransfers,
        dupCandidates,
        topIncome,
        topExpense,
        noLinks,
      ] = await Promise.all([
        sqlOne<{
          total: string;
          from_bank: string;
          aliases: string;
          links: string;
          dup_candidates: string;
        }>(`
        SELECT
          (SELECT COUNT(*)::text FROM counterparties WHERE source='bank_transactions') AS total,
          (SELECT COUNT(*)::text FROM counterparties WHERE source='bank_transactions') AS from_bank,
          (SELECT COUNT(*)::text FROM counterparty_aliases) AS aliases,
          (SELECT COUNT(*)::text FROM bank_transaction_counterparty_links) AS links,
          (SELECT COUNT(*)::text FROM counterparty_duplicate_candidates WHERE status='open') AS dup_candidates
      `),

        sql<{
          counterparty_type: string;
          cnt: string;
          total_income: string;
          total_expense: string;
        }>(`
        SELECT counterparty_type,
               COUNT(*)::text AS cnt,
               COALESCE(SUM(total_income),0)::numeric(15,2)::text  AS total_income,
               COALESCE(SUM(total_expense),0)::numeric(15,2)::text AS total_expense
        FROM counterparties WHERE source='bank_transactions'
        GROUP BY counterparty_type ORDER BY COUNT(*) DESC
      `),

        sql<{ confidence: string; cnt: string }>(`
        SELECT confidence, COUNT(*)::text AS cnt
        FROM counterparties WHERE source='bank_transactions'
        GROUP BY confidence ORDER BY cnt DESC
      `),

        sqlOne<{ total_tx: string; linked_tx: string; unlinked_tx: string }>(`
        SELECT
          (SELECT COUNT(*)::text FROM bank_transactions) AS total_tx,
          COUNT(DISTINCT bank_transaction_id)::text       AS linked_tx,
          ((SELECT COUNT(*) FROM bank_transactions) - COUNT(DISTINCT bank_transaction_id))::text AS unlinked_tx
        FROM bank_transaction_counterparty_links
      `),

        sql<{
          id: string;
          canonical_key: string;
          display_name: string;
          total_income: string;
          total_expense: string;
          operations_count: string;
          risk_flags: Record<string, boolean>;
        }>(`
        SELECT id, canonical_key, display_name,
               total_income::text, total_expense::text, operations_count::text,
               risk_flags
        FROM counterparties
        WHERE source='bank_transactions'
          AND (risk_flags->>'own_account_transfer' = 'true' OR risk_flags->>'exclude_from_revenue_expense' = 'true')
        ORDER BY operations_count DESC
      `),

        sql<{
          counterparty_a_id: string;
          counterparty_b_id: string;
          reason: string;
          confidence: string;
          severity: string;
          a_name: string;
          b_name: string;
        }>(`
        SELECT d.counterparty_a_id, d.counterparty_b_id, d.reason, d.confidence, d.severity,
               a.display_name AS a_name, b.display_name AS b_name
        FROM counterparty_duplicate_candidates d
        JOIN counterparties a ON d.counterparty_a_id = a.id
        JOIN counterparties b ON d.counterparty_b_id = b.id
        WHERE d.status = 'open'
        ORDER BY d.severity DESC, d.confidence DESC
        LIMIT 20
      `),

        sql<{
          id: string;
          display_name: string;
          counterparty_type: string;
          confidence: string;
          operations_count: string;
          total_income: string;
          inn: string | null;
        }>(`
        SELECT id, display_name, counterparty_type, confidence, operations_count::text, total_income::text, inn
        FROM counterparties
        WHERE source='bank_transactions' AND total_income::numeric > 0
        ORDER BY total_income::numeric DESC
        LIMIT 10
      `),

        sql<{
          id: string;
          display_name: string;
          counterparty_type: string;
          confidence: string;
          operations_count: string;
          total_expense: string;
          inn: string | null;
        }>(`
        SELECT id, display_name, counterparty_type, confidence, operations_count::text, total_expense::text, inn
        FROM counterparties
        WHERE source='bank_transactions' AND total_expense::numeric > 0
        ORDER BY total_expense::numeric DESC
        LIMIT 10
      `),

        sql<{
          tx_id: string;
          direction: string;
          amount: string;
          counterparty_name: string | null;
          operation_date: string | null;
        }>(`
        SELECT bt.id::text AS tx_id, bt.direction, bt.amount::text, bt.counterparty_name, bt.operation_date::text
        FROM bank_transactions bt
        WHERE NOT EXISTS (
          SELECT 1 FROM bank_transaction_counterparty_links l WHERE l.bank_transaction_id = bt.id::text
        )
        LIMIT 10
      `),
      ]);

      // ── 2. Type breakdown with income/expense totals ──────────────────────────
      const typeBreakdown: Record<
        string,
        { count: number; totalIncome: number; totalExpense: number }
      > = {};
      for (const r of byType) {
        typeBreakdown[r.counterparty_type] = {
          count: Number(r.cnt),
          totalIncome: Number(r.total_income),
          totalExpense: Number(r.total_expense),
        };
      }

      const confidenceBreakdown: Record<string, number> = {};
      for (const r of byConfidence) {
        confidenceBreakdown[r.confidence] = Number(r.cnt);
      }

      // ── 3. Issues ────────────────────────────────────────────────────────────
      const totalCounterparties = Number(totals?.total ?? 0);
      const totalLinks = Number(totals?.links ?? 0);
      const linkedTx = Number(txLinkCoverage?.linked_tx ?? 0);
      const totalTx = Number(txLinkCoverage?.total_tx ?? 0);
      const unlinkedTx = Number(txLinkCoverage?.unlinked_tx ?? 0);
      const dupOpen = Number(totals?.dup_candidates ?? 0);

      const issues: Array<{
        issueType: string;
        severity: string;
        count: number;
        description: string;
        recommendedAction: string;
      }> = [];

      if (totalCounterparties === 0) {
        issues.push({
          issueType: "no_counterparties",
          severity: "CRITICAL",
          count: 0,
          description:
            "No counterparties found. Run approved offline or scoped workflow first.",
          recommendedAction:
            "Run the build-counterparties-from-bank sync endpoint.",
        });
      }

      if (unlinkedTx > 0) {
        issues.push({
          issueType: "counterparty_transaction_unlinked",
          severity: unlinkedTx > 50 ? "HIGH" : "MEDIUM",
          count: unlinkedTx,
          description: `${unlinkedTx} bank transactions have no counterparty link.`,
          recommendedAction:
            "Re-run approved offline or scoped workflow to link all transactions.",
        });
      }

      const unknownCount = typeBreakdown["unknown"]?.count ?? 0;
      if (unknownCount > 0) {
        issues.push({
          issueType: "counterparty_unknown",
          severity: unknownCount > 10 ? "MEDIUM" : "LOW",
          count: unknownCount,
          description: `${unknownCount} counterparties classified as 'unknown' — insufficient data for classification.`,
          recommendedAction: "Manual review of unknown counterparties.",
        });
      }

      const lowConfidenceCount = confidenceBreakdown["low"] ?? 0;
      if (lowConfidenceCount > 0) {
        issues.push({
          issueType: "counterparty_type_low_confidence",
          severity: "LOW",
          count: lowConfidenceCount,
          description: `${lowConfidenceCount} counterparties have low confidence classification. Requires review.`,
          recommendedAction:
            "Review parent_client and employee_or_self_employed low-confidence entries in P8.4.",
        });
      }

      if (dupOpen > 0) {
        issues.push({
          issueType: "counterparty_duplicate_candidate",
          severity: dupOpen > 5 ? "MEDIUM" : "LOW",
          count: dupOpen,
          description: `${dupOpen} open duplicate candidate pairs detected.`,
          recommendedAction:
            "Review duplicate candidates manually. Do NOT auto-merge.",
        });
      }

      const internalCount = internalTransfers.length;
      if (internalCount > 0) {
        issues.push({
          issueType: "counterparty_own_account_transfer",
          severity: "INFO",
          count: internalCount,
          description: `${internalCount} counterparties flagged as own-account / internal transfers. These must be excluded from revenue/expense in P8.4.`,
          recommendedAction:
            "Verify all own-account transfers have exclude_from_revenue_expense=true.",
        });
      }

      const parentCandidates = typeBreakdown["parent_client"]?.count ?? 0;
      if (parentCandidates > 0) {
        issues.push({
          issueType: "counterparty_parent_candidate_needs_alpha_match",
          severity: "INFO",
          count: parentCandidates,
          description: `${parentCandidates} parent_client candidates require AlphaCRM family matching (P8.4).`,
          recommendedAction:
            "Match parent_client counterparties to crm_payments in P8.4.",
        });
      }

      const supplierCandidates =
        (typeBreakdown["contractor"]?.count ?? 0) +
        (typeBreakdown["employee_or_self_employed"]?.count ?? 0);
      if (supplierCandidates > 0) {
        issues.push({
          issueType: "counterparty_supplier_candidate_needs_review",
          severity: "INFO",
          count: supplierCandidates,
          description: `${supplierCandidates} contractor/employee counterparties need review before use in ОПиУ.`,
          recommendedAction: "Review and confirm in P8.3 manual review step.",
        });
      }

      // ── 4. Readiness verdict ─────────────────────────────────────────────────
      let counterpartyFoundationReadiness: string;
      let readinessReason: string;
      let nextRecommendedStep: string;

      const criticalIssues = issues.filter(
        (i) => i.severity === "CRITICAL",
      ).length;
      const highIssues = issues.filter((i) => i.severity === "HIGH").length;
      const linkCoverage = totalTx > 0 ? linkedTx / totalTx : 0;

      if (totalCounterparties === 0 || criticalIssues > 0) {
        counterpartyFoundationReadiness = "NOT_READY";
        readinessReason =
          "No counterparties have been extracted. Run the sync first.";
        nextRecommendedStep = "approved offline or scoped workflow";
      } else if (highIssues > 0 || linkCoverage < 0.95) {
        counterpartyFoundationReadiness = "PARTIAL";
        readinessReason = `${totalCounterparties} counterparties created, ${linkedTx}/${totalTx} transactions linked (${Math.round(linkCoverage * 100)}%). Some issues require attention.`;
        nextRecommendedStep =
          "Investigate unlinked transactions, then proceed to P8.4 reconciliation review.";
      } else {
        counterpartyFoundationReadiness = "READY_WITH_REVIEW";
        readinessReason = `${totalCounterparties} counterparties from bank transactions. ${linkedTx}/${totalTx} transactions linked (${Math.round(linkCoverage * 100)}%). Internal transfers flagged. Duplicate candidates isolated. Low-confidence types need P8.4 manual review.`;
        nextRecommendedStep =
          "P8.4 — Bank ↔ AlphaCRM Reconciliation can start. Low-confidence type review can proceed in parallel.";
      }

      // ── 5. Source diagnostics ─────────────────────────────────────────────────
      // P8.2 proven: 854 normalized bank transactions in production.
      // If totalTx === 0 here, the tables exist but are empty — sync hasn't run yet.
      const P82_EXPECTED_TX = 854;
      const sourceMatchesP82 = totalTx === P82_EXPECTED_TX;
      const sourceMismatch = totalTx !== P82_EXPECTED_TX;
      const sourceMismatchNote =
        totalTx === 0
          ? "bank_transactions table is empty in this environment. Run approved offline or scoped workflow — it requires 854 production transactions verified in P8.2."
          : sourceMismatch
            ? `bank_transactions count is ${totalTx}, P8.2 proved ${P82_EXPECTED_TX}. Possible data change since P8.2.`
            : null;

      return res.json({
        auditType: "counterparties-audit-p83",
        generatedAt: new Date().toISOString(),

        environment: {
          dbKind: "production",
          auditValidity: "VALID_PRODUCTION",
          isProduction: true,
          dbName,
          nodeEnv,
          sourceTransactionCount: totalTx,
          p82ExpectedCount: P82_EXPECTED_TX,
          sourceMatchesP82,
          sourceMismatch,
          sourceMismatchNote,
        },

        summary: {
          totalCounterparties,
          fromBankTransactions: Number(totals?.from_bank ?? 0),
          totalAliases: Number(totals?.aliases ?? 0),
          totalLinks,
          linkedTransactions: linkedTx,
          totalBankTransactions: totalTx,
          unlinkedTransactions: unlinkedTx,
          linkCoveragePct: Math.round(linkCoverage * 100),
          openDuplicateCandidates: dupOpen,
        },

        byType: typeBreakdown,
        byConfidence: confidenceBreakdown,

        internalTransfers: internalTransfers.map((cp) => ({
          id: cp.id,
          canonicalKey: cp.canonical_key,
          displayName: cp.display_name,
          totalIncome: Number(cp.total_income),
          totalExpense: Number(cp.total_expense),
          operationsCount: Number(cp.operations_count),
          riskFlags: cp.risk_flags,
          note: "Own-account or internal transfer — must be excluded from revenue/expense in P8.4.",
        })),

        topIncomeCounterparties: topIncome.map((c) => ({
          id: c.id,
          displayName: c.display_name,
          inn: c.inn,
          type: c.counterparty_type,
          confidence: c.confidence,
          operationsCount: Number(c.operations_count),
          totalIncome: Number(c.total_income),
        })),
        topExpenseCounterparties: topExpense.map((c) => ({
          id: c.id,
          displayName: c.display_name,
          inn: c.inn,
          type: c.counterparty_type,
          confidence: c.confidence,
          operationsCount: Number(c.operations_count),
          totalExpense: Number(c.total_expense),
        })),

        duplicateCandidates: dupCandidates.map((d) => ({
          counterpartyAId: d.counterparty_a_id,
          counterpartyBId: d.counterparty_b_id,
          aName: d.a_name,
          bName: d.b_name,
          reason: d.reason,
          confidence: d.confidence,
          severity: d.severity,
        })),

        unlinkedTransactionSamples: noLinks.map((t) => ({
          id: t.tx_id,
          direction: t.direction,
          amount: Number(t.amount),
          counterpartyName: t.counterparty_name,
          operationDate: t.operation_date,
        })),

        issues,
        issueSummary: {
          total: issues.length,
          critical: issues.filter((i) => i.severity === "CRITICAL").length,
          high: issues.filter((i) => i.severity === "HIGH").length,
          medium: issues.filter((i) => i.severity === "MEDIUM").length,
          low: issues.filter((i) => i.severity === "LOW").length,
          info: issues.filter((i) => i.severity === "INFO").length,
        },

        counterpartyFoundationReadiness,
        readinessReason,
        nextRecommendedStep,
        p84CanStart: counterpartyFoundationReadiness !== "NOT_READY",

        warnings: [
          "⚠️ Do NOT treat parent_client counterparties as confirmed clients until AlphaCRM matching (P8.4).",
          "⚠️ Do NOT build final ДДС or ОПиУ — bank reconciliation (P8.4) is required first.",
          "⚠️ Do NOT auto-merge duplicate candidates. Manual review only.",
          "ℹ️ Internal transfers (exclude_from_revenue_expense=true) must be excluded from all P&L calculations.",
          `ℹ️ ${typeBreakdown["parent_client"]?.count ?? 0} parent_client candidates need AlphaCRM family matching in P8.4.`,
        ],
      });
    } catch (err) {
      logger.error({ err }, "counterparties-audit failed");
      return void res.status(500).json({ error: String(err) });
    }
  },
);
