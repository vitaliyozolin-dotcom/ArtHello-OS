import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";

export const evotorConnectorsTable = pgTable("evotor_connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  publisherTokenEnc: text("publisher_token_enc"),
  publisherTokenLast4: text("publisher_token_last4"),
  publisherTokenSavedAt: timestamp("publisher_token_saved_at", { withTimezone: true }),
  userTokenEnc: text("user_token_enc"),
  userTokenLast4: text("user_token_last4"),
  userTokenReceivedAt: timestamp("user_token_received_at", { withTimezone: true }),
  storesCount: integer("stores_count").default(0),
  devicesCount: integer("devices_count").default(0),
  employeesCount: integer("employees_count").default(0),
  documentsCount: integer("documents_count").default(0),
  lastDiscoveryAt: timestamp("last_discovery_at", { withTimezone: true }),
  discoveryRaw: jsonb("discovery_raw"),
  readiness: text("readiness").default("NOT_CONNECTED"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const evotorSyncBatchesTable = pgTable("evotor_sync_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  status: text("status").default("pending"),
  recordsRaw: integer("records_raw").default(0),
  recordsSaved: integer("records_saved").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  raw: jsonb("raw"),
});

export const evotorRawRecordsTable = pgTable("evotor_raw_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  externalId: text("external_id"),
  batchId: uuid("batch_id"),
  raw: jsonb("raw").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
});
