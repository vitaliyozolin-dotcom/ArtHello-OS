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
const alfaImportUrl = dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/alfacrm-import.ts'), 'utf8'), { mode: 'strip' }));
const identityUrl = dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/entity-identity.ts'), 'utf8'), { mode: 'strip' }));
const identityDbUrl = dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/entity-identity-db.ts'), 'utf8'), { mode: 'strip' }).replace("'./entity-identity.ts'", JSON.stringify(identityUrl)));
const policy = await import(policyUrl);
globalThis.__alfaCorrectness = { env: {}, actor: null, csrfValid: true, originValid: true };
const harness = globalThis.__alfaCorrectness;
const adapters = {
  'cloudflare:workers': dataModule('export const env=globalThis.__alfaCorrectness.env;'),
  '../../../../db': dataModule('export const ensureCoreTables=async()=>{}; export const readIntegrationCredential=async()=>JSON.stringify({email:"fixture@example.test",apiKey:"synthetic-key",appKey:""}); export const saveIntegrationCredential=async()=>{};'),
  '../../../../lib/access-policy': policyUrl,
  '../../../../lib/entity-identity': identityUrl,
  '../../../../lib/entity-identity-db': identityDbUrl,
  '../../../../lib/integrations': integrationsUrl,
  '../../../../lib/production-auth': dataModule('export const isCanonicalOwnerContext=c=>c?.apiRole==="OWNER"&&c.auth.user.isSystemOwner===true; export const getAuthenticatedRequestContext=async()=>globalThis.__alfaCorrectness.actor; export const verifyAuthenticatedRequestCsrf=()=>{if(!globalThis.__alfaCorrectness.csrfValid)throw new Error("fixture csrf rejected");};'),
  '../../../../lib/request-security': dataModule('export const hasTrustedMutationOrigin=()=>globalThis.__alfaCorrectness.originValid;'),
  '../../../../lib/alfacrm-import': alfaImportUrl,
  '../../../../lib/alfacrm-customer-policy': dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/alfacrm-customer-policy.ts'), 'utf8'), { mode: 'strip' })),
  '../../../../lib/school-schedule-data': dataModule(readFileSync(resolve('lib/school-schedule-data.ts'),'utf8')),
  '../../../../lib/diary-directory': dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/diary-directory.ts'), 'utf8'), { mode: 'strip' })),
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
    id: 'fixture-owner', apiRole, isSystemOwner: apiRole === 'OWNER', canAccessMedical: false,
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
    CREATE TABLE entity_merges(survivor_id TEXT,duplicate_id TEXT UNIQUE,reason TEXT,created_by TEXT);
    CREATE TABLE education_lessons(id TEXT PRIMARY KEY,teacher_entity_id TEXT,substitute_entity_id TEXT);
    CREATE TABLE entity_links(from_entity_id TEXT,to_entity_id TEXT,relation_type TEXT,created_by TEXT,UNIQUE(from_entity_id,to_entity_id,relation_type));
    CREATE TABLE audit_events(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT);
    CREATE TABLE integration_connections(id TEXT,owner_entity_id TEXT,status TEXT,auth_status TEXT,verified_transfer INTEGER,is_enabled INTEGER,last_success_at TEXT,next_sync_at TEXT,error_count INTEGER,updated_at TEXT,received_count INTEGER,accepted_count INTEGER,rejected_count INTEGER);
    INSERT INTO integration_connections(id,owner_entity_id,received_count,accepted_count,rejected_count) VALUES('INT-T-ALFACRM','USER:FIXTURE-OWNER',0,0,0);
    CREATE TABLE user_branch_access(user_id TEXT,branch_id TEXT);
    CREATE TABLE hr_employees(id TEXT PRIMARY KEY,candidate_id TEXT,contract_id TEXT,position_id TEXT,unit TEXT,rate_minor INTEGER,hire_date TEXT,status TEXT,termination_date TEXT,termination_reason TEXT,access_status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE education_programs(id TEXT PRIMARY KEY,title TEXT,version INTEGER,status TEXT,author_entity_id TEXT,methodist_entity_id TEXT,scope TEXT,material_ref TEXT,expected_result TEXT,source_type TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE education_groups(id TEXT PRIMARY KEY,name TEXT,unit_entity_id TEXT,program_id TEXT,teacher_entity_id TEXT,room TEXT,status TEXT);
    CREATE TABLE education_students(id TEXT PRIMARY KEY,child_entity_id TEXT,family_entity_id TEXT,group_id TEXT,cabinet_status TEXT,status TEXT);
    CREATE TABLE sales_leads(id TEXT PRIMARY KEY,first_click_at TEXT,source TEXT,stage TEXT,status TEXT,family_entity_id TEXT,child_entity_id TEXT,data_quality TEXT,updated_at TEXT);
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
  harness.env.ALFACRM_AUTOSYNC_SECRET = '';
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
  const upstream = async (url, init) => {
    const path = new URL(String(url)).pathname.replace('/v2api/', '');
    const body = init?.body ? JSON.parse(init.body) : {};
    observe(path, body, init);
    if (path === 'auth/login') return Response.json({ token: session.token });
    const value = byPath[path] ?? (/^\d+\/study-status\/index$/.test(path) ? [{ id: 9001, name: 'Активен' }] : []);
    const response = typeof value === 'function' ? await value(body, url, init) : Response.json({ items: value, total: value.length });
    const scope = /^(\d+)\/(customer|teacher|group)\/index$/.exec(path);
    if (!scope || !response.ok) return response;
    let payload; try { payload = await response.clone().json(); } catch { return response; }
    if (!Array.isArray(payload.items)) return response;
    payload.items = payload.items.map(item => item && typeof item === 'object' && !Array.isArray(item)
      ? { branch_ids: [Number(scope[1])], ...(scope[2] === 'customer' ? { is_study: 1, study_status_id: 9001 } : {}), ...item } : item);
    return Response.json(payload);
  };
  globalThis.fetch = upstream;
  harness.env.ALFACRM_TRANSPORT = { fetch: async request => upstream(request.url, {
    method: request.method,
    headers: request.headers,
    body: await request.text(),
    redirect: request.redirect,
  }) };
}

async function importSnapshot(module, records, { mappings, token, body = {} } = {}) {
  const state = await route.readState();
  if (mappings) state.branchMappings = mappings;
  if (module === 'groups') { state.modules.staff.status = 'imported'; state.modules.staff.scopeContract = 'source-branch-membership-v1'; }
  if (module === 'subscriptions' || module === 'finance') { state.modules.families.status = 'imported'; state.modules.families.scopeContract = 'source-branch-membership-v1'; }
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

test('customer preview resolves branch status dictionaries without changing business data', async t => {
  const { sql } = await setup(t);
  const before = sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all();
  mockRecords({
    '1/study-status/index': [{ id: 10, name: 'Активен' }, { id: 20, name: 'Завершил' }],
    '2/study-status/index': [{ id: 10, name: 'Открыто' }],
    '1/customer/index': [{ id: 1, study_status_id: 10 }, { id: 2, study_status_id: 20 }],
    '2/customer/index': [{ id: 3, study_status_id: 10 }],
  });
  const response = await post({ action: 'previewCustomers' });
  assert.equal(response.status, 200, await response.clone().text());
  const { customerPreview: report } = await response.json();
  assert.equal(report.byBranch['1'].active, 1);
  assert.equal(report.byBranch['1'].excluded, 1);
  assert.equal(report.byBranch['2'].open, 1);
  assert.equal(report.uniqueIncludedCustomerIds, 2);
  assert.equal(report.applicationReady, false);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM entities').get().n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_raw_observations').get().n, 0);
  assert.deepEqual(sql.prepare('SELECT * FROM system_runtime_state ORDER BY state_key').all(), before);
});

test('family import excludes completed and trial clients and retains open status', async t => {
  const { sql } = await setup(t);
  mockRecords({
    '1/study-status/index': [{ id: 10, name: 'Открыто' }, { id: 20, name: 'Завершил' }, { id: 30, name: 'Пробное занятие' }],
    '1/customer/index': [{ id: 1, name: 'Open pupil', study_status_id: 10 }, { id: 2, name: 'Completed pupil', study_status_id: 20 }, { id: 3, name: 'Trial pupil', study_status_id: 30 }],
  });
  await importSnapshot('families', null, { mappings: { '1': 'BR-SCHOOL' } });
  const cards = sql.prepare("SELECT metadata FROM entities WHERE entity_type='Ребёнок'").all();
  assert.equal(cards.length, 1);
  assert.equal(JSON.parse(cards[0].metadata).customerLifecycle, 'open');
  assert.equal(JSON.parse(cards[0].metadata).alfaStatusName, 'Открыто');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_raw_observations').get().n, 3);
  const ids = sql.prepare('SELECT id FROM entities ORDER BY id').all();
  await importSnapshot('families', null, { mappings: { '1': 'BR-SCHOOL' } });
  assert.deepEqual(sql.prepare('SELECT id FROM entities ORDER BY id').all(), ids);
});

test('unknown customer status stops import before any projection or archival', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '1': [{ id: 1, name: 'Existing pupil' }] }, { mappings: { '1': 'BR-SCHOOL' } });
  const before = sql.prepare('SELECT * FROM entities ORDER BY id').all();
  const observations = sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_raw_observations').get().n;
  mockRecords({ '1/study-status/index': [], '1/customer/index': [{ id: 1, name: 'Existing pupil', study_status_id: null }] });
  await assert.rejects(() => importSnapshot('families', null), /неподтверждённым статусом/);
  assert.deepEqual(sql.prepare('SELECT * FROM entities ORDER BY id').all(), before);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alfacrm_raw_observations').get().n, observations);
});

