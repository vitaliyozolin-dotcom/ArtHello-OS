// Persistent read-only statement jobs. No credentials or provider payloads are stored here.
export type TochkaStatementScope = { accountId: string; startDate: string; endDate: string };
export type TochkaStatementLeaseFence = { key: string; owner: string };
export type TochkaPendingStatementStore = {
  get(scope: TochkaStatementScope): Promise<string | null>;
  put(scope: TochkaStatementScope, statementId: string): Promise<void>;
  forget(scope: TochkaStatementScope, statementId: string): Promise<void>;
  resolveEndDate(startDate: string, targetEndDate: string, accountIds: string[]): Promise<string>;
};
type Prepared = {
  bind(...values: (string | number)[]): Prepared;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
};
type Database = { prepare(sql: string): Prepared };
type CredentialScope = {
  connectionId: string;
  legalEntityId: string;
  customerCode: string;
  credentialGeneration: string;
  credentialStateKey: string;
  setupStateKey: string;
};

export const tochkaStatementLeaseGuardSql = `EXISTS (
  SELECT 1 FROM system_runtime_state AS statement_lease
  WHERE statement_lease.state_key=?
    AND json_extract(statement_lease.state_value,'$.owner')=?
    AND CAST(json_extract(statement_lease.state_value,'$.expiresAtMs') AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)*1000
)`;
const leaseDurationMs = 120_000;
const jobPrefix = 'tochka-statement-pending:v1:';

