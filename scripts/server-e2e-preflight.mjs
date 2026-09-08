import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execute = promisify(execFile);
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const isImage = value => typeof value === 'string' && value.length === 71 && imagePattern.test(value);
const isSha = value => typeof value === 'string' && value.length === 40 && shaPattern.test(value);
const origins = Object.freeze([
  ['arthello', 'https://arthello-188-225-38-55.sslip.io/'],
  ['school', 'https://school-188-225-38-55.sslip.io/'],
]);

// This module inventories prerequisites only. It never logs in, creates accounts,
// reads production containers/volumes/secrets, runs images or writes acceptance.
export function inspectPrerequisites(env) {
  const blockers = [];
  const login = typeof env.ARTHELLO_E2E_LOGIN === 'string' ? env.ARTHELLO_E2E_LOGIN.trim() : '';
  const password = env.ARTHELLO_E2E_PASSWORD;
  if (!login) blockers.push('test_login_missing');
  if (login.toLowerCase() === 'owner') blockers.push('test_login_is_owner');
  if (typeof password !== 'string' || password.length < 12 || password.length > 512) blockers.push('test_password_missing_or_invalid');
  if (env.ARTHELLO_E2E_ACCOUNT_CONFIRMED !== 'dedicated-active-education-account-v1') blockers.push('dedicated_account_unconfirmed');
  if (!isImage(env.ARTHELLO_E2E_IMAGE_ID)) blockers.push('browser_image_unpinned');
  if (!isSha(env.ARTHELLO_E2E_IMAGE_SOURCE_SHA)) blockers.push('browser_source_unpinned');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') blockers.push('tls_verification_disabled');
  return { status: blockers.length ? 'blocked' : 'configured', blockers, liveAcceptance: 'not_run' };
}

export function inspectBrowserImage(value, imageId, sourceSha) {
  const config = value?.Config;
  const labels = config?.Labels;
  const matches = isImage(imageId) && isSha(sourceSha)
    && value?.Id === imageId && value?.Os === 'linux' && value?.Architecture === 'amd64'
    && config?.User === '1000:1000'
    && JSON.stringify(config?.Entrypoint) === JSON.stringify(['node', '/opt/arthello-e2e/run.mjs'])
    && labels?.['org.arthello.role'] === 'e2e-browser'
    && labels?.['org.opencontainers.image.revision'] === sourceSha;
  return {
    status: matches ? 'inventory_match' : 'blocked',
    blockers: matches ? [] : ['browser_image_inventory_mismatch'],
    liveAcceptance: 'not_run',
  };
}

export async function probeOrigins(fetcher = fetch) {
  return Promise.all(origins.map(async ([service, origin]) => {
    try {
      const response = await fetcher(origin, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const code = response.status;
      const status = code >= 200 && code < 300 ? 'responding'
        : code >= 300 && code < 400 ? 'redirect_not_followed' : 'http_error';
      return { service, status, httpStatus: code, liveAcceptance: 'not_run' };
    } catch {
      return { service, status: 'unreachable', liveAcceptance: 'not_run' };
    }
  }));
}

async function main() {
  const configuration = inspectPrerequisites(process.env);
  const report = {
    schemaVersion: 1,
    kind: 'server-browser-prerequisites',
    observedAtUtc: new Date().toISOString(),
    sourceSha: isSha(process.env.CHECKED_SOURCE_SHA) ? process.env.CHECKED_SOURCE_SHA : null,
    status: 'blocked',
    liveAcceptance: 'not_run',
    configuration,
    browserImage: { status: 'not_inspected', liveAcceptance: 'not_run' },
    endpoints: [],
    productionMutations: false,
  };
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') report.endpoints = await probeOrigins();
  if (isImage(process.env.ARTHELLO_E2E_IMAGE_ID) && isSha(process.env.ARTHELLO_E2E_IMAGE_SOURCE_SHA)) {
    try {
      const { stdout } = await execute('docker', ['image', 'inspect', process.env.ARTHELLO_E2E_IMAGE_ID, '--format', '{{json .}}'], {
        timeout: 8000,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH },
      });
      report.browserImage = inspectBrowserImage(JSON.parse(stdout), process.env.ARTHELLO_E2E_IMAGE_ID, process.env.ARTHELLO_E2E_IMAGE_SOURCE_SHA);
    } catch {
      report.browserImage = { status: 'blocked', blockers: ['browser_image_unavailable'], liveAcceptance: 'not_run' };
    }
  }
  if (configuration.status === 'configured' && report.browserImage.status === 'inventory_match'
    && report.endpoints.length === 2 && report.endpoints.every(item => ['responding', 'redirect_not_followed'].includes(item.status))) {
    report.status = 'prerequisites_observed';
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'blocked' ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main().catch(() => {
    process.stdout.write('{"kind":"server-browser-prerequisites","status":"blocked","reason":"preflight_internal_error","liveAcceptance":"not_run","productionMutations":false}\n');
    process.exitCode = 2;
  });
}