test('owner defers one exact missing-status customer while reconciling the others', async t => {
  const { sql } = await setup(t);
  await importSnapshot('families', { '2': [{ id: 1, name: 'Deferred pupil' }, { id: 2, name: 'Departed pupil' }] }, { mappings: { '2': 'BR-NURSERY' } });
  const before = sql.prepare("SELECT * FROM entities WHERE json_extract(metadata,'$.alfaCustomerId')='1' ORDER BY id").all();
  const child = before.find(row=>row.entity_type==='Ребёнок').id;
  const family = before.find(row=>row.entity_type==='Семья').id;
  sql.prepare("INSERT INTO education_groups(id,unit_entity_id,status) VALUES('keep-group','BR-NURSERY','Активна')").run();
  sql.prepare("INSERT INTO education_students(id,child_entity_id,family_entity_id,group_id,status) VALUES('STU-A-keep',?,?, 'keep-group','Активен')").run(child,family);
  const membership = sql.prepare('SELECT * FROM education_students').all();
  const current = sql.prepare("SELECT * FROM alfacrm_current_records WHERE record_id='1'").all();
  mockRecords({ '2/customer/index': [{ id: 1, name: 'Deferred pupil', study_status_id: null }, { id: 3, name: 'Current pupil' }] });
  const reportResponse = await post({ action:'previewCustomers' });
  assert.equal(reportResponse.status, 200);
  const report = (await reportResponse.json()).customerPreview;
  assert.equal(report.comparison.archiveIds.length, 1);
  assert.deepEqual(report.archiveBreakdown.map(({ previousStatus, reason, count }) => ({ previousStatus, reason, count })),
    [{ previousStatus:'Активен', reason:'Нет в актуальном составе филиала', count:1 }]);
  const preview = await post({ action:'previewModule', module:'families', deferMissingStatusBranch:'2' });
  assert.equal(preview.status, 200, await preview.clone().text());
  const p = await preview.json();
  assert.equal(p.count, 1);
  assert.equal(p.deferredCount, 1);
  const applied = await post({ action:'importModule', module:'families', deferMissingStatusBranch:'2', previewToken:p.previewToken });
  assert.equal(applied.status, 200, await applied.clone().text());
  const a = await applied.json();
  assert.equal(a.accepted, 1); assert.equal(a.deferredCount, 1);
  assert.deepEqual(sql.prepare("SELECT * FROM entities WHERE json_extract(metadata,'$.alfaCustomerId')='1' ORDER BY id").all(), before);
  assert.deepEqual(sql.prepare("SELECT * FROM alfacrm_current_records WHERE record_id='1'").all(), current);
  assert.deepEqual(sql.prepare('SELECT * FROM education_students').all(), membership);
  assert.equal(sql.prepare("SELECT status FROM entities WHERE entity_type='Семья' AND json_extract(metadata,'$.alfaCustomerId')='2'").get().status, 'Архив');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM entities WHERE json_extract(metadata,'$.alfaCustomerId')='3'").get().n, 3);
  const repeatPreview = await post({ action:'previewModule', module:'families', deferMissingStatusBranch:'2' });
  assert.equal(repeatPreview.status, 200, await repeatPreview.clone().text());
  const repeat = await repeatPreview.json();
  assert.equal((await post({ action:'importModule', module:'families', deferMissingStatusBranch:'2', previewToken:repeat.previewToken })).status, 200);
  mockRecords({ '2/customer/index': [{ id: 4, name: 'Different unknown pupil', study_status_id: null }, { id: 3, name: 'Current pupil' }] });
  assert.equal((await post({ action:'previewModule', module:'families', deferMissingStatusBranch:'2' })).status, 409);
});

