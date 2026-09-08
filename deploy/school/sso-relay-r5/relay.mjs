import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const UPSTREAM = Object.freeze({ host: '188.225.38.55', port: 443 });
export const LIMITS = Object.freeze({ connections: 32, bytes: 4 * 1024 * 1024, connectMs: 8000, idleMs: 15000, lifetimeMs: 60000 });

export function readConfig(path = '/relay/runtime.json') {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (Object.keys(config).sort().join(',') !== 'bindAddress,executionUid,schoolAddress,stateDirectorySha256' ||
      !Number.isInteger(config.executionUid) || config.executionUid <= 0 || config.executionUid >= 2**31 ||
      !/^[a-f0-9]{64}$/.test(config.stateDirectorySha256) ||
      !net.isIPv4(config.bindAddress) || !net.isIPv4(config.schoolAddress) ||
      config.bindAddress === config.schoolAddress ||
      config.bindAddress === '0.0.0.0' || config.schoolAddress === '0.0.0.0') {
    throw new Error('Invalid relay runtime configuration');
  }
  return config;
}

// The injected connector/limits are only a local test seam. The executable
// entrypoint below uses the fixed destination and limits, with no env override.
export function createRelay(config, connector = options => net.createConnection(options), limits = LIMITS) {
  let active = 0;
  const pairs = new Set();
  const server = net.createServer({ allowHalfOpen: true }, client => {
    const source = client.remoteAddress;
    if (![config.schoolAddress, config.bindAddress].includes(source) || active >= limits.connections) {
      client.destroy();
      return;
    }
    active += 1;
    let upstream;
    let closed = false;
    let transferred = 0;
    let connectTimer;
    let lifetimeTimer;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(connectTimer);
      clearTimeout(lifetimeTimer);
      client.destroy();
      upstream?.destroy();
      pairs.delete(close);
      active -= 1;
    };
    pairs.add(close);
    const count = buffer => {
      transferred += buffer.length;
      if (transferred > limits.bytes) close();
    };
    const socketClosed = (socket, peer) => {
      // A normal half-close can leave the peer's write queue draining. Let pipe
      // finish/end that queue; force both closed only on failure or after both
      // sockets close. Idle/lifetime/byte limits still bound the draining time.
      if (!socket.readableEnded || !socket.writableFinished || peer?.destroyed) close();
    };
    client.on('error', close);
    client.on('close', () => socketClosed(client, upstream));
    client.on('data', count);
    client.setTimeout(limits.idleMs, close);
    client.pause();
    try {
      upstream = connector({ ...UPSTREAM, allowHalfOpen: true });
      upstream.on('error', close);
      upstream.on('close', () => socketClosed(upstream, client));
      upstream.on('data', count);
      upstream.setTimeout(limits.idleMs, close);
      connectTimer = setTimeout(close, limits.connectMs);
      lifetimeTimer = setTimeout(close, limits.lifetimeMs);
      upstream.once('connect', () => {
        clearTimeout(connectTimer);
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
    } catch {
      close();
    }
  });
  return {
    server,
    close() {
      for (const close of pairs) close();
      server.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  const relay = createRelay(config);
  relay.server.on('error', () => {
    console.error('SCHOOL_ARTHELLO_RELAY=LISTENER_FAILED');
    relay.close();
    process.exitCode = 1;
  });
  relay.server.listen({ host: config.bindAddress, port: 443, exclusive: true }, () => {
    console.log('SCHOOL_ARTHELLO_RELAY=LISTENING');
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => relay.close());
}
