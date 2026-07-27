const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:[.,](\d+))?$/;

function safeMinor(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new Error("MONEY_MINOR_OUT_OF_RANGE");
  }
  return converted;
}

export function decimalToMinorUnits(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("MONEY_DECIMAL_INVALID");
    const scaled = value * 100;
    const rounded = Math.round(scaled);
    if (
      !Number.isSafeInteger(rounded) ||
      Math.abs(scaled - rounded) > 1e-7
    ) {
      throw new Error("MONEY_DECIMAL_PRECISION_EXCEEDS_CENTS");
    }
    return rounded;
  }

  const normalized = String(value ?? "").trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new Error("MONEY_DECIMAL_INVALID");

  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new Error("MONEY_DECIMAL_PRECISION_EXCEEDS_CENTS");
  }
  const cents = `${fraction.slice(0, 2)}00`.slice(0, 2);
  const absoluteMinor = BigInt(whole) * 100n + BigInt(cents);
  return safeMinor(sign === "-" ? -absoluteMinor : absoluteMinor);
}

export function nullableDecimalToMinorUnits(
  value: unknown,
): number | null {
  return value === null || value === undefined || value === ""
    ? null
    : decimalToMinorUnits(value);
}

export function minorUnitsToLegacyNumber(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("MONEY_MINOR_INVALID");
  return value / 100;
}