test('deferred customer identity and payload are bound to the owner preview', async t => {
  const { sql } = await setup(t);
  const body = { module:'families', deferMissingStatusBranch:'2' };
  mockRecords({ '2/customer/index': [{ id: 1, name:'Unchanged', study_status_id:null }] });
  harness.actor = actor('ADMIN');
  assert.equal((await post({ action:'previewModule', ...body })).status, 403);
  harness.actor = actor();
  const response = await post({ action:'previewModule', ...body });
  assert.equal(response.status, 200, await response.clone().text());
  const p = await response.json();
  assert.equal((await post({ action:'importModule', module:'families', previewToken:p.previewToken })).status, 409);
  mockRecords({ '2/customer/index': [{ id: 2, name:'Replacement', study_status_id:null }] });
  assert.equal((await post({ action:'importModule', ...body, previewToken:p.previewToken })).status, 409);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM entities').get().n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM alfacrm_raw_observations').get().n, 0);
  mockRecords({ '2/customer/index': [{ id:1, name:'One', study_status_id:null }, { id:2, name:'Two', study_status_id:null }] });
  assert.equal((await post({ action:'previewModule', ...body })).status, 409);
});

test('registration creates one linked lead, never an enrolled pupil, across repeat imports', async t => {
  const { sql } = await setup(t);
  mockRecords({ '1/study-status/index': [{ id: 10, name: 'Запись' }],
    '1/customer/index': [{ id: 1, name: 'Lead child', study_status_id: 10, group_ids: [50] }] });
  await importSnapshot('families', null, { mappings: { '1': 'BR-SCHOOL' } });
  const lead = sql.prepare('SELECT * FROM sales_leads').get();
  assert.equal(lead.stage, 'Заявка');
  assert.equal(lead.first_click_at, '', 'source enquiry date is not invented');
  assert.ok(sql.prepare("SELECT 1 FROM entities WHERE id=? AND entity_type='Семья'").get(lead.family_entity_id));
  assert.ok(sql.prepare("SELECT 1 FROM entities WHERE id=? AND entity_type='Ребёнок'").get(lead.child_entity_id));
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM education_students').get().n, 0);
  sql.prepare("UPDATE sales_leads SET stage='Переговоры'").run();
  await importSnapshot('families', null, { mappings: { '1': 'BR-SCHOOL' } });
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sales_leads').get().n, 1);
  assert.equal(sql.prepare('SELECT stage FROM sales_leads').get().stage, 'Переговоры');
});

const previousSuccess = '2026-01-02T03:04:05.000Z';

test('explicit group routing moves school projections without changing source identity or nursery groups', async t => {
  const { sql } = await setup(t);
  mockRecords({ '2/group/index': [{ id: 50, name: '1-й класс 2026-2027' }] });
  const response = await post({ action: 'saveEducationRouting', routing: { '2:50': 'BR-SCHOOL' } });
  assert.equal(response.status, 200, await response.clone().text());
  await importSnapshot('families', { '2': [{ id: 1, name: 'School pupil', groups: [{ id: 50 }] }, { id: 2, name: 'Nursery pupil', groups: [{ id: 51 }] }] });
  const pupils = sql.prepare("SELECT id,source_record_id,scope,metadata FROM entities WHERE entity_type='Ребёнок' ORDER BY source_record_id").all();
  assert.equal(pupils[0].scope, 'School');
  assert.equal(JSON.parse(pupils[0].metadata).remoteBranchId, '2');
  assert.equal(JSON.parse(pupils[0].metadata).localBranchId, 'BR-SCHOOL');
  assert.equal(pupils[1].scope, 'Nursery');
  await importSnapshot('groups', { '2': [{ id: 50, name: '1-й класс 2026-2027' }, { id: 51, name: 'Nursery group' }] });
  const groups=sql.prepare('SELECT name,unit_entity_id FROM education_groups ORDER BY name').all();
  assert.equal(groups.find(row=>row.name.startsWith('1-')).unit_entity_id,'BR-SCHOOL');
  assert.equal(groups.find(row=>row.name==='Nursery group').unit_entity_id,'BR-NURSERY');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM education_students WHERE status='Активен'").get().n,2);
});

test('routing refuses non-owner, unknown groups and destinations outside mapped branches', async t => {
  const { sql } = await setup(t);
  const before = sql.prepare('SELECT * FROM system_runtime_state').all();
  for (const routing of [{ '2:999': 'BR-SCHOOL' }, { '2:50': 'BR-FOREIGN' }, { '99:50': 'BR-SCHOOL' }]) {
    const response = await post({ action: 'saveEducationRouting', routing });
    assert.equal(response.status, 409);
    assert.deepEqual(sql.prepare('SELECT * FROM system_runtime_state').all(), before);
  }
  harness.actor = { ...actor(), apiRole: 'DIRECTOR' };
  assert.equal((await post({ action: 'saveEducationRouting', routing: {} })).status, 403);
});

test('conflicting group destinations cannot partially update families or consume the preview', async t => {
  const { sql, state } = await setup(t);
  state.educationRouting = { '2:50': 'BR-SCHOOL', '2:51': 'BR-NURSERY' };
  await route.persistState(state);
  await assert.rejects(() => importSnapshot('families', { '2': [{ id: 1, name: 'Conflicting pupil', groups: [{ id: 50 }, { id: 51 }] }] }), /разными назначениями/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM entities').get().n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM alfacrm_raw_observations').get().n, 0);
});

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

