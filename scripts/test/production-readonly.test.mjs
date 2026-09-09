import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { inspectDatabase, activeRelativePath, diagnosticExitCode } from '../production-readonly.mjs';

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

test('missing, errored, partial or violated checks never produce a successful process status', () => {
  for (const state of ['not_installed', 'over_limit', 'unavailable']) {
    assert.equal(diagnosticExitCode({ tables: { x: { state } }, checks: {} }), 2);
  }
  for (const state of ['schema_missing', 'not_checked', 'unavailable']) {
    assert.equal(diagnosticExitCode({ tables: {}, checks: { x: { state } } }), 2);
  }
  assert.equal(diagnosticExitCode({ tables: {}, checks: { x: { state: 'observed', violations: 1 } } }), 2);
  assert.equal(diagnosticExitCode({ tables: { x: { state: 'observed', rows: 0 } }, checks: { x: { state: 'observed', violations: 0 } } }), 0);
});

test('system and branch grants validate both reference endpoints', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE app_users(id TEXT PRIMARY KEY); CREATE TABLE app_systems(id TEXT PRIMARY KEY); CREATE TABLE organization_branches(id TEXT PRIMARY KEY); CREATE TABLE user_system_access(user_id TEXT, system_id TEXT); CREATE TABLE user_branch_access(user_id TEXT, branch_id TEXT); INSERT INTO user_system_access VALUES('missing-user','missing-system'); INSERT INTO user_branch_access VALUES('missing-user','missing-branch');");
    const result = inspectDatabase(db);
    for (const key of ['accessUsers', 'accessSystems', 'branchUsers', 'branchTargets']) {
      assert.deepEqual(result.checks[key], { state: 'observed', violations: 1 });
    }
    assert.equal(JSON.stringify(result).includes('missing-user'), false);
  } finally { db.close(); }
});

const bankNow = Date.parse('2026-09-09T12:00:00.000Z');
const bankSyncTime = '2026-09-09T11:00:00.000Z';
const bankOptions = { now: bankNow, syncNotBefore: '2026-09-09T10:00:00.000Z' };

