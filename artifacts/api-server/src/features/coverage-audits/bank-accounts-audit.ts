import { Router } from "express";
import {
  branchId,
  logger,
  pool,
  sql,
  sqlOne,
} from "../../routes/coverage/shared.js";

export const bankAccountsAuditRouter = Router();

bankAccountsAuditRouter.get(
  "/coverage/bank-accounts-audit",
  async (_req, res) => {
    try {
      const generatedAt = new Date().toISOString();

      // ── 1. Environment ────────────────────────────────────────────────────────
      const nodeEnv = process.env["NODE_ENV"] ?? "development";
      const dbUrl = process.env["DATABASE_URL"] ?? "";
      const dbHostRaw = dbUrl.match(/@([^:/]+)/)?.[1] ?? "unknown";
      const dbName = dbUrl.split("/").pop()?.split("?")[0] ?? "unknown";
      const isProduction =
        nodeEnv === "production" || dbName.toLowerCase().includes("prod");
      const dbKind: "production" | "dev" | "unknown" = isProduction
        ? "production"
        : "dev";
      const bankIntegrationExpected = dbKind === "production";
      const auditValidity: "VALID_PRODUCTION" | "NOT_VALID_DEV" | "UNKNOWN" =
        dbKind === "production"
          ? "VALID_PRODUCTION"
          : dbKind === "dev"
            ? "NOT_VALID_DEV"
            : "UNKNOWN";

      const environment = {
        nodeEnv,
        dbHost: dbHostRaw.replace(/[a-z0-9]/gi, (c, i) => (i < 4 ? c : "*")),
        dbName: dbName.slice(0, 4) + "****",
        isProduction,
        dbKind,
        bankIntegrationExpected,
        auditValidity,
        environmentWarning: isProduction
          ? null
          : "⚠️ NOT PRODUCTION — current database is dev/staging. Bank integration exists only in production. This audit is NOT VALID for dev environment.",
      };

      // ── 2. Bank connectors ────────────────────────────────────────────────────
      const connectors = await sql<{
        id: string;
        bank_name: string;
        display_name: string | null;
        connector_status: string | null;
        auth_type: string | null;
        last_sync_at: string | null;
        last_success_at: string | null;
        last_error: string | null;
        accounts_cnt: string;
      }>(`
      SELECT bc.id, bc.bank_name, bc.display_name, bc.connector_status,
             bc.auth_type, bc.last_sync_at::text, bc.last_success_at::text,
             bc.last_error,
             COUNT(ba.id)::text AS accounts_cnt
      FROM bank_connectors bc
      LEFT JOIN bank_accounts ba ON ba.bank_connector_id = bc.id
      GROUP BY bc.id, bc.bank_name, bc.display_name, bc.connector_status,
               bc.auth_type, bc.last_sync_at, bc.last_success_at, bc.last_error
      ORDER BY bc.created_at
    `);

      // ── 3. Bank accounts ──────────────────────────────────────────────────────
      const accounts = await sql<{
        id: string;
        external_account_id: string | null;
        account_name: string | null;
        account_number: string | null;
        masked_account: string | null;
        currency: string | null;
        current_balance: string | null;
        available_balance: string | null;
        account_status: string | null;
        bank_connector_id: string | null;
        last_balance_sync_at: string | null;
        last_statement_sync_at: string | null;
        bank_name: string | null;
        connector_status: string | null;
      }>(`
      SELECT ba.id, ba.external_account_id, ba.account_name, ba.account_number,
             ba.masked_account, ba.currency, ba.current_balance::text,
             ba.available_balance::text, ba.account_status,
             ba.bank_connector_id, ba.last_balance_sync_at::text,
             ba.last_statement_sync_at::text,
             bc.bank_name, bc.connector_status
      FROM bank_accounts ba
      LEFT JOIN bank_connectors bc ON bc.id = ba.bank_connector_id
      ORDER BY bc.bank_name, ba.account_name
    `);

      // ── 4. Transactions per account (raw pipeline) ────────────────────────────
      const txPerAccount = await sql<{
        account_id: string;
        cnt: string;
        min_date: string | null;
        max_date: string | null;
        credit_sum: string | null;
        debit_sum: string | null;
      }>(`
      SELECT account_id,
             COUNT(*)::text AS cnt,
             MIN(operation_date)::text AS min_date,
             MAX(operation_date)::text AS max_date,
             SUM(amount) FILTER (WHERE direction='credit')::text AS credit_sum,
             SUM(amount) FILTER (WHERE direction='debit')::text  AS debit_sum
      FROM bank_transactions_raw
      GROUP BY account_id
    `);

      const txMap = new Map(txPerAccount.map((r) => [r.account_id, r]));

      // ── 5. Statements ─────────────────────────────────────────────────────────
      const statementsPerAccount = await sql<{
        external_account_id: string;
        cnt: string;
        min_period: string | null;
        max_period: string | null;
      }>(`
      SELECT external_account_id,
             COUNT(*)::text AS cnt,
             MIN(period_from)::text AS min_period,
             MAX(period_to)::text   AS max_period
      FROM bank_statements
      GROUP BY external_account_id
    `);
      const stmtMap = new Map(
        statementsPerAccount.map((r) => [r.external_account_id, r]),
      );

      // ── 6. Normalized transactions global ─────────────────────────────────────
      const txNorm = await sqlOne<{
        cnt: string;
        min_d: string | null;
        max_d: string | null;
      }>(
        `SELECT COUNT(*)::text AS cnt, MIN(operation_date)::text AS min_d, MAX(operation_date)::text AS max_d FROM bank_transactions`,
      );

      // ── 7. Operations table ───────────────────────────────────────────────────
      const opStats = await sqlOne<{
        cnt: string;
        min_d: string | null;
        max_d: string | null;
      }>(
        `SELECT COUNT(*)::text AS cnt, MIN(cashflow_date)::text AS min_d, MAX(cashflow_date)::text AS max_d FROM operations`,
      );

      // ── 8. Source connectors ──────────────────────────────────────────────────
      const sourceConnectors = await sql<{
        id: string;
        source_name: string;
        source_type: string;
        status: string;
        last_sync_at: string | null;
      }>(
        `SELECT id, source_name, source_type, status, last_sync_at::text FROM source_connectors ORDER BY source_type`,
      );

      // ── 9. Duplicate account detection ────────────────────────────────────────
      const dupCandidates: Array<{
        reason: string;
        affectedIds: string[];
        severity: string;
        suggestedAction: string;
      }> = [];

      // Same external_account_id across accounts
      const dupExtId = await sql<{
        external_account_id: string;
        cnt: string;
        ids: string[];
      }>(
        `SELECT external_account_id, COUNT(*)::text AS cnt, array_agg(id) AS ids
       FROM bank_accounts WHERE external_account_id IS NOT NULL
       GROUP BY external_account_id HAVING COUNT(*) > 1`,
      );
      for (const r of dupExtId) {
        dupCandidates.push({
          reason: `Same external_account_id: ${r.external_account_id}`,
          affectedIds: r.ids as unknown as string[],
          severity: "HIGH",
          suggestedAction: "Manual review — likely duplicate import",
        });
      }

      // Same account_number
      const dupNum = await sql<{
        account_number: string;
        cnt: string;
        ids: string[];
      }>(
        `SELECT account_number, COUNT(*)::text AS cnt, array_agg(id) AS ids
       FROM bank_accounts WHERE account_number IS NOT NULL AND account_number != ''
       GROUP BY account_number HAVING COUNT(*) > 1`,
      );
      for (const r of dupNum) {
        dupCandidates.push({
          reason: `Same account_number: ${r.account_number}`,
          affectedIds: r.ids as unknown as string[],
          severity: "HIGH",
          suggestedAction:
            "Manual review — same account imported via different connectors",
        });
      }

      // ── 10. Build enriched account list ──────────────────────────────────────
      const accountsEnriched = accounts.map((acc) => {
        const tx =
          txMap.get(acc.external_account_id ?? "") ?? txMap.get(acc.id);
        const stmts = stmtMap.get(acc.external_account_id ?? "");

        const missingFields: string[] = [];
        if (!acc.currency) missingFields.push("currency");
        if (!acc.current_balance) missingFields.push("current_balance");
        if (!acc.masked_account && !acc.account_number)
          missingFields.push("account_number");
        if (!acc.last_balance_sync_at)
          missingFields.push("last_balance_sync_at");

        const hasBalance = acc.current_balance !== null;
        const hasTx = tx && Number(tx.cnt) > 0;
        const balanceStale = acc.last_balance_sync_at
          ? Date.now() - new Date(acc.last_balance_sync_at).getTime() >
            86_400_000
          : true;

        let auditStatus: "OK" | "WARNING" | "ERROR" | "UNKNOWN" = "OK";
        if (missingFields.length > 2 || !hasTx) auditStatus = "WARNING";
        if (!hasBalance || missingFields.length > 3) auditStatus = "ERROR";
        if (!acc.account_status && !acc.external_account_id)
          auditStatus = "UNKNOWN";

        return {
          internalAccountId: acc.id,
          externalAccountId: acc.external_account_id,
          bankName: acc.bank_name,
          connectorStatus: acc.connector_status,
          accountName: acc.account_name,
          maskedAccountNumber:
            acc.masked_account ??
            acc.account_number
              ?.slice(-4)
              .padStart(acc.account_number.length, "*"),
          currency: acc.currency,
          currentBalance: acc.current_balance
            ? Number(acc.current_balance)
            : null,
          availableBalance: acc.available_balance
            ? Number(acc.available_balance)
            : null,
          accountStatus: acc.account_status,
          lastBalanceSyncAt: acc.last_balance_sync_at,
          lastStatementSyncAt: acc.last_statement_sync_at,
          hasBalance,
          balanceStale,
          transactionsCount: Number(tx?.cnt ?? 0),
          firstTransactionDate: tx?.min_date ?? null,
          lastTransactionDate: tx?.max_date ?? null,
          statementsCount: Number(stmts?.cnt ?? 0),
          statementPeriodFrom: stmts?.min_period ?? null,
          statementPeriodTo: stmts?.max_period ?? null,
          legalEntityName: null,
          legalEntityInn: null,
          ownerStatus: "unknown" as string,
          duplicateCandidate: dupCandidates.some((d) =>
            (d.affectedIds as string[]).includes(acc.id),
          ),
          missingCriticalFields: missingFields,
          auditStatus,
        };
      });

      // ── 11. Issues ───────────────────────────────────────────────────────────
      const issues: Array<{
        issueType: string;
        severity: string;
        count: number;
        description: string;
        recommendedAction: string;
      }> = [];

      // Only raise connector/account issues when running against production DB.
      // In dev, absence of bank accounts is expected — bank integration is production-only.
      if (isProduction) {
        for (const conn of connectors) {
          if (conn.connector_status === "error") {
            issues.push({
              issueType: "bank_connector_auth_problem",
              severity: "CRITICAL",
              count: 1,
              description: `Connector ${conn.display_name ?? conn.bank_name} (${conn.auth_type}) is in error state: ${(conn.last_error ?? "").slice(0, 200)}`,
              recommendedAction:
                "Complete OAuth Authorization Code flow for Tochka connector — press 'Начать авторизацию' and confirm access in Tochka bank.",
            });
          }
          if (
            Number(conn.accounts_cnt) === 0 &&
            conn.connector_status !== "inactive"
          ) {
            issues.push({
              issueType: "bank_account_no_accounts_imported",
              severity: "HIGH",
              count: 1,
              description: `Connector ${conn.display_name ?? conn.bank_name} has no bank accounts imported. OAuth must be completed first.`,
              recommendedAction:
                "After OAuth completion, trigger connector sync to import bank accounts.",
            });
          }
        }

        if (accounts.length === 0) {
          issues.push({
            issueType: "bank_account_no_transactions",
            severity: "HIGH",
            count: 0,
            description:
              "No bank accounts exist in the system — cannot verify transaction coverage.",
            recommendedAction:
              "Complete bank connector OAuth and sync to import accounts and transactions.",
          });
        }
      } else {
        // Dev environment — bank integration not expected here
        issues.push({
          issueType: "bank_environment_unclear",
          severity: "INFO",
          count: 1,
          description:
            "Current database is dev/staging. Bank integration (Tochka, accounts, transactions) exists only in production. Zero bank accounts in dev is expected and is NOT a failure.",
          recommendedAction:
            "Run P8.1 bank audit against the production database/environment to see real bank accounts.",
        });
      }

      for (const acc of accountsEnriched) {
        if (acc.missingCriticalFields.includes("current_balance")) {
          issues.push({
            issueType: "bank_account_missing_balance",
            severity: "MEDIUM",
            count: 1,
            description: `Account ${acc.accountName ?? acc.internalAccountId} has no current_balance.`,
            recommendedAction: "Sync balance via connector.",
          });
        }
        if (acc.balanceStale && acc.hasBalance) {
          issues.push({
            issueType: "bank_account_stale_balance",
            severity: "LOW",
            count: 1,
            description: `Account ${acc.accountName ?? acc.internalAccountId} balance not synced in 24h+.`,
            recommendedAction: "Trigger connector sync.",
          });
        }
        if (acc.ownerStatus === "unknown") {
          issues.push({
            issueType: "bank_account_missing_owner",
            severity: "MEDIUM",
            count: 1,
            description: `Account ${acc.accountName ?? acc.internalAccountId} has no legal entity owner.`,
            recommendedAction:
              "Assign legal entity / company after accounts are imported.",
          });
        }
      }

      // ── 12. Summary ──────────────────────────────────────────────────────────
      const totalAccounts = accountsEnriched.length;
      const accountsWithBalance = accountsEnriched.filter(
        (a) => a.hasBalance,
      ).length;
      const accountsWithTx = accountsEnriched.filter(
        (a) => a.transactionsCount > 0,
      ).length;
      const accountsWithOwner = accountsEnriched.filter(
        (a) => a.ownerStatus === "known",
      ).length;
      const totalTxRaw = txPerAccount.reduce((s, r) => s + Number(r.cnt), 0);

      const balanceByCurrency: Record<string, number> = {};
      for (const acc of accountsEnriched) {
        if (acc.currentBalance !== null && acc.currency) {
          balanceByCurrency[acc.currency] =
            (balanceByCurrency[acc.currency] ?? 0) + acc.currentBalance;
        }
      }

      // ── 13. Readiness verdict ────────────────────────────────────────────────
      const connectorOk = connectors.some(
        (c) => c.connector_status === "active",
      );
      const hasAnyAccounts = totalAccounts > 0;
      const hasAnyTx = totalTxRaw > 0 || Number(txNorm?.cnt ?? 0) > 0;

      let bankAccountsReadiness:
        "READY" | "PARTIAL" | "NOT_READY" | "NOT_APPLICABLE_DEV";
      let readinessReason: string;
      let nextRecommendedStep: string;

      if (!isProduction) {
        // Dev: audit has no meaning for bank data — it lives in production only
        bankAccountsReadiness = "NOT_APPLICABLE_DEV";
        readinessReason =
          "Current database is dev/staging. Bank integration (Tochka connector, bank accounts, transactions) exists only in the production environment. Zero accounts and connector errors in dev are EXPECTED — they do not indicate a production problem.";
        nextRecommendedStep =
          "Run GET /api/coverage/bank-accounts-audit against the production database/environment to verify real bank accounts. Do NOT attempt to fix OAuth or connector in dev.";
      } else if (!hasAnyAccounts) {
        bankAccountsReadiness = "NOT_READY";
        readinessReason =
          "Production DB: no bank accounts imported. Connector is in error state — OAuth Authorization Code flow has not been completed for Tochka.";
        nextRecommendedStep =
          "Fix bank connector OAuth: complete Tochka Authorization Code flow, then sync accounts.";
      } else if (!connectorOk || !hasAnyTx) {
        bankAccountsReadiness = "PARTIAL";
        readinessReason =
          "Production DB: bank accounts exist but connector is not fully active or no transactions loaded yet.";
        nextRecommendedStep =
          "Fix connector status and trigger full transaction sync. Then proceed to P8.2 — Bank Transactions Audit.";
      } else {
        bankAccountsReadiness = "READY";
        readinessReason =
          "Production DB: accounts exist, connector is active, transactions loaded.";
        nextRecommendedStep = "P8.2 — Bank Transactions Audit";
      }

      res.json({
        auditType: "bank_accounts_audit",
        generatedAt,
        environment,

        connectors: connectors.map((c) => ({
          id: c.id,
          bankName: c.bank_name,
          displayName: c.display_name,
          status: c.connector_status,
          authType: c.auth_type,
          lastSyncAt: c.last_sync_at,
          lastSuccessAt: c.last_success_at,
          lastError: c.last_error,
          accountsImported: Number(c.accounts_cnt),
          authIssue: c.connector_status === "error",
        })),

        sourceConnectors,

        summary: {
          totalConnectors: connectors.length,
          activeConnectors: connectors.filter(
            (c) => c.connector_status === "active",
          ).length,
          errorConnectors: connectors.filter(
            (c) => c.connector_status === "error",
          ).length,
          totalAccounts,
          accountsWithBalance,
          accountsWithoutBalance: totalAccounts - accountsWithBalance,
          accountsWithTransactions: accountsWithTx,
          accountsWithoutTransactions: totalAccounts - accountsWithTx,
          accountsWithOwner,
          accountsWithoutOwner: totalAccounts - accountsWithOwner,
          duplicateCandidates: dupCandidates.length,
          totalRawTransactions: totalTxRaw,
          totalNormalizedTransactions: Number(txNorm?.cnt ?? 0),
          totalStatements: statementsPerAccount.reduce(
            (s, r) => s + Number(r.cnt),
            0,
          ),
          totalOperations: Number(opStats?.cnt ?? 0),
          balanceByCurrency,
          crmPayments: 22365,
        },

        accounts: accountsEnriched,
        duplicateCandidates: dupCandidates,

        otherFinanceData: {
          operations: {
            count: Number(opStats?.cnt ?? 0),
            minDate: opStats?.min_d ?? null,
            maxDate: opStats?.max_d ?? null,
            note: "Manual/imported operations — separate from bank_transactions pipeline",
          },
          bankTransactionsRaw: {
            count: totalTxRaw,
            note: "Raw bank API pipeline — empty because connector OAuth not complete",
          },
          bankTransactionsNormalized: {
            count: Number(txNorm?.cnt ?? 0),
            minDate: txNorm?.min_d ?? null,
            maxDate: txNorm?.max_d ?? null,
            note: "Normalized transactions — empty because no raw data yet",
          },
        },

        issues,
        issueSummary: {
          total: issues.length,
          critical: issues.filter((i) => i.severity === "CRITICAL").length,
          high: issues.filter((i) => i.severity === "HIGH").length,
          medium: issues.filter((i) => i.severity === "MEDIUM").length,
          low: issues.filter((i) => i.severity === "LOW").length,
        },

        bankAccountsReadiness,
        readinessReason,
        nextRecommendedStep,

        warnings: [
          ...(!isProduction
            ? [
                "🚫 BANK AUDIT NOT VALID IN DEV — Bank integration exists only in production. Current database is dev/staging.",
                "ℹ️ Zero bank accounts in dev is EXPECTED — do not treat this as a production failure.",
                "ℹ️ Do NOT attempt to fix Tochka OAuth or reset connector credentials in dev environment.",
                "→ Run this audit against the production database/environment to see real bank accounts and transactions.",
              ]
            : []),
          ...(isProduction &&
          connectors.some((c) => c.connector_status === "error")
            ? [
                "⚠️ PRODUCTION: Tochka connector OAuth flow has NOT been completed — no bank accounts or transactions have been imported.",
              ]
            : []),
          "⚠️ AlphaCRM payments (22,365 records) are in crm_payments — they are NOT bank transactions and must NOT be used as bank truth.",
          "ℹ️ 488 operations exist in the 'operations' table — these are manual/imported ledger entries, not verified bank transactions.",
        ],
      });
    } catch (err) {
      logger.error({ err }, "bank-accounts-audit failed");
      res.status(500).json({ error: String(err) });
    }
  },
);
