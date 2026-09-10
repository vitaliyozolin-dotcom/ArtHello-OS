import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { retireR16Browser } from '../../deploy/browser/retire-r16-browser.mjs';

const SOURCE = 'cb990279e070fddbfa9a0adbd21b56de25b85588';
const NEXT = 'a'.repeat(40);
const TREE = 'ac3fcaac06acf33bf9ee32e438d0c040adb38fd7';
const BROWSER = 'sha256:104c3c4b35d236f020111e6dfc0bf2bfd0d99ca9a083cf373424747f2f6846b9';
const APP = 'sha256:5a39c36001cb79abe6d0bc8d691275b58cdec5456e7d13d95fc717eba6702284';
const BROWSER_TAG = 'arthello-e2e:' + SOURCE;
const APP_TAGS = ['arthello-direct:' + SOURCE, 'arthello-v52-verify:' + SOURCE];
const FINGERPRINTS = {
  [BROWSER]: '738757d0a2ef0805c5f139fb48e9afc079cfdae874eaf6364eab838a983daa04',
  [APP]: 'a28b64b3a57f96eb8e23c18d888d033f70d90f92b2ef98df5cc7b07c920d153a',
};
const ARCHIVES = {
  '/actions/artifacts/10145756776': { id: 10145756776, name: `server-browser-${SOURCE}-34461449594-1`, size_in_bytes: 640802987, digest: 'sha256:aa4ea805899ff06244cfad407aa1ea0393edf0c4b6e73030fcfc656c17477073', expired: false, expires_at: '2026-09-11T08:01:35Z', workflow_run: { id: 34461449594, repository_id: 1311964413, head_repository_id: 1311964413, head_branch: 'main', head_sha: SOURCE } },
};
const privateError = () => Object.defineProperty({}, 'message', { get() { throw Error('PRIVATE_MESSAGE_GETTER'); } });

