export type AlfaSyncMode =
  "full_sandbox_read_only" | "incremental_discovery_read_only";

export interface IncrementalWindow {
  watermark: string;
  overlapDays: number;
  dateFrom: string;
  dateTo: string;
}

export function resolveAlfaSyncMode(value: string | undefined): AlfaSyncMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "full") {
    return "full_sandbox_read_only";
  }
  if (normalized === "incremental" || normalized === "incremental_discovery") {
    return "incremental_discovery_read_only";
  }
  throw new Error("invalid_sync_mode");
}

export function resolveOverlapDays(value: string | undefined): number {
  if (!value?.trim()) return 2;
  if (!/^\d+$/.test(value.trim())) throw new Error("invalid_overlap_days");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 7) throw new Error("invalid_overlap_days");
  return parsed;
}

export function resolveIncrementalWindow(
  mode: AlfaSyncMode,
  watermarkValue: string | null,
  overlapValue: string | undefined,
  now = new Date(),
): IncrementalWindow | null {
  if (mode === "full_sandbox_read_only") return null;
  if (!watermarkValue?.trim()) throw new Error("missing_incremental_watermark");

  const watermarkDate = new Date(watermarkValue);
  if (Number.isNaN(watermarkDate.getTime())) {
    throw new Error("invalid_incremental_watermark");
  }
  const overlapDays = resolveOverlapDays(overlapValue);
  const dateFromValue = new Date(
    watermarkDate.getTime() - overlapDays * 24 * 60 * 60 * 1000,
  );
  if (Number.isNaN(now.getTime())) throw new Error("invalid_sync_clock");

  return {
    watermark: watermarkDate.toISOString(),
    overlapDays,
    dateFrom: dateFromValue.toISOString().slice(0, 10),
    dateTo: now.toISOString().slice(0, 10),
  };
}
