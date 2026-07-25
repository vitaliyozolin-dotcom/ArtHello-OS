import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  numeric,
  date,
  integer,
  boolean,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const alphaSyncBatchesTable = pgTable("alpha_sync_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").default("running"),
  mode: text("mode").notNull().default("discovery"),
  fromDate: date("from_date"),
  toDate: date("to_date"),
  branchId: text("branch_id"),
  entitiesRequested: integer("entities_requested").default(0),
  entitiesSucceeded: integer("entities_succeeded").default(0),
  entitiesFailed: integer("entities_failed").default(0),
  endpointsChecked: integer("endpoints_checked").default(0),
  totalFetched: integer("total_fetched").default(0),
  totalSaved: integer("total_saved").default(0),
  totalUpdated: integer("total_updated").default(0),
  totalSkipped: integer("total_skipped").default(0),
  totalErrors: integer("total_errors").default(0),
  errors: jsonb("errors"),
  durationMs: integer("duration_ms"),
  triggeredBy: text("triggered_by").default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const alphaRawRecordsTable = pgTable(
  "alpha_raw_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alphaId: text("alpha_id"),
    entityType: text("entity_type").notNull(),
    endpoint: text("endpoint"),
    branchId: text("branch_id"),
    sourcePayload: jsonb("source_payload").notNull(),
    payloadHash: text("payload_hash"),
    syncBatchId: uuid("sync_batch_id"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
    syncStatus: text("sync_status").default("raw"),
    isDeleted: boolean("is_deleted").default(false),
    isArchived: boolean("is_archived").default(false),
    externalCreatedAt: timestamp("external_created_at", { withTimezone: true }),
    externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
    page: integer("page"),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique("alpha_raw_records_uniq").on(t.alphaId, t.entityType, t.branchId, t.payloadHash),
  ],
);

// Immutable payloads are deduplicated in alpha_raw_records. This append-only
// table preserves every batch/page observation of those payloads.
export const alphaRawObservationsTable = pgTable(
  "alpha_raw_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncBatchId: uuid("sync_batch_id")
      .notNull()
      .references(() => alphaSyncBatchesTable.id, { onDelete: "restrict" }),
    rawRecordId: uuid("raw_record_id")
      .notNull()
      .references(() => alphaRawRecordsTable.id, { onDelete: "restrict" }),
    endpoint: text("endpoint").notNull(),
    branchId: text("branch_id").notNull(),
    entityType: text("entity_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    page: integer("page").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("alpha_raw_observations_batch_raw_uniq").on(
      table.syncBatchId,
      table.rawRecordId,
    ),
    index("alpha_raw_observations_batch_scope_idx").on(
      table.syncBatchId,
      table.scopeKey,
    ),
    index("alpha_raw_observations_raw_idx").on(table.rawRecordId),
  ],
);

// Reconciliation is allowed only for a scope that reached completed after all
// pages were read and normalized. Failed scopes retain their previous state.
export const alphaSyncScopeRunsTable = pgTable(
  "alpha_sync_scope_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncBatchId: uuid("sync_batch_id")
      .notNull()
      .references(() => alphaSyncBatchesTable.id, { onDelete: "restrict" }),
    scopeKey: text("scope_key").notNull(),
    branchId: text("branch_id").notNull(),
    entityType: text("entity_type").notNull(),
    status: text("status").notNull().default("running"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    recordsFetched: integer("records_fetched").notNull().default(0),
    safeErrorCode: text("safe_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    unique("alpha_sync_scope_runs_batch_scope_uniq").on(
      table.syncBatchId,
      table.scopeKey,
    ),
    index("alpha_sync_scope_runs_status_idx").on(
      table.syncBatchId,
      table.status,
    ),
  ],
);

export const alphaEndpointRegistryTable = pgTable(
  "alpha_endpoint_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityKey: text("entity_key").notNull(),
    endpoint: text("endpoint").notNull(),
    branchId: text("branch_id"),
    method: text("method").default("POST"),
    requestBody: jsonb("request_body"),
    status: text("status").default("UNKNOWN"),
    httpStatus: integer("http_status"),
    recordsFetched: integer("records_fetched"),
    pagesFetched: integer("pages_fetched"),
    firstSuccessfulPage: integer("first_successful_page"),
    lastSuccessfulPage: integer("last_successful_page"),
    errorMessage: text("error_message"),
    responseSample: jsonb("response_sample"),
    discoveredFields: jsonb("discovered_fields"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    nextAction: text("next_action"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique("alpha_endpoint_registry_uniq").on(t.entityKey, t.branchId),
  ],
);

export const alphaLinkingIssuesTable = pgTable("alpha_linking_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  syncBatchId: uuid("sync_batch_id"),
  entityType: text("entity_type"),
  alphaId: text("alpha_id"),
  rawRecordId: uuid("raw_record_id"),
  issueType: text("issue_type"),
  issueMessage: text("issue_message"),
  missingReferenceType: text("missing_reference_type"),
  missingReferenceId: text("missing_reference_id"),
  severity: text("severity").default("warning"),
  suggestedAction: text("suggested_action"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  branchId: text("branch_id"),
});

export const alphaVerificationReportsTable = pgTable("alpha_verification_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  fromDate: date("from_date"),
  toDate: date("to_date"),
  report: jsonb("report"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alphaSyncScopeTable = pgTable("alpha_sync_scope", {
  id: uuid("id").primaryKey().defaultRandom(),
  scopeName: text("scope_name").unique().notNull(),
  branchId: text("branch_id").notNull(),
  branchName: text("branch_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  reason: text("reason"),
  createdBy: text("created_by").default("system"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alphaDuplicateCandidatesTable = pgTable(
  "alpha_duplicate_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull().default("6"),
    entityType: text("entity_type").notNull(),
    candidateType: text("candidate_type").notNull(),
    entityAId: text("entity_a_id").notNull(),
    entityBId: text("entity_b_id").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 2 }).notNull().default("0.5"),
    reason: text("reason"),
    sourceFields: jsonb("source_fields"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("alpha_dup_candidates_uniq").on(t.entityType, t.entityAId, t.entityBId, t.candidateType),
  ],
);
