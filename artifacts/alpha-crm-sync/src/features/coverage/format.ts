export function formatCoverageTimestamp(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCoverageDuration(
  milliseconds: number | null | undefined,
): string {
  if (!milliseconds) return "—";
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${(milliseconds / 60_000).toFixed(1)}min`;
}
