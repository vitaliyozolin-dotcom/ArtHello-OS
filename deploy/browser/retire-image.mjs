import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// D079 retires one exact predecessor and this canonical job's verified output.
// There is no caller-selected image or general cleanup selector in the CLI.
const OLD_ID = 'sha256:0763e7e6404c4ecf19b81bdcc236dd815a0210e9bb6b087adec279692cc7701c';
const OLD_SOURCE = '5385090d48f4dae29c314dff7ae974d854560940';
const OLD_TAG = 'arthello-e2e:5385090d48f4dae29c314dff7ae974d854560940';
const OLD_FINGERPRINT = '5970abba2518f5fc1f3bb27ef2624570e8050cbc606a3cb300f596031c26564e';
const MAIN_PATH = '/git/ref/heads/main';
const ARCHIVE_PATH = '/actions/artifacts/10078598718';
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
  if (!token || !([MAIN_PATH, ARCHIVE_PATH].includes(path) || /^\/actions\/runs\/[1-9][0-9]*\/artifacts\?per_page=100$/.test(path))) throw Error();
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
    && Array.isArray(image.RepoDigests) && image.RepoDigests.length === 0
    && image.Config?.User === '1000:1000'
    && image.Config.Labels?.['org.arthello.role'] === 'e2e-browser'
    && image.Config.Labels?.['org.opencontainers.image.revision'] === target.source;
}

function restorableArchiveMatches(archive, now) {
  const run = archive?.workflow_run;
  return archive?.id === 10078598718
    && archive.name === 'server-browser-5385090d48f4dae29c314dff7ae974d854560940-34283447507-1'
    && archive.size_in_bytes === 640791883
    && archive.digest === 'sha256:e7a77316e647ba17a8e232d1b060d2c02f73ef2cfbdfe769b99cc01e841fc140'
    && archive.expired === false && Date.parse(archive.expires_at) > now
    && run?.id === 34283447507 && run.repository_id === 1311964413 && run.head_repository_id === 1311964413
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

export async function retirePreviousBrowserImage(dependencies = {}) {
  return retireTarget({ id: OLD_ID, source: OLD_SOURCE, tag: OLD_TAG, fingerprint: OLD_FINGERPRINT, archivePath: ARCHIVE_PATH, restorable: restorableArchiveMatches }, dependencies);
}

export async function retireCurrentBrowserImage(dependencies = {}) {
  try {
    const input = dependencies.environment ?? process.env;
    const source = dependencies.checkedSource ?? input.CHECKED_SOURCE_SHA;
    const id = input.BROWSER_IMAGE_ID;
    const fingerprint = input.EXPECTED_BROWSER_FINGERPRINT;
    const run = input.GITHUB_RUN_ID;
    const attempt = input.GITHUB_RUN_ATTEMPT;
    if (!/^[a-f0-9]{40}$/.test(source ?? '') || source === OLD_SOURCE
      || !/^sha256:[a-f0-9]{64}$/.test(id ?? '') || id === OLD_ID
      || !/^[a-f0-9]{64}$/.test(fingerprint ?? '')
      || !/^[1-9][0-9]*$/.test(run ?? '') || !Number.isSafeInteger(Number(run))
      || !/^[1-9][0-9]*$/.test(attempt ?? '') || !Number.isSafeInteger(Number(attempt))) throw Error();
    const archiveName = input.BROWSER_ARCHIVE_NAME;
    const prefix = 'server-browser-' + source + '-' + run + '-';
    const producerAttempt = typeof archiveName === 'string' && archiveName.startsWith(prefix) ? archiveName.slice(prefix.length) : '';
    if (!/^[1-9][0-9]*$/.test(producerAttempt) || !Number.isSafeInteger(Number(producerAttempt)) || Number(producerAttempt) > Number(attempt)) throw Error();
    const restorable = (response, now) => {
      if (!Array.isArray(response?.artifacts) || response.total_count !== response.artifacts.length || response.artifacts.length > 100) return false;
      const matches = response.artifacts.filter(artifact => artifact?.name === archiveName);
      if (matches.length !== 1) return false;
      const artifact = matches[0];
      const producer = artifact.workflow_run;
      return Number.isSafeInteger(artifact.id) && artifact.id > 0
        && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0
        && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
        && artifact.expired === false && Date.parse(artifact.expires_at) > now
        && producer?.id === Number(run) && producer.repository_id === 1311964413 && producer.head_repository_id === 1311964413
        && producer.head_branch === 'main' && producer.head_sha === source;
    };
    return await retireTarget({ id, source, tag: 'arthello-e2e:' + source, fingerprint, archivePath: '/actions/runs/' + run + '/artifacts?per_page=100', restorable }, { ...dependencies, checkedSource: source });
  } catch {
    return { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_current_inputs_failed' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const result = args.length === 0 ? await retirePreviousBrowserImage()
    : args.length === 1 && args[0] === '--current' ? await retireCurrentBrowserImage()
      : { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_arguments_failed' };
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.result === 'blocked') process.exitCode = 2;
}
