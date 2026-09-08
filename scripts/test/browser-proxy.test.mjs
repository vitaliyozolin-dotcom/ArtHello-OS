import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { allowedConnect, startProxy } from '../../deploy/browser/proxy.mjs';

test('CONNECT destination is exactly one of the two HTTPS authorities', () => {
  assert.equal(allowedConnect('arthello-188-225-38-55.sslip.io:443'), true);
  assert.equal(allowedConnect('school-188-225-38-55.sslip.io:443'), true);
  for (const target of ['169.254.169.254:443','127.0.0.1:443','school-188-225-38-55.sslip.io:80','school-188-225-38-55.sslip.io.attacker.invalid:443','user:password@school-188-225-38-55.sslip.io:443','school-188-225-38-55.sslip.io:443/path']) assert.equal(allowedConnect(target), false);
});
test('real proxy rejects foreign CONNECT without dialing and tunnels an allowed authority', async () => {
  let dials = 0;
  const target = net.createServer(socket => socket.end('fixture-tunnel'));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const proxy = await startProxy(() => { dials++; return net.connect({ host: '127.0.0.1', port: target.address().port }); });
  try {
    const port = Number(new URL(proxy.settings.server).port);
    const connect = authority => new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: authority });
      request.on('connect', (response, socket, head) => {
        let body = head.toString();
        socket.on('data', data => { body += data; });
        socket.on('end', () => { socket.destroy(); resolve({ status: response.statusCode, body }); });
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal((await connect('169.254.169.254:443')).status, 403);
    assert.equal(dials, 0);
    const tunneled = await connect('school-188-225-38-55.sslip.io:443');
    assert.equal(tunneled.status, 200);
    assert.equal(tunneled.body, 'fixture-tunnel');
    assert.equal(dials, 1);
  } finally {
    await proxy.close();
    await new Promise(resolve => target.close(resolve));
  }
});
