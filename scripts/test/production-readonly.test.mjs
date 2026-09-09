import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { inspectDatabase, activeRelativePath, diagnosticExitCode } from '../production-readonly.mjs';

test('bank commit schema: missing write columns are identified without reading business rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE bank_transactions(id TEXT PRIMARY KEY, PRIVATE_REQUIRED TEXT NOT NULL);");
  try {
    const result = inspectDatabase(db, bankOptions);
    const schema = result.bankCommitSchema.tables.bank_transactions;
    assert.equal(schema.state, 'observed');
    assert.ok(schema.missingColumns.includes('payment_id'));
    assert.ok(schema.missingColumns.includes('source_payload_hash'));
    assert.equal(schema.unexpectedRequiredColumns, 1);
    assert.equal(schema.primaryKeyMatches, true);
    assert.equal(schema.providerIndex, 'missing');
    assert.equal(JSON.stringify(result).includes('PRIVATE_REQUIRED'), false);
    assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n, 0);
    assert.throws(() => db.exec("INSERT INTO bank_transactions VALUES('x','y')"));
  } finally { db.close(); }
});

test('bank commit schema: index scope, extra constraints and absent tables remain distinct', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE bank_accounts(id TEXT PRIMARY KEY,connection_id TEXT,legal_entity_id TEXT,
      provider_account_id TEXT, extra TEXT REFERENCES app_users(id));
    CREATE UNIQUE INDEX PRIVATE_WRONG_INDEX ON bank_accounts(connection_id,provider_account_id);
    CREATE TRIGGER PRIVATE_TRIGGER AFTER INSERT ON bank_accounts BEGIN SELECT 1; END;`);
  try {
    let result = inspectDatabase(db, bankOptions).bankCommitSchema;
    assert.equal(result.tables.bank_accounts.providerIndex, 'missing');
    assert.equal(result.tables.bank_accounts.foreignKeyRows, 1);
    assert.equal(result.tables.bank_accounts.triggerRows, 1);
    assert.equal(result.tables.bank_accounts.uniqueIndexCount, 2);
    assert.equal(result.tables.bank_statement_imports.state, 'schema_missing');
    assert.equal(result.state, 'partial');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally { db.close(); }
  const matching = new DatabaseSync(':memory:');
  matching.exec(`CREATE TABLE bank_transactions(id TEXT,connection_id TEXT,provider_transaction_id TEXT);
    CREATE UNIQUE INDEX PRIVATE_EQUIVALENT ON bank_transactions(connection_id,provider_transaction_id);`);
  try {
    const result = inspectDatabase(matching, bankOptions).bankCommitSchema.tables.bank_transactions;
    assert.equal(result.providerIndex, 'matched');
    assert.equal(result.primaryKeyMatches, false);
  } finally { matching.close(); }
});

test('bank commit schema: column cap and SQL errors return fixed states', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE bank_transactions(' + Array.from({length:129}, (_,i)=>'private_'+i+' TEXT').join(',') + ')');
  try {
    const result = inspectDatabase(db, bankOptions).bankCommitSchema.tables.bank_transactions;
    assert.deepEqual(result, { state: 'over_limit' });
  } finally { db.close(); }
});


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

const runtimeGeneration = '12345678-1234-4123-8123-123456789abc';
function runtimeFixture({ outcome = 'pending', nextAt = bankNow + 300_000, leasedUntil = 0 } = {}) {
  const db = bankFixture({ complete: true, status: 'Ожидание банка' });
  db.exec(`CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT NOT NULL,updated_at TEXT NOT NULL);
    ALTER TABLE integration_connections ADD COLUMN status TEXT;
    ALTER TABLE integration_connections ADD COLUMN is_enabled INTEGER;
    ALTER TABLE integration_connections ADD COLUMN next_sync_at TEXT;
    UPDATE integration_connections SET status='Формируются выписки',is_enabled=1,next_sync_at='2026-09-09T12:05:00.000Z';`);
  const save = (key, value, updatedAt = '2026-09-09 11:55:00') => db.prepare('INSERT INTO system_runtime_state VALUES(?,?,?)')
    .run(key, typeof value === 'string' ? value : JSON.stringify(value), updatedAt);
  save('integration_setup:INT-T-TOCHKA', { connectionId: 'INT-T-TOCHKA', authMethod: 'JWT',
    secretStatus: 'stored', legalEntityId: 'PRIVATE-ENTITY', customerCode: 'PRIVATE-CUSTOMER',
    credentialGeneration: runtimeGeneration, startDate: '2026-09-01', syncIntervalMinutes: 60, syncMinute: 5,
    forbiddenPayload: 'PRIVATE-SETUP-PAYLOAD' });
  save('tochka-autosync:v1:INT-T-TOCHKA', { version: 1, generation: runtimeGeneration,
    owner: 'PRIVATE-SCHEDULER-OWNER', leasedUntil, nextAt, failures: 0, outcome, httpStatus: 200 });
  save('tochka-statement-lease:v1:INT-T-TOCHKA', { version: 1, owner: 'PRIVATE-LEASE-OWNER', expiresAtMs: bankNow - 60_000 });
  save('integration_credential:PRIVATE-ENVELOPE', 'PRIVATE-CIPHERTEXT-NOT-METADATA');
  for (let i = 0; i < 4; i++) save('tochka-statement-pending:v1:PRIVATE-JOB-' + i, {
    version: 1, scopeHash: 'PRIVATE-SCOPE-HASH', accountId: 'PRIVATE-ACCOUNT-' + i,
    startDate: '2026-09-01', endDate: i < 2 ? '2026-09-08' : '2026-09-09', statementId: 'PRIVATE-STATEMENT-' + i,
  });
  return { db, save };
}

test('bank runtime: metadata distinguishes future pending retry, expired lease and retained old windows without secrets', () => {
  const { db } = runtimeFixture();
  const before = db.prepare('SELECT count(*) AS n FROM system_runtime_state').get().n;
  try {
    const result = inspectDatabase(db, bankOptions);
    const runtime = result.bankRuntime;
    assert.equal(runtime.state, 'observed');
    assert.deepEqual(runtime.setup, { state: 'observed', startDate: '2026-09-01', syncIntervalMinutes: 60, syncMinute: 5 });
    assert.deepEqual(runtime.autosync, { state: 'observed', outcome: 'pending', generationMatchesSetup: true,
      nextAtUtc: '2026-09-09T12:05:00.000Z', leasedUntilUtc: null, leaseState: 'released', failures: 0, updatedAgeSeconds: 300,
      httpStatus: 200, httpStatusState: 'observed', updatedAtUtc: '2026-09-09T11:55:00.000Z',
      failureStage: null, failureStageState: 'missing' });
    assert.deepEqual(runtime.statementLease, { state: 'observed', expiresAtUtc: '2026-09-09T11:59:00.000Z', leaseState: 'expired' });
    assert.deepEqual(runtime.retainedJobs, { state: 'observed', scopeMatch: 'unverified', providerStatus: 'not_stored',
      total: 4, invalidRows: 0, exactWindowRows: 2, olderEndRows: 2, otherWindowRows: 0, oldestAgeSeconds: 300 });
    assert.deepEqual(runtime.latestRun, { state: 'observed', startedAtUtc: bankSyncTime, finishedAtUtc: bankSyncTime });
    assert.equal(result.bankWindow.sync.state, 'pending');
    assert.equal(result.bankWindow.checksComplete, false);
    assert.equal(diagnosticExitCode(result), 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM system_runtime_state').get().n, before);
    const output = JSON.stringify(result);
    for (const forbidden of ['PRIVATE', runtimeGeneration, 'scopeHash', 'statementId', 'customerCode', 'credentialGeneration']) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
    assert.throws(() => db.exec('DELETE FROM system_runtime_state'));
  } finally { db.close(); }
});

test('bank runtime: current PENDING and historical READY import rows are fixed counts, not retained provider status', () => {
  const { db } = runtimeFixture();
  db.exec(`UPDATE bank_statement_imports SET status=CASE id
    WHEN 'PRIVATE-STMT-0' THEN 'PENDING' WHEN 'PRIVATE-STMT-1' THEN 'READY'
    WHEN 'PRIVATE-STMT-2' THEN 'Failed' ELSE 'PRIVATE-UNKNOWN-STATUS' END`);
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.deepEqual(result.bankRuntime.statementImports, { state: 'observed', readyRows: 1, pendingRows: 1, failedRows: 1, unknownRows: 1 });
    assert.equal(result.bankRuntime.retainedJobs.providerStatus, 'not_stored');
    assert.equal(result.bankWindow.checksComplete, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally { db.close(); }
});

test('bank runtime: active, expired and released scheduler leases preserve schedule dates', () => {
  for (const [leasedUntil, expected] of [[bankNow + 900_000, 'active'], [bankNow - 1, 'expired'], [0, 'released']]) {
    const { db } = runtimeFixture({ outcome: 'running', nextAt: bankNow - 60_000, leasedUntil });
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankRuntime.autosync.leaseState, expected);
      assert.equal(result.bankRuntime.autosync.nextAtUtc, '2026-09-09T11:59:00.000Z');
      assert.equal(result.bankWindow.checksComplete, false);
      assert.equal(diagnosticExitCode(result), 2);
    } finally { db.close(); }
  }
});

test('bank runtime: missing metadata and schema are explicit and do not change bank acceptance', () => {
  const db = bankFixture({ complete: true });
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankRuntime.setup.state, 'schema_missing');
    assert.equal(result.bankRuntime.autosync.state, 'schema_missing');
    assert.equal(result.bankRuntime.autosync.httpStatus, null);
    assert.equal(result.bankRuntime.autosync.httpStatusState, 'missing');
    assert.equal(result.bankRuntime.autosync.updatedAtUtc, null);
    assert.equal(result.bankRuntime.connection.state, 'unavailable');
    assert.equal(result.bankRuntime.state, 'partial');
    assert.equal(result.bankWindow.checksComplete, true);
    assert.equal(diagnosticExitCode(result), 0);
  } finally { db.close(); }
  const { db: empty } = runtimeFixture();
  empty.exec('DELETE FROM system_runtime_state; DELETE FROM integration_sync_runs; DELETE FROM integration_connections;');
  try {
    const result = inspectDatabase(empty, bankOptions);
    for (const component of ['setup', 'autosync', 'statementLease', 'connection', 'latestRun']) assert.equal(result.bankRuntime[component].state, 'not_observed');
    assert.equal(result.bankRuntime.autosync.generationMatchesSetup, null);
    assert.equal(result.bankRuntime.autosync.httpStatusState, 'missing');
    assert.equal(result.bankRuntime.retainedJobs.total, 0);
    assert.equal(result.bankRuntime.retainedJobs.oldestAgeSeconds, null);
    assert.equal(result.bankWindow.checksComplete, false);
  } finally { empty.close(); }
});

test('bank runtime: malformed JSON and invalid schedule fields fail without reflecting arbitrary values', () => {
  for (const stateValue of ['PRIVATE-NOT-JSON', '[]', 'null', JSON.stringify({
    version: 1, generation: 'PRIVATE-GENERATION', outcome: 'PRIVATE-OUTCOME',
    nextAt: 'PRIVATE-DATE', leasedUntil: -1, failures: 500,
  })]) {
    const { db } = runtimeFixture();
    db.prepare("UPDATE system_runtime_state SET state_value=? WHERE state_key='tochka-autosync:v1:INT-T-TOCHKA'").run(stateValue);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankRuntime.autosync.state, 'invalid');
      assert.equal(result.bankRuntime.autosync.outcome, 'unknown');
      assert.equal(result.bankRuntime.autosync.generationMatchesSetup, null);
      assert.equal(result.bankRuntime.autosync.nextAtUtc, null);
      assert.equal(result.bankRuntime.autosync.leaseState, 'unknown');
      assert.equal(result.bankRuntime.autosync.failures, null);
      assert.equal(result.bankRuntime.autosync.httpStatus, null);
      assert.equal(result.bankRuntime.autosync.httpStatusState, stateValue.startsWith('{') ? 'missing' : 'invalid');
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    } finally { db.close(); }
  }
});

test('bank runtime: stored callback status distinguishes missing and invalid without changing existing evidence', () => {
  const withoutNewFields = value => {
    const copy = structuredClone(value);
    for (const key of ['httpStatus', 'httpStatusState', 'updatedAtUtc']) delete copy.bankRuntime.autosync[key];
    return copy;
  };
  const { db: baselineDb } = runtimeFixture();
  const baseline = inspectDatabase(baselineDb, bankOptions);
  baselineDb.close();
  const cases = [
    ...[100, 200, 409, 422, 500, 599].map(value => [String(value), 'observed', value]),
    [undefined, 'missing', null], ['null', 'missing', null],
    ...['"500"', '"PRIVATE-HTTP-STATUS"', '500.0', '500.5', 'true', 'false', '[]', '{}', '99', '600', '-1']
      .map(value => [value, 'invalid', null]),
  ];
  for (const [raw, state, expected] of cases) {
    const { db } = runtimeFixture();
    const key = 'tochka-autosync:v1:INT-T-TOCHKA';
    const saved = JSON.parse(db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').get(key).state_value);
    delete saved.httpStatus;
    const source = JSON.stringify(saved);
    const next = raw === undefined ? source : source.slice(0, -1) + ',"httpStatus":' + raw + '}';
    db.prepare('UPDATE system_runtime_state SET state_value=? WHERE state_key=?').run(next, key);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankRuntime.autosync.httpStatus, expected, String(raw));
      assert.equal(result.bankRuntime.autosync.httpStatusState, state, String(raw));
      assert.deepEqual(withoutNewFields(result), withoutNewFields(baseline), String(raw));
      assert.equal(diagnosticExitCode(result), diagnosticExitCode(baseline));
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    } finally { db.close(); }
  }
});

test('bank runtime: lexical failure stages are bounded and cannot change bank acceptance or disclose raw errors', () => {
  const stages = ['setup_references', 'credential_read', 'statement_state_open', 'bank_sync',
    'statement_fence', 'sync_commit', 'statement_acknowledge', 'statement_release',
    'sync_callback', 'response_decode', 'response_result'];
  const cases = [
    ...stages.map(stage => [JSON.stringify(stage), 'error', stage, 'observed']),
    [undefined, 'error', null, 'missing'], ['null', 'error', null, 'missing'],
    ...['"PRIVATE-FAILURE-SECRET"', '"bank_sync\\nPRIVATE-ERROR"', '500', 'true', '[]', '{}']
      .map(raw => [raw, 'error', null, 'invalid']),
    ...['pending', 'complete', 'busy', 'running'].map(outcome => ['"bank_sync"', outcome, null, 'invalid']),
  ];
  for (const [raw, outcome, expected, quality] of cases) {
    const { db } = runtimeFixture({ outcome });
    const key = 'tochka-autosync:v1:INT-T-TOCHKA';
    const source = db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').get(key).state_value;
    const before = raw === undefined ? source : source.slice(0, -1) + ',"failureStage":' + raw + '}';
    db.prepare('UPDATE system_runtime_state SET state_value=? WHERE state_key=?').run(before, key);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankRuntime.autosync.failureStage, expected, String(raw));
      assert.equal(result.bankRuntime.autosync.failureStageState, quality, String(raw));
      assert.equal(result.bankWindow.checksComplete, false);
      assert.equal(diagnosticExitCode(result), 2);
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
      assert.equal(db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').get(key).state_value, before);
      assert.throws(() => db.exec('DELETE FROM system_runtime_state'));
    } finally { db.close(); }
  }
});

test('bank runtime: scheduler update time is normalized or null without raw timestamp reflection', () => {
  for (const [source, expected] of [
    ['2026-09-09 11:55:00', '2026-09-09T11:55:00.000Z'],
    ['2026-09-09T11:55:00.123Z', '2026-09-09T11:55:00.123Z'],
    ['2026-09-09T12:00:01.000Z', '2026-09-09T12:00:01.000Z'],
    ['PRIVATE-TIMESTAMP', null], ['2026-02-30T00:00:00.000Z', null], ['0000-01-01T00:00:00.000Z', null],
  ]) {
    const { db } = runtimeFixture();
    db.prepare("UPDATE system_runtime_state SET updated_at=? WHERE state_key='tochka-autosync:v1:INT-T-TOCHKA'").run(source);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankRuntime.autosync.updatedAtUtc, expected);
      if (expected === null || expected > result.bankRuntime.observedAtUtc) {
        assert.equal(result.bankRuntime.autosync.updatedAgeSeconds, null);
        assert.equal(result.bankRuntime.autosync.state, 'invalid');
      }
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
      assert.equal(diagnosticExitCode(result), 2);
    } finally { db.close(); }
  }
});

test('bank runtime: invalid calendar dates, wrong windows and old credential generation remain distinct', () => {
  const { db, save } = runtimeFixture();
  db.prepare("UPDATE system_runtime_state SET state_value=json_set(state_value,'$.generation',?) WHERE state_key='tochka-autosync:v1:INT-T-TOCHKA'")
    .run('22345678-1234-4123-8123-123456789abc');
  save('tochka-statement-pending:v1:PRIVATE-OTHER', { version: 1, startDate: '2026-08-01', endDate: '2026-09-09' });
  save('tochka-statement-pending:v1:PRIVATE-INVALID', { version: 1, startDate: '2026-02-30', endDate: '2026-09-09' });
  db.exec("UPDATE integration_connections SET next_sync_at='2026-09-31T12:00:00.000Z'");
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankRuntime.autosync.generationMatchesSetup, false);
    assert.equal(result.bankRuntime.retainedJobs.state, 'invalid');
    assert.equal(result.bankRuntime.retainedJobs.total, 6);
    assert.equal(result.bankRuntime.retainedJobs.invalidRows, 1);
    assert.equal(result.bankRuntime.retainedJobs.otherWindowRows, 1);
    assert.equal(result.bankRuntime.connection.nextSyncAtUtc, null);
    assert.equal(result.bankRuntime.connection.state, 'invalid');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally { db.close(); }
});

test('bank runtime: observation clock and retained job cap cannot silently produce complete observations', () => {
  const { db } = runtimeFixture();
  try {
    const invalid = inspectDatabase(db, { now: NaN });
    assert.equal(invalid.bankRuntime.state, 'invalid_window');
    assert.equal(invalid.bankRuntime.observedAtUtc, null);
    assert.equal(invalid.bankWindow.checksComplete, false);
  } finally { db.close(); }
  const { db: capped } = runtimeFixture();
  capped.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10001)
    INSERT INTO system_runtime_state SELECT 'tochka-statement-pending:v1:extra-' || x,'{}','2026-09-09 11:55:00' FROM n`);
  try {
    const result = inspectDatabase(capped, bankOptions);
    assert.equal(result.bankRuntime.retainedJobs.state, 'over_limit');
    assert.equal(result.bankRuntime.retainedJobs.total, null);
    assert.equal(result.bankWindow.checksComplete, false);
  } finally { capped.close(); }
});

