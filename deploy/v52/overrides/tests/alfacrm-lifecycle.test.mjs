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
globalThis.__alfaLifecycle = { env: {}, actor: null, csrfValid: true, originValid: true };
const harness = globalThis.__alfaLifecycle;
const adapters = {
  'cloudflare:workers': dataModule('export const env=globalThis.__alfaLifecycle.env;'),
  '../../../../db': dataModule('export const ensureCoreTables=async()=>{}; export const readIntegrationCredential=async()=>JSON.stringify({email:"fixture@example.test",apiKey:"synthetic-key",appKey:""}); export const saveIntegrationCredential=async()=>{};'),
  '../../../../lib/access-policy': policyUrl,
  '../../../../lib/integrations': integrationsUrl,
  '../../../../lib/production-auth': dataModule('export const getAuthenticatedRequestContext=async()=>globalThis.__alfaLifecycle.actor; export const verifyAuthenticatedRequestCsrf=()=>{if(!globalThis.__alfaLifecycle.csrfValid)throw new Error("fixture csrf rejected");};'),
  '../../../../lib/request-security': dataModule('export const hasTrustedMutationOrigin=()=>globalThis.__alfaLifecycle.originValid;'),
};
let source = stripTypeScriptTypes(readFileSync(resolve('app/api/integrations/alfacrm/route.ts'), 'utf8'), { mode: 'transform' })
  .replace(/from\s+["']([^"']+)["']/g, (_all, name) => {
    assert.ok(adapters[name], `Unexpected dependency ${name}: update the explicit fixture adapter`);
    return `from "${adapters[name]}"`;
  });
source += '\nexport {defaultState,persistState,readState,ensureAlfaTables,upsertRawRecords,canonicalizeFamilies,canonicalizeStaff,canonicalizeGroups,canonicalizeFinance,importModule,previewModule,previewSignatureFor,normalizeEndpoint,alfaFetch,fetchPaged};\n//# sourceURL=alfacrm-route-fixture.mjs';
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

async function captureRuntimeBindings(optionalFlag) {
  const fixture = {
    options: null,
    process: {
      env: { INTEGRATION_CREDENTIALS_KEY: 'synthetic-runtime-key-32-characters-only', ...optionalFlag },
      cwd: () => '/fixture/application',
      once: () => {},
      exit: () => { throw new Error('Runtime fixture unexpectedly attempted process exit'); },
    },
  };
  globalThis.__alfaRuntimeBindingFixture = fixture;
  const runId = crypto.randomUUID();
  const adapter = text => dataModule(`${text}\n// fixture instance ${runId}`);
  const runtimeAdapters = {
    miniflare: adapter('export class Miniflare { constructor(options) { globalThis.__alfaRuntimeBindingFixture.options=options; this.ready=Promise.resolve("http://fixture.invalid"); } async dispose() {} } export class Log {} export const LogLevel={INFO:"info"};'),
    'node:fs': adapter('export const readFileSync=()=>{throw new Error("Runtime fixture attempted filesystem secret access");};'),
    'node:process': adapter('export default globalThis.__alfaRuntimeBindingFixture.process;'),
    'node:crypto': adapter('export const randomBytes=()=>{throw new Error("Disabled autosync unexpectedly requested a secret");};'),
    './tochka-transport.mjs': adapter('export const createTochkaTransport=()=>({fixture:true});'),
    './tochka-autosync-timer.mjs': adapter('export const startTochkaAutosyncTimer=({enabled,secret})=>{if(enabled!==false||secret!=="")throw new Error("Runtime fixture must keep Tochka autosync disabled");return {stop(){}};};'),
    './backup-transport.mjs': adapter('export const createBackupTransport=()=>({fixture:"closed-backup-transport",fetch(){throw new Error("Runtime fixture attempted a backup operation");}});'),
  };
  const runtimeSource = readFileSync(resolve('production/runtime-server.mjs'), 'utf8')
    .replace(/from\s+["']([^"']+)["']/g, (_all, name) => {
      assert.ok(runtimeAdapters[name], `Unexpected runtime dependency ${name}`);
      return `from "${runtimeAdapters[name]}"`;
    });
  await import(adapter(`const console={log:()=>{}};\n${runtimeSource}\n//# sourceURL=alfacrm-runtime-fixture.mjs`));
  assert.ok(fixture.options, 'runtime instantiated Miniflare with the captured worker configuration');
  return fixture.options.bindings;
}

