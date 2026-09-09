import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capacity } from './capacity.mjs';

// Retire only the recoverable browser image used by the accepted R13 release.
// The application, backup worker, volumes and existing capacity model are untouched.
const SOURCE = 'f5fa3e46e3510e6fc98ae4455f4b499c0ba30695';
const MAIN_PATH = '/git/ref/heads/main';
const BROWSER = {
  key: 'browser', id: 'sha256:43ee8d5da7fe768ac5883b407beb64eeaae071b3209e41ac65aace42ad707be5',
  tags: ['arthello-e2e:' + SOURCE], repositories: ['arthello-e2e'], user: '1000:1000',
  fingerprint: 'da3879c09cfa263d7a3192ab566bef914179328a93dcc3ef65121b220896bee3',
  artifact: { id: 10099592667, name: `server-browser-${SOURCE}-34340461537-1`, size: 640803216,
    digest: 'sha256:cd441f458efd0f25d62ae60942dbaab9713016597b446d6e75fcd3e9106a2b27', run: 34340461537 },
};
const options = { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
const runDocker = args => execFileSync('docker', args, options);
const runDf = args => execFileSync('df', args, { ...options, env: { ...process.env, LC_ALL: 'C' } });

function imageFingerprint(snapshot) {
  const filter = fileURLToPath(new URL('../v52/maintenance/image-runtime-fingerprint.jq', import.meta.url));
  const canonical = execFileSync('jq', ['-cS', '-f', filter], { ...options, stdio: ['pipe', 'pipe', 'pipe'], input: JSON.stringify(snapshot) });
  return createHash('sha256').update(canonical).digest('hex');
}

async function readGitHub(path) {
  if (!process.env.GH_TOKEN || ![MAIN_PATH, '/actions/artifacts/' + BROWSER.artifact.id].includes(path)) throw Error();
  const response = await fetch('https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS' + path, {
    headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json' },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error();
  return response.json();
}

function artifactMatches(value, target, now) {
  const expected = target.artifact, run = value?.workflow_run;
  return value?.id === expected.id && value.name === expected.name && value.size_in_bytes === expected.size
    && value.digest === expected.digest && value.expired === false && Date.parse(value.expires_at) > now
    && run?.id === expected.run && run.repository_id === 1311964413 && run.head_repository_id === 1311964413
    && run.head_branch === 'main' && run.head_sha === SOURCE;
}

function exactSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && new Set(actual).size === actual.length && expected.every(x => actual.includes(x));
}

function imageMatches(snapshot, target, tags) {
  if (!Array.isArray(snapshot) || snapshot.length !== 1) return false;
  const image = snapshot[0], labels = image?.Config?.Labels;
  // RepoDigests do not participate in the portable fingerprint. Accept only a
  // unique subset of the fixed owned repositories self-referencing this exact
  // local immutable ID; empty is valid. No arbitrary manifest digest is inferred.
  const allowedDigests = target.repositories.map(repo => repo + '@' + target.id);
  return image?.Id === target.id && exactSet(image.RepoTags, tags)
    && Array.isArray(image.RepoDigests) && new Set(image.RepoDigests).size === image.RepoDigests.length
    && image.RepoDigests.every(x => allowedDigests.includes(x))
    && image.Config?.User === target.user && labels?.['org.opencontainers.image.revision'] === SOURCE
    && labels?.['org.arthello.role'] === 'e2e-browser';
}

function parseIds(output) {
  const values = output.trim() ? output.trim().split(/\s+/) : [];
  if (values.some(x => !/^sha256:[a-f0-9]{64}$/.test(x))) throw Error();
  return new Set(values);
}

function safePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || /[\x00-\x1f\x7f]/.test(value)) throw Error();
  return value;
}

function availableKiB(output) {
  const lines = output.trim().split('\n');
  const row = lines.length === 2 && lines[1].match(/^\S+\s+\d+\s+\d+\s+(\d+)\s+\d+%\s+.+$/);
  if (!row || !Number.isSafeInteger(Number(row[1]))) throw Error();
  return Number(row[1]);
}

