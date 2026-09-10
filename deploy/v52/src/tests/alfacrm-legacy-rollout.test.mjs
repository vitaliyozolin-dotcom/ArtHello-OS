import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const nativeFetch = globalThis.fetch;
const tsModule = path => dataModule(stripTypeScriptTypes(readFileSync(resolve(path), 'utf8'), { mode: 'transform' }));
const fixture = { env: {}, actor: null, secretReads: 0, secretWrites: 0, calls: [] };
globalThis.__alfaLegacyRollout = fixture;
const adapters = {
  'cloudflare:workers': dataModule('export const env=globalThis.__alfaLegacyRollout.env;'),
  '../../../../lib/access-policy': tsModule('lib/access-policy.ts'),
  '../../../../lib/integrations': tsModule('lib/integrations.ts'),
  '../../../../lib/production-auth': dataModule('export const getAuthenticatedRequestContext=async()=>globalThis.__alfaLegacyRollout.actor; export const verifyAuthenticatedRequestCsrf=()=>{};'),
  '../../../../lib/request-security': dataModule('export const hasTrustedMutationOrigin=()=>true;'),
  '../../../../db': dataModule(`export const ensureCoreTables=async()=>{};
    export const readIntegrationCredential=async()=>{globalThis.__alfaLegacyRollout.secretReads+=1;return JSON.stringify({email:"fixture@example.test",apiKey:"synthetic-api-key",appKey:""});};
    export const saveIntegrationCredential=async(_actor,connection,scope,kind)=>{const f=globalThis.__alfaLegacyRollout;f.secretWrites+=1;await f.env.DB.prepare("INSERT OR REPLACE INTO system_runtime_state(state_key,state_value) VALUES(?,?)").bind('integration_credential:v2:'+connection+':'+scope+':'+kind,'fixture-encrypted-envelope').run();};`),
};
let routeSource = stripTypeScriptTypes(readFileSync(resolve('app/api/integrations/alfacrm/route.ts'), 'utf8'), { mode: 'transform' });
routeSource = routeSource.replace(/from\s+["']([^"']+)["']/g, (_all, name) => {
  assert.ok(adapters[name], `Unexpected route dependency ${name}`);
  return `from "${adapters[name]}"`;
});
routeSource += '\nexport {defaultState,persistState,alfaFetch};\n//# sourceURL=alfacrm-legacy-route-fixture.mjs';
const route = await import(dataModule(routeSource));
const legacyKey = 'integration_setup:INT-T-ALFACRM';
const stagedKey = 'alfacrm_connector:v1';
const endpoint = 'https://fixture.s20.online';
const legacySetup = { connectionId: 'INT-T-ALFACRM', endpoint, accountScope: '7', branchId: 'BR-SCHOOL', startDate: '2026-01-01', dataScopes: ['Семьи', 'Занятия'], secretStatus: 'external_required', authMethod: 'API', syncIntervalMinutes: 60 };

