import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPrerequisites, inspectBrowserImage, probeOrigins } from '../server-e2e-preflight.mjs';
import * as preflight from '../server-e2e-preflight.mjs';

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

const retirementId = 'sha256:0763e7e6404c4ecf19b81bdcc236dd815a0210e9bb6b087adec279692cc7701c';
const retirementSource = '5385090d48f4dae29c314dff7ae974d854560940';
const retirementTag = 'arthello-e2e:' + retirementSource;
const retirementFingerprint = '5970abba2518f5fc1f3bb27ef2624570e8050cbc606a3cb300f596031c26564e';
const privateMarker = 'PRIVATE_IMAGE_OBSERVATION_SENTINEL';
const retirementMetadata = () => {
  const value = metadata();
  value.Id = retirementId;
  value.Config.Labels['org.opencontainers.image.revision'] = retirementSource;
  value.Config.Labels.private = privateMarker;
  value.Config.Env = ['SECRET=' + privateMarker];
  value.RepoTags = [retirementTag];
  value.RepoDigests = [];
  return value;
};
const observeFixture = (value, extra = {}) => preflight.observeRetirementImage({
  executeRead: async (_command, args) => ({ stdout: args.at(-1) === '{{.Id}}' ? value.Id + '\n' : JSON.stringify(value) }),
  fingerprint: () => retirementFingerprint,
  ...extra,
});

test('retirement observation reads only the fixed image and tag with PATH-only subprocess env', async () => {
  const calls = [];
  const result = await observeFixture(retirementMetadata(), {
    executeRead: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: args.at(-1) === '{{.Id}}' ? retirementId + '\n' : JSON.stringify(retirementMetadata()), stderr: privateMarker };
    },
  });
  assert.deepEqual(calls.map(call => [call.command, ...call.args]), [
    ['docker', 'image', 'inspect', retirementId, '--format', '{{json .}}'],
    ['docker', 'image', 'inspect', retirementTag, '--format', '{{.Id}}'],
  ]);
  for (const call of calls) {
    assert.deepEqual(call.options.env, { PATH: process.env.PATH });
    assert.equal(call.options.timeout, 8000);
    assert.equal(call.options.maxBuffer, 1024 * 1024);
  }
  assert.equal(result.productionMutations, false);
  assert.equal(result.liveAcceptance, 'not_run');
  for (const value of [result.byId]) {
    assert.equal(value.status, 'observed');
    assert.ok(Object.values(value.checks).every(flag => flag === true));
    assert.deepEqual(value.fingerprint, { status: 'computed', matches: true });
    assert.deepEqual(value.repoTags, { type: 'array', count: 1, expectedOnly: true });
  }
  assert.deepEqual(result.tagBinding, { status: 'observed', idMatches: true });
  assert.equal(JSON.stringify(result).includes(privateMarker), false);
});

test('retirement observation distinguishes digest representations without treating them as permission', async () => {
  const selfDigest = 'arthello-e2e@' + retirementId;
  for (const [digests, type, count, ownRepositoryDigests] of [
    [null, 'null', null, []], [[], 'array', 0, []], [[selfDigest], 'array', 1, [selfDigest]],
    [privateMarker, 'other', null, []], [undefined, 'missing', null, []],
  ]) {
    const value = retirementMetadata(); value.RepoDigests = digests;
    const result = await observeFixture(value);
    assert.equal(result.byId.repoDigests.type, type);
    assert.equal(result.byId.repoDigests.count, count);
    assert.deepEqual(result.byId.repoDigests.ownRepositoryDigests, ownRepositoryDigests);
    assert.equal(result.byId.status, 'observed');
    assert.equal(result.productionMutations, false);
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
  }
});

test('retirement observation projects each identity mismatch without returning foreign metadata', async () => {
  const changes = [
    ['idMatches', value => { value.Id = privateMarker; }],
    ['sourceMatches', value => { value.Config.Labels['org.opencontainers.image.revision'] = privateMarker; }],
    ['roleMatches', value => { value.Config.Labels['org.arthello.role'] = privateMarker; }],
    ['userMatches', value => { value.Config.User = privateMarker; }],
    ['osMatches', value => { value.Os = privateMarker; }],
    ['architectureMatches', value => { value.Architecture = privateMarker; }],
    ['entrypointMatches', value => { value.Config.Entrypoint = [privateMarker]; }],
  ];
  for (const [flag, change] of changes) {
    const value = retirementMetadata(); change(value);
    const result = await observeFixture(value);
    assert.equal(result.byId.checks[flag], false);
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
  }
});

