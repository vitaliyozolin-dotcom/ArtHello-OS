import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  bankConnectorsTable,
  bankAccountsTable,
  bankSyncRunsTable,
  bankTransactionsTable,
  bankTransactionsRawTable,
  bankStatementsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { TochkaConnector } from "./connectors/tochka.js";
import { TinkoffConnector } from "./connectors/tinkoff.js";
import { VtbConnector } from "./connectors/vtb.js";
import type { BankConnectorInterface, NormalizedTransaction, TochkaConfig, TinkoffConfig, VtbConfig } from "./types.js";
import { decryptBankConnectorConfig } from "./config-vault.js";
import { logger } from "../logger.js";

// ─── Build connector instance from DB row ─────────────────────────────────────

export function buildConnector(row: typeof bankConnectorsTable.$inferSelect): BankConnectorInterface {
  const config = decryptBankConnectorConfig(
    row.id,
    row.config,
  );
  switch (row.bankName) {
    case "tochka":  return new TochkaConnector(row.id, config as TochkaConfig);
    case "tinkoff": return new TinkoffConnector(row.id, config as TinkoffConfig);
    case "vtb":     return new VtbConnector(row.id, config as VtbConfig);
    default: throw new Error(`Unknown bank: ${row.bankName}`);
  }
}

// ─── Save normalized transactions ─────────────────────────────────────────────
// Returns { fetched, newlySaved, duplicates }
// Also writes to bank_transactions_raw for the normalization pipeline.

