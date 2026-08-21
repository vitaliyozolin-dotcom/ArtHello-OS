import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  numeric,
  integer,
  boolean,
  date,
} from "drizzle-orm/pg-core";

// ─── Source Connectors ────────────────────────────────────────────────────────

export const sourceConnectorsTable = pgTable("source_connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceName: text("source_name").notNull(),
  sourceType: text("source_type").notNull(), // crm / google_sheet / bank / website / social / messenger / telephony / manual
  status: text("status").notNull().default("inactive"), // active / inactive / error
  config: jsonb("config"),                              // mapping, sheet id, account info, etc.
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type SourceConnector = typeof sourceConnectorsTable.$inferSelect;

// ─── Raw Events ───────────────────────────────────────────────────────────────

export const rawEventsTable = pgTable("raw_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceConnectorId: uuid("source_connector_id"),
  sourceSystem: text("source_system").notNull(),
  externalId: text("external_id"),
  eventType: text("event_type").notNull(), // lead / message / call / form / payment / transaction / attendance / lesson / student / unknown
  eventTime: timestamp("event_time", { withTimezone: true }),
  raw: jsonb("raw"),
  hash: text("hash").unique(),
  processed: boolean("processed").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type RawEvent = typeof rawEventsTable.$inferSelect;

// ─── Normalized Events ────────────────────────────────────────────────────────

export const normalizedEventsTable = pgTable("normalized_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  rawEventId: uuid("raw_event_id"),
  eventType: text("event_type"),
  branchCrmId: text("branch_crm_id"),
  clientName: text("client_name"),
  phone: text("phone"),
  email: text("email"),
  channel: text("channel"),
  source: text("source"),
  campaign: text("campaign"),
  message: text("message"),
  amount: numeric("amount"),
  status: text("status"),
  matchedStudentCrmId: text("matched_student_crm_id"),
  matchedPaymentCrmId: text("matched_payment_crm_id"),
  matchedBankTransactionId: uuid("matched_bank_transaction_id"),
  confidence: numeric("confidence"),
  duplicateCandidate: boolean("duplicate_candidate").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type NormalizedEvent = typeof normalizedEventsTable.$inferSelect;

// ─── Bank Import Batches ──────────────────────────────────────────────────────

export const bankImportBatchesTable = pgTable("bank_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankName: text("bank_name"),
  accountName: text("account_name"),
  branchCrmId: text("branch_crm_id"),
  fileName: text("file_name"),
  format: text("format"),                 // 'tinkoff' | 'sberbank' | 'generic'
  dateFrom: date("date_from"),
  dateTo: date("date_to"),
  transactionCount: integer("transaction_count").default(0),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow(),
  importedBy: text("imported_by").default("owner"),
  notes: text("notes"),
  // legacy fields
  rowsTotal: integer("rows_total"),
  rowsImported: integer("rows_imported"),
  rowsSkipped: integer("rows_skipped"),
  rowsUnclear: integer("rows_unclear"),
  status: text("status"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type BankImportBatch = typeof bankImportBatchesTable.$inferSelect;

// ─── Integration Credentials (metadata only — no plaintext secrets) ───────────

export const integrationCredentialsTable = pgTable("integration_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceConnectorId: uuid("source_connector_id"),
  credentialType: text("credential_type"),             // 'service_account' | 'oauth' | 'api_key' | 'webhook_secret'
  encryptedPayload: text("encrypted_payload"),         // metadata reference only; real secrets stay in ENV
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type IntegrationCredential = typeof integrationCredentialsTable.$inferSelect;
