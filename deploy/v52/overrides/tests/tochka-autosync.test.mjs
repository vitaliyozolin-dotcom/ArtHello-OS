import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { isTochkaAutosyncRequest, canAutomaticallySyncTochka, nextTochkaAutomaticSlot, runScheduledTochkaSync, runTochkaSyncStage } from '../lib/tochka-autosync.ts';
import { acquireTochkaStatementState, TochkaStatementStateChanged } from '../lib/tochka-statement-state.ts';
import { startTochkaAutosyncTimer } from '../production/tochka-autosync-timer.mjs';

const generation = '11111111-1111-4111-8111-111111111111';
const secondGeneration = '22222222-2222-4222-8222-222222222222';
const fixedNow = Date.parse('2026-09-08T10:02:00Z');
const secret = 'a'.repeat(64);
const complete = () => Response.json({ test: { ok: true, complete: true } });
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_connections(id TEXT PRIMARY KEY,status TEXT,is_enabled INTEGER,next_sync_at TEXT,updated_at TEXT);
    INSERT INTO integration_connections VALUES('INT-T-TOCHKA','Работает',1,'','');`);
  const setup = { connectionId: 'INT-T-TOCHKA', authMethod: 'JWT', secretStatus: 'stored', legalEntityId: 'ORG-1',
    customerCode: '300000092', credentialGeneration: generation, startDate: '2026-09-01', syncIntervalMinutes: 60, syncMinute: 5 };
  sqlite.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)')
    .run('integration_setup:INT-T-TOCHKA', JSON.stringify(setup));
  const connection = { status: 'Работает', isEnabled: true, nextSyncAt: '' };
  let clock = fixedNow;
  const db = { prepare(sql) { let bindings = []; return {
    bind(...values) { bindings = values; return this; },
    async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
    async run() { const result = sqlite.prepare(sql).run(...bindings); return { meta: { changes: Number(result.changes) } }; },
  }; } };
  const input = { db, setup, connection, now: () => clock };
  const state = () => {
    const row = sqlite.prepare("SELECT state_value FROM system_runtime_state WHERE state_key='tochka-autosync:v1:INT-T-TOCHKA'").get();
    return row ? JSON.parse(row.state_value) : null;
  };
  const pause = () => sqlite.exec("UPDATE integration_connections SET status='На паузе',is_enabled=0");
  const rotate = () => { setup.credentialGeneration = secondGeneration;
    sqlite.prepare("UPDATE system_runtime_state SET state_value=? WHERE state_key='integration_setup:INT-T-TOCHKA'").run(JSON.stringify(setup)); };
  return { sqlite, db, setup, connection, input, state, pause, rotate, advance: ms => { clock += ms; } };
}

test('service authentication admits only exact POST target with current random runtime key', async () => {
  const request = (path = '/api/integration-actions', method = 'POST', key = secret) => new Request('https://example.test' + path,
    { method, headers: { 'x-arthello-tochka-autosync': key } });
  assert.equal(await isTochkaAutosyncRequest(request(), secret), true);
  for (const value of [undefined, '', 'x'.repeat(64), 'b'.repeat(64)]) assert.equal(await isTochkaAutosyncRequest(request(), value), false);
  assert.equal(await isTochkaAutosyncRequest(request('/api/settings'), secret), false);
  assert.equal(await isTochkaAutosyncRequest(request('/api/integration-actions/'), secret), false);
  assert.equal(await isTochkaAutosyncRequest(request('/api/integration-actions', 'GET'), secret), false);
  assert.equal(await isTochkaAutosyncRequest(request('/api/integration-actions', 'POST', 'a'.repeat(63)), secret), false);
  assert.equal(await isTochkaAutosyncRequest(new Request('https://example.test/api/integration-actions', { method: 'POST' }), secret), false);
});

test('only a saved scoped company and valid selected date/interval can run; pause is authoritative', () => {
  const f = fixture();
  assert.equal(canAutomaticallySyncTochka(f.setup, f.connection, fixedNow), true);
  for (const change of [{ connectionId: 'INT-T-TBANK' }, { authMethod: 'OAuth' }, { secretStatus: 'missing' },
    { customerCode: '' }, { legalEntityId: '' }, { credentialGeneration: '' }, { startDate: '2026-02-30' },
    { startDate: '2027-01-01' }, { syncIntervalMinutes: 1 }, { syncMinute: 60 }, { syncMinute: 1.5 }]) {
    assert.equal(canAutomaticallySyncTochka({ ...f.setup, ...change }, f.connection, fixedNow), false);
  }
  assert.equal(canAutomaticallySyncTochka(f.setup, { ...f.connection, isEnabled: false }, fixedNow), false);
  assert.equal(canAutomaticallySyncTochka(f.setup, { ...f.connection, status: 'На паузе' }, fixedNow), false);
  assert.equal(canAutomaticallySyncTochka(f.setup, { ...f.connection, status: 'Ошибка подключения', isEnabled: false }, fixedNow), true);
  f.sqlite.close();
});

test('saved minute aligns hourly, three-hourly and daily automatic schedules', () => {
  assert.equal(new Date(nextTochkaAutomaticSlot(fixedNow, 60, 5)).toISOString(), '2026-09-08T10:05:00.000Z');
  assert.equal(new Date(nextTochkaAutomaticSlot(fixedNow, 180, 0)).toISOString(), '2026-09-08T12:00:00.000Z');
  assert.equal(new Date(nextTochkaAutomaticSlot(fixedNow, 1440, 5)).toISOString(), '2026-09-09T00:05:00.000Z');
});

test('parallel workers and restarts run a due generation once and preserve next automatic slot', async () => {
  const f = fixture(); let count = 0;
  const results = await Promise.all(Array.from({ length: 3 }, () => runScheduledTochkaSync({ ...f.input, run: async () => { count++; return complete(); } })));
  assert.equal(count, 1); assert.equal(results.filter(result => result.ran).length, 1);
  assert.equal(f.state().outcome, 'complete');
  assert.equal(f.state().nextAt, Date.parse('2026-09-08T10:05:00Z'));
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => { count++; return complete(); } })).ran, false);
  assert.equal(count, 1); f.advance(180_000);
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => { count++; return complete(); } })).ran, true);
  assert.equal(count, 2); f.sqlite.close();
});

test('unfinished bank statements get bounded retry without claiming a complete sync', async () => {
  const f = fixture();
  const first = await runScheduledTochkaSync({ ...f.input, run: async () => Response.json({ test: { ok: true, complete: false } }) });
  assert.equal(first.outcome, 'pending'); assert.equal(f.state().nextAt, fixedNow + 300_000);
  f.advance(299_999); assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => assert.fail('too soon') })).ran, false);
  f.advance(1); assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => complete() })).outcome, 'complete');
  f.sqlite.close();
});

test('bank failures retain retry schedule after restart and use exponential capped backoff', async () => {
  const f = fixture();
  const failed = () => runScheduledTochkaSync({ ...f.input, run: async () => Response.json({ error: 'synthetic provider error' }, { status: 422 }) });
  assert.equal((await failed()).outcome, 'error'); assert.equal(f.state().failures, 1); assert.equal(f.state().nextAt, fixedNow + 900_000);
  f.sqlite.exec("UPDATE integration_connections SET is_enabled=0,status='Ошибка подключения'");
  f.connection.isEnabled = false; f.connection.status = 'Ошибка подключения';
  f.advance(900_000); assert.equal((await failed()).outcome, 'error');
  assert.equal(f.state().failures, 2); assert.equal(f.state().nextAt, fixedNow + 900_000 + 1_800_000);
  assert.doesNotMatch(JSON.stringify(f.state()), /synthetic provider error/);
  f.sqlite.close();
});

test('busy manual import gets delayed retry and transport exceptions never count as success', async () => {
  const f = fixture();
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => new Response(null, { status: 409 }) })).outcome, 'busy');
  assert.equal(f.state().nextAt, fixedNow + 60_000); f.advance(60_000);
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => { throw new Error('synthetic-private-token'); } })).outcome, 'error');
  assert.equal(f.sqlite.prepare('SELECT status FROM integration_connections').get().status, 'Ошибка подключения');
  assert.doesNotMatch(JSON.stringify(f.state()), /synthetic-private-token/); f.sqlite.close();
});

test('malformed success response cannot set complete or bypass error backoff', async () => {
  const f = fixture();
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => Response.json({ ok: true }) })).outcome, 'error');
  assert.equal(f.state().failures, 1); f.sqlite.close();
});

test('rejected bank rows are errors with backoff even when HTTP status is successful', async () => {
  const f = fixture();
  assert.equal((await runScheduledTochkaSync({ ...f.input,
    run: async () => Response.json({ test: { ok: true, complete: false, rejectedCount: 1 } }) })).outcome, 'error');
  assert.equal(f.state().failures, 1); assert.equal(f.state().nextAt, fixedNow + 900_000); f.sqlite.close();
});

test('first server tick resumes a manually pending statement despite the legacy one-hour nextSyncAt', async () => {
  const f = fixture(); f.connection.status = 'Формируются выписки';
  f.connection.nextSyncAt = new Date(fixedNow + 3_600_000).toISOString();
  assert.equal((await runScheduledTochkaSync({ ...f.input,
    run: async () => Response.json({ test: { ok: true, complete: false } }) })).outcome, 'pending');
  f.sqlite.close();
});

test('paused SQL state fences stale snapshots before provider access and during completion', async () => {
  const f = fixture(); f.pause();
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => assert.fail('paused') })).ran, false);
  f.sqlite.exec("UPDATE integration_connections SET status='Работает',is_enabled=1");
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => { f.pause(); return complete(); } })).outcome, 'superseded');
  assert.notEqual(f.state().outcome, 'complete'); f.sqlite.close();
});

test('credential rotation fences old completion and admits a fresh generation without old error delay', async () => {
  const f = fixture();
  assert.equal((await runScheduledTochkaSync({ ...f.input, setup: { ...f.setup }, run: async () => { f.rotate(); return complete(); } })).outcome, 'superseded');
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => complete() })).outcome, 'complete');
  assert.equal(f.state().generation, secondGeneration); assert.equal(f.state().failures, 0); f.sqlite.close();
});

test('stale active lease is not stolen and an expired one is recoverable', async () => {
  const f = fixture();
  f.sqlite.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)').run('tochka-autosync:v1:INT-T-TOCHKA',
    JSON.stringify({ version: 1, generation, owner: 'old', leasedUntil: fixedNow + 5000, nextAt: fixedNow, failures: 0, outcome: 'running' }));
  assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => assert.fail('lease active') })).ran, false);
  f.advance(5000); assert.equal((await runScheduledTochkaSync({ ...f.input, run: async () => complete() })).outcome, 'complete'); f.sqlite.close();
});

test('automatic statement lease stops reads and writes immediately on explicit pause or revoked credential', async () => {
  const f = fixture(); const scope = { ...f.setup, requireAutomatic: true, credentialStateKey: 'synthetic-credential', setupStateKey: 'integration_setup:INT-T-TOCHKA' };
  f.sqlite.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)').run(scope.credentialStateKey, '{}');
  const state = await acquireTochkaStatementState(f.db, scope); assert.ok(state); assert.equal(state.fence.requireAutomatic, true);
  await state.assertCurrent(); f.pause(); await assert.rejects(state.assertCurrent(), TochkaStatementStateChanged);
  await state.release(); assert.equal(await acquireTochkaStatementState(f.db, scope), null);
  f.sqlite.exec("UPDATE integration_connections SET status='Ошибка подключения',is_enabled=0");
  const retry = await acquireTochkaStatementState(f.db, scope); assert.ok(retry);
  f.sqlite.prepare('DELETE FROM system_runtime_state WHERE state_key=?').run(scope.credentialStateKey);
  await assert.rejects(retry.assertCurrent(), TochkaStatementStateChanged); await retry.release(); f.sqlite.close();
});

test('production timer is opt-in, serial, stoppable, and logs no returned payload or credentials', async () => {
  const timers = []; const logs = []; const calls = []; let cleared = false;
  const setTimer = (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; };
  const input = { runtime: { async dispatchFetch(url, request) { calls.push({ url, request }); return Response.json({ outcome: 'pending', ran: true, sensitive: 'never-log' }); } },
    secret, publicOrigin: 'https://example.test', isActivated: async () => true, setTimer, clearTimer: () => { cleared = true; }, log: value => logs.push(value) };
  startTochkaAutosyncTimer({ ...input, enabled: false }); assert.equal(timers.length, 0);
  const timer = startTochkaAutosyncTimer({ ...input, enabled: true }); assert.equal(timers[0].ms, 30_000);
  await timers[0].fn(); assert.equal(calls.length, 1); assert.equal(timers[1].ms, 60_000);
  assert.equal(calls[0].url, 'https://example.test/api/integration-actions');
  assert.equal(calls[0].request.headers['x-arthello-tochka-autosync'], secret);
  assert.deepEqual(logs, ['TOCHKA_AUTOSYNC_TICK=PENDING']);
  timer.stop(); assert.equal(cleared, true); await timers[1].fn(); assert.equal(calls.length, 1);
});

async function loadRoute(stubs) {
  const source = await readFile(new URL('../app/api/integration-actions/route.ts', import.meta.url), 'utf8');
  const marker = 'import { resolveTaskAssignment } from "../../../lib/task-access";';
  const body = source.slice(source.indexOf(marker) + marker.length);
  globalThis.__TOCHKA_AUTOSYNC_ROUTE_TEST__ = stubs;
  const preamble = `const { env, isTochkaAutosyncRequest, runScheduledTochkaSync, runTochkaSyncStage, ensureCoreTables,
    getIntegrationSetups, getDb, validateIntegrationSetupReferences, readIntegrationCredential,
    openTochkaStatementState, syncTochkaReadOnly, commitTochkaReadOnlySync, TochkaStatementStateChanged,
    hasTrustedMutationOrigin, getAuthenticatedRequestContext } = globalThis.__TOCHKA_AUTOSYNC_ROUTE_TEST__;
    const eq=()=>({}), integrationConnections={id:{}};`;
  const compiled = stripTypeScriptTypes(preamble + '\n' + body, { mode: 'transform' });
  return import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64') + '#' + crypto.randomUUID());
}

test('real integration route service capability ignores supplied actions and never impersonates an owner', async () => {
  const f = fixture(); let commits = 0; let references = 0;
  f.setup.startDate = '2026-01-01'; f.connection.nextSyncAt = '';
  f.sqlite.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)').run('synthetic-credential', '{}');
  const chain = { select() { return this; }, from() { return this; }, where() { return this; }, async limit() { return [f.connection]; } };
  const route = await loadRoute({
    env: { DB: f.db, TOCHKA_AUTOSYNC_SECRET: secret }, isTochkaAutosyncRequest, runScheduledTochkaSync, runTochkaSyncStage,
    ensureCoreTables: async () => {}, getIntegrationSetups: async () => ({ 'INT-T-TOCHKA': f.setup }), getDb: () => chain,
    validateIntegrationSetupReferences: async () => { references++; }, readIntegrationCredential: async () => 'synthetic-private-key',
    openTochkaStatementState: (setup, automatic) => acquireTochkaStatementState(f.db, { ...setup, requireAutomatic: automatic,
      credentialStateKey: 'synthetic-credential', setupStateKey: 'integration_setup:INT-T-TOCHKA' }),
    syncTochkaReadOnly: async () => ({ valid: true, complete: true, accounts: [], statements: [], transactions: [], rejectedCount: 0, expiresAt: '', reason: 'synthetic complete' }),
    commitTochkaReadOnlySync: async (actor, setup, sync, trigger, fence) => {
      assert.equal(actor, 'SYSTEM:TOCHKA_READONLY_SCHEDULER'); assert.equal(fence.requireAutomatic, true);
      commits++; return { committed: true, financialOperationCount: 0 };
    }, TochkaStatementStateChanged,
    hasTrustedMutationOrigin: () => true,
    getAuthenticatedRequestContext: async () => assert.fail('service must not use or impersonate a user session'),
  });
  const response = await route.POST(new Request('https://example.test/api/integration-actions', { method: 'POST',
    headers: { 'x-arthello-tochka-autosync': secret, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'revokeCredential', connectionId: 'INT-T-TBANK' }) }));
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.outcome, 'complete');
  assert.equal(commits, 1); assert.equal(references, 1);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-key|ORG-1|300000092/); f.sqlite.close();
});

test('real integration route rejects forged service key through normal session authentication', async () => {
  const route = await loadRoute({ env: { TOCHKA_AUTOSYNC_SECRET: secret }, isTochkaAutosyncRequest,
    hasTrustedMutationOrigin: () => true, getAuthenticatedRequestContext: async () => null,
    ensureCoreTables: async () => assert.fail('forged key must never reach DB') });
  const response = await route.POST(new Request('https://example.test/api/integration-actions', { method: 'POST',
    headers: { 'x-arthello-tochka-autosync': 'b'.repeat(64) } }));
  assert.equal(response.status, 401);
});

test('stage observation rethrows the identical error and retains successful values', async () => {
  const original = new Error('synthetic-private-exception'); const observed = [];
  await assert.rejects(runTochkaSyncStage('credential_read', async () => { throw original; }, stage => observed.push(stage)),
    error => error === original);
  assert.deepEqual(observed, ['credential_read']);
  const result = {};
  assert.equal(await runTochkaSyncStage('credential_read', async () => result, stage => observed.push(stage)), result);
  assert.deepEqual(observed, ['credential_read']);
});

test('scheduler distinguishes callback, response decoding and result failures using fixed names only', async () => {
  const cases = [
    ['sync_callback', async () => { throw Object.assign(new Error('synthetic-private-exception'), { stage: 'credential_read', status: 418 }); }],
    ['response_decode', async () => new Response('synthetic-private-invalid-json')],
    ['response_result', async () => Response.json({ error: 'synthetic-private-provider-payload' }, { status: 422 })],
    ['response_result', async () => Response.json({ test: { ok: true, rejectedCount: 1 } })],
    ['sync_callback', async observe => { observe('synthetic-private-injected-stage'); throw new Error('private'); }],
  ];
  for (const [stage, run] of cases) {
    const f = fixture();
    try {
      const result = await runScheduledTochkaSync({ ...f.input, run });
      assert.equal(result.outcome, 'error'); assert.equal(result.failureStage, stage);
      assert.equal(f.state().failureStage, stage); assert.equal(f.state().failures, 1);
      assert.equal(f.state().nextAt, fixedNow + 900_000); assert.equal(f.state().leasedUntil, 0);
      assert.doesNotMatch(JSON.stringify([result, f.state()]), /synthetic-private|provider-payload|418/);
    } finally { f.sqlite.close(); }
  }
});

async function observedRouteFixture({ fail = '', releaseFails = false, busy = false, pending = false } = {}) {
  const f = fixture(); const calls = [];
  const step = async (stage, value) => {
    calls.push(stage);
    if (stage === fail || (releaseFails && stage === 'statement_release')) throw new Error('synthetic-private-' + stage);
    if (busy && stage === 'statement_fence') throw new TochkaStatementStateChanged();
    return value;
  };
  const chain = { select() { return this; }, from() { return this; }, where() { return this; }, async limit() { return [f.connection]; } };
  const state = { store: {}, fence: { key: 'synthetic-fence', owner: 'synthetic-owner', requireAutomatic: true },
    assertCurrent: () => step('statement_fence'), release: () => step('statement_release'),
    complete: () => step('statement_acknowledge') };
  const route = await loadRoute({
    env: { DB: f.db, TOCHKA_AUTOSYNC_SECRET: secret }, isTochkaAutosyncRequest, runTochkaSyncStage,
    runScheduledTochkaSync: input => runScheduledTochkaSync({ ...input, now: f.input.now }),
    ensureCoreTables: async () => {}, getIntegrationSetups: async () => ({ 'INT-T-TOCHKA': f.setup }), getDb: () => chain,
    validateIntegrationSetupReferences: () => step('setup_references'), readIntegrationCredential: () => step('credential_read', 'synthetic-private-key'),
    openTochkaStatementState: async (_setup, automatic) => { assert.equal(automatic, true); return step('statement_state_open', state); },
    syncTochkaReadOnly: () => step('bank_sync', { valid: true, complete: !pending, accounts: [], statements: [], transactions: [], rejectedCount: 0, expiresAt: '', reason: 'synthetic' }),
    commitTochkaReadOnlySync: async (actor, _setup, _sync, _trigger, fence) => {
      assert.equal(actor, 'SYSTEM:TOCHKA_READONLY_SCHEDULER'); assert.equal(fence, state.fence);
      return step('sync_commit', { committed: true, financialOperationCount: 0 });
    }, TochkaStatementStateChanged, hasTrustedMutationOrigin: () => true,
    getAuthenticatedRequestContext: async () => assert.fail('service must not impersonate an owner'),
  });
  const response = await route.POST(new Request('https://example.test/api/integration-actions', { method: 'POST',
    headers: { 'x-arthello-tochka-autosync': secret, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'revokeCredential', connectionId: 'INT-T-TBANK', failureStage: 'arbitrary' }) }));
  return { ...f, calls, response, result: await response.json() };
}

test('actual assembled route identifies each escaping sync stage without leaking exceptions or changing retry behavior', async () => {
  for (const stage of ['setup_references', 'credential_read', 'statement_state_open', 'bank_sync', 'statement_fence',
    'sync_commit', 'statement_acknowledge', 'statement_release']) {
    const f = await observedRouteFixture({ fail: stage });
    try {
      assert.equal(f.response.status, 200); assert.equal(f.result.outcome, 'error'); assert.equal(f.result.failureStage, stage);
      assert.equal(f.state().failureStage, stage); assert.equal(f.state().httpStatus, 500);
      assert.equal(f.state().failures, 1); assert.equal(f.state().nextAt, fixedNow + 900_000);
      assert.equal(f.state().leasedUntil, 0);
      assert.equal(f.sqlite.prepare('SELECT status FROM integration_connections').get().status, 'Ошибка подключения');
      assert.equal(f.calls.includes('statement_release'), !['setup_references', 'credential_read', 'statement_state_open'].includes(stage));
      assert.doesNotMatch(JSON.stringify([f.result, f.state()]), /synthetic-private|ORG-1|300000092|arbitrary/);
    } finally { f.sqlite.close(); }
  }
});

test('actual route preserves release-error precedence and clears handled fence failures for busy results', async () => {
  for (const options of [{ fail: 'sync_commit', releaseFails: true }, { busy: true }, { pending: true }, {}]) {
    const f = await observedRouteFixture(options);
    try {
      const expected = options.releaseFails ? 'error' : options.busy ? 'busy' : options.pending ? 'pending' : 'complete';
      assert.equal(f.result.outcome, expected);
      assert.equal(f.result.failureStage, options.releaseFails ? 'statement_release' : null);
      assert.equal(f.state().failureStage, f.result.failureStage);
      assert.equal(f.state().failures, options.releaseFails ? 1 : 0);
      assert.equal(f.calls.filter(stage => stage === 'statement_release').length, 1);
    } finally { f.sqlite.close(); }
  }
});
