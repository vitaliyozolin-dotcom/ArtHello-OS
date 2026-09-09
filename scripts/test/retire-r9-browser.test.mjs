import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { retireR9BrowserImage } from '../../deploy/browser/retire-r9-image.mjs';

const retiredImage = {
  id: 'sha256:413b76d9ca6024d9ecc229f9d5b16810f5b9a50861f984e0ecb925020209e4ef',
  source: '30f825d674cbf498be713c7b637e1dfd9f9c42cd',
  tag: 'arthello-e2e:30f825d674cbf498be713c7b637e1dfd9f9c42cd',
  fingerprint: 'b1d04b748b75b1283502aca1faef903dbcc7e1fed258e7ad4419ba67076153c5',
};

function retirementFixture(options = {}) {
  const calls = [];
  const githubCalls = [];
  let removed = false, inspections = 0, referenceChecks = 0, mainChecks = 0;
  const source = 'b52a5326f650060036d7ccd66a87e8d2d6a5a292';
  const target = options.current ? { id: 'sha256:' + 'c'.repeat(64), source, tag: 'arthello-e2e:' + source, fingerprint: 'a'.repeat(64) } : retiredImage;
  const runId = options.current ? 34285119759 : 34318973875;
  const snapshot = [{ Id: target.id, RepoTags: [target.tag], RepoDigests: [], Config: { User: '1000:1000', Labels: { 'org.arthello.role': 'e2e-browser', 'org.opencontainers.image.revision': target.source } } }];
  const archive = {
    id: 10091157744,
    name: `server-browser-${target.source}-${runId}-1`,
    size_in_bytes: 640809272,
    digest: 'sha256:9cfcd718f3bf69a8cb682092ee4ecdfef6bf5803cfb8fa976214db69f5b27274',
    expired: false,
    expires_at: '2026-09-10T22:00:54Z',
    workflow_run: { id: runId, repository_id: 1311964413, head_repository_id: 1311964413, head_branch: 'main', head_sha: target.source },
  };
  return {
    calls, githubCalls, target,
    dependencies: {
      checkedSource: source,
      environment: { CHECKED_SOURCE_SHA: source, BROWSER_IMAGE_ID: target.id, EXPECTED_BROWSER_FINGERPRINT: target.fingerprint, BROWSER_ARCHIVE_NAME: archive.name, GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: '1', ...options.environment },
      now: () => Date.parse('2026-09-09T00:00:00Z'),
      fingerprint: () => options.fingerprint ?? target.fingerprint,
      readGitHub: async path => {
        githubCalls.push(path);
        if (options.githubFailure) throw new Error('PRIVATE_GITHUB_TOKEN');
        if (path === '/git/ref/heads/main') {
          mainChecks++;
          return { object: { sha: options.mainChanged && mainChecks > 1 ? 'f'.repeat(40) : source } };
        }
        assert.equal(path, options.current ? '/actions/runs/34285119759/artifacts?per_page=100' : '/actions/artifacts/10091157744');
        const value = structuredClone(archive);
        options.alterArchive?.(value);
        const response = options.current ? { total_count: 1, artifacts: [value] } : value;
        options.alterArchiveResponse?.(response);
        return response;
      },
      docker: args => {
        calls.push(args);
        if (options.daemonFailure) throw new Error('PRIVATE_DAEMON_ERROR');
        if (args[0] === 'image' && args[1] === 'ls') {
          const tagged = args.includes('--filter');
          if (options.inventoryMalformed) return 'PRIVATE_INVALID_INVENTORY';
          if (removed || options.absent) return tagged && options.foreignTag ? 'sha256:' + 'f'.repeat(64) + '\n' : '';
          return target.id + '\n';
        }
        if (args[0] === 'image' && args[1] === 'inspect') {
          if (options.inspectFailure) throw Object.defineProperty(new Error(), 'message', { get() { throw new Error('PRIVATE_EXCEPTION_DETAIL'); } });
          assert.ok([target.id, target.tag].includes(args[2]));
          inspections++;
          const value = structuredClone(snapshot);
          options.alterImage?.(value, inspections);
          return JSON.stringify(value);
        }
        if (args[0] === 'ps') {
          assert.deepEqual(args, ['ps', '-a', '-q', '--no-trunc', '--filter', 'ancestor=' + target.id]);
          referenceChecks++;
          return options.containerReference || (options.racedContainer && referenceChecks > 1) ? 'c'.repeat(64) + '\n' : '';
        }
        assert.deepEqual(args, ['image', 'rm', '--no-prune', target.id]);
        if (options.removalRefused) throw new Error('PRIVATE_CONFLICT_DETAIL');
        removed = !options.removalNoEffect;
        return 'PRIVATE_DAEMON_REMOVAL_OUTPUT';
      },
    },
  };
}

