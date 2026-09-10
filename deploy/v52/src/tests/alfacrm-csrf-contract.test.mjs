import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

const temp = mkdtempSync(join(tmpdir(), 'arthello-alfa-csrf-'));
after(() => rmSync(temp, { recursive: true, force: true }));

function compile(input, output, replacements = {}) {
  let source = readFileSync(new URL(input, import.meta.url), 'utf8');
  for (const [before, replacement] of Object.entries(replacements)) {
    assert.equal(source.split(before).length, 2, `unique import: ${before}`);
    source = source.replace(before, replacement);
  }
  writeFileSync(join(temp, output), stripTypeScriptTypes(source, { mode: 'transform' }));
}

// The real server cookie writer, CSRF verifier and origin guard run unchanged.
// Importing auth has no DB access; this fixture never authenticates against D1.
writeFileSync(join(temp, 'env.mjs'), 'export const env = {};');
compile('../lib/access-policy.ts', 'policy.mjs');
compile('../lib/production-auth.ts', 'auth.mjs', {
  '"cloudflare:workers"': '"./env.mjs"',
  '"./access-policy"': '"./policy.mjs"',
});
compile('../lib/request-security.ts', 'security.mjs');
const auth = await import(pathToFileURL(join(temp, 'auth.mjs')));
const { hasTrustedMutationOrigin } = await import(pathToFileURL(join(temp, 'security.mjs')));

// Execute the component's actual request-producing closure and cookie reader.
// Only React state callbacks, document.cookie and the network are supplied by
// the fixture; the method, headers, credentials and body come from the source.
const wizard = readFileSync(new URL('../app/components/AlfaCrmSetupWizard.tsx', import.meta.url), 'utf8');
const start = '  async function post(';
const end = '\n  const state = payload.state;';
const cookieStart = 'function readCookie(name: string)';
assert.equal(wizard.split(start).length, 2, 'one Alfa mutation sender');
assert.equal(wizard.split(end).length, 2, 'one end of the mutation sender');
assert.equal(wizard.split(cookieStart).length, 2, 'one cookie reader');
const sender = wizard.slice(wizard.indexOf(start), wizard.indexOf(end));
const cookieReader = wizard.slice(wizard.indexOf(cookieStart));
writeFileSync(join(temp, 'sender.mjs'), stripTypeScriptTypes(`
export async function send(body, cookie, fetch) {
  const document = { cookie };
  const roleCode = 'INTEGRATIONS';
  const setBusy = () => {};
  const applyPayload = () => {};
  const notify = () => {};
  ${cookieReader}
  ${sender}
  return post(body, 'fixture');
}
`, { mode: 'transform' }));
const { send } = await import(pathToFileURL(join(temp, 'sender.mjs')));

const origin = 'https://arthello.example.test';
const token = 'synthetic-active-session-csrf';
const action = { action: 'previewModule', module: 'families' };
const context = { auth: { session: { csrf_token: token } } };
function issuedCookie(csrf = token) {
  const headers = new Headers();
  auth.appendAuthCookies(headers, 'synthetic-session', csrf);
  const cookie = headers.getSetCookie().find((value) => value.startsWith('__Host-arthello_csrf='));
  assert.ok(cookie, 'the real auth module issues the browser-readable CSRF cookie');
  return cookie.split(';')[0];
}

async function attempt(cookie, browserOrigin = origin) {
  const requests = [];
  let accepted = 0;
  const result = await send(action, cookie, async (path, init) => {
    const headers = new Headers(init.headers);
    // Origin is browser-controlled, not supplied by application JavaScript.
    headers.set('origin', browserOrigin);
    const request = new Request(new URL(path, origin), { ...init, headers });
    requests.push(request);
    if (!hasTrustedMutationOrigin(request, origin)) return Response.json({ error: 'origin_denied' }, { status: 403 });
    try { auth.verifyAuthenticatedRequestCsrf(request, context); }
    catch { return Response.json({ error: 'csrf_denied' }, { status: 403 }); }
    accepted += 1;
    return Response.json({ message: 'Local mutation boundary accepted' });
  });
  return { result, accepted, requests };
}

test('Alfa wizard mutation passes the real CSRF verifier with the server-issued cookie', async () => {
  const observed = await attempt(`${issuedCookie()}; arthello_csrf=stale-legacy-token`);
  assert.equal(observed.accepted, 1, `actual sender denied: ${observed.result.error ?? 'unknown'}`);
  assert.equal(observed.result.error, undefined);
  assert.equal(observed.requests.length, 1);
  const request = observed.requests[0];
  assert.equal(request.url, `${origin}/api/integrations/alfacrm`);
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'include');
  assert.equal(request.cache, 'no-store');
  assert.deepEqual(await request.json(), action);
});

test('legacy cookie alone cannot authorize an Alfa wizard mutation', async () => {
  const observed = await attempt(`arthello_csrf=${token}`);
  assert.equal(observed.accepted, 0);
  assert.equal(observed.result.error, 'csrf_denied');
});

test('mismatched canonical cookie stays denied even when the legacy cookie matches', async () => {
  const observed = await attempt(`${issuedCookie('wrong-session-token')}; arthello_csrf=${token}`);
  assert.equal(observed.accepted, 0);
  assert.equal(observed.result.error, 'csrf_denied');
});

test('a valid CSRF cookie does not authorize a cross-origin mutation', async () => {
  const observed = await attempt(issuedCookie(), 'https://other.example.test');
  assert.equal(observed.accepted, 0);
  assert.equal(observed.result.error, 'origin_denied');
});

test('the unchanged server rejects the legacy header even with a matching token', () => {
  const request = new Request(`${origin}/api/integrations/alfacrm`, {
    method: 'POST', headers: { origin, 'x-arthello-csrf': token },
  });
  assert.throws(() => auth.verifyAuthenticatedRequestCsrf(request, context));
});