test('production runtime passes a closed AlfaCRM import binding when its environment flag is absent', async () => {
  const bindings = await captureRuntimeBindings({});
  assert.equal(bindings.ALFACRM_IMPORT_ENABLED, '');
});

test('production runtime forwards an explicitly enabled AlfaCRM import binding into the worker', async () => {
  const bindings = await captureRuntimeBindings({ ALFACRM_IMPORT_ENABLED: 'true' });
  assert.equal(bindings.ALFACRM_IMPORT_ENABLED, 'true');
});

test('assigned DIRECTOR and INTEGRATIONS can reach POST; reader assignments do not grant writes', async t => {
  await setup(t);
  for (const apiRole of ['DIRECTOR', 'INTEGRATIONS']) {
    const context = { apiRole, isSystemOwner: false, allowedModules: ['integrations'] };
    assert.equal(policy.canAccessApi(context, '/api/integrations/alfacrm', 'POST'), true, apiRole);
    harness.actor = actor(apiRole);
    assert.equal((await post()).status, 400, `${apiRole} passed guards and reached unknown-action validation`);
    assert.equal(policy.canAccessApi({ ...context, allowedModules: [] }, '/api/integrations/alfacrm', 'POST'), false);
    harness.actor = actor(apiRole, []);
    assert.equal((await post()).status, 403, `${apiRole} requires assigned section`);
  }
  for (const apiRole of ['TEACHER', 'FINANCE', 'ACCOUNTING', 'EMPLOYEE']) {
    const context = { apiRole, isSystemOwner: false, allowedModules: ['integrations'] };
    assert.equal(policy.canAccessApi(context, '/api/integrations/alfacrm', 'GET'), true, `${apiRole} assigned read`);
    assert.equal(policy.canAccessApi(context, '/api/integrations/alfacrm', 'POST'), false, `${apiRole} no mutation`);
    harness.actor = actor(apiRole);
    assert.equal((await post()).status, 403);
  }
});

test('authentication, origin, CSRF and live import release gate remain enforced', async t => {
  await setup(t);
  harness.actor = null; assert.equal((await post()).status, 401);
  harness.actor = actor(); harness.originValid = false; assert.equal((await post()).status, 403);
  harness.originValid = true; harness.csrfValid = false; assert.equal((await post()).status, 403);
  harness.csrfValid = true; harness.env.ALFACRM_IMPORT_ENABLED = '';
  let fetches = 0; mockRecords({}, () => { fetches += 1; });
  assert.equal((await post({ action: 'importModule', module: 'families', previewToken: 'no-preview' })).status, 409);
  assert.equal(fetches, 0, 'closed import gate cannot contact CRM or write a snapshot');
});

test('integration assignment and owner-only credential boundaries remain independent from module access', async t => {
  const { sql } = await setup(t);
  harness.actor = actor('INTEGRATIONS');
  sql.prepare("UPDATE integration_connections SET owner_entity_id='USER:SOMEONE-ELSE'").run();
  assert.equal((await post()).status, 403);
  sql.prepare("UPDATE integration_connections SET owner_entity_id='ROLE:INTEGRATIONS'").run();
  assert.equal((await post()).status, 400);
  let fetches = 0; mockRecords({}, () => { fetches += 1; });
  for (const action of ['connect', 'disconnect', 'saveBranchMappings']) assert.equal((await post({ action })).status, 403, action);
  assert.equal(fetches, 0);
});

test('operators cannot preview data outside their branch grants and inactive mappings fail closed', async t => {
  const { sql } = await setup(t);
  harness.actor = actor('INTEGRATIONS');
  sql.prepare("INSERT INTO user_branch_access VALUES('FIXTURE-OWNER','BR-SCHOOL')").run();
  let fetches = 0; mockRecords({}, () => { fetches += 1; });
  assert.notEqual((await post({ action: 'previewModule', module: 'families' })).status, 200);
  assert.equal(fetches, 0);
  harness.actor = actor();
  sql.prepare("UPDATE organization_branches SET status='Архив' WHERE id='BR-NURSERY'").run();
  assert.notEqual((await post({ action: 'previewModule', module: 'families' })).status, 200);
  assert.equal(fetches, 0);
});

