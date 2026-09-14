type AlfaImportBatch = {
  complete?: boolean;
  nextCursor?: number;
  error?: string;
  rejected?: number;
  projectionBlocked?: boolean;
  [key: string]: unknown;
};

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