function fixture(options = {}) {
  const events = [], removals = [], imageReads = [];
  const images = new Map([
    [BROWSER, { Id: BROWSER, RepoTags: [BROWSER_TAG], RepoDigests: [], Config: { User: '1000:1000', Labels: { 'org.arthello.role': 'e2e-browser', 'org.opencontainers.image.revision': SOURCE } } }],
    [APP, { Id: APP, RepoTags: [...APP_TAGS], RepoDigests: [], Config: { User: 'node', Labels: { 'org.opencontainers.image.revision': SOURCE, 'org.opencontainers.image.source-tree': TREE } } }],
  ]);
  if (options.browserAbsent) images.delete(BROWSER);
  if (options.appAbsent) images.delete(APP);
  let mainChecks = 0, dfCalls = 0;
  const counts = { [BROWSER]: 0, [APP]: 0 };
  const referenceCounts = { [BROWSER]: 0, [APP]: 0 };
  const dependencies = {
    environment: { CHECKED_SOURCE_SHA: NEXT, ARCHIVE_BYTES: '640810347', EXPANDED_BYTES: '1585953792', RUNNER_TEMP: '/owned runner/temp', ...options.environment },
    now: () => Date.parse('2026-09-09T08:00:00Z'),
    fingerprint: value => options.badFingerprint === value[0].Id ? 'f'.repeat(64) : FINGERPRINTS[value[0].Id],
    readGitHub: async path => {
      events.push(['github', path]);
      if (options.githubFailure) throw privateError();
      if (path === '/git/ref/heads/main') {
        mainChecks++;
        options.onMainCheck?.(mainChecks, images);
        return { object: { sha: mainChecks >= (options.mainDriftAt ?? Infinity) ? 'f'.repeat(40) : NEXT } };
      }
      assert.ok(Object.hasOwn(ARCHIVES, path), 'Only fixed recovery artifact endpoints are readable');
      const value = structuredClone(ARCHIVES[path]);
      options.alterArchive?.(value);
      return value;
    },
    df: args => {
      events.push(['df', ...args]);
      assert.ok(['/owned runner/temp', '/var/lib/docker'].includes(args[2]));
      assert.deepEqual(args.slice(0, 2), ['-Pk', '--']);
      if (options.dfFailure) throw privateError();
      if (options.dfMalformed) return 'PRIVATE_BAD_DF';
      const round = Math.floor(dfCalls++ / 2);
      const free = (options.free ?? [9000000])[Math.min(round, (options.free ?? [9000000]).length - 1)];
      return `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 20000000 10000000 ${free} 50% /\n`;
    },
    docker: args => {
      events.push(['docker', ...args]);
      if (options.daemonFailure) throw privateError();
      if (args[0] === 'info') {
        assert.deepEqual(args, ['info', '--format', '{{.DockerRootDir}}']);
        return options.dockerRoot ?? '/var/lib/docker\n';
      }
      if (args[0] === 'image' && args[1] === 'ls') {
        assert.deepEqual(args.slice(0, 5), ['image', 'ls', '--all', '--no-trunc', '--quiet']);
        if (options.inventoryMalformed) return 'PRIVATE_BAD_ID';
        if (args.length === 5) return [...images.keys()].join('\n');
        assert.equal(args[5], '--filter');
        const tag = args[6].replace(/^reference=/, '');
        if (options.foreignTag === tag) return 'sha256:' + 'f'.repeat(64);
        return [...images.values()].filter(x => x.RepoTags.includes(tag)).map(x => x.Id).join('\n');
      }
      if (args[0] === 'image' && args[1] === 'inspect') {
        assert.equal(args.length, 3);
        const found = images.get(args[2]) ?? [...images.values()].find(x => x.RepoTags.includes(args[2]));
        assert.ok(found, 'No speculative or stale inspect');
        imageReads.push(found.Id);
        counts[found.Id]++;
        if (options.inspectFailure === found.Id) throw privateError();
        const value = [structuredClone(found)];
        options.alterImage?.(value, counts[found.Id]);
        return JSON.stringify(value);
      }
      if (args[0] === 'ps') {
        const id = args[5].replace(/^ancestor=/, '');
        assert.equal(id, BROWSER, 'Only the fixed browser may be queried for consumers');
        assert.deepEqual(args, ['ps', '-a', '-q', '--no-trunc', '--filter', 'ancestor=' + id]);
        referenceCounts[id]++;
        return options.consumer === id || (options.consumerRace === id && referenceCounts[id] > 1) ? 'c'.repeat(64) : '';
      }
      assert.deepEqual(args.slice(0, 3), ['image', 'rm', '--no-prune']);
      assert.equal(args.length, 4);
      const target = args[3];
      assert.equal(target, BROWSER, 'No application, tag or alternate removal target');
      removals.push([...args]);
      if (options.removalRefused === target) throw privateError();
      if (options.removalNoEffect === target) return 'PRIVATE_DOCKER_OUTPUT';
      // Model daemon no-force conflicts at the actual mutation boundary, not
      // merely the prior ps/inspect observations. Never resolve an ID via a tag.
      if (images.has(target) && (images.get(target).RepoTags.length > 1 || options.lateConsumer)) throw privateError();
      images.delete(target);
      options.afterRemoval?.(target, images);
      return 'PRIVATE_DOCKER_OUTPUT';
    },
  };
  return { dependencies, events, removals, imageReads, images };
}

test('only verified R16 browser is retired; app, backup and volumes remain outside the command surface', async () => {
  const f = fixture();
  const result = await retireR16Browser(f.dependencies);
  assert.deepEqual(result, { kind: 'r16-browser-retirement', result: 'ready', browser: 'retired', capacity: { scratchAvailableKiB: 9000000, scratchRequiredKiB: 3348735, dockerAvailableKiB: 9000000, dockerRequiredKiB: 7995084 } });
  assert.deepEqual(f.removals, [['image', 'rm', '--no-prune', BROWSER]]);
  assert.ok(f.imageReads.every(id => id === BROWSER));
  assert.equal(f.events.some(x => x[1] === '/actions/artifacts/10092216577'), false);
  assert.equal(f.events.some(x => x.includes('reference=' + APP_TAGS[0]) || x.includes('reference=' + APP_TAGS[1])), false);
});

test('successful ID and every expected tag absence is idempotent; residual shortage is blocked', async () => {
  const f = fixture({ browserAbsent: true, appAbsent: true, free: [5807140] });
  const result = await retireR16Browser(f.dependencies);
  assert.equal(result.result, 'blocked');
  assert.equal(result.reason, 'insufficient_import_space');
  assert.equal(result.browser, 'absent');
  assert.equal(Object.hasOwn(result, 'app'), false);
  assert.deepEqual(f.removals, []);
  assert.equal(f.events.filter(x => x[0] === 'df').length, 2);
});