async function setup(t, legacy = legacySetup) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(`CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT,updated_at TEXT);
    CREATE TABLE organization_branches(id TEXT PRIMARY KEY,name TEXT,status TEXT,sort_order INTEGER);
    INSERT INTO organization_branches VALUES('BR-SCHOOL','School','Активен',1),('BR-INACTIVE','Old branch','Архив',2);
    CREATE TABLE integration_connections(id TEXT PRIMARY KEY,owner_entity_id TEXT,status TEXT,auth_status TEXT,verified_transfer INTEGER,is_enabled INTEGER,last_success_at TEXT,next_sync_at TEXT,error_count INTEGER,updated_at TEXT,received_count INTEGER,accepted_count INTEGER,rejected_count INTEGER);
    INSERT INTO integration_connections VALUES('INT-T-ALFACRM','USER:FIXTURE-OWNER','Ожидает доступ','Настройка сохранена · секрет требуется',0,0,'','',0,'original',0,0,0);
    CREATE TABLE audit_events(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT);`);
  if (legacy !== null) sql.prepare('INSERT INTO system_runtime_state VALUES(?,?,?)').run(legacyKey, JSON.stringify(legacy), 'original');
  const statement = (query, args = []) => ({
    bind(...values) { return statement(query, values); },
    executeSync() { return sql.prepare(query).run(...args); },
    async run() { return sql.prepare(query).run(...args); },
    async first() { return sql.prepare(query).get(...args) ?? null; },
    async all() { return { results: sql.prepare(query).all(...args) }; },
  });
  fixture.env.DB = { prepare: query => statement(query), batch: async items => {
    sql.exec('BEGIN');
    try { const results = items.map(item => item.executeSync()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  fixture.env.ALFACRM_IMPORT_ENABLED = '';
  fixture.actor = { actor: 'fixture-owner', appUserId: 'FIXTURE-OWNER', apiRole: 'OWNER', auth: { user: { isSystemOwner: true, isAdministrative: true, allowedModules: ['integrations'] } } };
  fixture.secretReads = 0; fixture.secretWrites = 0; fixture.calls = [];
  mockUpstream();
  return sql;
}

function mockUpstream({ authStatus = 200, branches = [{ id: 7, name: 'Remote school', is_active: 1 }], redirect = null } = {}) {
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    fixture.calls.push({ path, redirect: init.redirect, body: JSON.parse(init.body ?? '{}') });
    if (redirect !== null) return new Response(null, { status: redirect, headers: { location: 'https://unexpected.example.test' } });
    if (path.endsWith('/auth/login')) return Response.json(authStatus === 200 ? { token: 'synthetic-alfa-auth-token' } : { message: 'fixture authentication failed' }, { status: authStatus });
    assert.ok(path.endsWith('/branch/index'), `Unexpected external endpoint ${path}`);
    return Response.json({ items: branches, total: branches.length });
  };
}

const get = () => route.GET(new Request('https://arthello.example.test/api/integrations/alfacrm'));
const post = body => route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://arthello.example.test' }, body: JSON.stringify(body) }));
const connect = (overrides = {}) => post({ action: 'connect', endpoint, email: 'fixture@example.test', apiKey: 'synthetic-api-key', appKey: '', ...overrides });
const legacyRow = sql => sql.prepare('SELECT * FROM system_runtime_state WHERE state_key=?').get(legacyKey);

test('GET exposes legacy preferences as a disconnected draft without secret reads, network or writes', async t => {
  const sql = await setup(t);
  const before = sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all();
  const response = await get(); assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.state.connected, false); assert.equal(body.credentialStored, false);
  assert.equal(body.importEnabled, false); assert.match(body.importBlockedReason, /Подключение и предпросмотр доступны/);
  assert.doesNotMatch(body.importBlockedReason, /live coverage|integrity/);
  assert.equal(body.state.endpoint, endpoint); assert.deepEqual(body.state.branchMappings, {});
  assert.deepEqual(body.state.legacyDraft, { remoteBranchId: '7', localBranchId: 'BR-SCHOOL', startDate: '2026-01-01', dataScopes: ['Семьи', 'Занятия'] });
  assert.equal(body.state.modules.lessons.dateFrom, '2026-01-01');
  assert.equal(body.state.modules.finance.dateFrom, '2026-01-01');
  assert.equal(fixture.secretReads, 0); assert.equal(fixture.secretWrites, 0); assert.equal(fixture.calls.length, 0);
  assert.deepEqual(sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all(), before);
});

test('GET keeps an existing staged state authoritative over older generic preferences', async t => {
  const sql = await setup(t);
  const current = route.defaultState();
  Object.assign(current, { connected: true, endpoint: 'https://current.s20.online', connectedAt: '2026-09-01', branchMappings: { '22': 'BR-SCHOOL' }, remoteBranches: [{ id: '22', name: 'Current' }] });
  current.modules.lessons.dateFrom = '2026-08-01';
  await route.persistState(current);
  sql.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)').run('integration_credential:v2:INT-T-ALFACRM:ARTHELLO:ALFACRM-V2', 'opaque-fixture-envelope');
  const before = sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all();
  const body = await (await get()).json();
  assert.equal(body.state.connected, true); assert.equal(body.state.endpoint, current.endpoint);
  assert.deepEqual(body.state.branchMappings, { '22': 'BR-SCHOOL' });
  assert.equal(body.state.modules.lessons.dateFrom, '2026-08-01'); assert.equal(body.state.legacyDraft, undefined);
  assert.equal(fixture.secretReads, 0); assert.equal(fixture.calls.length, 0);
  assert.deepEqual(sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all(), before);
});

