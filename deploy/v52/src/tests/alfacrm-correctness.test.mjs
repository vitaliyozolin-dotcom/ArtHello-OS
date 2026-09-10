import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// Execute the assembled application route, including its release patch. Only
// external auth, D1 and AlfaCRM transport are replaced with deterministic fixtures.
const dataModule = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const policyUrl = dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/access-policy.ts'), 'utf8'), { mode: 'strip' }));
const integrationsUrl = dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/integrations.ts'), 'utf8'), { mode: 'strip' }));
const policy = await import(policyUrl);
globalThis.__alfaCorrectness = { env: {}, actor: null, csrfValid: true, originValid: true };
const harness = globalThis.__alfaCorrectness;
const adapters = {
  'cloudflare:workers': dataModule('export const env=globalThis.__alfaCorrectness.env;'),
  '../../../../db': dataModule('export const ensureCoreTables=async()=>{}; export const readIntegrationCredential=async()=>JSON.stringify({email:"fixture@example.test",apiKey:"synthetic-key",appKey:""}); export const saveIntegrationCredential=async()=>{};'),
  '../../../../lib/access-policy': policyUrl,
  '../../../../lib/integrations': integrationsUrl,
  '../../../../lib/production-auth': dataModule('export const getAuthenticatedRequestContext=async()=>globalThis.__alfaCorrectness.actor; export const verifyAuthenticatedRequestCsrf=()=>{if(!globalThis.__alfaCorrectness.csrfValid)throw new Error("fixture csrf rejected");};'),
  '../../../../lib/request-security': dataModule('export const hasTrustedMutationOrigin=()=>globalThis.__alfaCorrectness.originValid;'),
};
let source = stripTypeScriptTypes(readFileSync(resolve('app/api/integrations/alfacrm/route.ts'), 'utf8'), { mode: 'transform' })
  .replace(/from\s+["']([^"']+)["']/g, (_all, name) => {
    assert.ok(adapters[name], `Unexpected dependency ${name}: update the explicit fixture adapter`);
    return `from "${adapters[name]}"`;
  });
source += '\nexport {defaultState,persistState,readState,ensureAlfaTables,upsertRawRecords,canonicalizeFamilies,canonicalizeStaff,canonicalizeGroups,canonicalizeFinance,importModule,previewModule,previewSignatureFor,normalizeEndpoint,alfaFetch,fetchPaged};\n//# sourceURL=alfacrm-correctness-fixture.mjs';
const route = await import(dataModule(source));
const branches = [{ id: 'BR-SCHOOL', name: 'School' }, { id: 'BR-NURSERY', name: 'Nursery' }];
const session = { endpoint: 'https://fixture.s20.online', token: 'synthetic-token-for-tests', email: 'fixture@example.test', apiKey: 'synthetic-key', appKey: '' };

function actor(apiRole = 'OWNER', allowedModules = ['integrations']) {
  return { actor: 'fixture@example.test', appUserId: 'FIXTURE-OWNER', apiRole, auth: { user: {
    id: 'fixture-owner', isSystemOwner: apiRole === 'OWNER', canAccessMedical: false,
    isAdministrative: apiRole === 'OWNER',
    allowedModules, allowedBranchIds: branches.map(branch => branch.id), branchIds: branches.map(branch => branch.id),
  } } };
}

