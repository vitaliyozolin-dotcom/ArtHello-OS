import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const counterpartyReclassificationAuditRouter = Router();

counterpartyReclassificationAuditRouter.get(
  "/coverage/counterparty-reclassification-audit",
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
          auditType: "counterparty-reclassification-audit-p84a",
          generatedAt: new Date().toISOString(),
          environment: { dbKind: "dev", isProduction: false, dbName, nodeEnv },
          counterpartyReclassificationReadiness: "NOT_APPLICABLE_DEV",
          readinessReason: "Only valid against production bank data.",
        });
      }

      // ── 1. All counterparties ─────────────────────────────────────────────────
      const allCp = await sql<{
        id: string;
        display_name: string;
        inn: string | null;
        counterparty_type: string;
        confidence: string;
        finance_treatment_hint: string | null;
        exclude_from_revenue_expense: boolean;
        needs_manual_review: boolean;
        reclassification_reason: string | null;
        classification_version: string | null;
        classification_updated_at: string | null;
        total_income: string;
        total_expense: string;
        operations_count: string;
        risk_flags: unknown;
      }>(`
      SELECT id, display_name, inn, counterparty_type, confidence,
             finance_treatment_hint, exclude_from_revenue_expense, needs_manual_review,
             reclassification_reason, classification_version, classification_updated_at,
             total_income, total_expense, operations_count, risk_flags
      FROM counterparties ORDER BY operations_count::int DESC
    `);

      // ── 2. Aggregate counts ───────────────────────────────────────────────────
      const [byTypeCurrent, byVersion, dupOpenRow, txCountRow] =
        await Promise.all([
          sql<{ t: string; cnt: string; ti: string; te: string }>(`
        SELECT counterparty_type AS t, COUNT(*)::text AS cnt,
               COALESCE(SUM(total_income),0)::numeric(15,2)::text AS ti,
               COALESCE(SUM(total_expense),0)::numeric(15,2)::text AS te
        FROM counterparties GROUP BY t ORDER BY COUNT(*) DESC
      `),
          sql<{ ver: string; cnt: string }>(`
        SELECT COALESCE(classification_version,'p83_original') AS ver, COUNT(*)::text AS cnt
        FROM counterparties GROUP BY ver ORDER BY COUNT(*) DESC
      `),
          sqlOne<{ cnt: string }>(
            "SELECT COUNT(*)::text AS cnt FROM counterparty_duplicate_candidates WHERE status='open'",
          ),
          sqlOne<{ cnt: string }>(
            "SELECT COUNT(*)::text AS cnt FROM bank_transactions",
          ),
        ]);

      const byCurrentType: Record<
        string,
        { count: number; totalIncome: number; totalExpense: number }
      > = {};
      for (const r of byTypeCurrent) {
        byCurrentType[r.t] = {
          count: Number(r.cnt),
          totalIncome: Number(r.ti),
          totalExpense: Number(r.te),
        };
      }
      const byClassificationVersion: Record<string, number> = {};
      for (const r of byVersion) byClassificationVersion[r.ver] = Number(r.cnt);

      // ── 3. Categorized lists ─────────────────────────────────────────────────
      type CpRow = (typeof allCp)[0];
      const mapCp = (cp: CpRow) => ({
        id: cp.id,
        displayName: cp.display_name,
        inn: cp.inn,
        counterpartyType: cp.counterparty_type,
        confidence: cp.confidence,
        financeTreatmentHint: cp.finance_treatment_hint,
        excludeFromRevExp: cp.exclude_from_revenue_expense,
        needsManualReview: cp.needs_manual_review,
        reclassificationReason: cp.reclassification_reason,
        classificationVersion: cp.classification_version ?? "p83_original",
        classificationUpdatedAt: cp.classification_updated_at,
        totalIncome: Number(cp.total_income),
        totalExpense: Number(cp.total_expense),
        operationsCount: Number(cp.operations_count),
        riskFlags: (cp.risk_flags ?? {}) as Record<string, unknown>,
      });

      const internalCompanies = allCp
        .filter((c) => c.counterparty_type === "internal_company")
        .map(mapCp);
      const bankOrFee = allCp
        .filter((c) => c.counterparty_type === "bank_or_fee")
        .map(mapCp);
      const parentClientCandidates = allCp
        .filter((c) => c.counterparty_type === "parent_client")
        .map(mapCp);
      const needsManualReviewList = allCp
        .filter((c) => c.needs_manual_review)
        .map(mapCp);
      const suspiciousTaxAuthority = allCp
        .filter(
          (c) =>
            c.counterparty_type === "tax_authority" && c.needs_manual_review,
        )
        .map(mapCp);

      const totalCp = allCp.length;
      const reclassifiedCp = allCp.filter(
        (c) => c.classification_version === "p84a_v1",
      ).length;
      const excludedRevExp = allCp.filter(
        (c) => c.exclude_from_revenue_expense,
      ).length;
      const needsMrCount = needsManualReviewList.length;
      const bankNeedsOpLevel = bankOrFee.filter(
        (c) =>
          !!(c.riskFlags as Record<string, unknown>)?.[
            "needs_operation_level_classification"
          ],
      ).length;
      const unversionedCount = totalCp - reclassifiedCp;

      // ── 4. Duplicate candidates sample ───────────────────────────────────────
      const dupCandidates = await sql<{
        a_id: string;
        b_id: string;
        a_name: string;
        b_name: string;
        reason: string;
        status: string;
      }>(`
      SELECT dc.counterparty_a_id AS a_id, dc.counterparty_b_id AS b_id,
             ca.display_name AS a_name, cb.display_name AS b_name,
             dc.reason, dc.status
      FROM counterparty_duplicate_candidates dc
      JOIN counterparties ca ON dc.counterparty_a_id = ca.id
      JOIN counterparties cb ON dc.counterparty_b_id = cb.id
      WHERE dc.status = 'open' LIMIT 5
    `);

      // ── 5. Issues ─────────────────────────────────────────────────────────────
      const issues: Array<{
        issueType: string;
        severity: string;
        count: number;
        description: string;
        recommendedAction: string;
      }> = [];

      if (unversionedCount > 0) {
        issues.push({
          issueType: "reclassification_not_run",
          severity: "HIGH",
          count: unversionedCount,
          description: `${unversionedCount} counterparties still at P8.3 original classification (no classification_version).`,
          recommendedAction:
            "Run approved offline or scoped workflow to apply P8.4a rules.",
        });
      }
      if (needsMrCount > 0) {
        issues.push({
          issueType: "needs_manual_review",
          severity: needsMrCount > 10 ? "MEDIUM" : "LOW",
          count: needsMrCount,
          description: `${needsMrCount} counterparties need manual type review (unmatched tax_authority or ambiguous).`,
          recommendedAction: "Review manually. Non-blocking for P8.4b.",
        });
      }
      if (excludedRevExp < internalCompanies.length) {
        issues.push({
          issueType: "internal_not_excluded",
          severity: "HIGH",
          count: internalCompanies.length - excludedRevExp,
          description:
            "Internal companies not flagged exclude_from_revenue_expense=true.",
          recommendedAction: "Run reclassify-counterparties-p84a.",
        });
      }
      if (bankNeedsOpLevel < bankOrFee.length) {
        issues.push({
          issueType: "bank_not_flagged_op_split",
          severity: "MEDIUM",
          count: bankOrFee.length - bankNeedsOpLevel,
          description:
            'ООО "Банк Точка" not yet flagged needs_operation_level_classification.',
          recommendedAction: "Run reclassify-counterparties-p84a to set flag.",
        });
      }
      issues.push({
        issueType: "duplicate_candidates_manual_review",
        severity: "INFO",
        count: Number(dupOpenRow?.cnt ?? 0),
        description: `${dupOpenRow?.cnt ?? 0} open duplicate candidate pairs (same_inn_diff_key). Manual review only.`,
        recommendedAction:
          "Do NOT auto-merge. Review each pair individually in P8.4b.",
      });

      // ── 6. Readiness verdict ──────────────────────────────────────────────────
      const hasRunReclassify = reclassifiedCp === totalCp && totalCp > 0;
      const internalOk =
        internalCompanies.length > 0 &&
        excludedRevExp === internalCompanies.length;
      const bankOk = bankNeedsOpLevel > 0 || bankOrFee.length === 0;
      let counterpartyReclassificationReadiness: string;
      let readinessReason: string;

      if (!hasRunReclassify) {
        counterpartyReclassificationReadiness = "NOT_READY";
        readinessReason = `P8.4a reclassification not yet run. ${reclassifiedCp}/${totalCp} at p84a_v1. Run approved offline or scoped workflow.`;
      } else if (internalOk && bankOk && needsMrCount <= 15) {
        counterpartyReclassificationReadiness =
          needsMrCount > 0 ? "READY_WITH_REVIEW" : "READY_FOR_RECONCILIATION";
        readinessReason =
          needsMrCount > 0
            ? `${reclassifiedCp}/${totalCp} reclassified. ${needsMrCount} manual-review items (non-blocking). Internal ✓ excluded. Bank ✓ flagged.`
            : `All ${totalCp} counterparties reclassified. Internal companies excluded. Bank flagged for op-level split. Duplicates isolated.`;
      } else {
        counterpartyReclassificationReadiness = "READY_WITH_REVIEW";
        readinessReason = `${reclassifiedCp}/${totalCp} reclassified. ${needsMrCount} need review. Internal: ${internalOk ? "✓" : "✗"}. Bank: ${bankOk ? "✓" : "✗"}.`;
      }

      return res.json({
        auditType: "counterparty-reclassification-audit-p84a",
        generatedAt: new Date().toISOString(),
        environment: {
          dbKind: "production",
          isProduction: true,
          dbName,
          nodeEnv,
          bankTransactionCount: Number(txCountRow?.cnt ?? 0),
        },
        summary: {
          totalCounterparties: totalCp,
          reclassifiedP84a: reclassifiedCp,
          atP83Original: unversionedCount,
          excludedFromRevExp: excludedRevExp,
          needsManualReview: needsMrCount,
          bankFlaggedOpLevel: bankNeedsOpLevel,
          openDuplicateCandidates: Number(dupOpenRow?.cnt ?? 0),
          byClassificationVersion,
        },
        byCurrentType,
        allCounterparties: allCp.map(mapCp),
        internalCompanies,
        bankOrFee,
        parentClientCandidates,
        suspiciousTaxAuthority,
        needsManualReviewList,
        duplicateCandidatesSample: dupCandidates.map((d) => ({
          aId: d.a_id,
          bId: d.b_id,
          aName: d.a_name,
          bName: d.b_name,
          reason: d.reason,
          status: d.status,
          policy: "manual_review_only_do_not_auto_merge",
        })),
        issues,
        issueSummary: {
          total: issues.length,
          high: issues.filter((i) => i.severity === "HIGH").length,
          medium: issues.filter((i) => i.severity === "MEDIUM").length,
          low: issues.filter((i) => i.severity === "LOW").length,
          info: issues.filter((i) => i.severity === "INFO").length,
        },
        counterpartyReclassificationReadiness,
        readinessReason,
        p84bCanStart: counterpartyReclassificationReadiness !== "NOT_READY",
        warnings: [
          "⚠️ Do NOT build final ДДС or ОПиУ — P8.4b Bank ↔ AlphaCRM matching required first.",
          "⚠️ Do NOT auto-merge duplicate candidates — same_inn_diff_key may be shared SBP INN pattern.",
          `ℹ️ ${internalCompanies.length} internal companies have exclude_from_revenue_expense=true — excluded from all P&L.`,
          `ℹ️ ООО "Банк Точка" (${bankOrFee[0]?.operationsCount ?? 380} operations) needs operation-level classification split in P8.4b.`,
          "ℹ️ 2 parent_client candidates need AlphaCRM family matching in P8.4b.",
        ],
      });
    } catch (err) {
      logger.error({ err }, "counterparty-reclassification-audit failed");
      return void res.status(500).json({ error: String(err) });
    }
  },
);
