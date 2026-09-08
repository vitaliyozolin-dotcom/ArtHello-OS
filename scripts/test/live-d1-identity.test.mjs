import test from 'node:test';
import assert from 'node:assert/strict';
import { scanLiveD1 } from '../live-d1-identity.mjs';

const path = '/data/d1/miniflare-D1DatabaseObject/' + 'a'.repeat(64) + '.sqlite';
const enoent = () => Object.assign(new Error('PRIVATE-PATH'), { code: 'ENOENT' });
function fixture({ targets = [path, path + '-wal'], uid = 1000, pidUid = 1000, denied = false } = {}) {
  return {
    getuid: () => uid,
    readFileSync: () => `Name:\tapp\nUid:\t${pidUid}\t${pidUid}\t${pidUid}\t${pidUid}\n`,
    readdirSync: p => {
      if (p === '/proc') return ['1', '4', 'self'];
      if (p === '/proc/4/fd') throw enoent();
      if (denied) throw Object.assign(new Error('PRIVATE'), { code: 'EACCES' });
      return targets.map((_, i) => String(i));
    },
    readlinkSync: p => targets[Number(p.split('/').at(-1))],
  };
}

test('exact live handles accepted; ordinary process exit during scan is tolerated', () => {
  const report = scanLiveD1(path, fixture());
  assert.equal(report.status, 'verified');
  assert.equal(report.expectedHandles, 2);
  assert.equal(report.disappearedProcesses, 1);
});
test('idle/no handles and other D1 identity are distinct refusals', () => {
  assert.equal(scanLiveD1(path, fixture({ targets: [] })).reason, 'expected_handle_absent');
  const other = path.replace('a'.repeat(64), 'b'.repeat(64));
  assert.equal(scanLiveD1(path, fixture({ targets: [path, other] })).reason, 'unexpected_database_handle');
  assert.equal(scanLiveD1(path, fixture({ targets: [path + ' (deleted)'] })).reason, 'unexpected_database_handle');
});
test('root, mismatched UID and inaccessible descriptors fail closed without raw errors', () => {
  for (const config of [{ uid: 0 }, { pidUid: 0 }, { denied: true }]) {
    const report = scanLiveD1(path, fixture(config));
    assert.equal(report.status, 'blocked');
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  }
});
test('only exact metadata files are exempt; WAL and SHM are recognized', () => {
  const metadata = '/data/d1/miniflare-D1DatabaseObject/metadata.sqlite';
  assert.equal(scanLiveD1(path, fixture({ targets: [path + '-shm', metadata] })).status, 'verified');
  assert.equal(scanLiveD1(path, fixture({ targets: [path, metadata + '.other'] })).reason, 'unexpected_database_handle');
});
test('invalid expected path fails before proc access', () => {
  const report = scanLiveD1('/private', { getuid() { throw new Error(); } });
  assert.equal(report.reason, 'invalid_expected_path');
});

test('inventory limits and descriptor permission errors do not pass as partial scans', () => {
  const crowded = fixture();
  crowded.readdirSync = () => Array.from({ length: 257 }, (_, i) => String(i + 1));
  assert.equal(scanLiveD1(path, crowded).reason, 'process_inventory_invalid');
  const many = fixture();
  many.readdirSync = p => p === '/proc' ? ['1'] : Array.from({ length: 8193 }, (_, i) => String(i));
  assert.equal(scanLiveD1(path, many).reason, 'descriptor_inventory_limit');
  const denied = fixture();
  denied.readlinkSync = () => { throw Object.assign(new Error('PRIVATE'), { code: 'EACCES' }); };
  assert.equal(scanLiveD1(path, denied).reason, 'descriptor_unreadable');
});