test('long automatic subscription import keeps its roster-bound preview after 30 minutes', async t => {
  await prepareSubscriptions(t);
  customersForBalance(0);
  const preview = await previewSubscriptions();
  const state = await route.readState();
  state.modules.subscriptions.lastPreviewAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  await route.persistState(state);
  const result = await importSubscriptions(preview.previewToken);
  assert.equal(result.complete, true);

  const expiredState = await route.readState();
  expiredState.modules.subscriptions.status = 'previewed';
  expiredState.modules.subscriptions.previewToken = 'expired-six-hour-preview';
  expiredState.modules.subscriptions.previewSignature = await route.previewSignatureFor('subscriptions', expiredState, { dateFrom: '', dateTo: '' });
  expiredState.modules.subscriptions.lastPreviewAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  expiredState.modules.subscriptions.customerSignature = await route.readState().then(current => current.modules.subscriptions.customerSignature);
  await route.persistState(expiredState);
  const response = await post({ action: 'importModule', module: 'subscriptions', previewToken: 'expired-six-hour-preview' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /6 часов/);
});

test('staff snapshot excludes teacher cards with explicit inactivity or a past end date', async t => {
  const { sql } = await setup(t);
  await importSnapshot('staff', { '1': [
    { id: 11, name: 'Current teacher', e_date: '2030-12-31' },
    { id: 12, name: 'Former teacher', e_date: '2020-01-01' },
    { id: 13, name: 'Inactive teacher', is_active: 0 },
  ] }, { mappings: { '1': 'BR-SCHOOL' } });
  assert.deepEqual(
    sql.prepare("SELECT display_name FROM entities WHERE entity_type='Сотрудник' ORDER BY display_name").all().map(row => row.display_name),
    ['Current teacher'],
  );
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
  const customer = { id: 1, branch_ids: [1], is_study: 1, study_status_id: 9001, balance: 123.45, paid_lesson_count: 7 };
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

test('autosync uses real import, persists cursor and updates existing identities across cycles', async t => {
  const { state, sql } = await setup(t);
  state.modules.staff.status = 'imported'; state.modules.staff.scopeContract = 'source-branch-membership-v1';
  await route.persistState(state);
  harness.env.ALFACRM_AUTOSYNC_SECRET = 'c'.repeat(64);
  const manual = body => route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }));
  assert.equal((await manual({ action:'setAutosync', enabled:true, modules:['staff'] })).status, 200);
  let name = 'Synthetic Teacher';
  mockRecords({'1/teacher/index': () => Response.json({items:[{id:1,name}],total:1})});
  const tick = () => route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm', {
    method:'POST', headers:{'x-arthello-alfa-autosync':'c'.repeat(64)},body:'{}',
  }));
  const due = async () => { const s=await route.readState(); s.autosync.nextAt=0; await route.persistState(s); };
  // Scheduler has no browser session and cannot depend on a fabricated owner login.
  harness.actor = null;
  assert.equal((await (await tick()).json()).outcome, 'pending');
  assert.equal((await (await tick()).json()).outcome, 'not_due');
  await due();
  assert.equal((await (await tick()).json()).outcome, 'complete');
  assert.equal(sql.prepare("SELECT count(*) AS n FROM entities WHERE entity_type='Сотрудник'").get().n, 1);
  name = 'Updated Synthetic Teacher';
  await due(); await tick(); await due(); await tick();
  assert.equal(sql.prepare("SELECT count(*) AS n FROM entities WHERE entity_type='Сотрудник'").get().n, 1);
  assert.equal(sql.prepare("SELECT display_name FROM entities WHERE entity_type='Сотрудник'").get().display_name, name);
  assert.ok((await route.readState()).autosync.lastSuccessAt > 0);
});

test('autosync rejects non-owner configuration, foreign headers, unimported modules and changed branch scope', async t => {
  const { state } = await setup(t);
  harness.env.ALFACRM_AUTOSYNC_SECRET = 'd'.repeat(64);
  const manual = body => route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm', {method:'POST',body:JSON.stringify(body)}));
  harness.actor = actor('DIRECTOR');
  assert.equal((await manual({action:'setAutosync',enabled:true,modules:['staff']})).status,403);
  harness.actor = actor();
  assert.equal((await manual({action:'setAutosync',enabled:true,modules:['staff']})).status,409);
  state.modules.staff.status='imported'; await route.persistState(state);
  assert.equal((await manual({action:'setAutosync',enabled:true,modules:['staff']})).status,409,'legacy imported status does not prove branch reconciliation');
  state.modules.staff.scopeContract='source-branch-membership-v1'; await route.persistState(state);
  assert.equal((await manual({action:'setAutosync',enabled:true,modules:['staff']})).status,200);
  assert.equal((await manual({action:'previewModule',module:'staff'})).status,409);
  const latest=await route.readState(); latest.branchMappings={'1':'BR-NURSERY'}; await route.persistState(latest);
  let calls=0; mockRecords({},()=>{calls++;});
  const result = await route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm', {method:'POST',headers:{'x-arthello-alfa-autosync':'d'.repeat(64)},body:'{}'}));
  assert.equal((await result.json()).outcome,'paused');
  assert.equal(calls,0);
  assert.equal((await route.readState()).autosync.enabled,false);
  assert.equal((await route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm', {method:'POST',headers:{'x-arthello-alfa-autosync':'x'},body:'{}'}))).status,403);
});

test('repeated sync preserves local notes and verified quality until source-owned fields change', async t => {
  const { sql } = await setup(t);
  const records={'1':[{id:1,name:'Synthetic Teacher'}]};
  await importSnapshot('staff',records);
  sql.prepare("UPDATE entities SET data_quality='Проверено',metadata=json_set(metadata,'$.note','Local note') WHERE entity_type='Сотрудник'").run();
  await importSnapshot('staff',records);
  let row=sql.prepare("SELECT data_quality,metadata FROM entities WHERE entity_type='Сотрудник'").get();
  assert.equal(row.data_quality,'Проверено');
  assert.equal(JSON.parse(row.metadata).note,'Local note');
  await importSnapshot('staff',{'1':[{id:1,name:'Changed Source Name'}]});
  row=sql.prepare("SELECT data_quality,metadata FROM entities WHERE entity_type='Сотрудник'").get();
  assert.equal(row.data_quality,'Импортировано из AlfaCRM');
  assert.equal(JSON.parse(row.metadata).note,'Local note');
});

test('stopping and disconnecting autosync clear the advertised next run', async t => {
  const { state, sql } = await setup(t);
  state.modules.staff.status='imported'; await route.persistState(state);
  state.modules.staff.scopeContract='source-branch-membership-v1'; await route.persistState(state);
  harness.env.ALFACRM_AUTOSYNC_SECRET='e'.repeat(64);
  const post=body=>route.POST(new Request('https://arthello.example.test/api/integrations/alfacrm',{method:'POST',body:JSON.stringify(body)}));
  for (const action of ['setAutosync','disconnect']) {
    assert.equal((await post({action:'setAutosync',enabled:true,modules:['staff']})).status,200);
    assert.equal((await post({action,enabled:false})).status,200);
    assert.equal((await route.readState()).autosync.enabled,false);
    assert.equal(sql.prepare("SELECT next_sync_at FROM integration_connections WHERE id='INT-T-ALFACRM'").get().next_sync_at,'');
  }
});

const archiveSource = stripTypeScriptTypes(readFileSync(resolve('app/api/families/archive/route.ts'),'utf8'),{mode:'transform'})
  .replace(/from\s+["']([^"']+)["']/g,(_all,name)=>{assert.ok(adapters[name],name);return `from "${adapters[name]}"`;});
const archiveRoute = await import(dataModule(archiveSource));
const archive = (familyId, archive = true) => archiveRoute.POST(new Request('https://arthello.example.test/api/families/archive',{
 method:'POST',headers:{origin:'https://arthello.example.test'},body:JSON.stringify({familyId,archive}),
}));

test('source branch reconciliation archives phantom copies, keeps real memberships and repeats without duplicates',async t=>{
 const {sql}=await setup(t);
 // Emulate the prior importer accepting copies under every request branch.
 await importSnapshot('families',{'1':[{id:7,name:'Pupil',group_ids:[5]}],'2':[{id:7,name:'Pupil',group_ids:[5]}]});
 await importSnapshot('groups',{'1':[{id:5,name:'School group'}],'2':[{id:5,name:'Nursery group'}]});
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,2);
 const rows=[{id:7,name:'Pupil',branch_ids:[1],is_study:1,group_ids:[5]}];
 for(let n=0;n<2;n++) await importSnapshot('families',{'1':rows,'2':rows});
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья'").get().n,2,'history retained');
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,1);
 assert.equal(sql.prepare("SELECT scope FROM entities WHERE entity_type='Семья' AND status='Активна'").get().scope,'School');
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,1);
 assert.equal(sql.prepare("SELECT count(*) n FROM alfacrm_current_records WHERE module='families' AND active=1").get().n,1);
});

