import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { entityDuplicateKey, manualEntityNormalization } from "../lib/entity-provenance";
import { ensureOperatingIntegrationCatalog } from "../lib/operating-integration-catalog";
import { toTochkaFinancialOperation } from "../lib/integrations";
import type { TochkaReadOnlySyncResult } from "../lib/integrations";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

const CORE_SCHEMA_VERSION = "arthello-os-task-ownership-v1";
const INTEGRATION_DEMO_BOOTSTRAP_VERSION = "integration-demo-v3";
const FINANCE_ENTITY_LINKS_BOOTSTRAP_VERSION = "finance-entity-links-v1";
const SYSTEM_DEMO_PURGE_VERSION = "global-demo-purge-v2";
const MANUAL_ENTITY_PROVENANCE_VERSION = "manual-entity-provenance-v2";
const TASK_OWNER_BACKFILL_VERSION = "task-created-by-user-v1";
const HUMAN_READABLE_RECORDS_VERSION = "human-readable-records-v1";
const LEGACY_ALFA_BANK_MIGRATION_VERSION = "legacy-alfa-bank-to-tbank-v1";
const REQUIRED_CORE_TABLES = [
  "organization_branches",
  "app_users",
  "app_systems",
  "user_system_access",
  "access_sync_events",
  "family_system_access",
  "user_branch_access",
  "manual_records",
  "tasks",
  "entities",
  "financial_operations",
  "bank_accounts",
  "bank_statement_imports",
  "bank_transactions",
  "client_lifecycles",
  "content_plan_items",
  "education_programs",
  "hr_employees",
  "legal_contracts",
  "legal_contract_text_versions",
  "procurement_suppliers",
  "food_products",
  "safety_systems",
  "medical_cases",
  "accounting_documents",
  "strategy_projects",
  "integration_connections",
  "analytics_signals",
  "readiness_scenarios",
] as const;

let coreTablesPromise: Promise<void> | null = null;

export async function ensureCoreTables() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  if (!coreTablesPromise) {
    coreTablesPromise = ensureCoreTablesOnce().catch((error) => {
      coreTablesPromise = null;
      throw error;
    });
  }

  return coreTablesPromise;
}

async function ensureCoreTablesOnce() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS system_runtime_state (
    state_key TEXT PRIMARY KEY NOT NULL,
    state_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();

  const mode = await getSystemDataMode();
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key = 'core_schema'"
  ).first<{ state_value: string }>();
  const placeholders = REQUIRED_CORE_TABLES.map(() => "?").join(",");
  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
  ).bind(...REQUIRED_CORE_TABLES).first<{ table_count: number }>();
  const hasAllCoreTables = Number(existing?.table_count ?? 0) === REQUIRED_CORE_TABLES.length;

  // DDL repair is deliberately independent from data initialization. Every
  // process validates the complete idempotent schema once, including tables
  // outside REQUIRED_CORE_TABLES, while demo rows are created only in an
  // explicitly selected test contour.
  await initializeCoreTables();
  await migrateLegacyAlfaBankIntegration();
  await normalizeManualEntityProvenance();
  // A stored bank credential is useful only while the runtime master key can
  // actually decrypt it. Validate every envelope during readiness so a stale
  // runner-side key fails before a candidate can touch or replace production.
  await verifyStoredIntegrationCredentials();
  if (!hasAllCoreTables && mode === "test") await seedInitialDemoData();
  if (mode === "test") await normalizeHumanReadableDemoRecords();

  if (marker?.state_value !== CORE_SCHEMA_VERSION || !hasAllCoreTables) {
    await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
      VALUES ('core_schema',?,CURRENT_TIMESTAMP)
      ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
      .bind(CORE_SCHEMA_VERSION)
      .run();
  }

  // Empty production data is durable: health checks may repair DDL, but they must
  // never recreate demo, imported or derived business records.
  if (mode === "empty") {
    await ensureOperatingIntegrationCatalogState();
    return;
  }

  await ensurePaymentDerivedCounterparties();

  if (mode === "source_only") {
    await ensureSourceOnlyCleanup();
  } else {
    await ensureIntegrationDemoBootstrap();
    await ensureAnalyticsDemoBootstrap();
    await ensureFinanceEntityLinksBootstrap();
  }
  await ensureOperatingIntegrationCatalogState();
}

async function ensureOperatingIntegrationCatalogState() {
  await ensureOperatingIntegrationCatalog();
}

async function migrateLegacyAlfaBankIntegration() {
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key='legacy_alfa_bank_migration'",
  ).first<{ state_value: string }>();
  if (marker?.state_value !== LEGACY_ALFA_BANK_MIGRATION_VERSION) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM system_runtime_state WHERE state_key='integration_setup:INT-T-ALFABANK'"),
      env.DB.prepare("DELETE FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:INT-T-ALFABANK:%'"),
      env.DB.prepare("DELETE FROM tasks WHERE source_type='Конфликт интеграции' AND source_id IN (SELECT id FROM integration_conflicts WHERE connection_id='INT-T-ALFABANK')"),
      env.DB.prepare("DELETE FROM integration_log_entries WHERE connection_id='INT-T-ALFABANK'"),
      env.DB.prepare("DELETE FROM integration_conflicts WHERE connection_id='INT-T-ALFABANK'"),
      env.DB.prepare("DELETE FROM integration_sync_runs WHERE connection_id='INT-T-ALFABANK'"),
      env.DB.prepare("DELETE FROM integration_connections WHERE id='INT-T-ALFABANK'"),
      env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
        VALUES ('legacy_alfa_bank_migration',?,CURRENT_TIMESTAMP)
        ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
        .bind(LEGACY_ALFA_BANK_MIGRATION_VERSION),
    ]);
  }
}

async function normalizeHumanReadableDemoRecords() {
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key = 'human_readable_records'",
  ).first<{ state_value: string }>();
  if (marker?.state_value === HUMAN_READABLE_RECORDS_VERSION) return;

  await env.DB.batch([
    env.DB.prepare("UPDATE accounting_documents SET number='0031' WHERE id='ACC-INV-T-031' AND source_type='SYNTHETIC_ACCOUNTING_TEST'"),
    env.DB.prepare("UPDATE accounting_documents SET number='0088' WHERE id='ACC-UPD-T-088' AND source_type='SYNTHETIC_ACCOUNTING_TEST'"),
    env.DB.prepare("UPDATE accounting_documents SET number='0821' WHERE id='ACC-RECEIPT-T-FOOD' AND source_type='SYNTHETIC_ACCOUNTING_TEST'"),
    env.DB.prepare("UPDATE education_progress SET period='3 квартал 2026',evidence='Посещаемость и проверочная работа №0004' WHERE id IN ('PROG-T-014','PROG-T-015')"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Поступления за месяц минус списания',source_quality='Факт исходной таблицы и отдельно помеченные тестовые записи' WHERE id='MET-T-CASH'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Начальный остаток плюс поступления и минус списания с учётом вероятности' WHERE id='MET-T-CASH-GAP'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Сумма подтверждённых оплат семьи' WHERE id='MET-T-LTV'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET definition='Число активных семей с высоким риском',formula='Число активных семей с высоким риском' WHERE id='MET-T-CHURN'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Среднее значение прогресса',freshness='3 квартал 2026' WHERE id='MET-T-EDU'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Число работающих сотрудников' WHERE id='MET-T-STAFF'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Число незакрытых неисправностей' WHERE id='MET-T-SAFETY'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Доля прибыли после стоимости продуктов и смен' WHERE id='MET-T-FOOD'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Число проектов под риском' WHERE id='MET-T-PROJECT'"),
    env.DB.prepare("UPDATE analytics_metric_definitions SET formula='Число открытых расхождений в финансах и интеграциях' WHERE id='MET-T-DQ'"),
    env.DB.prepare("UPDATE ai_process_contracts SET version='Правила с ручным подтверждением' WHERE id LIKE 'AI-CONTRACT-%'"),
    env.DB.prepare("UPDATE ai_model_runs SET model_version='Правила с ручным подтверждением',input_snapshot_ref='Контрольный снимок аналитики' WHERE id LIKE 'AI-RUN-T-%'"),
    env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
      VALUES ('human_readable_records',?,CURRENT_TIMESTAMP)
      ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
      .bind(HUMAN_READABLE_RECORDS_VERSION),
  ]);
}

