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
 COALESCE(sum(CASE WHEN lower(trim(s.status)) IN ('ready','completed')
 AND s.start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 AND s.end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 AND date(s.start_date,'+0 days')=s.start_date AND date(s.end_date,'+0 days')=s.end_date
 AND s.start_date<=:start AND s.end_date>=:end
 AND s.fetched_at=(SELECT started_at FROM r)
 AND a.synced_at=(SELECT started_at FROM r)
 THEN 1 ELSE 0 END),0) AS accounts_with_containing_statement_in_latest_run,
 COALESCE(sum(CASE WHEN s.start_date=:start AND s.end_date=:end
 AND s.transaction_count=COALESCE(tx.n,0) THEN 1 ELSE 0 END),0) AS accounts_with_matching_transaction_count
FROM a LEFT JOIN ranked s ON s.rn=1 AND s.connection_id=a.connection_id
 AND s.legal_entity_id=a.legal_entity_id AND s.provider_account_id=a.provider_account_id
LEFT JOIN tx ON tx.legal_entity_id=a.legal_entity_id
 AND tx.provider_account_id=a.provider_account_id;`,
  transactions: `WITH t AS (
 SELECT connection_id,legal_entity_id,provider_account_id,provider_transaction_id,financial_operation_id,operation_date,amount_minor,status,currency,direction FROM bank_transactions WHERE connection_id='INT-T-TOCHKA'
 AND operation_date BETWEEN :start AND :end
)
SELECT count(*) AS transaction_rows,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB' AND typeof(t.amount_minor)='integer' AND t.amount_minor>0 AND t.amount_minor<=9007199254740991 AND t.direction='Поступление' THEN t.amount_minor ELSE 0 END),0) AS income_amount_minor,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB' AND typeof(t.amount_minor)='integer' AND t.amount_minor>0 AND t.amount_minor<=9007199254740991 AND t.direction='Списание' THEN t.amount_minor ELSE 0 END),0) AS expense_amount_minor,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB' AND typeof(f.amount_minor)='integer' AND f.amount_minor>0 AND f.amount_minor<=9007199254740991 AND f.direction='Поступление' THEN f.amount_minor ELSE 0 END),0) AS linked_income_amount_minor,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB' AND typeof(f.amount_minor)='integer' AND f.amount_minor>0 AND f.amount_minor<=9007199254740991 AND f.direction='Списание' THEN f.amount_minor ELSE 0 END),0) AS linked_expense_amount_minor,
 count(DISTINCT CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB' THEN f.id END) AS linked_financial_rows,
 COALESCE(sum(CASE WHEN lower(trim(t.status))='booked' AND t.currency='RUB' AND (NOT (typeof(t.amount_minor)='integer' AND t.amount_minor>0 AND t.amount_minor<=9007199254740991) OR NOT (typeof(f.amount_minor)='integer' AND f.amount_minor>0 AND f.amount_minor<=9007199254740991)
 OR f.id IS NULL OR f.amount_minor IS NOT t.amount_minor OR f.direction IS NOT t.direction
 OR f.operation_date IS NOT t.operation_date OR f.legal_entity_id IS NOT t.legal_entity_id
 OR f.bank_operation_ref IS NOT t.provider_transaction_id OR f.source_system IS NOT 'BANK_TOCHKA_API')
 THEN 1 ELSE 0 END),0) AS financial_mismatch_rows,
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
 AND (COALESCE(provider_account_id,'')='' OR COALESCE(provider_transaction_id,'')='')) AS missing_identity_rows FROM (
 SELECT count(*) AS n FROM bank_transactions
 WHERE connection_id='INT-T-TOCHKA'
 GROUP BY connection_id,provider_account_id,provider_transaction_id HAVING count(*)>1
);`,
};
const bankCountFields = {
  coverage: ['account_rows', 'distinct_account_keys', 'legal_entities', 'invalid_account_keys',
    'accounts_with_statement', 'covered_in_latest_run', 'accounts_with_containing_statement_in_latest_run',
    'accounts_with_matching_transaction_count'],
  transactions: ['transaction_rows', 'eligible_rows', 'income_rows', 'expense_rows',
    'eligible_missing_links', 'dangling_links', 'pending_or_non_rub', 'unexpected_account_rows',
    'income_amount_minor', 'expense_amount_minor', 'linked_income_amount_minor', 'linked_expense_amount_minor',
    'linked_financial_rows', 'financial_mismatch_rows'],
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
      && transactions.financialMismatchRows === 0 && transactions.linkedFinancialRows === transactions.eligibleRows
      && transactions.incomeAmountMinor === transactions.linkedIncomeAmountMinor
      && transactions.expenseAmountMinor === transactions.linkedExpenseAmountMinor
      && duplicates.groups === 0 && duplicates.excessRows === 0 && duplicates.missingIdentityRows === 0;
    return { state: 'observed', period, sync, coverage, transactions, duplicates, activity, checksComplete };
  } catch { return incomplete('unavailable'); }
}

// These fragments receive only fixed expressions below. Arbitrary stored JSON, identifiers,
// credentials and provider payloads never leave SQLite. Runtime observations do not change
// the separate exact-window acceptance predicate or the diagnostic exit code.
const dateSql = value => `CASE WHEN typeof(${value})='text'
 AND ${value} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 AND substr(${value},1,4)>='0001'
 AND date(${value},'+0 days')=${value} THEN ${value} END`;
const utcSql = value => `CASE WHEN typeof(${value})='text' AND length(${value}) IN (19,20,24)
 AND substr(${value},1,4)>='0001'
 AND strftime('%Y-%m-%dT%H:%M:%fZ',${value},'+0 days')=
 replace(substr(${value},1,19),' ','T') || CASE WHEN length(${value})=24 THEN substr(${value},20,4) ELSE '.000' END || 'Z'
 THEN strftime('%Y-%m-%dT%H:%M:%fZ',${value},'+0 days') END`;
const jsonNumberSql = (path, maximum = 253402300799999) => `CASE
 WHEN json_type(value,'${path}')='integer' AND json_extract(value,'${path}') BETWEEN 0 AND ${maximum}
 THEN json_extract(value,'${path}') END`;
const uuidSql = value => `typeof(${value})='text' AND length(${value})=36
 AND substr(${value},9,1)='-' AND substr(${value},14,1)='-' AND substr(${value},19,1)='-' AND substr(${value},24,1)='-'
 AND substr(${value},15,1)='4' AND substr(${value},20,1) IN ('8','9','a','b')
 AND length(replace(${value},'-',''))=32
 AND replace(${value},'-','') NOT GLOB '*[^0-9a-f]*'`;
const runtimeRowSql = `WITH r AS (SELECT
 CASE WHEN json_valid(state_value) THEN CASE WHEN json_type(state_value)='object' THEN 1 ELSE 0 END ELSE 0 END AS valid_json,
 CASE WHEN json_valid(state_value) THEN CASE WHEN json_type(state_value)='object' THEN state_value ELSE '{}' END ELSE '{}' END AS value,
 updated_at FROM system_runtime_state WHERE state_key=:state_key)
 SELECT valid_json,json_extract(value,'$.version')=1 AS valid_version,`;
function epochUtc(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999
    ? new Date(value).toISOString() : null;
}
function runtimeLease(value, now) {
  return value === null ? 'unknown' : value === 0 ? 'released' : value > now ? 'active' : 'expired';
}
function runtimeAge(value, now) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= now ? Math.floor((now - time) / 1000) : null;
}
function inspectBankRuntime(db, { now = Date.now() } = {}) {
  const result = {
    state: 'partial', observedAtUtc: null,
    setup: { state: 'not_observed', startDate: null, syncIntervalMinutes: null, syncMinute: null },
    connection: { state: 'not_observed', status: 'not_observed', enabled: null, nextSyncAtUtc: null },
    autosync: { state: 'not_observed', outcome: 'not_observed', generationMatchesSetup: null,
      nextAtUtc: null, leasedUntilUtc: null, leaseState: 'unknown', failures: null, updatedAgeSeconds: null,
      httpStatus: null, httpStatusState: 'missing', updatedAtUtc: null,
      failureStage: null, failureStageState: 'missing',
      commitFailureKind: null, commitFailureKindState: 'missing' },
    statementLease: { state: 'not_observed', expiresAtUtc: null, leaseState: 'unknown' },
    retainedJobs: { state: 'not_observed', scopeMatch: 'unverified', providerStatus: 'not_stored',
      total: null, invalidRows: null, exactWindowRows: null, olderEndRows: null, otherWindowRows: null, oldestAgeSeconds: null },
    statementImports: { state: 'not_observed', readyRows: null, pendingRows: null, failedRows: null, unknownRows: null },
    latestRun: { state: 'not_observed', startedAtUtc: null, finishedAtUtc: null,
      status: 'not_observed', failureKind: null },
  };
  if (!Number.isSafeInteger(now) || now < Date.parse('2026-09-01T00:00:00.000Z') || !epochUtc(now)) {
    result.state = 'invalid_window';
    return result;
  }
  result.observedAtUtc = epochUtc(now);
  const read = (name, table, action) => {
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        result[name].state = 'schema_missing';
        return;
      }
      action(result[name]);
    } catch { result[name].state = 'unavailable'; }
  };
  read('setup', 'system_runtime_state', out => {
    const row = db.prepare(`${runtimeRowSql}
 ${dateSql("json_extract(value,'$.startDate')")} AS start_date,
 CASE WHEN json_type(value,'$.syncIntervalMinutes')='integer'
 AND json_extract(value,'$.syncIntervalMinutes') IN (60,180,360,1440) THEN json_extract(value,'$.syncIntervalMinutes') END AS interval_minutes,
 ${jsonNumberSql('$.syncMinute', 59)} AS sync_minute FROM r`).get({ state_key: 'integration_setup:INT-T-TOCHKA' });
    if (!row) return;
    out.startDate = row.start_date;
    out.syncIntervalMinutes = row.interval_minutes;
    out.syncMinute = row.sync_minute;
    // IntegrationSetup has no version field; only its fixed schedule metadata is observed.
    out.state = row.valid_json === 1 && out.startDate !== null && out.startDate <= result.observedAtUtc.slice(0, 10)
      && out.syncIntervalMinutes !== null && out.syncMinute !== null ? 'observed' : 'invalid';
  });
  read('connection', 'integration_connections', out => {
    const row = db.prepare(`SELECT CASE status WHEN 'Работает' THEN 'running'
 WHEN 'Формируются выписки' THEN 'forming_statements' WHEN 'Ошибка подключения' THEN 'connection_error'
 WHEN 'На паузе' THEN 'paused' WHEN 'Ожидает синхронизации' THEN 'awaiting_sync'
 WHEN 'Требует проверки' THEN 'review_required' ELSE 'unknown' END AS status,
 CASE WHEN typeof(is_enabled)='integer' AND is_enabled IN (0,1) THEN is_enabled END AS enabled,
 ${utcSql('next_sync_at')} AS next_at FROM integration_connections WHERE id='INT-T-TOCHKA'`).get();
    if (!row) return;
    out.status = row.status;
    out.enabled = row.enabled === null ? null : row.enabled === 1;
    out.nextSyncAtUtc = row.next_at;
    out.state = out.status !== 'unknown' && out.enabled !== null && out.nextSyncAtUtc !== null ? 'observed' : 'invalid';
  });
  read('autosync', 'system_runtime_state', out => {
    const row = db.prepare(`${runtimeRowSql}
 CASE json_extract(value,'$.outcome') WHEN 'running' THEN 'running' WHEN 'complete' THEN 'complete'
 WHEN 'pending' THEN 'pending' WHEN 'busy' THEN 'busy' WHEN 'error' THEN 'error' ELSE 'unknown' END AS outcome,
 ${jsonNumberSql('$.nextAt')} AS next_at,${jsonNumberSql('$.leasedUntil')} AS leased_until,
 ${jsonNumberSql('$.failures', 10)} AS failures,${utcSql('updated_at')} AS updated_at_utc,
 CASE WHEN json_type(value,'$.httpStatus')='integer' AND json_extract(value,'$.httpStatus') BETWEEN 100 AND 599
 THEN json_extract(value,'$.httpStatus') END AS http_status,
 CASE WHEN valid_json<>1 THEN 'invalid'
 WHEN json_type(value,'$.httpStatus') IS NULL OR json_type(value,'$.httpStatus')='null' THEN 'missing'
 WHEN json_type(value,'$.httpStatus')='integer' AND json_extract(value,'$.httpStatus') BETWEEN 100 AND 599 THEN 'observed'
 ELSE 'invalid' END AS http_status_state,
 CASE WHEN json_extract(value,'$.outcome')='error' THEN CASE json_extract(value,'$.failureStage')
 WHEN 'setup_references' THEN 'setup_references' WHEN 'credential_read' THEN 'credential_read'
 WHEN 'statement_state_open' THEN 'statement_state_open' WHEN 'bank_sync' THEN 'bank_sync'
 WHEN 'statement_fence' THEN 'statement_fence' WHEN 'sync_commit' THEN 'sync_commit'
 WHEN 'statement_acknowledge' THEN 'statement_acknowledge' WHEN 'statement_release' THEN 'statement_release'
 WHEN 'sync_callback' THEN 'sync_callback' WHEN 'response_decode' THEN 'response_decode'
 WHEN 'response_result' THEN 'response_result' END END AS failure_stage,
 CASE WHEN valid_json<>1 THEN 'invalid'
 WHEN json_type(value,'$.failureStage') IS NULL OR json_type(value,'$.failureStage')='null' THEN 'missing'
 WHEN json_extract(value,'$.outcome')='error' AND json_type(value,'$.failureStage')='text'
 AND json_extract(value,'$.failureStage') IN ('setup_references','credential_read','statement_state_open','bank_sync',
 'statement_fence','sync_commit','statement_acknowledge','statement_release','sync_callback','response_decode','response_result')
 THEN 'observed' ELSE 'invalid' END AS failure_stage_state,
 CASE WHEN json_extract(value,'$.outcome')='error' AND json_extract(value,'$.failureStage')='sync_commit'
 THEN CASE json_extract(value,'$.commitFailureKind')
 WHEN 'provider_identity' THEN 'provider_identity'
 WHEN 'transaction_identity' THEN 'transaction_identity'
 WHEN 'unique_constraint' THEN 'unique_constraint'
 WHEN 'required_value' THEN 'required_value'
 WHEN 'foreign_key' THEN 'foreign_key'
 WHEN 'check_constraint' THEN 'check_constraint'
 WHEN 'schema' THEN 'schema'
 WHEN 'binding_type' THEN 'binding_type'
 WHEN 'query_limit' THEN 'query_limit'
 WHEN 'database_busy' THEN 'database_busy'
 WHEN 'storage_full' THEN 'storage_full'
 WHEN 'database_readonly' THEN 'database_readonly'
 WHEN 'storage_error' THEN 'storage_error'
 WHEN 'other' THEN 'other' END END AS commit_failure_kind,
 CASE WHEN valid_json<>1 THEN 'invalid'
 WHEN json_type(value,'$.commitFailureKind') IS NULL OR json_type(value,'$.commitFailureKind')='null' THEN 'missing'
 WHEN json_extract(value,'$.outcome')='error' AND json_extract(value,'$.failureStage')='sync_commit'
 AND json_type(value,'$.commitFailureKind')='text'
 AND json_extract(value,'$.commitFailureKind') IN ('provider_identity','transaction_identity','unique_constraint','required_value','foreign_key','check_constraint','schema','binding_type','query_limit','database_busy','storage_full','database_readonly','storage_error','other') THEN 'observed'
 ELSE 'invalid' END AS commit_failure_kind_state,
 CASE WHEN ${uuidSql("json_extract(value,'$.generation')")}
 THEN (SELECT CASE WHEN json_valid(s.state_value) THEN CASE
 WHEN ${uuidSql("json_extract(s.state_value,'$.credentialGeneration')")}
 THEN json_extract(value,'$.generation')=json_extract(s.state_value,'$.credentialGeneration') END END
 FROM system_runtime_state s WHERE s.state_key='integration_setup:INT-T-TOCHKA') END AS generation_matches
 FROM r`).get({ state_key: 'tochka-autosync:v1:INT-T-TOCHKA' });
    if (!row) return;
    out.outcome = row.outcome;
    out.nextAtUtc = epochUtc(row.next_at);
    out.leasedUntilUtc = row.leased_until === 0 ? null : epochUtc(row.leased_until);
    out.leaseState = runtimeLease(row.leased_until, now);
    out.failures = row.failures;
    out.updatedAgeSeconds = runtimeAge(row.updated_at_utc, now);
    // This is the scheduler callback status; 500 may be its default for a thrown callback.
    // It is not an upstream bank error code and does not affect completion criteria.
    out.httpStatus = row.http_status;
    out.httpStatusState = row.http_status_state;
    out.updatedAtUtc = row.updated_at_utc;
    // Fixed local operation names only; none establishes an upstream provider failure.
    out.failureStage = row.failure_stage;
    out.failureStageState = row.failure_stage_state;
    out.commitFailureKind = row.commit_failure_kind;
    out.commitFailureKindState = row.commit_failure_kind_state;
    out.generationMatchesSetup = row.generation_matches === null ? null : row.generation_matches === 1;
    out.state = row.valid_json === 1 && row.valid_version === 1 && out.outcome !== 'unknown'
      && out.nextAtUtc !== null && out.leaseState !== 'unknown' && out.failures !== null
      && out.updatedAgeSeconds !== null ? 'observed' : 'invalid';
  });
  read('statementLease', 'system_runtime_state', out => {
    const row = db.prepare(`${runtimeRowSql} ${jsonNumberSql('$.expiresAtMs')} AS expires_at FROM r`)
      .get({ state_key: 'tochka-statement-lease:v1:INT-T-TOCHKA' });
    if (!row) return;
    out.expiresAtUtc = epochUtc(row.expires_at);
    out.leaseState = runtimeLease(row.expires_at, now);
    out.state = row.valid_json === 1 && row.valid_version === 1 && out.expiresAtUtc !== null ? 'observed' : 'invalid';
  });
  read('retainedJobs', 'system_runtime_state', out => {
    // Scope hashes cannot be mapped to the active credential without additional private
    // scope inputs. Count all retained jobs explicitly; never call them current bank status.
    const row = db.prepare(`WITH r AS (SELECT
 CASE WHEN json_valid(state_value) THEN CASE WHEN json_type(state_value)='object' THEN state_value ELSE '{}' END ELSE '{}' END AS value,
 updated_at FROM system_runtime_state WHERE state_key LIKE 'tochka-statement-pending:v1:%' LIMIT 10001),
 windows AS (SELECT json_extract(value,'$.version')=1 AS valid_version,
 ${dateSql("json_extract(value,'$.startDate')")} AS start_date,
 ${dateSql("json_extract(value,'$.endDate')")} AS end_date,
 ${utcSql('updated_at')} AS updated_at_utc FROM r), classified AS (
 SELECT *,CASE WHEN valid_version=1 AND start_date IS NOT NULL AND end_date IS NOT NULL
 AND start_date<=end_date AND end_date<=:end THEN 1 ELSE 0 END AS valid_window FROM windows)
 SELECT count(*) AS total,
 COALESCE(sum(CASE WHEN valid_window=0 THEN 1 ELSE 0 END),0) AS invalid_rows,
 COALESCE(sum(CASE WHEN valid_window=1 AND start_date=:start AND end_date=:end THEN 1 ELSE 0 END),0) AS exact_window_rows,
 COALESCE(sum(CASE WHEN valid_window=1 AND end_date<:end THEN 1 ELSE 0 END),0) AS older_end_rows,
 COALESCE(sum(CASE WHEN valid_window=1 AND end_date=:end AND start_date<>:start THEN 1 ELSE 0 END),0) AS other_window_rows,
 COALESCE(sum(CASE WHEN updated_at_utc IS NULL OR updated_at_utc>:observed_at THEN 1 ELSE 0 END),0) AS unknown_age_rows,
 CASE WHEN count(*)=count(updated_at_utc) AND MAX(updated_at_utc)<=:observed_at THEN MIN(updated_at_utc) END AS oldest_at
 FROM classified`).get({ start: '2026-09-01', end: result.observedAtUtc.slice(0, 10), observed_at: result.observedAtUtc });
    if (row.total > 10000) { out.state = 'over_limit'; return; }
    Object.assign(out, fixedCounts(row, ['total', 'invalid_rows', 'exact_window_rows', 'older_end_rows', 'other_window_rows']));
    out.oldestAgeSeconds = runtimeAge(row.oldest_at, now);
    out.state = out.invalidRows === 0 && row.unknown_age_rows === 0 ? 'observed' : 'invalid';
  });
  read('statementImports', 'bank_statement_imports', out => {
    const row = db.prepare(`WITH s AS (SELECT lower(trim(status)) AS status FROM bank_statement_imports
 WHERE connection_id='INT-T-TOCHKA' LIMIT 10001)
 SELECT count(*) AS total,
 COALESCE(sum(CASE WHEN status IN ('ready','completed') THEN 1 ELSE 0 END),0) AS ready_rows,
 COALESCE(sum(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END),0) AS pending_rows,
 COALESCE(sum(CASE WHEN status IN ('error','failed','rejected') THEN 1 ELSE 0 END),0) AS failed_rows,
 COALESCE(sum(CASE WHEN status IS NULL OR status NOT IN ('ready','completed','pending','processing','error','failed','rejected') THEN 1 ELSE 0 END),0) AS unknown_rows FROM s`).get();
    if (row.total > 10000) { out.state = 'over_limit'; return; }
    Object.assign(out, fixedCounts(row, ['ready_rows', 'pending_rows', 'failed_rows', 'unknown_rows']));
    out.state = 'observed';
  });
  read('latestRun', 'integration_sync_runs', out => {
    // Classify the already stored application result inside SQLite. Never return
    // error_message, provider payloads or an inferred upstream HTTP status.
    const row = db.prepare(`SELECT ${utcSql('started_at')} AS started_at_utc,${utcSql('finished_at')} AS finished_at_utc,
 CASE status WHEN 'Успешно' THEN 'complete' WHEN 'Ожидание банка' THEN 'pending'
 WHEN 'Требует проверки' THEN 'review' WHEN 'Ошибка' THEN 'error' ELSE 'unknown' END AS status_kind,
 CASE WHEN status='Ошибка' THEN CASE error_message
 WHEN 'Точка не подтвердила доступ к готовой выписке' THEN 'statement_read_unclassified'
 WHEN 'Ключ Точки не даёт права читать готовой выписке' THEN 'statement_read_forbidden'
 WHEN 'Точка отклонила ключ' THEN 'key_rejected'
 WHEN 'Точка временно ограничила число запросов' THEN 'rate_limited'
 WHEN 'Не удалось связаться с Точкой' THEN 'transport_unavailable'
 WHEN 'Выписка Точки не соответствует запрошенному счёту или периоду' THEN 'statement_identity'
 WHEN 'Точка вернула некорректную выписку' THEN 'statement_format'
 WHEN 'Точка не смогла сформировать выписку. Повторите загрузку для нового запроса.' THEN 'statement_failed'
 ELSE 'unclassified' END ELSE NULL END AS failure_kind
 FROM integration_sync_runs WHERE connection_id='INT-T-TOCHKA' AND dry_run=0 ORDER BY started_at DESC,id DESC LIMIT 1`).get();
    if (!row) return;
    out.startedAtUtc = row.started_at_utc;
    out.finishedAtUtc = row.finished_at_utc;
    out.status = row.status_kind;
    out.failureKind = row.failure_kind;
    out.state = out.startedAtUtc !== null && out.finishedAtUtc !== null
      && out.startedAtUtc <= out.finishedAtUtc && out.finishedAtUtc <= result.observedAtUtc ? 'observed' : 'invalid';
  });
  result.state = Object.values(result).filter(value => value && typeof value === 'object')
    .every(value => ['observed', 'not_observed'].includes(value.state)) ? 'observed' : 'partial';
  return result;
}

// Fixed D097 INSERT column contract. This is schema observation, not a write rehearsal.
// Only code-owned column names and bounded counts are returned; schema SQL and unknown
// identifiers are never emitted. No bank payload or credential is read by this function.
const bankWriteColumns = {
  bank_accounts: 'id connection_id legal_entity_id provider_account_id masked_account name currency status balance_minor balance_as_of synced_at'.split(' '),
  bank_statement_imports: 'id connection_id legal_entity_id provider_statement_id provider_account_id start_date end_date status start_balance_minor end_balance_minor currency transaction_count fetched_at'.split(' '),
  bank_transactions: 'id connection_id legal_entity_id provider_account_id provider_statement_id provider_transaction_id payment_id operation_date direction amount_minor currency status document_number transaction_type description counterparty_name counterparty_inn counterparty_kpp source_payload_hash financial_operation_id imported_at'.split(' '),
  financial_operations: 'id operation_date period direction amount_minor category report_class counterparty_entity_id contract_id document_id project_entity_id legal_entity_id object_entity_id cfr_entity_id bank_operation_ref operation_kind source_system source_file source_sheet source_ref data_quality status created_by'.split(' '),
  integration_sync_runs: 'id connection_id started_at finished_at trigger status received_count accepted_count rejected_count error_count conflict_count checkpoint error_message initiated_by correlation_id dry_run'.split(' '),
  integration_log_entries: 'run_id connection_id level event message record_ref'.split(' '),
  audit_events: 'actor action entity_type entity_id payload'.split(' '),
};
const bankProviderIndexes = {
  bank_accounts: ['connection_id', 'legal_entity_id', 'provider_account_id'],
  bank_statement_imports: ['connection_id', 'provider_statement_id'],
  bank_transactions: ['connection_id', 'provider_account_id', 'provider_transaction_id'],
};
function inspectBankCommitSchema(db) {
  const result = { state: 'partial', tables: {} };
  for (const [table, expected] of Object.entries(bankWriteColumns)) {
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        result.tables[table] = { state: 'schema_missing' };
        continue;
      }
      const columns = db.prepare('SELECT name,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?) LIMIT 129').all(table);
      const indexes = db.prepare('SELECT name,"unique",partial FROM pragma_index_list(?) LIMIT 129').all(table);
      if (columns.length > 128 || indexes.length > 128) {
        result.tables[table] = { state: 'over_limit' };
        continue;
      }
      const known = new Set(columns.map(column => column.name));
      const primary = columns.filter(column => column.pk > 0).sort((a,b) => a.pk-b.pk).map(column => column.name);
      const desiredIndex = bankProviderIndexes[table];
      let providerIndex = desiredIndex ? 'missing' : 'not_required';
      for (const index of indexes.filter(index => index.unique === 1 && index.partial === 0)) {
        const keys = db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno LIMIT 129').all(index.name);
        if (keys.length > 128) throw new Error();
        if (desiredIndex && keys.map(key => key.name).join('|') === desiredIndex.join('|')) providerIndex = 'matched';
      }
      const extra = columns.filter(column => column.hidden === 0 && column.notnull === 1
        && column.dflt_value === null && column.pk === 0 && !expected.includes(column.name)).length;
      const counts = fixedCounts({
        unexpected_required_columns: extra,
        foreign_key_rows: db.prepare('SELECT count(*) n FROM (SELECT 1 FROM pragma_foreign_key_list(?) LIMIT 129)').get(table).n,
        trigger_rows: db.prepare("SELECT count(*) n FROM (SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name=? LIMIT 129)").get(table).n,
        unique_index_count: indexes.filter(index => index.unique === 1).length,
      }, ['unexpected_required_columns', 'foreign_key_rows', 'trigger_rows', 'unique_index_count']);
      if (counts.foreignKeyRows > 128 || counts.triggerRows > 128) throw new Error();
      result.tables[table] = {
        state: 'observed', missingColumns: expected.filter(column => !known.has(column)),
        primaryKeyMatches: primary.length === 1 && primary[0] === 'id',
        providerIndex, ...counts,
      };
    } catch { result.tables[table] = { state: 'unavailable' }; }
  }
  result.state = Object.values(result.tables).every(table => table.state === 'observed') ? 'observed' : 'partial';
  return result;
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
  result.bankRuntime = inspectBankRuntime(db, bankOptions);
  result.bankCommitSchema = inspectBankCommitSchema(db);
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
