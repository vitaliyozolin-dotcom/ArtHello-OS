import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// D084 retires only the exact unused, recoverable R9 browser image.
// No current-image mode, caller-selected target, force or broad cleanup exists.
const OLD_ID = 'sha256:413b76d9ca6024d9ecc229f9d5b16810f5b9a50861f984e0ecb925020209e4ef';
const OLD_SOURCE = '30f825d674cbf498be713c7b637e1dfd9f9c42cd';
const OLD_TAG = 'arthello-e2e:30f825d674cbf498be713c7b637e1dfd9f9c42cd';
const OLD_FINGERPRINT = 'b1d04b748b75b1283502aca1faef903dbcc7e1fed258e7ad4419ba67076153c5';
const MAIN_PATH = '/git/ref/heads/main';
const ARCHIVE_PATH = '/actions/artifacts/10091157744';
const processOptions = { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };

function runDocker(args) {
  return execFileSync('docker', args, processOptions);
}

function imageFingerprint(snapshot) {
  const filter = fileURLToPath(new URL('../v52/maintenance/image-runtime-fingerprint.jq', import.meta.url));
  const canonical = execFileSync('jq', ['-cS', '-f', filter], { ...processOptions, stdio: ['pipe', 'pipe', 'pipe'], input: JSON.stringify(snapshot) });
  return createHash('sha256').update(canonical).digest('hex');
}

async function readGitHub(path) {
  const token = process.env.GH_TOKEN;
  if (!token || ![MAIN_PATH, ARCHIVE_PATH].includes(path)) throw Error();
  const response = await fetch('https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS' + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error();
  return response.json();
}

function retirementImageMatches(snapshot, target) {
  if (!Array.isArray(snapshot) || snapshot.length !== 1) return false;
  const image = snapshot[0];
  return image?.Id === target.id
    && Array.isArray(image.RepoTags) && image.RepoTags.length === 1 && image.RepoTags[0] === target.tag
    && Array.isArray(image.RepoDigests) && (image.RepoDigests.length === 0
      || (image.RepoDigests.length === 1 && image.RepoDigests[0] === 'arthello-e2e@' + target.id))
    && image.Config?.User === '1000:1000'
    && image.Config.Labels?.['org.arthello.role'] === 'e2e-browser'
    && image.Config.Labels?.['org.opencontainers.image.revision'] === target.source;
}

function restorableArchiveMatches(archive, now) {
  const run = archive?.workflow_run;
  return archive?.id === 10091157744
    && archive.name === 'server-browser-30f825d674cbf498be713c7b637e1dfd9f9c42cd-34318973875-1'
    && archive.size_in_bytes === 640809272
    && archive.digest === 'sha256:9cfcd718f3bf69a8cb682092ee4ecdfef6bf5803cfb8fa976214db69f5b27274'
    && archive.expired === false && Date.parse(archive.expires_at) > now
    && run?.id === 34318973875 && run.repository_id === 1311964413 && run.head_repository_id === 1311964413
    && run.head_branch === 'main' && run.head_sha === OLD_SOURCE;
}

function parseImageIds(output) {
  const values = output.trim() ? output.trim().split(/\s+/) : [];
  if (values.some(value => !/^sha256:[a-f0-9]{64}$/.test(value))) throw Error();
  return new Set(values);
}

// Dependencies are an in-process test seam. The CLI has no target, token, digest
// or command override arguments; only the existing protected GH_TOKEN is read.
async function retireTarget(target, dependencies) {
  const docker = dependencies.docker ?? runDocker;
  const github = dependencies.readGitHub ?? readGitHub;
  const fingerprint = dependencies.fingerprint ?? imageFingerprint;
  const now = dependencies.now ?? Date.now;
  const checkedSource = dependencies.checkedSource ?? process.env.CHECKED_SOURCE_SHA;
  let stage = 'source';
  const requireCurrentMain = async () => {
    if (!/^[a-f0-9]{40}$/.test(checkedSource ?? '') || checkedSource === OLD_SOURCE) throw Error();
    if ((await github(MAIN_PATH))?.object?.sha !== checkedSource) throw Error();
  };
  const inventory = () => {
    // A failed inspect is never interpreted as absence. Successful ID-only and
    // exact-tag listings must both agree; unrelated image metadata is not read.
    const ids = parseImageIds(docker(['image', 'ls', '--all', '--no-trunc', '--quiet']));
    const tagged = parseImageIds(docker(['image', 'ls', '--all', '--no-trunc', '--quiet', '--filter', 'reference=' + target.tag]));
    if (!ids.has(target.id) && tagged.size === 0) return 'absent';
    if (!ids.has(target.id) || tagged.size !== 1 || !tagged.has(target.id)) throw Error();
    return 'present';
  };
  const requireIdentity = () => {
    for (const reference of [target.id, target.tag]) {
      const snapshot = JSON.parse(docker(['image', 'inspect', reference]));
      if (!retirementImageMatches(snapshot, target) || fingerprint(snapshot) !== target.fingerprint) throw Error();
    }
  };
  const requireUnused = () => {
    if (docker(['ps', '-a', '-q', '--no-trunc', '--filter', 'ancestor=' + target.id]).trim()) throw Error();
  };
  try {
    await requireCurrentMain();
    stage = 'inventory';
    if (inventory() === 'absent') return { kind: 'server-browser-image-retirement', result: 'absent' };
    stage = 'image_identity';
    requireIdentity();
    stage = 'restorable_archive';
    if (!target.restorable(await github(target.archivePath), now())) throw Error();
    stage = 'container_references';
    requireUnused();
    stage = 'final_image_identity';
    requireIdentity();
    stage = 'final_container_references';
    requireUnused();
    stage = 'final_source';
    await requireCurrentMain();
    stage = 'removal';
    // Immutable ID, no force and no parent pruning. Daemon conflict protection
    // remains authoritative if a container or another tag appears after checks.
    docker(['image', 'rm', '--no-prune', target.id]);
    stage = 'removal_verification';
    if (inventory() !== 'absent') throw Error();
    return { kind: 'server-browser-image-retirement', result: 'retired' };
  } catch {
    // Do not access or format exceptions, daemon output, image env or API bodies.
    return { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_' + stage + '_failed' };
  }
}

export async function retireR9BrowserImage(dependencies = {}) {
  return retireTarget({ id: OLD_ID, source: OLD_SOURCE, tag: OLD_TAG, fingerprint: OLD_FINGERPRINT, archivePath: ARCHIVE_PATH, restorable: restorableArchiveMatches }, dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = process.argv.length === 2 ? await retireR9BrowserImage()
    : { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_arguments_failed' };
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.result === 'blocked') process.exitCode = 2;
}