test('bank runtime: year zero and arbitrary generation strings are never emitted as validated metadata', () => {
  const { db } = runtimeFixture();
  db.exec(`UPDATE integration_connections SET next_sync_at='0000-01-01T00:00:00.000Z';
    UPDATE integration_sync_runs SET started_at='0000-01-01T00:00:00.000Z',finished_at='0000-01-01T00:00:00.000Z';
    UPDATE system_runtime_state SET state_value=json_set(state_value,'$.startDate','0000-01-01','$.credentialGeneration','PRIVATE-INVALID-GENERATION-00000000000')
    WHERE state_key='integration_setup:INT-T-TOCHKA';
    UPDATE system_runtime_state SET state_value=json_set(state_value,'$.generation','PRIVATE-INVALID-GENERATION-00000000000')
    WHERE state_key='tochka-autosync:v1:INT-T-TOCHKA';`);
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankRuntime.setup.startDate, null);
    assert.equal(result.bankRuntime.connection.nextSyncAtUtc, null);
    assert.equal(result.bankRuntime.latestRun.startedAtUtc, null);
    assert.equal(result.bankRuntime.latestRun.finishedAtUtc, null);
    assert.equal(result.bankRuntime.autosync.generationMatchesSetup, null);
    assert.equal(JSON.stringify(result).includes('0000-01'), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally { db.close(); }
});

