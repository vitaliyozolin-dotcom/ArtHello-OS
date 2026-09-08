import http from 'node:http';
import net from 'node:net';
import { ARTHELLO, SCHOOL } from './flow.mjs';

const allowedAuthorities = new Set([ARTHELLO, SCHOOL].map(origin => new URL(origin).hostname + ':443'));
export function allowedConnect(authority) {
  return typeof authority === 'string' && allowedAuthorities.has(authority);
}

// A CONNECT tunnel does not decrypt, read or log credentials/cookies. It also
// applies to redirects that Chromium follows without invoking route handlers.
// There is no caller-selected production destination or DNS resolution.
export async function startProxy(dial = () => net.connect({ host: '188.225.38.55', port: 443 })) {
  const sockets = new Set();
  const server = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(120000, () => socket.destroy());
  });
  server.on('connect', (request, client, head) => {
    if (!allowedConnect(request.url)) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstream = dial();
    sockets.add(upstream);
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    upstream.setTimeout(120000, () => upstream.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    settings: { server: 'http://127.0.0.1:' + server.address().port, bypass: '<-loopback>' },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