async function saveTransactions(
  connectorId: string,
  bankName: string,
  syncRunId: string,
  txns: NormalizedTransaction[],
): Promise<{ fetched: number; newlySaved: number; duplicates: number }> {
  let newlySaved = 0;
  let duplicates = 0;

  for (const t of txns) {
    // Fingerprint dedup: if no externalTransactionId, derive one from key fields
    let externalId = t.externalTransactionId?.trim() || "";
    if (!externalId) {
      const fp = createHash("md5")
        .update([t.accountId, t.operationDate, String(t.amount), t.direction, t.counterpartyName ?? "", t.purpose ?? ""].join("|"))
        .digest("hex")
        .slice(0, 16);
      externalId = `fp:${fp}`;
    }

    // 1. Write raw (always upsert to keep full history)
    try {
      await db
        .insert(bankTransactionsRawTable)
        .values({
          bankConnectorId: connectorId,
          syncRunId,
          externalTransactionId: externalId,
          accountId: t.accountId,
          amount: String(t.amount),
          currency: t.currency,
          direction: t.direction,
          counterpartyName: t.counterpartyName,
          counterpartyInn: t.counterpartyInn,
          purpose: t.purpose,
          operationDate: t.operationDate,
          rawJson: t.raw as Record<string, unknown>,
          normalizedStatus: "pending",
        })
        .onConflictDoNothing()
        .execute();
    } catch (err) {
      logger.debug({ err }, "Banking: skip raw duplicate");
    }

    // 2. Write normalized (idempotent via unique externalId)
    // operationDate must be a valid YYYY-MM-DD string or null (column type: date)
    const safeDate = (t.operationDate && t.operationDate.length >= 10)
      ? t.operationDate.slice(0, 10)
      : null;

    try {
      const result = await db
        .insert(bankTransactionsTable)
        .values({
          externalId,
          bankConnectorId: connectorId,
          bankName,
          sourceType: "bank_api",
          syncedAt: new Date(),
          syncRunId: syncRunId as unknown as string,
          operationDate: safeDate,
          amount: String(t.amount),
          currency: t.currency,
          direction: t.direction,
          counterpartyName: t.counterpartyName,
          counterpartyInn: t.counterpartyInn,
          purpose: t.purpose,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          accountId: t.accountId as any,
          maskedAccount: t.maskedAccount ?? null,
          bookingDateTime: t.bookingDateTime ? new Date(t.bookingDateTime) : null,
          valueDateTime:   t.valueDateTime   ? new Date(t.valueDateTime)   : null,
          counterpartyAccount: t.counterpartyAccount ?? null,
          operationType: t.operationType ?? null,
          raw: t.raw as Record<string, unknown>,
        })
        .onConflictDoNothing()
        .returning({ id: bankTransactionsTable.id })
        .execute();

      if (result.length > 0) {
        newlySaved++;
      } else {
        duplicates++;
      }
    } catch (err) {
      // Upgrade to WARN so INSERT errors are visible in production logs
      logger.warn({
        err,
        externalId,
        accountId: t.accountId,
        operationDate: safeDate,
        amount: t.amount,
        direction: t.direction,
      }, "Banking: bank_transactions INSERT failed (counted as duplicate)");
      duplicates++;
    }
  }

  return { fetched: txns.length, newlySaved, duplicates };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Sync one connector ───────────────────────────────────────────────────────

export async function syncConnector(
  connectorId: string,
  runType: "balances" | "transactions" | "full" = "full",
  periodDays?: number,
): Promise<{
  balancesUpdated: number;
  transactionsReceived: number;
  transactionsNew: number;
  transactionsDuplicates: number;
  statementsRequested: number;
  statementsSaved: number;
  statementsCreated: number;
  statementsReady: number;
  statementsProcessing: number;
  statementsTimeout: number;
  statementsDownloaded: number;
  transactionsExtracted: number;
  statementSaveSuccess: number;
  statementSaveFailed: number;
  statementReused: number;
  firstTransactionSample: Record<string, unknown> | null;
  durationMs: number;
  errors: string[];
  transactionsSupported: boolean;
  transactionsNotSupportedReason?: string;
  periodFrom: string | null;
  periodTo: string | null;
  firstRawStatementSample: Record<string, unknown> | null;
}> {
  const startedAt = Date.now();

  const [row] = await db
    .select()
    .from(bankConnectorsTable)
    .where(eq(bankConnectorsTable.id, connectorId));
  if (!row) throw new Error(`Connector not found: ${connectorId}`);

  const connector = buildConnector(row);
  const errors: string[] = [];
  let balancesUpdated = 0;
  let transactionsReceived = 0;
  let transactionsNew = 0;
  let transactionsDuplicates = 0;
  let statementsRequested = 0;
  let statementsSaved = 0;
  // Tochka async pipeline debug counters
  let statementsCreated = 0;
  let statementsReady = 0;
  let statementsProcessing = 0;
  let statementsTimeout = 0;
  let statementsDownloaded = 0;
  let transactionsExtracted = 0;
  let statementSaveSuccess = 0;
  let statementSaveFailed = 0;
  let statementReused = 0;
  let firstTransactionSample: Record<string, unknown> | null = null;
  let firstRawStatementSample: Record<string, unknown> | null = null;
  let syncPeriodFrom: string | null = null;
  let syncPeriodTo: string | null = null;

  const [run] = await db
    .insert(bankSyncRunsTable)
    .values({ bankConnectorId: connectorId, runType, status: "running" })
    .returning();

  try {
    // ── For Tochka: ensure customerCode before any API call ───────────────────
    // Auto-resolves via introspect + /customers, verifies from DB.
    // If still missing after all attempts → skip balances/transactions entirely.
    let customerCodeReady = true;
    let customerCodeErrorBody = "";
    if (row.bankName === "tochka" && connector instanceof TochkaConnector) {
      const code = await (connector as TochkaConnector).ensureCustomerCode();
      if (!code) {
        customerCodeReady = false;
        // Try one more time via getCustomers() to capture raw body for the error
        try {
          const customers = await (connector as TochkaConnector).getCustomers();
          if (customers.length > 0) {
            customerCodeErrorBody = `customers вернул ${customers.length} записей, но code пустой: ${JSON.stringify(customers.map(c => c.raw))}`;
          } else {
            customerCodeErrorBody = "customers endpoint вернул пустой список";
          }
        } catch (ce) {
          customerCodeErrorBody = String(ce);
        }
        const msg = `Не удалось получить CustomerCode. ${customerCodeErrorBody}`;
        errors.push(msg);
        logger.error({ connectorId, customerCodeErrorBody }, "Banking: customerCode missing — skipping accounts/balances/transactions");
      }
    }

    // ── Step: Load & save ALL accounts ───────────────────────────────────────
    // Accounts are needed for both "balances" and "transactions" runTypes.
    const savedAccountIds: string[] = [];
    let transactionsSupported = true;
    let transactionsNotSupportedReason = "";

    if (customerCodeReady && (runType === "balances" || runType === "full")) {
      try {
        const accounts = await connector.getAccounts();

        logger.info({
          step: "sync_accounts",
          status: "loaded",
          accounts_loaded_count: accounts.length,
          first_account_sample: accounts[0]
            ? {
                externalAccountId: accounts[0].externalAccountId,
                accountNumber: accounts[0].accountNumber,
                accountStatus: accounts[0].accountStatus,
                maskedAccount: accounts[0].maskedAccount,
                currency: accounts[0].currency,
              }
            : null,
        }, "Banking: accounts loaded from API");

        // ── Deduplicate by (connectorId, externalAccountId) — Rule: Part 1 ──
        const accountMap = new Map<string, typeof accounts[0]>();
        const duplicateExtIds: string[] = [];
        for (const acc of accounts) {
          const key = `${connectorId}::${acc.externalAccountId || acc.accountNumber}`;
          if (accountMap.has(key)) {
            duplicateExtIds.push(acc.externalAccountId);
            // Keep whichever has more raw fields
            const existing = accountMap.get(key)!;
            if (Object.keys(acc.raw).length > Object.keys(existing.raw).length) {
              accountMap.set(key, acc);
            }
          } else {
            accountMap.set(key, acc);
          }
        }
        const uniqueAccounts = Array.from(accountMap.values());

        logger.info({
          step: "sync_accounts",
          status: "deduplication",
          accounts_loaded_count: accounts.length,
          accounts_unique_count: uniqueAccounts.length,
          accounts_duplicates_skipped: duplicateExtIds.length,
          duplicate_external_account_ids: duplicateExtIds,
        }, "Banking: accounts deduplicated");

        // ── Save unique accounts — composite conflict target ──────────────────
        let accountsSavedCount = 0;
        for (const acc of uniqueAccounts) {
          await db
            .insert(bankAccountsTable)
            .values({
              bankConnectorId: connectorId,
              externalAccountId: acc.externalAccountId,
              accountName: acc.accountName,
              accountNumber: acc.accountNumber,
              accountStatus: acc.accountStatus ?? null,
              maskedAccount: acc.maskedAccount ?? null,
              currency: acc.currency,
              currentBalance: String(acc.currentBalance),
              availableBalance: String(acc.availableBalance),
              lastBalanceSyncAt: new Date(),
              raw: acc.raw as Record<string, unknown>,
            })
            .onConflictDoUpdate({
              // Composite unique index: (bank_connector_id, external_account_id)
              target: [bankAccountsTable.bankConnectorId, bankAccountsTable.externalAccountId],
              set: {
                accountName: acc.accountName,
                accountNumber: acc.accountNumber,
                accountStatus: acc.accountStatus ?? null,
                maskedAccount: acc.maskedAccount ?? null,
                currency: acc.currency,
                currentBalance: String(acc.currentBalance),
                availableBalance: String(acc.availableBalance),
                lastBalanceSyncAt: new Date(),
                raw: acc.raw as Record<string, unknown>,
              },
            })
            .execute();
          if (acc.externalAccountId) savedAccountIds.push(acc.externalAccountId);
          accountsSavedCount++;
          balancesUpdated++;
        }

        logger.info({
          step: "sync_accounts",
          status: "saved",
          accounts_loaded_count: accounts.length,
          accounts_unique_count: uniqueAccounts.length,
          accounts_saved_count: accountsSavedCount,
          accounts_duplicates_skipped: duplicateExtIds.length,
          savedAccountIds,
        }, "Banking: accounts saved to DB");

        // ── Fetch balance per accountId ───────────────────────────────────────
        if (savedAccountIds.length > 0) {
          try {
            const balances = await connector.getBalances(savedAccountIds);
            let balancesLoadedCount = 0;
            for (const bal of balances) {
              await db
                .update(bankAccountsTable)
                .set({
                  currentBalance: String(bal.currentBalance),
                  availableBalance: String(bal.availableBalance),
                  lastBalanceSyncAt: new Date(),
                })
                .where(
                  and(
                    eq(bankAccountsTable.bankConnectorId, connectorId),
                    eq(bankAccountsTable.externalAccountId, bal.externalAccountId),
                  )
                )
                .execute();
              balancesLoadedCount++;
            }
            logger.info({
              step: "sync_balances",
              status: "ok",
              balances_loaded_count: balancesLoadedCount,
              accounts_updated: balancesLoadedCount,
            }, "Banking: per-account balances updated");
          } catch (err) {
            logger.warn({ err, connectorId }, "Banking: per-account balance fetch failed (non-fatal)");
          }
        }
      } catch (err) {
        const msg = `Balances: ${String(err)}`;
        errors.push(msg);
        logger.error({ err, connectorId }, "Banking: balance sync error");
      }
    }

    // ── Step: Statements (Tochka) or Transactions (other connectors) ──────────
    // Tochka: /transactions returns 501 — use Statements API as canonical source.
    // Other connectors: standard getTransactions() endpoint.
    if (customerCodeReady && (runType === "transactions" || runType === "full")) {
      try {
        if (connector instanceof TochkaConnector) {
          // ── Tochka Statements API v2: async pipeline ──────────────────────────
          // Protocol: POST /statements → statementId → poll GET /statements
          //           until status=Ready (60s) → GET /accounts/{id}/statements/{id}
          const STMT_POLL_TIMEOUT_MS  = 60_000;
          const STMT_POLL_INTERVAL_MS = 3_000;

          const dbAccounts = await db
            .select({
              id: bankAccountsTable.id,
              externalAccountId: bankAccountsTable.externalAccountId,
              maskedAccount: bankAccountsTable.maskedAccount,
              lastStatementSyncAt: bankAccountsTable.lastStatementSyncAt,
            })
            .from(bankAccountsTable)
            .where(eq(bankAccountsTable.bankConnectorId, connectorId));

          logger.info({
            tag: "TX_SYNC_START",
            step: "sync_statements_v2",
            status: "start",
            connectorId,
            runType,
            periodDays: periodDays ?? null,
            accounts_count: dbAccounts.length,
            account_ids: dbAccounts.map(a => a.externalAccountId).filter(Boolean),
          }, "[TX_SYNC_START] Tochka Statements API v2 pipeline start");

          for (const account of dbAccounts) {
            if (!account.externalAccountId) continue;
            try {
              // ── Period logic per protocol ────────────────────────────────────
              // full:         always 90 days back, ignore lastStatementSyncAt
              // transactions: max(lastSyncAt - 3d, today - 30d) for incremental
              // periodDays:   explicit override (e.g. from API param)
              let from: Date;
              let fromSource: string;
              const to = new Date();
              if (runType === "full") {
                from = new Date(Date.now() - 90 * 86_400_000);
                fromSource = "full_sync_90d";
              } else if (periodDays != null) {
                from = new Date(Date.now() - periodDays * 86_400_000);
                fromSource = "periodDays_param";
              } else {
                // Incremental: go back to max(lastSyncAt - 3d, 30d ago)
                const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
                from = account.lastStatementSyncAt
                  ? new Date(Math.max(
                      account.lastStatementSyncAt.getTime() - 3 * 86_400_000,
                      thirtyDaysAgo.getTime(),
                    ))
                  : thirtyDaysAgo;
                fromSource = account.lastStatementSyncAt ? "lastSyncAt_minus3d" : "default_30d";
              }

              let periodFromStr = from.toISOString().slice(0, 10);
              const periodToStr = to.toISOString().slice(0, 10);

              // ── Same-day guard: window must always be ≥ 1 calendar day ────────
              if (periodFromStr >= periodToStr) {
                from = new Date(to.getTime() - 7 * 86_400_000);
                periodFromStr = from.toISOString().slice(0, 10);
                fromSource = "same_day_guard_7d";
              }

              // Track widest period seen across all accounts for final result
              if (!syncPeriodFrom || periodFromStr < syncPeriodFrom) syncPeriodFrom = periodFromStr;
              if (!syncPeriodTo   || periodToStr   > syncPeriodTo)   syncPeriodTo   = periodToStr;

              logger.info({
                tag: "TX_SYNC_PERIOD",
                connectorId,
                accountId: account.externalAccountId,
                periodFrom: periodFromStr,
                periodTo: periodToStr,
                fromSource,
                runType,
                lastStatementSyncAt: account.lastStatementSyncAt ?? null,
              }, "[TX_SYNC_PERIOD] period window computed");

              // ── 1. Check for existing pending or ready statement in DB ─────────
              const [existingStmt] = await db
                .select()
                .from(bankStatementsTable)
                .where(
                  and(
                    eq(bankStatementsTable.bankConnectorId, connectorId),
                    eq(bankStatementsTable.externalAccountId, account.externalAccountId),
                    eq(bankStatementsTable.periodFrom, periodFromStr),
                  ),
                );

              let statementId: string;

              // For full sync: ALWAYS create a new statement so we never poll stale/expired IDs.
              // Tochka expires statement IDs; resuming them produces "(not in list)" forever.
              // For incremental: skip if already ready (avoid redundant API calls),
              //   or resume if still processing.
              if (existingStmt?.status === "ready" && runType !== "full") {
                logger.info({
                  step: "sync_statements_v2",
                  accountId: account.externalAccountId,
                  statementId: existingStmt.externalStatementId,
                  status: "already_ready",
                  runType,
                }, "Banking: statement already Ready — skipping (incremental)");
                statementsReady++;
                continue;
              } else if (existingStmt?.externalStatementId && existingStmt.status !== "error" && runType !== "full") {
                // Resume polling — incremental only, skip for full sync
                statementId = existingStmt.externalStatementId;
                statementReused++;
                logger.info({
                  step: "sync_statements_v2",
                  accountId: account.externalAccountId,
                  statementId,
                  existingStatus: existingStmt.status,
                }, "Banking: resuming polling for existing statement");
              } else {
                // ── Init new statement ─────────────────────────────────────────
                statementsRequested++;
                logger.info({
                  tag: "TX_SYNC_INIT_STATEMENT",
                  step: "sync_statements_v2",
                  status: "init_request",
                  connectorId,
                  accountId: account.externalAccountId,
                  periodFrom: periodFromStr,
                  periodTo: periodToStr,
                  statementsRequested,
                }, "[TX_SYNC_INIT_STATEMENT] calling initStatement");
                statementId = await (connector as TochkaConnector).initStatement(
                  account.externalAccountId, from, to,
                );
                statementsCreated++;
                logger.info({
                  tag: "TX_SYNC_STATEMENT_CREATED",
                  step: "sync_statements_v2",
                  status: "created",
                  connectorId,
                  accountId: account.externalAccountId,
                  statementId,
                  periodFrom: periodFromStr,
                  periodTo: periodToStr,
                }, "[TX_SYNC_STATEMENT_CREATED] statementId obtained from Tochka");

                // ── Save to DB with ON CONFLICT upsert ─────────────────────────
                // Requires unique index on (bank_connector_id, external_account_id, period_from).
                // The index is created by runMigrations() at server startup.
                // On failure: log full PG error details and fall back to plain INSERT.
                try {
                  await db
                    .insert(bankStatementsTable)
                    .values({
                      bankConnectorId: connectorId,
                      bankAccountId:   account.id,
                      externalStatementId: statementId,
                      externalAccountId:   account.externalAccountId,
                      periodFrom: periodFromStr,
                      periodTo:   periodToStr,
                      status: "created",
                      requestedAt: new Date(),
                    })
                    .onConflictDoUpdate({
                      target: [
                        bankStatementsTable.bankConnectorId,
                        bankStatementsTable.externalAccountId,
                        bankStatementsTable.periodFrom,
                      ],
                      set: {
                        externalStatementId: statementId,
                        status: "created",
                        requestedAt: new Date(),
                      },
                    })
                    .execute();
                  statementSaveSuccess++;
                  logger.info({
                    step: "sync_statements_v2",
                    status: "saved",
                    accountId: account.externalAccountId,
                    statementId,
                    periodFromStr,
                    periodToStr,
                  }, "Banking: statement saved to DB");
                } catch (saveErr: unknown) {
                  statementSaveFailed++;
                  const pgErr = saveErr as Record<string, unknown>;
                  logger.error({
                    step: "sync_statements_v2_save",
                    status: "failed",
                    accountId: account.externalAccountId,
                    statementId,
                    pg_code:       pgErr["code"],
                    pg_detail:     pgErr["detail"],
                    pg_constraint: pgErr["constraint"],
                    pg_message:    pgErr["message"],
                    pg_hint:       pgErr["hint"],
                  }, "Banking: statement DB save failed — attempting plain INSERT fallback");

                  // Fallback: plain INSERT (ignore conflict if any), then re-select
                  try {
                    await db
                      .insert(bankStatementsTable)
                      .values({
                        bankConnectorId: connectorId,
                        bankAccountId:   account.id,
                        externalStatementId: statementId,
                        externalAccountId:   account.externalAccountId,
                        periodFrom: periodFromStr,
                        periodTo:   periodToStr,
                        status: "created",
                        requestedAt: new Date(),
                      })
                      .onConflictDoNothing()
                      .execute();
                    statementSaveSuccess++;
                    logger.info({
                      step: "sync_statements_v2_save",
                      status: "fallback_ok",
                      accountId: account.externalAccountId,
                      statementId,
                    }, "Banking: statement saved via fallback INSERT");
                  } catch (fallbackErr) {
                    logger.error({
                      err: fallbackErr,
                      accountId: account.externalAccountId,
                      statementId,
                    }, "Banking: statement fallback INSERT also failed — continuing without save");
                  }
                }

                logger.info({
                  step: "sync_statements_v2",
                  status: "initiated",
                  accountId: account.externalAccountId,
                  statementId,
                  periodFromStr,
                  periodToStr,
                  statementSaveSuccess,
                  statementSaveFailed,
                }, "Banking: statement initiated");
              }

              // ── 2. Poll until Ready (60s timeout, 3s interval) ───────────────
              const deadline = Date.now() + STMT_POLL_TIMEOUT_MS;
              let isReady = false;

              while (Date.now() < deadline) {
                const stmtList = await (connector as TochkaConnector).getStatementsList();
                const found = stmtList.find((s) => s.statementId === statementId);

                // Update last polled timestamp
                await db
                  .update(bankStatementsTable)
                  .set({ lastPolledAt: new Date() })
                  .where(
                    and(
                      eq(bankStatementsTable.bankConnectorId, connectorId),
                      eq(bankStatementsTable.externalAccountId, account.externalAccountId),
                      eq(bankStatementsTable.periodFrom, periodFromStr),
                    ),
                  )
                  .execute();

                logger.info({
                  tag: "TX_SYNC_POLL",
                  step: "sync_statements_v2_poll",
                  accountId: account.externalAccountId,
                  statementId,
                  found_status: found?.status ?? "(not in list)",
                  list_size: stmtList.length,
                  ms_remaining: Math.max(0, deadline - Date.now()),
                }, "[TX_SYNC_POLL] Banking: statement poll tick");

                if (found?.status === "Ready") {
                  isReady = true;
                  statementsReady++;
                  await db
                    .update(bankStatementsTable)
                    .set({ status: "ready", readyAt: new Date(), lastPolledAt: new Date() })
                    .where(
                      and(
                        eq(bankStatementsTable.bankConnectorId, connectorId),
                        eq(bankStatementsTable.externalAccountId, account.externalAccountId),
                        eq(bankStatementsTable.periodFrom, periodFromStr),
                      ),
                    )
                    .execute();
                  break;
                }

                // Created or Processing — wait
                if (Date.now() + STMT_POLL_INTERVAL_MS < deadline) {
                  await sleep(STMT_POLL_INTERVAL_MS);
                } else {
                  break;
                }
              }

              if (!isReady) {
                // Timeout — leave statement as 'processing' for next sync to resume
                statementsTimeout++;
                statementsProcessing++;
                await db
                  .update(bankStatementsTable)
                  .set({ status: "processing", lastPolledAt: new Date() })
                  .where(
                    and(
                      eq(bankStatementsTable.bankConnectorId, connectorId),
                      eq(bankStatementsTable.externalAccountId, account.externalAccountId),
                      eq(bankStatementsTable.periodFrom, periodFromStr),
                    ),
                  )
                  .execute();
                // Use errors array so it surfaces in sync run message, but won't break connector
                errors.push(
                  `Выписка заказана. Банк готовит операции для счёта ${account.externalAccountId}. ` +
                  `Повторите sync через минуту. (statementId=${statementId})`
                );
                logger.warn({
                  step: "sync_statements_v2",
                  status: "timeout",
                  accountId: account.externalAccountId,
                  statementId,
                }, "Banking: statement not Ready within 60s — will resume next sync");
                continue;
              }

              // ── 3. Download ready statement ───────────────────────────────────
              statementsDownloaded++;
              statementsSaved++;

              // getStatementById now returns { raw, transactions }
              // raw = full Data block saved to bank_statements for audit/debug
              const { raw: stmtRaw, transactions: txns } =
                await (connector as TochkaConnector).getStatementById(
                  account.externalAccountId, statementId,
                );

              // Save raw statement payload + update status/transactionCount
              await db
                .update(bankStatementsTable)
                .set({
                  raw: stmtRaw as Record<string, unknown>,
                  status: "ready",
                  readyAt: new Date(),
                  transactionCount: txns.length,
                  lastPolledAt: new Date(),
                })
                .where(
                  and(
                    eq(bankStatementsTable.bankConnectorId, connectorId),
                    eq(bankStatementsTable.externalAccountId, account.externalAccountId),
                    eq(bankStatementsTable.periodFrom, periodFromStr),
                  ),
                )
                .execute();

              // Capture first raw statement for debug response
              if (!firstRawStatementSample) firstRawStatementSample = stmtRaw;

              transactionsExtracted += txns.length;
              transactionsReceived  += txns.length;

              if (txns.length > 0 && !firstTransactionSample) {
                firstTransactionSample = txns[0]!.raw;
              }

              const enriched = txns.map((t) => ({
                ...t,
                maskedAccount: account.maskedAccount ?? t.maskedAccount,
              }));
              const stats = await saveTransactions(connectorId, row.bankName, run.id, enriched);
              transactionsNew        += stats.newlySaved;
              transactionsDuplicates += stats.duplicates;

              await db
                .update(bankAccountsTable)
                .set({ lastStatementSyncAt: new Date() })
                .where(eq(bankAccountsTable.id, account.id))
                .execute();

              logger.info({
                tag: "TX_SYNC_TRANSACTIONS_SAVED",
                step: "sync_statements_v2",
                status: "complete",
                connectorId,
                accountId: account.externalAccountId,
                statementId,
                periodFrom: periodFromStr,
                periodTo: periodToStr,
                txns_extracted: txns.length,
                txns_new: stats.newlySaved,
                txns_duplicates: stats.duplicates,
                transactionsNew_total: transactionsNew,
              }, "[TX_SYNC_TRANSACTIONS_SAVED] Banking: statement synced successfully");

            } catch (err) {
              const msg = `Statement[${account.externalAccountId}]: ${String(err)}`;
              errors.push(msg);
              logger.warn({ err, accountId: account.externalAccountId }, "Banking: statement sync failed for account (non-fatal)");
            }
          }

          transactionsSupported = true;
          logger.info({
            step: "sync_statements_v2",
            status: "done",
            statements_init_requested: statementsRequested,
            statements_created: statementsCreated,
            statements_ready: statementsReady,
            statements_processing: statementsProcessing,
            statements_timeout: statementsTimeout,
            statements_downloaded: statementsDownloaded,
            transactions_extracted: transactionsExtracted,
            transactions_new: transactionsNew,
            transactions_duplicates: transactionsDuplicates,
          }, "Banking: Tochka statements v2 pipeline complete");

        } else {
          // ── Other connectors: standard /transactions endpoint ──────────────────
          let accountIds = savedAccountIds;
          if (accountIds.length === 0) {
            const dbAccts = await db
              .select({ externalAccountId: bankAccountsTable.externalAccountId })
              .from(bankAccountsTable)
              .where(eq(bankAccountsTable.bankConnectorId, connectorId));
            accountIds = dbAccts
              .map(a => a.externalAccountId)
              .filter((id): id is string => !!id);
          }
          const to = new Date();
          const from = periodDays != null
            ? new Date(Date.now() - periodDays * 86_400_000)
            : new Date(Date.now() - 90 * 86_400_000);
          logger.info({
            step: "sync_transactions", status: "start", accountIds,
            from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
          }, "Banking: fetching transactions per accountId");

          if (accountIds.length > 0) {
            for (const accountId of accountIds) {
              try {
                const txns = await connector.getTransactions(from, to, accountId);
                transactionsReceived += txns.length;
                const stats = await saveTransactions(connectorId, row.bankName, run.id, txns);
                transactionsNew += stats.newlySaved;
                transactionsDuplicates += stats.duplicates;
                logger.info({
                  step: "sync_transactions", status: "ok",
                  accountId, fetched: txns.length, new: stats.newlySaved, duplicates: stats.duplicates,
                }, "Banking: transactions saved for account");
              } catch (err) {
                const msg = `Transactions[${accountId}]: ${String(err)}`;
                errors.push(msg);
                logger.error({ err, connectorId, accountId }, "Banking: transaction fetch error for account");
              }
            }
          } else {
            logger.warn({ connectorId }, "Banking: no accountIds found — skipping transactions");
          }
        }
      } catch (err) {
        const msg = `Transactions: ${String(err)}`;
        errors.push(msg);
        logger.error({ err, connectorId }, "Banking: transaction/statements sync error");
      }
    }

    const durationMs = Date.now() - startedAt;

    // ── Update connector status ───────────────────────────────────────────────
    // pending_statements: all statements are Processing (not an error — just waiting)
    // connected_partial: accounts + balances OK, but transactions not supported
    // error: hard failures (OAuth, customerCode, accounts, balances)
    const onlyPendingErrors = errors.length > 0 && errors.every((e) => e.startsWith("Выписка заказана"));
    const hardErrors = errors.filter((e) => !e.startsWith("Выписка заказана"));
    const isPartial = hardErrors.length === 0 && !transactionsSupported;
    const derivedStatus = hardErrors.length > 0
      ? "error"
      : transactionsSupported ? "active" : "connected_partial";

    await db
      .update(bankConnectorsTable)
      .set({
        lastSyncAt: new Date(),
        connectorStatus: derivedStatus,
        lastSuccessAt: hardErrors.length === 0 ? new Date() : row.lastSuccessAt,
        lastError: hardErrors.length > 0
          ? hardErrors.join("; ")
          : onlyPendingErrors
            ? `Выписка заказана — банк готовит данные (${statementsProcessing} счёт(а))`
            : isPartial ? transactionsNotSupportedReason : null,
        updatedAt: new Date(),
      })
      .where(eq(bankConnectorsTable.id, connectorId));

    const debugRaw = {
      statements_init_requested: statementsRequested,
      statements_created: statementsCreated,
      statements_ready: statementsReady,
      statements_processing: statementsProcessing,
      statements_timeout: statementsTimeout,
      statements_downloaded: statementsDownloaded,
      transactions_extracted: transactionsExtracted,
      transactions_saved: transactionsNew,
      duplicates_skipped: transactionsDuplicates,
      first_transaction_sample: firstTransactionSample,
    };

    await db
      .update(bankSyncRunsTable)
      .set({
        finishedAt: new Date(),
        status: hardErrors.length > 0 ? "error" : (onlyPendingErrors ? "partial" : (transactionsSupported ? "success" : "partial")),
        transactionsReceived,
        transactionsNew,
        transactionsDuplicates,
        balancesUpdated,
        statementsRequested,
        statementsSaved,
        errorsCount: errors.length,
        durationMs,
        errorMessage: errors.length > 0 ? errors.join("; ") : (isPartial ? transactionsNotSupportedReason : null),
        raw: debugRaw as Record<string, unknown>,
      })
      .where(eq(bankSyncRunsTable.id, run.id));

    logger.info({
      connectorId, balancesUpdated, transactionsReceived, transactionsNew, transactionsDuplicates,
      statementsRequested, statementsSaved, statementsCreated, statementsReady,
      statementsProcessing, statementsTimeout, statementsDownloaded,
      transactionsExtracted, durationMs, transactions_supported: transactionsSupported,
      periodFrom: syncPeriodFrom, periodTo: syncPeriodTo,
    }, "Banking: sync complete");

    return {
      balancesUpdated,
      transactionsReceived,
      transactionsNew,
      transactionsDuplicates,
      statementsRequested,
      statementsSaved,
      statementsCreated,
      statementsReady,
      statementsProcessing,
      statementsTimeout,
      statementsDownloaded,
      transactionsExtracted,
      statementSaveSuccess,
      statementSaveFailed,
      statementReused,
      firstTransactionSample,
      firstRawStatementSample,
      periodFrom: syncPeriodFrom,
      periodTo: syncPeriodTo,
      durationMs,
      errors,
      transactionsSupported,
      transactionsNotSupportedReason: transactionsSupported ? undefined : transactionsNotSupportedReason,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    await db
      .update(bankSyncRunsTable)
      .set({ finishedAt: new Date(), status: "error", errorMessage: String(err), durationMs })
      .where(eq(bankSyncRunsTable.id, run.id));
    throw err;
  }
}

// ─── Polling manager ──────────────────────────────────────────────────────────

let balancesTimer: ReturnType<typeof setInterval> | null = null;
let transactionsTimer: ReturnType<typeof setInterval> | null = null;

async function pollActiveConnectors(runType: "balances" | "transactions") {
  try {
    const connectors = await db
      .select({ id: bankConnectorsTable.id })
      .from(bankConnectorsTable)
      .where(inArray(bankConnectorsTable.connectorStatus, ["active", "connected_partial"]));
    for (const { id } of connectors) {
      syncConnector(id, runType).catch((err) =>
        logger.error({ err, connectorId: id }, `Banking poll (${runType}) error`),
      );
    }
  } catch (err) {
    logger.error({ err }, "Banking: poll query error");
  }
}

export function startBankingPolling() {
  if (balancesTimer) return;
  balancesTimer     = setInterval(() => pollActiveConnectors("balances"),     5 * 60 * 1000);
  transactionsTimer = setInterval(() => pollActiveConnectors("transactions"), 15 * 60 * 1000);
  logger.info("Banking: polling started (balances 5m, transactions 15m)");
}

export function stopBankingPolling() {
  if (balancesTimer)     { clearInterval(balancesTimer);     balancesTimer     = null; }
  if (transactionsTimer) { clearInterval(transactionsTimer); transactionsTimer = null; }
  logger.info("Banking: polling stopped");
}
