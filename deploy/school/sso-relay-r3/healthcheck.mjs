import https from 'node:https';
import { readConfig } from './relay.mjs';

const hostname = 'arthello-188-225-38-55.sslip.io';
const config = readConfig();
const timer = setTimeout(() => process.exit(1), 10000);
const request = https.get({
  hostname, port: 443, path: '/api/health', servername: hostname,
  rejectUnauthorized: true,
  lookup: (_hostname, options, callback) => options?.all
    ? callback(null, [{ address: config.bindAddress, family: 4 }])
    : callback(null, config.bindAddress, 4),
}, response => {
  let bytes = 0;
  const parts = [];
  response.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 16384) request.destroy();
    else parts.push(chunk);
  });
  response.on('end', () => {
    clearTimeout(timer);
    try {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      process.exit(response.statusCode === 200 && body.status === 'ok' ? 0 : 1);
    } catch { process.exit(1); }
  });
  response.on('error', () => process.exit(1));
});
request.on('error', () => process.exit(1));
