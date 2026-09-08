import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { inspectDatabase, activeRelativePath } from '../production-readonly.mjs';

test('canonical D1 identity is deterministic, not discovered by row count', () => {
  assert.match(activeRelativePath(), /^d1\/miniflare-D1DatabaseObject\/[a-f0-9]{64}\.sqlite$/);
});
test('missing schema is explicit, never an empty successful product check', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const result = inspectDatabase(db);
    assert.equal(result.liveAcceptance, 'not_run');
    assert.equal(result.tables.bank_accounts.state, 'not_installed');
    assert.equal(result.checks.bankLinks.state, 'schema_missing');
  } finally { db.close(); }
});
test('only bounded aggregates are emitted, with broken bank links distinguished', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE financial_operations(id TEXT PRIMARY KEY); CREATE TABLE bank_transactions(id TEXT PRIMARY KEY, financial_operation_id TEXT, description TEXT); INSERT INTO bank_transactions VALUES('PRIVATE-ID','missing','PRIVATE-BODY');");
    const result = inspectDatabase(db);
    assert.equal(result.tables.bank_transactions.rows, 1);
    assert.equal(result.checks.bankLinks.violations, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n, 1);
    assert.throws(() => db.exec('DELETE FROM bank_transactions'));
  } finally { db.close(); }
});
test('row cap is explicit and does not turn partial inspection into verification', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE bank_accounts(id INTEGER); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10001) INSERT INTO bank_accounts SELECT x FROM n;');
    const result = inspectDatabase(db);
    assert.equal(result.tables.bank_accounts.state, 'over_limit');
    assert.equal(result.tables.bank_accounts.rows, undefined);
  } finally { db.close(); }
});

test('schema drift returns only a fixed unavailable state', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE bank_transactions(private_column TEXT); CREATE TABLE financial_operations(id TEXT PRIMARY KEY);');
    const result = inspectDatabase(db);
    assert.deepEqual(result.checks.bankLinks, { state: 'unavailable' });
    assert.equal(JSON.stringify(result).includes('private_column'), false);
    // The read transaction has ended; another inspection is permitted.
    assert.deepEqual(inspectDatabase(db).checks.bankLinks, { state: 'unavailable' });
  } finally { db.close(); }
});
