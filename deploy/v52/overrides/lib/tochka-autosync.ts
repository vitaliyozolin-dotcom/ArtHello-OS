// The only service capability is a read-only tick for the already configured bank.
export const TOCHKA_AUTOSYNC_HEADER = 'x-arthello-tochka-autosync';
export const tochkaAutomaticConnectionPredicateSql = `status <> 'На паузе' AND (is_enabled=1 OR status='Ошибка подключения')`;
const connectionId = 'INT-T-TOCHKA';
const stateKey = 'tochka-autosync:v1:' + connectionId;
const setupKey = 'integration_setup:' + connectionId;
const leaseMs = 15 * 60_000;

type Prepared = {
  bind(...values: (string | number)[]): Prepared;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
};
type Database = { prepare(sql: string): Prepared };
type Setup = {
  connectionId: string; authMethod: string; secretStatus: string;
  legalEntityId: string; customerCode: string; credentialGeneration: string;
  startDate: string; syncIntervalMinutes: number; syncMinute: number;
};
type Connection = { status: string; isEnabled: boolean; nextSyncAt: string };
type State = { version: 1; generation: string; owner: string; leasedUntil: number; nextAt: number; failures: number; outcome: string };
type Outcome = 'complete' | 'pending' | 'busy' | 'error';

const failureStages = ['setup_references', 'credential_read', 'statement_state_open', 'bank_sync',
  'statement_fence', 'sync_commit', 'statement_acknowledge', 'statement_release',
  'sync_callback', 'response_decode', 'response_result'] as const;
type TochkaSyncFailureStage = typeof failureStages[number];
export type TochkaSyncObserver = (stage: TochkaSyncFailureStage) => void;

// Observe only lexical operation names; preserve the original exception and bank behavior.
export async function runTochkaSyncStage<T>(stage: TochkaSyncFailureStage,
  operation: () => Promise<T>, observe?: TochkaSyncObserver): Promise<T> {
  try { return await operation(); }
  catch (error) { observe?.(stage); throw error; }
}

export async function isTochkaAutosyncRequest(request: Request, secret: unknown) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/integration-actions'
    || typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return false;
  const provided = request.headers.get(TOCHKA_AUTOSYNC_HEADER) || '';
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  // Fixed-length comparison; the key is random per runtime and never exposed to a user session.
  let difference = 0;
  for (let index = 0; index < secret.length; index++) difference |= secret.charCodeAt(index) ^ provided.charCodeAt(index);
  return difference === 0;
}

export function nextTochkaAutomaticSlot(now: number, intervalMinutes: number, minute: number) {
  const interval = intervalMinutes * 60_000;
  const offset = minute * 60_000;
  return (Math.floor((now - offset) / interval) + 1) * interval + offset;
}

export function canAutomaticallySyncTochka(setup: Setup | undefined, connection: Connection | undefined, now: number) {
  if (!setup || !connection || setup.connectionId !== connectionId || setup.authMethod !== 'JWT'
    || setup.secretStatus !== 'stored' || !setup.legalEntityId || !setup.customerCode
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(setup.credentialGeneration)
    || ![60, 180, 360, 1440].includes(setup.syncIntervalMinutes)
    || !Number.isInteger(setup.syncMinute) || setup.syncMinute < 0 || setup.syncMinute > 59
    || !/^\d{4}-\d{2}-\d{2}$/.test(setup.startDate)
    || !Number.isFinite(Date.parse(setup.startDate))
    || new Date(setup.startDate).toISOString().slice(0, 10) !== setup.startDate
    || setup.startDate > new Date(now).toISOString().slice(0, 10)
    || connection.status === 'На паузе'
    || (!connection.isEnabled && connection.status !== 'Ошибка подключения')) return false;
  return true;
}

