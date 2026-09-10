import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import ts from 'typescript';

const temp = mkdtempSync(join(tmpdir(), 'arthello-feedback-'));
after(() => { delete globalThis.__feedbackTest; rmSync(temp, { recursive: true, force: true }); });
function compile(input, output, replacements = {}) {
  let source = readFileSync(new URL(input, import.meta.url), 'utf8');
  for (const [before, after] of Object.entries(replacements)) source = source.replaceAll(before, after);
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(temp, output), result);
}
compile('../lib/developer-feedback-schema.ts', 'schema.mjs');
compile('../lib/developer-feedback.ts', 'service.mjs', { "'./developer-feedback-schema'": "'./schema.mjs'" });
compile('../lib/access-policy.ts', 'policy.mjs');
compile('../lib/request-security.ts', 'security.mjs');
writeFileSync(join(temp, 'env.mjs'), 'export const env={get DB(){return globalThis.__feedbackTest.db},ARTHELLO_PUBLIC_ORIGIN:"https://arthello.example.test"};');
writeFileSync(join(temp, 'catalog.mjs'), 'export const moduleCatalog=[{id:"home"},{id:"education"},{id:"finance"}];');
writeFileSync(join(temp, 'db.mjs'), 'export async function ensureCoreTables(){}');
writeFileSync(join(temp, 'auth.mjs'), `
export async function getAuthenticatedRequestContext(){if(globalThis.__feedbackTest.authFailure)throw Error('private upstream detail');return globalThis.__feedbackTest.context;}
export function isCanonicalOwnerContext(context){return context.canonicalOwner===true;}
export function verifyAuthenticatedRequestCsrf(request,context){if(request.headers.get('x-csrf-token')!==context.csrf)throw Error('csrf');}
`);
compile('../app/api/developer-feedback/route.ts', 'route.mjs', {
  "'cloudflare:workers'": "'./env.mjs'", "'../../../data/test-snapshot'": "'./catalog.mjs'",
  "'../../../db'": "'./db.mjs'", "'../../../lib/access-policy'": "'./policy.mjs'",
  "'../../../lib/developer-feedback'": "'./service.mjs'", "'../../../lib/production-auth'": "'./auth.mjs'",
  "'../../../lib/request-security'": "'./security.mjs'",
});
const service = await import(pathToFileURL(join(temp, 'service.mjs')));
const route = await import(pathToFileURL(join(temp, 'route.mjs')));
const policy = await import(pathToFileURL(join(temp, 'policy.mjs')));
const { developerFeedbackSchema } = await import(pathToFileURL(join(temp, 'schema.mjs')));

