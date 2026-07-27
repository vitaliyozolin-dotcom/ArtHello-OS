import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const syncStatus = sqliteTable("sync_status", {
  source: text("source").primaryKey(),
  status: text("status").notNull(),
  label: text("label").notNull(),
  dataMode: text("data_mode").notNull(),
  lastSyncedAt: text("last_synced_at"),
  countsJson: text("counts_json").notNull().default("{}"),
  detailsJson: text("details_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

export const employees = sqliteTable(
  "employees",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    primaryRole: text("primary_role"),
    classificationStatus: text("classification_status").notNull(),
    sourceKind: text("source_kind").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("employees_name_idx").on(table.fullName),
    index("employees_status_idx").on(table.classificationStatus),
  ],
);

export const employeePayrollMonthly = sqliteTable(
  "employee_payroll_monthly",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    periodMonth: text("period_month").notNull(),
    accruedAmount: real("accrued_amount").notNull().default(0),
    paidAmount: real("paid_amount").notNull().default(0),
    accruedAmountMinor: integer("accrued_amount_minor"),
    paidAmountMinor: integer("paid_amount_minor"),
    accrualRows: integer("accrual_rows").notNull().default(0),
    paymentRows: integer("payment_rows").notNull().default(0),
    evidenceStatus: text("evidence_status").notNull(),
    legalEntityName: text("legal_entity_name"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("employee_payroll_monthly_employee_period_uniq").on(
      table.employeeId,
      table.periodMonth,
      table.legalEntityName,
    ),
    index("employee_payroll_monthly_period_idx").on(table.periodMonth),
  ],
);

export const employeePayrollComponents = sqliteTable(
  "employee_payroll_components",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    periodMonth: text("period_month").notNull(),
    legalEntityName: text("legal_entity_name"),
    componentKey: text("component_key").notNull(),
    sourceLabel: text("source_label").notNull(),
    amount: real("amount").notNull(),
    amountMinor: integer("amount_minor"),
    quantity: real("quantity"),
    sourceSheet: text("source_sheet"),
    formulaPresent: integer("formula_present").notNull().default(0),
    evidenceStatus: text("evidence_status").notNull(),
    ruleActivated: integer("rule_activated").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("employee_payroll_components_employee_idx").on(table.employeeId),
    index("employee_payroll_components_period_idx").on(table.periodMonth),
  ],
);

export const employeePayrollPayments = sqliteTable(
  "employee_payroll_payments",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    periodMonth: text("period_month"),
    legalEntityName: text("legal_entity_name"),
    paymentDate: text("payment_date"),
    amount: real("amount").notNull(),
    amountMinor: integer("amount_minor"),
    paymentKind: text("payment_kind"),
    evidenceStatus: text("evidence_status").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("employee_payroll_payments_employee_idx").on(table.employeeId),
    index("employee_payroll_payments_period_idx").on(table.periodMonth),
  ],
);

export const payrollUnresolved = sqliteTable(
  "payroll_unresolved",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceRole: text("source_role"),
    periodMonth: text("period_month"),
    amount: real("amount").notNull(),
    amountMinor: integer("amount_minor"),
    reason: text("reason").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("payroll_unresolved_source_idx").on(table.sourceType),
    index("payroll_unresolved_period_idx").on(table.periodMonth),
  ],
);

