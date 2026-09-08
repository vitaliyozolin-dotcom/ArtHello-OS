import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';

export function activeRelativePath() {
  const key = createHash('sha256').update('miniflare-D1DatabaseObject').digest();
  const name = createHmac('sha256', key).update('arthello-production').digest().subarray(0, 16);
  const suffix = createHmac('sha256', key).update(name).digest().subarray(0, 16);
  return `d1/miniflare-D1DatabaseObject/${Buffer.concat([name, suffix]).toString('hex')}.sqlite`;
}

// Fixed identifiers only. No credentials, state values, message bodies or row exports.
const tables = ['app_users', 'user_system_access', 'user_branch_access',
  'bank_accounts', 'bank_statement_imports', 'bank_transactions', 'financial_operations',
  'developer_feedback', 'developer_feedback_events', 'integration_connections',
  'integration_sync_runs', 'alfacrm_finance_snapshots', 'alfacrm_family_merge_candidates'];
const checks = {
  bankLinks: { required: ['bank_transactions', 'financial_operations'], sql: "SELECT count(*) n FROM bank_transactions b LEFT JOIN financial_operations f ON f.id=b.financial_operation_id WHERE b.financial_operation_id<>'' AND f.id IS NULL" },
  accessUsers: { required: ['user_system_access', 'app_users'], sql: 'SELECT count(*) n FROM user_system_access a LEFT JOIN app_users u ON u.id=a.user_id WHERE u.id IS NULL' },
  feedbackAuthors: { required: ['developer_feedback', 'app_users'], sql: 'SELECT count(*) n FROM developer_feedback f LEFT JOIN app_users u ON u.id=f.author_user_id WHERE u.id IS NULL' },
  feedbackEvents: { required: ['developer_feedback_events', 'developer_feedback'], sql: 'SELECT count(*) n FROM developer_feedback_events e LEFT JOIN developer_feedback f ON f.id=e.feedback_id WHERE f.id IS NULL' },
  importConnections: { required: ['integration_sync_runs', 'integration_connections'], sql: 'SELECT count(*) n FROM integration_sync_runs r LEFT JOIN integration_connections c ON c.id=r.connection_id WHERE c.id IS NULL' },
};

export function inspectDatabase(db) {
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=1000;');
  const result = { schemaVersion: 1, liveAcceptance: 'not_run', tables: {}, checks: {} };
  for (const table of tables) {
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        result.tables[table] = { state: 'not_installed' };
        continue;
      }
      const count = db.prepare(`SELECT count(*) n FROM (SELECT 1 FROM "${table}" LIMIT 10001)`).get().n;
      result.tables[table] = count > 10000 ? { state: 'over_limit' } : { state: 'observed', rows: count };
    } catch { result.tables[table] = { state: 'unavailable' }; }
  }
  for (const [name, check] of Object.entries(checks)) {
    const states = check.required.map(table => result.tables[table].state);
    if (states.some(state => state !== 'observed')) {
      result.checks[name] = { state: states.includes('not_installed') ? 'schema_missing' : 'not_checked' };
      continue;
    }
    try {
      result.checks[name] = { state: 'observed', violations: db.prepare(check.sql).get().n };
    } catch { result.checks[name] = { state: 'unavailable' }; }
  }
  return result;
}

// Production entry is explicit. Importing this module never accesses the filesystem.
if (process.argv.includes('--production-readonly')) {
  let db;
  try {
    if (process.getuid() !== 1000 || process.getgid() !== 1000) throw new Error();
    const path = `/data/${activeRelativePath()}`;
    if (realpathSync(path) !== path) throw new Error();
    const info = lstatSync(path);
    if (!info.isFile() || info.uid !== 1000 || (info.mode & 0o022)) throw new Error();
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    const result = inspectDatabase(db);
    console.log(JSON.stringify({ ...result, observedAtUtc: new Date().toISOString(), productionMutations: false }));
  } catch {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'blocked', reason: 'readonly_source_unavailable', liveAcceptance: 'not_run', productionMutations: false }));
    process.exitCode = 2;
  } finally { db?.close(); }
}
