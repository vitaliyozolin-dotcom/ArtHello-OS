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
const tables = ['app_users', 'app_systems', 'organization_branches', 'user_system_access', 'user_branch_access',
  'bank_accounts', 'bank_statement_imports', 'bank_transactions', 'financial_operations',
  'developer_feedback', 'developer_feedback_events', 'integration_connections',
  'integration_sync_runs', 'alfacrm_finance_snapshots', 'alfacrm_family_merge_candidates'];
const checks = {
  bankLinks: { required: ['bank_transactions', 'financial_operations'], sql: "SELECT count(*) n FROM bank_transactions b LEFT JOIN financial_operations f ON f.id=b.financial_operation_id WHERE b.financial_operation_id<>'' AND f.id IS NULL" },
  accessUsers: { required: ['user_system_access', 'app_users'], sql: 'SELECT count(*) n FROM user_system_access a LEFT JOIN app_users u ON u.id=a.user_id WHERE u.id IS NULL' },
  accessSystems: { required: ['user_system_access', 'app_systems'], sql: 'SELECT count(*) n FROM user_system_access a LEFT JOIN app_systems s ON s.id=a.system_id WHERE s.id IS NULL' },
  branchUsers: { required: ['user_branch_access', 'app_users'], sql: 'SELECT count(*) n FROM user_branch_access a LEFT JOIN app_users u ON u.id=a.user_id WHERE u.id IS NULL' },
  branchTargets: { required: ['user_branch_access', 'organization_branches'], sql: 'SELECT count(*) n FROM user_branch_access a LEFT JOIN organization_branches b ON b.id=a.branch_id WHERE b.id IS NULL' },
  feedbackAuthors: { required: ['developer_feedback', 'app_users'], sql: 'SELECT count(*) n FROM developer_feedback f LEFT JOIN app_users u ON u.id=f.author_user_id WHERE u.id IS NULL' },
  feedbackEvents: { required: ['developer_feedback_events', 'developer_feedback'], sql: 'SELECT count(*) n FROM developer_feedback_events e LEFT JOIN developer_feedback f ON f.id=e.feedback_id WHERE f.id IS NULL' },
  importConnections: { required: ['integration_sync_runs', 'integration_connections'], sql: 'SELECT count(*) n FROM integration_sync_runs r LEFT JOIN integration_connections c ON c.id=r.connection_id WHERE c.id IS NULL' },
};