test('real authentication of the same tenant restores only the exact verified legacy branch pair', async t => {
  const sql = await setup(t); const before = legacyRow(sql);
  const response = await connect(); assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.state.connected, true); assert.deepEqual(body.state.branchMappings, { '7': 'BR-SCHOOL' });
  assert.equal(body.state.modules.lessons.dateFrom, legacySetup.startDate);
  assert.equal(body.state.modules.finance.dateFrom, legacySetup.startDate);
  assert.equal(fixture.secretWrites, 1); assert.equal(fixture.secretReads, 0);
  assert.equal(fixture.calls.length, 2); assert.ok(fixture.calls[0].path.endsWith('/auth/login'));
  assert.ok(fixture.calls[1].path.endsWith('/branch/index'));
  assert.equal(fixture.calls[1].body.is_active, 1);
  assert.deepEqual(legacyRow(sql), before);
  assert.ok(sql.prepare('SELECT 1 FROM system_runtime_state WHERE state_key=?').get(stagedKey));
  assert.ok(!JSON.stringify(body).includes('synthetic-api-key'));
});

test('connecting a different tenant discards the old draft mapping and date preferences', async t => {
  const sql = await setup(t); const before = legacyRow(sql);
  const response = await connect({ endpoint: 'https://different.s20.online' });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.state.endpoint, 'https://different.s20.online'); assert.equal(body.state.connected, true);
  assert.deepEqual(body.state.branchMappings, {}); assert.equal(body.state.legacyDraft, undefined);
  assert.equal(body.state.modules.lessons.dateFrom, ''); assert.equal(body.state.modules.finance.dateFrom, '');
  assert.deepEqual(legacyRow(sql), before);
});

for (const [name, legacy, remote] of [
  ['unknown remote branch', legacySetup, [{ id: 8, name: 'Other remote', is_active: 1 }]],
  ['inactive local branch', { ...legacySetup, branchId: 'BR-INACTIVE' }, [{ id: 7, name: 'Remote school', is_active: 1 }]],
  ['missing local branch', { ...legacySetup, branchId: 'BR-MISSING' }, [{ id: 7, name: 'Remote school', is_active: 1 }]],
  ['inactive remote branch', legacySetup, [{ id: 7, name: 'Inactive remote', is_active: 0 }, { id: 8, name: 'Active remote', is_active: 1 }]],
]) test(`legacy mapping is not restored for ${name}`, async t => {
  const sql = await setup(t, legacy); const before = legacyRow(sql);
  mockUpstream({ branches: remote });
  const response = await connect(); assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).state.branchMappings, {});
  assert.deepEqual(legacyRow(sql), before);
});

test('failed authentication preserves state, legacy preferences, credentials and connection status', async t => {
  const sql = await setup(t);
  const beforeState = sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all();
  const beforeConnection = sql.prepare('SELECT * FROM integration_connections').all();
  mockUpstream({ authStatus: 401 });
  const response = await connect(); assert.notEqual(response.status, 200);
  assert.equal(fixture.secretWrites, 0); assert.equal(fixture.secretReads, 0); assert.equal(fixture.calls.length, 1);
  assert.deepEqual(sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all(), beforeState);
  assert.deepEqual(sql.prepare('SELECT * FROM integration_connections').all(), beforeConnection);
});