test('unproved membership stops before writes or archival, while distinct source IDs with one phone never merge',async t=>{
 const {sql}=await setup(t);
 await importSnapshot('families',{'1':[{id:1,name:'One',phone:'synthetic'},{id:2,name:'Two',phone:'synthetic'}]});
 const before=sql.prepare('SELECT count(*) n FROM alfacrm_raw_observations').get().n;
 await assert.rejects(importSnapshot('families',{'1':[{id:1,name:'One',branch_ids:null,is_study:1}]}),/филиал/);
 assert.equal(sql.prepare('SELECT count(*) n FROM alfacrm_raw_observations').get().n,before);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,2);
});

test('manual archive retains identity and audit, survives repeated sync, and restore validates source branch',async t=>{
 const {sql}=await setup(t);
 harness.actor=actor('OWNER',['integrations','clients']);
 const rows={'1':[{id:1,name:'Pupil',group_ids:[5]}]};
 await importSnapshot('families',rows);await importSnapshot('groups',{'1':[{id:5,name:'Group'}]});
 const id=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья'").get().id;
 assert.equal((await archive(id)).status,200);
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,0);
 await importSnapshot('families',rows);await importSnapshot('groups',{'1':[{id:5,name:'Group'}]});
 assert.equal(sql.prepare('SELECT status FROM entities WHERE id=?').get(id).status,'Архив');
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,0);
 assert.equal((await archive(id,false)).status,200);
 await importSnapshot('families',rows);
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,1);
 await importSnapshot('families',{'1':[{id:1,name:'Pupil',branch_ids:[2],is_study:1}]});
 assert.equal((await archive(id,false)).status,409);
 assert.equal(sql.prepare("SELECT count(*) n FROM audit_events WHERE action='family.archived'").get().n,1);
});

test('archive enforces role, current branch grants, session, origin and csrf before changing data',async t=>{
 const {sql}=await setup(t);await importSnapshot('families',{'1':[{id:1,name:'Pupil'}]});
 const id=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья'").get().id;
 harness.actor=null;assert.equal((await archive(id)).status,401);
 harness.actor=actor('DEPUTY',['clients']);assert.equal((await archive(id)).status,403);
 harness.actor=actor('DIRECTOR',['clients']);assert.equal((await archive(id)).status,403);
 sql.prepare('INSERT INTO user_branch_access VALUES(?,?)').run('FIXTURE-OWNER','BR-SCHOOL');
 assert.equal((await archive(id)).status,200);
 harness.actor=actor('OWNER',['clients']);harness.csrfValid=false;assert.equal((await archive(id,false)).status,403);
 harness.csrfValid=true;harness.originValid=false;assert.equal((await archive(id,false)).status,403);
 assert.equal(sql.prepare('SELECT status FROM entities WHERE id=?').get(id).status,'Архив');
});

test('groups bind documented teacher_ids only to a current teacher in the same branch, without arbitrary choice',async t=>{
 const {sql}=await setup(t);
 await importSnapshot('staff',{'1':[{id:10,name:'Teacher',branch_ids:[1]}],'2':[{id:10,name:'Teacher',branch_ids:[1]}]});
 await importSnapshot('groups',{'1':[{id:1,name:'One',teacher_ids:[10]},{id:2,name:'Many',teacher_ids:[10,11]}],'2':[{id:1,name:'Wrong branch',teacher_ids:[10]}]});
 const group=sql.prepare("SELECT teacher_entity_id FROM education_groups WHERE name='One'").get();
 assert.ok(group.teacher_entity_id);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE id=? AND scope='School' AND status='Активна'").get(group.teacher_entity_id).n,1);
 for(const name of ['Many','Wrong branch'])assert.equal(sql.prepare('SELECT teacher_entity_id FROM education_groups WHERE name=?').get(name).teacher_entity_id,'');
});