function bankFixture({ complete = false, status = 'Успешно', runTime = bankSyncTime } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_users(id TEXT);
    CREATE TABLE app_systems(id TEXT);
    CREATE TABLE organization_branches(id TEXT);
    CREATE TABLE user_system_access(user_id TEXT,system_id TEXT);
    CREATE TABLE user_branch_access(user_id TEXT,branch_id TEXT);
    CREATE TABLE developer_feedback(id TEXT,author_user_id TEXT);
    CREATE TABLE developer_feedback_events(feedback_id TEXT);
    CREATE TABLE integration_connections(id TEXT);
    CREATE TABLE alfacrm_finance_snapshots(id TEXT);
    CREATE TABLE alfacrm_family_merge_candidates(id TEXT);
    CREATE TABLE integration_sync_runs(id TEXT,connection_id TEXT,dry_run INTEGER,status TEXT,
      rejected_count INTEGER,error_count INTEGER,conflict_count INTEGER,started_at TEXT,finished_at TEXT);
    CREATE TABLE bank_accounts(id TEXT,connection_id TEXT,legal_entity_id TEXT,provider_account_id TEXT,synced_at TEXT);
    CREATE TABLE bank_statement_imports(id TEXT,connection_id TEXT,legal_entity_id TEXT,provider_account_id TEXT,
      start_date TEXT,end_date TEXT,status TEXT,transaction_count INTEGER,fetched_at TEXT);
    CREATE TABLE bank_transactions(id TEXT,connection_id TEXT,legal_entity_id TEXT,provider_account_id TEXT,
      provider_statement_id TEXT,provider_transaction_id TEXT,financial_operation_id TEXT,operation_date TEXT,
      status TEXT,currency TEXT,direction TEXT,description TEXT);
    CREATE TABLE financial_operations(id TEXT);
    INSERT INTO integration_connections VALUES('INT-T-TOCHKA');
  `);
  if (complete) {
    db.prepare('INSERT INTO integration_sync_runs VALUES(?,?,?,?,?,?,?,?,?)')
      .run('PRIVATE-RUN', 'INT-T-TOCHKA', 0, status, 0, 0, 0, runTime, runTime);
    for (let i = 0; i < 4; i++) {
      db.prepare('INSERT INTO bank_accounts VALUES(?,?,?,?,?)')
        .run('PRIVATE-A-' + i, 'INT-T-TOCHKA', 'PRIVATE-ENTITY', 'PRIVATE-ACCOUNT-' + i, runTime);
      db.prepare('INSERT INTO bank_statement_imports VALUES(?,?,?,?,?,?,?,?,?)')
        .run('PRIVATE-STMT-' + i, 'INT-T-TOCHKA', 'PRIVATE-ENTITY', 'PRIVATE-ACCOUNT-' + i,
          '2026-09-01', '2026-09-09', 'Ready', i === 0 ? 2 : 0, runTime);
    }
    for (let i = 0; i < 2; i++) {
      db.prepare('INSERT INTO financial_operations VALUES(?)').run('PRIVATE-FIN-' + i);
      db.prepare('INSERT INTO bank_transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('PRIVATE-TX-' + i, 'INT-T-TOCHKA', 'PRIVATE-ENTITY', 'PRIVATE-ACCOUNT-0',
          'PRIVATE-STMT-0', 'PRIVATE-EXTERNAL-' + i, 'PRIVATE-FIN-' + i,
          '2026-09-05', 'Booked', 'RUB', i ? 'Списание' : 'Поступление', 'PRIVATE-BODY');
    }
  }
  return db;
}

test('bank aggregate: an installed but empty database is unobserved, never complete', () => {
  const db = bankFixture();
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankWindow.state, 'observed');
    assert.equal(result.bankWindow.sync.state, 'not_observed');
    assert.equal(result.bankWindow.coverage.accountRows, 0);
    assert.equal(result.bankWindow.checksComplete, false);
    assert.equal(diagnosticExitCode(result), 2);
  } finally { db.close(); }
});

test('bank aggregate: all four current statements and booked links pass only bounded checks', () => {
  const db = bankFixture({ complete: true });
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.deepEqual(result.bankWindow.period, { startDate: '2026-09-01', endDate: '2026-09-09' });
    assert.equal(result.bankWindow.coverage.coveredInLatestRun, 4);
    assert.equal(result.bankWindow.coverage.accountsWithContainingStatementInLatestRun, 4);
    assert.equal(result.bankWindow.coverage.accountsWithMatchingTransactionCount, 4);
    assert.equal(result.bankWindow.transactions.incomeRows, 1);
    assert.equal(result.bankWindow.transactions.expenseRows, 1);
    assert.equal(result.bankWindow.sync.freshness, 'verified');
    assert.equal(result.bankWindow.checksComplete, true);
    assert.equal(result.liveAcceptance, 'not_run');
    assert.equal(diagnosticExitCode(result), 0);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.throws(() => db.exec('DELETE FROM bank_transactions'));
  } finally { db.close(); }
});

test('bank aggregate: latest pending, failed, review or unknown outcomes cannot pass old full coverage', () => {
  for (const [status, normalized] of [
    ['Ожидание банка', 'pending'], ['Ошибка', 'failed'],
    ['Требует проверки', 'review_required'], ['PRIVATE-UNKNOWN', 'unknown'],
  ]) {
    const db = bankFixture({ complete: true, status });
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankWindow.sync.state, normalized);
      assert.equal(result.bankWindow.checksComplete, false);
      assert.equal(diagnosticExitCode(result), 2);
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    } finally { db.close(); }
  }
});

test('bank aggregate: a broader current statement is visible without satisfying exact-window checks', () => {
  const db = bankFixture({ complete: true });
  db.exec("UPDATE bank_statement_imports SET start_date='2026-01-01'");
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankWindow.coverage.accountsWithContainingStatementInLatestRun, 4);
    assert.equal(result.bankWindow.coverage.coveredInLatestRun, 0);
    assert.equal(result.bankWindow.coverage.accountsWithMatchingTransactionCount, 0);
    assert.equal(result.bankWindow.checksComplete, false);
    assert.equal(diagnosticExitCode(result), 2);
    assert.equal(result.liveAcceptance, 'not_run');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally { db.close(); }
});

test('bank aggregate: containing coverage rejects partial windows, unready, stale and malformed statements', () => {
  for (const sql of [
    "UPDATE bank_statement_imports SET start_date='2026-09-02'",
    "UPDATE bank_statement_imports SET end_date='2026-09-08'",
    "UPDATE bank_statement_imports SET status='Pending'",
    "UPDATE bank_statement_imports SET fetched_at='2026-09-09T10:00:00.000Z'",
    "UPDATE bank_accounts SET synced_at='2026-09-09T10:00:00.000Z'",
    "UPDATE integration_sync_runs SET started_at='2026-09-09T11:30:00.000Z',finished_at='2026-09-09T11:30:00.000Z'",
    "UPDATE bank_statement_imports SET start_date='0000-PRIVATE'",
    "UPDATE bank_statement_imports SET end_date='9999-PRIVATE'",
    "UPDATE bank_statement_imports SET start_date='2026-02-30'",
    "UPDATE bank_statement_imports SET end_date='2026-09-31'",
    "UPDATE bank_statement_imports SET start_date='2026-01-01T00:00:00Z'",
    "UPDATE bank_statement_imports SET end_date='2026-09-09T00:00:00Z'",
    "UPDATE bank_statement_imports SET start_date=NULL",
    "UPDATE bank_statement_imports SET end_date=NULL",
  ]) {
    const db = bankFixture({ complete: true });
    db.exec("UPDATE bank_statement_imports SET start_date='2026-01-01'");
    db.exec(sql);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankWindow.coverage.accountsWithContainingStatementInLatestRun, 0);
      assert.equal(result.bankWindow.coverage.coveredInLatestRun, 0);
      assert.equal(result.bankWindow.checksComplete, false);
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    } finally { db.close(); }
  }
});

test('bank aggregate: containing coverage never falls back behind a newer partial statement', () => {
  const db = bankFixture({ complete: true });
  db.exec(`
    UPDATE bank_statement_imports SET start_date='2026-01-01';
    INSERT INTO bank_statement_imports VALUES('PRIVATE-NEWER','INT-T-TOCHKA','PRIVATE-ENTITY','PRIVATE-ACCOUNT-3',
      '2026-09-02','2026-09-09','Ready',0,'2026-09-09T11:30:00.000Z');
  `);
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankWindow.coverage.accountsWithContainingStatementInLatestRun, 3);
    assert.equal(result.bankWindow.coverage.coveredInLatestRun, 0);
    assert.equal(result.bankWindow.checksComplete, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally { db.close(); }
});

test('bank aggregate: freshness is explicit and stale or future successful timestamps cannot pass', () => {
  for (const runTime of ['2026-09-09T09:00:00.000Z', '2026-09-09T13:00:00.000Z']) {
    const db = bankFixture({ complete: true, runTime });
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankWindow.sync.freshness, 'stale_or_unobserved');
      assert.equal(result.bankWindow.checksComplete, false);
    } finally { db.close(); }
  }
  const db = bankFixture({ complete: true });
  try {
    const result = inspectDatabase(db, { now: bankNow });
    assert.equal(result.bankWindow.sync.freshness, 'not_requested');
    assert.equal(result.bankWindow.checksComplete, true);
  } finally { db.close(); }
});

test('bank aggregate: empty eligible link is caught; pending transactions are not required to have a financial link', () => {
  for (const pending of [false, true]) {
    const db = bankFixture({ complete: true });
    db.prepare("UPDATE bank_transactions SET financial_operation_id='',status=? WHERE id='PRIVATE-TX-0'")
      .run(pending ? 'Pending' : 'Booked');
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankWindow.transactions.eligibleMissingLinks, pending ? 0 : 1);
      assert.equal(result.bankWindow.transactions.pendingOrNonRub, pending ? 1 : 0);
      assert.equal(result.bankWindow.checksComplete, false);
      assert.equal(result.checks.bankLinks.violations, 0);
    } finally { db.close(); }
  }
});

test('bank aggregate: a later statement may retain original transaction statement references on reimport', () => {
  const db = bankFixture({ complete: true });
  db.exec("UPDATE bank_statement_imports SET id='REFETCHED-' || id");
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankWindow.coverage.accountsWithMatchingTransactionCount, 4);
    assert.equal(result.bankWindow.checksComplete, true);
  } finally { db.close(); }
});

test('bank aggregate: missing current account coverage, transaction mismatch and duplicate external identities fail', () => {
  for (const sql of [
    "DELETE FROM bank_statement_imports WHERE provider_account_id='PRIVATE-ACCOUNT-3'",
    "UPDATE bank_statement_imports SET end_date='2026-09-08' WHERE provider_account_id='PRIVATE-ACCOUNT-3'",
    "UPDATE bank_statement_imports SET transaction_count=3 WHERE provider_account_id='PRIVATE-ACCOUNT-0'",
    "UPDATE bank_transactions SET provider_transaction_id='PRIVATE-EXTERNAL-0'",
    "UPDATE integration_sync_runs SET rejected_count=1",
  ]) {
    const db = bankFixture({ complete: true });
    db.exec(sql);
    try { assert.equal(inspectDatabase(db, bankOptions).bankWindow.checksComplete, false); }
    finally { db.close(); }
  }
});

test('bank aggregate: missing columns or over-cap inputs fail closed with fixed output', () => {
  const missing = bankFixture();
  missing.exec('ALTER TABLE bank_accounts RENAME COLUMN synced_at TO private_column');
  try {
    const result = inspectDatabase(missing, bankOptions);
    assert.deepEqual(result.bankWindow, { state: 'unavailable', checksComplete: false });
    assert.equal(JSON.stringify(result).includes('private_column'), false);
  } finally { missing.close(); }
  const capped = bankFixture();
  capped.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10001) INSERT INTO bank_accounts(id) SELECT x FROM n");
  try {
    const result = inspectDatabase(capped, bankOptions);
    assert.deepEqual(result.bankWindow, { state: 'not_checked', checksComplete: false });
  } finally { capped.close(); }
});

test('bank aggregate: invalid or future freshness boundary is rejected without reflecting input', () => {
  for (const syncNotBefore of ['PRIVATE-INVALID', '2026-09-10T00:00:00.000Z']) {
    const db = bankFixture({ complete: true });
    try {
      const result = inspectDatabase(db, { now: bankNow, syncNotBefore });
      assert.deepEqual(result.bankWindow, { state: 'invalid_window', checksComplete: false });
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    } finally { db.close(); }
  }
});

test('bank aggregate: four ready zero-activity statements do not establish observed bank activity', () => {
  const db = bankFixture({ complete: true });
  db.exec('DELETE FROM bank_transactions; UPDATE bank_statement_imports SET transaction_count=0');
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankWindow.coverage.coveredInLatestRun, 4);
    assert.equal(result.bankWindow.activity, 'not_observed');
    assert.equal(result.bankWindow.checksComplete, false);
  } finally { db.close(); }
});

test('bank aggregate: a newer pending run or wrong-window statement cannot fall back to older successful evidence', () => {
  for (const sql of [
    "INSERT INTO integration_sync_runs VALUES('NEW-PENDING','INT-T-TOCHKA',0,'Ожидание банка',0,0,0,'2026-09-09T11:30:00.000Z','2026-09-09T11:30:00.000Z')",
    "INSERT INTO bank_statement_imports VALUES('NEW-WINDOW','INT-T-TOCHKA','PRIVATE-ENTITY','PRIVATE-ACCOUNT-3','2026-09-02','2026-09-09','Ready',0,'2026-09-09T11:30:00.000Z')",
  ]) {
    const db = bankFixture({ complete: true });
    db.exec(sql);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankWindow.checksComplete, false);
      assert.ok(result.bankWindow.coverage.coveredInLatestRun < 4);
    } finally { db.close(); }
  }
});

test('bank aggregate: null eligible links and all nonempty dangling links are caught, with pending and non-RUB separated', () => {
  for (const [status, currency, link, missing, dangling, excluded] of [
    ['Booked', 'RUB', null, 1, 0, 0],
    ['Booked', 'RUB', 'PRIVATE-MISSING', 1, 1, 0],
    ['Pending', 'RUB', '', 0, 0, 1],
    ['Booked', 'USD', '', 0, 0, 1],
    ['Pending', 'RUB', 'PRIVATE-MISSING', 0, 1, 1],
  ]) {
    const db = bankFixture({ complete: true });
    db.prepare("UPDATE bank_transactions SET status=?,currency=?,financial_operation_id=? WHERE id='PRIVATE-TX-0'")
      .run(status, currency, link);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankWindow.transactions.eligibleMissingLinks, missing);
      assert.equal(result.bankWindow.transactions.danglingLinks, dangling);
      assert.equal(result.bankWindow.transactions.pendingOrNonRub, excluded);
      assert.equal(result.bankWindow.checksComplete, false);
    } finally { db.close(); }
  }
});

test('bank aggregate: freshness boundary respects milliseconds and reversed or missing finish times', () => {
  for (const [started, finished] of [
    ['2026-09-09T11:00:00.100Z', '2026-09-09T11:00:00.600Z'],
    ['2026-09-09T11:00:00.600Z', '2026-09-09T11:00:00.100Z'],
    ['2026-09-09T11:00:00.600Z', null],
  ]) {
    const db = bankFixture({ complete: true, runTime: started });
    db.prepare('UPDATE integration_sync_runs SET finished_at=?').run(finished);
    try {
      const result = inspectDatabase(db, { now: bankNow, syncNotBefore: '2026-09-09T11:00:00.500Z' });
      assert.equal(result.bankWindow.sync.freshness, 'stale_or_unobserved');
      assert.equal(result.bankWindow.checksComplete, false);
    } finally { db.close(); }
  }
});

test('bank aggregate: UTC day is fixed once and previous-day statements do not cover the new day', () => {
  const db = bankFixture({ complete: true });
  try {
    const result = inspectDatabase(db, { now: Date.parse('2026-09-10T00:00:00.001Z') });
    assert.equal(result.bankWindow.period.endDate, '2026-09-10');
    assert.equal(result.bankWindow.coverage.coveredInLatestRun, 0);
    assert.equal(result.bankWindow.checksComplete, false);
  } finally { db.close(); }
});

test('bank aggregate: external identity uniqueness spans accounts within the connection', () => {
  const db = bankFixture({ complete: true });
  db.exec(`
    UPDATE bank_transactions SET provider_account_id='PRIVATE-ACCOUNT-1',provider_transaction_id='PRIVATE-EXTERNAL-0'
      WHERE id='PRIVATE-TX-1';
    UPDATE bank_statement_imports SET transaction_count=1 WHERE provider_account_id IN ('PRIVATE-ACCOUNT-0','PRIVATE-ACCOUNT-1');
  `);
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankWindow.coverage.accountsWithMatchingTransactionCount, 4);
    assert.equal(result.bankWindow.duplicates.groups, 1);
    assert.equal(result.bankWindow.duplicates.excessRows, 1);
    assert.equal(result.bankWindow.checksComplete, false);
  } finally { db.close(); }
});

test('bank aggregate: transactions outside the four current account keys cannot supply accepted activity', () => {
  const db = bankFixture({ complete: true });
  db.exec("UPDATE bank_transactions SET provider_account_id='PRIVATE-UNEXPECTED'; UPDATE bank_statement_imports SET transaction_count=0");
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankWindow.transactions.unexpectedAccountRows, 2);
    assert.equal(result.bankWindow.checksComplete, false);
    assert.equal(diagnosticExitCode(result), 2);
  } finally { db.close(); }
});
