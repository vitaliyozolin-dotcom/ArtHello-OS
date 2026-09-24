type AlfaImportBatch = {
  complete?: boolean;
  nextCursor?: number;
  error?: string;
  rejected?: number;
  projectionBlocked?: boolean;
  [key: string]: unknown;
};

type ScopedAlfaRow = { remoteBranchId: string; item: Record<string, unknown> };
export const ALFA_SCOPE_CONTRACT = 'source-branch-membership-v1';
export function alfaBranchDisposition(module: string, row: ScopedAlfaRow): 'accepted' | 'foreignBranch' | 'inactive' | 'unknown' {
  const { item, remoteBranchId } = row;
  const id = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    || (typeof value === 'string' && /^[1-9]\d*$/.test(value));
  if (!id(item.id) || !id(remoteBranchId)) return 'unknown';
  const branches = ['families', 'staff', 'groups'].includes(module) ? item.branch_ids : [item.branch_id];
  if (!Array.isArray(branches) || !branches.every(id)) return 'unknown';
  if (!branches.map(String).includes(remoteBranchId)) return 'foreignBranch';
  if (module === 'families') {
    if (![0, 1, '0', '1', false, true].includes(item.is_study as number)) return 'unknown';
    if (isFalseFlag(item.is_study)) return 'inactive';
  }
  if ([true, 1, 2, '1', '2', 'true'].includes(item.removed as number) || isFalseFlag(item.is_active)) return 'inactive';
  if (['staff', 'groups'].includes(module) && !isCurrentAlfaStaffRecord(item)) return 'inactive';
  return 'accepted';
}

export function scopedAlfaRows<T extends ScopedAlfaRow>(module: string, rows: T[]): T[] {
  if (!['families', 'staff', 'groups', 'lessons'].includes(module)) return rows;
  const classified = rows.map(row => ({ row, disposition: alfaBranchDisposition(module, row) }));
  if (classified.some(r => r.disposition === 'unknown')) {
    throw new Error('AlfaCRM не подтвердила филиал или состояние записи. Загрузка остановлена; существующие карточки сохранены.');
  }
  return classified.filter(r => r.disposition === 'accepted').map(r => r.row);
}

export function auditAlfaBranchRows(module: string, rows: ScopedAlfaRow[]) {
  const result = { observed: rows.length, accepted: 0, foreignBranch: 0, inactive: 0, unknown: 0,
    uniqueCustomers: 0, complete: true, byBranch: {} as Record<string, number> };
  const ids = new Set<string>();
  for (const row of rows) {
    const disposition = alfaBranchDisposition(module, row);
    result[disposition] += 1;
    if (disposition === 'accepted') {
      ids.add(String(row.item.id));
      result.byBranch[row.remoteBranchId] = (result.byBranch[row.remoteBranchId] ?? 0) + 1;
    }
  }
  result.uniqueCustomers = ids.size;
  result.complete = result.unknown === 0;
  return result;
}

export const ALFA_AUTO_MODULES = ['families', 'staff', 'groups', 'subscriptions'] as const;
export type AlfaAutoModule = typeof ALFA_AUTO_MODULES[number];
export type AlfaAutosync = {
  enabled: boolean; modules: AlfaAutoModule[]; scope: string;
  index: number; phase: 'preview' | 'import'; cursor: number;
  nextAt: number; lastSuccessAt: number; failures: number;
  outcome: 'ready' | 'pending' | 'complete' | 'retry' | 'paused';
};

export function newAlfaAutosync(modules: string[], scope: string, now: number): AlfaAutosync {
  if (!modules.length || modules.some(m => !ALFA_AUTO_MODULES.includes(m as AlfaAutoModule))
    || (modules.includes('groups') && !modules.includes('staff'))
    || (modules.includes('subscriptions') && !modules.includes('families'))) {
    throw new Error('Выберите семьи, сотрудников и зависимые от них группы или остатки.');
  }
  return { enabled: true, modules: ALFA_AUTO_MODULES.filter(m => modules.includes(m)), scope,
    index: 0, phase: 'preview', cursor: 0, nextAt: now, lastSuccessAt: 0, failures: 0, outcome: 'ready' };
}

