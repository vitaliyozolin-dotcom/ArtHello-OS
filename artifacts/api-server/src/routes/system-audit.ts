import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function parseDbFingerprint(dbUrl: string): { host: string; name: string; schema: string; fingerprint: string } {
  let host = "unknown";
  let name = "unknown";
  const schema = "public";
  try {
    const withoutProto = dbUrl.replace(/^[a-z]+:\/\//, "");
    const atIdx = withoutProto.lastIndexOf("@");
    const afterAt = atIdx >= 0 ? withoutProto.slice(atIdx + 1) : withoutProto;
    const [hostPart, ...pathParts] = afterAt.split("/");
    host = hostPart;
    name = (pathParts.join("/") || "").split("?")[0] || "unknown";
  } catch {}
  const fingerprint = `${host}/${name}#${schema}`;
  return { host, name, schema, fingerprint };
}

async function countTable(tableName: string): Promise<number> {
  try {
    const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${tableName}`));
    return (r.rows[0] as { n: number }).n ?? 0;
  } catch {
    return -1;
  }
}

async function maxDate(tableName: string, col: string): Promise<string | null> {
  try {
    const r = await db.execute(sql.raw(`SELECT MAX(${col})::text AS d FROM ${tableName}`));
    return (r.rows[0] as { d: string | null }).d ?? null;
  } catch {
    return null;
  }
}

// ─── GET /api/system/db-audit ────────────────────────────────────────────────

router.get("/system/db-audit", async (req, res) => {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const deploymentId = process.env.REPLIT_DEPLOYMENT_ID;

  const { host, name, schema, fingerprint } = parseDbFingerprint(dbUrl);

  const devWarning = !isProduction
    ? "ВНИМАНИЕ: это dev база. Не использовать для финансовых выводов по реальному бизнесу."
    : null;

  // ── pg metadata ────────────────────────────────────────────────────────────
  let pgVersion = "unknown";
  let pgCurrentDb = "unknown";
  try {
    const vRow = await db.execute(sql.raw("SELECT version() AS v, current_database() AS db"));
    pgVersion = (vRow.rows[0] as { v: string }).v?.split(" ").slice(0, 2).join(" ") ?? "unknown";
    pgCurrentDb = (vRow.rows[0] as { db: string }).db ?? "unknown";
  } catch {}

  // ── counts (parallel) ──────────────────────────────────────────────────────
  const [
    cntBankConnectors,
    cntBankAccounts,
    cntBankTransactions,
    cntBankTransactionsRaw,
    cntBankStatements,
    cntBankSyncRuns,
    cntOperations,
    cntArticles,
    cntDdsCategories,
    cntOpiuCategories,
  ] = await Promise.all([
    countTable("bank_connectors"),
    countTable("bank_accounts"),
    countTable("bank_transactions"),
    countTable("bank_transactions_raw"),
    countTable("bank_statements"),
    countTable("bank_sync_runs"),
    countTable("operations WHERE is_deleted = false"),
    countTable("articles WHERE is_active = true"),
    countTable("dds_categories"),
    countTable("opiu_categories"),
  ]);

  // ── match status breakdown ─────────────────────────────────────────────────
  interface MatchBreakdown {
    unmatched: number;
    matched: number;
    suggested: number;
    ignored: number;
    internal_transfer: number;
    operations_from_bank: number;
  }
  let matchBreakdown: MatchBreakdown = {
    unmatched: 0, matched: 0, suggested: 0, ignored: 0, internal_transfer: 0, operations_from_bank: 0,
  };
  try {
    const r = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE match_status = 'unmatched')          AS unmatched,
        COUNT(*) FILTER (WHERE match_status = 'matched')            AS matched,
        COUNT(*) FILTER (WHERE match_status = 'suggested')          AS suggested,
        COUNT(*) FILTER (WHERE match_status = 'ignored')            AS ignored,
        COUNT(*) FILTER (WHERE match_status = 'internal_transfer')  AS internal_transfer
      FROM bank_transactions
    `));
    const row = r.rows[0] as Record<string, unknown>;
    const opRow = await db.execute(sql.raw(
      `SELECT COUNT(*)::int AS n FROM operations WHERE source = 'bank_api' AND is_deleted = false`
    ));
    matchBreakdown = {
      unmatched:          Number(row?.unmatched          ?? 0),
      matched:            Number(row?.matched            ?? 0),
      suggested:          Number(row?.suggested          ?? 0),
      ignored:            Number(row?.ignored            ?? 0),
      internal_transfer:  Number(row?.internal_transfer  ?? 0),
      operations_from_bank: (opRow.rows[0] as { n: number }).n ?? 0,
    };
  } catch {}

  // ── max dates (parallel) ───────────────────────────────────────────────────
  const [
    latestBankTxDate,
    latestBankAccountSync,
    latestStatementSync,
    latestOperationDate,
    latestSyncRunDate,
  ] = await Promise.all([
    maxDate("bank_transactions", "operation_date"),
    maxDate("bank_accounts", "last_balance_sync_at"),
    maxDate("bank_statements", "created_at"),
    maxDate("operations", "cashflow_date"),
    maxDate("bank_sync_runs", "started_at"),
  ]);

  // ── connectors detail ──────────────────────────────────────────────────────
  let connectors: Array<{ id: string; bank_name: string; status: string; last_sync: string | null }> = [];
  try {
    const rows = await db.execute(sql.raw(
      `SELECT id::text, bank_name, connector_status AS status, last_sync_at::text AS last_sync
       FROM bank_connectors ORDER BY created_at`
    ));
    connectors = rows.rows as typeof connectors;
  } catch {}

  // ── accounts detail ────────────────────────────────────────────────────────
  let accounts: Array<{ id: string; account_number: string; currency: string; balance: string | null; status: string | null }> = [];
  try {
    const rows = await db.execute(sql.raw(
      `SELECT id::text, COALESCE(account_number, masked_account, 'unknown') AS account_number,
              currency, current_balance::text AS balance, account_status AS status
       FROM bank_accounts ORDER BY created_at`
    ));
    accounts = rows.rows as typeof accounts;
  } catch {}

  // ── samples (no secrets) ──────────────────────────────────────────────────
  let sampleBankTx: unknown[] = [];
  try {
    const rows = await db.execute(sql.raw(
      `SELECT id::text, operation_date::text, direction, amount::text,
              counterparty_name, match_status, source_type
       FROM bank_transactions ORDER BY operation_date DESC LIMIT 3`
    ));
    sampleBankTx = rows.rows;
  } catch {}

  let sampleOperations: unknown[] = [];
  try {
    const rows = await db.execute(sql.raw(
      `SELECT id::text, cashflow_date::text, direction, amount::text,
              source, verification_status, article_name, counterparty_name
       FROM operations WHERE is_deleted = false ORDER BY cashflow_date DESC LIMIT 3`
    ));
    sampleOperations = rows.rows;
  } catch {}

  // ── data source map ────────────────────────────────────────────────────────
  const dataSourceMap = {
    "Пульс / cashflow block":   { endpoint: "/api/banking/cashflow",                             tables: ["bank_transactions", "bank_accounts"], rows: { bank_transactions: cntBankTransactions, bank_accounts: cntBankAccounts } },
    "Banking / Overview":       { endpoint: "/api/banking/connectors",                           tables: ["bank_connectors", "bank_accounts"],   rows: { bank_connectors: cntBankConnectors,    bank_accounts: cntBankAccounts } },
    "Banking / Операции":       { endpoint: "/api/banking/transactions OR /api/ledger/operations", tables: ["bank_transactions", "operations"],  rows: { bank_transactions: cntBankTransactions, operations: cntOperations } },
    "Banking / ДДС Отчёт":      { endpoint: "/api/ledger/cashflow-report",                       tables: ["operations", "articles"],             rows: { operations: cntOperations, articles: cntArticles } },
    "Banking / Сопоставление":  { endpoint: "/api/banking/match-stats",                          tables: ["bank_transactions", "operations"],    rows: { bank_transactions: cntBankTransactions, operations: cntOperations } },
    "Banking / Счета":          { endpoint: "/api/banking/accounts",                             tables: ["bank_accounts"],                      rows: { bank_accounts: cntBankAccounts } },
    "Banking / Коннекторы":     { endpoint: "/api/banking/connectors",                           tables: ["bank_connectors"],                    rows: { bank_connectors: cntBankConnectors } },
    "Banking / Статус данных":  { endpoint: "/api/banking/sync-runs",                            tables: ["bank_sync_runs", "bank_transactions"], rows: { bank_sync_runs: cntBankSyncRuns, bank_transactions: cntBankTransactions } },
    "Реестр операций":          { endpoint: "/api/ledger/operations",                            tables: ["operations", "articles"],             rows: { operations: cntOperations, articles: cntArticles } },
    "Сверка с банком":          { endpoint: "/api/reconciliation/*",                             tables: ["bank_transactions", "operations"],    rows: { bank_transactions: cntBankTransactions, operations: cntOperations } },
    "ОПиУ":                     { endpoint: "/api/pnl/*",                                        tables: ["operations", "articles"],             rows: { operations: cntOperations } },
  };

  res.json({
    _audit: "GET /api/system/db-audit",
    _timestamp: new Date().toISOString(),

    // ── ENV / SOURCE GUARD ──────────────────────────────────────────────────
    environment: nodeEnv as "development" | "production",
    isProductionDataSource: isProduction,
    databaseFingerprint: fingerprint,
    warning: devWarning,

    // ── env detail ─────────────────────────────────────────────────────────
    envDetail: {
      nodeEnv,
      replSlug:          process.env.REPL_SLUG          ?? "not set",
      replOwner:         process.env.REPL_OWNER         ?? "not set",
      replitDeploymentId: deploymentId                  ?? "not set (dev)",
      databaseHost:      host,
      databaseName:      name,
      databaseSchema:    schema,
      postgresVersion:   pgVersion,
      postgresCurrentDb: pgCurrentDb,
    },

    counts: {
      bank_connectors:       cntBankConnectors,
      bank_accounts:         cntBankAccounts,
      bank_transactions:     cntBankTransactions,
      bank_transactions_raw: cntBankTransactionsRaw,
      bank_statements:       cntBankStatements,
      bank_sync_runs:        cntBankSyncRuns,
      operations:            cntOperations,
      articles:              cntArticles,
      dds_categories:        cntDdsCategories,
      opiu_categories:       cntOpiuCategories,
    },

    // ── match status breakdown ─────────────────────────────────────────────
    matchBreakdown: {
      bank_transactions_unmatched:        matchBreakdown.unmatched,
      bank_transactions_matched:          matchBreakdown.matched,
      bank_transactions_suggested:        matchBreakdown.suggested,
      bank_transactions_ignored:          matchBreakdown.ignored,
      bank_transactions_internal_transfer: matchBreakdown.internal_transfer,
      operations_from_bank_api:           matchBreakdown.operations_from_bank,
    },

    maxDates: {
      latestBankTransactionDate: latestBankTxDate,
      latestBankAccountSyncAt:   latestBankAccountSync,
      latestStatementSyncAt:     latestStatementSync,
      latestOperationDate:       latestOperationDate,
      latestSyncRunStartedAt:    latestSyncRunDate,
    },

    connectors,
    accounts,
    samples: {
      bank_transactions: sampleBankTx,
      operations:        sampleOperations,
    },
    dataSourceMap,
  });
});

export const systemAuditRouter = router;