test('absent accepted browser skips recovery artifact reads and removal while preserving the live app', async () => {
  const f = fixture({ browserAbsent: true });
  const result = await retireR16Browser(f.dependencies);
  assert.equal(result.result, 'ready');
  assert.equal(result.browser, 'absent');
  assert.equal(f.images.has(APP), true);
  assert.deepEqual(f.removals, []);
  assert.deepEqual(f.imageReads, []);
  assert.equal(f.events.some(x => x[0] === 'github' && x[1].startsWith('/actions/artifacts/')), false);
  assert.equal(f.events.some(x => x[0] === 'docker' && x[1] === 'ps'), false);
});

test('invalid size/source/temp inputs reject before any Docker mutation', async () => {
  for (const environment of [{ ARCHIVE_BYTES: '0' }, { ARCHIVE_BYTES: 'PRIVATE' }, { ARCHIVE_BYTES: '2e3' }, { EXPANDED_BYTES: '640' }, { EXPANDED_BYTES: String(101 * 1024 ** 3) }, { CHECKED_SOURCE_SHA: SOURCE }, { CHECKED_SOURCE_SHA: 'bad' }, { RUNNER_TEMP: 'relative' }, { RUNNER_TEMP: '/tmp\nPRIVATE' }]) {
    const f = fixture({ environment });
    assert.equal((await retireR16Browser(f.dependencies)).result, 'blocked');
    assert.deepEqual(f.removals, []);
  }
});