test('only bounded exact own-repository digest strings can leave the observation', async () => {
  const own = 'arthello-e2e@' + retirementId;
  const value = retirementMetadata();
  value.RepoTags.push(privateMarker);
  value.RepoDigests = [own, privateMarker + '@' + retirementId, own + '\n' + privateMarker, { secret: privateMarker }];
  const result = await observeFixture(value);
  assert.deepEqual(result.byId.repoTags, { type: 'array', count: 2, expectedOnly: false });
  assert.deepEqual(result.byId.repoDigests, { type: 'array', count: 4, ownRepositoryDigests: [own], otherCount: 3, referencesTruncated: false });
  assert.equal(JSON.stringify(result).includes(privateMarker), false);
  value.Id = imageId;
  const foreignId = await observeFixture(value);
  assert.deepEqual(foreignId.byId.repoDigests.ownRepositoryDigests, []);
  assert.deepEqual(foreignId.tagBinding, { status: 'observed', idMatches: false });
  value.Id = retirementId;
  value.RepoDigests = Array(40).fill(own);
  const bounded = (await observeFixture(value)).byId.repoDigests;
  assert.equal(bounded.count, 40);
  assert.equal(bounded.ownRepositoryDigests.length, 16);
  assert.equal(bounded.referencesTruncated, true);
});

test('unreadable metadata, daemon errors and hostile fingerprint errors remain fixed observations', async () => {
  const hostile = Object.defineProperty(new Error(), 'message', { get() { throw new Error(privateMarker); } });
  for (const executeRead of [
    async () => { throw hostile; },
    async () => ({ stdout: privateMarker }),
    async () => ({ stdout: 'null' }),
    async () => ({ stdout: '[]' }),
  ]) {
    const result = await observeFixture(retirementMetadata(), { executeRead });
    assert.ok(['unavailable', 'unreadable'].includes(result.byId.status));
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
    assert.equal(result.productionMutations, false);
  }
  const result = await observeFixture(retirementMetadata(), { fingerprint: () => { throw hostile; } });
  assert.deepEqual(result.byId.fingerprint, { status: 'unavailable', matches: null });
  assert.equal(result.byId.status, 'observed');
  assert.equal(JSON.stringify(result).includes(privateMarker), false);
});

test('fingerprint mismatch is reported separately, and canonical jq can hash metadata without outputting it', async () => {
  const mismatch = await observeFixture(retirementMetadata(), { fingerprint: () => 'a'.repeat(64) });
  assert.deepEqual(mismatch.byId.fingerprint, { status: 'computed', matches: false });
  const canonical = await observeFixture(retirementMetadata(), { fingerprint: undefined });
  assert.deepEqual(canonical.byId.fingerprint, { status: 'computed', matches: false });
  assert.equal(JSON.stringify(canonical).includes(privateMarker), false);
});

test('supplemental observation preserves original CLI verdicts and never exposes credential env or metadata', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'arthello-image-observation-test-'));
  try {
    const dockerFixture = `#!${process.execPath}\n` + [
      `const args = process.argv.slice(2);`,
      `if (Object.keys(process.env).some(key => key !== 'PATH')) process.exit(1);`,
      `if (args[0] !== 'image' || args[1] !== 'inspect' || args[3] !== '--format' || args.length !== 5) process.exit(1);`,
      `if (args[2] === ${JSON.stringify(retirementTag)} && args[4] === '{{.Id}}') process.stdout.write(${JSON.stringify(retirementId)} + '\\n');`,
      `else if (args[2] === ${JSON.stringify(retirementId)} && args[4] === '{{json .}}') process.stdout.write(${JSON.stringify(JSON.stringify(retirementMetadata()))});`,
      `else if (args[2] === ${JSON.stringify(imageId)} && args[4] === '{{json .}}') process.stdout.write(${JSON.stringify(JSON.stringify(metadata()))});`,
      `else process.exit(1);`,
    ].join('\n');
    writeFileSync(path.join(directory, 'docker'), dockerFixture, { mode: 0o700 });
    const preload = path.join(directory, 'fixed-head-response.mjs');
    writeFileSync(preload, 'globalThis.fetch = async () => ({ status: 200 });\n');
    const script = fileURLToPath(new URL('../server-e2e-preflight.mjs', import.meta.url));
    for (const [configuration, expectedStatus, expectedExit] of [
      [validEnv, 'prerequisites_observed', 0], [{}, 'blocked', 2],
    ]) {
      const child = spawnSync(process.execPath, ['--import', preload, script], {
        env: { PATH: directory + ':/usr/bin', ...configuration, EXTRA_SECRET: privateMarker },
        encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
      });
      assert.equal(child.status, expectedExit);
      assert.equal(child.stderr, '');
      const report = JSON.parse(child.stdout);
      assert.equal(report.status, expectedStatus);
      assert.deepEqual(report.configuration, inspectPrerequisites(configuration));
      assert.equal(report.retirementImage.byId.status, 'observed');
      assert.deepEqual(report.retirementImage.tagBinding, { status: 'observed', idMatches: true });
      assert.equal(report.retirementImage.byId.fingerprint.matches, false);
      assert.equal(report.liveAcceptance, 'not_run');
      assert.equal(report.productionMutations, false);
      for (const secret of [privateMarker, validEnv.ARTHELLO_E2E_LOGIN, validEnv.ARTHELLO_E2E_PASSWORD]) assert.equal(child.stdout.includes(secret), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