// Dependency injection is an in-process unit-test seam, never a CLI selector.
// Output contains only fixed states/reasons and numeric capacity, never paths,
// image config, command output, API bodies or exception properties.
export async function retireR13Browser(dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const docker = dependencies.docker ?? runDocker, df = dependencies.df ?? runDf;
  const github = dependencies.readGitHub ?? readGitHub;
  const fingerprint = dependencies.fingerprint ?? imageFingerprint, now = dependencies.now ?? Date.now;
  const receipt = { kind: 'r13-browser-retirement', result: 'blocked', browser: 'not_checked' };
  let stage = 'inputs';
  try {
    const source = environment.CHECKED_SOURCE_SHA;
    if (!/^[a-f0-9]{40}$/.test(source ?? '') || source === SOURCE) throw Error();
    for (const name of ['ARCHIVE_BYTES', 'EXPANDED_BYTES']) if (!/^[1-9][0-9]*$/.test(environment[name] ?? '')) throw Error();
    const required = capacity(Number(environment.ARCHIVE_BYTES), Number(environment.EXPANDED_BYTES));
    const scratch = safePath(environment.RUNNER_TEMP);
    const currentMain = async () => { if ((await github(MAIN_PATH))?.object?.sha !== source) throw Error(); };
    const inventory = (target, tags) => {
      const ids = parseIds(docker(['image', 'ls', '--all', '--no-trunc', '--quiet']));
      const listings = target.tags.map(tag => [tag, parseIds(docker(['image', 'ls', '--all', '--no-trunc', '--quiet', '--filter', 'reference=' + tag]))]);
      if (!ids.has(target.id) && listings.every(([, values]) => values.size === 0)) return 'absent';
      if (!ids.has(target.id) || listings.some(([tag, values]) => tags.includes(tag)
        ? values.size !== 1 || !values.has(target.id) : values.size !== 0)) throw Error();
      return 'present';
    };
    const identity = (target, tags) => {
      for (const ref of [target.id, ...tags]) {
        const snapshot = JSON.parse(docker(['image', 'inspect', ref]));
        if (!imageMatches(snapshot, target, tags) || fingerprint(snapshot) !== target.fingerprint) throw Error();
      }
    };
    const unused = target => { if (docker(['ps', '-a', '-q', '--no-trunc', '--filter', 'ancestor=' + target.id]).trim()) throw Error(); };
    const restorable = async target => { if (!artifactMatches(await github('/actions/artifacts/' + target.artifact.id), target, now())) throw Error(); };
    const retire = async target => {
      const key = target.key;
      receipt[key] = 'not_checked';
      stage = key + '_source';
      await currentMain();
      stage = key + '_inventory';
      if (inventory(target, target.tags) === 'absent') { receipt[key] = 'absent'; return; }
      stage = key + '_identity';
      identity(target, target.tags);
      stage = key + '_archive';
      await restorable(target);
      stage = key + '_consumers';
      unused(target);
      stage = key + '_final_archive';
      await restorable(target);
      stage = key + '_final_inventory';
      if (inventory(target, target.tags) !== 'present') throw Error();
      stage = key + '_final_identity';
      identity(target, target.tags);
      stage = key + '_final_consumers';
      unused(target);
      stage = key + '_final_source';
      await currentMain();
      stage = key + '_removal';
      receipt[key] = 'mutation_unverified';
      // Never remove a mutable tag. A rebound tag cannot redirect this deletion;
      // Docker's no-force protection remains authoritative for raced consumers
      // or added aliases. No application-image retirement exists in this helper.
      docker(['image', 'rm', '--no-prune', target.id]);
      stage = key + '_removal_verification';
      if (inventory(target, []) !== 'absent') throw Error();
      receipt[key] = 'retired';
    };
    const measure = () => {
      const rootOutput = docker(['info', '--format', '{{.DockerRootDir}}']);
      const root = safePath(rootOutput.replace(/\n$/, ''));
      receipt.capacity = { scratchAvailableKiB: availableKiB(df(['-Pk', '--', scratch])), scratchRequiredKiB: required.scratchKiB,
        dockerAvailableKiB: availableKiB(df(['-Pk', '--', root])), dockerRequiredKiB: required.dockerKiB };
      return receipt.capacity.scratchAvailableKiB >= required.scratchKiB && receipt.capacity.dockerAvailableKiB >= required.dockerKiB;
    };
    await retire(BROWSER);
    stage = 'capacity_after_browser';
    if (!measure()) return { ...receipt, reason: 'insufficient_import_space' };
    receipt.result = 'ready';
    return receipt;
  } catch {
    return { ...receipt, reason: 'retirement_' + stage + '_failed' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = process.argv.length === 2 ? await retireR13Browser()
    : { kind: 'r13-browser-retirement', result: 'blocked', reason: 'retirement_arguments_failed' };
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.result !== 'ready') process.exitCode = 2;
}