test('changed and identical re-imports append immutable observations and preserve legacy raw', async t => {
  const { sql } = await setup(t);
  sql.prepare('INSERT INTO alfacrm_import_records(remote_branch_id,module,record_id,payload,payload_hash,imported_at) VALUES(?,?,?,?,?,?)')
    .run('1', 'families', 'legacy', '{"id":"legacy","name":"Legacy original"}', 'legacy-hash', '2026-01-01');
  const legacyBefore = sql.prepare('SELECT * FROM alfacrm_import_records').all();
  const first = { remoteBranchId: '1', item: { id: 101, name: 'Before' } };
  const changed = { remoteBranchId: '1', item: { id: 101, name: 'After' } };
  await route.upsertRawRecords('families', [first]);
  const original = sql.prepare("SELECT * FROM alfacrm_raw_observations WHERE record_id='101'").get();
  assert.ok(original?.id);
  await route.upsertRawRecords('families', [changed]);
  await route.upsertRawRecords('families', [changed]);
  const observations = sql.prepare("SELECT * FROM alfacrm_raw_observations WHERE record_id='101' ORDER BY rowid").all();
  assert.equal(observations.length, 3, 'each observed import has its own immutable row even if payload unchanged');
  assert.deepEqual(observations[0], original, 'first observation is byte-for-byte unchanged');
  assert.equal(new Set(observations.map(row => row.id)).size, 3);
  assert.deepEqual(observations.map(row => JSON.parse(row.payload).name), ['Before', 'After', 'After']);
  assert.notEqual(observations[0].payload_hash, observations[1].payload_hash);
  assert.equal(observations[1].payload_hash, observations[2].payload_hash);
  const current = sql.prepare("SELECT * FROM alfacrm_current_records WHERE module='families' AND record_id='101'").get();
  assert.equal(current.observation_id, observations[2].id);
  assert.equal(current.active, 1);
  assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_import_records').all(), legacyBefore);
  assert.throws(() => sql.prepare("UPDATE alfacrm_raw_observations SET payload='{}' WHERE id=?").run(original.id));
  assert.throws(() => sql.prepare('DELETE FROM alfacrm_raw_observations WHERE id=?').run(original.id));
});

test('legacy source records block live import until a verified migration and remain untouched', async t => {
  const { sql, state } = await setup(t);
  sql.prepare('INSERT INTO alfacrm_import_records(remote_branch_id,module,record_id,payload,payload_hash,imported_at) VALUES(?,?,?,?,?,?)')
    .run('1', 'families', 'legacy', '{"id":"legacy","name":"Original source"}', 'legacy-hash', '2026-01-01');
  const before = sql.prepare('SELECT * FROM alfacrm_import_records').all();
  state.modules.families.previewToken = 'legacy-preview';
  state.modules.families.previewSignature = await route.previewSignatureFor('families', state, { dateFrom: '', dateTo: '' });
  await route.persistState(state);
  let fetches = 0; mockRecords({}, () => { fetches += 1; });
  const response = await post({ action: 'importModule', module: 'families', previewToken: 'legacy-preview' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /прежний формат|перенос источников/i);
  assert.equal(fetches, 0);
  assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_import_records').all(), before);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_raw_observations').get().n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM entities').get().n, 0);
});

test('completed family snapshot archives only departed pupils in the selected branch', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', {
    '1': [{ id: 101, name: 'Departing pupil' }, { id: 102, name: 'Staying pupil' }],
    '2': [{ id: 201, name: 'Other branch pupil' }],
  });
  const previousRaw = sql.prepare('SELECT * FROM alfacrm_raw_observations ORDER BY rowid').all();
  sql.prepare("INSERT INTO entities(id,entity_type,display_name,status,source_system,source_record_id,metadata) VALUES('LOCAL-CHILD','Ребёнок','Local child','Активна','MANUAL','student:1:999','{}')").run();
  await importSnapshot('families', { '1': [{ id: 102, name: 'Staying pupil updated' }] }, { mappings: { '1': 'BR-SCHOOL' } });
  const pupils = sql.prepare("SELECT source_record_id,display_name,status FROM entities WHERE entity_type='Ребёнок' ORDER BY source_record_id").all();
  assert.notEqual(pupils.find(row => row.source_record_id === 'student:1:101').status, 'Активна');
  assert.equal(pupils.find(row => row.source_record_id === 'student:1:102').status, 'Активна');
  assert.equal(pupils.find(row => row.source_record_id === 'student:2:201').status, 'Активна');
  assert.equal(pupils.find(row => row.source_record_id === 'student:1:999').status, 'Активна');
  assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_raw_observations ORDER BY rowid LIMIT 3').all(), previousRaw);
  assert.equal(sql.prepare("SELECT active FROM alfacrm_current_records WHERE module='families' AND remote_branch_id='1' AND record_id='101'").get().active, 0);
  assert.equal(sql.prepare("SELECT active FROM alfacrm_current_records WHERE module='families' AND remote_branch_id='2' AND record_id='201'").get().active, 1);
  const lineage = sql.prepare(`SELECT l.projection_id,o.record_id,o.payload,b.module,b.status
    FROM alfacrm_projection_lineage l JOIN alfacrm_raw_observations o ON o.id=l.observation_id
    JOIN alfacrm_import_batches b ON b.id=l.batch_id
    JOIN entities e ON e.id=l.projection_id
    WHERE l.projection_table='entities' AND e.source_record_id='student:1:102'`).get();
  assert.ok(lineage, 'materialized pupil identifies the exact raw observation and batch');
  assert.equal(lineage.record_id, '102');
  assert.equal(JSON.parse(lineage.payload).name, 'Staying pupil updated');
  assert.equal(lineage.module, 'families');
});

