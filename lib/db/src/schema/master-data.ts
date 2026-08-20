import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  alphaRawRecordsTable,
  alphaSyncBatchesTable,
} from "./alpha-sync.js";
import { requireExplicitAlfaProvenance } from "./alfa-provenance.js";

// Owner-confirmed legal entities. Bank accounts and production identifiers are
// intentionally kept out of this directory until the bank phase is approved.
export const legalEntitiesTable = pgTable("legal_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  displayName: text("display_name").notNull(),
  legalName: text("legal_name").notNull(),
  entityType: text("entity_type").notNull(),
  confirmationSource: text("confirmation_source").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LegalEntity = typeof legalEntitiesTable.$inferSelect;

// Stable operating units are mapped to a legal entity independently from CRM.
export const operatingUnitLegalEntityTable = pgTable(
  "operating_unit_legal_entity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatingUnitCode: text("operating_unit_code").notNull(),
    operatingUnitName: text("operating_unit_name").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    mappingStatus: text("mapping_status").notNull().default("owner_confirmed"),
    confirmationSource: text("confirmation_source").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("operating_unit_legal_entity_code_uniq").on(table.operatingUnitCode),
  ],
);

export type OperatingUnitLegalEntity =
  typeof operatingUnitLegalEntityTable.$inferSelect;

// A legal operating unit may contain several CRM branches. Branch IDs are
// attached only when a deterministic, reviewable name rule matches.
export const branchLegalEntityAssignmentsTable = pgTable(
  "branch_legal_entity_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    branchName: text("branch_name"),
    operatingUnitCode: text("operating_unit_code").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    mappingStatus: text("mapping_status").notNull().default("pending_review"),
    mappingRule: text("mapping_rule").notNull(),
    confirmationSource: text("confirmation_source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("branch_legal_entity_assignments_branch_uniq").on(table.branchCrmId),
  ],
);

export type BranchLegalEntityAssignment =
  typeof branchLegalEntityAssignmentsTable.$inferSelect;

// Generic immutable raw layer for approved non-API sources such as payroll
// spreadsheets. Re-importing identical source content reuses the batch hash.
export const sourceImportBatchesTable = pgTable(
  "source_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: text("source_system").notNull(),
    sourceExternalId: text("source_external_id").notNull(),
    sourceTitle: text("source_title"),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("running"),
    recordsRead: integer("records_read").notNull().default(0),
    recordsSaved: integer("records_saved").notNull().default(0),
    recordsRejected: integer("records_rejected").notNull().default(0),
    errors: jsonb("errors"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("source_import_batches_content_uniq").on(
      table.sourceSystem,
      table.sourceExternalId,
      table.contentHash,
    ),
  ],
);

export type SourceImportBatch = typeof sourceImportBatchesTable.$inferSelect;

export const sourceRawRecordsTable = pgTable(
  "source_raw_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importBatchId: uuid("import_batch_id").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceExternalId: text("source_external_id").notNull(),
    recordType: text("record_type").notNull(),
    recordLocator: text("record_locator").notNull(),
    externalRecordId: text("external_record_id"),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("source_raw_records_batch_locator_uniq").on(
      table.importBatchId,
      table.recordLocator,
      table.payloadHash,
    ),
    index("source_raw_records_source_idx").on(
      table.sourceSystem,
      table.sourceExternalId,
      table.recordType,
    ),
  ],
);

export type SourceRawRecord = typeof sourceRawRecordsTable.$inferSelect;

// Explicit AlfaCRM group composition. This is separate from a group row because
// membership has its own lifecycle and source endpoint.
export const crmGroupMembershipsTable = pgTable(
  "crm_group_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    groupCrmId: text("group_crm_id").notNull(),
    studentCrmId: text("student_crm_id").notNull(),
    externalMembershipId: text("external_membership_id"),
    status: text("status"),
    enrolledAt: date("enrolled_at"),
    unenrolledAt: date("unenrolled_at"),
    rawRecordId: uuid("raw_record_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaRawRecordsTable.id, { onDelete: "restrict" }),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenBatchId: uuid("last_seen_batch_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaSyncBatchesTable.id, { onDelete: "restrict" }),
    sourceScope: text("source_scope")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance),
    recordState: text("record_state").notNull().default("current"),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    staleReason: text("stale_reason"),
  },
  (table) => [
    unique("crm_group_memberships_business_uniq").on(
      table.branchCrmId,
      table.groupCrmId,
      table.studentCrmId,
    ),
    index("crm_group_memberships_group_idx").on(
      table.branchCrmId,
      table.groupCrmId,
    ),
  ],
);