// Only counts and fixed statuses leave SQLite; provider IDs are join/group keys, never outputs.
const bankQueries = {
  sync: `WITH r AS (
 SELECT status,rejected_count,error_count,conflict_count,started_at,finished_at
 FROM integration_sync_runs
 WHERE connection_id='INT-T-TOCHKA' AND dry_run=0
 ORDER BY started_at DESC,id DESC LIMIT 1
)
SELECT COALESCE((SELECT CASE status
 WHEN 'Успешно' THEN 'complete' WHEN 'Ожидание банка' THEN 'pending'
 WHEN 'Ошибка' THEN 'failed' WHEN 'Требует проверки' THEN 'review_required'
 ELSE 'unknown' END FROM r),'not_observed') AS sync_state,
 COALESCE((SELECT CASE WHEN julianday(started_at)>=julianday(:not_before)
 AND julianday(finished_at)>=julianday(started_at)
 AND julianday(finished_at)<=julianday(:observed_at) THEN 1 ELSE 0 END FROM r),0) AS fresh,
 COALESCE((SELECT rejected_count FROM r),0) AS rejected_rows,
 COALESCE((SELECT error_count FROM r),0) AS error_rows,
 COALESCE((SELECT conflict_count FROM r),0) AS conflict_rows;`,
  coverage: `WITH a AS (
 SELECT connection_id,legal_entity_id,provider_account_id,synced_at FROM bank_accounts WHERE connection_id='INT-T-TOCHKA'
), r AS (
 SELECT started_at FROM integration_sync_runs
 WHERE connection_id='INT-T-TOCHKA' AND dry_run=0
 ORDER BY started_at DESC,id DESC LIMIT 1
), ranked AS (
 SELECT s.connection_id,s.legal_entity_id,s.provider_account_id,s.status,s.start_date,s.end_date,s.fetched_at,s.transaction_count,ROW_NUMBER() OVER(
 PARTITION BY s.connection_id,s.legal_entity_id,s.provider_account_id
 ORDER BY s.fetched_at DESC,s.id DESC) AS rn
 FROM bank_statement_imports s WHERE s.connection_id='INT-T-TOCHKA'
), tx AS (
 SELECT legal_entity_id,provider_account_id,count(*) AS n
 FROM bank_transactions WHERE connection_id='INT-T-TOCHKA'
 AND operation_date BETWEEN :start AND :end
 GROUP BY legal_entity_id,provider_account_id
)
SELECT count(*) AS account_rows,
 (SELECT count(*) FROM (SELECT legal_entity_id,provider_account_id FROM a GROUP BY legal_entity_id,provider_account_id)) AS distinct_account_keys,
 count(DISTINCT a.legal_entity_id) AS legal_entities,
 COALESCE(sum(CASE WHEN COALESCE(a.legal_entity_id,'')='' OR COALESCE(a.provider_account_id,'')='' THEN 1 ELSE 0 END),0) AS invalid_account_keys,
 COALESCE(sum(CASE WHEN s.rn=1 THEN 1 ELSE 0 END),0) AS accounts_with_statement,
 COALESCE(sum(CASE WHEN lower(trim(s.status)) IN ('ready','completed')
 AND s.start_date=:start AND s.end_date=:end
 AND s.fetched_at=(SELECT started_at FROM r)
 AND a.synced_at=(SELECT started_at FROM r)
 THEN 1 ELSE 0 END),0) AS covered_in_latest_run,
 COALESCE(sum(CASE WHEN s.start_date=:start AND s.end_date=:end
 AND s.transaction_count=COALESCE(tx.n,0) THEN 1 ELSE 0 END),0) AS accounts_with_matching_transaction_count
FROM a LEFT JOIN ranked s ON s.rn=1 AND s.connection_id=a.connection_id
 AND s.legal_entity_id=a.legal_entity_id AND s.provider_account_id=a.provider_account_id
LEFT JOIN tx ON tx.legal_entity_id=a.legal_entity_id
 AND tx.provider_account_id=a.provider_account_id;`,
  transactions: `WITH t AS (
 SELECT connection_id,legal_entity_id,provider_account_id,financial_operation_id,status,currency,direction FROM bank_transactions WHERE connection_id='INT-T-TOCHKA'
 AND operation_date BETWEEN :start AND :end
)
SELECT count(*) AS transaction_rows,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB' THEN 1 ELSE 0 END),0) AS eligible_rows,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB'
 AND t.direction='Поступление' THEN 1 ELSE 0 END),0) AS income_rows,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB'
 AND t.direction='Списание' THEN 1 ELSE 0 END),0) AS expense_rows,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB'
 AND (COALESCE(t.financial_operation_id,'')='' OR f.id IS NULL) THEN 1 ELSE 0 END),0) AS eligible_missing_links,
 COALESCE(sum(CASE WHEN COALESCE(t.financial_operation_id,'')<>'' AND f.id IS NULL THEN 1 ELSE 0 END),0) AS dangling_links,
 COALESCE(sum(CASE WHEN COALESCE(lower(trim(t.status)),'')<>'booked' OR COALESCE(t.currency,'')<>'RUB' THEN 1 ELSE 0 END),0) AS pending_or_non_rub,
 COALESCE(sum(CASE WHEN NOT EXISTS (SELECT 1 FROM bank_accounts a
 WHERE a.connection_id=t.connection_id AND a.legal_entity_id=t.legal_entity_id
 AND a.provider_account_id=t.provider_account_id) THEN 1 ELSE 0 END),0) AS unexpected_account_rows
FROM t LEFT JOIN financial_operations f ON f.id=t.financial_operation_id;`,
  duplicates: `SELECT count(*) AS duplicate_external_identity_groups,
 COALESCE(sum(n-1),0) AS excess_rows,
 (SELECT count(*) FROM bank_transactions WHERE connection_id='INT-T-TOCHKA'
 AND COALESCE(provider_transaction_id,'')='') AS missing_identity_rows FROM (
 SELECT count(*) AS n FROM bank_transactions
 WHERE connection_id='INT-T-TOCHKA'
 GROUP BY connection_id,provider_transaction_id HAVING count(*)>1
);`,
};
const bankCountFields = {
  coverage: ['account_rows', 'distinct_account_keys', 'legal_entities', 'invalid_account_keys',
    'accounts_with_statement', 'covered_in_latest_run', 'accounts_with_matching_transaction_count'],
  transactions: ['transaction_rows', 'eligible_rows', 'income_rows', 'expense_rows',
    'eligible_missing_links', 'dangling_links', 'pending_or_non_rub', 'unexpected_account_rows'],
  duplicates: ['duplicate_external_identity_groups', 'excess_rows', 'missing_identity_rows'],
};
function fixedCounts(row, fields) {
  const counts = {};
  for (const field of fields) {
    if (!Number.isSafeInteger(row[field]) || row[field] < 0) throw new Error();
    const key = field === 'transaction_rows' ? 'rows'
      : field === 'duplicate_external_identity_groups' ? 'groups'
      : field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    counts[key] = row[field];
  }
  return counts;
}