test('completed empty staff snapshot archives selected imported staff without granting or revoking login', async t => {
  const { sql } = await setup(t);
  await importSnapshot('staff', { '1': [{ id: 11, name: 'School teacher' }], '2': [{ id: 21, name: 'Nursery teacher' }] });
  const employee = sql.prepare("SELECT id FROM entities WHERE source_record_id='teacher:1:11'").get();
  sql.prepare("UPDATE hr_employees SET access_status='Ранее выданный доступ' WHERE id=?").run(employee.id);
  await importSnapshot('staff', { '1': [] }, { mappings: { '1': 'BR-SCHOOL' } });
  assert.notEqual(sql.prepare('SELECT status FROM entities WHERE id=?').get(employee.id).status, 'Активна');
  const hr = sql.prepare('SELECT status,access_status FROM hr_employees WHERE id=?').get(employee.id);
  assert.notEqual(hr.status, 'Работает');
  assert.equal(hr.access_status, 'Ранее выданный доступ', 'CRM does not administer login access');
  assert.equal(sql.prepare("SELECT status FROM entities WHERE source_record_id='teacher:2:21'").get().status, 'Активна');
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('app_users','user_system_access','production_auth_credentials')").get().n, 0);
});

test('completed group snapshot archives selected missing groups and preserves unrelated groups', async t => {
  const { sql } = await setup(t);
  await importSnapshot('groups', { '1': [{ id: 11, name: 'School class' }], '2': [{ id: 21, name: 'Nursery group' }] });
  sql.prepare("INSERT INTO education_groups(id,name,unit_entity_id,status) VALUES('LOCAL-GROUP','Local group','BR-SCHOOL','Активна')").run();
  await importSnapshot('groups', { '1': [] }, { mappings: { '1': 'BR-SCHOOL' } });
  assert.notEqual(sql.prepare("SELECT status FROM education_groups WHERE name='School class'").get().status, 'Активна');
  assert.equal(sql.prepare("SELECT status FROM education_groups WHERE name='Nursery group'").get().status, 'Активна');
  assert.equal(sql.prepare("SELECT status FROM education_groups WHERE id='LOCAL-GROUP'").get().status, 'Активна');
});

test('groups before families creates membership when families arrive, then retires ceased membership', async t => {
  const { sql } = await setup(t);
  await importSnapshot('groups', { '1': [{ id: 11, name: 'First group' }, { id: 12, name: 'Second group' }] }, { mappings: { '1': 'BR-SCHOOL' } });
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM education_students').get().n, 0);
  await importSnapshot('families', { '1': [{ id: 101, name: 'Pupil', groups: [{ id: 11 }] }] });
  const memberships = () => sql.prepare('SELECT s.id,g.name,s.status,s.cabinet_status FROM education_students s JOIN education_groups g ON g.id=s.group_id ORDER BY g.name').all();
  assert.deepEqual(memberships().map(row => [row.name, row.status]), [['First group', 'Активен']]);
  assert.equal(memberships()[0].cabinet_status, 'Доступ не выдан');
  await importSnapshot('families', { '1': [{ id: 101, name: 'Pupil', groups: [{ id: 12 }] }] });
  assert.notEqual(memberships().find(row => row.name === 'First group').status, 'Активен');
  assert.equal(memberships().find(row => row.name === 'Second group').status, 'Активен');
  await importSnapshot('families', { '1': [] });
  assert.equal(memberships().filter(row => row.status === 'Активен').length, 0);
});