test('browser identity, alias, digest, consumer and main drift failures never reach app', async () => {
  const cases = [
    { consumer: BROWSER }, { consumerRace: BROWSER }, { mainDriftAt: 2 }, { badFingerprint: BROWSER }, { inspectFailure: BROWSER }, { daemonFailure: true }, { githubFailure: true }, { inventoryMalformed: true }, { browserAbsent: true, foreignTag: BROWSER_TAG },
    ...[x => { x.Id = APP; }, x => { x.Config.User = 'root'; }, x => { x.Config.Labels['org.arthello.role'] = 'application'; }, x => { x.Config.Labels['org.opencontainers.image.revision'] = NEXT; }, x => { x.RepoTags.push('foreign:latest'); }, x => { x.RepoDigests = ['foreign@' + BROWSER]; }, x => { x.RepoDigests = null; }].map(change => ({ alterImage: x => change(x[0]) })),
  ];
  for (const options of cases) {
    const f = fixture({ ...options, free: [5807140] });
    const result = await retireR16Browser(f.dependencies);
    assert.equal(result.result, 'blocked', JSON.stringify(options));
    assert.deepEqual(f.removals, []);
    assert.ok(f.imageReads.every(id => id === BROWSER));
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

for (const artifactId of [10145756776]) test(`artifact ${artifactId} must match every immutable recovery field and fresh expiry`, async () => {
  const mutations = [x => { x.id++; }, x => { x.name += '-other'; }, x => { x.digest = 'sha256:' + 'f'.repeat(64); }, x => { x.size_in_bytes++; }, x => { x.expired = true; }, x => { x.expires_at = '2026-09-09T07:59:59Z'; }, x => { x.expires_at = 'invalid'; }, x => { x.workflow_run.id++; }, x => { x.workflow_run.head_sha = NEXT; }, x => { x.workflow_run.repository_id++; }, x => { x.workflow_run.head_repository_id++; }, x => { x.workflow_run.head_branch = 'feature'; }];
  for (const mutate of mutations) {
    const f = fixture({ free: [5807140], alterArchive: x => { if (x.id === artifactId) mutate(x); } });
    const result = await retireR16Browser(f.dependencies);
    assert.equal(result.result, 'blocked');
    assert.deepEqual(f.removals, []);
  }
});

test('only unique own-repository self digests are accepted, independently from runtime fingerprint', async () => {
  const f = fixture({ alterImage: x => { x[0].RepoDigests = x[0].Id === BROWSER ? ['arthello-e2e@' + BROWSER] : ['arthello-direct@' + APP, 'arthello-v52-verify@' + APP]; } });
  assert.equal((await retireR16Browser(f.dependencies)).result, 'ready');
});

test('tag rebind after identity checks must never delete or untag an unrelated image', async () => {
  const foreignId = 'sha256:' + 'e'.repeat(64);
  const f = fixture({ free: [5807140, 9000000], onMainCheck: (count, images) => {
    if (count === 2) {
      images.get(BROWSER).RepoTags = [];
      images.set(foreignId, { Id: foreignId, RepoTags: [BROWSER_TAG] });
    }
  } });
  const result = await retireR16Browser(f.dependencies);
  assert.equal(result.result, 'blocked');
  assert.equal(f.images.has(foreignId), true);
  assert.deepEqual(f.images.get(foreignId).RepoTags, [BROWSER_TAG]);
  assert.deepEqual(f.removals, [['image', 'rm', '--no-prune', BROWSER]]);
});

test('daemon conflicts preserve the exact image when alias or container appears after final checks', async () => {
  for (const options of [{ lateConsumer: true }, { onMainCheck: (count, images) => {
    if (count === 2) images.get(BROWSER).RepoTags.push('independent:alias');
  } }]) {
    const f = fixture(options);
    const result = await retireR16Browser(f.dependencies);
    assert.equal(result.result, 'blocked');
    assert.equal(result.reason, 'retirement_browser_removal_failed');
    assert.equal(result.browser, 'mutation_unverified');
    assert.equal(f.images.has(BROWSER), true);
    assert.equal(f.images.has(APP), true);
    assert.deepEqual(f.removals, [['image', 'rm', '--no-prune', BROWSER]]);
  }
});

test('recovery archive is freshly rechecked immediately before retirement', async () => {
  const f = fixture();
  const github = f.dependencies.readGitHub;
  let archives = 0;
  f.dependencies.readGitHub = async path => {
    const value = await github(path);
    if (path === '/actions/artifacts/10145756776' && ++archives > 1) value.expired = true;
    return value;
  };
  const result = await retireR16Browser(f.dependencies);
  assert.equal(result.result, 'blocked');
  assert.equal(result.reason, 'retirement_browser_final_archive_failed');
  assert.equal(archives, 2);
  assert.deepEqual(f.removals, []);
});

test('missing, duplicated and unrelated digest aliases cannot escape the fixed owned self-digest shape', async () => {
  for (const digests of [null, ['arthello-e2e@' + BROWSER, 'arthello-e2e@' + BROWSER], ['arthello-e2e@sha256:' + 'f'.repeat(64)], ['arthello-direct@' + BROWSER]]) {
    const f = fixture({ alterImage: x => { x[0].RepoDigests = digests; } });
    assert.equal((await retireR16Browser(f.dependencies)).result, 'blocked');
    assert.deepEqual(f.removals, []);
  }
});

test('scratch and Docker capacity are separately required, and successful retirements never imply sufficient space', async () => {
  for (const scarcePath of ['/owned runner/temp', '/var/lib/docker']) {
    const f = fixture();
    const df = f.dependencies.df;
    f.dependencies.df = args => df(args).replace(' 9000000 ', args[2] === scarcePath ? ' 1 ' : ' 9000000 ');
    const result = await retireR16Browser(f.dependencies);
    assert.equal(result.result, 'blocked');
    assert.equal(result.reason, 'insufficient_import_space');
    assert.equal(result.browser, 'retired');
    assert.equal(f.images.has(APP), true);
    assert.deepEqual(f.removals, [['image', 'rm', '--no-prune', BROWSER]]);
  }
});

test('capacity read errors never authorize app removal and never expose command output', async () => {
  for (const options of [{ dfFailure: true }, { dfMalformed: true }, { dockerRoot: 'PRIVATE_ROOT' }, { dockerRoot: '/var/lib/docker\nPRIVATE' }]) {
    const f = fixture(options);
    const result = await retireR16Browser(f.dependencies);
    assert.equal(result.result, 'blocked');
    assert.deepEqual(f.removals, [['image', 'rm', '--no-prune', BROWSER]]);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('daemon refusal or no-effect deletion reports blockage and never proceeds to unrelated targets', async () => {
  for (const target of [BROWSER]) for (const option of ['removalRefused', 'removalNoEffect']) {
    const f = fixture({ free: [5807140], [option]: target });
    const result = await retireR16Browser(f.dependencies);
    assert.equal(result.result, 'blocked');
    assert.equal(f.removals.at(-1)[3], target);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('CLI has no target/force/general mode and suppresses argument/exception details', () => {
  const script = fileURLToPath(new URL('../../deploy/browser/retire-r16-browser.mjs', import.meta.url));
  for (const args of [['--target', 'PRIVATE_TARGET'], ['--force'], ['--all'], []]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.result, 'blocked');
    assert.equal(result.stdout.includes('PRIVATE'), false);
  }
});