function adapter(sqlite) {
  const db = { sqlite, failMatching: null };
  db.prepare = (sql) => {
    let values = [];
    const statement = {
      bind(...next) { values = next; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { if (db.failMatching && sql.includes(db.failMatching)) throw Error('injected persistence failure'); const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    }; return statement;
  };
  db.batch = async (statements) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  return db;
}
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE app_users (id TEXT PRIMARY KEY); INSERT INTO app_users VALUES ('a'),('b'),('owner');");
  return adapter(sqlite);
}
const a = { userId: 'a', name: 'User A', owner: false }, b = { userId: 'b', name: 'User B', owner: false }, owner = { userId: 'owner', name: 'Owner', owner: true };
function payload(values = {}) { return { action: 'create', submissionId: crypto.randomUUID(), kind: 'bug', title: 'Test defect', body: 'Steps and expected result', moduleId: 'education', ...values }; }
function parsed(value = payload()) { return service.parseFeedbackSubmission(value, ['education','home','finance']); }
async function ready(t) { const db = fixture(t); await service.ensureDeveloperFeedbackTables(db); return db; }
function context(role = 'EMPLOYEE', canonicalOwner = false) {
  return { appUserId: role === 'OWNER' ? 'owner' : 'a', appUserName: 'Authenticated name', apiRole: role,
    auth: { user: { apiRole: role, isSystemOwner: role === 'OWNER', mustChangePassword: false, allowedModules: [] } }, csrf: 'valid-csrf', canonicalOwner };
}
function request(body, headers = {}, query = '') {
  return new Request(`https://arthello.example.test/api/developer-feedback${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: 'https://arthello.example.test', 'content-type': 'application/json', 'x-csrf-token': 'valid-csrf', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('SQLite migration reapply preserves prior rows and metadata delta is only the two new tables', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const directory = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0025_').sort()) {
      db.exec(readFileSync(new URL(name, directory), 'utf8').split('--> statement-breakpoint').join('\n'));
    }
    db.exec("INSERT INTO app_users (id,contact_type,contact,display_name,role,invited_by) VALUES ('legacy','email','legacy@example.test','Legacy','OWNER','system')");
    const sql = readFileSync(new URL('0025_developer_feedback.sql', directory), 'utf8');
    assert.deepEqual(sql.split('--> statement-breakpoint').map((s) => s.trim().replace(/;$/, '')).filter(Boolean), developerFeedbackSchema);
    db.exec(sql); db.exec(sql);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM app_users WHERE id='legacy'").get().n, 1);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', directory), 'utf8'));
    const before = JSON.parse(readFileSync(new URL('meta/0024_snapshot.json', directory), 'utf8'));
    const after = JSON.parse(readFileSync(new URL('meta/0025_snapshot.json', directory), 'utf8'));
    assert.equal(journal.entries.at(-1).tag, '0025_developer_feedback');
    assert.equal(after.prevId, before.id);
    assert.deepEqual(Object.keys(after.tables).filter((key) => !before.tables[key]), ['developer_feedback','developer_feedback_events']);
    for (const [key, table] of Object.entries(before.tables)) assert.deepEqual(after.tables[key], table);
    db.exec(readFileSync(new URL('rollbacks/0025_developer_feedback.down.sql', directory), 'utf8'));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM app_users WHERE id='legacy'").get().n, 1);
    db.exec(sql);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});

test('submission validates fields, byte boundary elsewhere, and rejects injected author/status', () => {
  assert.ok(parsed());
  for (const changes of [{ author_user_id: 'b' }, { status: 'done' }, { title: ' ' }, { title: 'x'.repeat(161) }, { body: 'x'.repeat(6001) }, { kind: 'fake' }, { submissionId: 'fake' }, { moduleId: 'https://secret.invalid?token=secret' }]) assert.equal(parsed(payload(changes)), null);
});

test('repeated HTTP delivery produces one persistent record and one audit event', async (t) => {
  const db = await ready(t), data = parsed();
  const first = await service.createFeedback(db, a, data);
  const retry = await service.createFeedback(db, a, data);
  assert.equal(first.id, retry.id); assert.equal(first.author_name, 'User A');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM developer_feedback_events').get().n, 1);
  assert.equal(await service.createFeedback(db, a, { ...data, title: 'Changed after save' }), null);
});

test('same submission UUID from a different user cannot expose or overwrite the first user', async (t) => {
  const db = await ready(t), data = parsed();
  const first = await service.createFeedback(db, a, data), second = await service.createFeedback(db, b, data);
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await service.listFeedback(db, a, false)).items.map((row) => row.author_user_id), ['a']);
  await assert.rejects(service.listFeedback(db, a, true), /denied/);
  assert.equal((await service.listFeedback(db, owner, true)).items.length, 2);
});

test('cursor pagination never mixes authors or skips their older submissions', async (t) => {
  const db = await ready(t);
  for (let i = 0; i < 54; i++) await service.createFeedback(db, i % 17 === 0 ? b : a, parsed());
  await service.createFeedback(db, a, parsed());
  const first = await service.listFeedback(db, a, false);
  const second = await service.listFeedback(db, a, false, first.nextBefore);
  assert.equal(first.items.length, 50); assert.equal(second.items.length, 1);
  assert.equal(new Set([...first.items,...second.items].map((item) => item.id)).size, 51);
  assert.ok([...first.items,...second.items].every((item) => item.author_user_id === 'a'));
});

test('submission and audit insertion are atomic if persistence fails', async (t) => {
  const db = await ready(t); db.failMatching = 'INSERT INTO developer_feedback_events';
  await assert.rejects(service.createFeedback(db, a, parsed()), /injected/);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM developer_feedback').get().n, 0);
});

test('owner status change is atomic and rejects stale revisions without extra history', async (t) => {
  const db = await ready(t), record = await service.createFeedback(db, a, parsed());
  await assert.rejects(service.updateFeedbackStatus(db, a, record.id, 1, 'done'), /denied/);
  assert.equal((await service.updateFeedbackStatus(db, owner, record.id, 1, 'reviewing')).item.revision, 2);
  assert.equal((await service.updateFeedbackStatus(db, owner, record.id, 1, 'done')).kind, 'conflict');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM developer_feedback_events').get().n, 2);
  db.failMatching = 'UPDATE developer_feedback';
  await assert.rejects(service.updateFeedbackStatus(db, owner, record.id, 2, 'done'), /injected/);
  assert.equal(db.sqlite.prepare('SELECT status FROM developer_feedback WHERE id=?').get(record.id).status, 'reviewing');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM developer_feedback_events').get().n, 2);
});

test('incomplete existing schema fails closed', async (t) => {
  const db = fixture(t); db.sqlite.exec('CREATE TABLE developer_feedback(id INTEGER PRIMARY KEY)');
  await assert.rejects(service.ensureDeveloperFeedbackTables(db));
});

test('actual proxy policy permits own feedback for checked-empty module grants and denies invented roles', () => {
  for (const apiRole of policy.API_ROLES.filter((role) => role !== 'OWNER')) for (const method of ['GET','POST']) {
    assert.equal(policy.canAccessApi({ apiRole, isSystemOwner: false, allowedModules: [] }, '/api/developer-feedback', method), true);
  }
  assert.equal(policy.canAccessApi({ apiRole: 'UNKNOWN', isSystemOwner: false }, '/api/developer-feedback', 'GET'), false);
  assert.equal(policy.canAccessApi({ apiRole: 'OWNER', isSystemOwner: false }, '/api/developer-feedback', 'GET'), false);
});

test('HTTP authentication is fail closed and private, regardless of forged role headers', async (t) => {
  globalThis.__feedbackTest = { db: await ready(t), context: null };
  const result = await route.GET(request(undefined, { 'x-arthello-role': 'OWNER', 'x-arthello-system-owner': '1' }));
  assert.equal(result.status, 401); assert.match(result.headers.get('cache-control'), /no-store/);
  globalThis.__feedbackTest.authFailure = true;
  const unavailable = await route.GET(request()); assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private upstream detail/);
});

test('HTTP create requires same origin and CSRF even when called without the proxy', async (t) => {
  globalThis.__feedbackTest = { db: await ready(t), context: context() };
  assert.equal((await route.POST(request(payload(), { origin: 'https://attacker.example.test' }))).status, 403);
  assert.equal((await route.POST(request(payload(), { 'x-csrf-token': 'forged' }))).status, 403);
  assert.equal(globalThis.__feedbackTest.db.sqlite.prepare('SELECT COUNT(*) AS n FROM developer_feedback').get().n, 0);
});

test('HTTP canonical identity is persisted, owner role flag alone never unlocks backlog/status', async (t) => {
  const db = await ready(t); globalThis.__feedbackTest = { db, context: context() };
  const saved = await route.POST(request(payload(), { 'x-arthello-role': 'OWNER' })); assert.equal(saved.status, 201);
  const { item } = await saved.json(); assert.equal(item.author_user_id, 'a'); assert.equal(item.author_name, 'Authenticated name');
  assert.equal((await route.GET(request(undefined, {}, '?scope=all'))).status, 403);
  assert.equal((await route.POST(request({ action: 'setStatus', id: item.id, revision: 1, status: 'done' }))).status, 403);
  globalThis.__feedbackTest.context = context('OWNER', false);
  assert.equal((await route.GET(request(undefined, {}, '?scope=all'))).status, 403);
  globalThis.__feedbackTest.context = context('OWNER', true);
  assert.equal((await route.GET(request(undefined, {}, '?scope=all'))).status, 200);
  assert.equal((await route.POST(request({ action: 'setStatus', id: item.id, revision: 1, status: 'done' }))).status, 200);
});

test('HTTP validates status and payload limits without storing invalid input', async (t) => {
  globalThis.__feedbackTest = { db: await ready(t), context: context('OWNER', true) };
  assert.equal((await route.POST(request({ action: 'setStatus', id: 1, revision: 1, status: '__proto__' }))).status, 400);
  assert.equal((await route.POST(request(payload({ body: '🙂'.repeat(14000) })))).status, 413);
  assert.equal((await route.GET(request(undefined, {}, '?before=-1'))).status, 400);
  assert.equal((await route.POST(request(payload({ author_user_id: 'b' })))).status, 400);
  assert.equal(globalThis.__feedbackTest.db.sqlite.prepare('SELECT COUNT(*) AS n FROM developer_feedback').get().n, 0);
});

test('HTTP must-change-password sessions cannot read or create feedback', async (t) => {
  const auth = context(); auth.auth.user.mustChangePassword = true;
  globalThis.__feedbackTest = { db: await ready(t), context: auth };
  assert.equal((await route.GET(request())).status, 403);
  assert.equal((await route.POST(request(payload()))).status, 403);
});
