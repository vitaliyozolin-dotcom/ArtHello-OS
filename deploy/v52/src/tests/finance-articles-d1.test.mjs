import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { changeCatalog, validateClassification } from '../lib/finance-articles.ts';
import { loadArticleCatalog, saveArticleCatalog, saveClassification } from '../lib/finance-article-store.ts';

test('actual D1 batch: approve, allocate once under race, audit failure rolls back; raw bank preserved', { timeout: 30000 }, async t => {
  const runtime = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', cf: false,
    log: new Log(LogLevel.ERROR), d1Databases: ['DB'], script: 'export default { fetch() { return new Response("fixture"); } };' });
  t.after(() => runtime.dispose());
  const database = await runtime.getD1Database('DB');
  await database.batch([
    database.prepare('CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT,updated_at TEXT)'),
    database.prepare("CREATE TABLE audit_events(id INTEGER PRIMARY KEY,actor TEXT CHECK(actor<>'reject-test-audit'),action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT)"),
    database.prepare('CREATE TABLE bank_transactions(id TEXT,amount_minor INTEGER,description TEXT)'),
    database.prepare("INSERT INTO bank_transactions VALUES('bank',12345,'synthetic')"),
    database.prepare(`CREATE TABLE financial_operations(id TEXT PRIMARY KEY,updated_at TEXT,amount_minor INTEGER,operation_date TEXT,direction TEXT,bank_operation_ref TEXT,
      cashflow_article TEXT,category TEXT,pnl_article TEXT,report_class TEXT,accrual_period TEXT,counterparty_label TEXT,management_purpose TEXT,
      contract_id TEXT,document_id TEXT,project_entity_id TEXT,object_entity_id TEXT,cfr_entity_id TEXT,status TEXT)`),
    database.prepare("INSERT INTO financial_operations VALUES('op','2026-09-10T00:00:00.000Z',12345,'2026-09-10','Списание','bank','','Не классифицировано','','Не включено в ОПиУ','','','','','','','','','Не разнесено')"),
  ]);
  let snapshot = await loadArticleCatalog(database);
  const proposed = changeCatalog(snapshot.catalog, { action: 'createArticle', name: 'Аренда', report: 'cashflow', direction: 'Списание', group: 'operating' }, 'FINANCE', 'a');
  await saveArticleCatalog(database, snapshot, proposed, 'test-finance', 'createArticle');
  snapshot = await loadArticleCatalog(database);
  const approved = changeCatalog(snapshot.catalog, { action: 'approveArticle', articleId: 'a' }, 'OWNER', '');
  await saveArticleCatalog(database, snapshot, approved, 'test-owner', 'approveArticle');
  snapshot = await loadArticleCatalog(database);
  const op = { id: 'op', updatedAt: '2026-09-10T00:00:00.000Z', direction: 'Списание', cashflowArticle: '', category: 'Не классифицировано', pnlArticle: '', reportClass: 'Не включено в ОПиУ', accrualPeriod: '' };
  const patch = validateClassification(snapshot.catalog, op, { expectedUpdatedAt: op.updatedAt, cashflowArticle: 'Аренда', reportClass: 'Не включено в ОПиУ' });
  const results = await Promise.allSettled([
    saveClassification(database, snapshot, op, patch, 'test-finance'),
    saveClassification(database, snapshot, op, patch, 'test-owner'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const loser = results.find(result => result.status === 'rejected');
  assert.equal(loser.reason.status, 409);
  assert.equal((await database.prepare("SELECT count(*) AS n FROM audit_events WHERE action='finance.operation_classified'").first()).n, 1);
  const current = results.find(result => result.status === 'fulfilled').value;
  await assert.rejects(() => saveClassification(database, snapshot, current, { ...patch, managementPurpose: 'must roll back' }, 'reject-test-audit'));
  const row = await database.prepare('SELECT * FROM financial_operations').first();
  assert.equal(row.cashflow_article, 'Аренда'); assert.equal(row.management_purpose, '');
  assert.equal(row.updated_at, current.updatedAt); assert.equal(row.amount_minor, 12345); assert.equal(row.bank_operation_ref, 'bank');
  assert.deepEqual((await database.prepare('SELECT * FROM bank_transactions').all()).results, [{ id: 'bank', amount_minor: 12345, description: 'synthetic' }]);
  const archived = changeCatalog(snapshot.catalog, { action: 'archiveArticle', articleId: 'a' }, 'OWNER', '');
  await assert.rejects(() => saveArticleCatalog(database, snapshot, archived, 'reject-test-audit', 'archiveArticle'));
  assert.equal((await loadArticleCatalog(database)).raw, snapshot.raw);
});