test('dependent imports cannot reuse pre-reconciliation families or teachers',async t=>{
 const {state,sql}=await setup(t);
 for(const moduleKey of ['families','staff','groups'])state.modules[moduleKey].status='imported';
 await route.persistState(state);
 let calls=0;mockRecords({},()=>calls++);
 for(const moduleKey of ['groups','lessons','subscriptions','finance'])assert.equal((await post({action:'previewModule',module:moduleKey})).status,409,moduleKey);
 assert.equal(calls,0);assert.equal(sql.prepare('SELECT count(*) n FROM alfacrm_raw_observations').get().n,0);
});

test('confirmed family identity survives sync across branches and preserves sibling identities', async t => {
 const {sql}=await setup(t);
 const rows={'1':[{id:101,name:'Sibling one',group_ids:[5]}],'2':[{id:102,name:'Sibling two',group_ids:[6]}]};
 await importSnapshot('families',rows);
 const families=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья' ORDER BY scope").all();
 const root=families[0].id,alias=families[1].id;
 sql.prepare('INSERT INTO entity_merges(survivor_id,duplicate_id) VALUES(?,?)').run(root,alias);
 sql.prepare("UPDATE entities SET status='Объединена' WHERE id=?").run(alias);
 await importSnapshot('families',rows);
 assert.equal(sql.prepare('SELECT status FROM entities WHERE id=?').get(alias).status,'Объединена');
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Ребёнок' AND status='Активна'").get().n,2);
 await importSnapshot('groups',{'1':[{id:5,name:'School class'}],'2':[{id:6,name:'Atlas class'}]});
 assert.deepEqual(sql.prepare("SELECT DISTINCT family_entity_id FROM education_students WHERE status='Активен'").all().map(x=>x.family_entity_id),[root]);
 assert.equal(sql.prepare("SELECT count(DISTINCT child_entity_id) n FROM education_students WHERE status='Активен'").get().n,2);
});

test('one Alfa source ID with reciprocal branch membership creates one family, child and employee', async t => {
 const {sql}=await setup(t);
 const pupil={id:501,name:'Same pupil',branch_ids:[1,2],group_ids:[5]};
 const teacher={id:701,name:'Same teacher',branch_ids:[1,2]};
 await importSnapshot('families',{'1':[pupil],'2':[pupil]});
 await importSnapshot('staff',{'1':[teacher],'2':[teacher]});
 for(const type of ['Семья','Ребёнок','Сотрудник']) assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type=? AND status='Активна'").get(type).n,1,type);
 await importSnapshot('groups',{'1':[{id:5,name:'School',teacher_ids:[701]}],'2':[{id:5,name:'Atlas',teacher_ids:[701]}]});
 assert.equal(sql.prepare("SELECT count(DISTINCT child_entity_id) n FROM education_students WHERE status='Активен'").get().n,1);
 assert.equal(sql.prepare("SELECT count(DISTINCT teacher_entity_id) n FROM education_groups WHERE status='Активна'").get().n,1);
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,2);
 await importSnapshot('families',{'1':[pupil],'2':[pupil]});
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,1);
 const family=sql.prepare("SELECT metadata FROM entities WHERE entity_type='Семья' AND status='Активна'").get();
 assert.equal(JSON.parse(family.metadata).branchAssignments.filter(row=>row.active).length,2);
});

const mergeAdapters = Object.fromEntries(Object.entries(adapters).map(([key,value])=>[key.replace('../../../../','../../../'),value]));
mergeAdapters['../../../lib/entity-provenance'] = dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/entity-provenance.ts'),'utf8'),{mode:'strip'}));
const mergeSource = stripTypeScriptTypes(readFileSync(resolve('app/api/entity-merge/route.ts'),'utf8'),{mode:'strip'}).replace(/from\s+["']([^"']+)["']/g,(_all,name)=>{
 assert.ok(mergeAdapters[name],name);return `from "${mergeAdapters[name]}"`;
});
const mergeRoute = await import(dataModule(mergeSource));
const mergeCards=(survivorId,duplicateId)=>mergeRoute.POST(new Request('https://arthello.example.test/api/entity-merge',{method:'POST',headers:{'content-type':'application/json',origin:'https://arthello.example.test'},body:JSON.stringify({survivorId,duplicateId,reason:'Подтверждено по исходным документам'})}));

test('identity confirmation is atomic, branch authorized and cannot merge siblings as a side effect',async t=>{
 const {sql}=await setup(t);
 await importSnapshot('families',{'1':[{id:81,name:'Child one'}],'2':[{id:82,name:'Child two'}]});
 const ids=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья' ORDER BY id").all().map(x=>x.id);
 harness.actor=actor('DIRECTOR',['registry']);
 sql.exec("INSERT INTO user_branch_access VALUES('FIXTURE-OWNER','BR-SCHOOL')");
 assert.equal((await mergeCards(...ids)).status,403);
 harness.actor=actor('OWNER',['registry']);
 harness.csrfValid=false;assert.equal((await mergeCards(...ids)).status,403);harness.csrfValid=true;
 const realBatch=harness.env.DB.batch;
 harness.env.DB.batch=async statements=>realBatch([...statements,harness.env.DB.prepare('INSERT INTO missing_fixture_table VALUES(1)')]);
 assert.equal((await mergeCards(...ids)).status,503);
 assert.equal(sql.prepare('SELECT count(*) n FROM entity_merges').get().n,0);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,2);
 harness.env.DB.batch=realBatch;
 const response=await mergeCards(...ids);assert.equal(response.status,200,await response.clone().text());
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Ребёнок' AND status='Активна'").get().n,2);
 assert.equal((await mergeCards(ids[1],ids[0])).status,409);
 assert.equal(sql.prepare("SELECT count(*) n FROM audit_events WHERE action='entity.merged'").get().n,1);
});

test('canonical family archive survives both branch imports and restore keeps alias identity',async t=>{
 const {sql}=await setup(t);const pupil={id:910,name:'One pupil',branch_ids:[1,2],group_ids:[9]};
 await importSnapshot('families',{'1':[pupil],'2':[pupil]});
 await importSnapshot('groups',{'1':[{id:9,name:'School'}],'2':[{id:9,name:'Atlas'}]});
 const root=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья' AND status='Активна'").get().id;
 harness.actor=actor('OWNER',['clients']);assert.equal((await archive(root)).status,200);
 await importSnapshot('families',{'1':[pupil],'2':[pupil]});
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,0);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Архив'").get().n,1);
 assert.equal((await archive(root,false)).status,200);
 await importSnapshot('families',{'1':[pupil],'2':[pupil]});
 assert.equal(sql.prepare("SELECT count(*) n FROM education_students WHERE status='Активен'").get().n,2);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,1);
});