export type CrmGroupMembership = typeof crmGroupMembershipsTable.$inferSelect;

// AlfaCRM leads are fetched separately from students (`is_study = 0`). They
// must never flow into student profiles or family matching automatically.
export const crmLeadsTable = pgTable(
  "crm_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    crmId: text("crm_id").notNull(),
    fullName: text("full_name"),
    status: text("status"),
    pipelineCrmId: text("pipeline_crm_id"),
    sourceCrmId: text("source_crm_id"),
    createdAtCrm: timestamp("created_at_crm", { withTimezone: true }),
    rawRecordId: uuid("raw_record_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaRawRecordsTable.id, { onDelete: "restrict" }),
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenBatchId: uuid("last_seen_batch_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaSyncBatchesTable.id, { onDelete: "restrict" }),
    sourceScope: text("source_scope")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance),
    recordState: text("record_state").notNull().default("current"),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    staleReason: text("stale_reason"),
  },
  (table) => [
    unique("crm_leads_branch_crm_uniq").on(table.branchCrmId, table.crmId),
    index("crm_leads_status_idx").on(table.branchCrmId, table.status),
  ],
);

export type CrmLead = typeof crmLeadsTable.$inferSelect;

// Customer tariff rows are AlfaCRM subscriptions/entitlements. They are kept
// separate from tariff reference records because balance and validity belong
// to a concrete customer.
export const crmCustomerTariffsTable = pgTable(
  "crm_customer_tariffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    crmId: text("crm_id").notNull(),
    customerCrmId: text("customer_crm_id").notNull(),
    tariffCrmId: text("tariff_crm_id"),
    balance: numeric("balance"),
    status: text("status"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    rawRecordId: uuid("raw_record_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaRawRecordsTable.id, { onDelete: "restrict" }),
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenBatchId: uuid("last_seen_batch_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaSyncBatchesTable.id, { onDelete: "restrict" }),
    sourceScope: text("source_scope")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance),
    recordState: text("record_state").notNull().default("current"),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    staleReason: text("stale_reason"),
  },
  (table) => [
    unique("crm_customer_tariffs_branch_crm_uniq").on(
      table.branchCrmId,
      table.crmId,
    ),
    index("crm_customer_tariffs_customer_idx").on(
      table.branchCrmId,
      table.customerCrmId,
    ),
  ],
);

export type CrmCustomerTariff = typeof crmCustomerTariffsTable.$inferSelect;

// A generic normalized layer for AlfaCRM dictionaries. The raw layer remains
// immutable in alpha_raw_records; this table makes stable ids and labels
// queryable without copying provider-specific schema into application code.
export const crmReferenceRecordsTable = pgTable(
  "crm_reference_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    referenceType: text("reference_type").notNull(),
    crmId: text("crm_id").notNull(),
    name: text("name"),
    status: text("status"),
    parentCrmId: text("parent_crm_id"),
    rawRecordId: uuid("raw_record_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaRawRecordsTable.id, { onDelete: "restrict" }),
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenBatchId: uuid("last_seen_batch_id")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance)
      .references(() => alphaSyncBatchesTable.id, { onDelete: "restrict" }),
    sourceScope: text("source_scope")
      .notNull()
      .$defaultFn(requireExplicitAlfaProvenance),
    recordState: text("record_state").notNull().default("current"),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    staleReason: text("stale_reason"),
  },
  (table) => [
    unique("crm_reference_records_business_uniq").on(
      table.branchCrmId,
      table.referenceType,
      table.crmId,
    ),
    index("crm_reference_records_type_idx").on(
      table.referenceType,
      table.branchCrmId,
    ),
  ],
);

export type CrmReferenceRecord = typeof crmReferenceRecordsTable.$inferSelect;

