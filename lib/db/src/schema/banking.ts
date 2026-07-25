import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  numeric,
  integer,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Bank Connectors ──────────────────────────────────────────────────────────

export const bankConnectorsTable = pgTable("bank_connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankName: text("bank_name").notNull(),            // 'tochka' | 'tinkoff' | 'vtb'
  displayName: text("display_name"),
  connectorStatus: text("connector_status").default("inactive"),  // 'active'|'inactive'|'error'|'not_configured'
  authType: text("auth_type"),                      // 'oauth' | 'api_key' | 'manual'
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  syncFrequencyMinutes: integer("sync_frequency_minutes").default(15),
  config: jsonb("config"),                          // encrypted-at-rest in prod; here plaintext
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type BankConnector = typeof bankConnectorsTable.$inferSelect;

// ─── Bank Accounts ────────────────────────────────────────────────────────────

export const bankAccountsTable = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankConnectorId: uuid("bank_connector_id"),       // FK → bank_connectors.id
  externalAccountId: text("external_account_id"),  // bank-assigned account id
  accountName: text("account_name"),
  accountNumber: text("account_number"),
  currency: text("currency").default("RUB"),
  currentBalance: numeric("current_balance"),
  availableBalance: numeric("available_balance"),
  accountStatus: text("account_status"),             // "Enabled"|"Disabled"|"Locked"
  maskedAccount: text("masked_account"),             // "****1234"
  branchCrmId: text("branch_crm_id"),               // mapped Atlas branch
  lastBalanceSyncAt: timestamp("last_balance_sync_at", { withTimezone: true }),
  lastStatementSyncAt: timestamp("last_statement_sync_at", { withTimezone: true }),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  // Composite unique: one account per (connector, externalAccountId)
  uniqueIndex("uq_bank_accounts_connector_extid").on(t.bankConnectorId, t.externalAccountId),
]);

export type BankAccount = typeof bankAccountsTable.$inferSelect;

// ─── Bank Sync Runs ───────────────────────────────────────────────────────────

export const bankSyncRunsTable = pgTable("bank_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankConnectorId: uuid("bank_connector_id"),       // FK → bank_connectors.id
  runType: text("run_type").default("transactions"), // 'balances' | 'transactions' | 'full'
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").default("running"),        // 'running'|'success'|'error'|'skipped'
  transactionsReceived: integer("transactions_received").default(0),
  transactionsNew: integer("transactions_new").default(0),
  transactionsUpdated: integer("transactions_updated").default(0),
  transactionsDuplicates: integer("transactions_duplicates").default(0),
  balancesUpdated: integer("balances_updated").default(0),
  statementsRequested: integer("statements_requested").default(0),
  statementsSaved: integer("statements_saved").default(0),
  errorsCount: integer("errors_count").default(0),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  raw: jsonb("raw"),
});

export type BankSyncRun = typeof bankSyncRunsTable.$inferSelect;

// ─── Bank Transactions Raw ────────────────────────────────────────────────────
// Raw transactions from bank API before normalization.
// Architecture: BANK API → bank_transactions_raw → (normalization) → bank_transactions → DDS

export const bankTransactionsRawTable = pgTable("bank_transactions_raw", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankConnectorId: uuid("bank_connector_id"),       // FK → bank_connectors.id
  syncRunId: uuid("sync_run_id"),                   // FK → bank_sync_runs.id
  externalTransactionId: text("external_transaction_id"),
  accountId: text("account_id"),                    // bank-assigned account id
  amount: numeric("amount"),
  currency: text("currency").default("RUB"),
  direction: text("direction"),                     // 'income' | 'expense'
  counterpartyName: text("counterparty_name"),
  counterpartyInn: text("counterparty_inn"),
  purpose: text("purpose"),
  operationDate: text("operation_date"),            // YYYY-MM-DD
  bookingDate: text("booking_date"),                // YYYY-MM-DD
  bankStatus: text("bank_status"),
  rawJson: jsonb("raw_json"),                       // full original bank payload
  normalizedStatus: text("normalized_status").default("pending"), // 'pending'|'normalized'|'skipped'|'error'
  articleId: uuid("article_id"),                    // after AI classification
  contractorId: uuid("contractor_id"),
  employeeId: uuid("employee_id"),
  aiClassifiedAt: timestamp("ai_classified_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type BankTransactionRaw = typeof bankTransactionsRawTable.$inferSelect;

// ─── Bank Statements ──────────────────────────────────────────────────────────
// One row per bank statement (monthly billing period) per account.
// Statements are the canonical source of transactions for Tochka Open Banking.

export const bankStatementsTable = pgTable("bank_statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankConnectorId: uuid("bank_connector_id"),          // FK → bank_connectors.id
  bankAccountId: uuid("bank_account_id"),              // FK → bank_accounts.id
  externalStatementId: text("external_statement_id"),  // bank-assigned statement id (Tochka statementId)
  externalAccountId: text("external_account_id"),      // mirrors bank_accounts.external_account_id
  periodFrom: text("period_from"),                     // YYYY-MM-DD
  periodTo: text("period_to"),                         // YYYY-MM-DD
  // Async pipeline status: 'created' | 'processing' | 'ready' | 'timeout' | 'error'
  status: text("status").default("created"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow(),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  transactionCount: integer("transaction_count").default(0),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex("uq_bank_statements_connector_account_period").on(
    t.bankConnectorId, t.externalAccountId, t.periodFrom,
  ),
]);

export type BankStatement = typeof bankStatementsTable.$inferSelect;