test('one departing branch cannot archive a person still active in the other branch',async t=>{
 const {sql}=await setup(t);const teacher={id:910,name:'One teacher',branch_ids:[1,2]};
 await importSnapshot('staff',{'1':[teacher],'2':[teacher]});
 const root=sql.prepare("SELECT id FROM entities WHERE entity_type='Сотрудник' AND status='Активна'").get().id;
 const rootBranch=JSON.parse(sql.prepare('SELECT metadata FROM entities WHERE id=?').get(root).metadata).remoteBranchId;
 const other=rootBranch==='1'?'2':'1';
 await importSnapshot('staff',{[rootBranch]:[],[other]:[{...teacher,branch_ids:[Number(other)]}]});
 assert.equal(sql.prepare('SELECT status FROM entities WHERE id=?').get(root).status,'Активна');
 assert.equal(sql.prepare('SELECT status FROM hr_employees WHERE id=?').get(root).status,'Работает');
 assert.equal(JSON.parse(sql.prepare('SELECT metadata FROM entities WHERE id=?').get(root).metadata).branchAssignments.filter(x=>x.active).length,1);
});

test('real family read follows old ID and returns both children, contracts and original financial links',async t=>{
 const {sql}=await setup(t);
 const {drizzle}=await import('drizzle-orm/d1');
 const {getTableConfig}=await import('drizzle-orm/sqlite-core');
 const schema=await import('../db/schema.ts');
 for(const key of ['entityLinks','financialOperations','educationStudents','educationGroups','salesLeads','clientLifecycles','clientAccruals','legalContracts','legalDocumentItems','salesStageEvents','salesTouchpoints']){
  const config=getTableConfig(schema[key]);
  sql.exec(`CREATE TABLE IF NOT EXISTS ${config.name} (${config.columns.map(col=>`${col.name} ${col.getSQLType()}`).join(',')})`);
  const existing=new Set(sql.prepare(`PRAGMA table_info(${config.name})`).all().map(col=>col.name));
  for(const col of config.columns)if(!existing.has(col.name))sql.exec(`ALTER TABLE ${config.name} ADD COLUMN ${col.name} ${col.getSQLType()}`);
 }
 await importSnapshot('families',{'1':[{id:120,name:'Sibling one'}],'2':[{id:121,name:'Sibling two'}]});
 const ids=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья' ORDER BY id").all().map(row=>row.id);
 harness.actor=actor('OWNER',['registry','clients']);assert.equal((await mergeCards(...ids)).status,200);
 for(let i=0;i<ids.length;i++){
  sql.prepare('INSERT INTO financial_operations(id,counterparty_entity_id,amount_minor) VALUES(?,?,?)').run(`OP${i}`,ids[i],100+i);
  sql.prepare('INSERT INTO legal_contracts(id,party_entity_id) VALUES(?,?)').run(`CON${i}`,ids[i]);
 }
 const originalPrepare=harness.env.DB.prepare;
 harness.env.DB.prepare=query=>{
  const wrap=(args=[])=>({...originalPrepare(query).bind(...args),bind(...values){return wrap(values)},raw:async()=>{const stmt=sql.prepare(query);stmt.setReturnArrays(true);return stmt.all(...args)}});
  return wrap();
 };
 harness.orm=drizzle(harness.env.DB);
 const familyAdapters={...mergeAdapters,
  '../../../lib/family-card-state':dataModule(stripTypeScriptTypes(readFileSync(resolve('lib/family-card-state.ts'),'utf8'),{mode:'strip'})),
  '../../../db':dataModule('export const ensureCoreTables=async()=>{};export const getDb=()=>globalThis.__alfaCorrectness.orm;'),
  '../../../db/schema':new URL('../db/schema.ts',import.meta.url).href,
  '../../../lib/request-user':dataModule('export const getRequestUser=()=>globalThis.__alfaCorrectness.actor?.actor;'),
  'drizzle-orm':import.meta.resolve('drizzle-orm'),
 };
 const code=stripTypeScriptTypes(readFileSync(resolve('app/api/families/route.ts'),'utf8'),{mode:'transform'}).replace(/from\s+["']([^"']+)["']/g,(_all,name)=>{
  assert.ok(familyAdapters[name],name);return `from "${familyAdapters[name]}"`;
 });
 const familyRoute=await import(dataModule(code));
 const response=await familyRoute.GET(new Request(`https://arthello.example.test/api/families?id=${ids[1]}`));
 assert.equal(response.status,200,await response.clone().text());
 const body=await response.json();
 assert.equal(body.family.id,ids[0]);
 assert.equal(body.members.filter(row=>row.entityType==='Ребёнок').length,2);
 assert.equal(body.relationship.contracts.length,2);
 assert.deepEqual(body.operations.map(row=>row.counterpartyEntityId).sort(),[...ids].sort());
 assert.deepEqual(body.operations.map(row=>row.amountMinor).sort(),[100,101]);
 harness.actor=actor('DIRECTOR',['clients']);
 sql.exec("INSERT INTO user_branch_access VALUES('FIXTURE-OWNER','BR-SCHOOL')");
 assert.equal((await familyRoute.GET(new Request(`https://arthello.example.test/api/families?id=${ids[0]}`))).status,403);
 sql.exec("INSERT INTO user_branch_access VALUES('FIXTURE-OWNER','BR-NURSERY')");
 assert.equal((await familyRoute.GET(new Request(`https://arthello.example.test/api/families?id=${ids[0]}`))).status,200);
});

test('source alias repair preserves an explicit archive even when another root sorts first',async t=>{
 const {sql}=await setup(t);
 await importSnapshot('families',{'1':[{id:333,name:'One pupil',branch_ids:[1]}],'2':[{id:333,name:'One pupil',branch_ids:[2]}]});
 const ids=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья' ORDER BY id").all().map(row=>row.id);
 harness.actor=actor('OWNER',['clients']);assert.equal((await archive(ids[1])).status,200);
 const pupil={id:333,name:'One pupil',branch_ids:[1,2]};
 await importSnapshot('families',{'1':[pupil],'2':[pupil]});
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,0);
 assert.equal(sql.prepare("SELECT status FROM entities WHERE id=?").get(ids[0]).status,'Архив');
});