async function setup(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT,updated_at TEXT);
    CREATE TABLE organization_branches(id TEXT PRIMARY KEY,name TEXT,status TEXT,sort_order INTEGER);
    INSERT INTO organization_branches VALUES('BR-SCHOOL','School','Активен',1),('BR-NURSERY','Nursery','Активен',2);
    CREATE TABLE entities(id TEXT PRIMARY KEY,entity_type TEXT,display_name TEXT,status TEXT,source_system TEXT,source_record_id TEXT,data_quality TEXT,scope TEXT,metadata TEXT,created_by TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE entity_links(from_entity_id TEXT,to_entity_id TEXT,relation_type TEXT,created_by TEXT,UNIQUE(from_entity_id,to_entity_id,relation_type));
    CREATE TABLE audit_events(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT);
    CREATE TABLE integration_connections(id TEXT,owner_entity_id TEXT,status TEXT,auth_status TEXT,verified_transfer INTEGER,is_enabled INTEGER,last_success_at TEXT,next_sync_at TEXT,error_count INTEGER,updated_at TEXT,received_count INTEGER,accepted_count INTEGER,rejected_count INTEGER);
    INSERT INTO integration_connections(id,owner_entity_id,received_count,accepted_count,rejected_count) VALUES('INT-T-ALFACRM','USER:FIXTURE-OWNER',0,0,0);
    CREATE TABLE user_branch_access(user_id TEXT,branch_id TEXT);
    CREATE TABLE hr_employees(id TEXT PRIMARY KEY,candidate_id TEXT,contract_id TEXT,position_id TEXT,unit TEXT,rate_minor INTEGER,hire_date TEXT,status TEXT,termination_date TEXT,termination_reason TEXT,access_status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE education_programs(id TEXT PRIMARY KEY,title TEXT,version INTEGER,status TEXT,author_entity_id TEXT,methodist_entity_id TEXT,scope TEXT,material_ref TEXT,expected_result TEXT,source_type TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE education_groups(id TEXT PRIMARY KEY,name TEXT,unit_entity_id TEXT,program_id TEXT,teacher_entity_id TEXT,room TEXT,status TEXT);
    CREATE TABLE education_students(id TEXT PRIMARY KEY,child_entity_id TEXT,family_entity_id TEXT,group_id TEXT,cabinet_status TEXT,status TEXT);
  `);
  const statement = (query, args = []) => ({
    bind(...values) { return statement(query, values); },
    executeSync() { return sql.prepare(query).run(...args); },
    async run() { return sql.prepare(query).run(...args); },
    async first() { return sql.prepare(query).get(...args) ?? null; },
    async all() { return { results: sql.prepare(query).all(...args) }; },
  });
  harness.env.DB = { prepare: query => statement(query), batch: async items => {
    sql.exec('BEGIN');
    try { const results = items.map(item => item.executeSync()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  harness.env.ALFACRM_IMPORT_ENABLED = 'true';
  harness.env.ARTHELLO_PUBLIC_ORIGIN = 'https://arthello.example.test';
  harness.actor = actor(); harness.csrfValid = true; harness.originValid = true;
  await route.ensureAlfaTables();
  const state = route.defaultState();
  Object.assign(state, {
    connected: true, endpoint: session.endpoint,
    remoteBranches: [{ id: '1', name: 'School remote' }, { id: '2', name: 'Nursery remote' }],
    branchMappings: { '1': 'BR-SCHOOL', '2': 'BR-NURSERY' },
  });
  await route.persistState(state);
  mockRecords({});
  return { sql, state };
}

function mockRecords(byPath, observe = () => {}) {
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname.replace('/v2api/', '');
    const body = init?.body ? JSON.parse(init.body) : {};
    observe(path, body, init);
    if (path === 'auth/login') return Response.json({ token: session.token });
    const value = byPath[path] ?? [];
    if (typeof value === 'function') return value(body, url, init);
    return Response.json({ items: value, total: value.length });
  };
}

async function importSnapshot(module, records, { mappings, token, body = {} } = {}) {
  const state = await route.readState();
  if (mappings) state.branchMappings = mappings;
  if (module === 'groups') state.modules.staff.status = 'imported';
  if (module === 'subscriptions' || module === 'finance') state.modules.families.status = 'imported';
  const params = { dateFrom: '', dateTo: '' };
  state.modules[module].previewToken = token ?? `preview-${crypto.randomUUID()}`;
  state.modules[module].previewSignature = await route.previewSignatureFor(module, state, params);
  state.modules[module].status = 'previewed';
  state.modules[module].lastPreviewAt = new Date().toISOString();
  await route.persistState(state);
  const paths = { families: 'customer/index', staff: 'teacher/index', groups: 'group/index' };
  if (records !== null) mockRecords(Object.fromEntries(Object.entries(records).map(([branch, value]) => [`${branch}/${paths[module]}`, value])));
  const response = await route.importModule(actor(), { module, previewToken: state.modules[module].previewToken, ...body });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function post(body = { action: 'unknownFixtureAction' }) {
  return route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://arthello.example.test' }, body: JSON.stringify(body),
  }));
}

const previousSuccess = '2026-01-02T03:04:05.000Z';

async function prepareSubscriptions(t, count = 1) {
  const value = await setup(t);
  await importSnapshot('families', { '1': Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Pupil ${index + 1}` })) }, { mappings: { '1': 'BR-SCHOOL' } });
  value.sql.prepare('UPDATE integration_connections SET last_success_at=?').run(previousSuccess);
  return value;
}