test('retirement removes only the exact unused reproducible image after fresh identity, artifact and main checks', async () => {
  const fixture = retirementFixture();
  assert.deepEqual(await retireR9BrowserImage(fixture.dependencies), { kind: 'server-browser-image-retirement', result: 'retired' });
  assert.deepEqual(fixture.calls.filter(args => args[1] === 'rm'), [['image', 'rm', '--no-prune', retiredImage.id]]);
  assert.equal(fixture.calls.filter(args => args[1] === 'inspect').length, 4);
  assert.equal(fixture.calls.filter(args => args[0] === 'ps').length, 2);
  assert.deepEqual(fixture.githubCalls, ['/git/ref/heads/main', '/actions/artifacts/10091157744', '/git/ref/heads/main']);
  assert.ok(fixture.calls.slice(-2).every(args => args[1] === 'ls'));
});

test('retirement is idempotent only after successful ID and tag absence observations', async () => {
  const fixture = retirementFixture({ absent: true });
  assert.deepEqual(await retireR9BrowserImage(fixture.dependencies), { kind: 'server-browser-image-retirement', result: 'absent' });
  assert.equal(fixture.calls.length, 2);
  for (const options of [{ daemonFailure: true }, { inventoryMalformed: true }, { absent: true, foreignTag: true }]) {
    const denied = retirementFixture(options);
    const result = await retireR9BrowserImage(denied.dependencies);
    assert.equal(result.result, 'blocked');
    assert.equal(result.reason, 'retirement_inventory_failed');
    assert.equal(denied.calls.some(args => args[1] === 'rm'), false);
  }
});

test('retirement rejects mismatched images, stopped references, missing recovery evidence and races without broadening deletion', async () => {
  const cases = [
    { alterImage: value => { value[0].Id = 'sha256:' + 'f'.repeat(64); } },
    { alterImage: value => { value[0].RepoTags.push('unrelated:latest'); } },
    { alterImage: value => { value[0].RepoTags = []; } },
    { alterImage: value => { value[0].RepoDigests = ['unrelated@sha256:' + 'f'.repeat(64)]; } },
    { alterImage: value => { value[0].Config.User = '0:0'; } },
    { alterImage: value => { value[0].Config.Labels['org.arthello.role'] = 'application'; } },
    { alterImage: value => { value[0].Config.Labels['org.opencontainers.image.revision'] = 'f'.repeat(40); } },
    { fingerprint: 'f'.repeat(64) },
    { inspectFailure: true },
    { containerReference: true },
    { racedContainer: true },
    { alterImage: (value, count) => { if (count > 2) value[0].RepoTags.push('new-reference:latest'); } },
    { mainChanged: true },
    { githubFailure: true },
    { alterArchive: value => { value.expired = true; } },
    { alterArchive: value => { value.expires_at = '2026-09-08T00:00:00Z'; } },
    { alterArchive: value => { value.expires_at = 'not-a-date'; } },
    { alterArchive: value => { value.name = 'different-artifact'; } },
    { alterArchive: value => { value.digest = 'sha256:' + 'f'.repeat(64); } },
    { alterArchive: value => { value.size_in_bytes = 1; } },
    { alterArchive: value => { value.workflow_run.id = 1; } },
    { alterArchive: value => { value.workflow_run.head_sha = 'f'.repeat(40); } },
  ];
  for (const options of cases) {
    const fixture = retirementFixture(options);
    const result = await retireR9BrowserImage(fixture.dependencies);
    assert.equal(result.result, 'blocked');
    assert.match(result.reason, /^retirement_[a-z_]+_failed$/);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(fixture.calls.some(args => args[1] === 'rm'), false);
  }
  const refused = retirementFixture({ removalRefused: true });
  assert.deepEqual(await retireR9BrowserImage(refused.dependencies), { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_removal_failed' });
  assert.deepEqual(refused.calls.filter(args => args[1] === 'rm'), [['image', 'rm', '--no-prune', retiredImage.id]]);
  const ineffective = retirementFixture({ removalNoEffect: true });
  assert.deepEqual(await retireR9BrowserImage(ineffective.dependencies), { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_removal_verification_failed' });
  assert.equal(ineffective.calls.filter(args => args[1] === 'rm').length, 1);
});


test('only the observed own-repository digest is allowed; aliases and foreign digests cannot retire', async () => {
  const fixture = retirementFixture({ alterImage: value => { value[0].RepoDigests = ['arthello-e2e@' + value[0].Id]; } });
  assert.equal((await retireR9BrowserImage(fixture.dependencies)).result, 'retired');
  for (const shape of [null, ['foreign@' + retiredImage.id], ['arthello-e2e@' + retiredImage.id, 'arthello-e2e@' + retiredImage.id]]) {
    const denied = retirementFixture({ alterImage: value => { value[0].RepoDigests = shape; } });
    assert.equal((await retireR9BrowserImage(denied.dependencies)).result, 'blocked');
    assert.equal(denied.calls.some(args => args[1] === 'rm'), false);
  }
});

test('CLI has no current, target or general cleanup mode and never prints arguments', () => {
  const script = fileURLToPath(new URL('../../deploy/browser/retire-r9-image.mjs', import.meta.url));
  for (const args of [['--current'], ['--target', 'PRIVATE_TARGET'], ['--force'], ['--all']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_arguments_failed' });
  }
});