test('another source account cannot overwrite existing identities',async t=>{
 const {sql}=await setup(t);
 await importSnapshot('families',{'1':[{id:41,name:'Existing pupil'}]});
 sql.prepare('UPDATE alfacrm_import_batches SET scope=?').run(JSON.stringify({endpoint:'https://other.s20.online'}));
 const before=sql.prepare('SELECT count(*) n FROM alfacrm_raw_observations').get().n;
 await assert.rejects(importSnapshot('families',{'1':[{id:41,name:'Different pupil'}]}),/другим аккаунтом/);
 assert.equal(sql.prepare('SELECT count(*) n FROM alfacrm_raw_observations').get().n,before);
 assert.equal(sql.prepare("SELECT display_name FROM entities WHERE entity_type='Ребёнок'").get().display_name,'Existing pupil');
});

test('existing diary principals defer source alias repair instead of silently changing access bindings',async t=>{
 const {sql}=await setup(t);
 const rows={'1':[{id:444,name:'One pupil',branch_ids:[1]}],'2':[{id:444,name:'One pupil',branch_ids:[2]}]};
 await importSnapshot('families',rows);
 const ids=sql.prepare("SELECT id FROM entities WHERE entity_type='Семья' ORDER BY id").all().map(row=>row.id);
 sql.exec('CREATE TABLE family_system_access(family_entity_id TEXT,principal_entity_id TEXT)');
 sql.prepare('INSERT INTO family_system_access VALUES(?,?)').run(ids[1],'EXISTING-PRINCIPAL');
 const pupil={id:444,name:'One pupil',branch_ids:[1,2]};
 await importSnapshot('families',{'1':[pupil],'2':[pupil]});
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,2);
 assert.equal(sql.prepare('SELECT family_entity_id FROM family_system_access').get().family_entity_id,ids[1]);
 harness.actor=actor('OWNER',['registry']);assert.equal((await mergeCards(...ids)).status,409);
 assert.ok(sql.prepare("SELECT count(*) n FROM audit_events WHERE action='identity.source_alias_deferred'").get().n>0);
});


test('an existing employee login is not silently rekeyed by source identity repair',async t=>{
 const {sql}=await setup(t);
 await importSnapshot('staff',{'1':[{id:555,name:'One teacher',branch_ids:[1]}],'2':[{id:555,name:'One teacher',branch_ids:[2]}]});
 const ids=sql.prepare("SELECT id FROM entities WHERE entity_type='Сотрудник' ORDER BY id").all().map(row=>row.id);
 sql.exec('CREATE TABLE app_users(id TEXT PRIMARY KEY)');sql.prepare('INSERT INTO app_users VALUES(?)').run(ids[1]);
 const teacher={id:555,name:'One teacher',branch_ids:[1,2]};
 await importSnapshot('staff',{'1':[teacher],'2':[teacher]});
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Сотрудник' AND status='Активна'").get().n,2);
 assert.equal(sql.prepare('SELECT id FROM app_users').get().id,ids[1]);
});


test('one pupil source ID cannot merge differently named representatives',async t=>{
 const {sql}=await setup(t);const pupil={id:666,name:'One pupil',branch_ids:[1,2]};
 await importSnapshot('families',{'1':[{...pupil,legal_name:'Guardian one'}],'2':[{...pupil,legal_name:'Guardian two'}]});
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Ребёнок' AND status='Активна'").get().n,1);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Семья' AND status='Активна'").get().n,1);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Клиент' AND status='Активна'").get().n,2);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Клиент' AND data_quality='Требует сверки'").get().n,2);
});

test('adding a branch preserves the first published canonical employee ID',async t=>{
 const {sql}=await setup(t);const {createHash}=await import('node:crypto');
 const ids=['1','2'].map(branch=>({branch,id:`EMP-A-${createHash('sha256').update(`${branch}:777`).digest('hex').slice(0,16).toUpperCase()}`})).sort((a,b)=>b.id.localeCompare(a.id));
 const first=ids[0];
 await importSnapshot('staff',{[first.branch]:[{id:777,name:'Stable teacher',branch_ids:[Number(first.branch)]}]},{mappings:{[first.branch]:first.branch==='1'?'BR-SCHOOL':'BR-NURSERY'}});
 sql.prepare('UPDATE entities SET created_at=? WHERE id=?').run('2020-01-01 00:00:00',first.id);
 const teacher={id:777,name:'Stable teacher',branch_ids:[1,2]};
 await importSnapshot('staff',{'1':[teacher],'2':[teacher]},{mappings:{'1':'BR-SCHOOL','2':'BR-NURSERY'}});
 assert.equal(sql.prepare("SELECT id FROM entities WHERE entity_type='Сотрудник' AND status='Активна'").get().id,first.id);
});

test('a confirmed root survives a separately imported third-branch copy with a smaller ID',async t=>{
 const {sql}=await setup(t);const {createHash}=await import('node:crypto');
 sql.exec("INSERT INTO organization_branches VALUES('BR-THIRD','Third','Активен',3)");
 const state=await route.readState();state.remoteBranches.push({id:'3',name:'Third remote'});await route.persistState(state);
 const hash=(branch,id)=>createHash('sha256').update(`${branch}:${id}`).digest('hex').slice(0,16).toUpperCase();
 let id=1;while(!(hash('3',id)<hash('1',id)&&hash('3',id)<hash('2',id)))id++;
 const teacher={id,name:'Stable teacher',branch_ids:[1,2,3]};
 await importSnapshot('staff',{'1':[teacher],'2':[teacher]},{mappings:{'1':'BR-SCHOOL','2':'BR-NURSERY'}});
 const root=sql.prepare("SELECT id FROM entities WHERE entity_type='Сотрудник' AND status='Активна'").get().id;
 await importSnapshot('staff',{'3':[teacher]},{mappings:{'3':'BR-THIRD'}});
 await importSnapshot('staff',{'1':[teacher],'2':[teacher],'3':[teacher]},{mappings:{'1':'BR-SCHOOL','2':'BR-NURSERY','3':'BR-THIRD'}});
 assert.equal(sql.prepare("SELECT id FROM entities WHERE entity_type='Сотрудник' AND status='Активна'").get().id,root);
 assert.equal(sql.prepare("SELECT count(*) n FROM entities WHERE entity_type='Сотрудник' AND status='Активна'").get().n,1);
});