function customersForBalance(balance) {
  mockRecords({ '1/customer/index': body => Response.json({ items: [{ id: body.id, balance, paid_lesson_count: 7 }], total: 1 }), '1/customer-tariff/index': (_body, url) => {
    const customerId = new URL(String(url)).searchParams.get('customer_id');
    return Response.json({ items: [{ id: Number(customerId), customer_id: customerId, balance: 99 }], total: 1 });
  } });
}

async function previewSubscriptions() {
  const response = await post({ action: 'previewModule', module: 'subscriptions' });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function importSubscriptions(token) {
  const response = await post({ action: 'importModule', module: 'subscriptions', previewToken: token });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('missing and malformed balances reject without replacing the last confirmed projection or lineage', async t => {
  const { sql } = await prepareSubscriptions(t);
  customersForBalance(42);
  let preview = await previewSubscriptions();
  assert.match(preview.message, /не заменяются нулём/);
  await importSubscriptions(preview.previewToken);
  const original = sql.prepare('SELECT * FROM alfacrm_customer_balances').all();
  const originalLineage = sql.prepare("SELECT * FROM alfacrm_projection_lineage WHERE projection_table='alfacrm_customer_balances'").all();
  const invalid = [undefined, null, '', '   ', 'unknown', 'oops12', '1..2', '1 2', true, {}, []];
  for (const balance of invalid) {
    sql.prepare('UPDATE integration_connections SET last_success_at=?').run(previousSuccess);
    customersForBalance(balance);
    preview = await previewSubscriptions();
    const result = await importSubscriptions(preview.previewToken);
    assert.equal(result.accepted, 0, JSON.stringify(balance));
    assert.equal(result.rejected, 1);
    assert.equal(result.invalidBalanceCount, 1);
    assert.equal(result.state.modules.subscriptions.status, 'error');
    assert.match(result.message, /Остаток отсутствует|корректным числом/);
    assert.equal(result.state.modules.subscriptions.previewToken, '');
    assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_customer_balances').all(), original);
    assert.deepEqual(sql.prepare("SELECT * FROM alfacrm_projection_lineage WHERE projection_table='alfacrm_customer_balances'").all(), originalLineage);
    assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
  }
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM alfacrm_raw_observations WHERE module='subscriptions'").get().count, invalid.length + 1, 'received observations remain append-only evidence, rejected values are never projections');
});

test('fresh Customer monetary zero and signed decimal balances import independently of tariff units', async t => {
  const { sql } = await prepareSubscriptions(t);
  for (const [balance, expected] of [[0,0],['0',0],['0.00',0],[-2.5,-250],['1 234,50',123450],['1\u00a0234.50',123450]]) {
    sql.prepare('UPDATE integration_connections SET last_success_at=?').run(previousSuccess);
    customersForBalance(balance);
    const preview = await previewSubscriptions();
    const result = await importSubscriptions(preview.previewToken);
    assert.equal(result.complete, true);
    assert.equal(result.rejected, 0);
    assert.equal(result.invalidBalanceCount, 0);
    assert.equal(result.state.modules.subscriptions.status, 'imported');
    assert.equal(sql.prepare('SELECT balance_minor FROM alfacrm_customer_balances').get().balance_minor, expected);
    assert.notEqual(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
  }
});

test('out-of-range and nonfinite JSON-compatible values cannot become confirmed zero or unsafe integers', async t => {
  const { sql } = await prepareSubscriptions(t);
  for (const balance of [Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, '900719925474099999999', 'Infinity', 'NaN', '1e309']) {
    customersForBalance(balance);
    const preview = await previewSubscriptions();
    const result = await importSubscriptions(preview.previewToken);
    assert.equal(result.rejected, 1);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_balances').get().n, 0);
    assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
  }
});

test('partial subscription chunks do not advance last success; only clean final completion does', async t => {
  const { sql } = await prepareSubscriptions(t, 16);
  customersForBalance(0);
  const preview = await previewSubscriptions();
  const first = await importSubscriptions(preview.previewToken);
  assert.equal(first.complete, false);
  assert.equal(first.state.modules.subscriptions.status, 'importing');
  assert.equal(first.accepted, 15);
  assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
  const final = await importSubscriptions(preview.previewToken);
  assert.equal(final.complete, true);
  assert.equal(final.rejected, 0);
  assert.equal(final.state.modules.subscriptions.importedCount, 16);
  assert.notEqual(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
});

test('a rejected earlier chunk cannot be concealed by continuing to a clean final chunk', async t => {
  const { sql } = await prepareSubscriptions(t, 16);
  customersForBalance(null);
  const preview = await previewSubscriptions();
  const first = await importSubscriptions(preview.previewToken);
  assert.equal(first.complete, false);
  assert.equal(first.rejected, 15);
  assert.equal(first.state.modules.subscriptions.status, 'error');
  assert.equal(first.state.modules.subscriptions.previewToken, '');
  assert.equal(first.state.modules.subscriptions.cursor, 0);
  let fetches = 0;
  mockRecords({}, () => { fetches += 1; });
  const response = await post({ action: 'importModule', module: 'subscriptions', previewToken: preview.previewToken });
  assert.equal(response.status, 409);
  assert.equal(fetches, 0, 'failed preview cannot authorize a later chunk');
  assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
});

test('a rejected final chunk retains previous last success despite prior accepted chunks', async t => {
  const { sql } = await prepareSubscriptions(t, 16);
  customersForBalance(5);
  const preview = await previewSubscriptions();
  const first = await importSubscriptions(preview.previewToken);
  assert.equal(first.complete, false);
  customersForBalance('not confirmed');
  const final = await importSubscriptions(preview.previewToken);
  assert.equal(final.complete, true);
  assert.equal(final.rejected, 1);
  assert.equal(final.state.modules.subscriptions.status, 'error');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_balances').get().n, 15);
  assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
});

test('rejected family snapshot also preserves last success', async t => {
  const { sql } = await setup(t);
  sql.prepare('UPDATE integration_connections SET last_success_at=?').run(previousSuccess);
  const result = await importSnapshot('families', {'1': [{ id: 1 }]}, { mappings: {'1': 'BR-SCHOOL'} });
  assert.equal(result.complete, true);
  assert.equal(result.rejected, 1);
  assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
});

test('expired, missing, invalid and future preview time refuses before auth, upstream or raw writes', async t => {
  const { sql, state } = await setup(t);
  state.branchMappings = {'1': 'BR-SCHOOL'};
  state.modules.families.status = 'previewed';
  state.modules.families.previewToken = 'time-bound-preview';
  state.modules.families.previewSignature = await route.previewSignatureFor('families',state,{dateFrom:'',dateTo:''});
  for (const timestamp of ['', 'invalid', new Date(Date.now()-30*60*1000).toISOString(), new Date(Date.now()-31*60*1000).toISOString(), new Date(Date.now()+60*1000).toISOString()]) {
    state.modules.families.lastPreviewAt = timestamp;
    await route.persistState(state);
    let fetches = 0; mockRecords({}, () => { fetches += 1; });
    const before = sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_raw_observations').get().n;
    const response = await post({action:'importModule',module:'families',previewToken:'time-bound-preview'});
    assert.equal(response.status,409,timestamp);
    assert.match((await response.json()).error,/Предпросмотр устарел|время не подтверждено/);
    assert.equal(fetches,0);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_raw_observations').get().n,before);
  }
});

test('a fresh preview within 30 minutes authorizes import', async t => {
  const { sql, state } = await setup(t);
  state.branchMappings = {'1': 'BR-SCHOOL'};
  state.modules.families.status = 'previewed';
  state.modules.families.previewToken = 'valid-preview';
  state.modules.families.previewSignature = await route.previewSignatureFor('families',state,{dateFrom:'',dateTo:''});
  state.modules.families.lastPreviewAt = new Date(Date.now()-29*60*1000).toISOString();
  await route.persistState(state);
  mockRecords({'1/customer/index':[{id:1,name:'Pupil'}]});
  const response = await post({action:'importModule',module:'families',previewToken:'valid-preview'});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM alfacrm_current_records WHERE module='families'").get().n,1);
});

test('a fresh Customer money balance is independent of stale family balances and tariff units', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': [{ id: 1, name: 'Pupil', balance: 9999, paid_lesson_count: 50 }] }, { mappings: { '1': 'BR-SCHOOL' } });
  const calls = [];
  const customer = { id: 1, balance: 123.45, paid_lesson_count: 7 };
  const tariffs = [{ id: 11, customer_id: 1, balance: 80, tariff_id: 8 }, { id: 12, customer_id: 1, balance: null }];
  mockRecords({
    '1/customer/index': body => { assert.equal(body.id, '1'); return Response.json({ items: [customer], total: 1 }); },
    '1/customer-tariff/index': tariffs,
  }, (path, body) => calls.push({ path, body }));
  const preview = await previewSubscriptions();
  const result = await importSubscriptions(preview.previewToken);
  assert.equal(result.accepted, 1, 'count customers, not number of tariff records');
  assert.equal(result.rejected, 0);
  const row = sql.prepare('SELECT * FROM alfacrm_customer_balances').get();
  assert.equal(row.balance_minor, 12345);
  assert.equal(row.paid_lesson_count, 7);
  assert.equal(row.source_field, 'Customer.balance');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_tariffs').get().n, 0, 'tariff units never become money');
  const observation = sql.prepare("SELECT o.* FROM alfacrm_projection_lineage l JOIN alfacrm_raw_observations o ON o.id=l.observation_id WHERE l.projection_table='alfacrm_customer_balances'").get();
  const payload = JSON.parse(observation.payload);
  assert.deepEqual(payload.customer, customer);
  assert.deepEqual(payload.tariffs, tariffs);
  assert.equal(observation.record_id, 'customer-balance-v2:1');
  assert.equal(row.payload_hash, observation.payload_hash);
  assert.equal(calls.filter(call => call.path.endsWith('/customer/index')).length, 1);
});

test('a customer with no tariffs still imports its explicit money balance, and unknown lessons stay null', async t => {
  const { sql } = await prepareSubscriptions(t);
  mockRecords({ '1/customer/index': [{ id: 1, balance: 0 }], '1/customer-tariff/index': [] });
  const preview = await previewSubscriptions();
  const result = await importSubscriptions(preview.previewToken);
  assert.equal(result.accepted, 1);
  const row = sql.prepare('SELECT balance_minor,paid_lesson_count FROM alfacrm_customer_balances').get();
  assert.equal(row.balance_minor, 0);
  assert.equal(row.paid_lesson_count, null);
});

test('missing fresh customer is rejected even when tariffs claim a numeric balance', async t => {
  const { sql } = await prepareSubscriptions(t);
  mockRecords({ '1/customer/index': [], '1/customer-tariff/index': [{ id: 1, customer_id: 1, balance: 500 }] });
  const preview = await previewSubscriptions();
  const result = await importSubscriptions(preview.previewToken);
  assert.equal(result.accepted, 0); assert.equal(result.rejected, 1); assert.equal(result.invalidBalanceCount, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_balances').get().n, 0);
  assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
});

test('ID filter violations and cross-customer tariffs stop before projection or raw batch writes', async t => {
  const { sql } = await prepareSubscriptions(t);
  for (const fixtures of [
    { '1/customer/index': [{ id: 2, balance: 10 }] },
    { '1/customer/index': [{ id: 1, balance: 10 }, { id: 2, balance: 20 }] },
    { '1/customer/index': [{ id: 1, balance: 10 }], '1/customer-tariff/index': [{ id: 7, customer_id: 2, balance: 9 }] },
  ]) {
    mockRecords(fixtures);
    const preview = await previewSubscriptions();
    const result = await post({ action: 'importModule', module: 'subscriptions', previewToken: preview.previewToken });
    assert.equal(result.status, 500);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_balances').get().n, 0);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM alfacrm_raw_observations WHERE module='subscriptions'").get().n, 0);
  }
});

test('two mapped branches with equal customer IDs keep separate non-aggregated balance snapshots', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': [{ id: 1, name: 'School pupil' }], '2': [{ id: 1, name: 'Nursery pupil' }] });
  const calls = [];
  mockRecords({ '1/customer/index': [{ id: 1, balance: 10 }], '2/customer/index': [{ id: 1, balance: 20 }] }, path => calls.push(path));
  const preview = await previewSubscriptions();
  const result = await importSubscriptions(preview.previewToken);
  assert.equal(result.accepted, 2);
  const rows = sql.prepare('SELECT remote_branch_id,local_branch_id,customer_id,family_entity_id,balance_minor FROM alfacrm_customer_balances ORDER BY remote_branch_id').all();
  assert.deepEqual(rows.map(row => [row.remote_branch_id,row.customer_id,row.balance_minor]), [['1','1',1000],['2','1',2000]]);
  assert.notEqual(rows[0].family_entity_id, rows[1].family_entity_id);
  assert.deepEqual(rows.map(row => [row.remote_branch_id,row.local_branch_id]), [['1','BR-SCHOOL'],['2','BR-NURSERY']]);
  assert.equal(calls.filter(path => path.endsWith('/customer/index')).length, 2);
});

test('additive balance schema preserves legacy money claims as evidence and is idempotent', async t => {
  const { sql } = await prepareSubscriptions(t);
  sql.exec('DROP TABLE alfacrm_customer_balances'); // In-memory pre-upgrade fixture only.
  sql.prepare(`INSERT INTO alfacrm_customer_tariffs(remote_branch_id,customer_id,tariff_record_id,balance_minor,payload_hash,imported_at) VALUES('1','1','1',999999,'legacy-hash','2026-01-01')`).run();
  await route.upsertRawRecords('subscriptions', [{ remoteBranchId: '1', item: { id: 1, customer_id: 1, balance: 9999.99 } }]);
  const legacy = sql.prepare('SELECT * FROM alfacrm_customer_tariffs').all();
  const oldObservation = sql.prepare("SELECT * FROM alfacrm_raw_observations WHERE module='subscriptions'").get();
  await route.ensureAlfaTables();
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_balances').get().n, 0);
  customersForBalance(12.34);
  const preview = await previewSubscriptions();
  await importSubscriptions(preview.previewToken);
  await route.ensureAlfaTables(); await route.ensureAlfaTables();
  assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_customer_tariffs').all(), legacy);
  assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_raw_observations WHERE id=?').get(oldObservation.id), oldObservation);
  assert.equal(sql.prepare('SELECT balance_minor FROM alfacrm_customer_balances').get().balance_minor, 1234);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM alfacrm_current_records WHERE module='subscriptions'").get().n, 2, 'legacy tariff ID does not collide with namespaced customer balance');
  assert.throws(() => sql.prepare('DELETE FROM alfacrm_raw_observations WHERE id=?').run(oldObservation.id), /append-only/);
  assert.throws(() => sql.prepare('UPDATE alfacrm_raw_observations SET payload=? WHERE id=?').run('{}',oldObservation.id), /append-only/);
});

test('a pre-fix tariff-source preview cannot authorize the new customer monetary source', async t => {
  const { sql } = await prepareSubscriptions(t);
  customersForBalance(1);
  const preview = await previewSubscriptions();
  const state = await route.readState();
  const oldInput = { endpoint: state.endpoint, connectedAt: state.connectedAt, module: 'subscriptions', mappings: Object.entries(state.branchMappings).sort(([a],[b]) => a.localeCompare(b)), params: { dateFrom: '', dateTo: '' } };
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(oldInput)));
  state.modules.subscriptions.previewSignature = Buffer.from(digest).toString('hex');
  await route.persistState(state);
  let calls = 0; mockRecords({}, () => calls++);
  const result = await post({ action: 'importModule', module: 'subscriptions', previewToken: preview.previewToken });
  assert.equal(result.status, 409); assert.equal(calls, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_balances').get().n, 0);
});

test('unsupported money precision is rejected rather than rounded into a made-up confirmed amount', async t => {
  const { sql } = await prepareSubscriptions(t);
  for (const value of [1.005, -1.005, '2.999', 0.001]) {
    customersForBalance(value);
    const preview = await previewSubscriptions();
    const result = await importSubscriptions(preview.previewToken);
    assert.equal(result.accepted, 0); assert.equal(result.invalidBalanceCount, 1);
  }
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_balances').get().n, 0);
});

test('unverified PayType directions never replace previous finance projections or report successful import', async t => {
  const { sql } = await prepareSubscriptions(t);
  sql.prepare(`INSERT INTO alfacrm_finance_snapshots(remote_branch_id,payment_id,operation_date,direction,amount_minor,payload_hash,imported_at) VALUES('1','5','2026-09-01','Legacy direction',77,'legacy','2026-01-01')`).run();
  const previous = sql.prepare('SELECT * FROM alfacrm_finance_snapshots').all();
  const items = [{ id: 5, income: 100, amount: 999, pay_type_id: 5 }, { id: 12, income: -100, pay_type_id: 12 }, { id: 17, amount: 25, outcome: 25, pay_type_id: 1 }];
  mockRecords({ '1/pay/index': items });
  const previewResponse = await post({ action: 'previewModule', module: 'finance', transitionDate: '2026-09-01' });
  const preview = await previewResponse.json();
  const response = await post({ action: 'importModule', module: 'finance', transitionDate: '2026-09-01', previewToken: preview.previewToken });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.accepted, 0); assert.equal(result.rejected, 3);
  assert.equal(result.state.modules.finance.status, 'error');
  assert.equal(result.state.modules.finance.previewToken, '');
  assert.match(result.message, /сопоставление типов платежей/);
  assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
  assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_finance_snapshots').all(), previous);
  assert.deepEqual(sql.prepare("SELECT payload FROM alfacrm_raw_observations WHERE module='finance' ORDER BY record_id").all().map(row => JSON.parse(row.payload)), [items[1],items[2],items[0]]);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='financial_operations'").get().n, 0);
});

test('an empty finance period remains explicitly blocked until payment direction is verified', async t => {
  const { sql } = await prepareSubscriptions(t);
  mockRecords({ '1/pay/index': [] });
  const previewResponse = await post({ action: 'previewModule', module: 'finance', transitionDate: '2026-09-01' });
  const preview = await previewResponse.json();
  const response = await post({ action: 'importModule', module: 'finance', transitionDate: '2026-09-01', previewToken: preview.previewToken });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.accepted, 0); assert.equal(result.rejected, 0, 'do not fabricate rejected records');
  assert.equal(result.projectionBlocked, true); assert.equal(result.complete, false);
  assert.equal(result.state.modules.finance.status, 'error');
  assert.equal(result.state.modules.finance.previewToken, '');
  assert.match(result.message, /сопоставление типов платежей/);
  assert.equal(sql.prepare('SELECT last_success_at FROM integration_connections').get().last_success_at, previousSuccess);
  assert.equal(sql.prepare("SELECT status FROM alfacrm_import_batches WHERE module='finance'").get().status, 'blocked');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_finance_snapshots').get().n, 0);
});