test('families before groups recovers membership when groups arrive and missing groups retire it', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': [{ id: 101, name: 'Pupil', group_ids: [11] }] }, { mappings: { '1': 'BR-SCHOOL' } });
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM education_students').get().n, 0);
  await importSnapshot('groups', { '1': [{ id: 11, name: 'Class' }] });
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM education_students WHERE status='Активен'").get().n, 1);
  await importSnapshot('groups', { '1': [] });
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM education_students WHERE status='Активен'").get().n, 0);
});

test('incomplete second branch fetch cannot retire first-branch pupils or append a partial snapshot', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': [{ id: 101, name: 'School pupil' }], '2': [{ id: 201, name: 'Nursery pupil' }] });
  const beforeEntities = sql.prepare('SELECT * FROM entities ORDER BY id').all();
  const beforeRaw = sql.prepare('SELECT * FROM alfacrm_raw_observations ORDER BY rowid').all();
  await assert.rejects(() => importSnapshot('families', {
    '1': [], '2': () => Response.json({ message: 'fixture upstream failure' }, { status: 503 }),
  }));
  assert.deepEqual(sql.prepare('SELECT * FROM entities ORDER BY id').all(), beforeEntities);
  assert.deepEqual(sql.prepare('SELECT * FROM alfacrm_raw_observations ORDER BY rowid').all(), beforeRaw);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_current_records WHERE active=0').get().n, 0);
});

test('rejected canonical records cannot be interpreted as proof that existing pupils departed', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': [{ id: 101, name: 'Existing pupil' }] }, { mappings: { '1': 'BR-SCHOOL' } });
  const before = sql.prepare("SELECT * FROM entities WHERE entity_type='Ребёнок'").all();
  const result = await importSnapshot('families', { '1': [{ id: 999 }] });
  assert.equal(result.rejected, 1);
  assert.deepEqual(sql.prepare("SELECT * FROM entities WHERE entity_type='Ребёнок'").all(), before);
  assert.equal(sql.prepare("SELECT active FROM alfacrm_current_records WHERE module='families' AND record_id='101'").get().active, 1);
});

for (const [label, payload] of [
  ['unexpected response shape', { success: true }],
  ['non-record page items', { items: [null, 'bad'], total: 2 }],
  ['short page before declared total', { items: [{ id: 1 }], total: 2 }],
  ['empty page before declared total', { items: [], total: 1 }],
  ['invalid declared total', { items: [], total: 'invalid' }],
  ['negative declared total', { items: [], total: -1 }],
  ['fractional declared total', { items: [], total: 0.5 }],
  ['records exceeding declared total', { items: [{ id: 1 }], total: 0 }],
]) {
  test(`malformed or incomplete pagination is rejected: ${label}`, async t => {
    await setup(t);
    mockRecords({ '1/customer/index': () => Response.json(payload) });
    await assert.rejects(() => route.fetchPaged(session, '1/customer/index', {}));
  });
}

test('repeated nonterminal page is rejected instead of being called a complete snapshot', async t => {
  await setup(t);
  const page = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, name: `Pupil ${i + 1}` }));
  let requests = 0;
  mockRecords({ '1/customer/index': () => { requests += 1; return Response.json({ items: page, total: 1000 }); } });
  await assert.rejects(() => route.fetchPaged(session, '1/customer/index', {}));
  assert.equal(requests, 2);
});

test('overlapping record IDs across different pages cannot satisfy the total count', async t => {
  await setup(t);
  mockRecords({ '1/customer/index': body => Response.json({ items: body.page === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }, { id: 3 }], total: 4 }) });
  await assert.rejects(() => route.fetchPaged(session, '1/customer/index', {}));
});

test('complete multiple-page response preserves every record and stops at the declared total', async t => {
  await setup(t);
  const seenPages = [];
  mockRecords({ '1/customer/index': body => {
    seenPages.push(body.page);
    return Response.json({ items: body.page === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: i + 1 })) : [{ id: 501 }], total: 501 });
  } });
  const rows = await route.fetchPaged(session, '1/customer/index', {});
  assert.equal(rows.length, 501); assert.equal(new Set(rows.map(row => row.id)).size, 501);
  assert.deepEqual(seenPages, [0, 1]);
});