export async function runScheduledTochkaSync(input: {
  db: Database; setup: Setup | undefined; connection: Connection | undefined;
  run(observe: TochkaSyncObserver): Promise<Response>; now?: () => number;
}) {
  const clock = input.now ?? Date.now;
  const now = clock();
  const { setup, connection, db } = input;
  if (!canAutomaticallySyncTochka(setup, connection, now) || !setup || !connection) {
    return { outcome: 'disabled', ran: false };
  }
  const saved = await db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?')
    .bind(stateKey).first<{ state_value: string }>();
  let previous: State | null = null;
  if (saved) {
    try { previous = JSON.parse(saved.state_value) as State; } catch { throw new Error('TOCHKA_AUTOSYNC_STATE_INVALID'); }
    if (!previous || previous.version !== 1 || !Number.isFinite(previous.nextAt)
      || !Number.isFinite(previous.leasedUntil) || !Number.isInteger(previous.failures) || previous.failures < 0) {
      throw new Error('TOCHKA_AUTOSYNC_STATE_INVALID');
    }
  }
  const sameGeneration = previous?.generation === setup.credentialGeneration;
  const firstDue = Date.parse(connection.nextSyncAt);
  if (!previous && !['Формируются выписки', 'Ошибка подключения'].includes(connection.status)
    && Number.isFinite(firstDue) && firstDue > now) return { outcome: 'not_due', ran: false };
  if (sameGeneration && previous && (previous.nextAt > now || previous.leasedUntil > now)) {
    return { outcome: 'not_due', ran: false };
  }
  const next: State = { version: 1, generation: setup.credentialGeneration, owner: crypto.randomUUID(),
    leasedUntil: now + leaseMs, nextAt: now + leaseMs, failures: sameGeneration ? previous!.failures : 0, outcome: 'running' };
  const configurationGuard = `EXISTS (SELECT 1 FROM system_runtime_state WHERE state_key=?
    AND json_extract(state_value,'$.credentialGeneration')=?)
    AND EXISTS (SELECT 1 FROM integration_connections WHERE id=? AND ${tochkaAutomaticConnectionPredicateSql})`;
  const configurationBindings = [setupKey, setup.credentialGeneration, connectionId];
  const claim = await db.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    SELECT ?,?,CURRENT_TIMESTAMP WHERE ${configurationGuard}
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP
    WHERE json_extract(system_runtime_state.state_value,'$.generation')<>?
      OR (json_extract(system_runtime_state.state_value,'$.nextAt')<=?
        AND json_extract(system_runtime_state.state_value,'$.leasedUntil')<=?)`)
    .bind(stateKey, JSON.stringify(next), ...configurationBindings, setup.credentialGeneration, now, now).run();
  if (Number(claim.meta?.changes ?? 0) !== 1) return { outcome: 'busy', ran: false };

  let outcome: Outcome = 'error';
  let httpStatus = 500;
  let failureStage: TochkaSyncFailureStage | null = null;
  let fallbackStage: TochkaSyncFailureStage = 'sync_callback';
  const observe: TochkaSyncObserver = stage => {
    failureStage = failureStages.includes(stage) ? stage : 'sync_callback';
  };
  try {
    const response = await input.run(observe);
    fallbackStage = 'response_result';
    httpStatus = response.status;
    if (response.status === 409) outcome = 'busy';
    else if (response.ok) {
      fallbackStage = 'response_decode';
      const result = await response.json() as { test?: { ok?: boolean; complete?: boolean; rejectedCount?: number } };
      fallbackStage = 'response_result';
      if (result.test?.ok === true && Number(result.test.rejectedCount ?? 0) === 0) {
        outcome = result.test.complete === true ? 'complete' : 'pending';
      }
    }
  } catch {
    // Provider errors and credentials are deliberately excluded from runtime logs/state.
    outcome = 'error';
    failureStage ??= fallbackStage;
  }
  failureStage = outcome === 'error' ? failureStage ?? 'response_result' : null;
  const finishedAt = clock();
  const failures = outcome === 'error' ? Math.min(next.failures + 1, 10) : 0;
  const nextAt = outcome === 'complete' ? nextTochkaAutomaticSlot(finishedAt, setup.syncIntervalMinutes, setup.syncMinute)
    : finishedAt + (outcome === 'pending' ? 5 * 60_000 : outcome === 'busy' ? 60_000
      : Math.min(6 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(failures - 1, 5)));
  const completed = { ...next, leasedUntil: 0, nextAt, failures, outcome, httpStatus, failureStage };
  const ownedGuard = `EXISTS (SELECT 1 FROM system_runtime_state WHERE state_key=?
    AND json_extract(state_value,'$.owner')=? AND json_extract(state_value,'$.generation')=?)`;
  const ownedBindings = [stateKey, next.owner, setup.credentialGeneration];
  const finalized = await db.prepare(`UPDATE system_runtime_state SET state_value=?,updated_at=CURRENT_TIMESTAMP
    WHERE state_key=? AND ${ownedGuard} AND ${configurationGuard}`)
    .bind(JSON.stringify(completed), stateKey, ...ownedBindings, ...configurationBindings).run();
  if (Number(finalized.meta?.changes ?? 0) !== 1) return { outcome: 'superseded', ran: true };
  await db.prepare(`UPDATE integration_connections SET next_sync_at=?,
    status=CASE WHEN ?='error' THEN 'Ошибка подключения' ELSE status END,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND ${ownedGuard} AND ${configurationGuard}`)
    .bind(new Date(nextAt).toISOString(), outcome, connectionId, ...ownedBindings, ...configurationBindings).run();
  return { outcome, ran: true, nextSyncAt: new Date(nextAt).toISOString(), failureStage };
}
