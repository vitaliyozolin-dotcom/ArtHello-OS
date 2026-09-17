import { normalizePhone } from "@workspace/shared/normalize-phone";

export function normalizeSmsVizitkaPhone(value: string): string | null {
  const normalized = normalizePhone(value);
  if (!normalized) return null;

  const digitCount = normalized.length - 1;
  return digitCount >= 10 && digitCount <= 15 ? normalized : null;
}
