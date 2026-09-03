import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const systemRuntimeState = sqliteTable("system_runtime_state", {
  stateKey: text("state_key").primaryKey(),
  stateValue: text("state_value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizationBranches = sqliteTable("organization_branches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("Филиал"),
  status: text("status").notNull().default("Активен"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appUsers = sqliteTable("app_users", {
  id: text("id").primaryKey(),
  contactType: text("contact_type").notNull(),
  contact: text("contact").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  jobTitle: text("job_title").notNull().default(""),
  allowedModules: text("allowed_modules").notNull().default(""),
  favoriteModules: text("favorite_modules").notNull().default(""),
  isAdministrative: integer("is_administrative", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("Приглашён"),
  invitationStatus: text("invitation_status").notNull().default("Ожидает активации"),
  accessVersion: integer("access_version").notNull().default(1),
  invitedBy: text("invited_by").notNull(),
  invitedAt: text("invited_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  activatedAt: text("activated_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("app_users_contact_unique").on(table.contact)]);

export const appSystems = sqliteTable("app_systems", {
  id: text("id").primaryKey(),
  systemKey: text("system_key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("Активна"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("app_systems_key_unique").on(table.systemKey)]);

export const userSystemAccess = sqliteTable("user_system_access", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  systemId: text("system_id").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("Активен"),
  accessVersion: integer("access_version").notNull().default(1),
  lastSyncStatus: text("last_sync_status").notNull().default("Не требуется"),
  lastSyncedAt: text("last_synced_at").notNull().default(""),
  grantedBy: text("granted_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("user_system_access_unique").on(table.userId, table.systemId)]);

export const accessSyncEvents = sqliteTable("access_sync_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  userId: text("user_id").notNull(),
  systemId: text("system_id").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("Ожидает синхронизации"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  result: text("result").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const familySystemAccess = sqliteTable("family_system_access", {
  id: text("id").primaryKey(),
  familyEntityId: text("family_entity_id").notNull(),
  principalEntityId: text("principal_entity_id").notNull(),
  principalType: text("principal_type").notNull(),
  systemId: text("system_id").notNull(),
  role: text("role").notNull(),
  loginType: text("login_type").notNull(),
  login: text("login").notNull(),
  deliveryChannel: text("delivery_channel").notNull(),
  deliveryStatus: text("delivery_status").notNull().default("Ожидает отправки"),
  status: text("status").notNull().default("Активен"),
  accessVersion: integer("access_version").notNull().default(1),
  lastSyncStatus: text("last_sync_status").notNull().default("Ожидает синхронизации"),
  lastSyncedAt: text("last_synced_at").notNull().default(""),
  grantedBy: text("granted_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("family_system_access_principal_unique").on(table.principalEntityId, table.systemId),
  uniqueIndex("family_system_access_login_unique").on(table.login, table.systemId),
]);

export const userBranchAccess = sqliteTable("user_branch_access", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  branchId: text("branch_id").notNull(),
  accessLevel: text("access_level").notNull().default("Работа"),
  grantedBy: text("granted_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("user_branch_access_unique").on(table.userId, table.branchId)]);

export const manualRecords = sqliteTable("manual_records", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull(),
  recordType: text("record_type").notNull(),
  title: text("title").notNull(),
  period: text("period").notNull().default(""),
  amountMinor: integer("amount_minor").notNull().default(0),
  details: text("details").notNull().default("{}"),
  status: text("status").notNull().default("Черновик"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("Активна"),
  sourceSystem: text("source_system").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  dataQuality: text("data_quality").notNull().default("Тестовые данные"),
  scope: text("scope").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("entities_source_unique").on(table.entityType, table.sourceSystem, table.sourceRecordId),
]);

export const entityLinks = sqliteTable("entity_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromEntityId: text("from_entity_id").notNull(),
  toEntityId: text("to_entity_id").notNull(),
  relationType: text("relation_type").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("entity_links_unique").on(table.fromEntityId, table.toEntityId, table.relationType),
]);

export const entityDocuments = sqliteTable("entity_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityId: text("entity_id").notNull(),
  title: text("title").notNull(),
  documentType: text("document_type").notNull(),
  status: text("status").notNull().default("Актуален"),
  validUntil: text("valid_until").notNull().default(""),
  source: text("source").notNull().default("MANUAL"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const entityMerges = sqliteTable("entity_merges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  survivorId: text("survivor_id").notNull(),
  duplicateId: text("duplicate_id").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("entity_merges_duplicate_unique").on(table.duplicateId),
]);

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  owner: text("owner").notNull(),
  dueDate: text("due_date").notNull().default(""),
  priority: text("priority").notNull().default("Средний"),
  status: text("status").notNull().default("Входящие"),
  sourceType: text("source_type").notNull().default("Ручная задача"),
  sourceId: text("source_id").notNull().default("MANUAL"),
  description: text("description").notNull().default(""),
  assigneeEntityId: text("assignee_entity_id").notNull().default(""),
  parentTaskId: integer("parent_task_id"),
  kind: text("kind").notNull().default("Задача"),
  recurrenceRule: text("recurrence_rule").notNull().default(""),
  automationKey: text("automation_key"),
  requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull().default(false),
  result: text("result").notNull().default(""),
  resultEvidence: text("result_evidence").notNull().default(""),
  completedAt: text("completed_at").notNull().default(""),
  createdByUserId: text("created_by_user_id").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("tasks_automation_unique").on(table.automationKey),
]);

export const taskWatchers = sqliteTable("task_watchers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  entityId: text("entity_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("task_watchers_unique").on(table.taskId, table.entityId)]);

export const taskChecklist = sqliteTable("task_checklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  title: text("title").notNull(),
  isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const taskComments = sqliteTable("task_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const taskApprovals = sqliteTable("task_approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  stepName: text("step_name").notNull(),
  status: text("status").notNull().default("Ожидает"),
  decidedBy: text("decided_by").notNull().default(""),
  comment: text("comment").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("task_approvals_unique").on(table.taskId, table.stepName)]);

export const workflowDocuments = sqliteTable("workflow_documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  documentType: text("document_type").notNull(),
  currentVersion: integer("current_version").notNull().default(1),
  status: text("status").notNull().default("Актуален"),
  validUntil: text("valid_until").notNull().default(""),
  ownerEntityId: text("owner_entity_id").notNull().default(""),
  source: text("source").notNull().default("MANUAL"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const documentVersions = sqliteTable("document_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: text("document_id").notNull(),
  version: integer("version").notNull(),
  note: text("note").notNull().default(""),
  reference: text("reference").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("document_versions_unique").on(table.documentId, table.version)]);

export const taskDocuments = sqliteTable("task_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  documentId: text("document_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("task_documents_unique").on(table.taskId, table.documentId)]);

export const obligations = sqliteTable("obligations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: text("document_id").notNull(),
  title: text("title").notNull(),
  dueDate: text("due_date").notNull(),
  ownerEntityId: text("owner_entity_id").notNull(),
  status: text("status").notNull().default("Открыто"),
  warningDays: integer("warning_days").notNull().default(30),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("obligations_unique").on(table.documentId, table.title)]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientEntityId: text("recipient_entity_id").notNull(),
  notificationType: text("notification_type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  status: text("status").notNull().default("Новое"),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  readAt: text("read_at").notNull().default(""),
}, (table) => [uniqueIndex("notifications_dedup_unique").on(table.dedupKey)]);

export const escalations = sqliteTable("escalations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  level: integer("level").notNull().default(1),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("Открыта"),
  recipientEntityId: text("recipient_entity_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("escalations_unique").on(table.taskId, table.level)]);

export const financialOperations = sqliteTable("financial_operations", {
  id: text("id").primaryKey(),
  operationDate: text("operation_date").notNull(),
  period: text("period").notNull(),
  direction: text("direction").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  category: text("category").notNull(),
  reportClass: text("report_class").notNull(),
  counterpartyEntityId: text("counterparty_entity_id").notNull().default(""),
  contractId: text("contract_id").notNull().default(""),
  documentId: text("document_id").notNull().default(""),
  projectEntityId: text("project_entity_id").notNull().default(""),
  legalEntityId: text("legal_entity_id").notNull().default(""),
  objectEntityId: text("object_entity_id").notNull().default(""),
  cfrEntityId: text("cfr_entity_id").notNull().default(""),
  bankOperationRef: text("bank_operation_ref").notNull().default(""),
  operationKind: text("operation_kind").notNull().default("XLSX_AGGREGATE"),
  sourceSystem: text("source_system").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  sourceRef: text("source_ref").notNull(),
  dataQuality: text("data_quality").notNull(),
  status: text("status").notNull().default("Разнесено"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const bankAccounts = sqliteTable("bank_accounts", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  legalEntityId: text("legal_entity_id").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  maskedAccount: text("masked_account").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  balanceMinor: integer("balance_minor"),
  balanceAsOf: text("balance_as_of").notNull().default(""),
  syncedAt: text("synced_at").notNull(),
}, (table) => [
  uniqueIndex("bank_accounts_provider_unique").on(table.connectionId, table.legalEntityId, table.providerAccountId),
]);

export const bankStatementImports = sqliteTable("bank_statement_imports", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  legalEntityId: text("legal_entity_id").notNull(),
  providerStatementId: text("provider_statement_id").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull(),
  startBalanceMinor: integer("start_balance_minor").notNull(),
  endBalanceMinor: integer("end_balance_minor").notNull(),
  currency: text("currency").notNull(),
  transactionCount: integer("transaction_count").notNull(),
  fetchedAt: text("fetched_at").notNull(),
}, (table) => [
  uniqueIndex("bank_statement_provider_unique").on(table.connectionId, table.providerStatementId),
]);

export const bankTransactions = sqliteTable("bank_transactions", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  legalEntityId: text("legal_entity_id").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  providerStatementId: text("provider_statement_id").notNull(),
  providerTransactionId: text("provider_transaction_id").notNull(),
  paymentId: text("payment_id").notNull().default(""),
  operationDate: text("operation_date").notNull(),
  direction: text("direction").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  documentNumber: text("document_number").notNull().default(""),
  transactionType: text("transaction_type").notNull().default(""),
  description: text("description").notNull().default(""),
  counterpartyName: text("counterparty_name").notNull().default(""),
  counterpartyInn: text("counterparty_inn").notNull().default(""),
  counterpartyKpp: text("counterparty_kpp").notNull().default(""),
  sourcePayloadHash: text("source_payload_hash").notNull(),
  financialOperationId: text("financial_operation_id").notNull().default(""),
  importedAt: text("imported_at").notNull(),
}, (table) => [
  uniqueIndex("bank_transactions_provider_unique").on(table.connectionId, table.providerTransactionId),
  index("bank_transactions_date_idx").on(table.operationDate),
]);

export const financeAccruals = sqliteTable("finance_accruals", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  contour: text("contour").notNull(),
  subjectEntityId: text("subject_entity_id").notNull(),
  recordsCount: integer("records_count").notNull(),
  accrualMinor: integer("accrual_minor").notNull(),
  paidMinor: integer("paid_minor").notNull(),
  debtMinor: integer("debt_minor").notNull(),
  debtCases: integer("debt_cases").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  sourceRef: text("source_ref").notNull(),
  dataQuality: text("data_quality").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const financeBudgets = sqliteTable("finance_budgets", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  line: text("line").notNull(),
  planMinor: integer("plan_minor").notNull(),
  scenario: text("scenario").notNull(),
  assumption: text("assumption").notNull(),
  sourceType: text("source_type").notNull(),
  ownerEntityId: text("owner_entity_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const financeForecastItems = sqliteTable("finance_forecast_items", {
  id: text("id").primaryKey(),
  forecastDate: text("forecast_date").notNull(),
  direction: text("direction").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  probability: integer("probability").notNull(),
  category: text("category").notNull(),
  sourceType: text("source_type").notNull(),
  assumption: text("assumption").notNull(),
  linkedEntityId: text("linked_entity_id").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const financePayrollSummary = sqliteTable("finance_payroll_summary", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  scope: text("scope").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  sourceRef: text("source_ref").notNull(),
  dataQuality: text("data_quality").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const financeCorrections = sqliteTable("finance_corrections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operationId: text("operation_id").notNull(),
  fieldName: text("field_name").notNull(),
  beforeValue: text("before_value").notNull(),
  afterValue: text("after_value").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("Предложена"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const financeReconciliationIssues = sqliteTable("finance_reconciliation_issues", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  severity: text("severity").notNull(),
  sourceA: text("source_a").notNull(),
  sourceB: text("source_b").notNull(),
  differenceMinor: integer("difference_minor").notNull(),
  ownerEntityId: text("owner_entity_id").notNull(),
  status: text("status").notNull().default("Открыто"),
  relatedTaskId: integer("related_task_id"),
  resolution: text("resolution").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const salesLeads = sqliteTable("sales_leads", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  firstClickAt: text("first_click_at").notNull(),
  source: text("source").notNull(),
  utmSource: text("utm_source").notNull().default(""),
  utmMedium: text("utm_medium").notNull().default(""),
  utmCampaign: text("utm_campaign").notNull().default(""),
  utmContent: text("utm_content").notNull().default(""),
  campaignId: text("campaign_id").notNull().default(""),
  creativeId: text("creative_id").notNull().default(""),
  offerId: text("offer_id").notNull().default(""),
  formId: text("form_id").notNull().default(""),
  managerEntityId: text("manager_entity_id").notNull().default(""),
  stage: text("stage").notNull().default("Заявка"),
  status: text("status").notNull().default("Активен"),
  familyEntityId: text("family_entity_id").notNull().default(""),
  childEntityId: text("child_entity_id").notNull().default(""),
  contractId: text("contract_id").notNull().default(""),
  serviceEntityId: text("service_entity_id").notNull().default(""),
  rejectionReason: text("rejection_reason").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  dataQuality: text("data_quality").notNull().default("Синтетические тестовые данные"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const salesTouchpoints = sqliteTable("sales_touchpoints", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  touchpointType: text("touchpoint_type").notNull(),
  occurredAt: text("occurred_at").notNull(),
  channel: text("channel").notNull(),
  direction: text("direction").notNull().default("Входящий"),
  summary: text("summary").notNull(),
  outcome: text("outcome").notNull(),
  sourceRef: text("source_ref").notNull().default("SYNTHETIC"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const salesStageEvents = sqliteTable("sales_stage_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: text("lead_id").notNull(),
  fromStage: text("from_stage").notNull(),
  toStage: text("to_stage").notNull(),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull().default(""),
  actor: text("actor").notNull(),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const clientLifecycles = sqliteTable("client_lifecycles", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  familyEntityId: text("family_entity_id").notNull(),
  childEntityId: text("child_entity_id").notNull(),
  contractId: text("contract_id").notNull(),
  serviceEntityId: text("service_entity_id").notNull(),
  accrualId: text("accrual_id").notNull(),
  paymentOperationId: text("payment_operation_id").notNull().default(""),
  serviceStartDate: text("service_start_date").notNull(),
  monthlyValueMinor: integer("monthly_value_minor").notNull(),
  ltvMinor: integer("ltv_minor").notNull(),
  lifetimeMonths: integer("lifetime_months").notNull(),
  nextPaymentDate: text("next_payment_date").notNull(),
  nextPaymentMinor: integer("next_payment_minor").notNull(),
  churnRiskScore: integer("churn_risk_score").notNull(),
  churnRiskBand: text("churn_risk_band").notNull(),
  churnRiskFactors: text("churn_risk_factors").notNull().default("[]"),
  loyaltyTier: text("loyalty_tier").notNull(),
  repeatOffer: text("repeat_offer").notNull().default(""),
  status: text("status").notNull().default("Активен"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("client_lifecycles_lead_unique").on(table.leadId)]);

export const clientAccruals = sqliteTable("client_accruals", {
  id: text("id").primaryKey(),
  familyEntityId: text("family_entity_id").notNull(),
  childEntityId: text("child_entity_id").notNull(),
  contractId: text("contract_id").notNull(),
  serviceEntityId: text("service_entity_id").notNull(),
  period: text("period").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull(),
  paymentOperationId: text("payment_operation_id").notNull().default(""),
  sourceType: text("source_type").notNull().default("SYNTHETIC_TEST"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const clientBonuses = sqliteTable("client_bonuses", {
  id: text("id").primaryKey(),
  familyEntityId: text("family_entity_id").notNull(),
  eventType: text("event_type").notNull(),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  relatedContractId: text("related_contract_id").notNull().default(""),
  occurredAt: text("occurred_at").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const marketingAccounts = sqliteTable("marketing_accounts", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull(),
  audienceCount: integer("audience_count").notNull(),
  sourceType: text("source_type").notNull().default("SYNTHETIC_TEST"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contentPlanItems = sqliteTable("content_plan_items", {
  id: text("id").primaryKey(),
  scheduledAt: text("scheduled_at").notNull(),
  accountId: text("account_id").notNull(),
  authorEntityId: text("author_entity_id").notNull(),
  format: text("format").notNull(),
  topic: text("topic").notNull(),
  offerId: text("offer_id").notNull().default(""),
  campaignId: text("campaign_id").notNull().default(""),
  status: text("status").notNull().default("Запланировано"),
  brief: text("brief").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contentPublications = sqliteTable("content_publications", {
  id: text("id").primaryKey(),
  planItemId: text("plan_item_id").notNull(),
  publishedAt: text("published_at").notNull(),
  publicationRef: text("publication_ref").notNull(),
  reach: integer("reach").notNull(),
  views: integer("views").notNull(),
  reactions: integer("reactions").notNull(),
  clicks: integer("clicks").notNull(),
  leads: integer("leads").notNull(),
  contracts: integer("contracts").notNull(),
  revenueMinor: integer("revenue_minor").notNull(),
  sourceType: text("source_type").notNull().default("SYNTHETIC_TEST"),
  dataQuality: text("data_quality").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("content_publications_plan_unique").on(table.planItemId)]);

export const contentAttributions = sqliteTable("content_attributions", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull(),
  clickId: text("click_id").notNull(),
  leadId: text("lead_id").notNull(),
  contractId: text("contract_id").notNull(),
  paymentOperationId: text("payment_operation_id").notNull(),
  revenueMinor: integer("revenue_minor").notNull(),
  attributionModel: text("attribution_model").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contentRecommendations = sqliteTable("content_recommendations", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull().default(""),
  signalType: text("signal_type").notNull(),
  evidence: text("evidence").notNull(),
  recommendation: text("recommendation").notNull(),
  status: text("status").notNull().default("Новая"),
  relatedTaskId: integer("related_task_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const educationPrograms = sqliteTable("education_programs", {
  id: text("id").primaryKey(), title: text("title").notNull(), version: integer("version").notNull(), status: text("status").notNull(),
  authorEntityId: text("author_entity_id").notNull(), methodistEntityId: text("methodist_entity_id").notNull(), scope: text("scope").notNull(),
  materialRef: text("material_ref").notNull(), expectedResult: text("expected_result").notNull(), sourceType: text("source_type").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const educationGroups = sqliteTable("education_groups", {
  id: text("id").primaryKey(), name: text("name").notNull(), unitEntityId: text("unit_entity_id").notNull(), programId: text("program_id").notNull(),
  teacherEntityId: text("teacher_entity_id").notNull(), room: text("room").notNull(), status: text("status").notNull(),
});
export const educationStudents = sqliteTable("education_students", {
  id: text("id").primaryKey(), childEntityId: text("child_entity_id").notNull(), familyEntityId: text("family_entity_id").notNull(), groupId: text("group_id").notNull(),
  cabinetStatus: text("cabinet_status").notNull(), status: text("status").notNull(),
});
export const educationLessons = sqliteTable("education_lessons", {
  id: text("id").primaryKey(), groupId: text("group_id").notNull(), programId: text("program_id").notNull(), scheduledAt: text("scheduled_at").notNull(),
  topic: text("topic").notNull(), teacherEntityId: text("teacher_entity_id").notNull(), substituteEntityId: text("substitute_entity_id").notNull().default(""),
  room: text("room").notNull(), status: text("status").notNull(), homework: text("homework").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const educationAttendance = sqliteTable("education_attendance", {
  id: text("id").primaryKey(), lessonId: text("lesson_id").notNull(), studentId: text("student_id").notNull(), attendanceStatus: text("attendance_status").notNull(),
  grade: text("grade").notNull().default(""), result: text("result").notNull().default(""), recordedBy: text("recorded_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("education_attendance_lesson_student_unique").on(table.lessonId, table.studentId)]);
export const educationProgress = sqliteTable("education_progress", {
  id: text("id").primaryKey(), studentId: text("student_id").notNull(), programId: text("program_id").notNull(), period: text("period").notNull(),
  metric: text("metric").notNull(), score: integer("score").notNull(), trend: text("trend").notNull(), evidence: text("evidence").notNull(),
});
export const educationFeedback = sqliteTable("education_feedback", {
  id: text("id").primaryKey(), studentId: text("student_id").notNull(), familyEntityId: text("family_entity_id").notNull(), programId: text("program_id").notNull(),
  rating: integer("rating").notNull(), comment: text("comment").notNull(), recommendation: text("recommendation").notNull(), status: text("status").notNull(),
  relatedTaskId: integer("related_task_id"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const educationCommunications = sqliteTable("education_communications", {
  id: text("id").primaryKey(), communicationType: text("communication_type").notNull(), audienceType: text("audience_type").notNull(), audienceId: text("audience_id").notNull(),
  title: text("title").notNull(), body: text("body").notNull(), eventAt: text("event_at").notNull().default(""), createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const hrVacancies = sqliteTable("hr_vacancies", {
  id: text("id").primaryKey(), title: text("title").notNull(), unit: text("unit").notNull(), positionId: text("position_id").notNull(),
  headcount: integer("headcount").notNull(), status: text("status").notNull(), sourceType: text("source_type").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const hrCandidates = sqliteTable("hr_candidates", {
  id: text("id").primaryKey(), entityId: text("entity_id").notNull(), vacancyId: text("vacancy_id").notNull(), source: text("source").notNull(),
  stage: text("stage").notNull(), score: integer("score").notNull(), decision: text("decision").notNull().default(""), rejectionReason: text("rejection_reason").notNull().default(""),
  offerStatus: text("offer_status").notNull().default(""), evidence: text("evidence").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const hrInterviews = sqliteTable("hr_interviews", {
  id: text("id").primaryKey(), candidateId: text("candidate_id").notNull(), scheduledAt: text("scheduled_at").notNull(), interviewerEntityId: text("interviewer_entity_id").notNull(),
  score: integer("score").notNull(), summary: text("summary").notNull(), decision: text("decision").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const hrEmployees = sqliteTable("hr_employees", {
  id: text("id").primaryKey(), candidateId: text("candidate_id").notNull(), contractId: text("contract_id").notNull(), positionId: text("position_id").notNull(),
  unit: text("unit").notNull(), rateMinor: integer("rate_minor").notNull(), hireDate: text("hire_date").notNull(), status: text("status").notNull(),
  terminationDate: text("termination_date").notNull().default(""), terminationReason: text("termination_reason").notNull().default(""), accessStatus: text("access_status").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const hrOnboarding = sqliteTable("hr_onboarding", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull(), step: text("step").notNull(), status: text("status").notNull(), dueDate: text("due_date").notNull(),
  evidence: text("evidence").notNull().default(""), relatedTaskId: integer("related_task_id"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const hrDevelopment = sqliteTable("hr_development", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull(), eventType: text("event_type").notNull(), title: text("title").notNull(),
  eventDate: text("event_date").notNull(), score: integer("score").notNull(), status: text("status").notNull(), evidence: text("evidence").notNull(),
});
export const hrRewards = sqliteTable("hr_rewards", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull(), eventType: text("event_type").notNull(), amountMinor: integer("amount_minor").notNull(),
  reason: text("reason").notNull(), period: text("period").notNull(), status: text("status").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const hrAccesses = sqliteTable("hr_accesses", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull(), system: text("system").notNull(), role: text("role").notNull(), status: text("status").notNull(),
  grantedAt: text("granted_at").notNull(), revokedAt: text("revoked_at").notNull().default(""), revocationReason: text("revocation_reason").notNull().default(""),
}, (table) => [uniqueIndex("hr_access_employee_system_unique").on(table.employeeId, table.system)]);

export const legalContracts = sqliteTable("legal_contracts", {
  id: text("id").primaryKey(), referenceDocumentId: text("reference_document_id").notNull(), contractType: text("contract_type").notNull(),
  partyType: text("party_type").notNull(), partyEntityId: text("party_entity_id").notNull(), number: text("number").notNull(), signedStatus: text("signed_status").notNull(),
  validFrom: text("valid_from").notNull(), validUntil: text("valid_until").notNull(), limitMinor: integer("limit_minor").notNull(), spentMinor: integer("spent_minor").notNull(),
  status: text("status").notNull(), electronicSignatureStatus: text("electronic_signature_status").notNull(), requisiteStatus: text("requisite_status").notNull(),
  ownerEntityId: text("owner_entity_id").notNull(), closingRequired: integer("closing_required",{mode:"boolean"}).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const legalDocumentItems = sqliteTable("legal_document_items", {
  id: text("id").primaryKey(), stableId: text("stable_id").notNull(), contractId: text("contract_id").notNull(), itemType: text("item_type").notNull(), title: text("title").notNull(),
  version: integer("version").notNull(), required: integer("required",{mode:"boolean"}).notNull().default(false), signedStatus: text("signed_status").notNull(),
  status: text("status").notNull(), dueDate: text("due_date").notNull().default(""), reference: text("reference").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
},(table)=>[uniqueIndex("legal_document_stable_version_unique").on(table.stableId,table.version)]);
export const legalContractTextVersions = sqliteTable("legal_contract_text_versions", {
  id: text("id").primaryKey(), stableId: text("stable_id").notNull(), contractId: text("contract_id").notNull(), documentItemId: text("document_item_id").notNull(),
  version: integer("version").notNull(), bodyText: text("body_text").notNull(), sourceMode: text("source_mode").notNull(), modelVersion: text("model_version").notNull(),
  policyVersion: text("policy_version").notNull(), protectionClass: text("protection_class").notNull(), confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: text("confirmed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
},(table)=>[uniqueIndex("legal_contract_text_stable_version_unique").on(table.stableId,table.version)]);
export const legalResponsibilityZones = sqliteTable("legal_responsibility_zones", {
  id: text("id").primaryKey(), contractId: text("contract_id").notNull(), zone: text("zone").notNull(), responsibleEntityId: text("responsible_entity_id").notNull(),
  scope: text("scope").notNull(), status: text("status").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const legalChecks = sqliteTable("legal_checks", {
  id: text("id").primaryKey(), contractId: text("contract_id").notNull(), signalType: text("signal_type").notNull(), severity: text("severity").notNull(),
  evidence: text("evidence").notNull(), recommendation: text("recommendation").notNull(), status: text("status").notNull(), relatedTaskId: integer("related_task_id"),
  detectedAt: text("detected_at").notNull(), resolvedAt: text("resolved_at").notNull().default(""), resolution: text("resolution").notNull().default(""),
});

export const procurementSuppliers = sqliteTable("procurement_suppliers", {
  id:text("id").primaryKey(),entityId:text("entity_id").notNull(),specialization:text("specialization").notNull(),contractId:text("contract_id").notNull(),
  basePriceMinor:integer("base_price_minor").notNull(),qualityScore:integer("quality_score").notNull(),rating:integer("rating").notNull(),marketIndex:integer("market_index").notNull(),
  status:text("status").notNull(),dataQuality:text("data_quality").notNull(),updatedAt:text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const purchaseRequests = sqliteTable("purchase_requests", {
  id:text("id").primaryKey(),requesterEntityId:text("requester_entity_id").notNull(),unit:text("unit").notNull(),itemName:text("item_name").notNull(),quantity:integer("quantity").notNull(),
  budgetMinor:integer("budget_minor").notNull(),needBy:text("need_by").notNull(),status:text("status").notNull(),justification:text("justification").notNull(),
  approverEntityId:text("approver_entity_id").notNull().default(""),approvedAt:text("approved_at").notNull().default(""),createdAt:text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),updatedAt:text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const supplierOffers = sqliteTable("supplier_offers", {
  id:text("id").primaryKey(),requestId:text("request_id").notNull(),supplierId:text("supplier_id").notNull(),priceMinor:integer("price_minor").notNull(),
  deliveryDays:integer("delivery_days").notNull(),warrantyMonths:integer("warranty_months").notNull(),qualityScore:integer("quality_score").notNull(),status:text("status").notNull(),comparisonNote:text("comparison_note").notNull(),
});
export const purchaseOrders = sqliteTable("purchase_orders", {
  id:text("id").primaryKey(),requestId:text("request_id").notNull(),offerId:text("offer_id").notNull(),supplierId:text("supplier_id").notNull(),orderNumber:text("order_number").notNull(),
  amountMinor:integer("amount_minor").notNull(),status:text("status").notNull(),orderedAt:text("ordered_at").notNull(),expectedAt:text("expected_at").notNull(),contractId:text("contract_id").notNull(),
});
export const procurementDeliveries = sqliteTable("procurement_deliveries", {
  id:text("id").primaryKey(),orderId:text("order_id").notNull(),deliveredAt:text("delivered_at").notNull(),documentId:text("document_id").notNull(),status:text("status").notNull(),
  quantity:integer("quantity").notNull(),acceptedQuantity:integer("accepted_quantity").notNull(),acceptedBy:text("accepted_by").notNull(),qualityNote:text("quality_note").notNull(),
});
export const inventoryItems = sqliteTable("inventory_items", {
  id:text("id").primaryKey(),sku:text("sku").notNull(),name:text("name").notNull(),category:text("category").notNull(),warehouse:text("warehouse").notNull(),
  quantity:integer("quantity").notNull(),unitCostMinor:integer("unit_cost_minor").notNull(),assetId:text("asset_id").notNull().default(""),status:text("status").notNull(),updatedAt:text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const inventoryEvents = sqliteTable("inventory_events", {
  id:text("id").primaryKey(),itemId:text("item_id").notNull(),eventType:text("event_type").notNull(),quantity:integer("quantity").notNull(),fromLocation:text("from_location").notNull().default(""),
  toLocation:text("to_location").notNull().default(""),documentId:text("document_id").notNull().default(""),occurredAt:text("occurred_at").notNull(),actor:text("actor").notNull(),
});
export const assets = sqliteTable("assets", {
  id:text("id").primaryKey(),itemId:text("item_id").notNull(),serialNumber:text("serial_number").notNull(),objectEntityId:text("object_entity_id").notNull(),assignedToEntityId:text("assigned_to_entity_id").notNull().default(""),
  warrantyUntil:text("warranty_until").notNull(),serviceDue:text("service_due").notNull(),status:text("status").notNull(),acquisitionDate:text("acquisition_date").notNull(),costMinor:integer("cost_minor").notNull(),monthlyDepreciationMinor:integer("monthly_depreciation_minor").notNull(),
});
export const assetMaintenance = sqliteTable("asset_maintenance", {
  id:text("id").primaryKey(),assetId:text("asset_id").notNull(),maintenanceType:text("maintenance_type").notNull(),scheduledAt:text("scheduled_at").notNull(),completedAt:text("completed_at").notNull().default(""),
  contractorId:text("contractor_id").notNull(),status:text("status").notNull(),costMinor:integer("cost_minor").notNull(),documentId:text("document_id").notNull().default(""),relatedTaskId:integer("related_task_id"),
});

export const foodProducts=sqliteTable("food_products",{id:text("id").primaryKey(),name:text("name").notNull(),supplierId:text("supplier_id").notNull(),unit:text("unit").notNull(),purchaseCostMinor:integer("purchase_cost_minor").notNull(),storageNorm:text("storage_norm").notNull(),status:text("status").notNull(),projectEntityId:text("project_entity_id").notNull(),cfrEntityId:text("cfr_entity_id").notNull()});
export const foodBatches=sqliteTable("food_batches",{id:text("id").primaryKey(),productId:text("product_id").notNull(),purchaseRequestId:text("purchase_request_id").notNull(),receivedAt:text("received_at").notNull(),expiresAt:text("expires_at").notNull(),quantity:integer("quantity").notNull(),remainingQuantity:integer("remaining_quantity").notNull(),unit:text("unit").notNull(),warehouse:text("warehouse").notNull(),status:text("status").notNull(),qualityNote:text("quality_note").notNull()});
export const foodRecipes=sqliteTable("food_recipes",{id:text("id").primaryKey(),dishName:text("dish_name").notNull(),version:integer("version").notNull(),yieldPortions:integer("yield_portions").notNull(),standardCostMinor:integer("standard_cost_minor").notNull(),normDescription:text("norm_description").notNull(),menuDate:text("menu_date").notNull(),status:text("status").notNull(),createdAt:text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)});
export const foodRecipeIngredients=sqliteTable("food_recipe_ingredients",{id:text("id").primaryKey(),recipeId:text("recipe_id").notNull(),productId:text("product_id").notNull(),quantityPerBatch:integer("quantity_per_batch").notNull(),unit:text("unit").notNull(),costMinor:integer("cost_minor").notNull()});
export const foodProduction=sqliteTable("food_production",{id:text("id").primaryKey(),productionDate:text("production_date").notNull(),recipeId:text("recipe_id").notNull(),shiftId:text("shift_id").notNull(),plannedPortions:integer("planned_portions").notNull(),actualPortions:integer("actual_portions").notNull(),materialCostMinor:integer("material_cost_minor").notNull(),status:text("status").notNull(),evidence:text("evidence").notNull()});
export const foodShipments=sqliteTable("food_shipments",{id:text("id").primaryKey(),productionId:text("production_id").notNull(),destinationObjectId:text("destination_object_id").notNull(),shippedPortions:integer("shipped_portions").notNull(),consumedPortions:integer("consumed_portions").notNull(),returnedPortions:integer("returned_portions").notNull(),writtenOffPortions:integer("written_off_portions").notNull(),revenueMinor:integer("revenue_minor").notNull(),status:text("status").notNull(),documentId:text("document_id").notNull(),shippedAt:text("shipped_at").notNull()});
export const foodShifts=sqliteTable("food_shifts",{id:text("id").primaryKey(),employeeEntityId:text("employee_entity_id").notNull(),startedAt:text("started_at").notNull(),endedAt:text("ended_at").notNull(),rateMinor:integer("rate_minor").notNull(),status:text("status").notNull(),role:text("role").notNull()});
export const foodChecks=sqliteTable("food_checks",{id:text("id").primaryKey(),checkType:text("check_type").notNull(),objectEntityId:text("object_entity_id").notNull(),checkedAt:text("checked_at").notNull(),result:text("result").notNull(),violation:text("violation").notNull().default(""),evidence:text("evidence").notNull(),status:text("status").notNull(),relatedTaskId:integer("related_task_id")});

export const safetySystems=sqliteTable("safety_systems",{id:text("id").primaryKey(),systemType:text("system_type").notNull(),name:text("name").notNull(),objectEntityId:text("object_entity_id").notNull(),schemeRef:text("scheme_ref").notNull(),journalRef:text("journal_ref").notNull(),responsibleEntityId:text("responsible_entity_id").notNull(),status:text("status").notNull(),sourceType:text("source_type").notNull()});
export const safetyEquipment=sqliteTable("safety_equipment",{id:text("id").primaryKey(),systemId:text("system_id").notNull(),name:text("name").notNull(),inventoryNumber:text("inventory_number").notNull(),location:text("location").notNull(),contractorId:text("contractor_id").notNull(),criticality:text("criticality").notNull(),nextCheckAt:text("next_check_at").notNull(),status:text("status").notNull()});
export const safetyChecks=sqliteTable("safety_checks",{id:text("id").primaryKey(),equipmentId:text("equipment_id").notNull(),objectEntityId:text("object_entity_id").notNull(),checkType:text("check_type").notNull(),scheduledAt:text("scheduled_at").notNull(),checkedAt:text("checked_at").notNull().default(""),result:text("result").notNull(),evidence:text("evidence").notNull(),responsibleEntityId:text("responsible_entity_id").notNull(),status:text("status").notNull()});
export const safetyFaults=sqliteTable("safety_faults",{id:text("id").primaryKey(),checkId:text("check_id").notNull(),equipmentId:text("equipment_id").notNull(),severity:text("severity").notNull(),description:text("description").notNull(),detectedAt:text("detected_at").notNull(),status:text("status").notNull(),relatedTaskId:integer("related_task_id")});
export const safetyIncidents=sqliteTable("safety_incidents",{id:text("id").primaryKey(),objectEntityId:text("object_entity_id").notNull(),systemId:text("system_id").notNull(),happenedAt:text("happened_at").notNull(),category:text("category").notNull(),severity:text("severity").notNull(),description:text("description").notNull(),response:text("response").notNull(),status:text("status").notNull()});
export const safetyRepairs=sqliteTable("safety_repairs",{id:text("id").primaryKey(),faultId:text("fault_id").notNull(),contractorId:text("contractor_id").notNull(),actionType:text("action_type").notNull(),startedAt:text("started_at").notNull(),completedAt:text("completed_at").notNull().default(""),result:text("result").notNull(),actDocumentId:text("act_document_id").notNull().default(""),costMinor:integer("cost_minor").notNull(),paymentOperationId:text("payment_operation_id").notNull().default(""),status:text("status").notNull()});
export const safetyNextChecks=sqliteTable("safety_next_checks",{id:text("id").primaryKey(),equipmentId:text("equipment_id").notNull(),sourceRepairId:text("source_repair_id").notNull(),scheduledAt:text("scheduled_at").notNull(),checkType:text("check_type").notNull(),responsibleEntityId:text("responsible_entity_id").notNull(),status:text("status").notNull()});
export const safetyGuardShifts=sqliteTable("safety_guard_shifts",{id:text("id").primaryKey(),objectEntityId:text("object_entity_id").notNull(),employeeEntityId:text("employee_entity_id").notNull(),post:text("post").notNull(),startedAt:text("started_at").notNull(),endedAt:text("ended_at").notNull(),journalRef:text("journal_ref").notNull(),status:text("status").notNull()});

export const medicalAccessGrants=sqliteTable("medical_access_grants",{id:text("id").primaryKey(),principalType:text("principal_type").notNull(),principalRef:text("principal_ref").notNull(),scope:text("scope").notNull(),grantedBy:text("granted_by").notNull(),validUntil:text("valid_until").notNull(),status:text("status").notNull()});
export const medicalDocuments=sqliteTable("medical_documents",{id:text("id").primaryKey(),subjectEntityId:text("subject_entity_id").notNull(),subjectType:text("subject_type").notNull(),documentType:text("document_type").notNull(),documentRef:text("document_ref").notNull(),validFrom:text("valid_from").notNull(),validUntil:text("valid_until").notNull(),status:text("status").notNull(),storageClass:text("storage_class").notNull(),minimumSummary:text("minimum_summary").notNull(),confirmedAt:text("confirmed_at").notNull().default("")});
export const medicalRestrictions=sqliteTable("medical_restrictions",{id:text("id").primaryKey(),subjectEntityId:text("subject_entity_id").notNull(),recordId:text("record_id").notNull(),category:text("category").notNull(),limitation:text("limitation").notNull(),validUntil:text("valid_until").notNull(),actionScope:text("action_scope").notNull(),status:text("status").notNull()});
export const medicalCases=sqliteTable("medical_cases",{id:text("id").primaryKey(),subjectEntityId:text("subject_entity_id").notNull(),caseType:text("case_type").notNull(),openedAt:text("opened_at").notNull(),severity:text("severity").notNull(),minimumSummary:text("minimum_summary").notNull(),responsibleEntityId:text("responsible_entity_id").notNull(),dueAt:text("due_at").notNull(),status:text("status").notNull(),closedAt:text("closed_at").notNull().default(""),confirmationRef:text("confirmation_ref").notNull().default("")});
export const medicalIncidents=sqliteTable("medical_incidents",{id:text("id").primaryKey(),caseId:text("case_id").notNull(),happenedAt:text("happened_at").notNull(),incidentType:text("incident_type").notNull(),minimumFacts:text("minimum_facts").notNull(),responseRequired:text("response_required").notNull(),status:text("status").notNull()});
export const medicalActions=sqliteTable("medical_actions",{id:text("id").primaryKey(),caseId:text("case_id").notNull(),incidentId:text("incident_id").notNull().default(""),actionType:text("action_type").notNull(),responsibleEntityId:text("responsible_entity_id").notNull(),dueAt:text("due_at").notNull(),completedAt:text("completed_at").notNull().default(""),result:text("result").notNull().default(""),confirmationRef:text("confirmation_ref").notNull().default(""),status:text("status").notNull()});

export const accountingDocuments=sqliteTable("accounting_documents",{id:text("id").primaryKey(),documentType:text("document_type").notNull(),number:text("number").notNull(),documentDate:text("document_date").notNull(),counterpartyEntityId:text("counterparty_entity_id").notNull(),contractId:text("contract_id").notNull().default(""),amountMinor:integer("amount_minor").notNull(),vatMinor:integer("vat_minor").notNull(),paymentOperationId:text("payment_operation_id").notNull().default(""),fileRef:text("file_ref").notNull().default(""),signatureStatus:text("signature_status").notNull(),edoStatus:text("edo_status").notNull(),sourceType:text("source_type").notNull(),status:text("status").notNull(),createdAt:text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)});
export const accountingDocumentLinks=sqliteTable("accounting_document_links",{id:text("id").primaryKey(),fromDocumentId:text("from_document_id").notNull(),toDocumentId:text("to_document_id").notNull(),relationType:text("relation_type").notNull(),evidence:text("evidence").notNull()});
export const accountingCompletenessChecks=sqliteTable("accounting_completeness_checks",{id:text("id").primaryKey(),operationId:text("operation_id").notNull(),contractId:text("contract_id").notNull(),requiredTypes:text("required_types").notNull(),missingTypes:text("missing_types").notNull(),ownerEntityId:text("owner_entity_id").notNull(),status:text("status").notNull(),relatedTaskId:integer("related_task_id"),checkedAt:text("checked_at").notNull()});
export const accountingExports=sqliteTable("accounting_exports",{id:text("id").primaryKey(),exportType:text("export_type").notNull(),period:text("period").notNull(),documentCount:integer("document_count").notNull(),amountMinor:integer("amount_minor").notNull(),status:text("status").notNull(),fileRef:text("file_ref").notNull(),createdBy:text("created_by").notNull(),createdAt:text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)});
export const accountingIntegrations=sqliteTable("accounting_integrations",{id:text("id").primaryKey(),system:text("system").notNull(),mode:text("mode").notNull(),status:text("status").notNull(),truth:text("truth").notNull(),lastSuccessAt:text("last_success_at").notNull().default(""),nextAttemptAt:text("next_attempt_at").notNull().default(""),recordCount:integer("record_count").notNull(),error:text("error").notNull().default("")});

export const strategyGoals=sqliteTable("strategy_goals",{id:text("id").primaryKey(),level:text("level").notNull(),unitEntityId:text("unit_entity_id").notNull().default(""),title:text("title").notNull(),period:text("period").notNull(),ownerEntityId:text("owner_entity_id").notNull(),status:text("status").notNull(),successDefinition:text("success_definition").notNull()});
export const strategyKpis=sqliteTable("strategy_kpis",{id:text("id").primaryKey(),goalId:text("goal_id").notNull(),name:text("name").notNull(),unit:text("unit").notNull(),targetValue:integer("target_value").notNull(),actualValue:integer("actual_value").notNull(),forecastValue:integer("forecast_value").notNull(),varianceValue:integer("variance_value").notNull(),status:text("status").notNull(),sourceRef:text("source_ref").notNull(),updatedAt:text("updated_at").notNull()});
export const strategyInitiatives=sqliteTable("strategy_initiatives",{id:text("id").primaryKey(),goalId:text("goal_id").notNull(),kpiId:text("kpi_id").notNull(),title:text("title").notNull(),hypothesis:text("hypothesis").notNull(),ownerEntityId:text("owner_entity_id").notNull(),plannedStart:text("planned_start").notNull(),plannedEnd:text("planned_end").notNull(),status:text("status").notNull()});
export const strategyProjects=sqliteTable("strategy_projects",{id:text("id").primaryKey(),initiativeId:text("initiative_id").notNull(),goalId:text("goal_id").notNull(),title:text("title").notNull(),ownerEntityId:text("owner_entity_id").notNull(),budgetId:text("budget_id").notNull(),budgetPlanMinor:integer("budget_plan_minor").notNull(),budgetActualMinor:integer("budget_actual_minor").notNull(),startedAt:text("started_at").notNull(),dueAt:text("due_at").notNull(),status:text("status").notNull(),outcome:text("outcome").notNull().default("")});
export const businessEvents=sqliteTable("business_events",{id:text("id").primaryKey(),projectId:text("project_id").notNull(),title:text("title").notNull(),eventAt:text("event_at").notNull(),location:text("location").notNull(),responsibleEntityId:text("responsible_entity_id").notNull(),budgetMinor:integer("budget_minor").notNull(),actualMinor:integer("actual_minor").notNull(),status:text("status").notNull(),result:text("result").notNull().default(""),feedbackScore:integer("feedback_score").notNull().default(0)});
export const eventParticipants=sqliteTable("event_participants",{id:text("id").primaryKey(),eventId:text("event_id").notNull(),participantEntityId:text("participant_entity_id").notNull(),participantRole:text("participant_role").notNull(),attendanceStatus:text("attendance_status").notNull(),feedback:text("feedback").notNull().default("")});
export const strategyResults=sqliteTable("strategy_results",{id:text("id").primaryKey(),projectId:text("project_id").notNull(),eventId:text("event_id").notNull().default(""),resultType:text("result_type").notNull(),metricName:text("metric_name").notNull(),metricValue:integer("metric_value").notNull(),unit:text("unit").notNull(),evidence:text("evidence").notNull(),recordedAt:text("recorded_at").notNull()});
export const strategyDeviations=sqliteTable("strategy_deviations",{id:text("id").primaryKey(),kpiId:text("kpi_id").notNull(),projectId:text("project_id").notNull(),deviationType:text("deviation_type").notNull(),varianceValue:integer("variance_value").notNull(),explanation:text("explanation").notNull(),decision:text("decision").notNull(),status:text("status").notNull(),relatedTaskId:integer("related_task_id"),detectedAt:text("detected_at").notNull()});

export const integrationConnections=sqliteTable("integration_connections",{id:text("id").primaryKey(),system:text("system").notNull(),category:text("category").notNull(),targetModule:text("target_module").notNull(),ownerEntityId:text("owner_entity_id").notNull(),sourceOfTruth:text("source_of_truth").notNull(),mode:text("mode").notNull(),status:text("status").notNull(),authStatus:text("auth_status").notNull(),credentialExpiresAt:text("credential_expires_at").notNull().default(""),lastSuccessAt:text("last_success_at").notNull().default(""),nextSyncAt:text("next_sync_at").notNull().default(""),receivedCount:integer("received_count").notNull().default(0),acceptedCount:integer("accepted_count").notNull().default(0),rejectedCount:integer("rejected_count").notNull().default(0),errorCount:integer("error_count").notNull().default(0),conflictCount:integer("conflict_count").notNull().default(0),impact:text("impact").notNull(),adapterVersion:text("adapter_version").notNull(),verifiedTransfer:integer("verified_transfer",{mode:"boolean"}).notNull().default(false),isEnabled:integer("is_enabled",{mode:"boolean"}).notNull().default(false),updatedAt:text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)});
export const integrationSyncRuns=sqliteTable("integration_sync_runs",{id:text("id").primaryKey(),connectionId:text("connection_id").notNull(),startedAt:text("started_at").notNull(),finishedAt:text("finished_at").notNull().default(""),trigger:text("trigger").notNull(),status:text("status").notNull(),receivedCount:integer("received_count").notNull().default(0),acceptedCount:integer("accepted_count").notNull().default(0),rejectedCount:integer("rejected_count").notNull().default(0),errorCount:integer("error_count").notNull().default(0),conflictCount:integer("conflict_count").notNull().default(0),checkpoint:text("checkpoint").notNull().default(""),errorMessage:text("error_message").notNull().default(""),initiatedBy:text("initiated_by").notNull(),correlationId:text("correlation_id").notNull(),dryRun:integer("dry_run",{mode:"boolean"}).notNull().default(false)},(table)=>[uniqueIndex("integration_runs_correlation_unique").on(table.correlationId)]);
export const integrationLogEntries=sqliteTable("integration_log_entries",{id:integer("id").primaryKey({autoIncrement:true}),runId:text("run_id").notNull(),connectionId:text("connection_id").notNull(),level:text("level").notNull(),event:text("event").notNull(),message:text("message").notNull(),recordRef:text("record_ref").notNull().default(""),createdAt:text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)});
export const integrationConflicts=sqliteTable("integration_conflicts",{id:text("id").primaryKey(),connectionId:text("connection_id").notNull(),externalRecordId:text("external_record_id").notNull(),internalEntityId:text("internal_entity_id").notNull().default(""),conflictType:text("conflict_type").notNull(),fieldName:text("field_name").notNull(),sourceValue:text("source_value").notNull(),targetValue:text("target_value").notNull(),ownerEntityId:text("owner_entity_id").notNull(),status:text("status").notNull(),resolution:text("resolution").notNull().default(""),evidence:text("evidence").notNull().default(""),relatedTaskId:integer("related_task_id"),detectedAt:text("detected_at").notNull(),resolvedAt:text("resolved_at").notNull().default("")});

export const analyticsMetricDefinitions=sqliteTable("analytics_metric_definitions",{id:text("id").primaryKey(),name:text("name").notNull(),category:text("category").notNull(),definition:text("definition").notNull(),formula:text("formula").notNull(),unit:text("unit").notNull(),grain:text("grain").notNull(),sourceTables:text("source_tables").notNull(),sourceQuality:text("source_quality").notNull(),freshness:text("freshness").notNull(),ownerEntityId:text("owner_entity_id").notNull(),targetValue:integer("target_value"),sensitive:integer("sensitive",{mode:"boolean"}).notNull().default(false)});
export const analyticsSignals=sqliteTable("analytics_signals",{id:text("id").primaryKey(),contractId:text("contract_id").notNull(),domain:text("domain").notNull(),signalType:text("signal_type").notNull(),severity:text("severity").notNull(),title:text("title").notNull(),evidence:text("evidence").notNull(),explanation:text("explanation").notNull(),recommendation:text("recommendation").notNull(),sourceRefs:text("source_refs").notNull(),confidence:integer("confidence").notNull(),status:text("status").notNull(),relatedTaskId:integer("related_task_id"),humanDecision:text("human_decision").notNull().default(""),decisionEvidence:text("decision_evidence").notNull().default(""),detectedAt:text("detected_at").notNull(),decidedAt:text("decided_at").notNull().default("")});
export const aiProcessContracts=sqliteTable("ai_process_contracts",{id:text("id").primaryKey(),name:text("name").notNull(),inputData:text("input_data").notNull(),expectedResult:text("expected_result").notNull(),allowedActions:text("allowed_actions").notNull(),forbiddenActions:text("forbidden_actions").notNull(),humanOwner:text("human_owner").notNull(),costMinor:integer("cost_minor").notNull(),benefitMetric:text("benefit_metric").notNull(),autoStopCondition:text("auto_stop_condition").notNull(),optOutAllowed:integer("opt_out_allowed",{mode:"boolean"}).notNull().default(true),optOutProcedure:text("opt_out_procedure").notNull(),fallbackFunctionality:text("fallback_functionality").notNull(),stoppedDataProcessing:text("stopped_data_processing").notNull(),historicalDataPolicy:text("historical_data_policy").notNull(),optOutImpact:text("opt_out_impact").notNull(),status:text("status").notNull(),version:text("version").notNull(),sourceRefs:text("source_refs").notNull(),updatedAt:text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)});
export const aiModelRuns=sqliteTable("ai_model_runs",{id:text("id").primaryKey(),contractId:text("contract_id").notNull(),ranAt:text("ran_at").notNull(),modelVersion:text("model_version").notNull(),status:text("status").notNull(),inputSnapshotRef:text("input_snapshot_ref").notNull(),outputType:text("output_type").notNull(),outputSummary:text("output_summary").notNull(),confidence:integer("confidence").notNull(),costMinor:integer("cost_minor").notNull(),explanation:text("explanation").notNull(),humanDecision:text("human_decision").notNull().default(""),decidedBy:text("decided_by").notNull().default(""),decisionAt:text("decision_at").notNull().default(""),isSynthetic:integer("is_synthetic",{mode:"boolean"}).notNull().default(true)});
export const aiOptOuts=sqliteTable("ai_opt_outs",{id:text("id").primaryKey(),contractId:text("contract_id").notNull(),scopeType:text("scope_type").notNull(),scopeRef:text("scope_ref").notNull(),requestedBy:text("requested_by").notNull(),reason:text("reason").notNull(),status:text("status").notNull(),stopsProcessingAt:text("stops_processing_at").notNull(),historicalDataPolicy:text("historical_data_policy").notNull(),createdAt:text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)});

export const customerComplaints=sqliteTable("customer_complaints",{id:text("id").primaryKey(),familyEntityId:text("family_entity_id").notNull(),childEntityId:text("child_entity_id").notNull(),serviceEntityId:text("service_entity_id").notNull(),channel:text("channel").notNull(),receivedAt:text("received_at").notNull(),category:text("category").notNull(),summary:text("summary").notNull(),responsibleEntityId:text("responsible_entity_id").notNull(),status:text("status").notNull(),relatedTaskId:integer("related_task_id"),satisfactionScore:integer("satisfaction_score").notNull().default(0),closedAt:text("closed_at").notNull().default("")});
export const complaintActions=sqliteTable("complaint_actions",{id:text("id").primaryKey(),complaintId:text("complaint_id").notNull(),taskId:integer("task_id").notNull(),actionType:text("action_type").notNull(),ownerEntityId:text("owner_entity_id").notNull(),dueAt:text("due_at").notNull(),result:text("result").notNull(),evidence:text("evidence").notNull(),status:text("status").notNull(),completedAt:text("completed_at").notNull().default("")});
export const readinessScenarios=sqliteTable("readiness_scenarios",{id:text("id").primaryKey(),number:integer("number").notNull(),name:text("name").notNull(),chain:text("chain").notNull(),ownerEntityId:text("owner_entity_id").notNull(),status:text("status").notNull(),dataBoundary:text("data_boundary").notNull(),evidence:text("evidence").notNull().default(""),failure:text("failure").notNull().default(""),lastRunAt:text("last_run_at").notNull().default(""),durationMs:integer("duration_ms").notNull().default(0)});
export const readinessScenarioSteps=sqliteTable("readiness_scenario_steps",{id:text("id").primaryKey(),scenarioId:text("scenario_id").notNull(),stepOrder:integer("step_order").notNull(),stepName:text("step_name").notNull(),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),checkType:text("check_type").notNull(),status:text("status").notNull(),evidence:text("evidence").notNull().default(""),checkedAt:text("checked_at").notNull().default("")},(table)=>[uniqueIndex("readiness_step_order_unique").on(table.scenarioId,table.stepOrder)]);
export const readinessValidationRuns=sqliteTable("readiness_validation_runs",{id:text("id").primaryKey(),suite:text("suite").notNull(),environment:text("environment").notNull(),startedAt:text("started_at").notNull(),finishedAt:text("finished_at").notNull(),status:text("status").notNull(),passed:integer("passed").notNull(),failed:integer("failed").notNull(),skipped:integer("skipped").notNull(),commitSha:text("commit_sha").notNull(),artifactRef:text("artifact_ref").notNull(),initiatedBy:text("initiated_by").notNull()});
export const releaseGates=sqliteTable("release_gates",{id:text("id").primaryKey(),name:text("name").notNull(),status:text("status").notNull(),required:integer("required",{mode:"boolean"}).notNull().default(true),evidence:text("evidence").notNull(),ownerEntityId:text("owner_entity_id").notNull(),updatedAt:text("updated_at").notNull()});
export const recoveryDrills=sqliteTable("recovery_drills",{id:text("id").primaryKey(),drillType:text("drill_type").notNull(),scope:text("scope").notNull(),startedAt:text("started_at").notNull(),finishedAt:text("finished_at").notNull(),status:text("status").notNull(),rpoMinutes:integer("rpo_minutes").notNull().default(0),rtoMinutes:integer("rto_minutes").notNull().default(0),checksumBefore:text("checksum_before").notNull().default(""),checksumAfter:text("checksum_after").notNull().default(""),evidence:text("evidence").notNull(),limitation:text("limitation").notNull()});

export const acceptanceDecisions = sqliteTable("acceptance_decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stage: text("stage").notNull(),
  verdict: text("verdict").notNull(),
  comment: text("comment").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