test('empty branch discovery cannot persist a falsely connected state', async t => {
  const sql = await setup(t);
  const beforeState = sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all();
  const beforeConnection = sql.prepare('SELECT * FROM integration_connections').all();
  mockUpstream({ branches: [] });
  assert.equal((await connect()).status, 422);
  assert.equal(fixture.secretWrites, 0);
  assert.deepEqual(sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all(), beforeState);
  assert.deepEqual(sql.prepare('SELECT * FROM integration_connections').all(), beforeConnection);
});

test('legacy rollout does not weaken the live import release gate', async t => {
  const sql = await setup(t); const before = legacyRow(sql);
  assert.equal((await post({ action: 'importModule', module: 'families', previewToken: 'fixture-preview' })).status, 409);
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.secretReads, 0); assert.equal(fixture.secretWrites, 0);
  assert.deepEqual(legacyRow(sql), before);
});

test('Alfa transport uses manual redirects and rejects every redirect response without following it', async t => {
  await setup(t);
  for (const status of [301, 302, 303, 307, 308]) {
    fixture.calls = []; mockUpstream({ redirect: status });
    await assert.rejects(() => route.alfaFetch(`${endpoint}/v2api/auth/login`, { method: 'POST', body: '{}' }));
    assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].redirect, 'manual');
  }
});

test('actual Miniflare executes the route transport and rejects redirects before a second upstream request', async t => {
  // The real workerd Request parser is essential here: Node accepts redirect:error,
  // whereas workerd rejects it before making an outgoing request.
  globalThis.fetch = nativeFetch;
  const require = createRequire(resolve('package.json'));
  const { Miniflare } = require('miniflare');
  const source = stripTypeScriptTypes(readFileSync(resolve('app/api/integrations/alfacrm/route.ts'), 'utf8'), { mode: 'transform' });
  const start = source.indexOf('async function alfaFetch(');
  const end = source.indexOf('\nfunction alfaHeaders(', start);
  assert.ok(start >= 0 && end > start, 'extract actual unchanged route transport');
  const transport = source.slice(start, end);
  const interval = source.match(/const MIN_REQUEST_INTERVAL_MS = [^;]+;/)?.[0];
  const timeout = source.match(/const REQUEST_TIMEOUT_MS = [^;]+;/)?.[0];
  assert.ok(interval && timeout);
  let upstreamStatus = 200;
  const outgoing = [];
  const runtime = new Miniflare({
    modules: true, cf: false, telemetry: { enabled: false }, compatibilityDate: '2026-05-15',
    script: `let requestTail=Promise.resolve();let lastRequestStartedAt=0;${interval}${timeout}
      class AlfaApiError extends Error {}
      ${transport}
      export default { async fetch() { try { const response=await alfaFetch('https://upstream.fixture.invalid/v2api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return Response.json({upstreamStatus:response.status}); } catch(error) { return Response.json({error:error.message},{status:502}); } } };`,
    outboundService: async request => {
      outgoing.push({ url: request.url, method: request.method });
      return upstreamStatus === 200 ? Response.json({ token: 'synthetic-token' }) : new Response(null, { status: upstreamStatus, headers: { location: 'https://must-not-follow.fixture.invalid/' } });
    },
  });
  t.after(() => runtime.dispose());
  const ok = await runtime.dispatchFetch('http://arthello.fixture.invalid/');
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual(await ok.json(), { upstreamStatus: 200 });
  assert.equal(outgoing.length, 1);
  upstreamStatus = 302; outgoing.length = 0;
  const rejected = await runtime.dispatchFetch('http://arthello.fixture.invalid/');
  assert.equal(rejected.status, 502);
  assert.match((await rejected.json()).error, /перенаправ|redirect/i);
  assert.equal(outgoing.length, 1);
  assert.equal(new URL(outgoing[0].url).hostname, 'upstream.fixture.invalid');
});
