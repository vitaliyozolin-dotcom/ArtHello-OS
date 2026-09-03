import { env } from "cloudflare:workers";

const DISPATCH_LEASE_MS = 30_000;

type AccessSyncEventRow = {
  event_type: string;
  user_id: string;
  payload: string;
  status: string;
  result: string;
};

export type AccessSyncClaim =
  | {
    claimed: true;
    claimToken: string;
    eventType: string;
    userId: string;
    payload: string;
  }
  | {
    claimed: false;
    status: string;
    result: Record<string, unknown>;
  };

/**
 * Claims one durable outbox row. The nonce in last_error makes completion a
 * compare-and-swap operation if a crashed delivery is reclaimed after expiry.
 */
export async function claimAccessSyncEvent(eventId: string, allowedEventTypes: readonly string[]): Promise<AccessSyncClaim> {
  if (!eventId || !allowedEventTypes.length) throw new Error("Access sync event is unavailable");
  const now = new Date();
  const claimedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - DISPATCH_LEASE_MS).toISOString();
  const claimToken = `claim:${crypto.randomUUID()}`;
  const placeholders = allowedEventTypes.map(() => "?").join(",");
  const claimed = await env.DB.prepare(`UPDATE access_sync_events
    SET status='Синхронизация выполняется',attempts=attempts+1,last_error=?,updated_at=?
    WHERE id=? AND system_id='SYS-SCHOOL-1-11'
      AND event_type IN (${placeholders})
      AND (
        status IN ('Ожидает синхронизации','Ожидает подключения','Ошибка синхронизации')
        OR (status='Синхронизация выполняется' AND updated_at<=?)
      )
    RETURNING event_type,user_id,payload,status,result`)
    .bind(claimToken, claimedAt, eventId, ...allowedEventTypes, staleBefore)
    .first<AccessSyncEventRow>();
  if (claimed) {
    return {
      claimed: true,
      claimToken,
      eventType: claimed.event_type,
      userId: claimed.user_id,
      payload: claimed.payload,
    };
  }

  const existing = await env.DB.prepare(`SELECT event_type,user_id,payload,status,result
    FROM access_sync_events
    WHERE id=? AND system_id='SYS-SCHOOL-1-11' AND event_type IN (${placeholders})`)
    .bind(eventId, ...allowedEventTypes)
    .first<AccessSyncEventRow>();
  if (!existing) throw new Error("Access sync event is unavailable");
  return { claimed: false, status: existing.status, result: safeStoredResult(existing.result) };
}

/** Records a deployment/configuration wait without counting a transport attempt. */
export async function deferAccessSyncEvent(eventId: string, allowedEventTypes: readonly string[], message: string) {
  if (!eventId || !allowedEventTypes.length) throw new Error("Access sync event is unavailable");
  const placeholders = allowedEventTypes.map(() => "?").join(",");
  const deferred = await env.DB.prepare(`UPDATE access_sync_events
    SET status='Ожидает подключения',last_error=?,updated_at=?
    WHERE id=? AND system_id='SYS-SCHOOL-1-11'
      AND event_type IN (${placeholders})
      AND status IN ('Ожидает синхронизации','Ожидает подключения','Ошибка синхронизации')
    RETURNING status,result`)
    .bind(message, new Date().toISOString(), eventId, ...allowedEventTypes)
    .first<Pick<AccessSyncEventRow, "status" | "result">>();
  if (deferred) return { status: deferred.status, result: safeStoredResult(deferred.result) };
  const existing = await env.DB.prepare(`SELECT status,result FROM access_sync_events
    WHERE id=? AND system_id='SYS-SCHOOL-1-11' AND event_type IN (${placeholders})`)
    .bind(eventId, ...allowedEventTypes)
    .first<Pick<AccessSyncEventRow, "status" | "result">>();
  if (!existing) throw new Error("Access sync event is unavailable");
  return { status: existing.status, result: safeStoredResult(existing.result) };
}

export function accessSyncClaimGuard() {
  return `EXISTS (SELECT 1 FROM access_sync_events
    WHERE id=? AND status='Синхронизация выполняется' AND last_error=?)`;
}

export function accessSyncCompletionStatement(
  eventId: string,
  claimToken: string,
  status: string,
  error: string,
  result: Record<string, unknown>,
) {
  return env.DB.prepare(`UPDATE access_sync_events
    SET status=?,last_error=?,result=?,updated_at=?
    WHERE id=? AND status='Синхронизация выполняется' AND last_error=?`)
    .bind(status, error, JSON.stringify(result), new Date().toISOString(), eventId, claimToken);
}

export function batchChangeCount(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const meta = (value as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return 0;
  const changes = (meta as { changes?: unknown }).changes;
  return typeof changes === "number" ? changes : 0;
}

function safeStoredResult(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      ...(typeof parsed.expiresAt === "string" ? { expiresAt: parsed.expiresAt } : {}),
      ...(typeof parsed.deliveryStatus === "string" ? { deliveryStatus: parsed.deliveryStatus } : {}),
      ...(typeof parsed.activationPrepared === "boolean" ? { activationPrepared: parsed.activationPrepared } : {}),
    };
  } catch {
    return {};
  }
}
