import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { loadArticleCatalog, saveArticleCatalog, saveClassification } from '../lib/finance-article-store.ts';
import { changeCatalog, validateClassification, readCatalog } from '../lib/finance-articles.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT,updated_at TEXT);
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT);
    CREATE TABLE bank_transactions(id TEXT,amount_minor INTEGER,description TEXT);
    INSERT INTO bank_transactions VALUES('bank',12345,'synthetic');
    CREATE TABLE financial_operations(id TEXT PRIMARY KEY,updated_at TEXT,amount_minor INTEGER,operation_date TEXT,direction TEXT,bank_operation_ref TEXT,
      cashflow_article TEXT,category TEXT,pnl_article TEXT,report_class TEXT,accrual_period TEXT,counterparty_label TEXT,management_purpose TEXT,
      contract_id TEXT,document_id TEXT,project_entity_id TEXT,object_entity_id TEXT,cfr_entity_id TEXT,status TEXT);
    INSERT INTO financial_operations VALUES('op','2026-09-10T00:00:00.000Z',12345,'2026-09-10','Списание','bank','','Не классифицировано','','Не включено в ОПиУ','','','','','','','','','Не разнесено');`);
  function prepare(source) {
    let values = [];
    return { bind(...args) { values = args; return this; }, async first() { return sql.prepare(source).get(...values) ?? null; }, execute() { return { results: sql.prepare(source).all(...values) }; } };
  }
  const database = { prepare, async batch(statements) {
    sql.exec('BEGIN');
    try { const result = statements.map(statement => statement.execute()); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, database };
}
async function activeCatalog(database) {
  const before = await loadArticleCatalog(database);
  const proposed = changeCatalog(before.catalog, { action: 'createArticle', name: 'Аренда', report: 'cashflow', direction: 'Списание', group: 'operating' }, 'FINANCE', 'a');
  const active = changeCatalog(proposed, { action: 'approveArticle', articleId: 'a' }, 'OWNER', '');
  await saveArticleCatalog(database, before, active, 'test-owner', 'approveArticle');
  return loadArticleCatalog(database);
}
const op = { id: 'op', updatedAt: '2026-09-10T00:00:00.000Z', cashflowArticle: '', category: 'Не классифицировано', pnlArticle: '', reportClass: 'Не включено в ОПиУ', accrualPeriod: '', direction: 'Списание' };
const body = { expectedUpdatedAt: op.updatedAt, cashflowArticle: 'Аренда', reportClass: 'Не включено в ОПиУ' };
test('two catalog editors: loser gets conflict and creates no audit entry', async () => {
  const { sql, database } = fixture();
  const stale = await loadArticleCatalog(database);
  await activeCatalog(database);
  await assert.rejects(() => saveArticleCatalog(database, stale, { ...stale.catalog, revision: 1 }, 'other', 'createArticle'), /уже изменён/);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM audit_events').get().n, 1);
  assert.equal((await loadArticleCatalog(database)).catalog.articles[0].name, 'Аренда');
});
test('classification and audit atomic; money, bank reference and bank row unchanged', async () => {
  const { sql, database } = fixture();
  const snapshot = await activeCatalog(database);
  const before = sql.prepare('SELECT * FROM bank_transactions').all();
  const patch = validateClassification(snapshot.catalog, op, body);
  const saved = await saveClassification(database, snapshot, op, patch, 'test-owner');
  assert.notEqual(saved.updatedAt, op.updatedAt);
  assert.equal(sql.prepare('SELECT category FROM financial_operations').get().category, 'Аренда');
  assert.deepEqual(sql.prepare('SELECT amount_minor,operation_date,direction,bank_operation_ref FROM financial_operations').get(), Object.assign(Object.create(null), { amount_minor: 12345, operation_date: '2026-09-10', direction: 'Списание', bank_operation_ref: 'bank' }));
  assert.deepEqual(sql.prepare('SELECT * FROM bank_transactions').all(), before);
  await assert.rejects(() => saveClassification(database, snapshot, op, patch, 'other'), /уже изменены/);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM audit_events WHERE action='finance.operation_classified'").get().n, 1);
});
test('catalog archived after preview prevents allocation', async () => {
  const { sql, database } = fixture();
  const snapshot = await activeCatalog(database);
  const patch = validateClassification(snapshot.catalog, op, body);
  const archived = changeCatalog(snapshot.catalog, { action: 'archiveArticle', articleId: 'a' }, 'OWNER', '');
  await saveArticleCatalog(database, snapshot, archived, 'test-owner', 'archiveArticle');
  await assert.rejects(() => saveClassification(database, snapshot, op, patch, 'test-owner'), /уже изменены/);
  assert.equal(sql.prepare('SELECT cashflow_article FROM financial_operations').get().cashflow_article, '');
});
test('failed audit rolls back allocation and catalog, without repairing or resetting state', async () => {
  const { sql, database } = fixture();
  const snapshot = await activeCatalog(database);
  sql.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'test audit unavailable'); END;");
  await assert.rejects(() => saveClassification(database, snapshot, op, validateClassification(snapshot.catalog, op, body), 'test-owner'), /audit unavailable/);
  assert.equal(sql.prepare('SELECT cashflow_article FROM financial_operations').get().cashflow_article, '');
  const archived = changeCatalog(snapshot.catalog, { action: 'archiveArticle', articleId: 'a' }, 'OWNER', '');
  await assert.rejects(() => saveArticleCatalog(database, snapshot, archived, 'test-owner', 'archiveArticle'), /audit unavailable/);
  assert.equal((await loadArticleCatalog(database)).raw, snapshot.raw);
});
test('corrupt persisted dictionary fails closed instead of seeding an empty replacement', () => {
  for (const raw of ['broken', '{}', '{"schema":1,"revision":0,"articles":[]}']) assert.throws(() => readCatalog(raw), /недоступен/);
});