async function normalizeManualEntityProvenance() {
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key='manual_entity_provenance'"
  ).first<{ state_value: string }>();
  if (marker?.state_value === MANUAL_ENTITY_PROVENANCE_VERSION) return;

  type ManualEntityRow = {
    id: string;
    entityType: string;
    displayName: string;
    sourceSystem: string;
    dataQuality: string;
    status: string;
    hrStatus: string | null;
  };
  type IdentityRow = { entityType: string; displayName: string };
  const [manualResult, identityResult] = await Promise.all([
    env.DB.prepare(`SELECT entity.id AS id,entity.entity_type AS entityType,entity.display_name AS displayName,
      entity.source_system AS sourceSystem,entity.data_quality AS dataQuality,entity.status AS status,employee.status AS hrStatus
      FROM entities AS entity LEFT JOIN hr_employees AS employee ON employee.id=entity.id
      WHERE (upper(entity.source_system)='MANUAL' OR upper(entity.source_system) GLOB 'MANUAL_*')
        AND entity.status <> 'Объединена'`).all<ManualEntityRow>(),
    env.DB.prepare(`SELECT entity_type AS entityType,display_name AS displayName
      FROM entities WHERE status <> 'Объединена'`).all<IdentityRow>(),
  ]);
  const duplicateCounts = new Map<string, number>();
  for (const row of identityResult.results ?? []) {
    const key = entityDuplicateKey(row);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }
  const eligible = (manualResult.results ?? []).flatMap((row) => {
    const normalized = manualEntityNormalization(
      row,
      (duplicateCounts.get(entityDuplicateKey(row)) ?? 0) > 1,
      row.hrStatus,
    );
    return normalized ? [{ row, normalized }] : [];
  });
  for (let offset = 0; offset < eligible.length; offset += 40) {
    const statements = eligible.slice(offset, offset + 40).flatMap(({ row, normalized }) => {
      const payload = JSON.stringify({
        from: row.dataQuality,
        to: normalized.dataQuality,
        provenance: "Создано вручную",
        statusFrom: row.status,
        statusTo: normalized.status,
        reason: "manual-source-without-duplicate",
      });
      return [
        env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT 'system-migration','entity.provenance_normalized','entity',id,?
          FROM entities WHERE id=? AND data_quality=? AND status=?`).bind(payload, row.id, row.dataQuality, row.status),
        env.DB.prepare(`UPDATE entities SET data_quality=?,status=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND data_quality=? AND status=?`).bind(normalized.dataQuality, normalized.status, row.id, row.dataQuality, row.status),
      ];
    });
    await env.DB.batch(statements);
  }
  await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('manual_entity_provenance',?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(MANUAL_ENTITY_PROVENANCE_VERSION)
    .run();
}

async function ensurePaymentDerivedCounterparties() {
  if (await getSystemDataMode() === "empty") return;
  await env.DB.prepare(`INSERT INTO entities
    (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by,updated_at)
    VALUES ('SUP-T-001','Контрагент','Контрагент T-001 · продукты','Активна','XLSX_MASKED','ODDS-CTR-T-FOOD','Проекция','Финансы','{}','system-finance-source',CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET entity_type='Контрагент',display_name='Контрагент T-001 · продукты',source_system='XLSX_MASKED',source_record_id='ODDS-CTR-T-FOOD',data_quality='Проекция',scope='Финансы',updated_at=CURRENT_TIMESTAMP
    WHERE entities.created_by LIKE 'system-%'`).run();
}

async function ensureSourceOnlyCleanup() {
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key='system_demo_purge'"
  ).first<{ state_value: string }>();
  if (marker?.state_value === SYSTEM_DEMO_PURGE_VERSION) return;
  await removeSystemDemoData("system-migration");
}

async function ensureFinanceEntityLinksBootstrap() {
  if (await getSystemDataMode() === "empty") return;
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key = 'finance_entity_links_bootstrap'"
  ).first<{ state_value: string }>();
  if (marker?.state_value === FINANCE_ENTITY_LINKS_BOOTSTRAP_VERSION) return;

  await env.DB.prepare(`INSERT OR IGNORE INTO entity_links
    (from_entity_id, to_entity_id, relation_type, created_by)
    SELECT 'FAM-GROUP-T', 'FAM-T-014', 'Тестовый пример семьи · не детализация XLSX', 'system-seed'
    WHERE EXISTS (SELECT 1 FROM entities WHERE id = 'FAM-GROUP-T')
      AND EXISTS (SELECT 1 FROM entities WHERE id = 'FAM-T-014')`)
    .run();

  await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('finance_entity_links_bootstrap',?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(FINANCE_ENTITY_LINKS_BOOTSTRAP_VERSION)
    .run();
}

async function initializeCoreTables() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  const schemaStatements = [
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS organization_branches (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'Филиал',
      status TEXT NOT NULL DEFAULT 'Активен',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY NOT NULL,
      contact_type TEXT NOT NULL,
      contact TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      job_title TEXT NOT NULL DEFAULT '',
      allowed_modules TEXT NOT NULL DEFAULT '',
      favorite_modules TEXT NOT NULL DEFAULT '',
      is_administrative INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Приглашён',
      invitation_status TEXT NOT NULL DEFAULT 'Ожидает активации',
      access_version INTEGER NOT NULL DEFAULT 1,
      invited_by TEXT NOT NULL,
      invited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activated_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_systems (
      id TEXT PRIMARY KEY NOT NULL,
      system_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Активна',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_system_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id TEXT NOT NULL,
      system_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Активен',
      access_version INTEGER NOT NULL DEFAULT 1,
      last_sync_status TEXT NOT NULL DEFAULT 'Не требуется',
      last_synced_at TEXT NOT NULL DEFAULT '',
      granted_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS access_sync_events (
      id TEXT PRIMARY KEY NOT NULL,
      event_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      system_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Ожидает синхронизации',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS family_system_access (
      id TEXT PRIMARY KEY NOT NULL,
      family_entity_id TEXT NOT NULL,
      principal_entity_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      system_id TEXT NOT NULL,
      role TEXT NOT NULL,
      login_type TEXT NOT NULL,
      login TEXT NOT NULL,
      delivery_channel TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'Ожидает отправки',
      status TEXT NOT NULL DEFAULT 'Активен',
      access_version INTEGER NOT NULL DEFAULT 1,
      last_sync_status TEXT NOT NULL DEFAULT 'Ожидает синхронизации',
      last_synced_at TEXT NOT NULL DEFAULT '',
      granted_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_branch_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'Работа',
      granted_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS manual_records (
      id TEXT PRIMARY KEY NOT NULL,
      branch_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      title TEXT NOT NULL,
      period TEXT NOT NULL DEFAULT '',
      amount_minor INTEGER NOT NULL DEFAULT 0,
      details TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'Черновик',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      title TEXT NOT NULL,
      owner TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'Средний',
      status TEXT NOT NULL DEFAULT 'Входящие',
      source_type TEXT NOT NULL DEFAULT 'Ручная задача',
      source_id TEXT NOT NULL DEFAULT 'MANUAL',
      description TEXT NOT NULL DEFAULT '',
      assignee_entity_id TEXT NOT NULL DEFAULT '',
      parent_task_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'Задача',
      recurrence_rule TEXT NOT NULL DEFAULT '',
      automation_key TEXT,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      result TEXT NOT NULL DEFAULT '',
      result_evidence TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS acceptance_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      stage TEXT NOT NULL,
      verdict TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Активна',
      source_system TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      data_quality TEXT NOT NULL DEFAULT 'Тестовые данные',
      scope TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      from_entity_id TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT NOT NULL,
      document_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Актуален',
      valid_until TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'MANUAL',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_merges (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      survivor_id TEXT NOT NULL,
      duplicate_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_watchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id INTEGER NOT NULL,
      entity_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_checklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id INTEGER NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Ожидает',
      decided_by TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_documents (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      document_type TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Актуален',
      valid_until TEXT NOT NULL DEFAULT '',
      owner_entity_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'MANUAL',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id INTEGER NOT NULL,
      document_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS obligations (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      document_id TEXT NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      owner_entity_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Открыто',
      warning_days INTEGER NOT NULL DEFAULT 30,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      recipient_entity_id TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Новое',
      dedup_key TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT NOT NULL DEFAULT ''
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS escalations (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Открыта',
      recipient_entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS financial_operations (
      id TEXT PRIMARY KEY NOT NULL,
      operation_date TEXT NOT NULL,
      period TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      category TEXT NOT NULL,
      report_class TEXT NOT NULL,
      counterparty_entity_id TEXT NOT NULL DEFAULT '',
      contract_id TEXT NOT NULL DEFAULT '',
      document_id TEXT NOT NULL DEFAULT '',
      project_entity_id TEXT NOT NULL DEFAULT '',
      legal_entity_id TEXT NOT NULL DEFAULT '',
      object_entity_id TEXT NOT NULL DEFAULT '',
      cfr_entity_id TEXT NOT NULL DEFAULT '',
      bank_operation_ref TEXT NOT NULL DEFAULT '',
      operation_kind TEXT NOT NULL DEFAULT 'XLSX_AGGREGATE',
      source_system TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_sheet TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      data_quality TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Разнесено',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      connection_id TEXT NOT NULL,
      legal_entity_id TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      masked_account TEXT NOT NULL,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      balance_minor INTEGER,
      balance_as_of TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bank_statement_imports (
      id TEXT PRIMARY KEY NOT NULL,
      connection_id TEXT NOT NULL,
      legal_entity_id TEXT NOT NULL,
      provider_statement_id TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL,
      start_balance_minor INTEGER NOT NULL,
      end_balance_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      transaction_count INTEGER NOT NULL,
      fetched_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bank_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      connection_id TEXT NOT NULL,
      legal_entity_id TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      provider_statement_id TEXT NOT NULL,
      provider_transaction_id TEXT NOT NULL,
      payment_id TEXT NOT NULL DEFAULT '',
      operation_date TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      document_number TEXT NOT NULL DEFAULT '',
      transaction_type TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      counterparty_name TEXT NOT NULL DEFAULT '',
      counterparty_inn TEXT NOT NULL DEFAULT '',
      counterparty_kpp TEXT NOT NULL DEFAULT '',
      source_payload_hash TEXT NOT NULL,
      financial_operation_id TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS finance_accruals (
      id TEXT PRIMARY KEY NOT NULL,
      period TEXT NOT NULL,
      contour TEXT NOT NULL,
      subject_entity_id TEXT NOT NULL,
      records_count INTEGER NOT NULL,
      accrual_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,
      debt_minor INTEGER NOT NULL,
      debt_cases INTEGER NOT NULL,
      source_file TEXT NOT NULL,
      source_sheet TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      data_quality TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS finance_budgets (
      id TEXT PRIMARY KEY NOT NULL,
      period TEXT NOT NULL,
      line TEXT NOT NULL,
      plan_minor INTEGER NOT NULL,
      scenario TEXT NOT NULL,
      assumption TEXT NOT NULL,
      source_type TEXT NOT NULL,
      owner_entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS finance_forecast_items (
      id TEXT PRIMARY KEY NOT NULL,
      forecast_date TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      probability INTEGER NOT NULL,
      category TEXT NOT NULL,
      source_type TEXT NOT NULL,
      assumption TEXT NOT NULL,
      linked_entity_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS finance_payroll_summary (
      id TEXT PRIMARY KEY NOT NULL,
      period TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      scope TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_sheet TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      data_quality TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS finance_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      operation_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      before_value TEXT NOT NULL,
      after_value TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Предложена',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS finance_reconciliation_issues (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      source_a TEXT NOT NULL,
      source_b TEXT NOT NULL,
      difference_minor INTEGER NOT NULL,
      owner_entity_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Открыто',
      related_task_id INTEGER,
      resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sales_leads (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      first_click_at TEXT NOT NULL,
      source TEXT NOT NULL,
      utm_source TEXT NOT NULL DEFAULT '',
      utm_medium TEXT NOT NULL DEFAULT '',
      utm_campaign TEXT NOT NULL DEFAULT '',
      utm_content TEXT NOT NULL DEFAULT '',
      campaign_id TEXT NOT NULL DEFAULT '',
      creative_id TEXT NOT NULL DEFAULT '',
      offer_id TEXT NOT NULL DEFAULT '',
      form_id TEXT NOT NULL DEFAULT '',
      manager_entity_id TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'Заявка',
      status TEXT NOT NULL DEFAULT 'Активен',
      family_entity_id TEXT NOT NULL DEFAULT '',
      child_entity_id TEXT NOT NULL DEFAULT '',
      contract_id TEXT NOT NULL DEFAULT '',
      service_entity_id TEXT NOT NULL DEFAULT '',
      rejection_reason TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      data_quality TEXT NOT NULL DEFAULT 'Синтетические тестовые данные',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sales_touchpoints (
      id TEXT PRIMARY KEY NOT NULL,
      lead_id TEXT NOT NULL,
      touchpoint_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'Входящий',
      summary TEXT NOT NULL,
      outcome TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT 'SYNTHETIC',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sales_stage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      lead_id TEXT NOT NULL,
      from_stage TEXT NOT NULL,
      to_stage TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS client_lifecycles (
      id TEXT PRIMARY KEY NOT NULL,
      lead_id TEXT NOT NULL,
      family_entity_id TEXT NOT NULL,
      child_entity_id TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      service_entity_id TEXT NOT NULL,
      accrual_id TEXT NOT NULL,
      payment_operation_id TEXT NOT NULL DEFAULT '',
      service_start_date TEXT NOT NULL,
      monthly_value_minor INTEGER NOT NULL,
      ltv_minor INTEGER NOT NULL,
      lifetime_months INTEGER NOT NULL,
      next_payment_date TEXT NOT NULL,
      next_payment_minor INTEGER NOT NULL,
      churn_risk_score INTEGER NOT NULL,
      churn_risk_band TEXT NOT NULL,
      churn_risk_factors TEXT NOT NULL DEFAULT '[]',
      loyalty_tier TEXT NOT NULL,
      repeat_offer TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Активен',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS client_accruals (
      id TEXT PRIMARY KEY NOT NULL,
      family_entity_id TEXT NOT NULL,
      child_entity_id TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      service_entity_id TEXT NOT NULL,
      period TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL,
      payment_operation_id TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'SYNTHETIC_TEST',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS client_bonuses (
      id TEXT PRIMARY KEY NOT NULL,
      family_entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      points INTEGER NOT NULL,
      reason TEXT NOT NULL,
      related_contract_id TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS marketing_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      platform TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      audience_count INTEGER NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'SYNTHETIC_TEST',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS content_plan_items (
      id TEXT PRIMARY KEY NOT NULL,
      scheduled_at TEXT NOT NULL,
      account_id TEXT NOT NULL,
      author_entity_id TEXT NOT NULL,
      format TEXT NOT NULL,
      topic TEXT NOT NULL,
      offer_id TEXT NOT NULL DEFAULT '',
      campaign_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Запланировано',
      brief TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS content_publications (
      id TEXT PRIMARY KEY NOT NULL,
      plan_item_id TEXT NOT NULL,
      published_at TEXT NOT NULL,
      publication_ref TEXT NOT NULL,
      reach INTEGER NOT NULL,
      views INTEGER NOT NULL,
      reactions INTEGER NOT NULL,
      clicks INTEGER NOT NULL,
      leads INTEGER NOT NULL,
      contracts INTEGER NOT NULL,
      revenue_minor INTEGER NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'SYNTHETIC_TEST',
      data_quality TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS content_attributions (
      id TEXT PRIMARY KEY NOT NULL,
      publication_id TEXT NOT NULL,
      click_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      payment_operation_id TEXT NOT NULL,
      revenue_minor INTEGER NOT NULL,
      attribution_model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS content_recommendations (
      id TEXT PRIMARY KEY NOT NULL,
      publication_id TEXT NOT NULL DEFAULT '',
      signal_type TEXT NOT NULL,
      evidence TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Новая',
      related_task_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_programs (id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,author_entity_id TEXT NOT NULL,methodist_entity_id TEXT NOT NULL,scope TEXT NOT NULL,material_ref TEXT NOT NULL,expected_result TEXT NOT NULL,source_type TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_groups (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,unit_entity_id TEXT NOT NULL,program_id TEXT NOT NULL,teacher_entity_id TEXT NOT NULL,room TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_students (id TEXT PRIMARY KEY NOT NULL,child_entity_id TEXT NOT NULL,family_entity_id TEXT NOT NULL,group_id TEXT NOT NULL,cabinet_status TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_lessons (id TEXT PRIMARY KEY NOT NULL,group_id TEXT NOT NULL,program_id TEXT NOT NULL,scheduled_at TEXT NOT NULL,topic TEXT NOT NULL,teacher_entity_id TEXT NOT NULL,substitute_entity_id TEXT NOT NULL DEFAULT '',room TEXT NOT NULL,status TEXT NOT NULL,homework TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_attendance (id TEXT PRIMARY KEY NOT NULL,lesson_id TEXT NOT NULL,student_id TEXT NOT NULL,attendance_status TEXT NOT NULL,grade TEXT NOT NULL DEFAULT '',result TEXT NOT NULL DEFAULT '',recorded_by TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_progress (id TEXT PRIMARY KEY NOT NULL,student_id TEXT NOT NULL,program_id TEXT NOT NULL,period TEXT NOT NULL,metric TEXT NOT NULL,score INTEGER NOT NULL,trend TEXT NOT NULL,evidence TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_feedback (id TEXT PRIMARY KEY NOT NULL,student_id TEXT NOT NULL,family_entity_id TEXT NOT NULL,program_id TEXT NOT NULL,rating INTEGER NOT NULL,comment TEXT NOT NULL,recommendation TEXT NOT NULL,status TEXT NOT NULL,related_task_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS education_communications (id TEXT PRIMARY KEY NOT NULL,communication_type TEXT NOT NULL,audience_type TEXT NOT NULL,audience_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,event_at TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_vacancies (id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,unit TEXT NOT NULL,position_id TEXT NOT NULL,headcount INTEGER NOT NULL,status TEXT NOT NULL,source_type TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_candidates (id TEXT PRIMARY KEY NOT NULL,entity_id TEXT NOT NULL,vacancy_id TEXT NOT NULL,source TEXT NOT NULL,stage TEXT NOT NULL,score INTEGER NOT NULL,decision TEXT NOT NULL DEFAULT '',rejection_reason TEXT NOT NULL DEFAULT '',offer_status TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_interviews (id TEXT PRIMARY KEY NOT NULL,candidate_id TEXT NOT NULL,scheduled_at TEXT NOT NULL,interviewer_entity_id TEXT NOT NULL,score INTEGER NOT NULL,summary TEXT NOT NULL,decision TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_employees (id TEXT PRIMARY KEY NOT NULL,candidate_id TEXT NOT NULL,contract_id TEXT NOT NULL,position_id TEXT NOT NULL,unit TEXT NOT NULL,rate_minor INTEGER NOT NULL,hire_date TEXT NOT NULL,status TEXT NOT NULL,termination_date TEXT NOT NULL DEFAULT '',termination_reason TEXT NOT NULL DEFAULT '',access_status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_onboarding (id TEXT PRIMARY KEY NOT NULL,employee_id TEXT NOT NULL,step TEXT NOT NULL,status TEXT NOT NULL,due_date TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '',related_task_id INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_development (id TEXT PRIMARY KEY NOT NULL,employee_id TEXT NOT NULL,event_type TEXT NOT NULL,title TEXT NOT NULL,event_date TEXT NOT NULL,score INTEGER NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_rewards (id TEXT PRIMARY KEY NOT NULL,employee_id TEXT NOT NULL,event_type TEXT NOT NULL,amount_minor INTEGER NOT NULL,reason TEXT NOT NULL,period TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hr_accesses (id TEXT PRIMARY KEY NOT NULL,employee_id TEXT NOT NULL,system TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,granted_at TEXT NOT NULL,revoked_at TEXT NOT NULL DEFAULT '',revocation_reason TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_contracts (id TEXT PRIMARY KEY NOT NULL,reference_document_id TEXT NOT NULL,contract_type TEXT NOT NULL,party_type TEXT NOT NULL,party_entity_id TEXT NOT NULL,number TEXT NOT NULL,signed_status TEXT NOT NULL,valid_from TEXT NOT NULL,valid_until TEXT NOT NULL,limit_minor INTEGER NOT NULL,spent_minor INTEGER NOT NULL,status TEXT NOT NULL,electronic_signature_status TEXT NOT NULL,requisite_status TEXT NOT NULL,owner_entity_id TEXT NOT NULL,closing_required INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_document_items (id TEXT PRIMARY KEY NOT NULL,stable_id TEXT NOT NULL,contract_id TEXT NOT NULL,item_type TEXT NOT NULL,title TEXT NOT NULL,version INTEGER NOT NULL,required INTEGER NOT NULL DEFAULT 0,signed_status TEXT NOT NULL,status TEXT NOT NULL,due_date TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_contract_text_versions (id TEXT PRIMARY KEY NOT NULL,stable_id TEXT NOT NULL,contract_id TEXT NOT NULL,document_item_id TEXT NOT NULL,version INTEGER NOT NULL,body_text TEXT NOT NULL,source_mode TEXT NOT NULL,model_version TEXT NOT NULL,policy_version TEXT NOT NULL,protection_class TEXT NOT NULL,confirmed_by TEXT NOT NULL,confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_responsibility_zones (id TEXT PRIMARY KEY NOT NULL,contract_id TEXT NOT NULL,zone TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,scope TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_checks (id TEXT PRIMARY KEY NOT NULL,contract_id TEXT NOT NULL,signal_type TEXT NOT NULL,severity TEXT NOT NULL,evidence TEXT NOT NULL,recommendation TEXT NOT NULL,status TEXT NOT NULL,related_task_id INTEGER,detected_at TEXT NOT NULL,resolved_at TEXT NOT NULL DEFAULT '',resolution TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS procurement_suppliers (id TEXT PRIMARY KEY NOT NULL,entity_id TEXT NOT NULL,specialization TEXT NOT NULL,contract_id TEXT NOT NULL,base_price_minor INTEGER NOT NULL,quality_score INTEGER NOT NULL,rating INTEGER NOT NULL,market_index INTEGER NOT NULL,status TEXT NOT NULL,data_quality TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_requests (id TEXT PRIMARY KEY NOT NULL,requester_entity_id TEXT NOT NULL,unit TEXT NOT NULL,item_name TEXT NOT NULL,quantity INTEGER NOT NULL,budget_minor INTEGER NOT NULL,need_by TEXT NOT NULL,status TEXT NOT NULL,justification TEXT NOT NULL,approver_entity_id TEXT NOT NULL DEFAULT '',approved_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS supplier_offers (id TEXT PRIMARY KEY NOT NULL,request_id TEXT NOT NULL,supplier_id TEXT NOT NULL,price_minor INTEGER NOT NULL,delivery_days INTEGER NOT NULL,warranty_months INTEGER NOT NULL,quality_score INTEGER NOT NULL,status TEXT NOT NULL,comparison_note TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS purchase_orders (id TEXT PRIMARY KEY NOT NULL,request_id TEXT NOT NULL,offer_id TEXT NOT NULL,supplier_id TEXT NOT NULL,order_number TEXT NOT NULL,amount_minor INTEGER NOT NULL,status TEXT NOT NULL,ordered_at TEXT NOT NULL,expected_at TEXT NOT NULL,contract_id TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS procurement_deliveries (id TEXT PRIMARY KEY NOT NULL,order_id TEXT NOT NULL,delivered_at TEXT NOT NULL,document_id TEXT NOT NULL,status TEXT NOT NULL,quantity INTEGER NOT NULL,accepted_quantity INTEGER NOT NULL,accepted_by TEXT NOT NULL,quality_note TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventory_items (id TEXT PRIMARY KEY NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,warehouse TEXT NOT NULL,quantity INTEGER NOT NULL,unit_cost_minor INTEGER NOT NULL,asset_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventory_events (id TEXT PRIMARY KEY NOT NULL,item_id TEXT NOT NULL,event_type TEXT NOT NULL,quantity INTEGER NOT NULL,from_location TEXT NOT NULL DEFAULT '',to_location TEXT NOT NULL DEFAULT '',document_id TEXT NOT NULL DEFAULT '',occurred_at TEXT NOT NULL,actor TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY NOT NULL,item_id TEXT NOT NULL,serial_number TEXT NOT NULL,object_entity_id TEXT NOT NULL,assigned_to_entity_id TEXT NOT NULL DEFAULT '',warranty_until TEXT NOT NULL,service_due TEXT NOT NULL,status TEXT NOT NULL,acquisition_date TEXT NOT NULL,cost_minor INTEGER NOT NULL,monthly_depreciation_minor INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS asset_maintenance (id TEXT PRIMARY KEY NOT NULL,asset_id TEXT NOT NULL,maintenance_type TEXT NOT NULL,scheduled_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',contractor_id TEXT NOT NULL,status TEXT NOT NULL,cost_minor INTEGER NOT NULL,document_id TEXT NOT NULL DEFAULT '',related_task_id INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_products (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,supplier_id TEXT NOT NULL,unit TEXT NOT NULL,purchase_cost_minor INTEGER NOT NULL,storage_norm TEXT NOT NULL,status TEXT NOT NULL,project_entity_id TEXT NOT NULL,cfr_entity_id TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_batches (id TEXT PRIMARY KEY NOT NULL,product_id TEXT NOT NULL,purchase_request_id TEXT NOT NULL,received_at TEXT NOT NULL,expires_at TEXT NOT NULL,quantity INTEGER NOT NULL,remaining_quantity INTEGER NOT NULL,unit TEXT NOT NULL,warehouse TEXT NOT NULL,status TEXT NOT NULL,quality_note TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_recipes (id TEXT PRIMARY KEY NOT NULL,dish_name TEXT NOT NULL,version INTEGER NOT NULL,yield_portions INTEGER NOT NULL,standard_cost_minor INTEGER NOT NULL,norm_description TEXT NOT NULL,menu_date TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_recipe_ingredients (id TEXT PRIMARY KEY NOT NULL,recipe_id TEXT NOT NULL,product_id TEXT NOT NULL,quantity_per_batch INTEGER NOT NULL,unit TEXT NOT NULL,cost_minor INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_production (id TEXT PRIMARY KEY NOT NULL,production_date TEXT NOT NULL,recipe_id TEXT NOT NULL,shift_id TEXT NOT NULL,planned_portions INTEGER NOT NULL,actual_portions INTEGER NOT NULL,material_cost_minor INTEGER NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_shipments (id TEXT PRIMARY KEY NOT NULL,production_id TEXT NOT NULL,destination_object_id TEXT NOT NULL,shipped_portions INTEGER NOT NULL,consumed_portions INTEGER NOT NULL,returned_portions INTEGER NOT NULL,written_off_portions INTEGER NOT NULL,revenue_minor INTEGER NOT NULL,status TEXT NOT NULL,document_id TEXT NOT NULL,shipped_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_shifts (id TEXT PRIMARY KEY NOT NULL,employee_entity_id TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,rate_minor INTEGER NOT NULL,status TEXT NOT NULL,role TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS food_checks (id TEXT PRIMARY KEY NOT NULL,check_type TEXT NOT NULL,object_entity_id TEXT NOT NULL,checked_at TEXT NOT NULL,result TEXT NOT NULL,violation TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL,status TEXT NOT NULL,related_task_id INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_systems (id TEXT PRIMARY KEY NOT NULL,system_type TEXT NOT NULL,name TEXT NOT NULL,object_entity_id TEXT NOT NULL,scheme_ref TEXT NOT NULL,journal_ref TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,status TEXT NOT NULL,source_type TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_equipment (id TEXT PRIMARY KEY NOT NULL,system_id TEXT NOT NULL,name TEXT NOT NULL,inventory_number TEXT NOT NULL,location TEXT NOT NULL,contractor_id TEXT NOT NULL,criticality TEXT NOT NULL,next_check_at TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_checks (id TEXT PRIMARY KEY NOT NULL,equipment_id TEXT NOT NULL,object_entity_id TEXT NOT NULL,check_type TEXT NOT NULL,scheduled_at TEXT NOT NULL,checked_at TEXT NOT NULL DEFAULT '',result TEXT NOT NULL,evidence TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_faults (id TEXT PRIMARY KEY NOT NULL,check_id TEXT NOT NULL,equipment_id TEXT NOT NULL,severity TEXT NOT NULL,description TEXT NOT NULL,detected_at TEXT NOT NULL,status TEXT NOT NULL,related_task_id INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_incidents (id TEXT PRIMARY KEY NOT NULL,object_entity_id TEXT NOT NULL,system_id TEXT NOT NULL,happened_at TEXT NOT NULL,category TEXT NOT NULL,severity TEXT NOT NULL,description TEXT NOT NULL,response TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_repairs (id TEXT PRIMARY KEY NOT NULL,fault_id TEXT NOT NULL,contractor_id TEXT NOT NULL,action_type TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',result TEXT NOT NULL,act_document_id TEXT NOT NULL DEFAULT '',cost_minor INTEGER NOT NULL,payment_operation_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_next_checks (id TEXT PRIMARY KEY NOT NULL,equipment_id TEXT NOT NULL,source_repair_id TEXT NOT NULL,scheduled_at TEXT NOT NULL,check_type TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS safety_guard_shifts (id TEXT PRIMARY KEY NOT NULL,object_entity_id TEXT NOT NULL,employee_entity_id TEXT NOT NULL,post TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,journal_ref TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS medical_access_grants (id TEXT PRIMARY KEY NOT NULL,principal_type TEXT NOT NULL,principal_ref TEXT NOT NULL,scope TEXT NOT NULL,granted_by TEXT NOT NULL,valid_until TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS medical_documents (id TEXT PRIMARY KEY NOT NULL,subject_entity_id TEXT NOT NULL,subject_type TEXT NOT NULL,document_type TEXT NOT NULL,document_ref TEXT NOT NULL,valid_from TEXT NOT NULL,valid_until TEXT NOT NULL,status TEXT NOT NULL,storage_class TEXT NOT NULL,minimum_summary TEXT NOT NULL,confirmed_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS medical_restrictions (id TEXT PRIMARY KEY NOT NULL,subject_entity_id TEXT NOT NULL,record_id TEXT NOT NULL,category TEXT NOT NULL,limitation TEXT NOT NULL,valid_until TEXT NOT NULL,action_scope TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS medical_cases (id TEXT PRIMARY KEY NOT NULL,subject_entity_id TEXT NOT NULL,case_type TEXT NOT NULL,opened_at TEXT NOT NULL,severity TEXT NOT NULL,minimum_summary TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,due_at TEXT NOT NULL,status TEXT NOT NULL,closed_at TEXT NOT NULL DEFAULT '',confirmation_ref TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS medical_incidents (id TEXT PRIMARY KEY NOT NULL,case_id TEXT NOT NULL,happened_at TEXT NOT NULL,incident_type TEXT NOT NULL,minimum_facts TEXT NOT NULL,response_required TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS medical_actions (id TEXT PRIMARY KEY NOT NULL,case_id TEXT NOT NULL,incident_id TEXT NOT NULL DEFAULT '',action_type TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,due_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',result TEXT NOT NULL DEFAULT '',confirmation_ref TEXT NOT NULL DEFAULT '',status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS accounting_documents (id TEXT PRIMARY KEY NOT NULL,document_type TEXT NOT NULL,number TEXT NOT NULL,document_date TEXT NOT NULL,counterparty_entity_id TEXT NOT NULL,contract_id TEXT NOT NULL DEFAULT '',amount_minor INTEGER NOT NULL,vat_minor INTEGER NOT NULL,payment_operation_id TEXT NOT NULL DEFAULT '',file_ref TEXT NOT NULL DEFAULT '',signature_status TEXT NOT NULL,edo_status TEXT NOT NULL,source_type TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS accounting_document_links (id TEXT PRIMARY KEY NOT NULL,from_document_id TEXT NOT NULL,to_document_id TEXT NOT NULL,relation_type TEXT NOT NULL,evidence TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS accounting_completeness_checks (id TEXT PRIMARY KEY NOT NULL,operation_id TEXT NOT NULL,contract_id TEXT NOT NULL,required_types TEXT NOT NULL,missing_types TEXT NOT NULL,owner_entity_id TEXT NOT NULL,status TEXT NOT NULL,related_task_id INTEGER,checked_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS accounting_exports (id TEXT PRIMARY KEY NOT NULL,export_type TEXT NOT NULL,period TEXT NOT NULL,document_count INTEGER NOT NULL,amount_minor INTEGER NOT NULL,status TEXT NOT NULL,file_ref TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS accounting_integrations (id TEXT PRIMARY KEY NOT NULL,system TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,truth TEXT NOT NULL,last_success_at TEXT NOT NULL DEFAULT '',next_attempt_at TEXT NOT NULL DEFAULT '',record_count INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategy_goals (id TEXT PRIMARY KEY NOT NULL,level TEXT NOT NULL,unit_entity_id TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,period TEXT NOT NULL,owner_entity_id TEXT NOT NULL,status TEXT NOT NULL,success_definition TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategy_kpis (id TEXT PRIMARY KEY NOT NULL,goal_id TEXT NOT NULL,name TEXT NOT NULL,unit TEXT NOT NULL,target_value INTEGER NOT NULL,actual_value INTEGER NOT NULL,forecast_value INTEGER NOT NULL,variance_value INTEGER NOT NULL,status TEXT NOT NULL,source_ref TEXT NOT NULL,updated_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategy_initiatives (id TEXT PRIMARY KEY NOT NULL,goal_id TEXT NOT NULL,kpi_id TEXT NOT NULL,title TEXT NOT NULL,hypothesis TEXT NOT NULL,owner_entity_id TEXT NOT NULL,planned_start TEXT NOT NULL,planned_end TEXT NOT NULL,status TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategy_projects (id TEXT PRIMARY KEY NOT NULL,initiative_id TEXT NOT NULL,goal_id TEXT NOT NULL,title TEXT NOT NULL,owner_entity_id TEXT NOT NULL,budget_id TEXT NOT NULL,budget_plan_minor INTEGER NOT NULL,budget_actual_minor INTEGER NOT NULL,started_at TEXT NOT NULL,due_at TEXT NOT NULL,status TEXT NOT NULL,outcome TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS business_events (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL,title TEXT NOT NULL,event_at TEXT NOT NULL,location TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,budget_minor INTEGER NOT NULL,actual_minor INTEGER NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',feedback_score INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS event_participants (id TEXT PRIMARY KEY NOT NULL,event_id TEXT NOT NULL,participant_entity_id TEXT NOT NULL,participant_role TEXT NOT NULL,attendance_status TEXT NOT NULL,feedback TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategy_results (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL,event_id TEXT NOT NULL DEFAULT '',result_type TEXT NOT NULL,metric_name TEXT NOT NULL,metric_value INTEGER NOT NULL,unit TEXT NOT NULL,evidence TEXT NOT NULL,recorded_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategy_deviations (id TEXT PRIMARY KEY NOT NULL,kpi_id TEXT NOT NULL,project_id TEXT NOT NULL,deviation_type TEXT NOT NULL,variance_value INTEGER NOT NULL,explanation TEXT NOT NULL,decision TEXT NOT NULL,status TEXT NOT NULL,related_task_id INTEGER,detected_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS integration_connections (id TEXT PRIMARY KEY NOT NULL,system TEXT NOT NULL,category TEXT NOT NULL,target_module TEXT NOT NULL,owner_entity_id TEXT NOT NULL,source_of_truth TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,auth_status TEXT NOT NULL,credential_expires_at TEXT NOT NULL DEFAULT '',last_success_at TEXT NOT NULL DEFAULT '',next_sync_at TEXT NOT NULL DEFAULT '',received_count INTEGER NOT NULL DEFAULT 0,accepted_count INTEGER NOT NULL DEFAULT 0,rejected_count INTEGER NOT NULL DEFAULT 0,error_count INTEGER NOT NULL DEFAULT 0,conflict_count INTEGER NOT NULL DEFAULT 0,impact TEXT NOT NULL,adapter_version TEXT NOT NULL,verified_transfer INTEGER NOT NULL DEFAULT 0,is_enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS integration_sync_runs (id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT NOT NULL DEFAULT '',trigger TEXT NOT NULL,status TEXT NOT NULL,received_count INTEGER NOT NULL DEFAULT 0,accepted_count INTEGER NOT NULL DEFAULT 0,rejected_count INTEGER NOT NULL DEFAULT 0,error_count INTEGER NOT NULL DEFAULT 0,conflict_count INTEGER NOT NULL DEFAULT 0,checkpoint TEXT NOT NULL DEFAULT '',error_message TEXT NOT NULL DEFAULT '',initiated_by TEXT NOT NULL,correlation_id TEXT NOT NULL,dry_run INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS integration_log_entries (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,run_id TEXT NOT NULL,connection_id TEXT NOT NULL,level TEXT NOT NULL,event TEXT NOT NULL,message TEXT NOT NULL,record_ref TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS integration_conflicts (id TEXT PRIMARY KEY NOT NULL,connection_id TEXT NOT NULL,external_record_id TEXT NOT NULL,internal_entity_id TEXT NOT NULL DEFAULT '',conflict_type TEXT NOT NULL,field_name TEXT NOT NULL,source_value TEXT NOT NULL,target_value TEXT NOT NULL,owner_entity_id TEXT NOT NULL,status TEXT NOT NULL,resolution TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL DEFAULT '',related_task_id INTEGER,detected_at TEXT NOT NULL,resolved_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS analytics_metric_definitions (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,definition TEXT NOT NULL,formula TEXT NOT NULL,unit TEXT NOT NULL,grain TEXT NOT NULL,source_tables TEXT NOT NULL,source_quality TEXT NOT NULL,freshness TEXT NOT NULL,owner_entity_id TEXT NOT NULL,target_value INTEGER,sensitive INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS analytics_signals (id TEXT PRIMARY KEY NOT NULL,contract_id TEXT NOT NULL,domain TEXT NOT NULL,signal_type TEXT NOT NULL,severity TEXT NOT NULL,title TEXT NOT NULL,evidence TEXT NOT NULL,explanation TEXT NOT NULL,recommendation TEXT NOT NULL,source_refs TEXT NOT NULL,confidence INTEGER NOT NULL,status TEXT NOT NULL,related_task_id INTEGER,human_decision TEXT NOT NULL DEFAULT '',decision_evidence TEXT NOT NULL DEFAULT '',detected_at TEXT NOT NULL,decided_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_process_contracts (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,input_data TEXT NOT NULL,expected_result TEXT NOT NULL,allowed_actions TEXT NOT NULL,forbidden_actions TEXT NOT NULL,human_owner TEXT NOT NULL,cost_minor INTEGER NOT NULL,benefit_metric TEXT NOT NULL,auto_stop_condition TEXT NOT NULL,opt_out_allowed INTEGER NOT NULL DEFAULT 1,opt_out_procedure TEXT NOT NULL,fallback_functionality TEXT NOT NULL,stopped_data_processing TEXT NOT NULL,historical_data_policy TEXT NOT NULL,opt_out_impact TEXT NOT NULL,status TEXT NOT NULL,version TEXT NOT NULL,source_refs TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_model_runs (id TEXT PRIMARY KEY NOT NULL,contract_id TEXT NOT NULL,ran_at TEXT NOT NULL,model_version TEXT NOT NULL,status TEXT NOT NULL,input_snapshot_ref TEXT NOT NULL,output_type TEXT NOT NULL,output_summary TEXT NOT NULL,confidence INTEGER NOT NULL,cost_minor INTEGER NOT NULL,explanation TEXT NOT NULL,human_decision TEXT NOT NULL DEFAULT '',decided_by TEXT NOT NULL DEFAULT '',decision_at TEXT NOT NULL DEFAULT '',is_synthetic INTEGER NOT NULL DEFAULT 1)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_opt_outs (id TEXT PRIMARY KEY NOT NULL,contract_id TEXT NOT NULL,scope_type TEXT NOT NULL,scope_ref TEXT NOT NULL,requested_by TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,stops_processing_at TEXT NOT NULL,historical_data_policy TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_complaints (id TEXT PRIMARY KEY NOT NULL,family_entity_id TEXT NOT NULL,child_entity_id TEXT NOT NULL,service_entity_id TEXT NOT NULL,channel TEXT NOT NULL,received_at TEXT NOT NULL,category TEXT NOT NULL,summary TEXT NOT NULL,responsible_entity_id TEXT NOT NULL,status TEXT NOT NULL,related_task_id INTEGER,satisfaction_score INTEGER NOT NULL DEFAULT 0,closed_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS complaint_actions (id TEXT PRIMARY KEY NOT NULL,complaint_id TEXT NOT NULL,task_id INTEGER NOT NULL,action_type TEXT NOT NULL,owner_entity_id TEXT NOT NULL,due_at TEXT NOT NULL,result TEXT NOT NULL,evidence TEXT NOT NULL,status TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS readiness_scenarios (id TEXT PRIMARY KEY NOT NULL,number INTEGER NOT NULL,name TEXT NOT NULL,chain TEXT NOT NULL,owner_entity_id TEXT NOT NULL,status TEXT NOT NULL,data_boundary TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '',failure TEXT NOT NULL DEFAULT '',last_run_at TEXT NOT NULL DEFAULT '',duration_ms INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS readiness_scenario_steps (id TEXT PRIMARY KEY NOT NULL,scenario_id TEXT NOT NULL,step_order INTEGER NOT NULL,step_name TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,check_type TEXT NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '',checked_at TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS readiness_validation_runs (id TEXT PRIMARY KEY NOT NULL,suite TEXT NOT NULL,environment TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT NOT NULL,status TEXT NOT NULL,passed INTEGER NOT NULL,failed INTEGER NOT NULL,skipped INTEGER NOT NULL,commit_sha TEXT NOT NULL,artifact_ref TEXT NOT NULL,initiated_by TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS release_gates (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,required INTEGER NOT NULL DEFAULT 1,evidence TEXT NOT NULL,owner_entity_id TEXT NOT NULL,updated_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS recovery_drills (id TEXT PRIMARY KEY NOT NULL,drill_type TEXT NOT NULL,scope TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT NOT NULL,status TEXT NOT NULL,rpo_minutes INTEGER NOT NULL DEFAULT 0,rto_minutes INTEGER NOT NULL DEFAULT 0,checksum_before TEXT NOT NULL DEFAULT '',checksum_after TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL,limitation TEXT NOT NULL)`),
  ];

  for (let index = 0; index < schemaStatements.length; index += 40) {
    await env.DB.batch(schemaStatements.slice(index, index + 40));
  }

  await ensureTaskColumns();
  await backfillTaskOwnership();
  await ensureAccessColumns();
  await ensureTochkaTransactionIdentityIndex();

  await env.DB.batch([
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS entities_source_unique ON entities (entity_type, source_system, source_record_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS app_users_contact_unique ON app_users (contact)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS app_systems_key_unique ON app_systems (system_key)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS user_system_access_unique ON user_system_access (user_id, system_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS user_branch_access_unique ON user_branch_access (user_id, branch_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS family_system_access_principal_unique ON family_system_access (principal_entity_id, system_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS family_system_access_login_unique ON family_system_access (login, system_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS entity_links_unique ON entity_links (from_entity_id, to_entity_id, relation_type)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS entity_merges_duplicate_unique ON entity_merges (duplicate_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS tasks_automation_unique ON tasks (automation_key)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS tasks_created_by_user_idx ON tasks (created_by_user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS tasks_assignee_entity_idx ON tasks (assignee_entity_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS task_watchers_unique ON task_watchers (task_id, entity_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS task_approvals_unique ON task_approvals (task_id, step_name)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS document_versions_unique ON document_versions (document_id, version)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS task_documents_unique ON task_documents (task_id, document_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS obligations_unique ON obligations (document_id, title)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_unique ON notifications (dedup_key)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS escalations_unique ON escalations (task_id, level)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS client_lifecycles_lead_unique ON client_lifecycles (lead_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS content_publications_plan_unique ON content_publications (plan_item_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS education_attendance_lesson_student_unique ON education_attendance (lesson_id, student_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS hr_access_employee_system_unique ON hr_accesses (employee_id, system)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS legal_document_stable_version_unique ON legal_document_items (stable_id, version)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS legal_contract_text_stable_version_unique ON legal_contract_text_versions (stable_id, version)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_provider_unique ON bank_accounts (connection_id, legal_entity_id, provider_account_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_provider_unique ON bank_statement_imports (connection_id, provider_statement_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_provider_unique ON bank_transactions (connection_id, provider_account_id, provider_transaction_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS bank_transactions_date_idx ON bank_transactions (operation_date)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS integration_runs_correlation_unique ON integration_sync_runs (correlation_id)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS readiness_step_order_unique ON readiness_scenario_steps (scenario_id, step_order)"),
  ]);

}

async function seedInitialDemoData() {
  await seedRegistry();
  await seedWorkflow();
  await seedFinance();
  await seedSales();
  await seedContent();
  await seedEducation();
  await seedHr();
  await seedLegal();
  await seedProcurement();
  await seedFood();
  await seedSafety();
  await seedMedical();
  await seedAccounting();
  await seedStrategy();
  await seedIntegrations();
  await seedAnalytics();
  await seedReadiness();
}

// Bank row IDs and financial projection IDs already include the account.
// Keep the database uniqueness constraint in the same account scope.
async function ensureTochkaTransactionIdentityIndex() {
  const expected = ["connection_id", "provider_account_id", "provider_transaction_id"];
  const legacy = ["connection_id", "provider_transaction_id"];
  const readKeys = async () => {
    const list = await env.DB.prepare("PRAGMA index_list(bank_transactions)")
      .all<{ name: string; unique: number; partial: number; origin: string }>();
    const index = (list.results ?? []).find((row) => row.name === "bank_transactions_provider_unique");
    if (!index) return null;
    if (index.unique !== 1 || index.partial !== 0 || index.origin !== "c") {
      throw new Error("TOCHKA_IDENTITY_INDEX_UNEXPECTED");
    }
    const detail = await env.DB.prepare("PRAGMA index_xinfo(bank_transactions_provider_unique)")
      .all<{ seqno: number; name: string | null; desc: number; coll: string; key: number }>();
    const keys = (detail.results ?? []).filter((row) => row.key === 1).sort((a, b) => a.seqno - b.seqno);
    if (keys.some((row) => !row.name || row.desc !== 0 || row.coll !== "BINARY")) {
      throw new Error("TOCHKA_IDENTITY_INDEX_UNEXPECTED");
    }
    return keys.map((row) => row.name);
  };
  const before = await readKeys();
  if (before?.join("|") === expected.join("|")) return;
  if (before !== null && before.join("|") !== legacy.join("|")) {
    throw new Error("TOCHKA_IDENTITY_INDEX_UNEXPECTED");
  }
  const create = env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_provider_unique ON bank_transactions (connection_id, provider_account_id, provider_transaction_id)");
  if (before === null) {
    await create.run();
  } else {
    // D1 batch is transactional: a failed rebuild keeps the former constraint.
    // No bank row, projection, or manual classification is rewritten.
    await env.DB.batch([
      env.DB.prepare("DROP INDEX IF EXISTS bank_transactions_provider_unique"),
      create,
    ]);
  }
  if ((await readKeys())?.join("|") !== expected.join("|")) {
    throw new Error("TOCHKA_IDENTITY_INDEX_UNEXPECTED");
  }
}


async function ensureTaskColumns() {
  const current = await env.DB.prepare("PRAGMA table_info(tasks)").all<{ name: string }>();
  const names = new Set((current.results || []).map((column) => column.name));
  const columns: Record<string, string> = {
    description: "TEXT NOT NULL DEFAULT ''",
    assignee_entity_id: "TEXT NOT NULL DEFAULT ''",
    parent_task_id: "INTEGER",
    kind: "TEXT NOT NULL DEFAULT 'Задача'",
    recurrence_rule: "TEXT NOT NULL DEFAULT ''",
    automation_key: "TEXT",
    requires_approval: "INTEGER NOT NULL DEFAULT 0",
    result: "TEXT NOT NULL DEFAULT ''",
    result_evidence: "TEXT NOT NULL DEFAULT ''",
    completed_at: "TEXT NOT NULL DEFAULT ''",
    created_by_user_id: "TEXT NOT NULL DEFAULT ''",
  };
  const missing = Object.entries(columns).filter(([name]) => !names.has(name));
  for (const [name, definition] of missing) {
    try {
      await env.DB.prepare(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`).run();
    } catch (error) {
      // Parallel isolates may observe the same missing column. Accept only a
      // confirmed concurrent repair; every other migration error must surface.
      const refreshed = await env.DB.prepare("PRAGMA table_info(tasks)").all<{ name: string }>();
      if (!(refreshed.results || []).some((column) => column.name === name)) throw error;
    }
  }
}

async function backfillTaskOwnership() {
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key='task_owner_backfill'"
  ).first<{ state_value: string }>();
  if (marker?.state_value === TASK_OWNER_BACKFILL_VERSION) return;
  // Legacy ownership can be recovered only when the display contact maps to
  // exactly one active app user whose account already existed when the task
  // was created. Ambiguous, recycled, future or unknown contacts deliberately
  // keep an empty immutable owner and therefore fail closed for non-managers.
  // This runs once: a contact registered later must never inherit an old task.
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks
      SET created_by_user_id = (
        SELECT MIN(app_users.id)
        FROM app_users
        WHERE lower(trim(app_users.contact)) = lower(trim(tasks.created_by))
          AND app_users.status = 'Активен'
          AND datetime(app_users.invited_at) <= datetime(tasks.created_at)
      )
      WHERE trim(created_by_user_id) = ''
        AND trim(created_by) <> ''
        AND (
          SELECT COUNT(*)
          FROM app_users
          WHERE lower(trim(app_users.contact)) = lower(trim(tasks.created_by))
            AND app_users.status = 'Активен'
            AND datetime(app_users.invited_at) <= datetime(tasks.created_at)
        ) = 1`),
    env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
      VALUES ('task_owner_backfill',?,CURRENT_TIMESTAMP)
      ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
      .bind(TASK_OWNER_BACKFILL_VERSION),
  ]);
}

async function ensureAccessColumns() {
  const current = await env.DB.prepare("PRAGMA table_info(app_users)").all<{ name: string }>();
  const names = new Set((current.results || []).map((column) => column.name));
  const columns: Record<string, string> = {
    access_version: "INTEGER NOT NULL DEFAULT 1",
    job_title: "TEXT NOT NULL DEFAULT ''",
    allowed_modules: "TEXT NOT NULL DEFAULT ''",
    favorite_modules: "TEXT NOT NULL DEFAULT ''",
  };
  for (const [name, definition] of Object.entries(columns)) {
    if (names.has(name)) continue;
    try {
      await env.DB.prepare(`ALTER TABLE app_users ADD COLUMN ${name} ${definition}`).run();
    } catch (error) {
      const refreshed = await env.DB.prepare("PRAGMA table_info(app_users)").all<{ name: string }>();
      if (!(refreshed.results || []).some((column) => column.name === name)) throw error;
    }
  }
}

async function seedRegistry() {
  const entitySeeds = [
    ["ORG-T-001", "Юрлицо", "ООО «АртХелло» · тест", "SYNTHETIC", "ORG-SRC-T-001", "Группа ArtHello", "Проверено"],
    ["OBJ-T-001", "Объект", "Корпус 1 · тест", "SYNTHETIC", "OBJ-SRC-T-001", "Школа 1–11", "Проверено"],
    ["UNT-T-001", "Подразделение", "Школа 1–11 · тест", "SYNTHETIC", "UNT-SRC-T-001", "Группа ArtHello", "Проверено"],
    ["PRJ-T-001", "Проект", "ArtHello OS", "SYNTHETIC", "PRJ-SRC-T-001", "Управляющая компания", "Проверено"],
    ["DIR-T-001", "Направление", "Общее образование · тест", "SYNTHETIC", "DIR-SRC-T-001", "Школа 1–11", "Проверено"],
    ["SVC-T-001", "Услуга", "Обучение 1–11 · тест", "SYNTHETIC", "SVC-SRC-T-001", "Школа 1–11", "Проверено"],
    ["FAM-T-014", "Семья", "Семья №0014", "SYNTHETIC", "FAM-SRC-T-014", "Школа 1–11", "Проверено"],
    ["CLI-T-014", "Клиент", "Клиент T-014", "SYNTHETIC", "CLI-SRC-T-014", "Школа 1–11", "Проверено"],
    ["CHD-T-014", "Ребёнок", "Ребёнок №0014", "SYNTHETIC", "CHD-SRC-T-014", "3А · тестовая группа", "Проверено"],
    ["EMP-T-032", "Сотрудник", "Педагог №0032", "XLSX_MASKED", "PAYROLL-ROW-T-032", "Школа 1–11", "Требует сверки"],
    ["CAN-T-001", "Кандидат", "Кандидат T-001", "SYNTHETIC", "CAN-SRC-T-001", "Школа 1–11", "На проверке"],
    ["CON-T-001", "Подрядчик", "Подрядчик T-001", "SYNTHETIC", "CON-SRC-T-001", "Эксплуатация", "Проверено"],
    ["SUP-T-001", "Поставщик", "Поставщик T-001", "SYNTHETIC", "SUP-SRC-T-001", "Питание", "Проверено"],
    ["CTR-T-001", "Контрагент", "Контрагент T-001", "SYNTHETIC", "CTR-SRC-T-001", "Финансы", "На проверке"],
    ["OBJ-T-002", "Объект", "Учебный комплекс · тест", "SYNTHETIC", "OBJ-SRC-T-002", "Образование", "Проверено"],
    ["PRJ-T-004", "Проект", "Учебный год 2026/27 · тест", "SYNTHETIC", "PRJ-SRC-T-004", "Образование", "Проверено"],
    ["CFR-T-001", "ЦФО", "ЦФО Образование · тест", "SYNTHETIC", "CFR-SRC-T-001", "Финансы", "Проверено"],
    ["CFR-T-002", "ЦФО", "ЦФО Управляющая компания · тест", "SYNTHETIC", "CFR-SRC-T-002", "Финансы", "Проверено"],
    ["FAM-GROUP-T", "Контрагент", "Группа семей · обезличено", "XLSX_MASKED", "PAYMENTS-GROUP-T", "Финансы", "Агрегат"],
    ["EMP-GROUP-T", "Контрагент", "Группа сотрудников · обезличено", "XLSX_MASKED", "PAYROLL-GROUP-T", "Финансы", "Агрегат"],
    ["CTR-T-101", "Контрагент", "Контрагент T-101 · аренда", "XLSX_MASKED", "ODDS-CTR-T-101", "Финансы", "Проекция"],
    ["CTR-T-102", "Контрагент", "Контрагент T-102 · объект", "XLSX_MASKED", "ODDS-CTR-T-102", "Финансы", "Проекция"],
    ["CTR-T-103", "Контрагент", "Контрагент T-103 · банк", "XLSX_MASKED", "ODDS-CTR-T-103", "Финансы", "Проекция"],
    ["CTR-T-104", "Контрагент", "Контрагент T-104 · заём", "XLSX_MASKED", "ODDS-CTR-T-104", "Финансы", "Проекция"],
    ["CTR-T-105", "Контрагент", "Контрагент T-105 · финансирование", "XLSX_MASKED", "ODDS-CTR-T-105", "Финансы", "Проекция"],
    ["CTR-T-106", "Контрагент", "Контрагент T-106 · маркетинг", "XLSX_MASKED", "ODDS-CTR-T-106", "Финансы", "Проекция"],
    ["CTR-T-107", "Контрагент", "Контрагент T-107 · прочие доходы", "XLSX_MASKED", "ODDS-CTR-T-107", "Финансы", "Проекция"],
    ["CTR-T-108", "Контрагент", "Контрагент T-108 · возвраты", "XLSX_MASKED", "ODDS-CTR-T-108", "Финансы", "Проекция"],
    ["CTR-T-109", "Контрагент", "Контрагент T-109 · налоги", "XLSX_MASKED", "ODDS-CTR-T-109", "Финансы", "Проекция"],
    ["CTR-T-110", "Контрагент", "Контрагент T-110 · содержание", "XLSX_MASKED", "ODDS-CTR-T-110", "Финансы", "Проекция"],
    ["CTR-T-111", "Контрагент", "Контрагент T-111 · деятельность", "XLSX_MASKED", "ODDS-CTR-T-111", "Финансы", "Проекция"],
    ["CTR-T-112", "Контрагент", "Контрагент T-112 · управление", "XLSX_MASKED", "ODDS-CTR-T-112", "Финансы", "Проекция"],
    ["CTR-T-113", "Контрагент", "Контрагент T-113 · связь", "XLSX_MASKED", "ODDS-CTR-T-113", "Финансы", "Проекция"],
    ["CTR-T-114", "Контрагент", "Контрагент T-114 · финансовая деятельность", "XLSX_MASKED", "ODDS-CTR-T-114", "Финансы", "Проекция"],
    ["CTR-T-199", "Контрагент", "Контрагент T-199 · не разнесено", "XLSX_MASKED", "ODDS-CTR-T-199", "Финансы", "Требует сверки"],
  ];
  await env.DB.batch(entitySeeds.map((row) => env.DB.prepare(
    "INSERT OR IGNORE INTO entities (id, entity_type, display_name, source_system, source_record_id, scope, data_quality, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'system-seed')"
  ).bind(...row)));
  await env.DB.batch([
    env.DB.prepare("UPDATE entities SET entity_type = 'Юрлицо', display_name = 'ООО «АртХелло» · тест', data_quality = 'Проверено' WHERE id = 'ORG-T-001' AND created_by = 'system-seed'"),
    env.DB.prepare("UPDATE entities SET display_name = 'Семья №0014', data_quality = 'Проверено' WHERE id = 'FAM-T-014' AND created_by = 'system-seed' AND display_name = 'Семья T-014'"),
    env.DB.prepare("UPDATE entities SET display_name = 'Педагог №0032', source_system = 'XLSX_MASKED', source_record_id = 'PAYROLL-ROW-T-032', data_quality = 'Требует сверки' WHERE id = 'EMP-T-032' AND created_by = 'system-seed' AND display_name = 'Сотрудник T-032 · педагог'"),
  ]);

  const linkSeeds = [
    ["FAM-T-014", "CHD-T-014", "Семья → ребёнок"],
    ["CLI-T-014", "FAM-T-014", "Клиентская карточка семьи"],
    ["FAM-GROUP-T", "FAM-T-014", "Тестовый пример семьи · не детализация XLSX"],
    ["CHD-T-014", "SVC-T-001", "Получает услугу"],
    ["EMP-T-032", "UNT-T-001", "Работает в подразделении"],
    ["UNT-T-001", "ORG-T-001", "Входит в юрлицо"],
    ["OBJ-T-001", "ORG-T-001", "Принадлежит юрлицу"],
    ["PRJ-T-001", "ORG-T-001", "Проект юрлица"],
    ["SUP-T-001", "SVC-T-001", "Поставляет для услуги"],
  ];
  await env.DB.batch(linkSeeds.map((row) => env.DB.prepare(
    "INSERT OR IGNORE INTO entity_links (from_entity_id, to_entity_id, relation_type, created_by) VALUES (?, ?, ?, 'system-seed')"
  ).bind(...row)));

  const documentSeeds = [
    ["FAM-T-014", "DOG-T-2026-014", "Договор с семьёй", "Актуален", "2027-08-31", "SYNTHETIC"],
    ["EMP-T-032", "EMP-DOG-T-032", "Трудовой договор", "На проверке", "", "XLSX_MASKED"],
    ["ORG-T-001", "ORG-CARD-T-001", "Карточка юрлица", "Актуален", "", "SYNTHETIC"],
  ];
  await env.DB.batch(documentSeeds.map((row) => env.DB.prepare(
    "INSERT INTO entity_documents (entity_id, title, document_type, status, valid_until, source, created_by) SELECT ?, ?, ?, ?, ?, ?, 'system-seed' WHERE NOT EXISTS (SELECT 1 FROM entity_documents WHERE entity_id = ? AND title = ?)"
  ).bind(...row, row[0], row[1])));
}

async function seedWorkflow() {
  await env.DB.prepare("INSERT OR IGNORE INTO entities (id, entity_type, display_name, source_system, source_record_id, scope, data_quality, created_by) VALUES ('EMP-T-004', 'Сотрудник', 'Администратор системы №4', 'SYNTHETIC', 'EMP-SRC-T-004', 'Управляющая компания', 'Проверено', 'system-seed')").run();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO workflow_documents (id, title, document_type, current_version, status, valid_until, owner_entity_id, source, created_by) VALUES ('DOG-T-2026-044', 'Договор с подрядчиком', 'Договор', 2, 'Истекает', '2026-09-02', 'EMP-T-004', 'SYNTHETIC', 'system-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO document_versions (document_id, version, note, reference, created_by) VALUES ('DOG-T-2026-044', 1, 'Исходная версия договора', 'Карточка договора · версия 1', 'system-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO document_versions (document_id, version, note, reference, created_by) VALUES ('DOG-T-2026-044', 2, 'Дополнительное соглашение · тест', 'Дополнительное соглашение · версия 2', 'system-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO obligations (document_id, title, due_date, owner_entity_id, status, warning_days, created_by) VALUES ('DOG-T-2026-044', 'Продлить или закрыть договор', '2026-09-02', 'EMP-T-004', 'Открыто', 30, 'system-seed')"),
  ]);

  await env.DB.prepare(`INSERT OR IGNORE INTO tasks (
    title, owner, due_date, priority, status, source_type, source_id, description,
    assignee_entity_id, kind, automation_key, requires_approval, created_by
  ) VALUES (
    'Продлить или закрыть договор №0044', 'Администратор системы', '2026-08-28',
    'Высокий', 'Входящие', 'Обязательство договора', 'DOG-T-2026-044',
    'Срок договора истекает 02.09.2026. Проверить обязательства, согласовать решение и сохранить результат.',
    'EMP-T-004', 'Автозадача', 'CONTRACT_EXPIRY:DOG-T-2026-044', 1, 'system-automation'
  )`).run();

  const autoTask = await env.DB.prepare("SELECT id FROM tasks WHERE automation_key = 'CONTRACT_EXPIRY:DOG-T-2026-044'").first<{ id: number }>();
  if (!autoTask) return;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO task_watchers (task_id, entity_id, created_by) VALUES (?, 'ROLE:DIRECTOR', 'system-automation')").bind(autoTask.id),
    env.DB.prepare("INSERT OR IGNORE INTO task_approvals (task_id, step_name, status) VALUES (?, 'Решение руководителя', 'Ожидает')").bind(autoTask.id),
    env.DB.prepare("INSERT INTO task_checklist (task_id, title, created_by) SELECT ?, 'Проверить условия продления', 'system-automation' WHERE NOT EXISTS (SELECT 1 FROM task_checklist WHERE task_id = ? AND title = 'Проверить условия продления')").bind(autoTask.id, autoTask.id),
    env.DB.prepare("INSERT INTO task_checklist (task_id, title, created_by) SELECT ?, 'Согласовать решение с руководителем', 'system-automation' WHERE NOT EXISTS (SELECT 1 FROM task_checklist WHERE task_id = ? AND title = 'Согласовать решение с руководителем')").bind(autoTask.id, autoTask.id),
    env.DB.prepare("INSERT INTO task_checklist (task_id, title, created_by) SELECT ?, 'Зафиксировать новую версию документа', 'system-automation' WHERE NOT EXISTS (SELECT 1 FROM task_checklist WHERE task_id = ? AND title = 'Зафиксировать новую версию документа')").bind(autoTask.id, autoTask.id),
    env.DB.prepare("INSERT OR IGNORE INTO task_documents (task_id, document_id, created_by) VALUES (?, 'DOG-T-2026-044', 'system-automation')").bind(autoTask.id),
    env.DB.prepare("INSERT OR IGNORE INTO notifications (recipient_entity_id, notification_type, title, body, source_type, source_id, status, dedup_key) VALUES ('ROLE:DIRECTOR', 'Срок обязательства', 'Договор №0044 истекает через 12 дней', 'Требуется решение о продлении или закрытии договора №0044.', 'document', 'DOG-T-2026-044', 'Новое', 'CONTRACT_EXPIRY:DOG-T-2026-044:DIRECTOR')"),
    env.DB.prepare("INSERT OR IGNORE INTO escalations (task_id, level, reason, status, recipient_entity_id) VALUES (?, 1, 'До срока договора меньше 14 дней', 'Открыта', 'ROLE:DIRECTOR')").bind(autoTask.id),
    env.DB.prepare("INSERT INTO audit_events (actor, action, entity_type, entity_id, payload) SELECT 'system-automation', 'task.auto_created', 'task', CAST(? AS TEXT), '{\"sourceId\":\"DOG-T-2026-044\",\"rule\":\"contract_expiry\"}' WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action = 'task.auto_created' AND entity_type = 'task' AND entity_id = CAST(? AS TEXT))").bind(autoTask.id, autoTask.id),
  ]);
  await env.DB.batch([
    env.DB.prepare("UPDATE entities SET display_name='Администратор системы №4' WHERE id='EMP-T-004' AND created_by='system-seed' AND display_name='Администратор T-004'"),
    env.DB.prepare("UPDATE workflow_documents SET title='Договор с подрядчиком' WHERE id='DOG-T-2026-044' AND created_by='system-seed' AND title='Договор с подрядчиком · тест'"),
    env.DB.prepare("UPDATE document_versions SET reference='Карточка договора · версия 1' WHERE document_id='DOG-T-2026-044' AND version=1 AND created_by='system-seed' AND reference='SYNTHETIC:DOG-T-2026-044:v1'"),
    env.DB.prepare("UPDATE document_versions SET reference='Дополнительное соглашение · версия 2' WHERE document_id='DOG-T-2026-044' AND version=2 AND created_by='system-seed' AND reference='SYNTHETIC:DOG-T-2026-044:v2'"),
    env.DB.prepare("UPDATE tasks SET title='Продлить или закрыть договор №0044' WHERE automation_key='CONTRACT_EXPIRY:DOG-T-2026-044' AND created_by='system-automation' AND title='Продлить или закрыть договор DOG-T-2026-044'"),
    env.DB.prepare("UPDATE tasks SET owner='Администратор системы' WHERE automation_key='CONTRACT_EXPIRY:DOG-T-2026-044' AND created_by='system-automation' AND owner='Администратор T-004'"),
    env.DB.prepare("UPDATE notifications SET title='Договор №0044 истекает через 12 дней' WHERE dedup_key='CONTRACT_EXPIRY:DOG-T-2026-044:DIRECTOR' AND title='Договор истекает через 12 дней'"),
    env.DB.prepare("UPDATE notifications SET body='Требуется решение о продлении или закрытии договора №0044.' WHERE dedup_key='CONTRACT_EXPIRY:DOG-T-2026-044:DIRECTOR' AND body='DOG-T-2026-044: требуется решение о продлении или закрытии.'"),
  ]);
}

type FinanceSeedLine = {
  row: number;
  category: string;
  amounts: number[];
  reportClass: string;
  counterparty: string;
  contract: string;
  document: string;
  cfr?: string;
};

async function seedFinance() {
  const periods = ["2026-01", "2026-02", "2026-03", "2026-04"];
  const periodDates = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"];
  const periodColumns = ["B", "C", "D", "E"];
  const receiptTotals = [6576895, 7383710, 8189741.5, 11380450];
  const outflowTotals = [6748348.21, 8064360.08, 8565774, 7500221.05];
  const receipts: FinanceSeedLine[] = [
    { row: 5, category: "Внереализационные доходы", amounts: [0, 500, 750, 0], reportClass: "Доходы ОПиУ", counterparty: "CTR-T-107", contract: "", document: "DOC-T-NONOP" },
    { row: 6, category: "Возврат средств", amounts: [195, 0, 0, 0], reportClass: "Не включено в ОПиУ", counterparty: "CTR-T-108", contract: "", document: "DOC-T-REFUND" },
    { row: 10, category: "Доходы будущих периодов", amounts: [455000, 1564000, 1989680.5, 4163600], reportClass: "Доходы ОПиУ", counterparty: "FAM-GROUP-T", contract: "DOG-GROUP-T", document: "REG-PAY-T" },
    { row: 12, category: "Доходы будущих периодов · пособия", amounts: [0, 0, 0, 150000], reportClass: "Доходы ОПиУ", counterparty: "FAM-GROUP-T", contract: "DOG-GROUP-T", document: "REG-AID-T" },
    { row: 13, category: "Детский сад и развивающий центр", amounts: [6120480, 5813870, 6186361, 6257785], reportClass: "Доходы ОПиУ", counterparty: "FAM-GROUP-T", contract: "DOG-GROUP-T", document: "REG-PAY-T" },
    { row: 23, category: "Питание в детском саду", amounts: [1220, 4840, 12950, 9065], reportClass: "Доходы ОПиУ", counterparty: "FAM-GROUP-T", contract: "DOG-GROUP-T", document: "REG-FOOD-T" },
    { row: 28, category: "Прочие доходы", amounts: [0, 500, 0, 700000], reportClass: "Доходы ОПиУ", counterparty: "CTR-T-107", contract: "", document: "DOC-T-OTHER" },
    { row: 31, category: "Возврат займа", amounts: [0, 0, 0, 100000], reportClass: "Финансирование", counterparty: "CTR-T-104", contract: "DOG-T-LOAN", document: "DOC-T-LOAN" },
  ];
  const outflows: FinanceSeedLine[] = [
    { row: 35, category: "Аренда", amounts: [451734.6, 500000, 500000, 502000], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-101", contract: "DOG-T-RENT", document: "ACT-T-RENT" },
    { row: 36, category: "Аренда бассейна", amounts: [0, 100000, 100000, 150000], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-102", contract: "DOG-T-POOL", document: "ACT-T-POOL" },
    { row: 38, category: "Банковское обслуживание", amounts: [62874.18, 67899.88, 62544, 63910], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-103", contract: "DOG-T-BANK", document: "BANK-FEE-T" },
    { row: 43, category: "Возврат займа", amounts: [130000, 130000, 130440, 130440], reportClass: "Финансирование", counterparty: "CTR-T-104", contract: "DOG-T-LOAN", document: "DOC-T-LOAN" },
    { row: 46, category: "Дивиденды и лизинг", amounts: [186238.03, 186237.4, 195000, 186237.4], reportClass: "Финансирование", counterparty: "CTR-T-105", contract: "DEC-T-DIV", document: "DEC-T-DIV" },
    { row: 54, category: "Заработная плата", amounts: [3606785, 4171025.09, 3713833, 3908271.44], reportClass: "Расходы ОПиУ", counterparty: "EMP-GROUP-T", contract: "PAYROLL-T", document: "PAYROLL-T-2026" },
    { row: 62, category: "Маркетинг", amounts: [0, 112420, 61165, 224302], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-106", contract: "DOG-T-MKT", document: "ACT-T-MKT" },
    { row: 66, category: "Налоги за сотрудников", amounts: [622201.64, 63989.81, 1383168.5, 714776.06], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-109", contract: "", document: "TAX-T-PAYROLL" },
    { row: 73, category: "Продукты", amounts: [611406.74, 357541.64, 542143, 664882.49], reportClass: "Расходы ОПиУ", counterparty: "SUP-T-001", contract: "DOG-T-FOOD", document: "ACT-T-FOOD" },
    { row: 78, category: "Содержание объектов", amounts: [95233.42, 571839.78, 277666.5, 0], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-110", contract: "DOG-T-FACILITY", document: "ACT-T-FACILITY" },
    { row: 87, category: "Расходы по деятельности", amounts: [465659.94, 132044.37, 221054, 155398.66], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-111", contract: "REQ-T-ACTIVITY", document: "ACT-T-ACTIVITY" },
    { row: 104, category: "Управляющая компания", amounts: [316000, 433000, 415600, 363200], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-112", contract: "DOG-T-MANAGEMENT", document: "ACT-T-MANAGEMENT", cfr: "CFR-T-002" },
    { row: 106, category: "Связь и интернет", amounts: [34000, 34400, 11000, 59800], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-113", contract: "DOG-T-COMMS", document: "ACT-T-COMMS" },
    { row: 107, category: "Финансовая деятельность", amounts: [1500, 921000, 680000, 250000], reportClass: "Финансирование", counterparty: "CTR-T-114", contract: "DOG-T-FIN", document: "DOC-T-FIN" },
  ];

  const operations: Array<Record<string, string | number>> = [];
  for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
    let operationIndex = 1;
    const add = (line: FinanceSeedLine, direction: string, amount: number, sourceRef?: string, status = "Разнесено") => {
      if (!amount) return;
      operations.push({
        id: `FIN-${periods[periodIndex]}-${direction === "Поступление" ? "IN" : "OUT"}-${String(operationIndex).padStart(3, "0")}`,
        operationDate: periodDates[periodIndex], period: periods[periodIndex], direction,
        amountMinor: Math.round(amount * 100), category: line.category, reportClass: line.reportClass,
        counterparty: line.counterparty, contract: line.contract, document: line.document,
        project: line.cfr === "CFR-T-002" ? "PRJ-T-001" : "PRJ-T-004", legal: "ORG-T-001",
        object: line.cfr === "CFR-T-002" ? "OBJ-T-001" : "OBJ-T-002", cfr: line.cfr ?? "CFR-T-001",
        bankRef: `BANK-TEST-${periods[periodIndex].replace("-", "")}-${String(operationIndex).padStart(3, "0")}`,
        sourceRef: sourceRef ?? `${periodColumns[periodIndex]}${line.row}`, status,
      });
      operationIndex += 1;
    };
    receipts.forEach((line) => add(line, "Поступление", line.amounts[periodIndex]));
    outflows.forEach((line) => add(line, "Списание", line.amounts[periodIndex]));
    const mappedOutflow = outflows.reduce((sum, line) => sum + line.amounts[periodIndex], 0);
    const residual = Math.round((outflowTotals[periodIndex] - mappedOutflow) * 100) / 100;
    add({ row: 34, category: "Прочие детализированные списания", amounts: [], reportClass: "Расходы ОПиУ", counterparty: "CTR-T-199", contract: "", document: "REG-ODDS-T" }, "Списание", residual, `${periodColumns[periodIndex]}34:${periodColumns[periodIndex]}110 · остаток после детализированных статей`, "Требует разнесения");
  }

  await env.DB.batch(operations.map((operation) => env.DB.prepare(`INSERT OR IGNORE INTO financial_operations (
    id, operation_date, period, direction, amount_minor, category, report_class, counterparty_entity_id,
    contract_id, document_id, project_entity_id, legal_entity_id, object_entity_id, cfr_entity_id,
    bank_operation_ref, operation_kind, source_system, source_file, source_sheet, source_ref, data_quality, status, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'XLSX_AGGREGATE', 'XLSX_ODDS_READONLY',
    'Атлас ОДДС 01.01.2023-31.01.2026.xlsx', '2026', ?,
    'Факт XLSX подтверждён; ссылка банка является тестовой проекцией до подключения выписки', ?, 'system-finance-seed')`
    ).bind(
      operation.id, operation.operationDate, operation.period, operation.direction, operation.amountMinor,
      operation.category, operation.reportClass, operation.counterparty, operation.contract, operation.document,
      operation.project, operation.legal, operation.object, operation.cfr, operation.bankRef,
      operation.sourceRef, operation.status,
    )));

  const expectedTotals = periods.map((period, index) => ({ period, receiptMinor: Math.round(receiptTotals[index] * 100), outflowMinor: Math.round(outflowTotals[index] * 100) }));
  for (const expected of expectedTotals) {
    const actual = await env.DB.prepare("SELECT direction, SUM(amount_minor) AS total FROM financial_operations WHERE period = ? GROUP BY direction").bind(expected.period).all<{ direction: string; total: number }>();
    const totals = Object.fromEntries((actual.results || []).map((row) => [row.direction, Number(row.total)]));
    if (totals["Поступление"] !== expected.receiptMinor || totals["Списание"] !== expected.outflowMinor) {
      throw new Error(`Finance seed does not reconcile for ${expected.period}`);
    }
  }

  const accrualSeeds = [
    ["ACR-2026-05-SCHOOL", "2026-05", "Школа", "GROUP-T-SCHOOL", 30, 1486900, 1374400, 112500, 2, "Май 2026 · школа"],
    ["ACR-2026-05-KINDER", "2026-05", "Детский сад", "GROUP-T-KINDER", 78, 3255390, 3240390, 15000, 1, "Май 2026 · детский сад"],
    ["ACR-2026-06-CAMP", "2026-06", "Лагерь", "GROUP-T-CAMP", 15, 653100, 452100, 201000, 7, "Июнь 2026 · лагерь"],
    ["ACR-2026-06-KINDER", "2026-06", "Детский сад", "GROUP-T-KINDER", 55, 2365000, 173550, 2191450, 35, "Июнь 2026 · детский сад"],
  ];
  await env.DB.batch(accrualSeeds.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO finance_accruals (
    id, period, contour, subject_entity_id, records_count, accrual_minor, paid_minor, debt_minor, debt_cases,
    source_file, source_sheet, source_ref, data_quality
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Ежемесячные оплаты.xlsx', ?, 'AGGREGATE:PAID+DEBT', 'Обезличенный агрегат; персональные строки не перенесены')`
    ).bind(row[0], row[1], row[2], row[3], row[4], Math.round(Number(row[5]) * 100), Math.round(Number(row[6]) * 100), Math.round(Number(row[7]) * 100), row[8], row[9])));

  const budgetSeeds = [
    ["2026-01", 6700000, 6600000], ["2026-02", 7200000, 7500000], ["2026-03", 8300000, 8100000],
    ["2026-04", 10800000, 7200000], ["2026-05", 9600000, 8000000], ["2026-06", 8900000, 8300000],
  ];
  await env.DB.batch(budgetSeeds.flatMap(([period, income, expense]) => [
    env.DB.prepare("INSERT OR IGNORE INTO finance_budgets (id, period, line, plan_minor, scenario, assumption, source_type, owner_entity_id) VALUES (?, ?, 'Доходы ОПиУ', ?, 'Базовый', 'Тестовый бюджет для проверки план-факта; утверждённый файл бюджета не предоставлен', 'SYNTHETIC_ASSUMPTION', 'ROLE:FINANCE')").bind(`BUD-${period}-IN`, period, Math.round(Number(income) * 100)),
    env.DB.prepare("INSERT OR IGNORE INTO finance_budgets (id, period, line, plan_minor, scenario, assumption, source_type, owner_entity_id) VALUES (?, ?, 'Расходы ОПиУ', ?, 'Базовый', 'Тестовый бюджет для проверки план-факта; утверждённый файл бюджета не предоставлен', 'SYNTHETIC_ASSUMPTION', 'ROLE:FINANCE')").bind(`BUD-${period}-OUT`, period, Math.round(Number(expense) * 100)),
  ]));

  const forecastSeeds = [
    ["FC-T-001", "2026-09-01", "Поступление", 1400000, 70, "Оплаты обучения", "AGGREGATE_FORECAST", "70% от ожидаемых оплат по обезличенному реестру", "GROUP-T-SCHOOL"],
    ["FC-T-002", "2026-09-02", "Списание", 2100000, 100, "Заработная плата", "CALENDAR", "Платёжный календарь · тестовый срок", "EMP-GROUP-T"],
    ["FC-T-003", "2026-09-03", "Поступление", 450000, 60, "Оплаты детского сада", "AGGREGATE_FORECAST", "60% от ожидаемых оплат по обезличенному реестру", "GROUP-T-KINDER"],
    ["FC-T-004", "2026-09-04", "Списание", 600000, 100, "Аренда", "CONTRACT_SCHEDULE", "Договорный график · тестовая проекция", "CTR-T-101"],
    ["FC-T-005", "2026-09-05", "Списание", 820000, 100, "Налоги", "CALENDAR", "Налоговый календарь · тестовая дата", "CTR-T-109"],
    ["FC-T-006", "2026-09-08", "Поступление", 2200000, 65, "Оплаты обучения", "AGGREGATE_FORECAST", "65% от ожидаемых оплат по обезличенному реестру", "GROUP-T-SCHOOL"],
  ];
  await env.DB.batch(forecastSeeds.map((row) => env.DB.prepare("INSERT OR IGNORE INTO finance_forecast_items (id, forecast_date, direction, amount_minor, probability, category, source_type, assumption, linked_entity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(row[0], row[1], row[2], Math.round(Number(row[3]) * 100), row[4], row[5], row[6], row[7], row[8])));

  const payrollSeeds = [
    ["PAY-SUM-2025-09", "2025-09", 3542536.7], ["PAY-SUM-2025-10", "2025-10", 3880831.53],
    ["PAY-SUM-2025-11", "2025-11", 3804982.38], ["PAY-SUM-2025-12", "2025-12", 3978052.82],
    ["PAY-SUM-2026-01", "2026-01", 3620548.32],
  ];
  await env.DB.batch(payrollSeeds.map((row, index) => env.DB.prepare("INSERT OR IGNORE INTO finance_payroll_summary (id, period, amount_minor, scope, source_file, source_sheet, source_ref, data_quality) VALUES (?, ?, ?, 'Группа ArtHello · обезличенный итог', 'Зарплатная ведомость.xlsx', ?, 'SUMMARY:ACCRUALS', 'Агрегат; ФИО и персональные начисления не перенесены')").bind(row[0], row[1], Math.round(Number(row[2]) * 100), `SHEET-${String(index + 17).padStart(3, "0")}`)));

  const issueSeeds = [
    ["FIN-DQ-001", "Реестр оплат отстаёт от текущей даты", "Высокий", "Ежемесячные оплаты.xlsx · июнь 2026", "Текущая дата · август 2026", 0, "ROLE:FINANCE", "Открыто"],
    ["FIN-DQ-002", "Статья ОДДС с ошибочным форматом даты", "Средний", "Атлас ОДДС · лист 2025", "Правило типа данных", 0, "ROLE:FINANCE", "Открыто"],
    ["FIN-REC-003", "Утверждённый источник ОПиУ не предоставлен", "Высокий", "ОДДС · денежный факт", "ОПиУ · источник отсутствует", 0, "ROLE:FINANCE", "Ожидает источник"],
    ["FIN-REC-004", "Банковская выписка не подключена", "Высокий", "ОДДС · апрель 2026", "Точка / Т‑Банк · нет данных", 1138045000, "ROLE:FINANCE", "Ожидает источник"],
    ["FIN-REC-005", "Детальные строки содержания не включены в итог апреля", "Высокий", "ОДДС · 2026 · E79:E85", "ОДДС · 2026 · E78 и E34", 60919538, "ROLE:FINANCE", "Открыто"],
    ["FIN-REC-006", "Чистый поток января не равен поступлениям минус списания", "Высокий", "ОДДС · 2026 · B2 и B34", "ОДДС · 2026 · B111", -13474438, "ROLE:FINANCE", "Открыто"],
    ["FIN-RISK-001", "Прогнозный кассовый разрыв 5 сентября", "Высокий", "Платёжный календарь · тест", "Прогнозный баланс", -47000000, "ROLE:FINANCE", "Открыто"],
  ];
  await env.DB.batch(issueSeeds.map((row) => env.DB.prepare("INSERT OR IGNORE INTO finance_reconciliation_issues (id, title, severity, source_a, source_b, difference_minor, owner_entity_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(...row)));
  await env.DB.prepare("UPDATE finance_reconciliation_issues SET source_b='Точка / Т‑Банк · нет данных' WHERE id='FIN-REC-004' AND source_b='Точка / Альфа-Банк · нет данных'").run();
}

async function seedSales() {
  const entitySeeds = [
    ["EMP-T-SALES-001", "Сотрудник", "Менеджер по продажам №1", "Продажи"],
    ["EMP-T-SALES-002", "Сотрудник", "Менеджер по продажам №2", "Продажи"],
    ["FAM-T-021", "Семья", "Семья №0021", "Детский сад"],
    ["CHD-T-021", "Ребёнок", "Ребёнок №0021", "Детский сад"],
    ["FAM-T-071", "Семья", "Семья №0071", "Дополнительное образование"],
    ["CHD-T-071", "Ребёнок", "Ребёнок №0071", "Дополнительное образование"],
    ["SVC-T-021", "Услуга", "Детский сад · полный день", "Детский сад"],
    ["SVC-T-071", "Услуга", "Театральная студия", "Дополнительное образование"],
  ];
  await env.DB.batch(entitySeeds.map((row, index) => env.DB.prepare(`INSERT OR IGNORE INTO entities (
    id, entity_type, display_name, status, source_system, source_record_id, data_quality, scope, metadata, created_by
  ) VALUES (?, ?, ?, 'Активна', 'SYNTHETIC_SALES_TEST', ?, 'Синтетическая карточка для приёмки этапа 5', ?, '{}', 'system-sales-seed')`)
    .bind(row[0], row[1], row[2], `SALES-ENTITY-${String(index + 1).padStart(3, "0")}`, row[3])));

  const leads = [
    ["LEAD-T-014", "2026-04-02T09:12:00Z", "Яндекс Поиск", "yandex", "cpc", "school_2026", "math_future", "CMP-T-001", "CR-T-011", "OFF-T-001", "FORM-T-SCHOOL", "EMP-T-SALES-001", "Платёж", "Активен", "FAM-T-014", "CHD-T-014", "DOG-T-2026-014", "SVC-T-001", "", '["школа","3 класс","приоритет"]'],
    ["LEAD-T-021", "2026-08-04T11:40:00Z", "VK", "vk", "social", "kindergarten_aug", "open_day", "CMP-T-002", "CR-T-022", "OFF-T-002", "FORM-T-KINDER", "EMP-T-SALES-002", "Договор", "Активен", "FAM-T-021", "CHD-T-021", "DOG-T-2026-021", "SVC-T-021", "", '["детский сад","полный день"]'],
    ["LEAD-T-033", "2026-08-15T08:25:00Z", "Telegram", "telegram", "messenger", "august_referral", "campus_tour", "CMP-T-003", "CR-T-031", "OFF-T-003", "FORM-T-CONSULT", "EMP-T-SALES-001", "Посещение", "Активен", "", "", "", "", "", '["школа","экскурсия"]'],
    ["LEAD-T-041", "2026-08-17T14:05:00Z", "Рекомендация", "referral", "partner", "parent_referral", "family_story", "CMP-T-004", "CR-T-041", "OFF-T-004", "FORM-T-CALLBACK", "EMP-T-SALES-002", "Консультация", "Активен", "", "", "", "", "", '["рекомендация","сад"]'],
    ["LEAD-T-052", "2026-08-20T10:18:00Z", "Сайт", "direct", "organic", "direct_august", "school_landing", "CMP-T-005", "CR-T-052", "OFF-T-001", "FORM-T-SCHOOL", "EMP-T-SALES-001", "Заявка", "Активен", "", "", "", "", "", '["новый","школа"]'],
    ["LEAD-T-063", "2026-08-11T16:30:00Z", "Яндекс Карты", "yandex_maps", "organic", "maps_august", "campus_photo", "CMP-T-006", "CR-T-063", "OFF-T-002", "FORM-T-CALLBACK", "EMP-T-SALES-002", "Консультация", "Закрыт", "", "", "", "", "Стоимость", '["отказ","сад"]'],
    ["LEAD-T-071", "2026-07-01T12:00:00Z", "Instagram", "instagram", "social", "theatre_summer", "stage_video", "CMP-T-007", "CR-T-071", "OFF-T-007", "FORM-T-STUDIO", "EMP-T-SALES-001", "Платёж", "Активен", "FAM-T-071", "CHD-T-071", "DOG-T-2026-071", "SVC-T-071", "", '["студия","повторная продажа"]'],
    ["LEAD-T-080", "2026-08-21T06:45:00Z", "Не определён", "", "", "", "", "", "", "", "", "", "Первый клик", "Активен", "", "", "", "", "", '["без источника"]'],
  ];
  await env.DB.batch(leads.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO sales_leads (
    id, first_click_at, source, utm_source, utm_medium, utm_campaign, utm_content, campaign_id, creative_id,
    offer_id, form_id, manager_entity_id, stage, status, family_entity_id, child_entity_id, contract_id,
    service_entity_id, rejection_reason, tags, data_quality
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Синтетические тестовые данные; персональные данные не используются')`).bind(...row)));

  const touchpoints = [
    ["TP-T-014-01", "LEAD-T-014", "Первый клик", "2026-04-02T09:12:00Z", "Яндекс Поиск", "Входящий", "Переход по объявлению «Будущее математики»", "Страница открыта", "CLICK-T-014"],
    ["TP-T-014-02", "LEAD-T-014", "Форма", "2026-04-02T09:16:00Z", "Сайт", "Входящий", "Форма школы отправлена", "Заявка создана", "FORM-T-SCHOOL:SUB-T-014"],
    ["TP-T-014-03", "LEAD-T-014", "Звонок", "2026-04-02T10:02:00Z", "Телефония · тест", "Исходящий", "Менеджер уточнил запрос семьи", "Консультация назначена", "CALL-T-014"],
    ["TP-T-014-04", "LEAD-T-014", "Переписка", "2026-04-02T10:11:00Z", "Telegram · тест", "Исходящий", "Отправлены программа и маршрут", "Сообщение прочитано", "CHAT-T-014"],
    ["TP-T-014-05", "LEAD-T-014", "Консультация", "2026-04-04T13:00:00Z", "Очно", "Входящий", "Обсуждены программа и условия", "Посещение назначено", "CONSULT-T-014"],
    ["TP-T-014-06", "LEAD-T-014", "Посещение", "2026-04-06T15:00:00Z", "Корпус 1", "Входящий", "Экскурсия и встреча с куратором", "Договор согласован", "VISIT-T-014"],
    ["TP-T-021-01", "LEAD-T-021", "Звонок", "2026-08-04T12:05:00Z", "Телефония · тест", "Исходящий", "Уточнён режим полного дня", "Консультация назначена", "CALL-T-021"],
    ["TP-T-033-01", "LEAD-T-033", "Посещение", "2026-08-20T15:30:00Z", "Учебный комплекс", "Входящий", "Проведена экскурсия", "Ожидает решение", "VISIT-T-033"],
    ["TP-T-041-01", "LEAD-T-041", "Консультация", "2026-08-21T12:00:00Z", "Видео", "Входящий", "Первичная консультация", "Приглашён на посещение", "CONSULT-T-041"],
    ["TP-T-063-01", "LEAD-T-063", "Консультация", "2026-08-12T14:00:00Z", "Телефон", "Входящий", "Обсуждены условия и стоимость", "Отказ: стоимость", "CONSULT-T-063"],
  ];
  await env.DB.batch(touchpoints.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO sales_touchpoints (
    id, lead_id, touchpoint_type, occurred_at, channel, direction, summary, outcome, source_ref, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'system-sales-seed')`).bind(...row)));

  const chainStages = ["Первый клик", "Заявка", "Консультация", "Посещение", "Договор", "Начисление", "Платёж"];
  await env.DB.batch(chainStages.slice(1).map((stage, index) => env.DB.prepare(`INSERT INTO sales_stage_events (
    lead_id, from_stage, to_stage, outcome, reason, actor, occurred_at
  ) SELECT 'LEAD-T-014', ?, ?, 'Успешно', 'Этап подтверждён демонстрационным событием', 'system-sales-seed', ?
    WHERE NOT EXISTS (SELECT 1 FROM sales_stage_events WHERE lead_id = 'LEAD-T-014' AND to_stage = ?)`)
    .bind(chainStages[index], stage, `2026-04-${String(2 + index * 2).padStart(2, "0")}T12:00:00Z`, stage)));

  await env.DB.prepare(`INSERT OR IGNORE INTO financial_operations (
    id, operation_date, period, direction, amount_minor, category, report_class, counterparty_entity_id,
    contract_id, document_id, project_entity_id, legal_entity_id, object_entity_id, cfr_entity_id,
    bank_operation_ref, operation_kind, source_system, source_file, source_sheet, source_ref, data_quality, status, created_by
  ) VALUES (
    'FIN-TEST-CLIENT-014', '2026-08-05', '2026-08', 'Поступление', 8500000,
    'Обучение 1–11 · тестовая клиентская цепочка', 'Доходы ОПиУ', 'FAM-T-014', 'DOG-T-2026-014',
    'PAY-T-014-001', 'PRJ-T-004', 'ORG-T-001', 'OBJ-T-002', 'CFR-T-001', 'BANK-TEST-CLIENT-014',
    'SYNTHETIC_TRACE', 'SYNTHETIC_SALES_TEST', '—', '—', 'Лид №0014 → начисление №0014',
    'Синтетическая операция только для проверки сквозного маршрута; не банковский факт', 'Разнесено', 'system-sales-seed'
  )`).run();

  const accruals = [
    ["ACR-CLIENT-T-014", "FAM-T-014", "CHD-T-014", "DOG-T-2026-014", "SVC-T-001", "2026-08", 8500000, "2026-08-05", "Оплачено", "FIN-TEST-CLIENT-014"],
    ["ACR-CLIENT-T-021", "FAM-T-021", "CHD-T-021", "DOG-T-2026-021", "SVC-T-021", "2026-09", 6400000, "2026-09-05", "Ожидается", ""],
    ["ACR-CLIENT-T-071", "FAM-T-071", "CHD-T-071", "DOG-T-2026-071", "SVC-T-071", "2026-09", 4600000, "2026-09-05", "Ожидается", ""],
  ];
  await env.DB.batch(accruals.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO client_accruals (
    id, family_entity_id, child_entity_id, contract_id, service_entity_id, period, amount_minor, due_date, status, payment_operation_id, source_type
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNTHETIC_SALES_TEST')`).bind(...row)));

  const lifecycles = [
    ["LIFE-T-014", "LEAD-T-014", "FAM-T-014", "CHD-T-014", "DOG-T-2026-014", "SVC-T-001", "ACR-CLIENT-T-014", "FIN-TEST-CLIENT-014", "2026-01-10", 8500000, 68000000, 8, "2026-09-05", 8500000, 18, "Низкий", '["Платежи без просрочки","Активная коммуникация"]', "Серебро", "Театральная студия · пробное занятие", "Активен"],
    ["LIFE-T-021", "LEAD-T-021", "FAM-T-021", "CHD-T-021", "DOG-T-2026-021", "SVC-T-021", "ACR-CLIENT-T-021", "", "2026-06-01", 6400000, 19200000, 3, "2026-09-05", 6400000, 72, "Высокий", '["Есть просрочка","Нет ответа 12 дней"]', "Базовый", "Встреча с куратором и гибкий график", "Требует внимания"],
    ["LIFE-T-071", "LEAD-T-071", "FAM-T-071", "CHD-T-071", "DOG-T-2026-071", "SVC-T-071", "ACR-CLIENT-T-071", "", "2025-09-01", 4600000, 55200000, 12, "2026-09-05", 4600000, 34, "Средний", '["Снижение посещаемости","Оплата в срок"]', "Золото", "Семейный абонемент на второй кружок", "Активен"],
  ];
  await env.DB.batch(lifecycles.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO client_lifecycles (
    id, lead_id, family_entity_id, child_entity_id, contract_id, service_entity_id, accrual_id,
    payment_operation_id, service_start_date, monthly_value_minor, ltv_minor, lifetime_months,
    next_payment_date, next_payment_minor, churn_risk_score, churn_risk_band, churn_risk_factors,
    loyalty_tier, repeat_offer, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...row)));

  const bonuses = [
    ["BON-T-014-01", "FAM-T-014", "Начисление", 850, "Оплата обучения за август", "DOG-T-2026-014", "2026-08-05T10:00:00Z"],
    ["BON-T-014-02", "FAM-T-014", "Списание", -300, "Билет на семейное событие", "DOG-T-2026-014", "2026-08-16T12:00:00Z"],
    ["BON-T-071-01", "FAM-T-071", "Начисление", 1200, "12 месяцев в ArtHello", "DOG-T-2026-071", "2026-08-01T09:00:00Z"],
  ];
  await env.DB.batch(bonuses.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO client_bonuses (
    id, family_entity_id, event_type, points, reason, related_contract_id, occurred_at, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'system-sales-seed')`).bind(...row)));
  await env.DB.batch([
    env.DB.prepare("UPDATE entities SET display_name='Менеджер по продажам №1' WHERE id='EMP-T-SALES-001' AND created_by='system-sales-seed' AND display_name='Менеджер T-01 · продажи'"),
    env.DB.prepare("UPDATE entities SET display_name='Менеджер по продажам №2' WHERE id='EMP-T-SALES-002' AND created_by='system-sales-seed' AND display_name='Менеджер T-02 · продажи'"),
    env.DB.prepare("UPDATE entities SET display_name='Семья №0021' WHERE id='FAM-T-021' AND created_by='system-sales-seed' AND display_name='Семья T-021'"),
    env.DB.prepare("UPDATE entities SET display_name='Ребёнок №0021' WHERE id='CHD-T-021' AND created_by='system-sales-seed' AND display_name='Ребёнок T-021'"),
    env.DB.prepare("UPDATE entities SET display_name='Семья №0071' WHERE id='FAM-T-071' AND created_by='system-sales-seed' AND display_name='Семья T-071'"),
    env.DB.prepare("UPDATE entities SET display_name='Ребёнок №0071' WHERE id='CHD-T-071' AND created_by='system-sales-seed' AND display_name='Ребёнок T-071'"),
    env.DB.prepare("UPDATE entities SET display_name='Семья №0014' WHERE id='FAM-T-014' AND created_by='system-seed' AND display_name='Семья T-014'"),
    env.DB.prepare("UPDATE entities SET display_name='Ребёнок №0014' WHERE id='CHD-T-014' AND created_by='system-seed' AND display_name='Ребёнок T-014'"),
    env.DB.prepare("UPDATE entities SET display_name='Педагог №0032' WHERE id='EMP-T-032' AND created_by='system-seed' AND display_name='Сотрудник T-032 · педагог'"),
    env.DB.prepare("UPDATE entities SET display_name='Обучение 1–11' WHERE id='SVC-T-001' AND created_by='system-seed' AND display_name='Обучение 1–11 · тест'"),
    env.DB.prepare("UPDATE sales_touchpoints SET summary='Переход по объявлению «Будущее математики»' WHERE id='TP-T-014-01' AND created_by='system-sales-seed' AND summary='Переход по объявлению math_future'"),
    env.DB.prepare("UPDATE sales_touchpoints SET outcome='Страница открыта' WHERE id='TP-T-014-01' AND created_by='system-sales-seed' AND outcome='Лендинг открыт'"),
    env.DB.prepare("UPDATE sales_stage_events SET reason='Этап подтверждён демонстрационным событием' WHERE lead_id='LEAD-T-014' AND actor='system-sales-seed' AND reason='Тестовый сквозной маршрут этапа 5'"),
    env.DB.prepare("UPDATE financial_operations SET source_ref='Лид №0014 → начисление №0014' WHERE id='FIN-TEST-CLIENT-014' AND created_by='system-sales-seed' AND source_ref='LEAD-T-014 → ACR-CLIENT-T-014'"),
  ]);
}

async function seedContent() {
  const authors = [
    ["EMP-T-CONTENT-001", "Сотрудник T-C01 · редактор", "Маркетинг"],
    ["EMP-T-CONTENT-002", "Сотрудник T-C02 · автор", "Маркетинг"],
  ];
  await env.DB.batch(authors.map((row, index) => env.DB.prepare(`INSERT OR IGNORE INTO entities (
    id, entity_type, display_name, status, source_system, source_record_id, data_quality, scope, metadata, created_by
  ) VALUES (?, 'Сотрудник', ?, 'Активна', 'SYNTHETIC_CONTENT_TEST', ?, 'Синтетическая карточка автора', ?, '{}', 'system-content-seed')`)
    .bind(row[0], row[1], `CONTENT-AUTHOR-${index + 1}`, row[2])));

  const accounts = [
    ["ACC-T-VK", "VK", "ArtHello · VK · тест", "Активен", 12840],
    ["ACC-T-TG", "Telegram", "ArtHello · Telegram · тест", "Активен", 4210],
    ["ACC-T-IG", "Instagram", "ArtHello · Instagram · тест", "Активен", 18220],
    ["ACC-T-YT", "YouTube", "ArtHello · YouTube · тест", "На проверке", 2860],
  ];
  await env.DB.batch(accounts.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO marketing_accounts (
    id, platform, display_name, status, audience_count, source_type
  ) VALUES (?, ?, ?, ?, ?, 'SYNTHETIC_CONTENT_TEST')`).bind(...row)));

  const plan = [
    ["PLAN-T-071", "2026-07-01T09:00:00Z", "ACC-T-IG", "EMP-T-CONTENT-002", "Короткое видео", "Театр помогает говорить увереннее", "OFF-T-007", "CMP-T-007", "Опубликовано", "История занятия, один ясный оффер и ссылка с UTM"],
    ["PLAN-T-102", "2026-08-05T12:00:00Z", "ACC-T-VK", "EMP-T-CONTENT-001", "Карусель", "Как выбрать школу без лишней тревоги", "OFF-T-001", "CMP-T-102", "Опубликовано", "Пять проверяемых вопросов для семьи"],
    ["PLAN-T-103", "2026-08-10T10:00:00Z", "ACC-T-TG", "EMP-T-CONTENT-001", "Лонгрид", "Первый месяц в детском саду", "OFF-T-002", "CMP-T-103", "Опубликовано", "Практический чек-лист адаптации"],
    ["PLAN-T-104", "2026-08-15T17:00:00Z", "ACC-T-YT", "EMP-T-CONTENT-002", "Видео", "Экскурсия по учебному комплексу", "OFF-T-003", "CMP-T-104", "Опубликовано", "Маршрут по пространству и ответы педагогов"],
    ["PLAN-T-105", "2026-08-24T09:30:00Z", "ACC-T-IG", "EMP-T-CONTENT-002", "Короткое видео", "Проектная неделя глазами ребёнка", "OFF-T-001", "CMP-T-105", "На согласовании", "Доказуемый результат вместо общего обещания"],
    ["PLAN-T-106", "2026-08-26T12:00:00Z", "ACC-T-TG", "EMP-T-CONTENT-001", "Пост", "Ответы на вопросы о наборе", "OFF-T-001", "CMP-T-106", "Черновик", "Собрать реальные вопросы из звонков продаж"],
  ];
  await env.DB.batch(plan.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO content_plan_items (
    id, scheduled_at, account_id, author_entity_id, format, topic, offer_id, campaign_id, status, brief, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system-content-seed')`).bind(...row)));

  const publications = [
    ["PUB-T-071", "PLAN-T-071", "2026-07-01T09:03:00Z", "POST-TEST-IG-071", 12400, 9800, 740, 310, 12, 1, 4600000],
    ["PUB-T-102", "PLAN-T-102", "2026-08-05T12:02:00Z", "POST-TEST-VK-102", 8900, 11400, 520, 96, 5, 0, 0],
    ["PUB-T-103", "PLAN-T-103", "2026-08-10T10:01:00Z", "POST-TEST-TG-103", 3650, 4200, 310, 142, 7, 0, 0],
    ["PUB-T-104", "PLAN-T-104", "2026-08-15T17:05:00Z", "VIDEO-TEST-YT-104", 5100, 8300, 455, 61, 2, 0, 0],
  ];
  await env.DB.batch(publications.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO content_publications (
    id, plan_item_id, published_at, publication_ref, reach, views, reactions, clicks, leads, contracts,
    revenue_minor, source_type, data_quality
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNTHETIC_CONTENT_TEST', 'Синтетические метрики; Продвижение.xlsx и API соцсетей не предоставлены')`).bind(...row)));

  await env.DB.prepare(`INSERT OR IGNORE INTO financial_operations (
    id, operation_date, period, direction, amount_minor, category, report_class, counterparty_entity_id,
    contract_id, document_id, project_entity_id, legal_entity_id, object_entity_id, cfr_entity_id,
    bank_operation_ref, operation_kind, source_system, source_file, source_sheet, source_ref, data_quality, status, created_by
  ) VALUES (
    'FIN-TEST-CONTENT-071', '2026-08-07', '2026-08', 'Поступление', 4600000,
    'Театральная студия · тестовая контент-атрибуция', 'Доходы ОПиУ', 'FAM-T-071', 'DOG-T-2026-071',
    'PAY-T-071-001', 'PRJ-T-004', 'ORG-T-001', 'OBJ-T-002', 'CFR-T-001', 'BANK-TEST-CONTENT-071',
    'SYNTHETIC_TRACE', 'SYNTHETIC_CONTENT_TEST', '—', '—', 'PUB-T-071 → LEAD-T-071 → ACR-CLIENT-T-071',
    'Синтетическая операция для проверки контент-атрибуции; не банковский факт', 'Разнесено', 'system-content-seed'
  )`).run();
  await env.DB.batch([
    env.DB.prepare("UPDATE client_lifecycles SET payment_operation_id = 'FIN-TEST-CONTENT-071', updated_at = CURRENT_TIMESTAMP WHERE lead_id = 'LEAD-T-071' AND payment_operation_id = ''"),
    env.DB.prepare("UPDATE client_accruals SET payment_operation_id = 'FIN-TEST-CONTENT-071', status = 'Оплачено' WHERE id = 'ACR-CLIENT-T-071' AND payment_operation_id = ''"),
  ]);

  await env.DB.prepare(`INSERT OR IGNORE INTO content_attributions (
    id, publication_id, click_id, lead_id, contract_id, payment_operation_id, revenue_minor, attribution_model
  ) VALUES ('ATTR-T-071', 'PUB-T-071', 'CLICK-T-071', 'LEAD-T-071', 'DOG-T-2026-071', 'FIN-TEST-CONTENT-071', 4600000, 'Первый клик · тест')`).run();

  const recommendations = [
    ["REC-CONT-T-001", "PUB-T-071", "Выручка", "1 договор и 46 000 ₽ тестовой выручки при 310 кликах", "Повторить тему в VK и Telegram, сохранив оффер и UTM"],
    ["REC-CONT-T-002", "PUB-T-104", "Низкий CTR", "8 300 просмотров и только 61 переход", "Проверить первые 10 секунд, CTA и ссылку; не оценивать видео только по просмотрам"],
    ["REC-CONT-T-003", "PUB-T-102", "Нет договоров", "5 заявок, договоров и выручки пока нет", "Передать продажи менеджеру и проверить качество лидов до масштабирования"],
  ];
  await env.DB.batch(recommendations.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO content_recommendations (
    id, publication_id, signal_type, evidence, recommendation, status
  ) VALUES (?, ?, ?, ?, ?, 'Новая')`).bind(...row)));
}

async function seedEducation() {
  const entitiesToAdd = [
    ["EMP-T-METHOD-001","Сотрудник","Методист T-M01","Методический центр"],["EMP-T-041","Сотрудник","Педагог T-041","Школа 1–11"],
    ["FAM-T-015","Семья","Семья T-015","Школа 1–11"],["CHD-T-015","Ребёнок","Ребёнок T-015","3А · тестовая группа"],
    ["FAM-T-016","Семья","Семья T-016","Школа 1–11"],["CHD-T-016","Ребёнок","Ребёнок T-016","3А · тестовая группа"],
  ];
  await env.DB.batch(entitiesToAdd.map((row,index)=>env.DB.prepare(`INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES (?,?,?,'Активна','SYNTHETIC_EDUCATION_TEST',?,'Синтетическая карточка без персональных данных',?,'{}','system-education-seed')`).bind(row[0],row[1],row[2],`EDU-ENTITY-${index+1}`,row[3])));
  const programs=[
    ["PRG-T-012","Математика · 3 класс",4,"Действует","EMP-T-032","EMP-T-METHOD-001","3А","MATERIAL-T-MATH-4","Решает составные задачи и объясняет ход решения"],
    ["PRG-T-019","Проектная лаборатория",2,"На пересмотре","EMP-T-041","EMP-T-METHOD-001","3А–5Б","MATERIAL-T-PROJECT-2","Планирует командный проект и представляет результат"],
  ];
  await env.DB.batch(programs.map(row=>env.DB.prepare(`INSERT OR IGNORE INTO education_programs (id,title,version,status,author_entity_id,methodist_entity_id,scope,material_ref,expected_result,source_type) VALUES (?,?,?,?,?,?,?,?,?,'SYNTHETIC_EDUCATION_TEST')`).bind(...row)));
  const groups=[["GRP-T-3A","3А · тестовая группа","UNT-T-001","PRG-T-012","EMP-T-032","Кабинет 12","Активна"],["GRP-T-LAB","Проектная группа · тест","UNT-T-001","PRG-T-019","EMP-T-041","Лаборатория","Активна"]];
  await env.DB.batch(groups.map(row=>env.DB.prepare("INSERT OR IGNORE INTO education_groups (id,name,unit_entity_id,program_id,teacher_entity_id,room,status) VALUES (?,?,?,?,?,?,?)").bind(...row)));
  const students=[["STU-T-014","CHD-T-014","FAM-T-014","GRP-T-3A","Активен","Обучается"],["STU-T-015","CHD-T-015","FAM-T-015","GRP-T-3A","Активен","Обучается"],["STU-T-016","CHD-T-016","FAM-T-016","GRP-T-3A","Приглашение отправлено","Обучается"]];
  await env.DB.batch(students.map(row=>env.DB.prepare("INSERT OR IGNORE INTO education_students (id,child_entity_id,family_entity_id,group_id,cabinet_status,status) VALUES (?,?,?,?,?,?)").bind(...row)));
  const lessons=[
    ["LES-T-3A-0821","GRP-T-3A","PRG-T-012","2026-08-21T09:00:00Z","Составная задача: модель и объяснение","EMP-T-032","","Кабинет 12","Завершено","№ 18–20; объяснить решение одной задачи"],
    ["LES-T-3A-0824","GRP-T-3A","PRG-T-012","2026-08-24T09:00:00Z","Проверка гипотезы в задаче","EMP-T-032","EMP-T-041","Кабинет 12","Запланировано",""],
    ["LES-T-LAB-0821","GRP-T-LAB","PRG-T-019","2026-08-21T11:30:00Z","Роли в проектной команде","EMP-T-041","","Лаборатория","Завершено","Сформулировать личный вклад"],
  ];
  await env.DB.batch(lessons.map(row=>env.DB.prepare("INSERT OR IGNORE INTO education_lessons (id,group_id,program_id,scheduled_at,topic,teacher_entity_id,substitute_entity_id,room,status,homework) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const attendance=[
    ["ATT-T-014","LES-T-3A-0821","STU-T-014","Присутствовал","5","Самостоятельно построил модель","EMP-T-032"],
    ["ATT-T-015","LES-T-3A-0821","STU-T-015","Присутствовал","4","Нужна подсказка на втором шаге","EMP-T-032"],
    ["ATT-T-016","LES-T-3A-0821","STU-T-016","Отсутствовал","","Результат не фиксировался","EMP-T-032"],
  ];
  await env.DB.batch(attendance.map(row=>env.DB.prepare("INSERT OR IGNORE INTO education_attendance (id,lesson_id,student_id,attendance_status,grade,result,recorded_by) VALUES (?,?,?,?,?,?,?)").bind(...row)));
  const progress=[["PROG-T-014","STU-T-014","PRG-T-012","3 квартал 2026","Решение составных задач",86,"Рост","Посещаемость и проверочная работа №0004"],["PROG-T-015","STU-T-015","PRG-T-012","3 квартал 2026","Решение составных задач",68,"Стабильно","Посещаемость и проверочная работа №0004"],["PROG-T-016","STU-T-016","PRG-T-012","3 квартал 2026","Решение составных задач",52,"Требует данных","Одно занятие пропущено; недостаточно наблюдений"]];
  await env.DB.batch(progress.map(row=>env.DB.prepare("INSERT OR IGNORE INTO education_progress (id,student_id,program_id,period,metric,score,trend,evidence) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
  const feedback=[["FDB-T-014","STU-T-014","FAM-T-014","PRG-T-012",5,"Ребёнок стал спокойнее объяснять решение","Добавить парное объяснение в следующую версию","Новая"],["FDB-T-015","STU-T-015","FAM-T-015","PRG-T-012",3,"Домашнее задание заняло больше часа","Разделить задание на обязательную и дополнительную части","Требует проверки"]];
  await env.DB.batch(feedback.map(row=>env.DB.prepare("INSERT OR IGNORE INTO education_feedback (id,student_id,family_entity_id,program_id,rating,comment,recommendation,status) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
  const comms=[["COM-T-NEWS-01","Новость","Группа","GRP-T-3A","Неделя математики","В пятницу покажем проекты и решения семейным командам.","","EMP-T-032"],["COM-T-EVT-01","Событие","Группа","GRP-T-3A","Открытая лаборатория","Практическая встреча для детей и родителей.","2026-08-28T16:00:00Z","EMP-T-041"],["COM-T-CHAT-01","Чат","Семья","FAM-T-014","Ответ по домашнему заданию","Подтверждено: достаточно выполнить обязательную часть.","","EMP-T-032"]];
  await env.DB.batch(comms.map(row=>env.DB.prepare("INSERT OR IGNORE INTO education_communications (id,communication_type,audience_type,audience_id,title,body,event_at,created_by) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
}

async function seedHr() {
  const people = [
    ["CAND-T-008","Кандидат","Кандидат T-008","Неактивна","CANDIDATE-008","HR"],
    ["CAND-T-019","Кандидат","Кандидат T-019","Активна","CANDIDATE-019","HR"],
    ["CAND-T-027","Кандидат","Кандидат T-027","Неактивна","CANDIDATE-027","HR"],
    ["EMP-T-052","Сотрудник","Сотрудник T-052 · педагог","Неактивна","EMPLOYEE-052","Школа 1–11"],
    ["EMP-T-063","Сотрудник","Сотрудник T-063 · куратор","Активна","EMPLOYEE-063","Школа 1–11"],
    ["EMP-T-HR-001","Сотрудник","HR T-H01","Активна","EMPLOYEE-HR-001","HR"],
  ];
  await env.DB.batch(people.map(row=>env.DB.prepare(`INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES (?,?,?,?,'SYNTHETIC_HR_TEST',?,'Синтетическая карточка без персональных данных',?,'{}','system-hr-seed')`).bind(...row)));
  const vacancies=[
    ["VAC-T-008","Педагог начальной школы","Школа 1–11","POS-T-TEACHER",1,"Закрыта"],
    ["VAC-T-019","Куратор класса","Школа 1–11","POS-T-CURATOR",1,"В работе"],
    ["VAC-T-027","Методист","Методический центр","POS-T-METHODIST",1,"Черновик"],
  ];
  await env.DB.batch(vacancies.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_vacancies (id,title,unit,position_id,headcount,status,source_type) VALUES (?,?,?,?,?,?,'SYNTHETIC_HR_TEST')").bind(...row)));
  const candidates=[
    ["CANDREC-T-008","CAND-T-008","VAC-T-008","Рекомендация","Сотрудник",88,"Нанят","","Принят","Интервью INTV-T-008, решение HR-DEC-T-008"],
    ["CANDREC-T-019","CAND-T-019","VAC-T-019","hh.ru · тест","Интервью",74,"","","","Скрининг пройден, интервью назначено"],
    ["CANDREC-T-027","CAND-T-027","VAC-T-008","Сайт · тест","Отсев",52,"Не продолжать","Недостаточно подтверждённого опыта","","Решение основано на матрице интервью, не на ИИ"],
  ];
  await env.DB.batch(candidates.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_candidates (id,entity_id,vacancy_id,source,stage,score,decision,rejection_reason,offer_status,evidence) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const interviews=[
    ["INTV-T-008","CANDREC-T-008","2026-02-03T10:00:00Z","EMP-T-HR-001",88,"Кейс и структурированное интервью пройдены; рекомендации проверены","Рекомендовать оффер"],
    ["INTV-T-019","CANDREC-T-019","2026-08-25T11:00:00Z","EMP-T-HR-001",74,"Скрининг пройден, кейс ожидается","Продолжить"],
    ["INTV-T-027","CANDREC-T-027","2026-08-14T13:00:00Z","EMP-T-HR-001",52,"Не подтверждён обязательный опыт работы по программе","Отсев"],
  ];
  await env.DB.batch(interviews.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_interviews (id,candidate_id,scheduled_at,interviewer_entity_id,score,summary,decision) VALUES (?,?,?,?,?,?,?)").bind(...row)));
  const employees=[
    ["EMP-T-052","CANDREC-T-008","DOG-EMP-T-052","POS-T-TEACHER","Школа 1–11",9500000,"2026-02-16","Уволен","2026-08-15","Соглашение сторон","Отозван"],
    ["EMP-T-063","","DOG-EMP-T-063","POS-T-CURATOR","Школа 1–11",8200000,"2026-06-01","Работает","","","Активен"],
  ];
  await env.DB.batch(employees.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_employees (id,candidate_id,contract_id,position_id,unit,rate_minor,hire_date,status,termination_date,termination_reason,access_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO workflow_documents (id,title,document_type,current_version,status,valid_until,owner_entity_id,source,created_by) VALUES ('DOG-EMP-T-052','Трудовой договор · сотрудник T-052','Трудовой договор',1,'Завершён','2026-08-15','EMP-T-052','SYNTHETIC_HR_TEST','system-hr-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO workflow_documents (id,title,document_type,current_version,status,valid_until,owner_entity_id,source,created_by) VALUES ('DOG-EMP-T-063','Трудовой договор · сотрудник T-063','Трудовой договор',1,'Актуален','2027-05-31','EMP-T-063','SYNTHETIC_HR_TEST','system-hr-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO tasks (title,owner,due_date,priority,status,source_type,source_id,description,assignee_entity_id,kind,automation_key,requires_approval,result,result_evidence,completed_at,created_by) VALUES ('Адаптация сотрудника T-052','HR T-H01','2026-03-16','Высокий','Выполнено','Онбординг','EMP-T-052','Рабочее место, доступы, наставник и вводное обучение','EMP-T-HR-001','HR-процесс','HR_ONBOARD:EMP-T-052',1,'Адаптация завершена','ONB-T-052-01..04','2026-03-14T16:00:00Z','system-hr-seed')"),
  ]);
  const onboarding=[
    ["ONB-T-052-01","EMP-T-052","Оформление и договор","Выполнено","2026-02-16","DOG-EMP-T-052"],
    ["ONB-T-052-02","EMP-T-052","Рабочее место и доступы","Выполнено","2026-02-17","ACC-TASKS-052, ACC-EDU-052"],
    ["ONB-T-052-03","EMP-T-052","Вводное обучение","Выполнено","2026-02-28","DEV-T-052-01"],
    ["ONB-T-063-01","EMP-T-063","Аттестация после адаптации","В работе","2026-09-01","Промежуточная оценка 78"],
  ];
  await env.DB.batch(onboarding.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_onboarding (id,employee_id,step,status,due_date,evidence) VALUES (?,?,?,?,?,?)").bind(...row)));
  const development=[
    ["DEV-T-052-01","EMP-T-052","Обучение","Вводный курс ArtHello OS","2026-02-28",92,"Завершено","Тест и практическая задача"],
    ["DEV-T-052-02","EMP-T-052","Оценка","Оценка по итогам полугодия","2026-08-01",81,"Завершено","Цели 4/5, обратная связь руководителя"],
    ["DEV-T-052-03","EMP-T-052","Лояльность","Пульс команды","2026-07-15",68,"Сигнал","Анонимный агрегат; не основание для кадрового решения"],
    ["DEV-T-063-01","EMP-T-063","Кадровый резерв","Резерв на старшего куратора","2026-08-10",84,"Кандидат","Результат задач и оценка руководителя"],
    ["DEV-T-063-02","EMP-T-063","Аттестация","Проверка после адаптации","2026-09-01",78,"Запланировано","Матрица компетенций v2"],
  ];
  await env.DB.batch(development.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_development (id,employee_id,event_type,title,event_date,score,status,evidence) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
  const rewards=[
    ["REW-T-052-01","EMP-T-052","Премия",1200000,"Результат проектной недели","2026-06","Выплачено"],
    ["REW-T-052-02","EMP-T-052","Нарушение",0,"Опоздание отчёта; подтверждено руководителем","2026-07","Закрыто"],
    ["REW-T-063-01","EMP-T-063","Депремирование",-500000,"Невыполненный согласованный KPI; решение требует подтверждения","2026-08","На согласовании"],
  ];
  await env.DB.batch(rewards.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_rewards (id,employee_id,event_type,amount_minor,reason,period,status) VALUES (?,?,?,?,?,?,?)").bind(...row)));
  const accesses=[
    ["ACC-TASKS-052","EMP-T-052","ArtHello OS","Педагог","Отозван","2026-02-16T08:00:00Z","2026-08-15T18:00:00Z","Увольнение EMP-T-052"],
    ["ACC-EDU-052","EMP-T-052","Журнал обучения","Педагог","Отозван","2026-02-16T08:00:00Z","2026-08-15T18:00:00Z","Увольнение EMP-T-052"],
    ["ACC-TASKS-063","EMP-T-063","ArtHello OS","Куратор","Активен","2026-06-01T08:00:00Z","",""],
  ];
  await env.DB.batch(accesses.map(row=>env.DB.prepare("INSERT OR IGNORE INTO hr_accesses (id,employee_id,system,role,status,granted_at,revoked_at,revocation_reason) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare(`INSERT OR IGNORE INTO financial_operations (id,operation_date,period,direction,amount_minor,category,report_class,counterparty_entity_id,contract_id,document_id,project_entity_id,legal_entity_id,object_entity_id,cfr_entity_id,bank_operation_ref,operation_kind,source_system,source_file,source_sheet,source_ref,data_quality,status,created_by) VALUES ('FIN-TEST-PAYROLL-052','2026-07-31','2026-07','Списание',9500000,'Заработная плата · сотрудник T-052','Расходы на персонал','EMP-T-052','DOG-EMP-T-052','PAYROLL-T-052-07','PRJ-T-004','ORG-T-001','OBJ-T-002','CFR-T-001','BANK-TEST-PAYROLL-052','SYNTHETIC_TRACE','SYNTHETIC_HR_TEST','—','—','EMP-T-052 → 2026-07','Синтетическая выплата для проверки HR-цепочки; не строка реальной ведомости','Разнесено','system-hr-seed')`).run();
}

async function seedLegal() {
  const entitiesToAdd=[
    ["CTR-T-044","Организация","Подрядчик T-044","Активна","CONTRACTOR-044","Подрядчики"],
    ["CTR-T-077","Организация","Подрядчик T-077","Активна","CONTRACTOR-077","Подрядчики"],
    ["CTR-T-099","Организация","Подрядчик T-099","Активна","CONTRACTOR-099","Подрядчики"],
    ["EMP-T-LEGAL-001","Сотрудник","Юрист T-L01","Активна","EMPLOYEE-LEGAL-001","Юридический контур"],
  ];
  await env.DB.batch(entitiesToAdd.map(row=>env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES (?,?,?,?,'SYNTHETIC_LEGAL_TEST',?,'Синтетическая юридическая карточка',?,'{}','system-legal-seed')").bind(...row)));
  const contracts=[
    ["LCON-T-044","DOG-T-2026-044","Подрядчик","Подрядчик","CTR-T-044","44/26","Подписан","2026-01-15","2026-09-02",50000000,54000000,"Истекает","Интеграция ЭП не подключена","Проверены","EMP-T-LEGAL-001",1],
    ["LCON-CLIENT-T-014","DOG-T-2026-014","Клиент","Семья","FAM-T-014","014/26","Подписан","2026-01-10","2027-01-09",8500000,8500000,"Актуален","Интеграция ЭП не подключена","Проверены","EMP-T-SALES-001",0],
    ["LCON-EMP-T-052","DOG-EMP-T-052","Сотрудник","Сотрудник","EMP-T-052","052-ТД","Подписан","2026-02-16","2026-08-15",0,0,"Завершён","Интеграция ЭП не подключена","Проверены","EMP-T-HR-001",1],
    ["LCON-T-077","DOG-T-2026-077","Подрядчик","Подрядчик","CTR-T-077","77/26","Не подписан","2026-08-01","2026-12-31",30000000,0,"На согласовании","Интеграция ЭП не подключена","Требуют проверки","EMP-T-LEGAL-001",1],
  ];
  await env.DB.batch(contracts.map(row=>env.DB.prepare("INSERT OR IGNORE INTO legal_contracts (id,reference_document_id,contract_type,party_type,party_entity_id,number,signed_status,valid_from,valid_until,limit_minor,spent_minor,status,electronic_signature_status,requisite_status,owner_entity_id,closing_required) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const docs=[
    ["APP-T-044-V1","APP-T-044","LCON-T-044","Приложение","Техническое задание",1,1,"Подписано","Актуален","2026-01-15","SYNTHETIC:APP-T-044"],
    ["ACT-T-044-V1","ACT-T-044","LCON-T-044","Акт","Акт за август",1,1,"Не подписано","Отсутствует","2026-08-31",""],
    ["CLOSE-T-044-V1","CLOSE-T-044","LCON-T-044","Закрывающий документ","Закрывающий пакет",1,1,"Не подписано","Отсутствует","2026-09-05",""],
    ["CONS-T-014-V1","CONS-T-014","LCON-CLIENT-T-014","Согласие","Согласие на обработку данных · тест",1,1,"Подписано","Актуален","2027-01-09","SYNTHETIC:CONS-T-014"],
    ["INS-T-001-V2","INS-T-001","LCON-EMP-T-052","Инструкция","Инструкция сотрудника",2,1,"Подписано","Архив","2026-08-15","SYNTHETIC:INS-T-001-V2"],
    ["JRN-T-001-V1","JRN-T-001","LCON-EMP-T-052","Журнал","Журнал ознакомления",1,1,"Подписано","Архив","2026-08-15","SYNTHETIC:JRN-T-001"],
  ];
  await env.DB.batch(docs.map(row=>env.DB.prepare("INSERT OR IGNORE INTO legal_document_items (id,stable_id,contract_id,item_type,title,version,required,signed_status,status,due_date,reference) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const zones=[
    ["ZONE-T-044-01","LCON-T-044","Приёмка работ","EMP-T-004","Акт и подтверждение результата","Активна"],
    ["ZONE-T-044-02","LCON-T-044","Лимит и оплата","EMP-T-FIN-001","500 000 ₽ по договору","Активна"],
    ["ZONE-T-014-01","LCON-CLIENT-T-014","Согласия семьи","EMP-T-SALES-001","Согласие и договор клиента","Активна"],
  ];
  await env.DB.batch(zones.map(row=>env.DB.prepare("INSERT OR IGNORE INTO legal_responsibility_zones (id,contract_id,zone,responsible_entity_id,scope,status) VALUES (?,?,?,?,?,?)").bind(...row)));
  const checks=[
    ["SIG-LGL-T-001","LCON-T-044","Истекающий договор","Высокий","DOG-T-2026-044 действует до 2026-09-02; осталось менее 30 дней","Проверить продление или завершение обязательств","Открыт","2026-08-21T07:00:00Z"],
    ["SIG-LGL-T-002","LCON-T-044","Отсутствующий акт","Высокий","Обязательный ACT-T-044 имеет статус «Отсутствует» и срок 2026-08-31","Запросить акт и связать с подтверждённым результатом","Открыт","2026-08-21T07:01:00Z"],
    ["SIG-LGL-T-003","LCON-T-044","Превышение лимита","Высокий","Расход 540 000 ₽ превышает лимит договора 500 000 ₽ на 40 000 ₽","Остановить новое обязательство до решения уполномоченного лица","Открыт","2026-08-21T07:02:00Z"],
    ["SIG-LGL-T-004","LCON-T-077","Неподписанный договор","Высокий","Договор 77/26 имеет статус «Не подписан»","Не допускать работу или оплату до подписания","Открыт","2026-08-21T07:03:00Z"],
    ["SIG-LGL-T-005","MISSING:CTR-T-099","Отсутствующий договор","Критичный","Подрядчик CTR-T-099 присутствует в реестре, связанный договор не найден","Проверить основание взаимодействия; не делать вывод о нарушении без документов","Открыт","2026-08-21T07:04:00Z"],
    ["SIG-LGL-T-006","LCON-T-044","Возможный конфликт · сигнал","Средний","В тестовых реквизитах CTR-T-044 и CTR-T-077 совпал контакт согласования; это только признак для проверки","Сверить полномочия, реквизиты и документы; не обвинять сторону","Открыт","2026-08-21T07:05:00Z"],
    ["SIG-LGL-T-007","LCON-T-044","Отсутствующий закрывающий документ","Средний","Обязательный CLOSE-T-044 отсутствует, срок 2026-09-05","Назначить владельца и запросить закрывающий пакет","Открыт","2026-08-21T07:06:00Z"],
  ];
  await env.DB.batch(checks.map(row=>env.DB.prepare("INSERT OR IGNORE INTO legal_checks (id,contract_id,signal_type,severity,evidence,recommendation,status,detected_at) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
}

async function seedProcurement() {
  const parties=[
    ["SUP-T-022","Организация","Поставщик T-022 · техника","Активна","SUPPLIER-022","Закупки"],
    ["SUP-T-023","Организация","Поставщик T-023 · техника","Активна","SUPPLIER-023","Закупки"],
    ["SUP-T-024","Организация","Поставщик T-024 · техника","Активна","SUPPLIER-024","Закупки"],
    ["EMP-T-PROC-001","Сотрудник","Специалист закупок T-P01","Активна","EMPLOYEE-PROC-001","Закупки"],
  ];
  await env.DB.batch(parties.map(row=>env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES (?,?,?,?,'SYNTHETIC_PROCUREMENT_TEST',?,'Синтетическая карточка без реальных реквизитов',?,'{}','system-procurement-seed')").bind(...row)));
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO workflow_documents (id,title,document_type,current_version,status,valid_until,owner_entity_id,source,created_by) VALUES ('DOG-SUP-T-022','Договор поставки T-022','Договор поставки',1,'Актуален','2027-08-01','EMP-T-PROC-001','SYNTHETIC_PROCUREMENT_TEST','system-procurement-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO legal_contracts (id,reference_document_id,contract_type,party_type,party_entity_id,number,signed_status,valid_from,valid_until,limit_minor,spent_minor,status,electronic_signature_status,requisite_status,owner_entity_id,closing_required) VALUES ('LCON-SUP-T-022','DOG-SUP-T-022','Поставщик','Поставщик','SUP-T-022','SUP-022/26','Подписан','2026-08-01','2027-08-01',100000000,48000000,'Актуален','Интеграция ЭП не подключена','Проверены','EMP-T-PROC-001',1)"),
  ]);
  const suppliers=[
    ["SUPREC-T-022","SUP-T-022","Компьютерная техника","LCON-SUP-T-022",4800000,91,88,96,"Активен","Синтетическая цена; сравнение рынка без внешнего API"],
    ["SUPREC-T-023","SUP-T-023","Компьютерная техника","",4520000,76,74,90,"На проверке","Синтетическая цена; договор отсутствует"],
    ["SUPREC-T-024","SUP-T-024","Компьютерная техника","",5150000,95,82,103,"Активен","Синтетическая цена выше медианы тестового набора"],
  ];
  await env.DB.batch(suppliers.map(row=>env.DB.prepare("INSERT OR IGNORE INTO procurement_suppliers (id,entity_id,specialization,contract_id,base_price_minor,quality_score,rating,market_index,status,data_quality) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO purchase_requests (id,requester_entity_id,unit,item_name,quantity,budget_minor,need_by,status,justification,approver_entity_id,approved_at) VALUES ('REQ-T-088','EMP-T-032','Школа 1–11','Ноутбук для учебного класса',10,50000000,'2026-08-20','Согласована','Обновление техники для проектной лаборатории','EMP-T-004','2026-08-03T10:00:00Z')").run();
  const offers=[
    ["OFFR-T-088-22","REQ-T-088","SUPREC-T-022",48000000,5,24,91,"Выбрано","Не самая низкая цена; лучший баланс качества, гарантии и договора"],
    ["OFFR-T-088-23","REQ-T-088","SUPREC-T-023",45200000,8,12,76,"Отклонено","Ниже цена, но отсутствует договор и короче гарантия"],
    ["OFFR-T-088-24","REQ-T-088","SUPREC-T-024",51500000,3,36,95,"Отклонено","Выше качество и гарантия, но превышен бюджет"],
  ];
  await env.DB.batch(offers.map(row=>env.DB.prepare("INSERT OR IGNORE INTO supplier_offers (id,request_id,supplier_id,price_minor,delivery_days,warranty_months,quality_score,status,comparison_note) VALUES (?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO purchase_orders (id,request_id,offer_id,supplier_id,order_number,amount_minor,status,ordered_at,expected_at,contract_id) VALUES ('ORD-T-088','REQ-T-088','OFFR-T-088-22','SUPREC-T-022','PO-088/26',48000000,'Принят','2026-08-04T09:00:00Z','2026-08-09','LCON-SUP-T-022')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO procurement_deliveries (id,order_id,delivered_at,document_id,status,quantity,accepted_quantity,accepted_by,quality_note) VALUES ('DLV-T-088','ORD-T-088','2026-08-09T12:00:00Z','ACT-REQ-T-088','Принято',10,10,'EMP-T-PROC-001','Комплектность и серийные номера проверены')").run();
  const inventory=[
    ["ITEM-T-LAPTOP-088","NB-CLASS-T","Ноутбук учебный · тест","Оборудование","Склад школы",8,4800000,"ASSET-T-088-01","В наличии"],
    ["ITEM-T-PAPER-014","PAPER-A4-T","Бумага А4 · тест","Расходные материалы","Центральный склад",24,45000,"","В наличии"],
  ];
  await env.DB.batch(inventory.map(row=>env.DB.prepare("INSERT OR IGNORE INTO inventory_items (id,sku,name,category,warehouse,quantity,unit_cost_minor,asset_id,status) VALUES (?,?,?,?,?,?,?,?,?)").bind(...row)));
  const events=[
    ["INV-T-088-01","ITEM-T-LAPTOP-088","Приёмка",10,"Поставщик T-022","Склад школы","ACT-REQ-T-088","2026-08-09T12:30:00Z","EMP-T-PROC-001"],
    ["INV-T-088-02","ITEM-T-LAPTOP-088","Выдача",2,"Склад школы","Класс 3А","ISSUE-T-088-02","2026-08-12T08:00:00Z","EMP-T-PROC-001"],
    ["INV-T-088-03","ITEM-T-LAPTOP-088","Инвентаризация",8,"Склад школы","Склад школы","STOCKTAKE-T-0820","2026-08-20T16:00:00Z","EMP-T-PROC-001"],
    ["INV-T-014-01","ITEM-T-PAPER-014","Перемещение",6,"Центральный склад","Школа 1–11","MOVE-T-014","2026-08-18T10:00:00Z","EMP-T-PROC-001"],
  ];
  await env.DB.batch(events.map(row=>env.DB.prepare("INSERT OR IGNORE INTO inventory_events (id,item_id,event_type,quantity,from_location,to_location,document_id,occurred_at,actor) VALUES (?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO assets (id,item_id,serial_number,object_entity_id,assigned_to_entity_id,warranty_until,service_due,status,acquisition_date,cost_minor,monthly_depreciation_minor) VALUES ('ASSET-T-088-01','ITEM-T-LAPTOP-088','SERIAL-T-088-01','OBJ-T-002','EMP-T-032','2028-08-09','2027-02-09','В эксплуатации','2026-08-09',4800000,200000)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO asset_maintenance (id,asset_id,maintenance_type,scheduled_at,completed_at,contractor_id,status,cost_minor,document_id) VALUES ('MAINT-T-088-01','ASSET-T-088-01','Плановое обслуживание','2027-02-09','','SUP-T-022','Запланировано',0,'')").run();
  await env.DB.prepare(`INSERT OR IGNORE INTO financial_operations (id,operation_date,period,direction,amount_minor,category,report_class,counterparty_entity_id,contract_id,document_id,project_entity_id,legal_entity_id,object_entity_id,cfr_entity_id,bank_operation_ref,operation_kind,source_system,source_file,source_sheet,source_ref,data_quality,status,created_by) VALUES ('FIN-TEST-PROC-088','2026-08-12','2026-08','Списание',48000000,'Оборудование для учебного класса','Расходы ОПиУ','SUP-T-022','DOG-SUP-T-022','ACT-REQ-T-088','PRJ-T-004','ORG-T-001','OBJ-T-002','CFR-T-001','BANK-TEST-PROC-088','SYNTHETIC_TRACE','SYNTHETIC_PROCUREMENT_TEST','—','—','REQ-T-088 → ORD-T-088 → DLV-T-088','Синтетическая оплата для проверки закупочной цепочки; не банковский факт','Разнесено','system-procurement-seed')`).run();
}

async function seedFood(){
  const entitiesToAdd=[
    ["PRJ-T-KITCHEN","Проект","Кухня ArtHello · тест","Активна","PROJECT-KITCHEN","Кухня"],
    ["CFR-T-KITCHEN","ЦФО","ЦФО Кухня · тест","Активна","CFR-KITCHEN","Кухня"],
    ["SUP-T-FOOD-001","Организация","Поставщик продуктов T-F01","Активна","SUPPLIER-FOOD-001","Кухня"],
    ["EMP-T-FOOD-001","Сотрудник","Повар T-F01","Активна","EMPLOYEE-FOOD-001","Кухня"],
    ["EMP-T-FOOD-002","Сотрудник","Работник кухни T-F02","Активна","EMPLOYEE-FOOD-002","Кухня"],
  ];
  await env.DB.batch(entitiesToAdd.map(row=>env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES (?,?,?,?,'SYNTHETIC_FOOD_TEST',?,'Синтетическая карточка',?,'{}','system-food-seed')").bind(...row)));
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO procurement_suppliers (id,entity_id,specialization,contract_id,base_price_minor,quality_score,rating,market_index,status,data_quality) VALUES ('SUPREC-T-FOOD-001','SUP-T-FOOD-001','Продукты питания','DOG-SUP-T-FOOD-001',25000,90,87,100,'Активен','Синтетические цены и поставщик')"),
    env.DB.prepare("INSERT OR IGNORE INTO purchase_requests (id,requester_entity_id,unit,item_name,quantity,budget_minor,need_by,status,justification,approver_entity_id,approved_at) VALUES ('REQ-T-FOOD-021','EMP-T-FOOD-001','Кухня','Продукты меню 21 августа',1,3500000,'2026-08-20','Согласована','Меню школы и детского сада','EMP-T-004','2026-08-18T09:00:00Z')"),
    env.DB.prepare("INSERT OR IGNORE INTO purchase_orders (id,request_id,offer_id,supplier_id,order_number,amount_minor,status,ordered_at,expected_at,contract_id) VALUES ('ORD-T-FOOD-021','REQ-T-FOOD-021','OFFR-T-FOOD-021','SUPREC-T-FOOD-001','FOOD-021/26',3200000,'Принят','2026-08-18T10:00:00Z','2026-08-20','DOG-SUP-T-FOOD-001')"),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_deliveries (id,order_id,delivered_at,document_id,status,quantity,accepted_quantity,accepted_by,quality_note) VALUES ('DLV-T-FOOD-021','ORD-T-FOOD-021','2026-08-20T07:00:00Z','ACT-T-FOOD-021','Принято',1,1,'EMP-T-FOOD-001','Температура и сроки проверены')"),
  ]);
  const products=[
    ["FOOD-PROD-T-001","Крупа гречневая","SUPREC-T-FOOD-001","г",22,"Сухой склад · до +25°C","Активен"],
    ["FOOD-PROD-T-002","Филе куриное","SUPREC-T-FOOD-001","г",48,"Холодильник · 0…+4°C","Активен"],
    ["FOOD-PROD-T-003","Овощная смесь","SUPREC-T-FOOD-001","г",31,"Холодильник · 0…+4°C","Активен"],
  ];
  await env.DB.batch(products.map(row=>env.DB.prepare("INSERT OR IGNORE INTO food_products (id,name,supplier_id,unit,purchase_cost_minor,storage_norm,status,project_entity_id,cfr_entity_id) VALUES (?,?,?,?,?,?,?,'PRJ-T-KITCHEN','CFR-T-KITCHEN')").bind(...row)));
  const batches=[
    ["BATCH-T-021-01","FOOD-PROD-T-001","REQ-T-FOOD-021","2026-08-20T07:00:00Z","2027-02-20",25000,9000,"г","Сухой склад","Открыта","Упаковка целая"],
    ["BATCH-T-021-02","FOOD-PROD-T-002","REQ-T-FOOD-021","2026-08-20T07:00:00Z","2026-08-23",18000,3000,"г","Холодильник","Скоропортящаяся · использовать первой"],
    ["BATCH-T-021-03","FOOD-PROD-T-003","REQ-T-FOOD-021","2026-08-20T07:00:00Z","2026-08-25",16000,5000,"г","Холодильник","Температура при приёмке +3°C"],
  ];
  await env.DB.batch(batches.map(row=>env.DB.prepare("INSERT OR IGNORE INTO food_batches (id,product_id,purchase_request_id,received_at,expires_at,quantity,remaining_quantity,unit,warehouse,status,quality_note) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO food_recipes (id,dish_name,version,yield_portions,standard_cost_minor,norm_description,menu_date,status) VALUES ('TTK-T-014','Гречка с курицей и овощами',3,10,92000,'На 10 порций: крупа 1,2 кг, курица 1,1 кг, овощи 0,8 кг','2026-08-21','Действует')").run();
  const ingredients=[["ING-T-014-01","TTK-T-014","FOOD-PROD-T-001",1200,"г",26400],["ING-T-014-02","TTK-T-014","FOOD-PROD-T-002",1100,"г",52800],["ING-T-014-03","TTK-T-014","FOOD-PROD-T-003",800,"г",24800]];
  await env.DB.batch(ingredients.map(row=>env.DB.prepare("INSERT OR IGNORE INTO food_recipe_ingredients (id,recipe_id,product_id,quantity_per_batch,unit,cost_minor) VALUES (?,?,?,?,?,?)").bind(...row)));
  const shifts=[["SHIFT-T-0821-01","EMP-T-FOOD-001","2026-08-21T05:30:00Z","2026-08-21T14:00:00Z",500000,"Завершена","Повар"],["SHIFT-T-0821-02","EMP-T-FOOD-002","2026-08-21T06:00:00Z","2026-08-21T14:00:00Z",300000,"Завершена","Работник кухни"]];
  await env.DB.batch(shifts.map(row=>env.DB.prepare("INSERT OR IGNORE INTO food_shifts (id,employee_entity_id,started_at,ended_at,rate_minor,status,role) VALUES (?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO food_production (id,production_date,recipe_id,shift_id,planned_portions,actual_portions,material_cost_minor,status,evidence) VALUES ('PROD-T-0821','2026-08-21','TTK-T-014','SHIFT-T-0821-01',130,130,1200000,'Завершено','Журнал температуры и контроль выхода T-0821')").run();
  const shipments=[
    ["SHIP-T-0821-01","PROD-T-0821","OBJ-T-002",80,75,3,2,1800000,"Закрыта","DOC-SHIP-T-0821-01","2026-08-21T10:30:00Z"],
    ["SHIP-T-0821-02","PROD-T-0821","OBJ-T-001",50,45,5,0,1200000,"Закрыта","DOC-SHIP-T-0821-02","2026-08-21T10:45:00Z"],
  ];
  await env.DB.batch(shipments.map(row=>env.DB.prepare("INSERT OR IGNORE INTO food_shipments (id,production_id,destination_object_id,shipped_portions,consumed_portions,returned_portions,written_off_portions,revenue_minor,status,document_id,shipped_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const checks=[
    ["FOOD-CHECK-T-001","Сроки и маркировка","PRJ-T-KITCHEN","2026-08-21T06:00:00Z","Соответствует","","Фото журнала T-0821 и партии BATCH-T-021-02","Закрыта"],
    ["FOOD-CHECK-T-002","Температура хранения","PRJ-T-KITCHEN","2026-08-21T12:00:00Z","Замечание","Кратковременное отклонение +6°C в холодильнике 2","Запись датчика T-SENSOR-02; требуется проверка, не вывод о виновнике","Открыта"],
  ];
  await env.DB.batch(checks.map(row=>env.DB.prepare("INSERT OR IGNORE INTO food_checks (id,check_type,object_entity_id,checked_at,result,violation,evidence,status) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO financial_operations (id,operation_date,period,direction,amount_minor,category,report_class,counterparty_entity_id,contract_id,document_id,project_entity_id,legal_entity_id,object_entity_id,cfr_entity_id,bank_operation_ref,operation_kind,source_system,source_file,source_sheet,source_ref,data_quality,status,created_by) VALUES ('FIN-TEST-FOOD-REV-0821','2026-08-21','2026-08','Поступление',3000000,'Выручка кухни · тест','Доходы ОПиУ','PRJ-T-KITCHEN','','DOC-SHIP-T-0821','PRJ-T-KITCHEN','ORG-T-001','OBJ-T-002','CFR-T-KITCHEN','BANK-TEST-FOOD-REV','SYNTHETIC_TRACE','SYNTHETIC_FOOD_TEST','—','—','SHIP-T-0821-01..02','Синтетическая выручка кухни; не банковский факт','Разнесено','system-food-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO financial_operations (id,operation_date,period,direction,amount_minor,category,report_class,counterparty_entity_id,contract_id,document_id,project_entity_id,legal_entity_id,object_entity_id,cfr_entity_id,bank_operation_ref,operation_kind,source_system,source_file,source_sheet,source_ref,data_quality,status,created_by) VALUES ('FIN-TEST-FOOD-COST-0821','2026-08-21','2026-08','Списание',1200000,'Себестоимость продуктов · тест','Расходы ОПиУ','SUP-T-FOOD-001','DOG-SUP-T-FOOD-001','ACT-T-FOOD-021','PRJ-T-KITCHEN','ORG-T-001','OBJ-T-002','CFR-T-KITCHEN','BANK-TEST-FOOD-COST','SYNTHETIC_TRACE','SYNTHETIC_FOOD_TEST','—','—','PROD-T-0821','Синтетическая себестоимость; не банковский факт','Разнесено','system-food-seed')"),
  ]);
}

async function seedSafety(){
  const entitiesToAdd=[
    ["EMP-T-SAFE-001","Сотрудник","Ответственный по безопасности","Активна","EMPLOYEE-SAFETY-001","Безопасность"],
    ["EMP-T-GUARD-001","Сотрудник","Сотрудник охраны №1","Активна","EMPLOYEE-GUARD-001","Безопасность"],
    ["SUP-T-SAFE-001","Организация","Подрядчик инженерных систем №1","Активна","SUPPLIER-SAFETY-001","Безопасность"],
  ];
  await env.DB.batch(entitiesToAdd.map(row=>env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES (?,?,?,?,'SYNTHETIC_SAFETY_TEST',?,'Синтетическая карточка',?,'{}','system-safety-seed')").bind(...row)));
  const systems=[
    ["SAFE-SYS-T-FIRE-01","Пожарная безопасность","АПС и дымоудаление · корпус 1","OBJ-T-001","SCHEME-T-FIRE-01","JOURNAL-T-FIRE-0826","EMP-T-SAFE-001","Работает","SYNTHETIC_SAFETY_TEST"],
    ["SAFE-SYS-T-ALERT-01","Оповещение","СОУЭ · корпус 1","OBJ-T-001","SCHEME-T-ALERT-01","JOURNAL-T-ALERT-0826","EMP-T-SAFE-001","Работает","SYNTHETIC_SAFETY_TEST"],
    ["SAFE-SYS-T-ACS-01","СКУД","Контроль доступа · главный вход","OBJ-T-002","SCHEME-T-ACS-01","JOURNAL-T-ACS-0826","EMP-T-SAFE-001","Ограничено","SYNTHETIC_SAFETY_TEST"],
    ["SAFE-SYS-T-CCTV-01","Камеры","Видеонаблюдение · периметр","OBJ-T-002","SCHEME-T-CCTV-01","JOURNAL-T-CCTV-0826","EMP-T-SAFE-001","Работает","SYNTHETIC_SAFETY_TEST"],
    ["SAFE-SYS-T-GUARD-01","Охрана","Пост охраны · главный вход","OBJ-T-002","SCHEME-T-GUARD-01","JOURNAL-T-GUARD-0826","EMP-T-SAFE-001","Работает","SYNTHETIC_SAFETY_TEST"],
  ];
  await env.DB.batch(systems.map(row=>env.DB.prepare("INSERT OR IGNORE INTO safety_systems (id,system_type,name,object_entity_id,scheme_ref,journal_ref,responsible_entity_id,status,source_type) VALUES (?,?,?,?,?,?,?,?,?)").bind(...row)));
  const equipment=[
    ["SAFE-EQ-T-001","SAFE-SYS-T-FIRE-01","Шлейф дымовых извещателей №4","INV-SAFE-T-001","Корпус 1 · этаж 2","SUP-T-SAFE-001","Высокая","2026-09-20","Работает"],
    ["SAFE-EQ-T-002","SAFE-SYS-T-ACS-01","Контроллер двери главного входа","INV-SAFE-T-002","Школа · главный вход","SUP-T-SAFE-001","Высокая","2026-08-28","Ограничено"],
    ["SAFE-EQ-T-003","SAFE-SYS-T-CCTV-01","Камера входной группы","INV-SAFE-T-003","Школа · главный вход","SUP-T-SAFE-001","Средняя","2026-09-05","Работает"],
    ["SAFE-EQ-T-004","SAFE-SYS-T-ALERT-01","Речевой оповещатель №7","INV-SAFE-T-004","Корпус 1 · холл","SUP-T-SAFE-001","Высокая","2026-08-26","Работает"],
  ];
  await env.DB.batch(equipment.map(row=>env.DB.prepare("INSERT OR IGNORE INTO safety_equipment (id,system_id,name,inventory_number,location,contractor_id,criticality,next_check_at,status) VALUES (?,?,?,?,?,?,?,?,?)").bind(...row)));
  const checks=[
    ["SAFE-CHK-T-090","SAFE-EQ-T-001","OBJ-T-001","Плановая","2026-08-20","2026-08-20T08:30:00Z","Неисправность","Акт проверки №0090: обрыв шлейфа 4","EMP-T-SAFE-001","Завершена"],
    ["SAFE-CHK-T-091","SAFE-EQ-T-003","OBJ-T-002","Ежемесячная","2026-08-21","2026-08-21T07:00:00Z","Соответствует","Контрольный кадр и запись журнала","EMP-T-SAFE-001","Завершена"],
    ["SAFE-CHK-T-092","SAFE-EQ-T-004","OBJ-T-001","Плановая","2026-08-26","","Ожидает","Проверка уровня и разборчивости оповещения","EMP-T-SAFE-001","Запланирована"],
  ];
  await env.DB.batch(checks.map(row=>env.DB.prepare("INSERT OR IGNORE INTO safety_checks (id,equipment_id,object_entity_id,check_type,scheduled_at,checked_at,result,evidence,responsible_entity_id,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const faults=[
    ["SAFE-FLT-T-031","SAFE-CHK-T-090","SAFE-EQ-T-001","Высокая","Обрыв шлейфа дымовых извещателей №4","2026-08-20T08:35:00Z","Устранена"],
    ["SAFE-FLT-T-032","SAFE-CHK-T-091","SAFE-EQ-T-002","Средняя","Нестабильное чтение карты доступа; требуется диагностика","2026-08-21T07:20:00Z","В работе"],
  ];
  await env.DB.batch(faults.map(row=>env.DB.prepare("INSERT OR IGNORE INTO safety_faults (id,check_id,equipment_id,severity,description,detected_at,status) VALUES (?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO tasks (title,owner,due_date,priority,status,source_type,source_id,description,assignee_entity_id,kind,automation_key,requires_approval,result,result_evidence,completed_at,created_by) VALUES ('Устранить неисправность пожарного шлейфа','Ответственный по безопасности','2026-08-20','Высокий','Завершена','Неисправность безопасности','SAFE-FLT-T-031','Обрыв шлейфа 4 по акту проверки №0090','EMP-T-SAFE-001','Автозадача','SAFETY_FAULT:SAFE-FLT-T-031',1,'Шлейф восстановлен, контрольный тест пройден','Акт выполненных работ №0031','2026-08-20T15:40:00Z','system-safety-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO tasks (title,owner,due_date,priority,status,source_type,source_id,description,assignee_entity_id,kind,automation_key,requires_approval,created_by) VALUES ('Диагностировать контроллер СКУД','Ответственный по безопасности','2026-08-22','Средний','В работе','Неисправность безопасности','SAFE-FLT-T-032','Нестабильное чтение карты доступа; проверить журнал и контроллер','EMP-T-SAFE-001','Автозадача','SAFETY_FAULT:SAFE-FLT-T-032',1,'system-safety-seed')"),
  ]);
  await env.DB.batch([
    env.DB.prepare("UPDATE safety_faults SET related_task_id=(SELECT id FROM tasks WHERE automation_key='SAFETY_FAULT:SAFE-FLT-T-031') WHERE id='SAFE-FLT-T-031'"),
    env.DB.prepare("UPDATE safety_faults SET related_task_id=(SELECT id FROM tasks WHERE automation_key='SAFETY_FAULT:SAFE-FLT-T-032') WHERE id='SAFE-FLT-T-032'"),
  ]);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO safety_incidents (id,object_entity_id,system_id,happened_at,category,severity,description,response,status) VALUES ('SAFE-INC-T-014','OBJ-T-002','SAFE-SYS-T-ACS-01','2026-08-19T17:42:00Z','СКУД','Средняя','Дверь удерживалась открытой 74 секунды','Охрана проверила зону, событие записано; признаков ущерба нет','Закрыт')"),
    env.DB.prepare("INSERT OR IGNORE INTO safety_repairs (id,fault_id,contractor_id,action_type,started_at,completed_at,result,act_document_id,cost_minor,payment_operation_id,status) VALUES ('SAFE-REP-T-031','SAFE-FLT-T-031','SUP-T-SAFE-001','Ремонт','2026-08-20T10:00:00Z','2026-08-20T15:30:00Z','Кабель заменён, шлейф протестирован','ACT-SAFE-T-031',1850000,'FIN-TEST-SAFE-031','Завершён')"),
    env.DB.prepare("INSERT OR IGNORE INTO safety_repairs (id,fault_id,contractor_id,action_type,started_at,completed_at,result,act_document_id,cost_minor,payment_operation_id,status) VALUES ('SAFE-REP-T-032','SAFE-FLT-T-032','SUP-T-SAFE-001','Диагностика','2026-08-21T09:00:00Z','','Работа начата','',650000,'','В работе')"),
    env.DB.prepare("INSERT OR IGNORE INTO safety_next_checks (id,equipment_id,source_repair_id,scheduled_at,check_type,responsible_entity_id,status) VALUES ('SAFE-NEXT-T-031','SAFE-EQ-T-001','SAFE-REP-T-031','2026-09-20','После ремонта','EMP-T-SAFE-001','Запланирована')"),
    env.DB.prepare("INSERT OR IGNORE INTO safety_guard_shifts (id,object_entity_id,employee_entity_id,post,started_at,ended_at,journal_ref,status) VALUES ('SAFE-GUARD-T-0821','OBJ-T-002','EMP-T-GUARD-001','Главный вход','2026-08-21T06:45:00Z','2026-08-21T19:00:00Z','JOURNAL-T-GUARD-0826','На посту')"),
    env.DB.prepare("INSERT OR IGNORE INTO financial_operations (id,operation_date,period,direction,amount_minor,category,report_class,counterparty_entity_id,contract_id,document_id,project_entity_id,legal_entity_id,object_entity_id,cfr_entity_id,bank_operation_ref,operation_kind,source_system,source_file,source_sheet,source_ref,data_quality,status,created_by) VALUES ('FIN-TEST-SAFE-031','2026-08-20','2026-08','Списание',1850000,'Ремонт систем безопасности · тест','Расходы ОПиУ','SUP-T-SAFE-001','DOG-SUP-T-SAFE-001','ACT-SAFE-T-031','PRJ-T-004','ORG-T-001','OBJ-T-001','CFR-T-001','BANK-TEST-SAFE-031','SYNTHETIC_TRACE','SYNTHETIC_SAFETY_TEST','—','—','Неисправность №0031 → ремонт №0031','Синтетическая оплата; не банковский факт','Разнесено','system-safety-seed')"),
  ]);
  await env.DB.batch([
    env.DB.prepare("UPDATE entities SET display_name='Ответственный по безопасности' WHERE id='EMP-T-SAFE-001' AND created_by='system-safety-seed' AND display_name='Ответственный по безопасности T-S01'"),
    env.DB.prepare("UPDATE entities SET display_name='Сотрудник охраны №1' WHERE id='EMP-T-GUARD-001' AND created_by='system-safety-seed' AND display_name='Сотрудник охраны T-G01'"),
    env.DB.prepare("UPDATE entities SET display_name='Подрядчик инженерных систем №1' WHERE id='SUP-T-SAFE-001' AND created_by='system-safety-seed' AND display_name='Подрядчик инженерных систем T-S01'"),
    env.DB.prepare("UPDATE safety_checks SET evidence='Акт проверки №0090: обрыв шлейфа 4' WHERE id='SAFE-CHK-T-090' AND evidence='Акт проверки SAFE-CHECK-ACT-T-090: обрыв шлейфа 4'"),
    env.DB.prepare("UPDATE safety_checks SET evidence='Контрольный кадр и запись журнала' WHERE id='SAFE-CHK-T-091' AND evidence='Кадр теста T-CCTV-0821 и запись журнала'"),
    env.DB.prepare("UPDATE tasks SET title='Устранить неисправность пожарного шлейфа' WHERE automation_key='SAFETY_FAULT:SAFE-FLT-T-031' AND created_by='system-safety-seed' AND title='Устранить неисправность · SAFE-EQ-T-001'"),
    env.DB.prepare("UPDATE tasks SET description='Обрыв шлейфа 4 по акту проверки №0090' WHERE automation_key='SAFETY_FAULT:SAFE-FLT-T-031' AND created_by='system-safety-seed' AND description='Обрыв шлейфа 4 по акту SAFE-CHECK-ACT-T-090'"),
    env.DB.prepare("UPDATE tasks SET result_evidence='Акт выполненных работ №0031' WHERE automation_key='SAFETY_FAULT:SAFE-FLT-T-031' AND created_by='system-safety-seed' AND result_evidence='ACT-SAFE-T-031'"),
    env.DB.prepare("UPDATE financial_operations SET source_ref='Неисправность №0031 → ремонт №0031' WHERE id='FIN-TEST-SAFE-031' AND created_by='system-safety-seed' AND source_ref='SAFE-FLT-T-031 → SAFE-REP-T-031'"),
  ]);
}

async function seedMedical(){
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES ('EMP-T-MED-001','Сотрудник','Медработник T-MED-01','Активна','SYNTHETIC_MEDICAL_TEST','EMPLOYEE-MEDICAL-001','Синтетическая карточка','Медицинское сопровождение','{}','system-medical-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO medical_access_grants (id,principal_type,principal_ref,scope,granted_by,valid_until,status) VALUES ('MED-GRANT-T-ROLE-01','Роль','ROLE:MEDICAL','MEDICAL_FULL_SYNTHETIC','system-medical-seed','2027-08-21','Активен')"),
  ]);
  const documents=[
    ["MED-DOC-T-CH-014","CHD-T-014","Ребёнок","Справка допуска","PROTECTED:SYNTHETIC:MED-DOC-T-CH-014","2026-08-01","2027-07-31","Действует","PROTECTED_SYNTHETIC","Допуск подтверждён; действует ограничение нагрузки","2026-08-02T09:00:00Z"],
    ["MED-DOC-T-EMP-063","EMP-T-063","Сотрудник","Медицинский допуск","PROTECTED:SYNTHETIC:MED-DOC-T-EMP-063","2026-06-01","2027-05-31","Действует","PROTECTED_SYNTHETIC","Обязательный допуск подтверждён","2026-06-02T09:00:00Z"],
  ];
  await env.DB.batch(documents.map(row=>env.DB.prepare("INSERT OR IGNORE INTO medical_documents (id,subject_entity_id,subject_type,document_type,document_ref,valid_from,valid_until,status,storage_class,minimum_summary,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO medical_restrictions (id,subject_entity_id,record_id,category,limitation,valid_until,action_scope,status) VALUES ('MED-LIMIT-T-014','CHD-T-014','MED-DOC-T-CH-014','Физическая нагрузка','Только щадящий режим по действующему документу','2027-07-31','Педагогу передаётся только разрешённый режим без медицинского основания','Активно')").run();
  const cases=[
    ["MED-CASE-T-021","CHD-T-014","Случай в учебное время","2026-08-21T10:15:00Z","Средняя","Требуется контроль состояния по утверждённому протоколу","EMP-T-MED-001","2026-08-21T18:00:00Z","В работе","",""],
    ["MED-CASE-T-019","EMP-T-063","Контроль допуска","2026-08-19T09:00:00Z","Низкая","Документ проверен, ограничений для работы не передаётся","EMP-T-MED-001","2026-08-20T18:00:00Z","Закрыт","2026-08-20T12:00:00Z","MED-CONF-T-019"],
  ];
  await env.DB.batch(cases.map(row=>env.DB.prepare("INSERT OR IGNORE INTO medical_cases (id,subject_entity_id,case_type,opened_at,severity,minimum_summary,responsible_entity_id,due_at,status,closed_at,confirmation_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO medical_incidents (id,case_id,happened_at,incident_type,minimum_facts,response_required,status) VALUES ('MED-INC-T-021','MED-CASE-T-021','2026-08-21T10:15:00Z','Самочувствие','Событие зарегистрировано в учебное время; персональные подробности минимизированы','Осмотр по протоколу, связь с законным представителем по утверждённому каналу','В работе')").run();
  const actions=[
    ["MED-ACT-T-021-01","MED-CASE-T-021","MED-INC-T-021","Первичный осмотр","EMP-T-MED-001","2026-08-21T10:30:00Z","2026-08-21T10:27:00Z","Осмотр выполнен, дальнейшее наблюдение назначено","MED-CONF-T-021-01","Выполнено"],
    ["MED-ACT-T-021-02","MED-CASE-T-021","MED-INC-T-021","Контроль состояния","EMP-T-MED-001","2026-08-21T14:00:00Z","","","","Запланировано"],
    ["MED-ACT-T-019-01","MED-CASE-T-019","","Проверка документа","EMP-T-MED-001","2026-08-20T12:00:00Z","2026-08-20T12:00:00Z","Срок и подтверждение проверены","MED-CONF-T-019","Выполнено"],
  ];
  await env.DB.batch(actions.map(row=>env.DB.prepare("INSERT OR IGNORE INTO medical_actions (id,case_id,incident_id,action_type,responsible_entity_id,due_at,completed_at,result,confirmation_ref,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(...row)));
}

async function seedAccounting(){
  await env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES ('EMP-T-ACC-001','Сотрудник','Бухгалтер T-ACC-01','Активна','SYNTHETIC_ACCOUNTING_TEST','EMPLOYEE-ACCOUNTING-001','Синтетическая карточка','Бухгалтерия','{}','system-accounting-seed')").run();
  const documents=[
    ["ACC-INV-T-031","Счёт","0031","2026-08-20","SUP-T-SAFE-001","DOG-SUP-T-SAFE-001",1850000,308333,"FIN-TEST-SAFE-031","PROTECTED:SYNTHETIC:ACC-INV-T-031","Подтверждено вручную","ЭДО не подключён","SYNTHETIC_ACCOUNTING_TEST","Связан"],
    ["ACC-ACT-T-031","Акт","ACT-SAFE-T-031","2026-08-20","SUP-T-SAFE-001","DOG-SUP-T-SAFE-001",1850000,308333,"FIN-TEST-SAFE-031","PROTECTED:SYNTHETIC:ACT-SAFE-T-031","Подтверждено вручную","ЭДО не подключён","SYNTHETIC_ACCOUNTING_TEST","Связан"],
    ["ACC-UPD-T-088","УПД","0088","2026-08-09","SUP-T-022","DOG-SUP-T-022",48000000,8000000,"FIN-TEST-PROC-088","PROTECTED:SYNTHETIC:ACC-UPD-T-088","На проверке","ЭДО не подключён","SYNTHETIC_ACCOUNTING_TEST","Связан"],
    ["ACC-RECEIPT-T-FOOD","Чек","0821","2026-08-20","SUP-T-FOOD-001","DOG-SUP-T-FOOD-001",1200000,200000,"FIN-TEST-FOOD-COST-0821","PROTECTED:SYNTHETIC:ACC-RECEIPT-T-FOOD","Подтверждено вручную","Не применимо","SYNTHETIC_ACCOUNTING_TEST","Связан"],
    ["ACC-WAY-T-FOOD","Накладная","FOOD-WAY-021","2026-08-20","SUP-T-FOOD-001","DOG-SUP-T-FOOD-001",3200000,533333,"","PROTECTED:SYNTHETIC:ACC-WAY-T-FOOD","На проверке","ЭДО не подключён","SYNTHETIC_ACCOUNTING_TEST","Не хватает счёта"],
  ];
  await env.DB.batch(documents.map(row=>env.DB.prepare("INSERT OR IGNORE INTO accounting_documents (id,document_type,number,document_date,counterparty_entity_id,contract_id,amount_minor,vat_minor,payment_operation_id,file_ref,signature_status,edo_status,source_type,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const links=[
    ["ACC-LINK-T-031","ACC-INV-T-031","ACC-ACT-T-031","Счёт → акт","Одинаковые договор, сумма и подрядчик"],
    ["ACC-LINK-T-FOOD","ACC-WAY-T-FOOD","ACC-RECEIPT-T-FOOD","Поставка → чек","Общая закупка REQ-T-FOOD-021; суммы различаются и требуют счёта"],
  ];
  await env.DB.batch(links.map(row=>env.DB.prepare("INSERT OR IGNORE INTO accounting_document_links (id,from_document_id,to_document_id,relation_type,evidence) VALUES (?,?,?,?,?)").bind(...row)));
  const checks=[
    ["ACC-COMP-T-031","FIN-TEST-SAFE-031","DOG-SUP-T-SAFE-001",'["Счёт","Акт"]','[]',"EMP-T-ACC-001","Комплектно","2026-08-21T08:00:00Z"],
    ["ACC-COMP-T-088","FIN-TEST-PROC-088","DOG-SUP-T-022",'["УПД"]','[]',"EMP-T-ACC-001","Комплектно","2026-08-21T08:05:00Z"],
    ["ACC-COMP-T-FOOD","FIN-TEST-FOOD-COST-0821","DOG-SUP-T-FOOD-001",'["Счёт","Накладная"]','["Счёт"]',"EMP-T-ACC-001","Не комплектно","2026-08-21T08:10:00Z"],
  ];
  await env.DB.batch(checks.map(row=>env.DB.prepare("INSERT OR IGNORE INTO accounting_completeness_checks (id,operation_id,contract_id,required_types,missing_types,owner_entity_id,status,checked_at) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO tasks (title,owner,due_date,priority,status,source_type,source_id,description,assignee_entity_id,kind,automation_key,requires_approval,created_by) VALUES ('Получить недостающий счёт по кухне','Бухгалтер','2026-08-22','Высокий','Входящие','Комплектность первички','ACC-COMP-T-FOOD','Для FIN-TEST-FOOD-COST-0821 отсутствует счёт; накладная и чек уже зарегистрированы','EMP-T-ACC-001','Автозадача','ACCOUNTING_MISSING:ACC-COMP-T-FOOD',0,'system-accounting-seed')").run();
  await env.DB.prepare("UPDATE accounting_completeness_checks SET related_task_id=(SELECT id FROM tasks WHERE automation_key='ACCOUNTING_MISSING:ACC-COMP-T-FOOD') WHERE id='ACC-COMP-T-FOOD'").run();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO accounting_exports (id,export_type,period,document_count,amount_minor,status,file_ref,created_by) VALUES ('ACC-EXP-T-1C-0826','Пакет для 1С','2026-08',4,51050000,'Подготовлен','EXPORT:SYNTHETIC:1C:2026-08','system-accounting-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO accounting_integrations (id,system,mode,status,truth,last_success_at,next_attempt_at,record_count,error) VALUES ('ACC-INT-T-EDO','ЭДО','Только после согласования','Не подключён','Статусы подписания подтверждаются вручную; API и оператор ЭДО отсутствуют','','',0,'Нет утверждённого оператора и токена')"),
    env.DB.prepare("INSERT OR IGNORE INTO accounting_integrations (id,system,mode,status,truth,last_success_at,next_attempt_at,record_count,error) VALUES ('ACC-INT-T-1C','1С','Экспортный пакет','Не подключён','Создаётся только тестовый реестр выгрузки; передачи в 1С нет','','',0,'Интеграция ожидает согласования')"),
  ]);
}

async function seedStrategy(){
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES ('STR-PRJ-T-014','Проект','Семейные проектные субботы · тест','Активна','SYNTHETIC_STRATEGY_TEST','STRATEGY-PROJECT-014','Синтетическая карточка','Школа 1–11','{}','system-strategy-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES ('EMP-T-PROJ-001','Сотрудник','Руководитель проектов T-P01','Активна','SYNTHETIC_STRATEGY_TEST','EMPLOYEE-PROJECT-001','Синтетическая карточка','Управляющая компания','{}','system-strategy-seed')"),
  ]);
  const goals=[
    ["GOAL-T-2026-01","Компания","","Увеличить подтверждённую ценность для семей","2026/27","EMP-T-004","В работе","Индекс удовлетворённости ≥ 80 и не менее 4 проверенных инициатив"],
    ["GOAL-T-2026-02","Подразделение","UNT-T-001","Усилить проектное обучение школы","2026/27","EMP-T-032","В работе","Не менее 70% семей участвуют в одном проектном событии"],
  ];
  await env.DB.batch(goals.map(row=>env.DB.prepare("INSERT OR IGNORE INTO strategy_goals (id,level,unit_entity_id,title,period,owner_entity_id,status,success_definition) VALUES (?,?,?,?,?,?,?,?)").bind(...row)));
  const kpis=[
    ["KPI-T-FAMILY-01","GOAL-T-2026-01","Индекс удовлетворённости семей","%",80,72,76,-8,"Отклонение","FDB-T-014 + SYNTHETIC_SURVEY_TEST","2026-08-21T08:00:00Z"],
    ["KPI-T-PROJECT-01","GOAL-T-2026-02","Доля семей-участников","%",70,64,71,-6,"На границе","EVENT-T-071 + EVENT-T-0824","2026-08-21T08:00:00Z"],
  ];
  await env.DB.batch(kpis.map(row=>env.DB.prepare("INSERT OR IGNORE INTO strategy_kpis (id,goal_id,name,unit,target_value,actual_value,forecast_value,variance_value,status,source_ref,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  await env.DB.prepare("INSERT OR IGNORE INTO strategy_initiatives (id,goal_id,kpi_id,title,hypothesis,owner_entity_id,planned_start,planned_end,status) VALUES ('INIT-T-014','GOAL-T-2026-01','KPI-T-FAMILY-01','Семейные проектные субботы','Совместный результат и короткая обратная связь повысят измеримую ценность программы','EMP-T-PROJ-001','2026-08-01','2026-10-31','Пилот')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO strategy_projects (id,initiative_id,goal_id,title,owner_entity_id,budget_id,budget_plan_minor,budget_actual_minor,started_at,due_at,status,outcome) VALUES ('STR-PRJ-T-014','INIT-T-014','GOAL-T-2026-01','Пилот семейных проектных суббот','EMP-T-PROJ-001','BUD-2026-08-OUT',120000000,85000000,'2026-08-01','2026-10-31','В работе','Пилот 1 проведён; решение масштабировать после второго события')").run();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO tasks (title,owner,due_date,priority,status,source_type,source_id,description,assignee_entity_id,kind,automation_key,requires_approval,result,result_evidence,completed_at,created_by) VALUES ('Подготовить пилот семейной проектной субботы','Руководитель проектов','2026-08-15','Высокий','Завершена','Проект','STR-PRJ-T-014','Программа, участники, бюджет и форма обратной связи','EMP-T-PROJ-001','Проектная задача','PROJECT:STR-PRJ-T-014:MILESTONE:1',1,'Пилот проведён','EVENT-T-071','2026-08-17T16:00:00Z','system-strategy-seed')"),
    env.DB.prepare("INSERT OR IGNORE INTO tasks (title,owner,due_date,priority,status,source_type,source_id,description,assignee_entity_id,kind,automation_key,requires_approval,created_by) VALUES ('Скорректировать сценарий обратной связи семей','Руководитель проектов','2026-08-28','Высокий','В работе','Отклонение KPI','DEV-T-KPI-01','Индекс 72 при цели 80; проверить второй формат события и структуру опроса','EMP-T-PROJ-001','Корректирующее действие','STRATEGY_DEVIATION:DEV-T-KPI-01',1,'system-strategy-seed')"),
  ]);
  const events=[
    ["EVENT-T-071","STR-PRJ-T-014","Семейная проектная суббота · пилот 1","2026-08-17T11:00:00Z","Школа · проектная лаборатория","EMP-T-PROJ-001",60000000,42000000,"Проведено","28 семей завершили общий проект",86],
    ["EVENT-T-0824","STR-PRJ-T-014","Семейная проектная суббота · пилот 2","2026-08-24T11:00:00Z","Школа · актовый зал","EMP-T-PROJ-001",60000000,43000000,"Запланировано","",0],
  ];
  await env.DB.batch(events.map(row=>env.DB.prepare("INSERT OR IGNORE INTO business_events (id,project_id,title,event_at,location,responsible_entity_id,budget_minor,actual_minor,status,result,feedback_score) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const participants=[
    ["EVP-T-071-01","EVENT-T-071","FAM-T-014","Семья","Участвовал","Понятный итог и хорошая совместная работа"],
    ["EVP-T-071-02","EVENT-T-071","EMP-T-032","Педагог","Участвовал","Нужна более короткая вводная часть"],
    ["EVP-T-0824-01","EVENT-T-0824","FAM-T-021","Семья","Приглашён",""],
  ];
  await env.DB.batch(participants.map(row=>env.DB.prepare("INSERT OR IGNORE INTO event_participants (id,event_id,participant_entity_id,participant_role,attendance_status,feedback) VALUES (?,?,?,?,?,?)").bind(...row)));
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO strategy_results (id,project_id,event_id,result_type,metric_name,metric_value,unit,evidence,recorded_at) VALUES ('STR-RES-T-071','STR-PRJ-T-014','EVENT-T-071','Событие','Удовлетворённость участников',86,'%','28 семей; 2 обезличенных примера обратной связи','2026-08-17T16:30:00Z')"),
    env.DB.prepare("INSERT OR IGNORE INTO strategy_deviations (id,kpi_id,project_id,deviation_type,variance_value,explanation,decision,status,related_task_id,detected_at) VALUES ('DEV-T-KPI-01','KPI-T-FAMILY-01','STR-PRJ-T-014','Ниже цели',-8,'Индекс 72 при цели 80; выборка и формулировки опроса требуют проверки','Провести второй формат, повторить измерение и решить о масштабировании',(SELECT CASE WHEN 1=1 THEN 'В работе' END),(SELECT id FROM tasks WHERE automation_key='STRATEGY_DEVIATION:DEV-T-KPI-01'),'2026-08-21T08:00:00Z')"),
  ]);
}

async function seedIntegrations(){
  await env.DB.prepare("INSERT OR IGNORE INTO entities (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by) VALUES ('EMP-T-INT-001','Сотрудник','Администратор интеграций T-I01','Активна','SYNTHETIC_INTEGRATION_TEST','EMPLOYEE-INTEGRATIONS-001','Синтетическая карточка','Платформенное ядро','{}','system-integration-seed')").run();
  const connections=[
    ["INT-T-D1","ArtHello OS D1","Внутренняя платформа","Все модули","EMP-T-INT-001","ArtHello OS D1","Binding · read/write","Работает","Сервисная привязка активна","","2026-08-21T09:30:00Z","2026-08-21T09:45:00Z",1,1,0,0,0,"Критичное: без D1 недоступны рабочие записи","d1-core@1",1,1],
    ["INT-T-ODDS","Атлас ОДДС.xlsx","Файловый импорт","Финансы","EMP-T-ACC-001","Атлас ОДДС 01.01.2023–31.01.2026.xlsx","Контролируемый snapshot","Файл проверен","Ключ не требуется","","2026-08-21T07:40:00Z","",4,4,0,0,2,"Среднее: без обновления устаревает управленческий ДДС","xlsx-odds@1",1,0],
    ["INT-T-PAYROLL","Зарплатная ведомость.xlsx","Файловый импорт","HR · Финансы","EMP-T-ACC-001","Зарплатная ведомость.xlsx","Контролируемый snapshot","На проверке","Ключ не требуется","","2026-08-21T07:45:00Z","",114,112,2,0,2,"Высокое: кадровые агрегаты требуют дедупликации","xlsx-payroll@1",1,0],
    ["INT-T-PAYMENTS","Ежемесячные оплаты.xlsx","Файловый импорт","Финансы · Клиенты","EMP-T-ACC-001","Ежемесячные оплаты.xlsx","Контролируемый snapshot","Устарел","Ключ не требуется","","2026-08-21T07:50:00Z","",4,4,0,0,1,"Высокое: новые оплаты не поступают после июня 2026","xlsx-payments@1",1,0],
    ["INT-T-TOCHKA","Банк Точка","Банк","Финансы","ROLE:OWNER","Банк Точка","Защищённое подключение · проверка компании и доступных счетов","Ожидает доступ","Не настроена","","","",0,0,0,0,0,"Критичное: загрузка банковских операций Точки ещё не реализована","bank-tochka@1",0,0],
    ["INT-T-TBANK","Т‑Банк","Банк","Финансы","ROLE:OWNER","Официальный интерфейс Т‑Банка для бизнеса","Прямое подключение · только чтение счетов и короткой выписки","Ожидает доступ","Не настроена","","","",0,0,0,0,0,"Критичное: доступ можно проверить, но операции не импортируются и платежи не создаются","tbank-h2h-readonly@1",0,0],
    ["INT-T-ALFACRM","AlfaCRM","CRM","Продажи · Клиенты","EMP-T-SALES-001","AlfaCRM","API · двусторонний","Ожидает доступ","Не настроена","","","После выдачи доступа",0,0,0,1,0,"Высокое: лиды и статусы синхронизируются вручную","alfacrm@0",0,0],
    ["INT-T-DIARY","Электронный дневник","Образование","Обучение","EMP-T-METHOD-001","Утверждённый электронный дневник","API · чтение","Не подключён","Провайдер не утверждён","","","После выбора провайдера",0,0,0,0,0,"Высокое: расписание и посещаемость не обновляются","diary@0",0,0],
    ["INT-T-FORMS","Формы сайта","Маркетинг","Продажи","EMP-T-MKT-001","Формы сайта ArtHello","Webhook · входящие заявки","Ожидает доступ","Webhook не настроен","","","После настройки webhook",0,0,0,0,0,"Высокое: first-click и заявки не поступают автоматически","web-forms@0",0,0],
    ["INT-T-PHONE","Телефония","Коммуникации","Продажи","EMP-T-SALES-001","Утверждённая телефония","Webhook · события звонков","Не подключён","Провайдер не утверждён","","","После выбора провайдера",0,0,0,0,0,"Среднее: звонки фиксируются вручную","telephony@0",0,0],
    ["INT-T-ADS","Рекламные кабинеты","Маркетинг","Контент · Продажи","EMP-T-MKT-001","Рекламные платформы","API · статистика","Ожидает доступ","Не настроена","","","После выдачи доступа",0,0,0,0,0,"Среднее: стоимость лида не подтверждается платформой","ads@0",0,0],
    ["INT-T-SOCIAL","Социальные сети","Контент","Контент · Продажи","EMP-T-MKT-001","Социальные платформы","API · публикации и метрики","Ожидает доступ","Не настроена","","","После выдачи доступа",0,0,0,0,0,"Среднее: охваты и переходы остаются тестовыми","social@0",0,0],
    ["INT-T-EDO","ЭДО","Документы","Бухгалтерия · Юрист","EMP-T-ACC-001","Утверждённый оператор ЭДО","API · документы и подписи","Не подключён","Оператор не утверждён","","","После выбора оператора",0,0,0,0,0,"Высокое: подписи подтверждаются вручную","edo@0",0,0],
    ["INT-T-1C","1С","Учёт","Бухгалтерия","EMP-T-ACC-001","1С","Контролируемый импорт/экспорт","Не подключён","Контур и доступ не предоставлены","","","После предоставления тестовой базы",0,0,0,0,0,"Высокое: пакет только готовится, но не передаётся","1c@0",0,0],
    ["INT-T-ACS","СКУД","Безопасность","Безопасность","EMP-T-SAFE-001","СКУД объектов","API · события доступа","Не подключён","Контроллеры не предоставлены","","","После инвентаризации контроллеров",0,0,0,0,0,"Критичное: события доступа не поступают","acs@0",0,0],
    ["INT-T-CAM","Камеры","Безопасность","Безопасность","EMP-T-SAFE-001","VMS объектов","События без видеопотока","Не подключён","VMS не предоставлена","","","После утверждения VMS",0,0,0,0,0,"Среднее: видео и события камер не поступают","cameras@0",0,0],
    ["INT-T-TG","Telegram","Коммуникации","Задачи · Клиенты","EMP-T-INT-001","Telegram Bot API","Webhook · уведомления","Ожидает доступ","Токен не настроен","","","После выдачи bot token",0,0,0,0,0,"Среднее: уведомления остаются внутри системы","telegram@0",0,0],
    ["INT-T-MAIL","Сервис рассылок","Коммуникации","Клиенты · Контент","EMP-T-MKT-001","Утверждённый сервис рассылок","API · отправка и статусы","Не подключён","Провайдер не утверждён","","","После выбора провайдера",0,0,0,0,0,"Среднее: массовые сообщения не отправляются","mailing@0",0,0]
    ,["INT-T-OPENAI-IMAGES","OpenAI Images","Контент","Контент · Студия","EMP-T-MKT-001","OpenAI Images API","API · генерация и редактирование","Ожидает доступ","API-ключ не настроен","","","После безопасной передачи ключа",0,0,0,0,0,"Среднее: генерация изображений недоступна","openai-images@0",0,0]
  ];
  await env.DB.batch(connections.map(row=>env.DB.prepare("INSERT OR IGNORE INTO integration_connections (id,system,category,target_module,owner_entity_id,source_of_truth,mode,status,auth_status,credential_expires_at,last_success_at,next_sync_at,received_count,accepted_count,rejected_count,error_count,conflict_count,impact,adapter_version,verified_transfer,is_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const runs=[
    ["INT-RUN-T-D1-01","INT-T-D1","2026-08-21T09:30:00Z","2026-08-21T09:30:01Z","Плановая проверка","Успешно",1,1,0,0,0,"D1:health:ok","","system-integration-seed","CORR-T-D1-01",0],
    ["INT-RUN-T-ODDS-01","INT-T-ODDS","2026-08-21T07:39:00Z","2026-08-21T07:40:00Z","Ручной импорт","Завершено с конфликтами",4,4,0,0,2,"sheet:2026:apr","","system-integration-seed","CORR-T-ODDS-01",0],
    ["INT-RUN-T-PAYROLL-01","INT-T-PAYROLL","2026-08-21T07:43:00Z","2026-08-21T07:45:00Z","Ручной импорт","Завершено с конфликтами",114,112,2,0,2,"sheet:COMMON:114","Два совпадающих имени требуют ручной сверки","system-integration-seed","CORR-T-PAYROLL-01",0],
    ["INT-RUN-T-PAYMENTS-01","INT-T-PAYMENTS","2026-08-21T07:48:00Z","2026-08-21T07:50:00Z","Ручной импорт","Успешно",4,4,0,0,1,"period:2026-06","Источник прочитан, но устарел относительно текущей даты","system-integration-seed","CORR-T-PAYMENTS-01",0],
    ["INT-RUN-T-CRM-PREFLIGHT","INT-T-ALFACRM","2026-08-21T08:05:00Z","2026-08-21T08:05:01Z","Проверка готовности","Заблокировано",0,0,0,1,0,"preflight:auth","API-ключ и тестовый endpoint не предоставлены","system-integration-seed","CORR-T-CRM-PREFLIGHT",1]
  ];
  for (const row of runs) {
    await env.DB.prepare("INSERT INTO integration_sync_runs (id,connection_id,started_at,finished_at,trigger,status,received_count,accepted_count,rejected_count,error_count,conflict_count,checkpoint,error_message,initiated_by,correlation_id,dry_run) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(...row).run();
  }
  const logs=[
    ["INT-RUN-T-D1-01","INT-T-D1","INFO","health.verified","D1 binding отвечает; чтение рабочих таблиц подтверждено","D1:health"],
    ["INT-RUN-T-ODDS-01","INT-T-ODDS","INFO","file.read","Прочитаны четыре листа, исходный файл не изменён","01-01.01.2023-31.01.2026.xlsx"],
    ["INT-RUN-T-ODDS-01","INT-T-ODDS","WARN","quality.conflict","Два расхождения исходных итогов вынесены в очередь","2026:apr"],
    ["INT-RUN-T-PAYROLL-01","INT-T-PAYROLL","WARN","identity.conflict","Совпадения не объединены автоматически","COMMON:rows"],
    ["INT-RUN-T-PAYMENTS-01","INT-T-PAYMENTS","WARN","freshness.stale","Последний найденный период — июнь 2026","period:2026-06"],
    ["INT-RUN-T-CRM-PREFLIGHT","INT-T-ALFACRM","ERROR","auth.missing","Синхронизация не запускалась: отсутствует API-ключ","auth"]
  ];
  for (const row of logs) {
    await env.DB.prepare("INSERT INTO integration_log_entries (run_id,connection_id,level,event,message,record_ref) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM integration_log_entries WHERE run_id=? AND event=? AND record_ref=?)").bind(...row,row[0],row[3],row[5]).run();
  }
  const conflicts=[
    ["INT-CNF-T-ODDS-01","INT-T-ODDS","2026:APR:OUTFLOW","","Исходный итог","Списания апреля","Сумма детальных строк","Итоговая строка файла","EMP-T-ACC-001","Открыт","","","2026-08-21T07:40:00Z"],
    ["INT-CNF-T-PAYROLL-01","INT-T-PAYROLL","COMMON:DUPLICATE:01","","Возможный дубль","Сотрудник","Две строки с совпадающим именем","Отдельные карточки до проверки","EMP-T-HR-001","Открыт","","","2026-08-21T07:45:00Z"],
    ["INT-CNF-T-PAYMENTS-01","INT-T-PAYMENTS","PERIOD:LAST","","Свежесть","Последний период","2026-06","2026-08","EMP-T-ACC-001","Открыт","","","2026-08-21T07:50:00Z"]
  ];
  for (const row of conflicts) {
    await env.DB.prepare("INSERT INTO integration_conflicts (id,connection_id,external_record_id,internal_entity_id,conflict_type,field_name,source_value,target_value,owner_entity_id,status,resolution,evidence,detected_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(...row).run();
  }
}

export type IntegrationTestDataStatus = {
  active: boolean;
  connections: number;
  runs: number;
  logs: number;
  conflicts: number;
  total: number;
  scope: string;
};

async function ensureIntegrationDemoBootstrap() {
  if (await getSystemDataMode() === "empty") return;
  const marker = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key='integration_demo_bootstrap'"
  ).first<{ state_value: string }>();
  if (marker?.state_value === INTEGRATION_DEMO_BOOTSTRAP_VERSION) return;

  const before = await getIntegrationTestDataStatus();
  if (!integrationDemoComplete(before)) await seedIntegrations();
  const after = await getIntegrationTestDataStatus();
  if (!integrationDemoComplete(after)) {
    throw new Error(`Integration demo bootstrap incomplete: ${after.connections}/${after.runs}/${after.logs}/${after.conflicts}`);
  }

  await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('integration_demo_bootstrap',?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(INTEGRATION_DEMO_BOOTSTRAP_VERSION)
    .run();
}

export async function getIntegrationTestDataStatus(): Promise<IntegrationTestDataStatus> {
  const [connectionRow, runRow, logRow, conflictRow] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM integration_connections").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM integration_sync_runs").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM integration_log_entries").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM integration_conflicts").first<{ total: number }>(),
  ]);
  const connections = Number(connectionRow?.total ?? 0);
  const runs = Number(runRow?.total ?? 0);
  const logs = Number(logRow?.total ?? 0);
  const conflicts = Number(conflictRow?.total ?? 0);
  const demoRecords = runs + logs + conflicts;
  return {
    active: demoRecords > 0,
    connections,
    runs,
    logs,
    conflicts,
    total: demoRecords,
    scope: "Тестовые запуски, журналы и конфликты Центра интеграций. Каталог провайдеров остаётся, чтобы после очистки можно было подключить реальные источники.",
  };
}

export async function addIntegrationTestData(actor: string) {
  if (await getSystemDataMode() === "empty") {
    throw new Error("Тестовые данные нельзя добавить, пока система работает в пустом режиме");
  }
  await clearIntegrationTestData(false);
  await seedIntegrations();
  const status = await getIntegrationTestDataStatus();
  if (!integrationDemoComplete(status)) {
    throw new Error(`Integration demo seed incomplete: ${status.connections}/${status.runs}/${status.logs}/${status.conflicts}`);
  }
  await writeIntegrationDatasetAudit(actor, "integration.test_data_added", status);
  return status;
}

function integrationDemoComplete(status: IntegrationTestDataStatus) {
  return status.connections >= 19 && status.runs >= 5 && status.logs >= 6 && status.conflicts >= 3;
}

export async function removeIntegrationTestData(actor: string) {
  const before = await getIntegrationTestDataStatus();
  await clearIntegrationTestData(true);
  const status = await getIntegrationTestDataStatus();
  await writeIntegrationDatasetAudit(actor, "integration.test_data_removed", { before, after: status });
  return status;
}

async function clearIntegrationTestData(keepCatalog = false) {
  const statements = [
    env.DB.prepare("DELETE FROM integration_log_entries"),
    env.DB.prepare("DELETE FROM integration_conflicts"),
    env.DB.prepare("DELETE FROM integration_sync_runs"),
    env.DB.prepare("DELETE FROM tasks WHERE source_type='Конфликт интеграции' AND source_id LIKE 'INT-CNF-T-%'"),
  ];
  if (!keepCatalog) {
    statements.push(
      env.DB.prepare("DELETE FROM integration_connections"),
      env.DB.prepare("DELETE FROM entities WHERE id='EMP-T-INT-001' AND created_by='system-integration-seed'"),
    );
  } else {
    statements.push(env.DB.prepare(`UPDATE integration_connections SET
      received_count=0,accepted_count=0,rejected_count=0,error_count=0,conflict_count=0,
      last_success_at=CASE WHEN id='INT-T-D1' THEN last_success_at ELSE '' END,
      updated_at=CURRENT_TIMESTAMP`));
  }
  await env.DB.batch(statements);
}

async function writeIntegrationDatasetAudit(actor: string, action: string, payload: unknown) {
  await env.DB.prepare(
    "INSERT INTO audit_events (actor,action,entity_type,entity_id,payload) VALUES (?,?,?,?,?)"
  ).bind(actor, action, "integration_test_dataset", "INTEGRATION-DEMO", JSON.stringify(payload)).run();
}

export type IntegrationSetup = {
  connectionId: string;
  authMethod: string;
  startDate: string;
  syncIntervalMinutes: number;
  syncMinute: number;
  endpoint: string;
  legalEntityId: string;
  customerCode: string;
  branchId: string;
  allocationMode: "single_branch" | "classify_transactions";
  accountScope: string;
  channelType: string;
  sourceMapping: string;
  dataScopes: string[];
  readOnlyScopeConfirmed: boolean;
  credentialGeneration: string;
  secretStatus: "missing" | "stored" | "external_required";
  updatedAt: string;
  updatedBy: string;
};

const integrationSetupPrefix = "integration_setup:";
const integrationCredentialPrefix = "integration_credential:v2:";
const tochkaCompanySelectionPrefix = "integration_company_selection:v1:";
const tochkaConnectionId = "INT-T-TOCHKA";
const tbankConnectionId = "INT-T-TBANK";
const tbankCredentialScope = "bank-read-v1";
const tochkaCompanySelectionTtlMs = 5 * 60_000;

type TochkaCompanySelectionPayload = {
  version: 1;
  legalEntityId: string;
  customerCode: string;
  credentialDigest: string;
  issuedTo: string;
  expiresAtMs: number;
};

export type TochkaCompanySelectionHandle = { id: string; name: string };
export type TochkaCompanySelectionResult =
  | { ok: true; customerCode: string }
  | { ok: false; reason: string };

type EncryptedIntegrationCredential = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  updatedAt: string;
  updatedBy: string;
};

export async function getIntegrationSetups(): Promise<Record<string, IntegrationSetup>> {
  const [setupRows, credentialRows] = await Promise.all([
    env.DB.prepare(
      "SELECT state_key,state_value FROM system_runtime_state WHERE state_key LIKE 'integration_setup:%'"
    ).all<{ state_key: string; state_value: string }>(),
    env.DB.prepare(
      "SELECT state_key FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:%'"
    ).all<{ state_key: string }>(),
  ]);
  const storedCredentialKeys = new Set((credentialRows.results ?? []).map((row: { state_key: string }) => row.state_key));
  const result: Record<string, IntegrationSetup> = {};
  for (const row of setupRows.results ?? []) {
    try {
      const value = JSON.parse(row.state_value) as IntegrationSetup;
      const connectionId = row.state_key.slice(integrationSetupPrefix.length);
      const legalEntityId = String(value.legalEntityId ?? "").trim().slice(0, 80);
      const customerCode = String(value.customerCode ?? "").trim().slice(0, 80);
      const tochkaJwt = connectionId === tochkaConnectionId && value.authMethod === "JWT";
      const tbankToken = connectionId === tbankConnectionId && value.authMethod === "Bearer token";
      const credentialScope = tbankToken ? tbankCredentialScope : customerCode;
      result[connectionId] = {
        ...value,
        connectionId,
        endpoint: normalizeStoredIntegrationEndpoint(value.endpoint),
        legalEntityId,
        customerCode,
        allocationMode: value.allocationMode === "single_branch" ? "single_branch" : "classify_transactions",
        accountScope: value.accountScope || (tochkaJwt || tbankToken ? "all_permitted" : ""),
        readOnlyScopeConfirmed: connectionId === tbankConnectionId && value.readOnlyScopeConfirmed === true,
        credentialGeneration: normalizeCredentialGeneration(value.credentialGeneration),
        secretStatus: tochkaJwt || tbankToken
          ? credentialScope && storedCredentialKeys.has(integrationCredentialStateKey(connectionId, legalEntityId, credentialScope)) ? "stored" : "missing"
          : value.secretStatus === "stored" ? "stored" : "external_required",
      };
    } catch {
      // A malformed setup is ignored and remains visible as not configured.
    }
  }
  return result;
}

type PreparedIntegrationSetup = {
  setup: IntegrationSetup;
  protectedBankConnection: boolean;
  protectedBankCredential: boolean;
};

export async function validateIntegrationSetupReferences(input: Partial<IntegrationSetup>) {
  const connectionId = String(input.connectionId ?? "").trim().toUpperCase().slice(0, 80);
  if (!connectionId) throw new Error("Не выбрана интеграция");
  const connection = await env.DB.prepare("SELECT id FROM integration_connections WHERE id=?")
    .bind(connectionId).first<{ id: string }>();
  if (!connection) throw new Error("Интеграция не найдена");
  const bankConnection = connectionId === tochkaConnectionId || connectionId === tbankConnectionId;
  const legalEntityId = String(input.legalEntityId ?? "").trim().slice(0, 80);
  const allocationMode: IntegrationSetup["allocationMode"] = input.allocationMode === "single_branch" ? "single_branch" : "classify_transactions";
  const branchId = String(input.branchId ?? "").trim().slice(0, 80);
  if (bankConnection && !legalEntityId) throw new Error("Выберите юридическое лицо");
  if (bankConnection) {
    const legalEntity = await env.DB.prepare("SELECT id FROM entities WHERE id=? AND entity_type='Юрлицо' LIMIT 1")
      .bind(legalEntityId).first<{ id: string }>();
    if (!legalEntity) throw new Error("Выберите существующую карточку юридического лица");
  }
  const requiresBranch = !bankConnection || allocationMode === "single_branch";
  if (requiresBranch && !branchId) {
    throw new Error("Выберите филиал назначения");
  }
  if (requiresBranch && branchId) {
    const branch = await env.DB.prepare("SELECT id FROM organization_branches WHERE id=? AND status='Активен' LIMIT 1")
      .bind(branchId).first<{ id: string }>();
    if (!branch) throw new Error("Выберите действующий филиал");
  }
  return { connectionId, bankConnection, legalEntityId, allocationMode, branchId };
}

async function prepareIntegrationSetup(
  actor: string,
  input: Partial<IntegrationSetup>,
  forceStoredCredential = false,
): Promise<PreparedIntegrationSetup> {
  const references = await validateIntegrationSetupReferences(input);
  const { connectionId, bankConnection, legalEntityId, allocationMode, branchId } = references;
  const protectedBankConnection = connectionId === tochkaConnectionId || connectionId === tbankConnectionId;
  const tochkaReadOnlyImport = connectionId === tochkaConnectionId;
  const startDate = protectedBankConnection && !tochkaReadOnlyImport ? "" : String(input.startDate ?? "").trim().slice(0, 10);
  if ((!protectedBankConnection || tochkaReadOnlyImport) && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Укажите дату начала загрузки");
  const interval = protectedBankConnection && !tochkaReadOnlyImport
    ? 0
    : [60, 180, 360, 1440].includes(Number(input.syncIntervalMinutes))
    ? Number(input.syncIntervalMinutes)
    : 60;
  const minute = protectedBankConnection && !tochkaReadOnlyImport ? 0 : Math.min(59, Math.max(0, Number(input.syncMinute) || 0));
  const authMethod = String(input.authMethod ?? "").trim().slice(0, 80);
  const tochkaJwt = connectionId === tochkaConnectionId && authMethod === "JWT";
  const tbankToken = connectionId === tbankConnectionId && authMethod === "Bearer token";
  const protectedBankCredential = tochkaJwt || tbankToken;
  const customerCode = String(input.customerCode ?? "").trim().slice(0, 80);
  const credentialScope = tbankToken ? tbankCredentialScope : customerCode;
  if (connectionId === tochkaConnectionId && customerCode && !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(customerCode)) {
    throw new Error("Некорректно указана компания Точки");
  }
  const credentialStored = protectedBankCredential && (
    forceStoredCredential || Boolean(credentialScope && await hasIntegrationCredential(connectionId, legalEntityId, credentialScope))
  );
  const updatedAt = new Date().toISOString();
  const setup: IntegrationSetup = {
    connectionId,
    authMethod,
    startDate,
    syncIntervalMinutes: interval,
    syncMinute: minute,
    endpoint: protectedBankConnection ? "" : normalizeSubmittedIntegrationEndpoint(input.endpoint),
    legalEntityId,
    customerCode: connectionId === tochkaConnectionId ? customerCode : "",
    branchId: bankConnection && allocationMode === "classify_transactions" ? "" : branchId,
    allocationMode,
    accountScope: bankConnection ? "all_permitted" : String(input.accountScope ?? "").trim().slice(0, 160),
    channelType: String(input.channelType ?? "").trim().slice(0, 80),
    sourceMapping: String(input.sourceMapping ?? "").trim().slice(0, 500),
    dataScopes: connectionId === tochkaConnectionId
      ? ["Счета", "Выписки", "Операции и платежи", "Реестр операций", "Остатки"]
      : Array.isArray(input.dataScopes) ? input.dataScopes.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 30) : [],
    readOnlyScopeConfirmed: connectionId === tbankConnectionId && input.readOnlyScopeConfirmed === true,
    credentialGeneration: protectedBankConnection ? crypto.randomUUID() : "",
    secretStatus: protectedBankCredential ? credentialStored ? "stored" : "missing" : "external_required",
    updatedAt,
    updatedBy: actor,
  };
  if (!setup.dataScopes.length) throw new Error("Выберите, какие данные получать");
  return { setup, protectedBankConnection, protectedBankCredential };
}

async function persistIntegrationSetup(
  actor: string,
  prepared: PreparedIntegrationSetup,
  baseline: Pick<IntegrationSetup, "credentialGeneration" | "updatedAt"> | null = null,
) {
  const { setup, protectedBankConnection, protectedBankCredential } = prepared;
  const saveSetupStatement = env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(`${integrationSetupPrefix}${setup.connectionId}`, JSON.stringify(setup));
  const updateConnectionStatement = env.DB.prepare(`UPDATE integration_connections SET
    auth_status=?,
    next_sync_at=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      protectedBankCredential
        ? setup.secretStatus === "stored" ? "Ключ сохранён · требуется проверка банка" : "Настройка сохранена · ключ требуется"
        : "Настройка сохранена · секрет требуется",
      protectedBankConnection
        ? ""
        : "После безопасной передачи секрета",
      setup.connectionId,
    );
  const auditPayload = JSON.stringify({
    connectionId: setup.connectionId,
    selectedLegalEntityId: setup.legalEntityId,
    companySelectionConfirmed: Boolean(setup.customerCode),
    accountScope: setup.accountScope,
    allocationMode: setup.allocationMode,
    startDate: setup.startDate,
    syncIntervalMinutes: setup.syncIntervalMinutes,
    syncMinute: setup.syncMinute,
    accessMethod: setup.connectionId === tochkaConnectionId
      ? "Ключ Точки"
      : setup.connectionId === tbankConnectionId
        ? "Токен Т‑Банка"
        : setup.authMethod,
    dataScopes: setup.dataScopes,
    limitedPermissionsConfirmedByOwner: setup.connectionId === tbankConnectionId
      ? setup.readOnlyScopeConfirmed
      : undefined,
    secretStored: setup.secretStatus === "stored",
  });
  if (protectedBankConnection) {
    const setupStateKey = `${integrationSetupPrefix}${setup.connectionId}`;
    const guard = baseline
      ? `EXISTS (SELECT 1 FROM system_runtime_state
          WHERE state_key=?
            AND COALESCE(json_extract(state_value,'$.credentialGeneration'),'')=?
            AND COALESCE(json_extract(state_value,'$.updatedAt'),'')=?)`
      : "NOT EXISTS (SELECT 1 FROM system_runtime_state WHERE state_key=?)";
    const guardBindings = baseline
      ? [setupStateKey, normalizeCredentialGeneration(baseline.credentialGeneration), baseline.updatedAt]
      : [setupStateKey];
    const statements = [];
    if (setup.secretStatus !== "stored") {
      statements.push(env.DB.prepare(`DELETE FROM system_runtime_state
        WHERE state_key LIKE ? AND ${guard}`)
        .bind(integrationCredentialConnectionPattern(setup.connectionId), ...guardBindings));
    }
    statements.push(
      env.DB.prepare(`UPDATE integration_connections SET
        auth_status=?,next_sync_at='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${guard}`)
        .bind(
          protectedBankCredential
            ? setup.secretStatus === "stored" ? "Ключ сохранён · требуется проверка банка" : "Настройка сохранена · ключ требуется"
            : "Настройка сохранена · секрет требуется",
          setup.connectionId,
          ...guardBindings,
        ),
      env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
        SELECT ?,'integration.setup_saved','integration_test_dataset','INTEGRATION-DEMO',? WHERE ${guard}`)
        .bind(actor, auditPayload, ...guardBindings),
      env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
        SELECT ?,?,CURRENT_TIMESTAMP WHERE ${guard}
        ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
        .bind(setupStateKey, JSON.stringify(setup), ...guardBindings),
    );
    const results = await env.DB.batch(statements);
    const setupResult = results.at(-1) as { meta?: { changes?: number } } | undefined;
    return Number(setupResult?.meta?.changes ?? 0) > 0;
  } else {
    await env.DB.batch([
      saveSetupStatement,
      updateConnectionStatement,
      env.DB.prepare("INSERT INTO audit_events (actor,action,entity_type,entity_id,payload) VALUES (?,?,?,?,?)")
        .bind(actor, "integration.setup_saved", "integration_test_dataset", "INTEGRATION-DEMO", auditPayload),
    ]);
    return true;
  }
}

export async function saveIntegrationSetup(actor: string, input: Partial<IntegrationSetup>) {
  const connectionId = String(input.connectionId ?? "").trim().toUpperCase().slice(0, 80);
  const protectedBankConnection = connectionId === tochkaConnectionId || connectionId === tbankConnectionId;
  const baseline = protectedBankConnection
    ? (await getIntegrationSetups())[connectionId] ?? null
    : null;
  const prepared = await prepareIntegrationSetup(actor, input);
  const saved = await persistIntegrationSetup(actor, prepared, baseline);
  if (!saved) throw new Error("Настройка банка изменилась во время сохранения. Повторите действие.");
  return prepared.setup;
}

export async function saveTochkaSetupWithCredential(
  actor: string,
  input: Partial<IntegrationSetup>,
  value: unknown,
  baseline: Pick<IntegrationSetup, "credentialGeneration" | "updatedAt"> | null,
) {
  const prepared = await prepareIntegrationSetup(actor, input, true);
  const { setup } = prepared;
  if (setup.connectionId !== tochkaConnectionId || setup.authMethod !== "JWT" || !setup.customerCode) {
    throw new Error("Ключ принимается только для подтверждённого подключения банка Точка");
  }
  const credential = await encryptIntegrationCredential(
    actor,
    setup.connectionId,
    setup.legalEntityId,
    setup.customerCode,
    value,
  );
  const setupAudit = JSON.stringify({
    connectionId: setup.connectionId,
    selectedLegalEntityId: setup.legalEntityId,
    companySelectionConfirmed: true,
    accountScope: setup.accountScope,
    allocationMode: setup.allocationMode,
    startDate: setup.startDate,
    syncIntervalMinutes: setup.syncIntervalMinutes,
    syncMinute: setup.syncMinute,
    accessMethod: "Ключ Точки",
    dataScopes: setup.dataScopes,
    secretStored: true,
  });
  const credentialAudit = JSON.stringify({
    connectionId: credential.connectionId,
    selectedLegalEntityId: credential.legalEntityId,
    credentialEnvelopeStored: true,
    version: credential.envelope.version,
    algorithm: credential.envelope.algorithm,
  });
  const saved = await persistBankSetupWithCredentialCas(
    actor,
    setup,
    credential,
    baseline,
    setupAudit,
    credentialAudit,
    "Ключ Точки сохранён · требуется проверка банка",
  );
  return saved ? setup : null;
}

export async function createTochkaCompanySelectionHandles(
  actorValue: string,
  legalEntityIdValue: string,
  credentialValue: unknown,
  choicesValue: Array<{ code: string; name: string }>,
  nowMs = Date.now(),
): Promise<TochkaCompanySelectionHandle[]> {
  const actor = String(actorValue ?? "").trim().slice(0, 120);
  if (!actor) throw new Error("Не определён пользователь выбора компании");
  const legalEntityId = normalizeIntegrationCredentialScope(legalEntityIdValue, "юридическое лицо");
  const credentialDigest = await integrationCredentialDigest(credentialValue);
  const expiresAtMs = nowMs + tochkaCompanySelectionTtlMs;
  const rows = choicesValue.slice(0, 100).flatMap((choice, index) => {
    const customerCode = String(choice.code ?? "").trim().slice(0, 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(customerCode)) return [];
    const id = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
    const name = String(choice.name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120)
      || `Компания ${index + 1}`;
    const payload: TochkaCompanySelectionPayload = {
      version: 1,
      legalEntityId,
      customerCode,
      credentialDigest,
      issuedTo: actor,
      expiresAtMs,
    };
    return [{ id, name, payload }];
  });
  if (!rows.length) return [];
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM system_runtime_state
      WHERE state_key LIKE ? AND CAST(json_extract(state_value,'$.expiresAtMs') AS INTEGER)<?`)
      .bind(`${tochkaCompanySelectionPrefix}%`, nowMs),
    ...rows.map((row) => env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
      VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO NOTHING`)
      .bind(`${tochkaCompanySelectionPrefix}${row.id}`, JSON.stringify(row.payload))),
  ]);
  return rows.map(({ id, name }) => ({ id, name }));
}

export async function consumeTochkaCompanySelectionHandle(
  actorValue: string,
  handleValue: unknown,
  legalEntityIdValue: string,
  credentialValue: unknown,
  nowMs = Date.now(),
): Promise<TochkaCompanySelectionResult> {
  const handle = typeof handleValue === "string" ? handleValue.trim() : "";
  if (!/^[a-f0-9]{64}$/.test(handle)) {
    return { ok: false, reason: "Выбор компании недействителен. Начните выбор заново." };
  }
  const stateKey = `${tochkaCompanySelectionPrefix}${handle}`;
  const row = await env.DB.prepare("SELECT state_value FROM system_runtime_state WHERE state_key=?")
    .bind(stateKey).first<{ state_value: string }>();
  if (!row) return { ok: false, reason: "Выбор компании уже использован или устарел. Начните выбор заново." };

  let payload: TochkaCompanySelectionPayload;
  try {
    payload = JSON.parse(row.state_value) as TochkaCompanySelectionPayload;
  } catch {
    await env.DB.prepare("DELETE FROM system_runtime_state WHERE state_key=? AND state_value=?")
      .bind(stateKey, row.state_value).run();
    return { ok: false, reason: "Выбор компании недействителен. Начните выбор заново." };
  }
  if (payload.version !== 1 || !Number.isFinite(payload.expiresAtMs) || payload.expiresAtMs <= nowMs) {
    await env.DB.prepare("DELETE FROM system_runtime_state WHERE state_key=? AND state_value=?")
      .bind(stateKey, row.state_value).run();
    return { ok: false, reason: "Время выбора компании истекло. Начните выбор заново." };
  }

  const actor = String(actorValue ?? "").trim().slice(0, 120);
  let legalEntityId = "";
  let credentialDigest = "";
  try {
    legalEntityId = normalizeIntegrationCredentialScope(legalEntityIdValue, "юридическое лицо");
    credentialDigest = await integrationCredentialDigest(credentialValue);
  } catch {
    return { ok: false, reason: "Выбор компании не относится к этому ключу. Начните выбор заново." };
  }
  const expectedCode = String(payload.customerCode ?? "").trim().slice(0, 80);
  const bindingMatches = constantTimeEqual(payload.issuedTo, actor)
    && constantTimeEqual(payload.legalEntityId, legalEntityId)
    && constantTimeEqual(payload.credentialDigest, credentialDigest)
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(expectedCode);
  if (!bindingMatches) {
    return { ok: false, reason: "Выбор компании не относится к этому ключу. Начните выбор заново." };
  }

  const consumed = await env.DB.prepare(
    "DELETE FROM system_runtime_state WHERE state_key=? AND state_value=? RETURNING state_value"
  ).bind(stateKey, row.state_value).first<{ state_value: string }>();
  if (!consumed) return { ok: false, reason: "Выбор компании уже использован или устарел. Начните выбор заново." };
  return { ok: true, customerCode: expectedCode };
}

export async function saveTBankSetupWithCredential(
  actor: string,
  input: Partial<IntegrationSetup>,
  value: unknown,
  baseline: Pick<IntegrationSetup, "credentialGeneration" | "updatedAt"> | null,
) {
  const prepared = await prepareIntegrationSetup(actor, input, true);
  const { setup } = prepared;
  if (setup.connectionId !== tbankConnectionId || setup.authMethod !== "Bearer token" || !setup.readOnlyScopeConfirmed) {
    throw new Error("Подтвердите ограниченные права токена Т‑Банка");
  }
  const credential = await encryptIntegrationCredential(
    actor,
    setup.connectionId,
    setup.legalEntityId,
    tbankCredentialScope,
    value,
  );
  const setupAudit = JSON.stringify({
    connectionId: setup.connectionId,
    selectedLegalEntityId: setup.legalEntityId,
    accountScope: setup.accountScope,
    allocationMode: setup.allocationMode,
    accessMethod: "Токен Т‑Банка",
    limitedPermissionsConfirmedByOwner: true,
    dataScopes: setup.dataScopes,
    secretStored: true,
  });
  const credentialAudit = JSON.stringify({
    connectionId: credential.connectionId,
    selectedLegalEntityId: credential.legalEntityId,
    credentialEnvelopeStored: true,
    version: credential.envelope.version,
    algorithm: credential.envelope.algorithm,
  });
  const saved = await persistBankSetupWithCredentialCas(
    actor,
    setup,
    credential,
    baseline,
    setupAudit,
    credentialAudit,
    "Токен Т‑Банка сохранён · требуется проверка банка",
  );
  return saved ? setup : null;
}

async function persistBankSetupWithCredentialCas(
  actor: string,
  setup: IntegrationSetup,
  credential: Awaited<ReturnType<typeof encryptIntegrationCredential>>,
  baseline: Pick<IntegrationSetup, "credentialGeneration" | "updatedAt"> | null,
  setupAudit: string,
  credentialAudit: string,
  authStatus: string,
) {
  const setupStateKey = `${integrationSetupPrefix}${setup.connectionId}`;
  const guard = baseline
    ? `EXISTS (SELECT 1 FROM system_runtime_state
        WHERE state_key=?
          AND COALESCE(json_extract(state_value,'$.credentialGeneration'),'')=?
          AND COALESCE(json_extract(state_value,'$.updatedAt'),'')=?)`
    : "NOT EXISTS (SELECT 1 FROM system_runtime_state WHERE state_key=?)";
  const guardBindings = baseline
    ? [setupStateKey, normalizeCredentialGeneration(baseline.credentialGeneration), baseline.updatedAt]
    : [setupStateKey];
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
      SELECT ?,?,CURRENT_TIMESTAMP WHERE ${guard}
      ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
      .bind(credential.stateKey, JSON.stringify(credential.envelope), ...guardBindings),
    env.DB.prepare(`DELETE FROM system_runtime_state
      WHERE state_key LIKE ? AND state_key<>? AND ${guard}`)
      .bind(integrationCredentialConnectionPattern(setup.connectionId), credential.stateKey, ...guardBindings),
    env.DB.prepare(`UPDATE integration_connections SET
      auth_status=?,next_sync_at='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${guard}`)
      .bind(authStatus, setup.connectionId, ...guardBindings),
    env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
      SELECT ?,'integration.setup_saved','integration_test_dataset','INTEGRATION-DEMO',? WHERE ${guard}`)
      .bind(actor, setupAudit, ...guardBindings),
    env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
      SELECT ?,'integration.credential_replaced','integration_test_dataset','INTEGRATION-DEMO',? WHERE ${guard}`)
      .bind(actor, credentialAudit, ...guardBindings),
    env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
      SELECT ?,?,CURRENT_TIMESTAMP WHERE ${guard}
      ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
      .bind(setupStateKey, JSON.stringify(setup), ...guardBindings),
  ]);
  const setupResult = results[5] as { meta?: { changes?: number } } | undefined;
  return Number(setupResult?.meta?.changes ?? 0) > 0;
}

export type IntegrationBankProbeCommit = {
  valid: boolean;
  runId: string;
  correlationId: string;
  occurredAt: string;
  trigger: string;
  reason: string;
  receivedCount: number;
  checkpoint: string;
  logEvent: string;
  logMessage: string;
  logRecordRef: string;
  successStatus: string;
  successAuthStatus: string;
  failureAuthStatus: string;
  credentialExpiresAt: string;
  auditAction: string;
  auditPayload: Record<string, unknown>;
};

export async function commitIntegrationBankProbe(
  actor: string,
  setup: IntegrationSetup,
  commit: IntegrationBankProbeCommit,
) {
  const generation = normalizeCredentialGeneration(setup.credentialGeneration);
  if (!generation || setup.secretStatus !== "stored") return false;
  const credentialScope = setup.connectionId === tbankConnectionId ? tbankCredentialScope : setup.customerCode;
  const credentialStateKey = integrationCredentialStateKey(setup.connectionId, setup.legalEntityId, credentialScope);
  const setupStateKey = `${integrationSetupPrefix}${setup.connectionId}`;
  const guard = `EXISTS (
    SELECT 1 FROM system_runtime_state AS saved_setup
    JOIN system_runtime_state AS saved_credential ON saved_credential.state_key=?
    WHERE saved_setup.state_key=?
      AND json_extract(saved_setup.state_value,'$.credentialGeneration')=?
  ) AND EXISTS (SELECT 1 FROM integration_connections WHERE id=?)`;
  const guardBindings = [credentialStateKey, setupStateKey, generation, setup.connectionId];
  const runStatus = commit.valid ? "Проверка пройдена" : "Заблокировано";
  const connectionStatement = commit.valid
    ? env.DB.prepare(`UPDATE integration_connections SET
        status=?,auth_status=?,credential_expires_at=?,last_success_at='',next_sync_at='',
        received_count=0,accepted_count=0,rejected_count=0,error_count=0,
        verified_transfer=0,is_enabled=0,updated_at=?
      WHERE id=? AND ${guard}`)
      .bind(
        commit.successStatus,
        commit.successAuthStatus,
        commit.credentialExpiresAt,
        commit.occurredAt,
        setup.connectionId,
        ...guardBindings,
      )
    : env.DB.prepare(`UPDATE integration_connections SET
        status='Ожидает проверку',auth_status=?,credential_expires_at=?,
        verified_transfer=0,is_enabled=0,error_count=error_count+1,updated_at=?
      WHERE id=? AND ${guard}`)
      .bind(
        commit.failureAuthStatus,
        commit.credentialExpiresAt,
        commit.occurredAt,
        setup.connectionId,
        ...guardBindings,
      );
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO integration_sync_runs
      (id,connection_id,started_at,finished_at,trigger,status,received_count,accepted_count,rejected_count,error_count,conflict_count,checkpoint,error_message,initiated_by,correlation_id,dry_run)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`)
      .bind(
        commit.runId,
        setup.connectionId,
        commit.occurredAt,
        commit.occurredAt,
        commit.trigger,
        runStatus,
        commit.valid ? commit.receivedCount : 0,
        0,
        0,
        commit.valid ? 0 : 1,
        0,
        commit.valid ? commit.checkpoint : "",
        commit.valid ? "" : commit.reason,
        actor,
        commit.correlationId,
        1,
        ...guardBindings,
      ),
    env.DB.prepare(`INSERT INTO integration_log_entries
      (run_id,connection_id,level,event,message,record_ref)
      SELECT ?,?,?,?,?,? WHERE ${guard}`)
      .bind(
        commit.runId,
        setup.connectionId,
        commit.valid ? "INFO" : "ERROR",
        commit.logEvent,
        commit.valid ? commit.logMessage : commit.reason,
        commit.logRecordRef,
        ...guardBindings,
      ),
    connectionStatement,
    env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
      SELECT ?,?,'integration_connection',?,? WHERE ${guard}`)
      .bind(
        actor,
        commit.auditAction,
        setup.connectionId,
        JSON.stringify({ runId: commit.runId, ...commit.auditPayload }),
        ...guardBindings,
      ),
  ]);
  const connectionResult = results[2] as { meta?: { changes?: number } } | undefined;
  return Number(connectionResult?.meta?.changes ?? 0) > 0;
}

export async function commitTochkaReadOnlySync(
  actor: string,
  setup: IntegrationSetup,
  sync: TochkaReadOnlySyncResult,
  trigger: string,
) {
  const generation = normalizeCredentialGeneration(setup.credentialGeneration);
  if (!generation || setup.connectionId !== tochkaConnectionId || setup.secretStatus !== "stored") {
    return { committed: false, runId: "", financialOperationCount: 0 };
  }
  const credentialStateKey = integrationCredentialStateKey(setup.connectionId, setup.legalEntityId, setup.customerCode);
  const setupStateKey = `${integrationSetupPrefix}${setup.connectionId}`;
  const guard = `EXISTS (
    SELECT 1 FROM system_runtime_state AS saved_setup
    JOIN system_runtime_state AS saved_credential ON saved_credential.state_key=?
    WHERE saved_setup.state_key=?
      AND json_extract(saved_setup.state_value,'$.credentialGeneration')=?
  ) AND EXISTS (SELECT 1 FROM integration_connections WHERE id=?)`;
  const guardBindings = [credentialStateKey, setupStateKey, generation, setup.connectionId];
  const currentSetup = await env.DB.prepare(`SELECT 1 AS current WHERE ${guard}`)
    .bind(...guardBindings).first<{ current: number }>();
  if (!currentSetup) return { committed: false, runId: "", financialOperationCount: 0 };

  const occurredAt = new Date().toISOString();
  const runId = `INT-RUN-${crypto.randomUUID().toUpperCase()}`;
  const correlationId = `CORR-${crypto.randomUUID()}`;
  const projectedByTransaction = new Map<string, NonNullable<Awaited<ReturnType<typeof toTochkaFinancialOperation>>>>();
  for (const transaction of sync.transactions) {
    const operation = await toTochkaFinancialOperation(transaction, setup.legalEntityId);
    if (operation) projectedByTransaction.set(transaction.id, {
      ...operation,
      objectEntityId: setup.allocationMode === "single_branch" ? setup.branchId : "",
    });
  }

  const latestStatementByAccount = new Map(sync.statements.map((statement) => [statement.accountId, statement]));
  const accountStatements = sync.accounts.map((account) => {
    const statement = latestStatementByAccount.get(account.accountId);
    return env.DB.prepare(`INSERT INTO bank_accounts
      (id,connection_id,legal_entity_id,provider_account_id,masked_account,name,currency,status,balance_minor,balance_as_of,synced_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
      ON CONFLICT(id) DO UPDATE SET
        masked_account=excluded.masked_account,name=excluded.name,currency=excluded.currency,status=excluded.status,
        balance_minor=excluded.balance_minor,balance_as_of=excluded.balance_as_of,synced_at=excluded.synced_at`)
      .bind(
        account.id,
        setup.connectionId,
        setup.legalEntityId,
        account.accountId,
        account.maskedAccount,
        account.name,
        account.currency,
        account.status,
        statement?.endBalanceMinor ?? null,
        statement?.endDate ?? "",
        occurredAt,
        ...guardBindings,
      );
  });
  const statementStatements = sync.statements.map((statement) => env.DB.prepare(`INSERT INTO bank_statement_imports
    (id,connection_id,legal_entity_id,provider_statement_id,provider_account_id,start_date,end_date,status,start_balance_minor,end_balance_minor,currency,transaction_count,fetched_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,start_balance_minor=excluded.start_balance_minor,end_balance_minor=excluded.end_balance_minor,
      currency=excluded.currency,transaction_count=excluded.transaction_count,fetched_at=excluded.fetched_at`)
    .bind(
      statement.id,
      setup.connectionId,
      setup.legalEntityId,
      statement.statementId,
      statement.accountId,
      statement.startDate,
      statement.endDate,
      statement.status,
      statement.startBalanceMinor,
      statement.endBalanceMinor,
      statement.currency,
      statement.transactionCount,
      occurredAt,
      ...guardBindings,
    ));
  const transactionStatements = sync.transactions.map((transaction) => env.DB.prepare(`INSERT INTO bank_transactions
    (id,connection_id,legal_entity_id,provider_account_id,provider_statement_id,provider_transaction_id,payment_id,operation_date,direction,amount_minor,currency,status,document_number,transaction_type,description,counterparty_name,counterparty_inn,counterparty_kpp,source_payload_hash,financial_operation_id,imported_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
    ON CONFLICT(id) DO NOTHING`)
    .bind(
      transaction.id,
      setup.connectionId,
      setup.legalEntityId,
      transaction.accountId,
      transaction.statementId,
      transaction.providerTransactionId,
      transaction.paymentId,
      transaction.operationDate,
      transaction.direction,
      transaction.amountMinor,
      transaction.currency,
      transaction.status,
      transaction.documentNumber,
      transaction.transactionType,
      transaction.description,
      transaction.counterpartyName,
      transaction.counterpartyInn,
      transaction.counterpartyKpp,
      transaction.sourcePayloadHash,
      projectedByTransaction.get(transaction.id)?.id ?? "",
      occurredAt,
      ...guardBindings,
    ));
  const financialStatements = [...projectedByTransaction.values()].map((operation) => env.DB.prepare(`INSERT INTO financial_operations
    (id,operation_date,period,direction,amount_minor,category,report_class,counterparty_entity_id,contract_id,document_id,project_entity_id,legal_entity_id,object_entity_id,cfr_entity_id,bank_operation_ref,operation_kind,source_system,source_file,source_sheet,source_ref,data_quality,status,created_by)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
    ON CONFLICT(id) DO NOTHING`)
    .bind(
      operation.id,
      operation.operationDate,
      operation.period,
      operation.direction,
      operation.amountMinor,
      operation.category,
      operation.reportClass,
      operation.counterpartyEntityId,
      operation.contractId,
      operation.documentId,
      operation.projectEntityId,
      operation.legalEntityId,
      operation.objectEntityId,
      operation.cfrEntityId,
      operation.bankOperationRef,
      operation.operationKind,
      operation.sourceSystem,
      operation.sourceFile,
      operation.sourceSheet,
      operation.sourceRef,
      operation.dataQuality,
      operation.status,
      operation.createdBy,
      ...guardBindings,
    ));

  for (const statements of [accountStatements, statementStatements, transactionStatements]) {
    for (let index = 0; index < statements.length; index += 40) {
      await env.DB.batch(statements.slice(index, index + 40));
    }
  }
  let financialOperationCount = 0;
  for (let index = 0; index < financialStatements.length; index += 40) {
    const results = await env.DB.batch(financialStatements.slice(index, index + 40));
    financialOperationCount += results.reduce(
      (total, result) => total + Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0),
      0,
    );
  }

  const receivedCount = sync.accounts.length + sync.statements.length + sync.transactions.length;
  const acceptedCount = Math.max(0, receivedCount - sync.rejectedCount);
  const nextSyncAt = new Date(Date.now() + Math.max(60, setup.syncIntervalMinutes || 60) * 60_000).toISOString();
  const runStatus = sync.valid && sync.complete ? "Успешно" : sync.valid ? "Ожидание банка" : "Ошибка";
  const checkpoint = `accounts:${sync.accounts.length};statements:${sync.statements.length};transactions:${sync.transactions.length}`;
  const finalResults = await env.DB.batch([
    env.DB.prepare(`INSERT INTO integration_sync_runs
      (id,connection_id,started_at,finished_at,trigger,status,received_count,accepted_count,rejected_count,error_count,conflict_count,checkpoint,error_message,initiated_by,correlation_id,dry_run)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`)
      .bind(
        runId,
        setup.connectionId,
        occurredAt,
        occurredAt,
        trigger,
        runStatus,
        receivedCount,
        acceptedCount,
        sync.rejectedCount,
        sync.valid ? 0 : 1,
        0,
        checkpoint,
        sync.valid ? "" : sync.reason,
        actor,
        correlationId,
        0,
        ...guardBindings,
      ),
    env.DB.prepare(`INSERT INTO integration_log_entries
      (run_id,connection_id,level,event,message,record_ref)
      SELECT ?,?,?,?,?,? WHERE ${guard}`)
      .bind(
        runId,
        setup.connectionId,
        sync.valid ? "INFO" : "ERROR",
        sync.complete ? "tochka.statements_imported" : "tochka.statements_pending",
        sync.reason,
        checkpoint,
        ...guardBindings,
      ),
    env.DB.prepare(`UPDATE integration_connections SET
      status=?,auth_status=?,credential_expires_at=?,last_success_at=?,next_sync_at=?,
      received_count=?,accepted_count=?,rejected_count=?,error_count=?,conflict_count=0,
      verified_transfer=?,is_enabled=?,updated_at=?
      WHERE id=? AND ${guard}`)
      .bind(
        !sync.valid ? "Ошибка подключения" : sync.complete ? "Работает" : "Формируются выписки",
        !sync.valid ? "Ключ сохранён · загрузка из Точки не выполнена" : sync.complete ? "Ключ принят · счета, выписки и операции загружены" : "Ключ принят · Точка формирует выписки",
        sync.expiresAt,
        sync.valid ? occurredAt : "",
        nextSyncAt,
        receivedCount,
        acceptedCount,
        sync.rejectedCount,
        sync.valid ? 0 : 1,
        sync.valid && sync.statements.length > 0 ? 1 : 0,
        sync.valid ? 1 : 0,
        occurredAt,
        setup.connectionId,
        ...guardBindings,
      ),
    env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
      SELECT ?,'integration.tochka_readonly_sync_completed','integration_connection',?,? WHERE ${guard}`)
      .bind(
        actor,
        setup.connectionId,
        JSON.stringify({
          runId,
          selectedLegalEntityId: setup.legalEntityId,
          accountCount: sync.accounts.length,
          statementCount: sync.statements.length,
          transactionCount: sync.transactions.length,
          financialOperationCount,
          rejectedCount: sync.rejectedCount,
          complete: sync.complete,
          paymentCreationAllowed: false,
        }),
        ...guardBindings,
      ),
  ]);
  const connectionResult = finalResults[2] as { meta?: { changes?: number } } | undefined;
  return {
    committed: Number(connectionResult?.meta?.changes ?? 0) > 0,
    runId,
    financialOperationCount,
  };
}

export async function hasIntegrationCredential(connectionIdValue: string, legalEntityIdValue: string, customerCodeValue: string) {
  const stateKey = integrationCredentialStateKey(connectionIdValue, legalEntityIdValue, customerCodeValue);
  const row = await env.DB.prepare("SELECT 1 AS present FROM system_runtime_state WHERE state_key=?")
    .bind(stateKey).first<{ present: number }>();
  return row?.present === 1;
}

export async function saveIntegrationCredential(
  actor: string,
  connectionIdValue: string,
  legalEntityIdValue: string,
  customerCodeValue: string,
  value: unknown,
) {
  const credential = await encryptIntegrationCredential(
    actor,
    connectionIdValue,
    legalEntityIdValue,
    customerCodeValue,
    value,
  );
  await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(credential.stateKey, JSON.stringify(credential.envelope)).run();
  await writeIntegrationDatasetAudit(actor, "integration.credential_replaced", {
    connectionId: credential.connectionId,
    selectedLegalEntityId: credential.legalEntityId,
    credentialEnvelopeStored: true,
    version: credential.envelope.version,
    algorithm: credential.envelope.algorithm,
  });
}

export async function revokeTochkaIntegrationCredential(actor: string) {
  return revokeBankIntegrationCredential(actor, tochkaConnectionId);
}

export async function revokeBankIntegrationCredential(actor: string, connectionIdValue: string) {
  const connectionId = String(connectionIdValue ?? "").trim().toUpperCase();
  if (connectionId !== tochkaConnectionId && connectionId !== tbankConnectionId) {
    throw new Error("Удаление ключа для этой интеграции не поддерживается");
  }
  const setup = (await getIntegrationSetups())[connectionId];
  const revokedAt = new Date().toISOString();
  const revokedSetup = setup ? {
    ...setup,
    credentialGeneration: crypto.randomUUID(),
    secretStatus: "missing" as const,
    updatedAt: revokedAt,
    updatedBy: actor,
  } : null;
  const statements = [
    env.DB.prepare("DELETE FROM system_runtime_state WHERE state_key LIKE ?")
      .bind(integrationCredentialConnectionPattern(connectionId)),
  ];
  if (revokedSetup) {
    statements.push(env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
      VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
      .bind(`${integrationSetupPrefix}${connectionId}`, JSON.stringify(revokedSetup)));
  }
  statements.push(
    env.DB.prepare(`UPDATE integration_connections SET
      status='Ожидает доступ',auth_status=?,credential_expires_at='',
      last_success_at='',next_sync_at='',received_count=0,accepted_count=0,rejected_count=0,
      verified_transfer=0,is_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(connectionId === tochkaConnectionId ? "Ключ Точки удалён из ArtHello OS владельцем" : "Токен Т‑Банка удалён из ArtHello OS владельцем", connectionId),
    env.DB.prepare("INSERT INTO audit_events (actor,action,entity_type,entity_id,payload) VALUES (?,?,?,?,?)")
      .bind(actor, "integration.credential_deleted_locally", "integration_connection", connectionId, JSON.stringify({
        connectionId,
        selectedLegalEntityId: setup?.legalEntityId ?? "",
        companySelectionConfirmed: Boolean(setup?.customerCode),
      })),
  );
  await env.DB.batch(statements);
  return revokedSetup;
}

async function encryptIntegrationCredential(
  actor: string,
  connectionIdValue: string,
  legalEntityIdValue: string,
  customerCodeValue: string,
  value: unknown,
) {
  const connectionId = normalizeIntegrationCredentialScope(connectionIdValue, "интеграция");
  const legalEntityId = normalizeIntegrationCredentialScope(legalEntityIdValue, "юридическое лицо");
  const customerCode = normalizeIntegrationCredentialScope(customerCodeValue, "customerCode");
  const secret = typeof value === "string" ? value.trim() : "";
  const minimumLength = connectionId === tbankConnectionId ? 24 : 40;
  if (secret.length < minimumLength || secret.length > 16_384 || /\s/.test(secret)) {
    throw new Error("Ключ доступа выглядит неполным или содержит недопустимые символы");
  }
  const key = await integrationCredentialEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(integrationCredentialAad(connectionId, legalEntityId, customerCode));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    new TextEncoder().encode(secret),
  );
  const envelope: EncryptedIntegrationCredential = {
    version: 1,
    algorithm: "AES-GCM",
    iv: encodeIntegrationCredentialBytes(iv),
    ciphertext: encodeIntegrationCredentialBytes(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  return {
    connectionId,
    legalEntityId,
    customerCode,
    stateKey: integrationCredentialStateKey(connectionId, legalEntityId, customerCode),
    envelope,
  };
}

export async function readIntegrationCredential(connectionIdValue: string, legalEntityIdValue: string, customerCodeValue: string) {
  const connectionId = normalizeIntegrationCredentialScope(connectionIdValue, "интеграция");
  const legalEntityId = normalizeIntegrationCredentialScope(legalEntityIdValue, "юридическое лицо");
  const customerCode = normalizeIntegrationCredentialScope(customerCodeValue, "customerCode");
  const row = await env.DB.prepare("SELECT state_value FROM system_runtime_state WHERE state_key=?")
    .bind(integrationCredentialStateKey(connectionId, legalEntityId, customerCode)).first<{ state_value: string }>();
  if (!row) return null;
  try {
    const envelope = JSON.parse(row.state_value) as EncryptedIntegrationCredential;
    if (envelope.version !== 1 || envelope.algorithm !== "AES-GCM" || !envelope.iv || !envelope.ciphertext) {
      throw new Error("Unsupported credential envelope");
    }
    const key = await integrationCredentialEncryptionKey();
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeIntegrationCredentialBytes(envelope.iv),
        additionalData: new TextEncoder().encode(integrationCredentialAad(connectionId, legalEntityId, customerCode)),
        tagLength: 128,
      },
      key,
      decodeIntegrationCredentialBytes(envelope.ciphertext),
    );
    const secret = new TextDecoder().decode(plaintext);
    const minimumLength = connectionId === tbankConnectionId ? 24 : 40;
    if (secret.length < minimumLength || secret.length > 16_384 || /\s/.test(secret)) throw new Error("Invalid credential payload");
    return secret;
  } catch {
    // Never expose ciphertext, parsing details or key material to callers.
    throw new Error(connectionId === tochkaConnectionId
      ? "Защищённый ключ Точки недоступен. Введите ключ заново."
      : "Защищённый токен Т‑Банка недоступен. Введите ключ заново.");
  }
}

export async function readTBankIntegrationCredential(legalEntityId: string) {
  return readIntegrationCredential(tbankConnectionId, legalEntityId, tbankCredentialScope);
}

export async function verifyStoredIntegrationCredentials() {
  const rows = await env.DB.prepare(
    "SELECT state_key FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:%' ORDER BY state_key"
  ).all<{ state_key: string }>();
  for (const row of rows.results ?? []) {
    try {
      const parts = row.state_key.slice(integrationCredentialPrefix.length).split(":");
      if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Invalid credential scope");
      const [connectionId, legalEntityId, customerCode] = parts.map((part) => decodeURIComponent(part));
      if (integrationCredentialStateKey(connectionId, legalEntityId, customerCode) !== row.state_key) {
        throw new Error("Non-canonical credential scope");
      }
      const secret = await readIntegrationCredential(connectionId, legalEntityId, customerCode);
      if (!secret) throw new Error("Missing credential envelope");
    } catch {
      // Readiness must fail without exposing the state key, envelope or secret.
      throw new Error("Защищённые банковские ключи не прошли проверку хранилища");
    }
  }
}

function integrationCredentialStateKey(connectionIdValue: string, legalEntityIdValue: string, customerCodeValue: string) {
  const connectionId = normalizeIntegrationCredentialScope(connectionIdValue, "интеграция");
  const legalEntityId = normalizeIntegrationCredentialScope(legalEntityIdValue, "юридическое лицо");
  const customerCode = normalizeIntegrationCredentialScope(customerCodeValue, "customerCode");
  return `${integrationCredentialPrefix}${encodeURIComponent(connectionId)}:${encodeURIComponent(legalEntityId)}:${encodeURIComponent(customerCode)}`;
}

function integrationCredentialConnectionPattern(connectionIdValue: string) {
  const connectionId = normalizeIntegrationCredentialScope(connectionIdValue, "интеграция");
  return `${integrationCredentialPrefix}${encodeURIComponent(connectionId)}:%`;
}

function normalizeIntegrationCredentialScope(value: string, label: string, allowEmpty = false) {
  const clean = String(value ?? "").trim().slice(0, 80);
  if ((!clean && !allowEmpty) || (clean && !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(clean))) {
    throw new Error(`Некорректно указано ${label}`);
  }
  return clean;
}

function normalizeCredentialGeneration(value: unknown) {
  const generation = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation)
    ? generation
    : "";
}

function normalizeSubmittedIntegrationEndpoint(value: unknown) {
  const endpoint = typeof value === "string" ? value.trim().slice(0, 240) : "";
  if (!endpoint) return "";
  const normalized = normalizeStoredIntegrationEndpoint(endpoint);
  if (!normalized) {
    throw new Error("Адрес подключения должен быть HTTPS-ссылкой без логина, пароля, параметров или служебной части");
  }
  return normalized;
}

function normalizeStoredIntegrationEndpoint(value: unknown) {
  const endpoint = typeof value === "string" ? value.trim().slice(0, 240) : "";
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function integrationCredentialAad(connectionId: string, legalEntityId: string, customerCode: string) {
  const credentialType = connectionId === tbankConnectionId ? "TBANK_BANK_READ_V1" : "TOCHKA_ACCOUNTS_READ_V1";
  return `arthello.integration-credential.v2\n${connectionId}\n${legalEntityId}\n${customerCode}\n${credentialType}`;
}

async function integrationCredentialDigest(value: unknown) {
  const secret = typeof value === "string" ? value.trim() : "";
  if (secret.length < 40 || secret.length > 16_384 || /\s/.test(secret)) {
    throw new Error("Ключ доступа выглядит неполным или содержит недопустимые символы");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`arthello.tochka-company-selection.v1\n${secret}`),
  );
  return encodeIntegrationCredentialBytes(new Uint8Array(digest));
}

function constantTimeEqual(leftValue: unknown, rightValue: unknown) {
  const left = typeof leftValue === "string" ? leftValue : "";
  const right = typeof rightValue === "string" ? rightValue : "";
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function integrationCredentialEncryptionKey() {
  const runtime = env as unknown as Record<string, unknown>;
  const configured = runtime.INTEGRATION_CREDENTIALS_KEY;
  if (typeof configured !== "string" || configured.length < 32) {
    throw new Error("Защищённое хранилище не настроено: задайте INTEGRATION_CREDENTIALS_KEY");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`arthello.integration-credential.key.v1\n${configured}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encodeIntegrationCredentialBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeIntegrationCredentialBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export type SystemDataMode = "test" | "source_only" | "empty";

export async function getSystemDataMode(): Promise<SystemDataMode> {
  const row = await env.DB.prepare(
    "SELECT state_value FROM system_runtime_state WHERE state_key='system_data_mode'"
  ).first<{ state_value: string }>();
  if (row?.state_value === "test" || row?.state_value === "source_only" || row?.state_value === "empty") return row.state_value;
  // Production must fail closed. A new database, a missing state row or an
  // unrecognised value must never opt the application into source/demo seeds.
  return "empty";
}

export async function setSystemDataMode(actor: string, mode: SystemDataMode) {
  const current = await getSystemDataMode();
  if (current === "empty" && mode !== "empty") {
    throw new Error("Пустой production-контур заблокирован. Смена режима возможна только отдельной офлайн-процедурой обслуживания.");
  }
  await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('system_data_mode',?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(mode).run();
  await writeIntegrationDatasetAudit(actor, "system.data_mode_changed", {
    mode,
    behavior: mode === "empty"
      ? "Пустой production-контур: автоматическое создание демонстрационных и производных записей отключено"
      : mode === "source_only"
        ? "Синтетические модули скрыты; XLSX-факты и аудит сохранены"
        : "Синтетический демонстрационный контур снова видим",
  });
  return mode;
}

const demoOnlyTables = [
  "sales_touchpoints", "sales_stage_events", "sales_leads", "client_accruals", "client_bonuses", "client_lifecycles",
  "content_attributions", "content_recommendations", "content_publications", "content_plan_items", "marketing_accounts",
  "education_attendance", "education_progress", "education_feedback", "education_communications", "education_students", "education_lessons", "education_groups", "education_programs",
  "hr_onboarding", "hr_development", "hr_rewards", "hr_accesses", "hr_interviews", "hr_candidates", "hr_employees", "hr_vacancies",
  "legal_contract_text_versions", "legal_document_items", "legal_responsibility_zones", "legal_checks", "legal_contracts",
  "supplier_offers", "purchase_orders", "procurement_deliveries", "purchase_requests", "procurement_suppliers", "inventory_events", "inventory_items",
  "asset_maintenance", "assets", "food_recipe_ingredients", "food_recipes", "food_production", "food_shipments", "food_shifts", "food_checks", "food_batches", "food_products",
  "safety_next_checks", "safety_repairs", "safety_incidents", "safety_faults", "safety_checks", "safety_equipment", "safety_systems", "safety_guard_shifts",
  "medical_actions", "medical_incidents", "medical_cases", "medical_restrictions", "medical_documents", "medical_access_grants",
  "accounting_document_links", "accounting_completeness_checks", "accounting_exports", "accounting_documents", "accounting_integrations",
  "event_participants", "business_events", "strategy_results", "strategy_deviations", "strategy_projects", "strategy_initiatives", "strategy_kpis", "strategy_goals",
  "complaint_actions", "customer_complaints", "ai_model_runs", "ai_opt_outs", "analytics_signals", "ai_process_contracts", "analytics_metric_definitions",
  "readiness_scenario_steps", "readiness_scenarios", "readiness_validation_runs", "release_gates", "recovery_drills",
] as const;

export type SystemDemoRemovalStatus = {
  mode: SystemDataMode;
  removed: number;
  preserved: string[];
};

export async function removeSystemDemoData(actor: string): Promise<SystemDemoRemovalStatus> {
  if (await getSystemDataMode() === "empty") {
    throw new Error("Пустой production-контур нельзя перевести в source_only из web runtime.");
  }
  const countRow = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM entities WHERE source_system LIKE 'SYNTHETIC%') +
    (SELECT COUNT(*) FROM financial_operations WHERE source_system LIKE 'SYNTHETIC%') +
    (SELECT COUNT(*) FROM tasks WHERE created_by LIKE 'system-%') AS total`).first<{ total: number }>();
  const systemTaskFilter = "SELECT id FROM tasks WHERE created_by LIKE 'system-%'";
  const statements = [
    env.DB.prepare(`DELETE FROM task_watchers WHERE task_id IN (${systemTaskFilter})`),
    env.DB.prepare(`DELETE FROM task_checklist WHERE task_id IN (${systemTaskFilter})`),
    env.DB.prepare(`DELETE FROM task_comments WHERE task_id IN (${systemTaskFilter})`),
    env.DB.prepare(`DELETE FROM task_approvals WHERE task_id IN (${systemTaskFilter})`),
    env.DB.prepare(`DELETE FROM task_documents WHERE task_id IN (${systemTaskFilter})`),
    env.DB.prepare(`DELETE FROM escalations WHERE task_id IN (${systemTaskFilter})`),
    env.DB.prepare("DELETE FROM notifications WHERE source_id LIKE '%-T-%' OR dedup_key LIKE '%-T-%'"),
    env.DB.prepare("DELETE FROM tasks WHERE created_by LIKE 'system-%'"),
    env.DB.prepare("DELETE FROM document_versions WHERE document_id IN (SELECT id FROM workflow_documents WHERE source LIKE 'SYNTHETIC%' OR created_by LIKE 'system-%')"),
    env.DB.prepare("DELETE FROM obligations WHERE document_id IN (SELECT id FROM workflow_documents WHERE source LIKE 'SYNTHETIC%' OR created_by LIKE 'system-%')"),
    env.DB.prepare("DELETE FROM workflow_documents WHERE source LIKE 'SYNTHETIC%' OR created_by LIKE 'system-%'"),
    env.DB.prepare("DELETE FROM entity_documents WHERE source LIKE 'SYNTHETIC%'"),
    env.DB.prepare("DELETE FROM entity_links WHERE created_by LIKE 'system-%'"),
    env.DB.prepare("DELETE FROM entity_merges WHERE survivor_id IN (SELECT id FROM entities WHERE source_system LIKE 'SYNTHETIC%') OR duplicate_id IN (SELECT id FROM entities WHERE source_system LIKE 'SYNTHETIC%')"),
    env.DB.prepare("DELETE FROM financial_operations WHERE source_system LIKE 'SYNTHETIC%'"),
    env.DB.prepare("DELETE FROM finance_budgets"),
    env.DB.prepare("DELETE FROM finance_forecast_items"),
    env.DB.prepare("DELETE FROM integration_log_entries"),
    env.DB.prepare("DELETE FROM integration_conflicts"),
    env.DB.prepare("DELETE FROM integration_sync_runs"),
    env.DB.prepare("UPDATE integration_connections SET received_count=0,accepted_count=0,rejected_count=0,error_count=0,conflict_count=0,last_success_at=CASE WHEN id='INT-T-D1' THEN last_success_at ELSE '' END,updated_at=CURRENT_TIMESTAMP"),
    ...demoOnlyTables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare("DELETE FROM entities WHERE source_system LIKE 'SYNTHETIC%'"),
    env.DB.prepare("DELETE FROM system_runtime_state WHERE state_key IN ('integration_demo_bootstrap','finance_entity_links_bootstrap')"),
  ];
  for (let index = 0; index < statements.length; index += 35) {
    await env.DB.batch(statements.slice(index, index + 35));
  }
  await setSystemDataMode(actor, "source_only");
  await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('system_demo_purge',?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(SYSTEM_DEMO_PURGE_VERSION).run();
  const removed = Number(countRow?.total ?? 0);
  const preserved = ["XLSX-факты", "ручные карточки и задачи", "аудит", "каталог и параметры подключений"];
  await writeIntegrationDatasetAudit(actor, "system.demo_data_removed", { removed, preserved });
  return { mode: "source_only", removed, preserved };
}

export async function restoreSystemDemoData(actor: string) {
  if (await getSystemDataMode() === "empty") {
    throw new Error("Восстановление демонстрационного контура запрещено в production. Используйте отдельную офлайн-процедуру обслуживания.");
  }
  await setSystemDataMode(actor, "test");
  await seedRegistry();
  await seedWorkflow();
  await seedFinance();
  await seedSales();
  await seedContent();
  await seedEducation();
  await seedHr();
  await seedLegal();
  await seedProcurement();
  await seedFood();
  await seedSafety();
  await seedMedical();
  await seedAccounting();
  await seedStrategy();
  await seedIntegrations();
  await seedAnalytics();
  await seedReadiness();
  await ensureFinanceEntityLinksBootstrap();
  await writeIntegrationDatasetAudit(actor, "system.demo_data_restored", { mode: "test" });
  return "test" as const;
}

export type AnalyticsDemoStatus = {
  metrics: number;
  contracts: number;
  signals: number;
  runs: number;
};

export async function getAnalyticsDemoStatus(): Promise<AnalyticsDemoStatus> {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const row = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM analytics_metric_definitions) AS metrics,
    (SELECT COUNT(*) FROM ai_process_contracts) AS contracts,
    (SELECT COUNT(*) FROM analytics_signals) AS signals,
    (SELECT COUNT(*) FROM ai_model_runs) AS runs`
  ).first<{ metrics: number; contracts: number; signals: number; runs: number }>();
  return {
    metrics: Number(row?.metrics ?? 0),
    contracts: Number(row?.contracts ?? 0),
    signals: Number(row?.signals ?? 0),
    runs: Number(row?.runs ?? 0),
  };
}

export async function ensureAnalyticsDemoBootstrap(): Promise<AnalyticsDemoStatus> {
  const before = await getAnalyticsDemoStatus();
  if (await getSystemDataMode() === "empty") return before;
  if (analyticsDemoComplete(before)) return before;

  await seedAnalytics();
  const after = await getAnalyticsDemoStatus();
  if (!analyticsDemoComplete(after)) {
    throw new Error(`Analytics demo bootstrap incomplete: ${after.metrics}/${after.contracts}/${after.signals}/${after.runs}`);
  }
  return after;
}

function analyticsDemoComplete(status: AnalyticsDemoStatus) {
  return status.metrics >= 10 && status.contracts >= 13 && status.signals >= 12 && status.runs >= 6;
}

async function seedAnalytics(){
  const metrics=[
    ["MET-T-CASH","Чистый денежный поток","Финансы","Поступления минус списания за календарный месяц","Поступления за месяц минус списания","₽","Месяц","financial_operations","Факт исходной таблицы и отдельно помеченные тестовые записи","ОДДС: апрель 2026; тестовые следы: август","EMP-T-FIN-001",0,1],
    ["MET-T-CASH-GAP","Минимальный прогнозный остаток","Финансы","Минимум накопительного вероятностного остатка на горизонте","Начальный остаток плюс поступления и минус списания с учётом вероятности","₽","День","finance_forecast_items","Синтетическая модель","Горизонт 1–8 сентября 2026","EMP-T-FIN-001",0,1],
    ["MET-T-LTV","LTV семьи","Клиенты","Подтверждённая выручка семьи за срок жизни","Сумма подтверждённых оплат семьи","₽","Семья","client_lifecycles,financial_operations","Синтетические карточки","Тестовый снимок 21 августа","EMP-T-SALES-001",null,1],
    ["MET-T-CHURN","Высокий риск ухода","Клиенты","Число активных семей с высоким риском","Число активных семей с высоким риском","семей","Снимок","client_lifecycles","Синтетические карточки","Тестовый снимок 21 августа","EMP-T-SALES-001",0,1],
    ["MET-T-EDU","Средний учебный прогресс","Обучение","Среднее значение последних тестовых метрик прогресса","Среднее значение прогресса","%","Ученик × программа × период","education_progress","Синтетические обезличенные карточки","3 квартал 2026","EMP-T-METHOD-001",75,1],
    ["MET-T-STAFF","Активные сотрудники","HR","Сотрудники со статусом Работает в HR-контуре","Число работающих сотрудников","чел.","Снимок","hr_employees","Синтетические карточки","Тестовый снимок 21 августа","EMP-T-HR-001",null,1],
    ["MET-T-SAFETY","Открытые неисправности","Безопасность","Неисправности, статус которых не Закрыт","Число незакрытых неисправностей","шт.","Снимок","safety_faults","Синтетические проверки","Тестовый снимок 21 августа","EMP-T-SAFE-001",0,1],
    ["MET-T-FOOD","Маржинальность кухни","Питание","Выручка минус материальные и сменные затраты, делённые на выручку","Доля прибыли после стоимости продуктов и смен","%","Тестовый период","food_shipments,food_production,food_shifts","Синтетическая экономика кухни","Тестовый снимок 21 августа","EMP-T-KITCHEN-001",20,1],
    ["MET-T-PROJECT","Проекты под риском","Проекты","Проекты со статусом Под риском","Число проектов под риском","шт.","Снимок","strategy_projects","Синтетическая стратегия","Тестовый снимок 21 августа","EMP-T-PROJ-001",0,1],
    ["MET-T-DQ","Открытые сигналы качества","Данные","Финансовые и интеграционные конфликты, не имеющие решения","Число открытых расхождений в финансах и интеграциях","шт.","Снимок","finance_reconciliation_issues,integration_conflicts","Смешанная: XLSX факт + системный контроль","Тестовый снимок 21 августа","EMP-T-INT-001",0,1]
  ];
  await env.DB.batch(metrics.map(row=>env.DB.prepare("INSERT OR IGNORE INTO analytics_metric_definitions (id,name,category,definition,formula,unit,grain,source_tables,source_quality,freshness,owner_entity_id,target_value,sensitive) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const commonForbidden="Не изменять финансовый факт; не подписывать договоры; не увольнять, не наказывать и не обвинять людей; не ставить диагнозы; не удалять первичные данные; не выдавать критичные права";
  const contracts=[
    ["AI-CONTRACT-PAYMENTS","Прогноз платежей","Обезличенные начисления, сроки и подтверждённые оплаты","Вероятностный график поступлений с факторами и диапазоном","Читать агрегаты; сформировать объяснимый прогноз; предложить задачу",commonForbidden,"Финансовый контролёр",0,"Точность суммы и даты на горизонте 30 дней","Отключить после 3 периодов с ошибкой более 30%",1,"В карточке контракта выбрать Отказаться и указать основание","Платёжный календарь и ручной прогноз продолжают работать","Новые признаки платежного поведения не передаются модели","Ранее использованные тестовые агрегаты остаются в аудите; первичные данные не удаляются","Прогноз обновляется медленнее и вручную","Активен","Правила с ручным подтверждением","finance_accruals,client_lifecycles"],
    ["AI-CONTRACT-LTV","Прогноз LTV","Обезличенные платежи, срок жизни, услуга и частота","Диапазон ожидаемой ценности семьи с факторами","Считать агрегаты; ранжировать для анализа; предложить контакт",commonForbidden,"Директор по продажам",0,"Ошибка прогноза LTV на контрольной выборке","Отключить при drift >25% или coverage <60%",1,"Отказ в карточке контракта по семье или всему сценарию","Фактический LTV и карточка семьи остаются","Новые поведенческие признаки не используются для LTV","Исторический аудит сохраняется по политике тестового контура","Исчезает прогноз, фактическая выручка остаётся","Активен","Правила с ручным подтверждением","client_lifecycles,financial_operations"],
    ["AI-CONTRACT-CHURN","Риск ухода","Просрочка, коммуникации, посещаемость и срок жизни","Объяснимый риск-сигнал без автоматического решения","Выделить факторы; предложить человеческий контакт; создать задачу",commonForbidden,"Директор клиентского сервиса",0,"Доля полезных ранних контактов","Отключить при false-positive >40% два периода",1,"Отказ семьи или владельца через карточку контракта","Ручная работа куратора и история обращений продолжаются","Новые поведенческие признаки семьи не оцениваются","Ранее использованные агрегаты не удаляются из аудита","Сигнал появляется позже после ручного просмотра","Активен","Правила с ручным подтверждением","client_lifecycles,education_attendance"],
    ["AI-CONTRACT-CASH-GAP","Риск кассового разрыва","Остаток, плановые поступления/списания, вероятности","Дата и глубина возможного разрыва с допущениями","Рассчитать сценарий; показать вклад операций; создать задачу",commonForbidden,"Финансовый директор",0,"Дни предупреждения до подтверждённого разрыва","Отключить при неактуальном источнике более 7 дней",1,"Отключить модельный слой в карточке; указать причину","ДДС, платежный календарь и ручной план-факт работают","Прогнозные признаки перестают пересчитываться","История запусков остаётся для аудита","Остаётся ручной расчёт без раннего сигнала","Активен","Правила с ручным подтверждением","finance_forecast_items,financial_operations"],
    ["AI-CONTRACT-ANOMALY","Поиск аномалий","Агрегаты, контрольные суммы, повторяемость и источник","Список расхождений с формулой и ссылкой на строки","Сравнивать; объяснять; создать задачу сверки",commonForbidden,"Владелец данных",0,"Подтверждённые расхождения на 100 проверок","Отключить при 50% ложных сигналов",1,"Отказаться от автоматической проверки выбранного набора","Ручные сверки и контрольные суммы работают","Новые наборы не сканируются правилами","История подтверждённых расхождений сохраняется","Проверка занимает больше времени","Активен","Правила с ручным подтверждением","finance_reconciliation_issues,integration_conflicts"],
    ["AI-CONTRACT-BONUS","Рекомендации по бонусам","Подтверждённые результаты, правила мотивации и бюджет","Черновик рекомендации с факторами для человека","Сформировать справку; сравнить с правилами; запросить решение",commonForbidden,"HR-директор",0,"Доля рекомендаций, полезных при ручном review","Немедленно отключить при признаке дискриминации или неполном источнике",1,"Отключить сценарий или исключить сотрудника через контракт","Фактические результаты и ручное решение HR остаются","Новые кадровые признаки не анализируются","История принятых человеком решений сохраняется","Расчёт выполняется вручную","Активен","Правила с ручным подтверждением","hr_development,hr_rewards,finance_budgets"],
    ["AI-CONTRACT-CONTENT","Рекомендации по контенту","Публикации, просмотры, клики, лиды, договоры и выручка","Рекомендация темы/формата с полной атрибуцией","Сравнивать форматы; предлагать тест; создать задачу",commonForbidden,"Руководитель маркетинга",0,"Дополнительные подтверждённые заявки на тест","Отключить при отсутствии реальных метрик или 3 бесполезных тестах",1,"Отказ в контракте контентного сценария","Контент-план и ручная аналитика работают","Новые метрики публикаций не обрабатываются моделью","История тестовых рекомендаций сохраняется","Выбор тем становится ручным","Активен","Правила с ручным подтверждением","content_publications,content_attributions"],
    ["AI-CONTRACT-TRENDS","Тренды","Временные ряды KPI с качеством и свежестью","Направление и значимое изменение без причинного утверждения","Рассчитать тренд; показать сравнение и покрытие",commonForbidden,"Бизнес-аналитик",0,"Доля трендов, подтвердившихся следующим периодом","Отключить при coverage <3 периода",1,"Отключить для выбранной метрики","Фактические графики остаются","Новые ряды не получают модельную интерпретацию","История рядов не удаляется","Пользователь интерпретирует график самостоятельно","Активен","Правила с ручным подтверждением","analytics_metric_definitions"],
    ["AI-CONTRACT-METHODS","Рекомендации по методикам","Версия программы, прогресс, посещаемость и обезличенная обратная связь","Проверяемая гипотеза улучшения программы","Предложить эксперимент; связать с версией; создать задачу методисту",commonForbidden,"Главный методист",0,"Изменение учебного результата после утверждённого теста","Отключить при малой выборке или негативном guardrail",1,"Отказ семьи/педагога или всего сценария через контракт","Программы, журнал и ручная работа методиста остаются","Исключённые учебные признаки не анализируются","История версий и решений сохраняется","Гипотезы формируются вручную","Активен","Правила с ручным подтверждением","education_progress,education_feedback,education_programs"],
    ["AI-CONTRACT-HR-RISK","Прогноз кадровых рисков","Вакансии, сроки адаптации, доступы и подтверждённые оценки","Ранний организационный сигнал без оценки личности","Показать операционные факторы; предложить review HR",commonForbidden,"HR-директор",0,"Доля предотвращённых операционных срывов","Отключить при признаке предвзятости или жалобе субъекта",1,"Сотрудник или HR оформляет отказ в контракте","HR-процессы и отчёты работают без прогноза","Новые кадровые признаки субъекта не анализируются","Исторический кадровый факт сохраняется по регламенту","Риск оценивается только вручную","Активен","Правила с ручным подтверждением","hr_vacancies,hr_onboarding,hr_accesses"],
    ["AI-CONTRACT-SUPPLIER","Сравнение подрядчиков","Цена, срок, качество, рейтинг, гарантия и договор","Объяснимый рейтинг предложений без автозакупки","Сравнить; показать формулу; предложить shortlist",commonForbidden,"Руководитель закупок",0,"Экономия при сохранении quality guardrail","Отключить при неполных коммерческих предложениях",1,"Отключить сценарий сравнения в контракте","Таблица предложений и ручной выбор работают","Новые предложения не ранжируются моделью","История закупок сохраняется","Сравнение выполняется вручную","Активен","Правила с ручным подтверждением","procurement_suppliers,supplier_offers"],
    ["AI-CONTRACT-MISSING-DOCS","Отсутствующие документы","Операция, договор и обязательный комплект первички","Список недостающих типов и владелец","Проверить комплект; создать одну задачу",commonForbidden,"Главный бухгалтер",0,"Доля комплектов, закрытых до отчётной даты","Отключить при неверной матрице обязательных документов",1,"Отключить автопроверку в карточке контракта","Реестр первички и ручная комплектность работают","Новые операции не проверяются сценарием","Документы и история задач сохраняются","Контроль выполняется вручную","Активен","Правила с ручным подтверждением","accounting_completeness_checks,accounting_documents"],
    ["AI-CONTRACT-EARLY-SIGNALS","Ранние сигналы проблем","Просрочки, неисправности, отклонения KPI и качество источников","Приоритизированная очередь с доказательствами","Объединить сигналы; объяснить приоритет; предложить задачу",commonForbidden,"Операционный директор",0,"Среднее время от сигнала до ответственного","Отключить при пропуске критичного события или перегрузке очереди",1,"Отключить конкретный домен или весь сценарий","Доменные журналы и задачи продолжают работать","Новые межмодульные признаки не агрегируются","Доменные факты не удаляются","Сигналы просматриваются по модулям вручную","Активен","Правила с ручным подтверждением","tasks,safety_faults,strategy_deviations,integration_conflicts"]
  ];
  await env.DB.batch(contracts.map(row=>env.DB.prepare("INSERT OR IGNORE INTO ai_process_contracts (id,name,input_data,expected_result,allowed_actions,forbidden_actions,human_owner,cost_minor,benefit_metric,auto_stop_condition,opt_out_allowed,opt_out_procedure,fallback_functionality,stopped_data_processing,historical_data_policy,opt_out_impact,status,version,source_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...row)));
  const signals=[
    ["AI-SIG-T-CASH","AI-CONTRACT-CASH-GAP","Финансы","Прогноз","Высокий","В тестовом сценарии возможен кассовый разрыв 4 сентября","Прогнозный остаток проходит ниже нуля после аренды","Начальный остаток 1,2 млн ₽; вероятностные поступления не покрывают зарплату и аренду","Проверить даты поступлений и подготовить человеческое решение по календарю","FC-T-001..006",62,"Новый"],
    ["AI-SIG-T-PAYMENT","AI-CONTRACT-PAYMENTS","Финансы","Прогноз","Средний","На 5 сентября ожидается 149 000 ₽ тестовых оплат","Сумма next_payment_minor активных семей","Три синтетические семьи имеют запланированный платёж на одну дату","Сверить с реальным реестром после подключения источника","LIFE-T-014,LIFE-T-021,LIFE-T-071",58,"Новый"],
    ["AI-SIG-T-LTV","AI-CONTRACT-LTV","Клиенты","Прогноз","Низкий","LIFE-T-014 имеет наибольший тестовый LTV","680 000 ₽ за 8 месяцев в синтетической карточке","Фактическая формула показана, но клиентские данные тестовые","Использовать только для проверки интерфейса","LIFE-T-014,FIN-TEST-CLIENT-014",55,"Новый"],
    ["AI-SIG-T-CHURN","AI-CONTRACT-CHURN","Клиенты","Риск","Высокий","FAM-T-021 требует человеческого контакта","Риск 72: просрочка и нет ответа 12 дней","Правило суммирует только два явно видимых тестовых фактора","Назначить куратору проверку, не принимать решение за семью","LIFE-T-021,FAM-T-021",72,"Новый"],
    ["AI-SIG-T-ANOMALY","AI-CONTRACT-ANOMALY","Финансы","Аномалия","Высокий","Детали расходов апреля не входят в итоговую строку","Расхождение 609 195,38 ₽ между строками исходного ОДДС","Сравнены формулы и значения одного XLSX; оригинал не изменён","Выполнить сверку владельцем ОДДС","FIN-REC-005,INT-CNF-T-ODDS-01",99,"Новый"],
    ["AI-SIG-T-BONUS","AI-CONTRACT-BONUS","HR","Рекомендация","Средний","Депремирование REW-T-063-01 нельзя применять автоматически","Решение находится на согласовании и опирается на синтетический KPI","Кадровое последствие является high-impact и требует человека","Проверить основание, правило мотивации и право сотрудника на review","REW-T-063-01,DEV-T-063-02",95,"Новый"],
    ["AI-SIG-T-CONTENT","AI-CONTRACT-CONTENT","Контент","Рекомендация","Низкий","Повторить тему PUB-T-071 как контролируемый тест","Публикация связана с 1 договором и 46 000 ₽ синтетической выручки","Атрибуция полная, но API соцсетей и CRM не подключены","Создать тест плана, не масштабировать бюджет автоматически","PUB-T-071,ATTR-T-071",68,"Новый"],
    ["AI-SIG-T-METHOD","AI-CONTRACT-METHODS","Обучение","Рекомендация","Средний","Разделить домашнее задание на обязательную и дополнительную части","Оценка FDB-T-015 = 3; выполнение заняло более часа","Один обезличенный отзыв не доказывает эффект для всей программы","Методисту провести малый тест новой версии","FDB-T-015,PRG-T-012",61,"Новый"],
    ["AI-SIG-T-HR","AI-CONTRACT-HR-RISK","HR","Риск","Средний","Аттестация EMP-T-063 приближается","Шаг ONB-T-063-01 назначен на 1 сентября","Это операционный срок, не оценка личности сотрудника","HR проверяет готовность материалов и ответственного","ONB-T-063-01,DEV-T-063-02",90,"Новый"],
    ["AI-SIG-T-SUPPLIER","AI-CONTRACT-SUPPLIER","Закупки","Сравнение","Низкий","Предложение выбирается по цене, сроку и качеству","Формула сравнения этапа 10 раскрыта в карточке предложения","Рынок и коммерческие предложения синтетические","Сохранить человеческое согласование закупки","REQ-T-088,OFFR-T-088-22",77,"Новый"],
    ["AI-SIG-T-DOC","AI-CONTRACT-MISSING-DOCS","Бухгалтерия","Документ","Высокий","Для операции кухни отсутствует счёт","ACC-COMP-T-FOOD: обязательны счёт и накладная; счёт отсутствует","Проверка основана на явной матрице комплекта","Получить документ или зафиксировать применимое исключение","ACC-COMP-T-FOOD,FIN-TEST-FOOD-COST-0821",100,"В работе"],
    ["AI-SIG-T-EARLY","AI-CONTRACT-EARLY-SIGNALS","Безопасность","Ранний сигнал","Высокий","SAFE-FLT-T-032 остаётся в работе","Диагностика начата, завершение и акт отсутствуют","Приоритет задан тяжестью и SLA правила безопасности","Ответственный проверяет завершение и документ, ИИ не закрывает инцидент","SAFE-FLT-T-032,SAFE-REP-T-032",93,"Новый"]
  ];
  await env.DB.batch(signals.map(row=>env.DB.prepare("INSERT OR IGNORE INTO analytics_signals (id,contract_id,domain,signal_type,severity,title,evidence,explanation,recommendation,source_refs,confidence,status,detected_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, '2026-08-21T10:10:00Z')").bind(...row)));
  const runs=[
    ["AI-RUN-T-CASH-01","AI-CONTRACT-CASH-GAP","Сигнал","Возможен отрицательный остаток 4 сентября","62","Начальный остаток + вероятностные поступления − плановые списания; все допущения показаны"],
    ["AI-RUN-T-CHURN-01","AI-CONTRACT-CHURN","Сигнал","Одна синтетическая семья в высокой зоне риска","72","Просрочка и отсутствие ответа 12 дней; решение оставлено куратору"],
    ["AI-RUN-T-ANOM-01","AI-CONTRACT-ANOMALY","Расхождение","Найдено подтверждённое расхождение ОДДС апреля","99","Сравнение детальных строк с итоговой формулой исходного файла"],
    ["AI-RUN-T-CONT-01","AI-CONTRACT-CONTENT","Рекомендация","Повторить PUB-T-071 как малый тест","68","Связь клика, лида, договора и тестовой выручки сохранена"],
    ["AI-RUN-T-DOC-01","AI-CONTRACT-MISSING-DOCS","Задача","Не хватает счёта для ACC-COMP-T-FOOD","100","Явная матрица обязательных типов; задача уже создана идемпотентно"],
    ["AI-RUN-T-EARLY-01","AI-CONTRACT-EARLY-SIGNALS","Сигнал","Открытая неисправность требует контроля результата и акта","93","Приоритет основан на SLA, статусе ремонта и наличии документа"]
  ];
  await env.DB.batch(runs.map(row=>env.DB.prepare("INSERT OR IGNORE INTO ai_model_runs (id,contract_id,ran_at,model_version,status,input_snapshot_ref,output_type,output_summary,confidence,cost_minor,explanation,is_synthetic) VALUES (?,?,'2026-08-21T10:10:00Z','Правила с ручным подтверждением','Завершён','Контрольный снимок аналитики',?,?,?,0,?,1)").bind(row[0],row[1],row[2],row[3],Number(row[4]),row[5])));
}

async function seedReadiness(){
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO education_lessons (id,group_id,program_id,scheduled_at,topic,teacher_entity_id,substitute_entity_id,room,status,homework) VALUES ('LES-T-EMP052-0610','GRP-T-3A','PRG-T-012','2026-06-10T09:00:00Z','Историческое занятие сотрудника №0052','EMP-T-052','','Кабинет 12','Завершено','Историческая запись для проверки кадровой цепочки')"),
    env.DB.prepare("INSERT OR IGNORE INTO document_versions (document_id,version,note,reference,created_by) VALUES ('DOG-T-2026-044',3,'Контрольное решение о продлении','Карточка договора · версия 3','system-readiness-seed')"),
    env.DB.prepare("UPDATE workflow_documents SET current_version=MAX(current_version,3),status='Продлён',valid_until='2027-09-02',updated_at=CURRENT_TIMESTAMP WHERE id='DOG-T-2026-044' AND source='SYNTHETIC'"),
    env.DB.prepare("UPDATE obligations SET status='Закрыто' WHERE document_id='DOG-T-2026-044' AND title='Продлить или закрыть договор'"),
    env.DB.prepare("UPDATE tasks SET status='Завершена',result='Договор продлён в тестовом контуре',result_evidence='Карточка договора · версия 3',completed_at='2026-08-21T10:45:00Z',updated_at=CURRENT_TIMESTAMP WHERE automation_key='CONTRACT_EXPIRY:DOG-T-2026-044' AND created_by='system-automation'"),
    env.DB.prepare("INSERT INTO audit_events (actor,action,entity_type,entity_id,payload) SELECT 'system-readiness-seed','medical.case_closed','medical_case','MED-CASE-T-019','{\"confirmationRef\":\"MED-CONF-T-019\",\"contentExcluded\":true}' WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action='medical.case_closed' AND entity_id='MED-CASE-T-019')"),
    env.DB.prepare("INSERT OR IGNORE INTO strategy_results (id,project_id,event_id,result_type,metric_name,metric_value,unit,evidence,recorded_at) VALUES ('STR-RES-T-KPI-01','STR-PRJ-T-014','','Повторное измерение','Индекс удовлетворённости семей',81,'%','Повторная проверка после корректирующего действия','2026-08-21T10:50:00Z')"),
    env.DB.prepare("INSERT OR IGNORE INTO tasks (title,owner,due_date,priority,status,source_type,source_id,description,assignee_entity_id,kind,automation_key,requires_approval,result,result_evidence,completed_at,created_by) VALUES ('Разобрать обращение семьи №0014','Куратор семьи','2026-08-21','Высокий','Завершена','Жалоба клиента','COMPL-T-014','Проверить обратную связь, провести корректирующее действие и получить оценку результата','EMP-T-032','Корректирующее действие','COMPLAINT:COMPL-T-014',1,'Расписание обратной связи изменено; семья подтвердила результат','Подтверждение семьи после обратной связи','2026-08-21T10:20:00Z','system-readiness-seed')"),
    env.DB.prepare("UPDATE document_versions SET note='Контрольное решение о продлении',reference='Карточка договора · версия 3' WHERE document_id='DOG-T-2026-044' AND version=3 AND created_by='system-readiness-seed' AND reference='SYNTHETIC:DOG-T-2026-044:v3'"),
    env.DB.prepare("UPDATE tasks SET result_evidence='Карточка договора · версия 3' WHERE automation_key='CONTRACT_EXPIRY:DOG-T-2026-044' AND created_by='system-automation' AND result_evidence='SYNTHETIC:DOG-T-2026-044:v3'"),
    env.DB.prepare("UPDATE tasks SET title='Разобрать обращение семьи №0014',result_evidence='Подтверждение семьи после обратной связи' WHERE automation_key='COMPLAINT:COMPL-T-014' AND created_by='system-readiness-seed' AND title='Разобрать обращение семьи T-014'"),
  ]);
  const complaintTask=await env.DB.prepare("SELECT id FROM tasks WHERE automation_key='COMPLAINT:COMPL-T-014'").first<{id:number}>();
  if(!complaintTask)throw new Error("Readiness complaint task was not created");
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO customer_complaints (id,family_entity_id,child_entity_id,service_entity_id,channel,received_at,category,summary,responsible_entity_id,status,related_task_id,satisfaction_score,closed_at) VALUES ('COMPL-T-014','FAM-T-014','CHD-T-014','SVC-T-001','Личный кабинет','2026-08-20T09:10:00Z','Коммуникация','Семье требовался более понятный срок обратной связи','EMP-T-032','Закрыта',?,5,'2026-08-21T10:20:00Z')").bind(complaintTask.id),
    env.DB.prepare("INSERT OR IGNORE INTO complaint_actions (id,complaint_id,task_id,action_type,owner_entity_id,due_at,result,evidence,status,completed_at) VALUES ('CMP-ACT-T-014','COMPL-T-014',?,'Корректирующее действие','EMP-T-032','2026-08-21T12:00:00Z','Срок ответа закреплён, семья получила подтверждение','FDB-COMPLAINT-T-014','Выполнено','2026-08-21T10:20:00Z')").bind(complaintTask.id),
  ]);

  const scenarios:[string,number,string,string,string,string][]=[
    ["SCN-T-01",1,"От объявления до прибыли","Объявление → первый клик → заявка → менеджер → посещение → договор → ребёнок → начисление → оплата → движение денег → отчёт о прибылях и убытках → прибыль","EMP-T-SALES-001","Синтетическая цепочка; банковская операция и рекламная статистика не являются фактом"],
    ["SCN-T-02",2,"Полный жизненный цикл сотрудника","Вакансия → кандидат → адаптация → договор → должность → доступы → расписание → задачи → начисление → выплата → увольнение → отзыв доступов","EMP-T-HR-001","Синтетические кадровые записи; персональные данные исходной ведомости не используются"],
    ["SCN-T-03",3,"Учебный результат и методика","Программа → педагог → группа → занятие → посещаемость → домашнее задание → результат → отзыв родителя → рекомендация методисту","EMP-T-METHOD-001","Синтетические обезличенные учебные карточки"],
    ["SCN-T-04",4,"Закупка от заявки до финансового результата","Заявка → согласование → сравнение поставщиков → заказ → поставка → приём поставки → склад → документ → оплата → отчёт о прибылях и убытках","EMP-T-PROC-001","Синтетическая закупка; электронный документооборот и банковский факт не подключены"],
    ["SCN-T-05",5,"Неисправность до следующей проверки","Проверка → неисправность → задача → подрядчик → ремонт → акт → оплата → следующая проверка","EMP-T-SAFE-001","Синтетический контур безопасности без интеграции системы контроля доступа"],
    ["SCN-T-06",6,"Питание как центр прибыли","Продукт → партия → технологическая карта → производство → отгрузка → потребление → списание → себестоимость → рентабельность","EMP-T-KITCHEN-001","Синтетический производственный и финансовый контур кухни"],
    ["SCN-T-07",7,"Договорное обязательство","Договор → обязательство → срок → предупреждение → задача → продление/закрытие → история","EMP-T-LEGAL-001","Синтетический договор; электронная подпись не подключена"],
    ["SCN-T-08",8,"Жалоба семьи до удовлетворённости","Жалоба → семья → ребёнок → услуга → ответственный → задача → корректирующее действие → результат → удовлетворённость","EMP-T-032","Синтетическое обращение без персональных данных"],
    ["SCN-T-09",9,"Защищённый медицинский случай","Случай → субъект → уполномоченный пользователь → действие → документ → закрытие → защищённый аудит","EMP-T-MED-001","Синтетическая защищённая проверка; медицинское содержание исключено из ответа проверки"],
    ["SCN-T-10",10,"Показатель до нового результата","Показатель → отклонение → источник → причина → задача → ответственный → действие → новый результат","EMP-T-PROJ-001","Синтетические показатели и повторное измерение"],
  ];
  await env.DB.batch(scenarios.map(row=>env.DB.prepare("INSERT OR IGNORE INTO readiness_scenarios (id,number,name,chain,owner_entity_id,status,data_boundary) VALUES (?,?,?,?,?,'Ожидает запуск',?)").bind(...row)));

  const steps:Record<string,[string,string,string,string][]>={
    "SCN-T-01":[["Объявление","Публикация","PUB-T-071","REFERENCE"],["Первый клик","Атрибуция","CLICK-T-071","REFERENCE"],["Заявка","Заявка","LEAD-T-071","REFERENCE"],["Менеджер","Сотрудник","EMP-T-SALES-001","REFERENCE"],["Посещение","Контакт","VISIT-T-014","REFERENCE"],["Договор","Документ","DOG-T-2026-071","REFERENCE"],["Ребёнок","Сущность","CHD-T-071","REFERENCE"],["Начисление","Начисление","ACR-CLIENT-T-071","REFERENCE"],["Оплата","Операция","FIN-TEST-CONTENT-071","REFERENCE"],["Движение денег","Операция","FIN-TEST-CONTENT-071","DERIVED"],["Отчёт о прибылях и убытках","Операция","FIN-TEST-CONTENT-071","DERIVED"],["Прибыль","Операция","FIN-TEST-CONTENT-071","DERIVED"]],
    "SCN-T-02":[["Вакансия","Вакансия","VAC-T-008","REFERENCE"],["Кандидат","Кандидат","CANDREC-T-008","REFERENCE"],["Адаптация","Задача","HR_ONBOARD:EMP-T-052","REFERENCE"],["Договор","Документ","DOG-EMP-T-052","REFERENCE"],["Должность","Должность","POS-T-TEACHER","REFERENCE"],["Доступы","Доступ","ACC-TASKS-052","REFERENCE"],["Расписание","Занятие","LES-T-EMP052-0610","REFERENCE"],["Задачи","Задача","HR_ONBOARD:EMP-T-052","REFERENCE"],["Начисление","Сотрудник","EMP-T-052","DERIVED"],["Выплата","Операция","FIN-TEST-PAYROLL-052","REFERENCE"],["Увольнение","Сотрудник","EMP-T-052","DERIVED"],["Отзыв доступов","Доступ","ACC-EDU-052","DERIVED"]],
    "SCN-T-03":[["Программа","Программа","PRG-T-012","REFERENCE"],["Педагог","Сотрудник","EMP-T-032","REFERENCE"],["Группа","Группа","GRP-T-3A","REFERENCE"],["Занятие","Занятие","LES-T-3A-0821","REFERENCE"],["Посещаемость","Посещение","ATT-T-014","REFERENCE"],["Домашнее задание","Занятие","LES-T-3A-0821","DERIVED"],["Результат","Прогресс","PROG-T-014","REFERENCE"],["Отзыв родителя","Обратная связь","FDB-T-014","REFERENCE"],["Рекомендация методисту","AI-сигнал","AI-SIG-T-METHOD","REFERENCE"]],
    "SCN-T-04":[["Заявка","Заявка","REQ-T-088","REFERENCE"],["Согласование","Заявка","REQ-T-088","DERIVED"],["Сравнение","Предложение","OFFR-T-088-22","REFERENCE"],["Заказ","Заказ","ORD-T-088","REFERENCE"],["Поставка","Поставка","DLV-T-088","REFERENCE"],["Приём поставки","Поставка","DLV-T-088","DERIVED"],["Склад","Движение","INV-T-088-01","REFERENCE"],["Документ","Документ","ACT-REQ-T-088","REFERENCE"],["Оплата","Операция","FIN-TEST-PROC-088","REFERENCE"],["Отчёт о прибылях и убытках","Операция","FIN-TEST-PROC-088","DERIVED"]],
    "SCN-T-05":[["Проверка","Проверка","SAFE-CHK-T-090","REFERENCE"],["Неисправность","Неисправность","SAFE-FLT-T-031","REFERENCE"],["Задача","Задача","SAFETY_FAULT:SAFE-FLT-T-031","REFERENCE"],["Подрядчик","Контрагент","SUP-T-SAFE-001","REFERENCE"],["Ремонт","Ремонт","SAFE-REP-T-031","REFERENCE"],["Акт","Документ","ACT-SAFE-T-031","REFERENCE"],["Оплата","Операция","FIN-TEST-SAFE-031","REFERENCE"],["Следующая проверка","Проверка","SAFE-NEXT-T-031","REFERENCE"]],
    "SCN-T-06":[["Продукт","Продукт","FOOD-PROD-T-002","REFERENCE"],["Партия","Партия","BATCH-T-021-02","REFERENCE"],["Технологическая карта","Рецепт","TTK-T-014","REFERENCE"],["Производство","Производство","PROD-T-0821","REFERENCE"],["Отгрузка","Отгрузка","SHIP-T-0821-01","REFERENCE"],["Потребление","Отгрузка","SHIP-T-0821-01","DERIVED"],["Списание","Отгрузка","SHIP-T-0821-01","DERIVED"],["Себестоимость","Операция","FIN-TEST-FOOD-COST-0821","REFERENCE"],["Рентабельность","Операция","FIN-TEST-FOOD-REV-0821","DERIVED"]],
    "SCN-T-07":[["Договор","Документ","DOG-T-2026-044","REFERENCE"],["Обязательство","Документ","DOG-T-2026-044","DERIVED"],["Срок","Документ","DOG-T-2026-044","DERIVED"],["Предупреждение","Уведомление","CONTRACT_EXPIRY:DOG-T-2026-044:DIRECTOR","REFERENCE"],["Задача","Задача","CONTRACT_EXPIRY:DOG-T-2026-044","REFERENCE"],["Продление","Версия","Карточка договора · версия 3","REFERENCE"],["История","Версия","Дополнительное соглашение · версия 2","REFERENCE"]],
    "SCN-T-08":[["Жалоба","Жалоба","COMPL-T-014","REFERENCE"],["Семья","Сущность","FAM-T-014","REFERENCE"],["Ребёнок","Сущность","CHD-T-014","REFERENCE"],["Услуга","Сущность","SVC-T-001","REFERENCE"],["Ответственный","Сотрудник","EMP-T-032","REFERENCE"],["Задача","Задача","COMPLAINT:COMPL-T-014","REFERENCE"],["Корректирующее действие","Действие","CMP-ACT-T-014","REFERENCE"],["Результат","Доказательство","FDB-COMPLAINT-T-014","REFERENCE"],["Удовлетворённость","Жалоба","COMPL-T-014","DERIVED"]],
    "SCN-T-09":[["Случай","Медицинский случай","MED-CASE-T-019","PROTECTED"],["Субъект","Сущность","EMP-T-063","PROTECTED"],["Уполномоченный пользователь","Grant","MED-GRANT-T-ROLE-01","PROTECTED"],["Действие","Медицинское действие","MED-ACT-T-019-01","PROTECTED"],["Документ","Медицинский документ","MED-DOC-T-EMP-063","PROTECTED"],["Закрытие","Подтверждение","MED-CONF-T-019","PROTECTED"],["Защищённый аудит","Audit","MED-CASE-T-019","PROTECTED"]],
    "SCN-T-10":[["Показатель","Показатель","KPI-T-FAMILY-01","REFERENCE"],["Отклонение","Отклонение","DEV-T-KPI-01","REFERENCE"],["Источник","Обратная связь","FDB-T-014","REFERENCE"],["Причина","Отклонение","DEV-T-KPI-01","DERIVED"],["Задача","Задача","STRATEGY_DEVIATION:DEV-T-KPI-01","REFERENCE"],["Ответственный","Сотрудник","EMP-T-PROJ-001","REFERENCE"],["Действие","Задача","STRATEGY_DEVIATION:DEV-T-KPI-01","DERIVED"],["Новый результат","Результат","STR-RES-T-KPI-01","REFERENCE"]],
  };
  const stepStatements=[];
  for(const scenario of scenarios){
    const scenarioSteps=steps[scenario[0]];
    for(let index=0;index<scenarioSteps.length;index++){
      const step=scenarioSteps[index];
      stepStatements.push(env.DB.prepare("INSERT OR IGNORE INTO readiness_scenario_steps (id,scenario_id,step_order,step_name,entity_type,entity_id,check_type,status) VALUES (?,?,?,?,?,?,?,'Ожидает запуск')").bind(`${scenario[0]}-${String(index+1).padStart(2,"0")}`,scenario[0],index+1,...step));
    }
  }
  for(let index=0;index<stepStatements.length;index+=80)await env.DB.batch(stepStatements.slice(index,index+80));
  await env.DB.batch([
    env.DB.prepare("UPDATE readiness_scenarios SET chain='Объявление → первый клик → заявка → менеджер → посещение → договор → ребёнок → начисление → оплата → движение денег → отчёт о прибылях и убытках → прибыль' WHERE id='SCN-T-01' AND chain='Объявление → первый клик → лид → менеджер → посещение → договор → ребёнок → начисление → оплата → ДДС → ОПиУ → прибыль'"),
    env.DB.prepare("UPDATE readiness_scenarios SET chain='Вакансия → кандидат → адаптация → договор → должность → доступы → расписание → задачи → начисление → выплата → увольнение → отзыв доступов',data_boundary='Синтетические кадровые записи; персональные данные исходной ведомости не используются' WHERE id='SCN-T-02' AND chain='Вакансия → кандидат → онбординг → договор → должность → доступы → расписание → задачи → начисление → выплата → увольнение → отзыв доступов'"),
    env.DB.prepare("UPDATE readiness_scenarios SET name='Закупка от заявки до финансового результата',chain='Заявка → согласование → сравнение поставщиков → заказ → поставка → приём поставки → склад → документ → оплата → отчёт о прибылях и убытках',data_boundary='Синтетическая закупка; электронный документооборот и банковский факт не подключены' WHERE id='SCN-T-04' AND name='Закупка от заявки до ОПиУ'"),
    env.DB.prepare("UPDATE readiness_scenarios SET data_boundary='Синтетический контур безопасности без интеграции системы контроля доступа' WHERE id='SCN-T-05' AND data_boundary='Синтетический контур безопасности без интеграции СКУД'"),
    env.DB.prepare("UPDATE readiness_scenarios SET chain='Продукт → партия → технологическая карта → производство → отгрузка → потребление → списание → себестоимость → рентабельность' WHERE id='SCN-T-06' AND chain='Продукт → партия → ТТК → производство → отгрузка → потребление → списание → себестоимость → рентабельность'"),
    env.DB.prepare("UPDATE readiness_scenarios SET name='Показатель до нового результата',chain='Показатель → отклонение → источник → причина → задача → ответственный → действие → новый результат',data_boundary='Синтетические показатели и повторное измерение' WHERE id='SCN-T-10' AND name='KPI до нового результата'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Заявка',entity_type='Заявка' WHERE scenario_id='SCN-T-01' AND step_order=3 AND step_name='Лид'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Движение денег' WHERE scenario_id='SCN-T-01' AND step_order=10 AND step_name='ДДС'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Отчёт о прибылях и убытках' WHERE scenario_id='SCN-T-01' AND step_order=11 AND step_name='ОПиУ'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Адаптация' WHERE scenario_id='SCN-T-02' AND step_order=3 AND step_name='Онбординг'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Приём поставки' WHERE scenario_id='SCN-T-04' AND step_order=6 AND step_name='Приёмка'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Отчёт о прибылях и убытках' WHERE scenario_id='SCN-T-04' AND step_order=10 AND step_name='ОПиУ'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Технологическая карта' WHERE scenario_id='SCN-T-06' AND step_order=3 AND step_name='ТТК'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET step_name='Показатель',entity_type='Показатель' WHERE scenario_id='SCN-T-10' AND step_order=1 AND step_name='KPI'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET entity_id='Карточка договора · версия 3' WHERE scenario_id='SCN-T-07' AND step_order=6 AND entity_id='SYNTHETIC:DOG-T-2026-044:v3'"),
    env.DB.prepare("UPDATE readiness_scenario_steps SET entity_id='Дополнительное соглашение · версия 2' WHERE scenario_id='SCN-T-07' AND step_order=7 AND entity_id='SYNTHETIC:DOG-T-2026-044:v2'"),
    env.DB.prepare("UPDATE readiness_scenarios SET data_boundary='Синтетическая защищённая проверка; медицинское содержание исключено из ответа проверки' WHERE id='SCN-T-09' AND data_boundary='PROTECTED_SYNTHETIC; медицинское содержание исключено из readiness API'"),
  ]);

  const gates=[
    ["GATE-T-SCENARIOS","10 сквозных сценариев","Ожидает запуск",1,"Все обязательные шаги должны пройти повторяемую проверку рабочей базы","EMP-T-QA-001"],
    ["GATE-T-P0P1","Критические дефекты","Пройдено",1,"Сборка, проверка качества кода и автоматические тесты завершены без критических дефектов","EMP-T-QA-001"],
    ["GATE-T-RBAC","Права и медицинская изоляция","Пройдено",1,"Ограничения ролей, отдельный медицинский допуск и запрет медицинских агрегатов покрыты тестами","EMP-T-QA-001"],
    ["GATE-T-MIGRATIONS","Безопасные изменения базы","Пройдено",1,"Схема расширяется без разрушительных изменений; повторная инициализация безопасна","EMP-T-QA-001"],
    ["GATE-T-INTEGRATIONS","Реальные интеграции","Заблокировано",1,"Банки, система продаж, дневник, электронный документооборот, учёт и рекламные кабинеты подключены не полностью","EMP-T-INT-001"],
    ["GATE-T-BACKUP","Восстановление рабочей базы","Заблокировано",1,"Практическое восстановление резервной копии не выполнялось; проверки артефакта недостаточно","EMP-T-QA-001"],
    ["GATE-T-ROLLBACK","Откат приложения","Пройдено",1,"Опубликованную версию можно вернуть без разрушительного изменения данных","EMP-T-QA-001"],
    ["GATE-T-BROWSER","Браузеры, внешний вид и скорость","Ограничено",1,"Сборка проверена; полная проверка поддерживаемых браузеров и производительности ещё не подтверждена","EMP-T-QA-001"],
    ["GATE-T-APPROVAL","Отдельное разрешение на выпуск","Заблокировано",1,"Проверка системы не заменяет отдельного решения собственника","Собственник"],
  ];
  await env.DB.batch(gates.map(row=>env.DB.prepare("INSERT OR IGNORE INTO release_gates (id,name,status,required,evidence,owner_entity_id,updated_at) VALUES (?,?,?,?,?,?,'2026-08-21T11:00:00Z')").bind(...row)));
  await env.DB.batch([
    env.DB.prepare("UPDATE release_gates SET evidence='Все обязательные шаги должны пройти повторяемую проверку рабочей базы' WHERE id='GATE-T-SCENARIOS' AND evidence='Все обязательные шаги должны пройти повторяемую проверку D1'"),
    env.DB.prepare("UPDATE release_gates SET name='Критические дефекты',evidence='Сборка, проверка качества кода и автоматические тесты завершены без критических дефектов' WHERE id='GATE-T-P0P1' AND name='P0/P1 = 0'"),
    env.DB.prepare("UPDATE release_gates SET evidence='Ограничения ролей, отдельный медицинский допуск и запрет медицинских агрегатов покрыты тестами' WHERE id='GATE-T-RBAC' AND evidence='Role guards, отдельный grant и запрет медицинских агрегатов покрыты тестами'"),
    env.DB.prepare("UPDATE release_gates SET name='Безопасные изменения базы',evidence='Схема расширяется без разрушительных изменений; повторная инициализация безопасна' WHERE id='GATE-T-MIGRATIONS' AND name='Аддитивные миграции'"),
    env.DB.prepare("UPDATE release_gates SET evidence='Банки, система продаж, дневник, электронный документооборот, учёт и рекламные кабинеты подключены не полностью' WHERE id='GATE-T-INTEGRATIONS' AND evidence='Банки, CRM, дневник, ЭДО/1С, СКУД и рекламные API не подключены'"),
    env.DB.prepare("UPDATE release_gates SET name='Восстановление рабочей базы',evidence='Практическое восстановление резервной копии не выполнялось; проверки артефакта недостаточно' WHERE id='GATE-T-BACKUP' AND name='Восстановление D1'"),
    env.DB.prepare("UPDATE release_gates SET evidence='Опубликованную версию можно вернуть без разрушительного изменения данных' WHERE id='GATE-T-ROLLBACK' AND evidence='Каждый Sites checkpoint неизменяем и допускает возврат версии; миграции аддитивны'"),
    env.DB.prepare("UPDATE release_gates SET name='Браузеры, внешний вид и скорость',evidence='Сборка проверена; полная проверка поддерживаемых браузеров и производительности ещё не подтверждена' WHERE id='GATE-T-BROWSER' AND name='Браузеры, visual и performance'"),
    env.DB.prepare("UPDATE release_gates SET name='Отдельное разрешение на выпуск',evidence='Проверка системы не заменяет отдельного решения собственника',owner_entity_id='Собственник' WHERE id='GATE-T-APPROVAL' AND owner_entity_id='ROLE:REPRESENTATIVE'"),
  ]);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO recovery_drills (id,drill_type,scope,started_at,finished_at,status,rpo_minutes,rto_minutes,checksum_before,checksum_after,evidence,limitation) VALUES ('DRILL-T-ARTIFACT-01','Проверка артефакта','Исходный код и состав сборки','2026-08-21T10:55:00Z','2026-08-21T11:00:00Z','Пройдено',0,5,'SOURCE-TREE-STAGE17','BUILD-STAGE18','Сборка формирует проверяемый неизменяемый артефакт','Не подтверждает восстановление рабочей базы')"),
    env.DB.prepare("INSERT OR IGNORE INTO recovery_drills (id,drill_type,scope,started_at,finished_at,status,rpo_minutes,rto_minutes,checksum_before,checksum_after,evidence,limitation) VALUES ('DRILL-T-D1-RESTORE-01','Восстановление из резервной копии','Тестовая копия рабочей базы','','','Не выполнено',0,0,'','','Нет выделенной копии и разрешённой процедуры восстановления','До практической проверки выпуск запрещён')"),
    env.DB.prepare("UPDATE recovery_drills SET scope='Исходный код и состав сборки',evidence='Сборка формирует проверяемый неизменяемый артефакт',limitation='Не подтверждает восстановление рабочей базы' WHERE id='DRILL-T-ARTIFACT-01' AND scope='Исходный код + build manifest'"),
    env.DB.prepare("UPDATE recovery_drills SET scope='Тестовая копия рабочей базы',evidence='Нет выделенной копии и разрешённой процедуры восстановления',limitation='До практической проверки выпуск запрещён' WHERE id='DRILL-T-D1-RESTORE-01' AND scope='Live D1 test database'"),
  ]);
}