export class TochkaStatementStateChanged extends Error {
  constructor() { super('Синхронизация Точки уже выполняется или параметры подключения изменились. Повторите загрузку.'); }
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
function validateStatementScope(scope: TochkaStatementScope) {
  if (!/^\d{20}(?:\/\d{9})?$/.test(scope.accountId)
    || !validDate(scope.startDate) || !validDate(scope.endDate) || scope.startDate > scope.endDate) {
    throw new TochkaStatementStateChanged();
  }
}
function validateStatementId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
async function hash(values: string[]) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function changed(result: { meta?: { changes?: number } }) { return Number(result.meta?.changes ?? 0) === 1; }

export async function acquireTochkaStatementState(db: Database, scope: CredentialScope) {
  if (scope.connectionId !== 'INT-T-TOCHKA' || !scope.legalEntityId || !scope.customerCode
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scope.credentialGeneration)) {
    throw new TochkaStatementStateChanged();
  }
  const credentialGuard = `EXISTS (
    SELECT 1 FROM system_runtime_state AS saved_setup
    JOIN system_runtime_state AS saved_credential ON saved_credential.state_key=?
    WHERE saved_setup.state_key=?
      AND json_extract(saved_setup.state_value,'$.credentialGeneration')=?
      AND json_extract(saved_setup.state_value,'$.legalEntityId')=?
      AND json_extract(saved_setup.state_value,'$.customerCode')=?
  )`;
  const credentialBindings = [scope.credentialStateKey, scope.setupStateKey, scope.credentialGeneration, scope.legalEntityId, scope.customerCode];
  const fence = { key: 'tochka-statement-lease:v1:' + scope.connectionId, owner: crypto.randomUUID() };
  const now = Date.now();
  const acquired = await db.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    SELECT ?,?,CURRENT_TIMESTAMP WHERE ${credentialGuard}
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP
    WHERE CAST(json_extract(system_runtime_state.state_value,'$.expiresAtMs') AS INTEGER)<=?`)
    .bind(fence.key, JSON.stringify({ version: 1, owner: fence.owner, expiresAtMs: now + leaseDurationMs }), ...credentialBindings, now).run();
  if (!changed(acquired)) return null;

  const guarded = `${credentialGuard} AND ${tochkaStatementLeaseGuardSql}`;
  const guardBindings = [...credentialBindings, fence.key, fence.owner];
  const scopeHash = await hash([scope.connectionId, scope.legalEntityId, scope.customerCode, scope.credentialGeneration]);
  const jobKey = async (statement: TochkaStatementScope) => {
    validateStatementScope(statement);
    return jobPrefix + await hash([scopeHash, statement.accountId, statement.startDate, statement.endDate]);
  };
  const assertCurrent = async () => {
    const renewed = await db.prepare(`UPDATE system_runtime_state
      SET state_value=json_set(state_value,'$.expiresAtMs',?),updated_at=CURRENT_TIMESTAMP
      WHERE state_key=? AND json_extract(state_value,'$.owner')=?
        AND CAST(json_extract(state_value,'$.expiresAtMs') AS INTEGER)>?
        AND ${credentialGuard}`)
      .bind(Date.now() + leaseDurationMs, fence.key, fence.owner, Date.now(), ...credentialBindings).run();
    if (!changed(renewed)) throw new TochkaStatementStateChanged();
  };
  const store: TochkaPendingStatementStore = {
    async get(statement) {
      await assertCurrent();
      const key = await jobKey(statement);
      const row = await db.prepare(`SELECT state_value FROM system_runtime_state WHERE state_key=? AND ${guarded}`)
        .bind(key, ...guardBindings).first<{ state_value: string }>();
      if (!row) return null;
      let value: Record<string, unknown>;
      try { value = JSON.parse(row.state_value) as Record<string, unknown>; } catch { throw new TochkaStatementStateChanged(); }
      if (!value || value.version !== 1 || value.scopeHash !== scopeHash
        || value.accountId !== statement.accountId || value.startDate !== statement.startDate || value.endDate !== statement.endDate
        || !validateStatementId(value.statementId)) throw new TochkaStatementStateChanged();
      return value.statementId;
    },
    async put(statement, statementId) {
      await assertCurrent();
      if (!validateStatementId(statementId)) throw new TochkaStatementStateChanged();
      const key = await jobKey(statement);
      const value = JSON.stringify({ version: 1, scopeHash, ...statement, statementId });
      const result = await db.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
        SELECT ?,?,CURRENT_TIMESTAMP WHERE ${guarded}
        ON CONFLICT(state_key) DO NOTHING`)
        .bind(key, value, ...guardBindings).run();
      if (!changed(result)) {
        const existing = await store.get(statement);
        if (existing !== statementId) throw new TochkaStatementStateChanged();
      }
    },
    async forget(statement, statementId) {
      await assertCurrent();
      const key = await jobKey(statement);
      await db.prepare(`DELETE FROM system_runtime_state WHERE state_key=?
        AND json_extract(state_value,'$.statementId')=? AND ${guarded}`)
        .bind(key, statementId, ...guardBindings).run();
    },
    async resolveEndDate(startDate, targetEndDate, accountIds) {
      await assertCurrent();
      if (!validDate(startDate) || !validDate(targetEndDate) || startDate > targetEndDate) throw new TochkaStatementStateChanged();
      const accounts = [...new Set(accountIds)];
      if (!accounts.length || accounts.length > 200) throw new TochkaStatementStateChanged();
      for (const accountId of accounts) validateStatementScope({ accountId, startDate, endDate: targetEndDate });
      let endDate = targetEndDate;
      // Only accounts still granted by the current bank discovery can freeze the window.
      // Chunk the IN list to stay below D1's bound-parameter limit.
      for (let offset = 0; offset < accounts.length; offset += 40) {
        const chunk = accounts.slice(offset, offset + 40);
        const row = await db.prepare(`SELECT MIN(json_extract(state_value,'$.endDate')) AS end_date
        FROM system_runtime_state WHERE state_key LIKE ?
          AND json_valid(state_value)
          AND json_extract(state_value,'$.version')=1
          AND json_extract(state_value,'$.scopeHash')=?
          AND json_extract(state_value,'$.startDate')=?
          AND json_extract(state_value,'$.endDate')>=?
          AND json_extract(state_value,'$.endDate')<=?
          AND json_extract(state_value,'$.accountId') IN (${chunk.map(() => '?').join(',')})
          AND ${guarded}`)
          .bind(jobPrefix+'%', scopeHash, startDate, startDate, targetEndDate, ...chunk, ...guardBindings).first<{ end_date: string | null }>();
        const candidate = row?.end_date ?? targetEndDate;
        if (!validDate(candidate)) throw new TochkaStatementStateChanged();
        if (candidate < endDate) endDate = candidate;
      }
      return endDate;
    },
  };
  return {
    fence,
    store,
    assertCurrent,
    async complete(statements: Array<TochkaStatementScope & { statementId: string }>) {
      await assertCurrent();
      for (const statement of statements) {
        await store.forget(statement, statement.statementId);
      }
    },
    async release() {
      await db.prepare(`DELETE FROM system_runtime_state WHERE state_key=? AND json_extract(state_value,'$.owner')=?`)
        .bind(fence.key, fence.owner).run();
    },
  };
}
