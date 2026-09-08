import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPrerequisites, inspectBrowserImage, probeOrigins } from '../server-e2e-preflight.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const sourceSha = 'b'.repeat(40);
const validEnv = {
  ARTHELLO_E2E_LOGIN: 'e2e-diary-test',
  ARTHELLO_E2E_PASSWORD: 'synthetic-not-a-real-secret-1234',
  ARTHELLO_E2E_ACCOUNT_CONFIRMED: 'dedicated-active-education-account-v1',
  ARTHELLO_E2E_IMAGE_ID: imageId,
  ARTHELLO_E2E_IMAGE_SOURCE_SHA: sourceSha,
};
const metadata = () => ({
  Id: imageId,
  Os: 'linux',
  Architecture: 'amd64',
  Config: {
    User: '1000:1000',
    Entrypoint: ['node', '/opt/arthello-e2e/run.mjs'],
    Labels: {
      'org.arthello.role': 'e2e-browser',
      'org.opencontainers.image.revision': sourceSha,
    },
  },
});

test('missing prerequisites are explicit, never live acceptance', () => {
  const result = inspectPrerequisites({});
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers, ['test_login_missing', 'test_password_missing_or_invalid', 'dedicated_account_unconfirmed', 'browser_image_unpinned', 'browser_source_unpinned']);
  assert.equal(result.liveAcceptance, 'not_run');
});

test('ready configuration is not a successful browser test', () => {
  const result = inspectPrerequisites(validEnv);
  assert.equal(result.status, 'configured');
  assert.equal(result.liveAcceptance, 'not_run');
  assert.deepEqual(result.blockers, []);
});

test('credentials and arbitrary environment content are never returned', () => {
  const result = JSON.stringify(inspectPrerequisites({ ...validEnv, EXTRA_SECRET: 'private-marker' }));
  for (const value of [validEnv.ARTHELLO_E2E_LOGIN, validEnv.ARTHELLO_E2E_PASSWORD, 'private-marker']) assert.equal(result.includes(value), false);
});

test('canonical owner login is not accepted as a dedicated test account', () => {
  assert.ok(inspectPrerequisites({ ...validEnv, ARTHELLO_E2E_LOGIN: ' OWNER ' }).blockers.includes('test_login_is_owner'));
});

test('mutable tags and malformed image identities are rejected', () => {
  for (const image of ['playwright:latest', 'sha256:abc', `${imageId}\n`, ` ${imageId}`]) {
    assert.ok(inspectPrerequisites({ ...validEnv, ARTHELLO_E2E_IMAGE_ID: image }).blockers.includes('browser_image_unpinned'));
  }
});

test('TLS bypass is rejected', () => {
  assert.ok(inspectPrerequisites({ ...validEnv, NODE_TLS_REJECT_UNAUTHORIZED: '0' }).blockers.includes('tls_verification_disabled'));
});

test('exact non-root browser image metadata is accepted only as inventory', () => {
  assert.deepEqual(inspectBrowserImage(metadata(), imageId, sourceSha), { status: 'inventory_match', blockers: [], liveAcceptance: 'not_run' });
});

test('foreign image, root user, wrong source and entrypoint fail closed', () => {
  const changes = [
    value => { value.Id = `sha256:${'c'.repeat(64)}`; },
    value => { value.Config.User = 'root'; },
    value => { value.Config.User = ''; },
    value => { value.Config.Labels['org.opencontainers.image.revision'] = 'c'.repeat(40); },
    value => { value.Config.Labels['org.arthello.role'] = 'production'; },
    value => { value.Config.Entrypoint = ['sh']; },
    value => { value.Architecture = 'arm64'; },
  ];
  for (const change of changes) {
    const value = metadata(); change(value);
    assert.equal(inspectBrowserImage(value, imageId, sourceSha).status, 'blocked');
  }
  for (const value of [null, {}, [], 'raw-private-text']) assert.equal(inspectBrowserImage(value, imageId, sourceSha).status, 'blocked');
});

test('origin probes use only fixed HEAD requests with no auth and no redirects', async () => {
  const seen = [];
  const result = await probeOrigins(async (url, options) => {
    seen.push({ url, options }); return { status: 200 };
  });
  assert.deepEqual(seen.map(value => value.url), ['https://arthello-188-225-38-55.sslip.io/', 'https://school-188-225-38-55.sslip.io/']);
  for (const { options } of seen) {
    assert.equal(options.method, 'HEAD'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers, undefined); assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.ok(result.every(value => value.status === 'responding'));
  assert.ok(result.every(value => value.liveAcceptance === 'not_run'));
});

test('timeouts, TLS and transport errors are sanitized', async () => {
  const result = await probeOrigins(async () => { throw new Error('private-secret-and-personal-url'); });
  assert.ok(result.every(value => value.status === 'unreachable'));
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
});

test('redirect is observed but never followed or mistaken for an authenticated page', async () => {
  const result = await probeOrigins(async () => ({ status: 302 }));
  assert.ok(result.every(value => value.status === 'redirect_not_followed'));
});

test('server and forbidden responses do not pass reachability gate', async () => {
  for (const status of [401, 403, 429, 500, 502]) {
    const result = await probeOrigins(async () => ({ status }));
    assert.ok(result.every(value => value.status === 'http_error'));
  }
});
