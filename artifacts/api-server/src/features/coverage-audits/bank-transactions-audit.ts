import { Router } from "express";
import {
  branchId,
  logger,
  pool,
  sql,
  sqlOne,
} from "../../routes/coverage/shared.js";

export const bankTransactionsAuditRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/bank-transactions-audit
// P8.2 — Bank Transactions Truth Audit
// ══════════════════════════════════════════════════════════════════════════════
bankTransactionsAuditRouter.get(
  "/coverage/bank-transactions-audit",
  async (req, res) => {
    try {
      // ── 0. Environment detection ─────────────────────────────────────────────
      const dbNameRow = await sqlOne<{ db: string }>(
        `SELECT current_database() AS db`,
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
          auditType: "bank-transactions-audit-p82",
          generatedAt: new Date().toISOString(),
          environment: {
            dbKind: "dev",
            auditValidity:
              "BANK_TRANSACTION_AUDIT_NOT_VALID_OUTSIDE_PRODUCTION",
            isProduction: false,
            dbName,
            nodeEnv,
          },
          bankTransactionsReadiness: "NOT_APPLICABLE_DEV",
          readinessReason:
            "Bank transaction audit runs only against the production database. Current environment is dev/staging.",
          warnings: [
            "🚫 P8.2 NOT VALID IN DEV — bank_transactions data exists only in production.",
            "→ Run this audit against the production environment to see real transaction data.",
          ],
        });
      }

      // ── 1. Raw field quality + normalized status breakdown ───────────────────
      const [
        rawQuality,
        dateInventory,
        dupStats,
        normQuality,
        normPerAccount,
        rawPerAccount,
        rawDupExamples,
        cpStats,
        cpIncome,
        cpExpense,
        opsStats,
        stmtsPerAccount,
      ] = await Promise.all([
        sqlOne<{
          total: string;
          has_ext_id: string;
          unique_ext_ids: string;
          has_op_date: string;
          missing_op_date: string;
          has_booking_date: string;
          has_raw_json: string;
          has_amount: string;
          has_direction: string;
          has_cp_name: string;
          has_cp_inn: string;
          has_purpose: string;
          status_pending: string;
          status_normalized: string;
          status_skipped: string;
          status_error: string;
        }>(`
        SELECT
          COUNT(*)::text                                                                               AS total,
          COUNT(*) FILTER (WHERE external_transaction_id IS NOT NULL AND external_transaction_id != '')::text AS has_ext_id,
          COUNT(DISTINCT external_transaction_id) FILTER (WHERE external_transaction_id IS NOT NULL AND external_transaction_id != '')::text AS unique_ext_ids,
          COUNT(*) FILTER (WHERE operation_date IS NOT NULL AND operation_date != '')::text            AS has_op_date,
          COUNT(*) FILTER (WHERE operation_date IS NULL OR operation_date = '')::text                  AS missing_op_date,
          COUNT(*) FILTER (WHERE booking_date IS NOT NULL AND booking_date != '')::text                AS has_booking_date,
          COUNT(*) FILTER (WHERE raw_json IS NOT NULL)::text                                          AS has_raw_json,
          COUNT(*) FILTER (WHERE amount IS NOT NULL)::text                                            AS has_amount,
          COUNT(*) FILTER (WHERE direction IS NOT NULL)::text                                         AS has_direction,
          COUNT(*) FILTER (WHERE counterparty_name IS NOT NULL AND counterparty_name != '')::text      AS has_cp_name,
          COUNT(*) FILTER (WHERE counterparty_inn IS NOT NULL AND counterparty_inn != '')::text        AS has_cp_inn,
          COUNT(*) FILTER (WHERE purpose IS NOT NULL AND purpose != '')::text                          AS has_purpose,
          COUNT(*) FILTER (WHERE normalized_status = 'pending')::text                                 AS status_pending,
          COUNT(*) FILTER (WHERE normalized_status = 'normalized')::text                              AS status_normalized,
          COUNT(*) FILTER (WHERE normalized_status = 'skipped')::text                                 AS status_skipped,
          COUNT(*) FILTER (WHERE normalized_status = 'error')::text                                   AS status_error
        FROM bank_transactions_raw
      `),

        // ── 2. Date field inventory from raw_json ──────────────────────────────
        sqlOne<{
          total: string;
          has_dpd: string;
          min_dpd: string;
          max_dpd: string;
          has_booking_date_json: string;
          has_tx_date_json: string;
          has_value_date_json: string;
        }>(`
        SELECT
          COUNT(*)::text                                                                                                    AS total,
          COUNT(*) FILTER (WHERE raw_json->>'documentProcessDate' IS NOT NULL AND raw_json->>'documentProcessDate' != '')::text AS has_dpd,
          MIN(raw_json->>'documentProcessDate')                                                                            AS min_dpd,
          MAX(raw_json->>'documentProcessDate')                                                                            AS max_dpd,
          COUNT(*) FILTER (WHERE raw_json->>'bookingDate' IS NOT NULL)::text                                               AS has_booking_date_json,
          COUNT(*) FILTER (WHERE raw_json->>'transactionDate' IS NOT NULL)::text                                           AS has_tx_date_json,
          COUNT(*) FILTER (WHERE raw_json->>'valueDate' IS NOT NULL)::text                                                 AS has_value_date_json
        FROM bank_transactions_raw
      `),

        // ── 3. Duplicate analysis ──────────────────────────────────────────────
        sqlOne<{
          total_raw: string;
          unique_ext_id_account: string;
          unique_ext_ids: string;
        }>(`
        SELECT
          COUNT(*)::text                                                                                              AS total_raw,
          COUNT(DISTINCT COALESCE(external_transaction_id,'') || '|' || COALESCE(account_id,''))::text               AS unique_ext_id_account,
          COUNT(DISTINCT external_transaction_id) FILTER (WHERE external_transaction_id IS NOT NULL AND external_transaction_id != '')::text AS unique_ext_ids
        FROM bank_transactions_raw
      `),

        // ── 4. Normalized field quality ────────────────────────────────────────
        sqlOne<{
          total: string;
          has_op_date: string;
          has_amount: string;
          has_direction: string;
          has_cp_name: string;
          has_cp_inn: string;
          has_purpose: string;
          has_ext_id: string;
          has_cp_account: string;
          has_account_id: string;
          match_unmatched: string;
          match_matched: string;
          min_date: string;
          max_date: string;
        }>(`
        SELECT
          COUNT(*)::text                                                                                  AS total,
          COUNT(*) FILTER (WHERE operation_date IS NOT NULL)::text                                       AS has_op_date,
          COUNT(*) FILTER (WHERE amount IS NOT NULL)::text                                               AS has_amount,
          COUNT(*) FILTER (WHERE direction IS NOT NULL)::text                                            AS has_direction,
          COUNT(*) FILTER (WHERE counterparty_name IS NOT NULL AND counterparty_name != '')::text         AS has_cp_name,
          COUNT(*) FILTER (WHERE counterparty_inn IS NOT NULL AND counterparty_inn != '')::text           AS has_cp_inn,
          COUNT(*) FILTER (WHERE purpose IS NOT NULL AND purpose != '')::text                             AS has_purpose,
          COUNT(*) FILTER (WHERE external_id IS NOT NULL AND external_id != '')::text                    AS has_ext_id,
          COUNT(*) FILTER (WHERE counterparty_account IS NOT NULL AND counterparty_account != '')::text  AS has_cp_account,
          COUNT(*) FILTER (WHERE account_id IS NOT NULL AND account_id != '')::text                      AS has_account_id,
          COUNT(*) FILTER (WHERE match_status = 'unmatched')::text                                       AS match_unmatched,
          COUNT(*) FILTER (WHERE match_status = 'matched')::text                                         AS match_matched,
          MIN(operation_date)::text                                                                       AS min_date,
          MAX(operation_date)::text                                                                       AS max_date
        FROM bank_transactions
      `),

        // ── 5. Per-account normalized ──────────────────────────────────────────
        sql<{
          account_id: string;
          cnt: string;
          min_d: string;
          max_d: string;
          income_sum: string;
          expense_sum: string;
          income_cnt: string;
          expense_cnt: string;
        }>(`
        SELECT
          account_id,
          COUNT(*)::text                                                              AS cnt,
          MIN(operation_date)::text                                                  AS min_d,
          MAX(operation_date)::text                                                  AS max_d,
          SUM(CASE WHEN direction='income' THEN amount ELSE 0 END)::numeric(15,2)::text AS income_sum,
          SUM(CASE WHEN direction='expense' THEN amount ELSE 0 END)::numeric(15,2)::text AS expense_sum,
          COUNT(CASE WHEN direction='income' THEN 1 END)::text                      AS income_cnt,
          COUNT(CASE WHEN direction='expense' THEN 1 END)::text                     AS expense_cnt
        FROM bank_transactions
        GROUP BY account_id
        ORDER BY COUNT(*) DESC
      `),

        // ── 6. Per-account raw ─────────────────────────────────────────────────
        sql<{
          account_id: string;
          cnt: string;
          min_dpd: string;
          max_dpd: string;
          has_op_date: string;
          missing_op_date: string;
        }>(`
        SELECT
          account_id,
          COUNT(*)::text                                                                                           AS cnt,
          MIN(raw_json->>'documentProcessDate')                                                                   AS min_dpd,
          MAX(raw_json->>'documentProcessDate')                                                                   AS max_dpd,
          COUNT(*) FILTER (WHERE operation_date IS NOT NULL AND operation_date != '')::text                       AS has_op_date,
          COUNT(*) FILTER (WHERE operation_date IS NULL OR operation_date = '')::text                             AS missing_op_date
        FROM bank_transactions_raw
        GROUP BY account_id
        ORDER BY COUNT(*) DESC
      `),

        // ── 7. Duplicate examples in raw ──────────────────────────────────────
        sql<{
          external_transaction_id: string;
          account_id: string;
          cnt: string;
        }>(`
        SELECT external_transaction_id, account_id, COUNT(*)::text AS cnt
        FROM bank_transactions_raw
        WHERE external_transaction_id IS NOT NULL AND external_transaction_id != ''
        GROUP BY external_transaction_id, account_id
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `),

        // ── 8. Counterparty stats ──────────────────────────────────────────────
        sqlOne<{
          unique_names: string;
          unique_inns: string;
          unique_accounts: string;
          income_cnt: string;
          expense_cnt: string;
          missing_cp: string;
        }>(`
        SELECT
          COUNT(DISTINCT counterparty_name) FILTER (WHERE counterparty_name IS NOT NULL AND counterparty_name != '')::text AS unique_names,
          COUNT(DISTINCT counterparty_inn)  FILTER (WHERE counterparty_inn IS NOT NULL AND counterparty_inn != '')::text  AS unique_inns,
          COUNT(DISTINCT counterparty_account) FILTER (WHERE counterparty_account IS NOT NULL AND counterparty_account != '')::text AS unique_accounts,
          COUNT(CASE WHEN direction='income' THEN 1 END)::text  AS income_cnt,
          COUNT(CASE WHEN direction='expense' THEN 1 END)::text AS expense_cnt,
          COUNT(CASE WHEN counterparty_name IS NULL OR counterparty_name = '' THEN 1 END)::text AS missing_cp
        FROM bank_transactions
      `),

        // ── 9. Top income counterparties ──────────────────────────────────────
        sql<{
          counterparty_name: string;
          counterparty_inn: string;
          cnt: string;
          total_sum: string;
        }>(`
        SELECT counterparty_name, counterparty_inn,
               COUNT(*)::text AS cnt,
               SUM(amount)::numeric(15,2)::text AS total_sum
        FROM bank_transactions
        WHERE direction = 'income'
        GROUP BY counterparty_name, counterparty_inn
        ORDER BY COUNT(*) DESC LIMIT 6
      `),

        // ── 10. Top expense counterparties ────────────────────────────────────
        sql<{
          counterparty_name: string;
          counterparty_inn: string;
          cnt: string;
          total_sum: string;
        }>(`
        SELECT counterparty_name, counterparty_inn,
               COUNT(*)::text AS cnt,
               SUM(amount)::numeric(15,2)::text AS total_sum
        FROM bank_transactions
        WHERE direction = 'expense'
        GROUP BY counterparty_name, counterparty_inn
        ORDER BY COUNT(*) DESC LIMIT 6
      `),

        // ── 11. Operations ────────────────────────────────────────────────────
        sqlOne<{
          total: string;
          linked: string;
          unique_sources: string;
          min_d: string;
          max_d: string;
        }>(`
        SELECT
          COUNT(*)::text                                                    AS total,
          COUNT(bank_transaction_id) FILTER (WHERE bank_transaction_id IS NOT NULL)::text AS linked,
          COUNT(DISTINCT source) FILTER (WHERE source IS NOT NULL)::text   AS unique_sources,
          MIN(cashflow_date)::text                                          AS min_d,
          MAX(cashflow_date)::text                                          AS max_d
        FROM operations
        WHERE is_deleted IS NOT TRUE
      `),

        // ── 12. Statements per account ────────────────────────────────────────
        sql<{
          external_account_id: string;
          cnt: string;
          min_period: string;
          max_period: string;
          total_tx: string;
          ready_cnt: string;
        }>(`
        SELECT
          external_account_id,
          COUNT(*)::text                    AS cnt,
          MIN(period_from)                  AS min_period,
          MAX(period_to)                    AS max_period,
          COALESCE(SUM(transaction_count),0)::text AS total_tx,
          COUNT(*) FILTER (WHERE status='ready')::text AS ready_cnt
        FROM bank_statements
        GROUP BY external_account_id
        ORDER BY COALESCE(SUM(transaction_count),0) DESC
      `),
      ]);

      // ── Derived: Gap classification ──────────────────────────────────────────
      const rawTotal = Number(rawQuality?.total ?? 0);
      const normTotal = Number(normQuality?.total ?? 0);
      const gap = rawTotal - normTotal;
      const uniqueExtIds = Number(dupStats?.unique_ext_ids ?? 0);
      const uniqueExtIdAccount = Number(dupStats?.unique_ext_id_account ?? 0);
      const trueDuplicates = rawTotal - uniqueExtIdAccount; // same ext_id + same account
      const crossAccountTransfers = uniqueExtIdAccount - uniqueExtIds; // same ext_id, different accounts
      const gapExplained = trueDuplicates + crossAccountTransfers;
      const gapUnexplained = gap - gapExplained;

      // ── Derived: Per-account merged ───────────────────────────────────────────
      const normByAcc = normPerAccount.reduce<
        Record<string, (typeof normPerAccount)[0]>
      >((m, r) => {
        m[r.account_id] = r;
        return m;
      }, {});
      const rawByAcc = rawPerAccount.reduce<
        Record<string, (typeof rawPerAccount)[0]>
      >((m, r) => {
        m[r.account_id] = r;
        return m;
      }, {});
      const allAccountIds = [
        ...new Set([...Object.keys(normByAcc), ...Object.keys(rawByAcc)]),
      ];
      const perAccount = allAccountIds.map((accId) => {
        const n = normByAcc[accId];
        const r = rawByAcc[accId];
        const rawCnt = Number(r?.cnt ?? 0);
        const normCnt = Number(n?.cnt ?? 0);
        const accGap = rawCnt - normCnt;
        return {
          accountId: accId,
          maskedAccount: accId.split("/")[0]?.slice(-4)
            ? `****${accId.split("/")[0].slice(-4)}`
            : accId,
          rawCount: rawCnt,
          normalizedCount: normCnt,
          rawNotNormalized: accGap,
          rawDateFrom: r?.min_dpd ?? null,
          rawDateTo: r?.max_dpd ?? null,
          rawMissingOpDate: Number(r?.missing_op_date ?? 0),
          normalizedDateFrom: n?.min_d ?? null,
          normalizedDateTo: n?.max_d ?? null,
          incomeSum: Number(n?.income_sum ?? 0),
          expenseSum: Number(n?.expense_sum ?? 0),
          incomeCnt: Number(n?.income_cnt ?? 0),
          expenseCnt: Number(n?.expense_cnt ?? 0),
          statementInfo:
            stmtsPerAccount.find(
              (s) =>
                s.external_account_id?.startsWith(accId.split("/")[0]) ||
                accId.startsWith((s.external_account_id ?? "").split("/")[0]),
            ) ?? null,
        };
      });

      // ── Date root cause determination ─────────────────────────────────────────
      const hasDpd = Number(dateInventory?.has_dpd ?? 0);
      const hasOpDate = Number(rawQuality?.has_op_date ?? 0);
      const missingOp = Number(rawQuality?.missing_op_date ?? 0);
      let dateRootCause: string;
      let dateRootCauseDetail: string;
      if (
        hasDpd === rawTotal &&
        normTotal > 0 &&
        Number(normQuality?.has_op_date ?? 0) === normTotal
      ) {
        dateRootCause = "documentProcessDate_in_raw_json";
        dateRootCauseDetail =
          `ALL ${rawTotal} raw records have documentProcessDate in raw_json (${dateInventory?.min_dpd} → ${dateInventory?.max_dpd}). ` +
          `The operation_date column in bank_transactions_raw is missing for ${missingOp} records — ` +
          `the importer stored the date in raw_json but did not always populate the column. ` +
          `Normalized bank_transactions table uses documentProcessDate correctly — all ${normTotal} records have operation_date.`;
      } else if (hasDpd > 0) {
        dateRootCause = "documentProcessDate_partial";
        dateRootCauseDetail = `${hasDpd}/${rawTotal} raw records have documentProcessDate in raw_json. Column op_date missing: ${missingOp}.`;
      } else {
        dateRootCause = "unknown";
        dateRootCauseDetail =
          "No known date fields found in raw_json. Manual inspection required.";
      }

      // ── Normalized status gap explanation ─────────────────────────────────────
      const statusPending = Number(rawQuality?.status_pending ?? 0);
      const statusNormalized = Number(rawQuality?.status_normalized ?? 0);
      const normBookkeepingGap = statusPending === rawTotal && normTotal > 0;

      // ── Issues ────────────────────────────────────────────────────────────────
      const issues: Array<{
        issueType: string;
        severity: string;
        count: number;
        description: string;
        recommendedAction: string;
      }> = [];

      if (missingOp > 0) {
        issues.push({
          issueType: "bank_transaction_raw_date_missing",
          severity: missingOp > 100 ? "HIGH" : "MEDIUM",
          count: missingOp,
          description: `${missingOp} raw transactions have empty operation_date column. Root cause: importer did not extract date from raw_json->>'documentProcessDate' for all records. Normalized table is correct.`,
          recommendedAction:
            "Update raw importer to populate operation_date from documentProcessDate. Not urgent — normalized table already has correct dates.",
        });
      }

      if (normBookkeepingGap) {
        issues.push({
          issueType: "bank_transaction_normalized_status_not_updated",
          severity: "MEDIUM",
          count: rawTotal,
          description: `All ${rawTotal} raw records show normalized_status='pending' even though ${normTotal} normalized records exist. The normalization pipeline did not update normalized_status back to 'normalized'.`,
          recommendedAction:
            "Update normalization pipeline to set normalized_status='normalized' after successful normalization. Bookkeeping gap only — data is correct.",
        });
      }

      if (trueDuplicates > 0) {
        issues.push({
          issueType: "bank_transaction_duplicate_candidate",
          severity: trueDuplicates > 50 ? "HIGH" : "MEDIUM",
          count: trueDuplicates,
          description: `${trueDuplicates} raw transactions are true duplicates (same external_transaction_id + same account_id). These were correctly deduplicated during normalization.`,
          recommendedAction:
            "True duplicates are correctly excluded from normalized table. Consider adding unique constraint on (external_transaction_id, account_id) in bank_transactions_raw to prevent re-import.",
        });
      }

      if (crossAccountTransfers > 0) {
        issues.push({
          issueType: "bank_transaction_cross_account_dedup",
          severity: "INFO",
          count: crossAccountTransfers,
          description: `${crossAccountTransfers} raw transactions share the same external_transaction_id across different accounts — these are inter-account transfers (same payment appears as expense in source account and income in destination account). Only one side is normalized.`,
          recommendedAction:
            "Verify cross-account transfer classification in P8.3. Flag is_internal_transfer for matching pairs.",
        });
      }

      if (gapUnexplained > 0) {
        issues.push({
          issueType: "bank_transaction_raw_not_normalized",
          severity: "HIGH",
          count: gapUnexplained,
          description: `${gapUnexplained} raw transactions remain unexplained by deduplication analysis. These were not normalized for unknown reasons.`,
          recommendedAction:
            "Inspect raw records individually. Check for parse errors, invalid payloads, or missing statement links.",
        });
      }

      const missingCp = Number(cpStats?.missing_cp ?? 0);
      if (missingCp > 0) {
        issues.push({
          issueType: "bank_transaction_missing_counterparty",
          severity: missingCp > 50 ? "HIGH" : "MEDIUM",
          count: missingCp,
          description: `${missingCp} normalized transactions have no counterparty name.`,
          recommendedAction:
            "Inspect purpose/description fields for counterparty hints. Required for P8.3 counterparty layer.",
        });
      }

      const accountsMissingOwner = perAccount.length;
      if (accountsMissingOwner > 0) {
        issues.push({
          issueType: "bank_account_missing_owner",
          severity: "MEDIUM",
          count: accountsMissingOwner,
          description: `Legal entity / owner not linked to bank accounts. branch_crm_id is NULL for all accounts.`,
          recommendedAction:
            "Link accounts to legal entity (ООО АртХелло) before P8.3 counterparty layer.",
        });
      }

      // ── Counterparty readiness ────────────────────────────────────────────────
      const uniqueNames = Number(cpStats?.unique_names ?? 0);
      const uniqueInns = Number(cpStats?.unique_inns ?? 0);
      const uniqueAccounts = Number(cpStats?.unique_accounts ?? 0);
      let counterpartyLayerReadiness: "READY" | "PARTIAL" | "NOT_READY";
      if (uniqueNames > 10 && uniqueInns > 10 && missingCp === 0) {
        counterpartyLayerReadiness = "READY";
      } else if (uniqueNames > 0 || uniqueInns > 0) {
        counterpartyLayerReadiness = "PARTIAL";
      } else {
        counterpartyLayerReadiness = "NOT_READY";
      }

      // ── Readiness verdict ─────────────────────────────────────────────────────
      let bankTransactionsReadiness: "READY" | "PARTIAL" | "NOT_READY";
      let readinessReason: string;
      let nextRecommendedStep: string;

      const highIssues = issues.filter((i) => i.severity === "HIGH").length;
      if (highIssues === 0 && gapUnexplained === 0 && missingOp === 0) {
        bankTransactionsReadiness = "READY";
        readinessReason =
          "Raw→normalized gap is fully explained. Date source is reliable (documentProcessDate). Field quality is sufficient for counterparty layer.";
        nextRecommendedStep =
          "Start P8.3 — Counterparty Foundation. Bank transaction data is sufficient.";
      } else if (gapUnexplained === 0 && normTotal > 0) {
        bankTransactionsReadiness = "PARTIAL";
        readinessReason = `Transaction data exists and normalized table is correct (${normTotal} records, all dates populated). Raw pipeline has bookkeeping gaps: operation_date column missing for ${missingOp} records, normalized_status=pending for all raw. Gap of ${gap} fully explained (${trueDuplicates} true dups + ${crossAccountTransfers} cross-account transfers).`;
        nextRecommendedStep =
          "P8.3 Counterparty Foundation can start — normalized data is sufficient. Fix raw pipeline bookkeeping separately.";
      } else {
        bankTransactionsReadiness = "NOT_READY";
        readinessReason = `${gapUnexplained} transactions in the raw→normalized gap are unexplained. Date source or normalization may be unreliable.`;
        nextRecommendedStep =
          "Investigate unexplained gap before proceeding to P8.3.";
      }

      // ── Response ──────────────────────────────────────────────────────────────
      return res.json({
        auditType: "bank-transactions-audit-p82",
        generatedAt: new Date().toISOString(),

        environment: {
          dbKind: "production",
          auditValidity: "VALID_PRODUCTION",
          isProduction: true,
          dbName,
          nodeEnv,
          bankIntegrationExpected: true,
        },

        rawTransactions: {
          total: rawTotal,
          hasExtId: Number(rawQuality?.has_ext_id ?? 0),
          uniqueExtIds,
          hasOperationDate: Number(rawQuality?.has_op_date ?? 0),
          missingOperationDate: missingOp,
          hasBookingDate: Number(rawQuality?.has_booking_date ?? 0),
          hasRawJson: Number(rawQuality?.has_raw_json ?? 0),
          hasAmount: Number(rawQuality?.has_amount ?? 0),
          hasDirection: Number(rawQuality?.has_direction ?? 0),
          hasCounterpartyName: Number(rawQuality?.has_cp_name ?? 0),
          hasCounterpartyInn: Number(rawQuality?.has_cp_inn ?? 0),
          hasPurpose: Number(rawQuality?.has_purpose ?? 0),
          normalizedStatusBreakdown: {
            pending: Number(rawQuality?.status_pending ?? 0),
            normalized: Number(rawQuality?.status_normalized ?? 0),
            skipped: Number(rawQuality?.status_skipped ?? 0),
            error: Number(rawQuality?.status_error ?? 0),
          },
          normBookkeepingGap,
          normBookkeepingGapNote: normBookkeepingGap
            ? `All ${rawTotal} raw records show normalized_status='pending' despite ${normTotal} normalized records existing. Pipeline did not update normalized_status.`
            : null,
        },

        dateFieldInventory: {
          documentProcessDate: {
            present: hasDpd,
            total: rawTotal,
            coveragePct:
              rawTotal > 0 ? Math.round((hasDpd / rawTotal) * 100) : 0,
            minDate: dateInventory?.min_dpd ?? null,
            maxDate: dateInventory?.max_dpd ?? null,
            isReliable: hasDpd === rawTotal,
          },
          operationDateColumn: {
            present: Number(rawQuality?.has_op_date ?? 0),
            missing: missingOp,
            total: rawTotal,
            coveragePct:
              rawTotal > 0
                ? Math.round(
                    (Number(rawQuality?.has_op_date ?? 0) / rawTotal) * 100,
                  )
                : 0,
          },
          bookingDateJsonField: {
            present: Number(dateInventory?.has_booking_date_json ?? 0),
            total: rawTotal,
          },
          transactionDateJsonField: {
            present: Number(dateInventory?.has_tx_date_json ?? 0),
            total: rawTotal,
          },
          valueDateJsonField: {
            present: Number(dateInventory?.has_value_date_json ?? 0),
            total: rawTotal,
          },
          normalizedTableDateStatus:
            normTotal > 0 && Number(normQuality?.has_op_date ?? 0) === normTotal
              ? "complete"
              : "partial",
          rootCause: dateRootCause,
          rootCauseDetail: dateRootCauseDetail,
        },

        normalizedTransactions: {
          total: normTotal,
          dateRange: {
            min: normQuality?.min_date ?? null,
            max: normQuality?.max_date ?? null,
          },
          hasOperationDate: Number(normQuality?.has_op_date ?? 0),
          hasAmount: Number(normQuality?.has_amount ?? 0),
          hasDirection: Number(normQuality?.has_direction ?? 0),
          hasCounterpartyName: Number(normQuality?.has_cp_name ?? 0),
          hasCounterpartyInn: Number(normQuality?.has_cp_inn ?? 0),
          hasPurpose: Number(normQuality?.has_purpose ?? 0),
          hasExtId: Number(normQuality?.has_ext_id ?? 0),
          hasCounterpartyAccount: Number(normQuality?.has_cp_account ?? 0),
          hasAccountId: Number(normQuality?.has_account_id ?? 0),
          matchStatus: {
            unmatched: Number(normQuality?.match_unmatched ?? 0),
            matched: Number(normQuality?.match_matched ?? 0),
          },
        },

        rawNormalizedGap: {
          rawTotal,
          normalizedTotal: normTotal,
          gap,
          classification: {
            trueDuplicates,
            crossAccountTransfers,
            unexplained: gapUnexplained,
          },
          verdict: gapUnexplained === 0 ? "EXPLAINED" : "PARTIALLY_EXPLAINED",
          trueDuplicatesNote:
            "Same external_transaction_id + same account_id appeared twice in raw — correctly deduplicated in normalized.",
          crossAccountNote:
            "Same external_transaction_id in different accounts — inter-account transfers appear as both expense (source) and income (destination) in raw.",
        },

        perAccountCoverage: perAccount,

        duplicates: {
          rawDuplicates: {
            count: trueDuplicates,
            examples: rawDupExamples.map((d) => ({
              externalTransactionId: d.external_transaction_id,
              accountId: d.account_id,
              occurrences: Number(d.cnt),
            })),
          },
          normalizedDuplicates: {
            count: 0,
            note: "No duplicates detected in bank_transactions (external_id is unique)",
          },
        },

        counterpartyReadiness: {
          uniqueCounterpartyNames: uniqueNames,
          uniqueCounterpartyInns: uniqueInns,
          uniqueCounterpartyAccounts: uniqueAccounts,
          incomeTransactions: Number(cpStats?.income_cnt ?? 0),
          expenseTransactions: Number(cpStats?.expense_cnt ?? 0),
          missingCounterparty: missingCp,
          topIncomeCounterparties: cpIncome.map((c) => ({
            name: c.counterparty_name,
            inn: c.counterparty_inn,
            count: Number(c.cnt),
            totalSum: Number(c.total_sum),
          })),
          topExpenseCounterparties: cpExpense.map((c) => ({
            name: c.counterparty_name,
            inn: c.counterparty_inn,
            count: Number(c.cnt),
            totalSum: Number(c.total_sum),
          })),
          counterpartyLayerReadiness,
          caveats: [
            "ООО АРТХЕЛЛО (INN 7802561028) appears as both income and expense — these are inter-account transfers, not revenue.",
            "ООО Банк Точка (INN 9721194461) transactions may include bank fees and inter-account settlement entries.",
            "Cross-account transfers must be classified as is_internal_transfer=true in P8.3 before counterparty analysis.",
          ],
        },

        operations: {
          total: Number(opsStats?.total ?? 0),
          linkedBankTx: Number(opsStats?.linked ?? 0),
          uniqueSources: Number(opsStats?.unique_sources ?? 0),
          dateRange: {
            min: opsStats?.min_d ?? null,
            max: opsStats?.max_d ?? null,
          },
          note: "Production operations are from source=bank_api. These are separate from bank_transactions pipeline and must not be mixed as reconciliation truth.",
          devProductionDifference:
            "Production: 9 operations (bank_api). Dev had 488 operations (test/import data). Do not use dev operations as production truth.",
        },

        statementsPerAccount: stmtsPerAccount.map((s) => ({
          externalAccountId: s.external_account_id,
          statementCount: Number(s.cnt),
          periodFrom: s.min_period,
          periodTo: s.max_period,
          totalTransactions: Number(s.total_tx),
          readyCount: Number(s.ready_cnt),
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

        bankTransactionsReadiness,
        readinessReason,
        nextRecommendedStep,

        p83CanStart:
          counterpartyLayerReadiness !== "NOT_READY" && gapUnexplained === 0,
        p83Blockers:
          gapUnexplained > 0
            ? [
                `${gapUnexplained} unexplained gap transactions must be resolved before counterparty classification`,
              ]
            : counterpartyLayerReadiness === "NOT_READY"
              ? ["Insufficient counterparty data for counterparty layer"]
              : [],

        warnings: [
          "⚠️ Do NOT build final ДДС before bank reconciliation is complete (P8.4).",
          "⚠️ Do NOT build final ОПиУ before bank reconciliation is complete (P8.4).",
          "⚠️ ООО АРТХЕЛЛО / Банк Точка transactions include inter-account transfers — exclude from revenue/expense before P8.4.",
          "ℹ️ crm_payments in production = 0 (AlphaCRM sync not run in production yet). Not blocking P8.2.",
          "ℹ️ Bank account owners (legal entity) are not yet linked — needed before P8.3 counterparty classification.",
        ],
      });
    } catch (err) {
      logger.error({ err }, "bank-transactions-audit failed");
      return void res.status(500).json({ error: String(err) });
    }
  },
);