// AlfaCRM's change log is the discovery source for incremental synchronization.
// Full entity materialization remains a separate, explicit operation.
export const crmChangeLogTable = pgTable(
  "crm_change_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    crmId: text("crm_id").notNull(),
    entityType: text("entity_type"),
    entityCrmId: text("entity_crm_id"),
    userCrmId: text("user_crm_id"),
    event: text("event"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    fieldsOld: jsonb("fields_old"),
    fieldsNew: jsonb("fields_new"),
    fieldsRelated: jsonb("fields_related"),
    rawRecordId: uuid("raw_record_id")
      .notNull()
      .references(() => alphaRawRecordsTable.id, { onDelete: "restrict" }),
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenBatchId: uuid("last_seen_batch_id")
      .notNull()
      .references(() => alphaSyncBatchesTable.id, { onDelete: "restrict" }),
    sourceScope: text("source_scope").notNull(),
  },
  (table) => [
    unique("crm_change_log_branch_crm_uniq").on(table.branchCrmId, table.crmId),
    index("crm_change_log_occurred_idx").on(
      table.branchCrmId,
      table.occurredAt,
    ),
    index("crm_change_log_entity_idx").on(
      table.branchCrmId,
      table.entityType,
      table.entityCrmId,
    ),
  ],
);

export type CrmChangeLog = typeof crmChangeLogTable.$inferSelect;

// AlfaCRM exposes people, not a reliable family object. Shared contact/name
// evidence creates a candidate only; confirmation or rejection is manual.
export const familyMergeCandidatesTable = pgTable(
  "family_merge_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leftStudentCrmId: text("left_student_crm_id").notNull(),
    rightStudentCrmId: text("right_student_crm_id").notNull(),
    branchCrmId: text("branch_crm_id"),
    candidateType: text("candidate_type").notNull(),
    reasonCodes: jsonb("reason_codes").notNull(),
    evidence: jsonb("evidence").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    status: text("status").notNull().default("pending_review"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("family_merge_candidates_pair_uniq").on(
      table.leftStudentCrmId,
      table.rightStudentCrmId,
      table.candidateType,
    ),
    index("family_merge_candidates_status_idx").on(table.status),
  ],
);

export type FamilyMergeCandidate =
  typeof familyMergeCandidatesTable.$inferSelect;

export const employeeExternalIdentitiesTable = pgTable(
  "employee_external_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id"),
    sourceSystem: text("source_system").notNull(),
    externalId: text("external_id").notNull(),
    sourceName: text("source_name"),
    sourceRole: text("source_role"),
    matchStatus: text("match_status").notNull().default("unmatched"),
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 4 }),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("employee_external_identities_source_uniq").on(
      table.sourceSystem,
      table.externalId,
    ),
  ],
);

export type EmployeeExternalIdentity =
  typeof employeeExternalIdentitiesTable.$inferSelect;

export const payrollPeriodsTable = pgTable(
  "payroll_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodMonth: date("period_month").notNull(),
    legalEntityId: uuid("legal_entity_id"),
    sourceImportBatchId: uuid("source_import_batch_id"),
    status: text("status").notNull().default("imported_unverified"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("payroll_periods_source_uniq").on(
      table.periodMonth,
      table.legalEntityId,
      table.sourceImportBatchId,
    ),
  ],
);

export type PayrollPeriod = typeof payrollPeriodsTable.$inferSelect;

export const salaryAccrualsTable = pgTable(
  "salary_accruals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollPeriodId: uuid("payroll_period_id"),
    employeeExternalIdentityId: uuid("employee_external_identity_id"),
    employeeId: uuid("employee_id"),
    sourceRawRecordId: uuid("source_raw_record_id").notNull(),
    componentKey: text("component_key").notNull(),
    accrualType: text("accrual_type").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    status: text("status").notNull().default("imported_unverified"),
    calculationEvidence: jsonb("calculation_evidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("salary_accruals_source_component_uniq").on(
      table.sourceRawRecordId,
      table.componentKey,
    ),
    index("salary_accruals_period_idx").on(table.payrollPeriodId),
  ],
);

export type SalaryAccrual = typeof salaryAccrualsTable.$inferSelect;

export const payrollPaymentsTable = pgTable(
  "payroll_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollPeriodId: uuid("payroll_period_id"),
    employeeExternalIdentityId: uuid("employee_external_identity_id"),
    employeeId: uuid("employee_id"),
    sourceRawRecordId: uuid("source_raw_record_id").notNull(),
    paymentDate: date("payment_date"),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    paymentKind: text("payment_kind"),
    status: text("status").notNull().default("imported_unverified"),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("payroll_payments_source_uniq").on(table.sourceRawRecordId),
    index("payroll_payments_period_idx").on(table.payrollPeriodId),
  ],
);

export type PayrollPayment = typeof payrollPaymentsTable.$inferSelect;