export const alphaBranches = sqliteTable("alpha_branches", {
  id: text("id").primaryKey(),
  name: text("name"),
  recordState: text("record_state").notNull(),
  legalEntityName: text("legal_entity_name"),
  legalEntityStatus: text("legal_entity_status").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const alphaStudents = sqliteTable(
  "alpha_students",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id"),
    branchName: text("branch_name"),
    fullName: text("full_name"),
    studyStatus: text("study_status"),
    recordState: text("record_state").notNull(),
    groupCount: integer("group_count").notNull().default(0),
    paymentCount: integer("payment_count").notNull().default(0),
    lessonCount: integer("lesson_count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("alpha_students_name_idx").on(table.fullName),
    index("alpha_students_branch_idx").on(table.branchId),
    index("alpha_students_state_idx").on(table.recordState),
  ],
);

export const familyCandidates = sqliteTable(
  "family_candidates",
  {
    id: text("id").primaryKey(),
    leftStudentId: text("left_student_id").notNull(),
    leftStudentName: text("left_student_name"),
    rightStudentId: text("right_student_id").notNull(),
    rightStudentName: text("right_student_name"),
    branchName: text("branch_name"),
    confidence: real("confidence").notNull(),
    status: text("status").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("family_candidates_status_idx").on(table.status)],
);

export const alphaGroups = sqliteTable(
  "alpha_groups",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id"),
    branchName: text("branch_name"),
    name: text("name"),
    lifecycleStatus: text("lifecycle_status"),
    recordState: text("record_state").notNull(),
    studentCount: integer("student_count").notNull().default(0),
    lessonCount: integer("lesson_count").notNull().default(0),
    unitKind: text("unit_kind").notNull().default("group_or_unclassified"),
    classificationStatus: text("classification_status")
      .notNull()
      .default("not_explicit"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("alpha_groups_name_idx").on(table.name),
    index("alpha_groups_branch_idx").on(table.branchId),
  ],
);

export const alphaTeachers = sqliteTable(
  "alpha_teachers",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id"),
    branchName: text("branch_name"),
    fullName: text("full_name"),
    teacherStatus: text("teacher_status"),
    recordState: text("record_state").notNull(),
    lessonCount: integer("lesson_count").notNull().default(0),
    rateRuleCount: integer("rate_rule_count").notNull().default(0),
    workingHourRuleCount: integer("working_hour_rule_count")
      .notNull()
      .default(0),
    payrollEmployeeIdCandidate: text("payroll_employee_id_candidate"),
    payrollMatchStatus: text("payroll_match_status").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("alpha_teachers_name_idx").on(table.fullName),
    index("alpha_teachers_branch_idx").on(table.branchId),
    index("alpha_teachers_match_idx").on(table.payrollMatchStatus),
  ],
);

export const alphaTeacherRates = sqliteTable(
  "alpha_teacher_rates",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id").notNull(),
    branchName: text("branch_name"),
    teacherId: text("teacher_id"),
    teacherName: text("teacher_name"),
    rateAmount: real("rate_amount"),
    rateAmountMinor: integer("rate_amount_minor"),
    rateType: text("rate_type"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    conditionsJson: text("conditions_json").notNull().default("{}"),
    evidenceStatus: text("evidence_status").notNull(),
    recordState: text("record_state").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("alpha_teacher_rates_teacher_idx").on(table.teacherId),
    index("alpha_teacher_rates_branch_idx").on(table.branchId),
  ],
);

export const alphaLessons = sqliteTable(
  "alpha_lessons",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id"),
    branchName: text("branch_name"),
    groupId: text("group_id"),
    groupName: text("group_name"),
    teacherName: text("teacher_name"),
    lessonTypeName: text("lesson_type_name"),
    subjectName: text("subject_name"),
    lessonCategory: text("lesson_category")
      .notNull()
      .default("base_or_unclassified"),
    classificationStatus: text("classification_status")
      .notNull()
      .default("not_explicit"),
    lessonDate: text("lesson_date"),
    title: text("title"),
    recordState: text("record_state").notNull(),
    attendanceCount: integer("attendance_count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("alpha_lessons_date_idx").on(table.lessonDate),
    index("alpha_lessons_branch_idx").on(table.branchId),
  ],
);

export const alphaPayments = sqliteTable(
  "alpha_payments",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id"),
    branchName: text("branch_name"),
    studentId: text("student_id"),
    studentName: text("student_name"),
    amount: real("amount"),
    amountMinor: integer("amount_minor"),
    paymentDate: text("payment_date"),
    paymentType: text("payment_type"),
    recordState: text("record_state").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("alpha_payments_date_idx").on(table.paymentDate),
    index("alpha_payments_branch_idx").on(table.branchId),
  ],
);

export const bankConnectorState = sqliteTable("bank_connector_state", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  consentId: text("consent_id"),
  stateHash: text("state_hash"),
  sealedTokens: text("sealed_tokens"),
  tokenExpiresAt: text("token_expires_at"),
  lastSyncedAt: text("last_synced_at"),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    connectorId: text("connector_id").notNull(),
    displayName: text("display_name"),
    maskedNumber: text("masked_number").notNull(),
    currency: text("currency").notNull(),
    currentBalance: real("current_balance"),
    currentBalanceMinor: integer("current_balance_minor"),
    balanceStatus: text("balance_status").notNull(),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => [index("bank_accounts_connector_idx").on(table.connectorId)],
);

export const sensitiveAccessAudit = sqliteTable(
  "sensitive_access_audit",
  {
    id: text("id").primaryKey(),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    resourceKind: text("resource_kind").notNull(),
    outcome: text("outcome").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    index("sensitive_access_audit_occurred_idx").on(table.occurredAt),
    index("sensitive_access_audit_resource_idx").on(table.resourceKind),
  ],
);