export function advanceAlfaAutosync(state: AlfaAutosync,
  result: { status: number; previewToken?: unknown; complete?: unknown; nextCursor?: unknown; rejected?: unknown; projectionBlocked?: unknown },
  now: number): AlfaAutosync {
  const next = { ...state, nextAt: now + 60_000 };
  if (result.status >= 400 || Number(result.rejected) > 0 || result.projectionBlocked === true) {
    next.failures += 1;
    const transient = result.status === 429 || result.status >= 500;
    next.enabled = transient && next.failures < 5;
    next.outcome = next.enabled ? 'retry' : 'paused';
    next.nextAt = now + Math.min(2 * 3600_000, 300_000 * 2 ** Math.min(next.failures - 1, 5));
    return next;
  }
  next.failures = 0;
  next.outcome = 'pending';
  if (state.phase === 'preview') {
    if (typeof result.previewToken !== 'string' || !result.previewToken) return { ...next, enabled: false, outcome: 'paused' };
    return { ...next, phase: 'import', cursor: 0 };
  }
  if (result.complete === false) {
    if (!Number.isSafeInteger(result.nextCursor) || Number(result.nextCursor) <= state.cursor) return { ...next, enabled: false, outcome: 'paused' };
    return { ...next, cursor: Number(result.nextCursor) };
  }
  if (result.complete !== true) return { ...next, enabled: false, outcome: 'paused' };
  next.index += 1;
  next.phase = 'preview';
  next.cursor = 0;
  if (next.index >= state.modules.length) {
    Object.assign(next, { index: 0, lastSuccessAt: now, nextAt: now + 3600_000, outcome: 'complete' });
  }
  return next;
}

export async function authenticateAlfaAutosync(request: Request, secret: string) {
  const provided = request.headers.get('x-arthello-alfa-autosync') ?? '';
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/integrations/alfacrm'
    || request.headers.has('cookie') || request.headers.has('origin')
    || !/^[a-f0-9]{64}$/.test(secret) || !/^[a-f0-9]{64}$/.test(provided)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(provided));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(secret));
}

export async function runChunkedAlfaImport<T extends AlfaImportBatch>(
  importBatch: () => Promise<T>,
  onBatch: (batch: T) => void = () => undefined,
) {
  let previousCursor = -1;
  for (let batchNumber = 0; batchNumber < 10_000; batchNumber += 1) {
    const result = await importBatch();
    onBatch(result);
    if (result.error || Number(result.rejected) > 0 || result.projectionBlocked === true || result.complete !== false) return result;
    const cursor = result.nextCursor;
    if (!Number.isSafeInteger(cursor) || Number(cursor) <= previousCursor) {
      throw new Error("Пакетная загрузка AlfaCRM не продвинулась. Данные сохранены; повторите проверку перед продолжением.");
    }
    previousCursor = Number(cursor);
  }
  throw new Error("Пакетная загрузка AlfaCRM превысила безопасный предел. Данные сохранены; повторите проверку.");
}

export function isCurrentAlfaStaffRecord(item: Record<string, unknown>, today = new Date()) {
  if (isFalseFlag(item.is_active) || isTrueFlag(item.removed)) return false;
  const endDate = parseAlfaDate(item.e_date ?? item.date_to ?? item.end_date);
  if (!endDate) return true;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return endDate >= todayUtc;
}

function isFalseFlag(value: unknown) {
  return value === false || value === 0 || value === "0" || (typeof value === "string" && value.trim().toLowerCase() === "false");
}

function isTrueFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function parseAlfaDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
  const russian = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(normalized);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : russian ? [Number(russian[3]), Number(russian[2]), Number(russian[1])] : null;
  if (!parts) return null;
  const timestamp = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2]
    ? timestamp
    : null;
}
