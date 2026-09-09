import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, chown, link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasTochkaAutosyncActivation, startTochkaAutosyncTimer } from '../production/tochka-autosync-timer.mjs';
import { patchTochkaAutosyncRuntime } from '../scripts/patch-tochka-autosync.mjs';

const releaseSha = '1'.repeat(40);
const activationId = '2'.repeat(64);
const nextActivationId = '3'.repeat(64);
const marker = (sha = releaseSha, id = activationId) => `ARTHELLO_TOCHKA_AUTOSYNC_V2 ${sha} ${id}\n`;

async function files(t) {
  const directory = await mkdtemp(join(tmpdir(), 'arthello-activation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  try { await chown(directory, 1002, 1000); } catch (error) {
    if (process.env.ARTHELLO_ACTIVATION_MODEL_ONLY !== '1' || !['EINVAL','EPERM'].includes(error.code)) throw error;
    t.skip('Local UID namespace cannot represent writer UID1002; real authority tests remain mandatory in hosted Docker'); return null;
  }
  await chmod(directory, 0o750);
  const markerPath = join(directory, 'tochka-autosync.activation');
  const write = async (content = marker(), mode = 0o640) => {
    await chmod(markerPath, 0o600).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await writeFile(markerPath, content, { mode });
    await chmod(markerPath, mode);
    await chown(markerPath, 1002, 1000);
  };
  return { directory, markerPath, write,
    active: (extra = {}) => hasTochkaAutosyncActivation({ releaseSha, activationId, markerPath, ...extra }) };
}

test('real isolated-writer marker activates only its exact release and fresh deployment ID', async t => {
  const f = await files(t); if (!f) return;
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
  for (const bad of ['', undefined, 'A'.repeat(64), '2'.repeat(32), '2'.repeat(63), '2'.repeat(65)]) {
    assert.equal(await hasTochkaAutosyncActivation({ releaseSha, activationId: bad,
      openMarker: async () => assert.fail('invalid activation identity must not read filesystem') }), false);
  }
});

test('malformed, overlong, partial and JSON markers never activate', async t => {
  const f = await files(t); if (!f) return;
  for (const content of ['', marker().trimEnd(), marker() + '\n', marker().replace('_V2', '_V1'),
    marker().replace(/\n$/, '\r\n'), 'x'.repeat(161), JSON.stringify({ releaseSha, activationId, activated: true })]) {
    await f.write(content);
    assert.equal(await f.active(), false);
  }
});

test('real symlinks, directories and unsafe modes fail closed', async t => {
  const f = await files(t); if (!f) return;
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

test('wrong UID, GID, hardlinks and unsafe metadata reject before content read and close both handles', async () => {
  for (const extra of [{ uid: 0 }, { uid: 1000 }, { uid: 65534 }, { gid: 0 }, { gid: 1002 }, { nlink: 2 }, { nlink: 0 }, { mode: 0o100660 }, { size: 161 }]) {
    let closed = 0;
    assert.equal(await hasTochkaAutosyncActivation({ releaseSha, activationId,
      openDirectory: async () => ({ stat: async () => ({ isDirectory: () => true, uid: 1002, gid: 1000, mode: 0o40750 }), close: async () => { closed++; } }),
      openMarker: async () => ({
        stat: async () => ({ isFile: () => true, uid: 1002, gid: 1000, nlink: 1, mode: 0o100640, size: Buffer.byteLength(marker()), ...extra }),
        read: async () => assert.fail('untrusted marker content must not be read'),
        close: async () => { closed++; },
      }) }), false);
    assert.equal(closed, 2);
  }
});

test('marker descriptor changing during its read fails closed', async () => {
  let reads = 0;
  assert.equal(await hasTochkaAutosyncActivation({ releaseSha, activationId,
    openDirectory: async () => ({ stat: async () => ({ isDirectory: () => true, uid: 1002, gid: 1000, mode: 0o40750 }), close: async () => {} }),
    openMarker: async () => ({
      stat: async () => ({ isFile: () => true, uid: 1002, gid: 1000, nlink: 1, mode: 0o100640, size: Buffer.byteLength(marker()), dev: 1, ino: 1, mtimeMs: ++reads, ctimeMs: 1 }),
      read: async bytes => { bytes.write(marker()); return { bytesRead: Buffer.byteLength(marker()) }; }, close: async () => {},
    }) }), false);
});

test('real root or application-owned files, hardlinks and writable parent directories cannot authorize the timer', async t => {
  const f = await files(t); if (!f) return;
  await f.write();
  for (const [uid,gid] of [[0,0],[1000,1000],[1002,1002]]) {
    await chown(f.markerPath, uid, gid); assert.equal(await f.active(), false);
  }
  await chown(f.markerPath,1002,1000);
  const second = join(f.directory,'other-link'); await link(f.markerPath,second);
  assert.equal(await f.active(),false); await rm(second);
  await chmod(f.directory,0o770); assert.equal(await f.active(),false);
  await chmod(f.directory,0o750); await chown(f.directory,1000,1000); assert.equal(await f.active(),false);
});

test('atomic activation replacement and marker removal are observed on subsequent reads', async t => {
  const f = await files(t); if (!f) return;
  await f.write(marker(releaseSha, nextActivationId));
  assert.equal(await f.active(), false);
  const staged = join(f.directory, 'new-marker');
  await writeFile(staged, marker(), { mode: 0o640 });
  await chown(staged, 1002, 1000);
  await rename(staged, f.markerPath);
  assert.equal(await f.active(), true);
  await rm(f.markerPath);
  assert.equal(await f.active(), false);
});

test('candidate env enabled produces zero dispatches before marker publication, then honors removal', async t => {
  const f = await files(t); if (!f) return; const timers = []; const calls = []; const logs = [];
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

// Portable descriptor protocol model is separate from real UID filesystem fixtures.
test('descriptor protocol model accepts only exact V2 content and checks parent and marker every call', async () => {
  let directoryOpens=0;let markerOpens=0;let closes=0;
  const validate=content=>hasTochkaAutosyncActivation({releaseSha,activationId,
    openDirectory:async()=>{directoryOpens++;return {stat:async()=>({isDirectory:()=>true,uid:1002,gid:1000,mode:0o40750}),close:async()=>{closes++;}};},
    openMarker:async()=>{markerOpens++;return {
      stat:async()=>({isFile:()=>true,uid:1002,gid:1000,nlink:1,mode:0o100640,size:Buffer.byteLength(content),dev:1,ino:1,mtimeMs:1,ctimeMs:1}),
      read:async bytes=>{bytes.write(content);return {bytesRead:Buffer.byteLength(content)};},close:async()=>{closes++;},
    };}});
  assert.equal(await validate(marker()),true);
  assert.equal(await validate(marker().replace('_V2','_V1')),false);
  assert.equal(await validate(marker(releaseSha,nextActivationId)),false);
  assert.equal(await validate(marker()),true);
  assert.equal(directoryOpens,4);assert.equal(markerOpens,4);assert.equal(closes,8);
});

test('untrusted parent metadata rejects before the marker is opened', async () => {
  for (const extra of [{uid:0},{uid:1000},{gid:0},{mode:0o40770},{isDirectory:()=>false}]) {
    let closed=false;
    assert.equal(await hasTochkaAutosyncActivation({releaseSha,activationId,
      openDirectory:async()=>({stat:async()=>({isDirectory:()=>true,uid:1002,gid:1000,mode:0o40750,...extra}),close:async()=>{closed=true;}}),
      openMarker:async()=>assert.fail('untrusted parent cannot authorize opening a marker')}),false);
    assert.equal(closed,true);
  }
});