export const readModelPublicationBatches = sqliteTable(
  "read_model_publication_batches",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    expectedCountsJson: text("expected_counts_json").notNull(),
    expectedDigestsJson: text("expected_digests_json").notNull().default("{}"),
    computedDigest: text("computed_digest"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    committedAt: text("committed_at"),
  },
  (table) => [
    index("read_model_publication_status_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const readModelStagingRows = sqliteTable(
  "read_model_staging_rows",
  {
    batchId: text("batch_id").notNull(),
    datasetName: text("dataset_name").notNull(),
    rowKey: text("row_key").notNull(),
    rowJson: text("row_json").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.batchId, table.datasetName, table.rowKey],
    }),
    index("read_model_staging_batch_idx").on(table.batchId, table.datasetName),
  ],
);

/**
 * Sites read-model for the ArtHello Front Office pilot.
 *
 * The canonical application schema lives in lib/db/src/schema/front-office.ts.
 * These SQLite tables mirror the business entities needed by the owner-only
 * Sites surface while real channels are connected. They cannot represent or
 * initiate an outbound message.
 */
export const frontOfficeConnectorState = sqliteTable(
  "front_office_connector_state",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().default("ARTHELLO"),
    status: text("status").notNull().default("not_started"),
    externalAccountId: text("external_account_id"),
    lastEventAt: text("last_event_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("front_office_connector_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

export const frontOfficeInboundEvents = sqliteTable(
  "front_office_inbound_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().default("ARTHELLO"),
    connectorId: text("connector_id").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    processingStatus: text("processing_status").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("front_office_inbound_connector_event_uniq").on(
      table.connectorId,
      table.externalEventId,
    ),
    index("front_office_inbound_received_idx").on(table.receivedAt),
  ],
);

export const frontOfficeConversations = sqliteTable(
  "front_office_conversations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().default("ARTHELLO"),
    externalKey: text("external_key").notNull(),
    kind: text("kind").notNull().default("lead"),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("P3"),
    contactDisplayName: text("contact_display_name").notNull(),
    contactPointMasked: text("contact_point_masked"),
    sealedContact: text("sealed_contact"),
    identityStatus: text("identity_status").notNull().default("not_required"),
    intent: text("intent"),
    service: text("service"),
    branchOrObject: text("branch_or_object"),
    ownerRole: text("owner_role"),
    ownerDisplayName: text("owner_display_name"),
    lastMessageAt: text("last_message_at").notNull(),
    dueAt: text("due_at"),
    nextActionAt: text("next_action_at"),
    isSynthetic: integer("is_synthetic").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("front_office_conversations_project_external_uniq").on(
      table.projectId,
      table.externalKey,
    ),
    index("front_office_conversations_queue_idx").on(
      table.projectId,
      table.status,
      table.priority,
      table.lastMessageAt,
    ),
  ],
);

export const frontOfficeLeads = sqliteTable(
  "front_office_leads",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => frontOfficeConversations.id, {
        onDelete: "restrict",
      }),
    stage: text("stage").notNull().default("NEW"),
    source: text("source"),
    campaign: text("campaign"),
    childAgeBand: text("child_age_band"),
    branchPreference: text("branch_preference"),
    programInterest: text("program_interest"),
    ownerDisplayName: text("owner_display_name"),
    nextAction: text("next_action"),
    nextActionAt: text("next_action_at"),
    trialStatus: text("trial_status").notNull().default("not_requested"),
    isSynthetic: integer("is_synthetic").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("front_office_leads_conversation_uniq").on(
      table.conversationId,
    ),
    index("front_office_leads_stage_idx").on(table.stage, table.nextActionAt),
  ],
);

export const frontOfficeMessages = sqliteTable(
  "front_office_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => frontOfficeConversations.id, {
        onDelete: "restrict",
      }),
    messageType: text("message_type").notNull(),
    direction: text("direction").notNull().default("incoming"),
    body: text("body").notNull(),
    authorRole: text("author_role"),
    authorDisplayName: text("author_display_name"),
    factStatus: text("fact_status").notNull().default("UNVERIFIED"),
    sourceRefsJson: text("source_refs_json").notNull().default("[]"),
    isSynthetic: integer("is_synthetic").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("front_office_messages_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const frontOfficeAuditEvents = sqliteTable(
  "front_office_audit_events",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    actorRole: text("actor_role").notNull(),
    actorDisplayName: text("actor_display_name"),
    afterStateJson: text("after_state_json"),
    requestId: text("request_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("front_office_audit_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);