function inspectBankWindow(db, tableStates, { now = Date.now(), syncNotBefore } = {}) {
  const incomplete = state => ({ state, checksComplete: false });
  const required = ['bank_accounts', 'bank_statement_imports', 'bank_transactions',
    'financial_operations', 'integration_sync_runs'];
  const states = required.map(table => tableStates[table].state);
  if (states.some(state => state !== 'observed')) {
    return incomplete(states.includes('not_installed') ? 'schema_missing' : 'not_checked');
  }
  try {
    if (!Number.isFinite(now)) return incomplete('invalid_window');
    const observedAt = new Date(now).toISOString();
    const period = { startDate: '2026-09-01', endDate: observedAt.slice(0, 10) };
    if (period.endDate < period.startDate) return incomplete('invalid_window');
    const freshnessRequested = syncNotBefore !== undefined;
    if (freshnessRequested && (typeof syncNotBefore !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(syncNotBefore)
      || !Number.isFinite(Date.parse(syncNotBefore))
      || new Date(syncNotBefore).toISOString().slice(0, 19) !== syncNotBefore.slice(0, 19)
      || Date.parse(syncNotBefore) > now)) return incomplete('invalid_window');
    const row = db.prepare(bankQueries.sync).get({
      not_before: syncNotBefore ?? '0000-01-01T00:00:00.000Z', observed_at: observedAt,
    });
    const sync = {
      state: row.sync_state,
      freshness: row.fresh === 1 ? (freshnessRequested ? 'verified' : 'not_requested') : 'stale_or_unobserved',
      ...fixedCounts(row, ['rejected_rows', 'error_rows', 'conflict_rows']),
    };
    if (!['complete', 'pending', 'failed', 'review_required', 'unknown', 'not_observed'].includes(sync.state)) throw new Error();
    const bindings = { start: period.startDate, end: period.endDate };
    const coverage = fixedCounts(db.prepare(bankQueries.coverage).get(bindings), bankCountFields.coverage);
    const transactions = fixedCounts(db.prepare(bankQueries.transactions).get(bindings), bankCountFields.transactions);
    const duplicates = fixedCounts(db.prepare(bankQueries.duplicates).get(), bankCountFields.duplicates);
    const activity = transactions.eligibleRows > 0 ? 'observed' : 'not_observed';
    const checksComplete = sync.state === 'complete' && sync.freshness !== 'stale_or_unobserved'
      && sync.rejectedRows === 0 && sync.errorRows === 0 && sync.conflictRows === 0
      && coverage.accountRows === 4 && coverage.distinctAccountKeys === 4
      && coverage.legalEntities === 1 && coverage.invalidAccountKeys === 0
      && coverage.accountsWithStatement === 4 && coverage.coveredInLatestRun === 4
      && coverage.accountsWithMatchingTransactionCount === 4 && activity === 'observed'
      && transactions.eligibleMissingLinks === 0 && transactions.danglingLinks === 0
      && transactions.pendingOrNonRub === 0 && transactions.unexpectedAccountRows === 0
      && transactions.incomeRows + transactions.expenseRows === transactions.eligibleRows
      && duplicates.groups === 0 && duplicates.excessRows === 0 && duplicates.missingIdentityRows === 0;
    return { state: 'observed', period, sync, coverage, transactions, duplicates, activity, checksComplete };
  } catch { return incomplete('unavailable'); }
}

export function diagnosticExitCode(result) {
  return Object.values(result.tables).every(item => item.state === 'observed') &&
    Object.values(result.checks).every(item => item.state === 'observed' && item.violations === 0) &&
    (result.bankWindow === undefined || result.bankWindow.checksComplete === true) ? 0 : 2;
}

export function inspectDatabase(db, bankOptions) {
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=1000;');
  db.exec('BEGIN');
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
  result.bankWindow = inspectBankWindow(db, result.tables, bankOptions);
  db.exec('ROLLBACK');
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
    const observedAtUtc = new Date().toISOString();
    const result = inspectDatabase(db, { now: Date.parse(observedAtUtc) });
    process.exitCode = diagnosticExitCode(result);
    console.log(JSON.stringify({ ...result, status: process.exitCode === 0 ? 'bounded_checks_complete' : 'incomplete_or_issues', observedAtUtc, productionMutations: false }));
  } catch {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'blocked', reason: 'readonly_source_unavailable', liveAcceptance: 'not_run', productionMutations: false }));
    process.exitCode = 2;
  } finally { db?.close(); }
}
