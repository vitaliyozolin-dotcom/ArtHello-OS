export function normalizePhone(value: unknown): string | null {
  const candidate = Array.isArray(value)
    ? value.find(
        (entry) =>
          (typeof entry === "string" && entry.trim() !== "") ||
          (typeof entry === "number" && Number.isFinite(entry)),
      )
    : value;
  if (typeof candidate !== "string" && typeof candidate !== "number") {
    return null;
  }
  const raw = String(candidate).trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (
    digits.length === 11 &&
    (digits.startsWith("7") || digits.startsWith("8"))
  ) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}
