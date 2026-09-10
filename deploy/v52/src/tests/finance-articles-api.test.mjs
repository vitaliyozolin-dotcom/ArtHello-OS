import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// Actual route boundary with external services stubbed; transactional persistence
// and dictionary policy are separately executed against SQLite in this suite.
const fixture = globalThis.__financeArticleApiTest = { context: null, csrf: true, ensures: 0 };
const modules = {
  'cloudflare:workers': 'export const env = { DB: { prepare() { throw Error("unexpected database access"); } } };',
  'drizzle-orm': 'export const and=()=>null, eq=()=>null;',
  '../../../db': 'export async function ensureCoreTables(){globalThis.__financeArticleApiTest.ensures++} export function getDb(){return {select(){return {from(){return {where(){return {limit(){return []}}}}}}}}}',
  '../../../db/schema': 'export const auditEvents={},financeCorrections={},financeReconciliationIssues={},financialOperations={},organizationBranches={},tasks={},userBranchAccess={};',
  '../../../lib/production-auth': 'export async function getAuthenticatedRequestContext(){return globalThis.__financeArticleApiTest.context} export function verifyAuthenticatedRequestCsrf(){if(!globalThis.__financeArticleApiTest.csrf)throw Error("private session detail");}',
  '../../../lib/task-access': 'export const resolveTaskAssignment=()=>({ok:false});',
  '../../../lib/task-access-query': 'export const findScopedAutomationTask=()=>null, scopedAutomationTaskResponse=()=>null;',
};
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(modules, specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
  if (specifier.startsWith('../../../lib/finance-')) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { POST } = await import('../app/api/finance-actions/route.ts');
hook.deregister();
const request = (body) => new Request('https://example.invalid/api/finance-actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('anonymous or spoofed role denied before database access', async () => {
  fixture.context = null; fixture.ensures = 0;
  assert.equal((await POST(request({ action: 'createArticle', role: 'OWNER' }))).status, 401);
  assert.equal(fixture.ensures, 0);
});
test('missing CSRF denied without exposing session detail or touching database', async () => {
  fixture.context = { actor: 'synthetic-owner', apiRole: 'OWNER' }; fixture.csrf = false; fixture.ensures = 0;
  const response = await POST(request({ action: 'createArticle' }));
  assert.equal(response.status, 403); assert.equal(fixture.ensures, 0);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private session/);
});
test('non-finance role denied even with valid session and CSRF', async () => {
  fixture.context = { actor: 'synthetic-teacher', apiRole: 'TEACHER' }; fixture.csrf = true; fixture.ensures = 0;
  assert.equal((await POST(request({ action: 'classifyOperation' }))).status, 403);
  assert.equal(fixture.ensures, 0);
});
test('missing operation is 404; unknown action is 400; fixed catalog rejects mutation', async () => {
  fixture.context = { actor: 'synthetic-owner', apiRole: 'OWNER' }; fixture.csrf = true;
  assert.equal((await POST(request({ action: 'classifyOperation', operationId: 'missing' }))).status, 404);
  assert.equal((await POST(request({ action: 'unknown' }))).status, 400);
  const response = await POST(request({ action: 'createArticle' }));
  assert.equal(response.status, 409);
  assert.match(JSON.stringify(await response.json()), /Справочник зафиксирован/);
});
