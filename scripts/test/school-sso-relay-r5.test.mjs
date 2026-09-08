import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createRelay, readConfig, UPSTREAM, LIMITS } from '../../deploy/school/sso-relay-r5/relay.mjs';

const config = { bindAddress: '127.0.0.1', schoolAddress: '127.0.0.2' };
const short = { ...LIMITS, connectMs: 100, idleMs: 150, lifetimeMs: 500 };
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function connect(port, localAddress = '127.0.0.2') {
  const socket = net.connect({ host: '127.0.0.1', port, localAddress, allowHalfOpen: false });
  socket.on('error', () => {});
  await once(socket, 'connect');
  return socket;
}
function collect(socket) {
  const chunks = [];
  socket.on('data', chunk => chunks.push(chunk));
  return once(socket, 'close').then(() => Buffer.concat(chunks));
}

test('fixed destination receives unchanged bytes and half-close response', { timeout: 2000 }, async t => {
  const peer = net.createServer({ allowHalfOpen: true }, socket => {
    const chunks = [];
    socket.on('data', c => chunks.push(c));
    socket.on('end', () => socket.end(Buffer.concat(chunks)));
  });
  const peerPort = await listen(peer);
  t.after(() => peer.close());
  const relay = createRelay(config, options => {
    assert.deepEqual(options, { ...UPSTREAM, allowHalfOpen: true });
    return net.connect({ host: '127.0.0.1', port: peerPort, allowHalfOpen: true });
  }, short);
  t.after(() => relay.close());
  const port = await listen(relay.server);
  const client = await connect(port);
  const received = collect(client);
  const bytes = Buffer.from([0x16, 0x03, 0x01, 0x00, 0xff, 0x00, 0xab]);
  client.end(bytes);
  assert.deepEqual(await received, bytes);
});

test('foreign backend source is rejected before any upstream connection', { timeout: 2000 }, async t => {
  let calls = 0;
  const relay = createRelay(config, () => { calls++; throw new Error('must not connect'); }, short);
  t.after(() => relay.close());
  const client = await connect(await listen(relay.server), '127.0.0.3');
  await collect(client);
  assert.equal(calls, 0);
});

test('connection cap and connect timeout release all accepted sockets', { timeout: 2000 }, async t => {
  const pending = [];
  const relay = createRelay(config, () => { const s = new net.Socket(); pending.push(s); return s; }, { ...short, connections: 1 });
  t.after(() => relay.close());
  const port = await listen(relay.server);
  const first = await connect(port);
  const firstClosed = collect(first);
  const second = await connect(port);
  await collect(second);
  assert.equal(pending.length, 1);
  await firstClosed;
  assert.equal(pending[0].destroyed, true);
  const third = await connect(port);
  await collect(third);
  assert.equal(pending.length, 2);
});

test('byte limit closes both sockets', { timeout: 2000 }, async t => {
  let peerSocket;
  const peer = net.createServer(socket => { peerSocket = socket; socket.on('error', () => {}); });
  const peerPort = await listen(peer);
  t.after(() => { peerSocket?.destroy(); peer.close(); });
  const relay = createRelay(config, () => net.connect(peerPort, '127.0.0.1'), { ...short, bytes: 8 });
  t.after(() => relay.close());
  const client = await connect(await listen(relay.server));
  const closed = collect(client);
  client.write('more than eight bytes');
  await closed;
});

test('idle timeout destroys an established upstream and permits a new connection', { timeout: 2000 }, async t => {
  const peerSockets = new Set();
  const peer = net.createServer(socket => { peerSockets.add(socket); socket.on('error', () => {}); socket.on('close', () => peerSockets.delete(socket)); });
  const peerPort = await listen(peer);
  t.after(() => { for (const socket of peerSockets) socket.destroy(); peer.close(); });
  let calls = 0;
  const relay = createRelay(config, () => { calls++; return net.connect(peerPort, '127.0.0.1'); }, { ...short, connections: 1 });
  t.after(() => relay.close());
  const port = await listen(relay.server);
  await collect(await connect(port));
  await collect(await connect(port));
  assert.equal(calls, 2);
});

test('lifetime limit closes a connection even with continued traffic', { timeout: 2000 }, async t => {
  const peerSockets = new Set();
  const peer = net.createServer(socket => { peerSockets.add(socket); socket.on('data', data => socket.write(data)); socket.on('error', () => {}); socket.on('close', () => peerSockets.delete(socket)); });
  const peerPort = await listen(peer);
  t.after(() => { for (const socket of peerSockets) socket.destroy(); peer.close(); });
  const relay = createRelay(config, () => net.connect(peerPort, '127.0.0.1'), { ...short, idleMs: 1000, lifetimeMs: 100 });
  t.after(() => relay.close());
  const client = await connect(await listen(relay.server));
  const closed = collect(client);
  const interval = setInterval(() => client.write('ping'), 10);
  t.after(() => clearInterval(interval));
  await closed;
  assert.ok(client.destroyed);
});

test('connector error closes client and releases the connection slot', { timeout: 2000 }, async t => {
  let calls = 0;
  const relay = createRelay(config, () => { calls++; throw new Error('unavailable'); }, { ...short, connections: 1 });
  t.after(() => relay.close());
  const port = await listen(relay.server);
  await collect(await connect(port));
  await collect(await connect(port));
  assert.equal(calls, 2);
});

test('backpressure preserves a bounded response before peer closes', { timeout: 5000 }, async t => {
  const bytes = Buffer.alloc(3 * 1024 * 1024, 0xab);
  const peer = net.createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {});
    socket.on('data', () => {});
    socket.on('end', () => socket.end(bytes));
  });
  const peerPort = await listen(peer);
  t.after(() => peer.close());
  const relay = createRelay(config, () => net.connect({ host: '127.0.0.1', port: peerPort, allowHalfOpen: true }),
    { ...LIMITS, idleMs: 3000, lifetimeMs: 4000 });
  t.after(() => relay.close());
  const client = await connect(await listen(relay.server));
  const received = collect(client);
  client.pause();
  client.end('request');
  setTimeout(() => client.resume(), 150);
  assert.deepEqual(await received, bytes);
});


test('runtime metadata binds the ordinary deployment UID and fixed state path digest', t => {
  const directory = mkdtempSync(join(tmpdir(), 'school-r3-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'runtime.json');
  const expected = { ...config, executionUid: 1001, stateDirectorySha256: 'a'.repeat(64) };
  writeFileSync(path, JSON.stringify(expected));
  assert.deepEqual(readConfig(path), expected);
});

test('runtime metadata rejects root UID, invalid path digest and unexpected keys', t => {
  const directory = mkdtempSync(join(tmpdir(), 'school-r3-invalid-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'runtime.json');
  const expected = { ...config, executionUid: 1001, stateDirectorySha256: 'a'.repeat(64) };
  for (const changed of [{ executionUid: 0 }, { executionUid: -1 }, { stateDirectorySha256: 'invalid' }, { upstream: 'elsewhere' }]) {
    writeFileSync(path, JSON.stringify({ ...expected, ...changed }));
    assert.throws(() => readConfig(path), /Invalid relay runtime configuration/);
  }
});