test('subscription continuation retains preview only until completion and rejects exhausted replay', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': Array.from({ length: 16 }, (_, i) => ({ id: i + 1, name: `Pupil ${i + 1}` })) }, { mappings: { '1': 'BR-SCHOOL' } });
  mockRecords({ '1/customer-tariff/index': (_body, url) => {
    const customerId = new URL(String(url)).searchParams.get('customer_id');
    return Response.json({ items: [{ id: Number(customerId), customer_id: customerId, balance: 1 }], total: 1 });
  } });
  const previewResponse = await route.previewModule(actor(), { module: 'subscriptions' });
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
  const preview = await previewResponse.json();
  const token = preview.previewToken;
  const firstResponse = await route.importModule(actor(), { module: 'subscriptions', previewToken: token });
  assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
  const first = await firstResponse.json();
  assert.equal(first.complete, false);
  assert.equal(first.state.modules.subscriptions.previewToken, token);
  assert.equal(first.state.modules.subscriptions.cursor, 15);
  const finalResponse = await route.importModule(actor(), { module: 'subscriptions', previewToken: token });
  assert.equal(finalResponse.status, 200, await finalResponse.clone().text());
  const final = await finalResponse.json();
  assert.equal(final.complete, true);
  assert.equal(final.state.modules.subscriptions.previewToken, '');
  assert.equal(final.state.modules.subscriptions.previewSignature, '');
  assert.equal(final.state.modules.subscriptions.cursor, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_tariffs').get().n, 16);
  let fetches = 0; mockRecords({}, () => { fetches += 1; });
  assert.equal((await route.importModule(actor(), { module: 'subscriptions', previewToken: token })).status, 409);
  assert.equal(fetches, 0);
});

test('changing the family roster invalidates an existing subscription preview', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': [{ id: 1, name: 'First pupil' }] }, { mappings: { '1': 'BR-SCHOOL' } });
  const preview = await (await route.previewModule(actor(), { module: 'subscriptions' })).json();
  await importSnapshot('families', { '1': [{ id: 2, name: 'Different pupil' }] });
  let tariffReads = 0;
  mockRecords({}, path => { if (path.includes('customer-tariff')) tariffReads += 1; });
  const response = await route.importModule(actor(), { module: 'subscriptions', previewToken: preview.previewToken });
  assert.equal(response.status, 409);
  assert.equal(tariffReads, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_customer_tariffs').get().n, 0);
});

test('concurrent POST imports consume one preview exactly once', async t => {
  const { sql, state } = await setup(t);
  state.branchMappings = { '1': 'BR-SCHOOL' };
  await route.persistState(state);
  mockRecords({ '1/customer/index': [{ id: 101, name: 'Pupil' }] });
  const previewResponse = await post({ action: 'previewModule', module: 'families' });
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
  const preview = await previewResponse.json();
  const results = await Promise.all([
    post({ action: 'importModule', module: 'families', previewToken: preview.previewToken }),
    post({ action: 'importModule', module: 'families', previewToken: preview.previewToken }),
  ]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM alfacrm_raw_observations WHERE module='families'").get().n, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM entities WHERE entity_type='Ребёнок'").get().n, 1);
});

test('CRM finance remains isolated from bank DDS and refund type remains an outflow', async t => {
  const { sql, state } = await setup(t);
  const rows = [{ remoteBranchId: '1', item: { id: 1, date: '2026-09-01', income: 100, pay_type_id: 5 } }];
  await route.upsertRawRecords('finance', rows);
  await route.canonicalizeFinance(rows, state, { dateFrom: '2026-09-01', dateTo: '2026-09-07' });
  const row = sql.prepare('SELECT direction,amount_minor FROM alfacrm_finance_snapshots').get();
  assert.equal(row.direction, 'Списание'); assert.equal(row.amount_minor, 10000);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='financial_operations'").get().n, 0);
});

test('AlfaCRM endpoint allowlist and redirect rejection preserve transport boundaries', async t => {
  await setup(t);
  for (const endpoint of ['https://127.0.0.1', 'https://evil.example', 'https://tenant.s20.online/other', 'https://u:p@tenant.s20.online', 'http://tenant.s20.online', 'https://tenant.s20.online.evil.example']) assert.throws(() => route.normalizeEndpoint(endpoint));
  assert.equal(route.normalizeEndpoint('https://tenant.s20.online'), 'https://tenant.s20.online');
  let observed;
  globalThis.fetch = async (_url, init) => { observed = init; return Response.json({ items: [] }); };
  await route.alfaFetch('https://tenant.s20.online/v2api/branch/index', { headers: { 'X-ALFACRM-TOKEN': 'fixture-token' } });
  assert.equal(observed.redirect, 'error');
});
