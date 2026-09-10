import { FinanceArticleError, readCatalog, type ArticleCatalog, type AllocationOperation, type validateClassification } from './finance-articles.ts';

export const CATALOG_KEY = 'finance_article_catalog_v1';
export type CatalogSnapshot = { catalog: ArticleCatalog; raw: string | null };
export async function loadArticleCatalog(database: D1Database): Promise<CatalogSnapshot> {
  const row = await database.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').bind(CATALOG_KEY).first<{ state_value: string }>();
  const raw = row?.state_value ?? null;
  return { catalog: readCatalog(raw), raw };
}
export async function saveArticleCatalog(database: D1Database, before: CatalogSnapshot, catalog: ArticleCatalog, actor: string, action: string) {
  const serialized = JSON.stringify(catalog);
  const write = before.raw === null
    ? database.prepare('INSERT INTO system_runtime_state(state_key,state_value,updated_at) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM system_runtime_state WHERE state_key=?) RETURNING state_key').bind(CATALOG_KEY, serialized, new Date().toISOString(), CATALOG_KEY)
    : database.prepare('UPDATE system_runtime_state SET state_value=?,updated_at=? WHERE state_key=? AND state_value=? RETURNING state_key').bind(serialized, new Date().toISOString(), CATALOG_KEY, before.raw);
  const result = await database.batch([write, database.prepare(`INSERT INTO audit_events(actor,action,entity_type,entity_id,payload)
    SELECT ?,?,'finance_article_catalog',?,? WHERE changes()=1`).bind(actor, `finance.${action}`, CATALOG_KEY, JSON.stringify({ beforeRevision: before.catalog.revision, revision: catalog.revision, before: before.catalog.articles, after: catalog.articles }))]);
  if (!result[0].results?.length) throw new FinanceArticleError('Справочник уже изменён. Обновите страницу.', 409);
}
const columns = {
  cashflowArticle: 'cashflow_article', category: 'category', pnlArticle: 'pnl_article', reportClass: 'report_class', accrualPeriod: 'accrual_period',
  counterpartyLabel: 'counterparty_label', managementPurpose: 'management_purpose', contractId: 'contract_id', documentId: 'document_id',
  projectEntityId: 'project_entity_id', objectEntityId: 'object_entity_id', cfrEntityId: 'cfr_entity_id', status: 'status',
} as const;
export async function saveClassification(database: D1Database, snapshot: CatalogSnapshot, operation: AllocationOperation, patch: ReturnType<typeof validateClassification>, actor: string) {
  const entries = Object.entries(columns) as Array<[keyof typeof columns, string]>;
  // Strictly advance the timestamp even when two edits occur within one millisecond.
  const previousTime = Date.parse(operation.updatedAt.endsWith('Z') ? operation.updatedAt : operation.updatedAt.replace(' ', 'T') + 'Z');
  const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
  const catalogGuard = snapshot.raw === null
    ? 'NOT EXISTS (SELECT 1 FROM system_runtime_state WHERE state_key=?)'
    : 'EXISTS (SELECT 1 FROM system_runtime_state WHERE state_key=? AND state_value=?)';
  const guardValues = snapshot.raw === null ? [CATALOG_KEY] : [CATALOG_KEY, snapshot.raw];
  const write = database.prepare(`UPDATE financial_operations SET ${entries.map(([, column]) => `${column}=?`).join(',')},updated_at=? WHERE id=? AND updated_at=? AND ${catalogGuard} RETURNING id`)
    .bind(...entries.map(([key]) => patch[key]), updatedAt, operation.id, operation.updatedAt, ...guardValues);
  const before = operation as unknown as Record<string, unknown>;
  const changes = Object.fromEntries(entries.filter(([key]) => before[key] !== patch[key]).map(([key]) => [key, [before[key] ?? '', patch[key]]]));
  const result = await database.batch([write, database.prepare(`INSERT INTO audit_events(actor,action,entity_type,entity_id,payload)
    SELECT ?,'finance.operation_classified','financial_operation',?,? WHERE changes()=1`).bind(actor, operation.id, JSON.stringify({ immutableBankFact: true, catalogRevision: snapshot.catalog.revision, changes }))]);
  if (!result[0].results?.length) throw new FinanceArticleError('Операция или справочник уже изменены. Обновите страницу.', 409);
  return { ...operation, ...patch, updatedAt };
}
