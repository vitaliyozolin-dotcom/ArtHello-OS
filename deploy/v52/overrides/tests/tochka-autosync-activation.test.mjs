import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasTochkaAutosyncActivation, startTochkaAutosyncTimer } from '../production/tochka-autosync-timer.mjs';
import { patchTochkaAutosyncRuntime } from '../scripts/patch-tochka-autosync.mjs';

const releaseSha = '1'.repeat(40);
const activationId = '2'.repeat(32);
const nextActivationId = '3'.repeat(32);
const marker = (sha = releaseSha, id = activationId) => `ARTHELLO_TOCHKA_AUTOSYNC_V1 ${sha} ${id}\n`;

async function files(t) {
  const directory = await mkdtemp(join(tmpdir(), 'arthello-activation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const markerPath = join(directory, 'tochka-autosync.activation');
  const write = async (content = marker(), mode = 0o640) => {
    await chmod(markerPath, 0o600).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await writeFile(markerPath, content, { mode });
    await chmod(markerPath, mode);
  };
  return { directory, markerPath, write,
    active: (extra = {}) => hasTochkaAutosyncActivation({ releaseSha, activationId, markerPath, ...extra }) };
}

test('real host marker activates only its exact release and fresh deployment ID', async t => {
  const f = await files(t);
  assert.equal(await f.active(), false);
  await f.write();
  assert.equal(await f.active(), true);
  assert.equal(await f.active({ releaseSha: '4'.repeat(40) }), false);
  assert.equal(await f.active({ activationId: nextActivationId }), false);
  await f.write(marker(releaseSha, nextActivationId));
  assert.equal(await f.active(), false);
  assert.equal(await f.active({ activationId: nextActivationId }), true);
});

test('invalid identities reject before opening any host path', async () => {
  for (const bad of ['', undefined, 'A'.repeat(40), '1'.repeat(39), '../' + '1'.repeat(37)]) {
    assert.equal(await hasTochkaAutosyncActivation({ releaseSha: bad, activationId,
      openMarker: async () => assert.fail('invalid release identity must not read filesystem') }), false);
  }
  for (const bad of ['', undefined, 'A'.repeat(32), '2'.repeat(31), '2'.repeat(33)]) {
    assert.equal(await hasTochkaAutosyncActivation({ releaseSha, activationId: bad,
      openMarker: async () => assert.fail('invalid activation identity must not read filesystem') }), false);
  }
});

test('malformed, overlong, partial and JSON markers never activate', async t => {
  const f = await files(t);
  for (const content of ['', marker().trimEnd(), marker() + '\n', marker().replace('_V1', '_V2'),
    marker().replace(/\n$/, '\r\n'), 'x'.repeat(161), JSON.stringify({ releaseSha, activationId, activated: true })]) {
    await f.write(content);
    assert.equal(await f.active(), false);
  }
});

test('real symlinks, directories and unsafe modes fail closed', async t => {
  const f = await files(t);
  const target = join(f.directory, 'target');
  await writeFile(target, marker(), { mode: 0o640 });
  await symlink(target, f.markerPath);
  assert.equal(await f.active(), false);
  await rm(f.markerPath); await mkdir(f.markerPath);
  assert.equal(await f.active(), false);
  await rm(f.markerPath, { recursive: true });
  for (const mode of [0o644, 0o660, 0o666, 0o600, 0o440]) {
    await f.write(marker(), mode); assert.equal(await f.active(), false);
  }
});

test('non-root descriptor metadata rejects before content read and always closes the handle', async () => {
  let closed = false;
  assert.equal(await hasTochkaAutosyncActivation({ releaseSha, activationId, openMarker: async () => ({
    stat: async () => ({ isFile: () => true, uid: 65534, mode: 0o100640, size: Buffer.byteLength(marker()) }),
    read: async () => assert.fail('non-root marker content must not be read'),
    close: async () => { closed = true; },
  }) }), false);
  assert.equal(closed, true);
});

test('atomic activation replacement and marker removal are observed on subsequent reads', async t => {
  const f = await files(t);
  await f.write(marker(releaseSha, nextActivationId));
  assert.equal(await f.active(), false);
  const staged = join(f.directory, 'new-marker');
  await writeFile(staged, marker(), { mode: 0o640 });
  await rename(staged, f.markerPath);
  assert.equal(await f.active(), true);
  await rm(f.markerPath);
  assert.equal(await f.active(), false);
});

test('candidate env enabled produces zero dispatches before marker publication, then honors removal', async t => {
  const f = await files(t); const timers = []; const calls = []; const logs = [];
  const control = startTochkaAutosyncTimer({ enabled: true, releaseSha, activationId,
    secret: 'a'.repeat(64), publicOrigin: 'https://example.test',
    isActivated: () => f.active(),
    runtime: { async dispatchFetch() { calls.push('dispatch'); return Response.json({ outcome: 'not_due', ran: false }); } },
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return {}; }, clearTimer() {}, log: value => logs.push(value) });
  assert.equal(timers[0].delay, 30_000);
  await timers[0].fn(); assert.equal(calls.length, 0);
  await f.write(marker(releaseSha, nextActivationId));
  await timers[1].fn(); assert.equal(calls.length, 0);
  await f.write();
  await timers[2].fn(); assert.equal(calls.length, 1);
  await rm(f.markerPath);
  await timers[3].fn(); assert.equal(calls.length, 1);
  assert.deepEqual(logs, []);
  control.stop();
});

test('disabled clone does not inspect markers and stop during an async gate prevents dispatch', async () => {
  let tick; let releaseGate;
  const input = { secret: 'a'.repeat(64), publicOrigin: 'https://example.test',
    runtime: { dispatchFetch: () => assert.fail('inactive process cannot dispatch') },
    setTimer: fn => { tick = fn; return {}; }, clearTimer() {},
    isActivated: () => assert.fail('disabled clone cannot read the host activation marker') };
  startTochkaAutosyncTimer({ ...input, enabled: false }); assert.equal(tick, undefined);
  const timer = startTochkaAutosyncTimer({ ...input, enabled: true,
    isActivated: () => new Promise(resolve => { releaseGate = resolve; }) });
  const running = tick(); timer.stop(); releaseGate(true); await running;
});

test('runtime patch passes only exact process release and activation identities to the host timer', () => {
  const source = 'const runtime = new Miniflare({\n    TBANK_EGRESS_IP: process.env.TBANK_EGRESS_IP || "",\n});\nasync function shutdown() {}';
  const patched = patchTochkaAutosyncRuntime(source);
  assert.match(patched, /releaseSha: process\.env\.RELEASE_SHA \|\| ""/);
  assert.match(patched, /activationId: process\.env\.TOCHKA_AUTOSYNC_ACTIVATION_ID \|\| ""/);
  assert.equal(patchTochkaAutosyncRuntime(patched), patched);
});
