import * as fs from 'node:fs';

const root = '/data/d1/miniflare-D1DatabaseObject/';
export function scanLiveD1(expected, io = { ...fs, getuid: () => process.getuid() }) {
  const report = { schemaVersion: 1, status: 'blocked', reason: 'scanner_failed',
    expectedHandles: 0, unexpectedHandles: 0, disappearedProcesses: 0,
    disappearedHandles: 0, processCount: 0, descriptorCount: 0 };
  const stop = reason => ({ ...report, reason });
  if (!/^\/data\/d1\/miniflare-D1DatabaseObject\/[a-f0-9]{64}\.sqlite$/.test(expected || '')) {
    return stop('invalid_expected_path');
  }
  try {
    if (io.getuid() !== 1000) return stop('scanner_uid_mismatch');
    const status = io.readFileSync('/proc/1/status', 'utf8');
    const ids = status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
    if (!ids || ids.slice(1).some(id => id !== '1000')) return stop('application_uid_mismatch');
    const processes = io.readdirSync('/proc').filter(name => /^\d+$/.test(name));
    if (!processes.includes('1') || processes.length > 256) return stop('process_inventory_invalid');
    for (const pid of processes) {
      let descriptors;
      try { descriptors = io.readdirSync(`/proc/${pid}/fd`).filter(name => /^\d+$/.test(name)); }
      catch (error) {
        if (error.code === 'ENOENT' && pid !== '1') { report.disappearedProcesses++; continue; }
        return stop('descriptor_directory_unreadable');
      }
      report.processCount++;
      report.descriptorCount += descriptors.length;
      if (report.descriptorCount > 8192) return stop('descriptor_inventory_limit');
      for (const fd of descriptors) {
        let target;
        try { target = io.readlinkSync(`/proc/${pid}/fd/${fd}`); }
        catch (error) {
          if (error.code === 'ENOENT') { report.disappearedHandles++; continue; }
          return stop('descriptor_unreadable');
        }
        if ([expected, expected + '-wal', expected + '-shm'].includes(target)) {
          report.expectedHandles++;
        } else if (target.startsWith(root) && target.slice(root.length).includes('.sqlite')) {
          if (!['metadata.sqlite', 'metadata.sqlite-wal', 'metadata.sqlite-shm'].includes(target.slice(root.length))) {
            report.unexpectedHandles++;
          }
        }
      }
    }
    if (report.unexpectedHandles) return stop('unexpected_database_handle');
    if (!report.expectedHandles) return stop('expected_handle_absent');
    return { ...report, status: 'verified', reason: 'exact_live_handles' };
  } catch { return stop('scanner_failed'); }
}

if (process.argv.includes('--live-d1-scan')) {
  const report = scanLiveD1(process.env.EXPECTED_FILE);
  console.log(JSON.stringify(report));
  process.exitCode = report.status === 'verified' ? 0 : 2;
}