test('bank runtime: malformed or future retained timestamps leave oldest age unverified', () => {
  for (const timestamp of ['PRIVATE-INVALID-TIMESTAMP', '2026-09-09T12:00:01.000Z']) {
    const { db } = runtimeFixture();
    db.prepare("UPDATE system_runtime_state SET updated_at=? WHERE state_key='tochka-statement-pending:v1:PRIVATE-JOB-0'").run(timestamp);
    try {
      const result = inspectDatabase(db, bankOptions);
      assert.equal(result.bankRuntime.retainedJobs.state, 'invalid');
      assert.equal(result.bankRuntime.retainedJobs.total, 4);
      assert.equal(result.bankRuntime.retainedJobs.oldestAgeSeconds, null);
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    } finally { db.close(); }
  }
});

test('bank runtime: generation equality rejects an extra dash in an otherwise UUID-shaped value', () => {
  const { db } = runtimeFixture();
  const invalid = '-2345678-1234-4123-8123-123456789abc';
  db.prepare("UPDATE system_runtime_state SET state_value=json_set(state_value,'$.generation',?,'$.credentialGeneration',?) WHERE state_key IN ('integration_setup:INT-T-TOCHKA','tochka-autosync:v1:INT-T-TOCHKA')")
    .run(invalid, invalid);
  try {
    const result = inspectDatabase(db, bankOptions);
    assert.equal(result.bankRuntime.autosync.generationMatchesSetup, null);
    assert.equal(JSON.stringify(result).includes(invalid), false);
  } finally { db.close(); }
});

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
