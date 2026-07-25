export type MoneyDirection = "in" | "out";

export interface BankMovement {
  id: string;
  amountMinor: bigint;
  direction: MoneyDirection;
  isInternalTransfer?: boolean;
  reversalOf?: string;
}

export interface BalanceCheck {
  expectedClosingMinor: bigint;
  actualClosingMinor: bigint;
  differenceMinor: bigint;
  balanced: boolean;
}

function signedAmount(movement: BankMovement): bigint {
  if (movement.amountMinor < 0n) {
    throw new Error("Movement amount must use a non-negative magnitude");
  }
  return movement.direction === "in"
    ? movement.amountMinor
    : -movement.amountMinor;
}

export function checkBankBalanceInvariant(
  openingBalanceMinor: bigint,
  actualClosingMinor: bigint,
  movements: readonly BankMovement[],
): BalanceCheck {
  const expectedClosingMinor = movements.reduce(
    (balance, movement) => balance + signedAmount(movement),
    openingBalanceMinor,
  );
  const differenceMinor = actualClosingMinor - expectedClosingMinor;

  return {
    expectedClosingMinor,
    actualClosingMinor,
    differenceMinor,
    balanced: differenceMinor === 0n,
  };
}

export function consolidatedCashflowMinor(
  movements: readonly BankMovement[],
): bigint {
  return movements
    .filter((movement) => movement.isInternalTransfer !== true)
    .reduce(
      (total, movement) => total + signedAmount(movement),
      0n,
    );
}

export function validateReversalPairs(
  movements: readonly BankMovement[],
): void {
  const byId = new Map<string, BankMovement>();
  for (const movement of movements) {
    if (!movement.id.trim()) {
      throw new Error("Movement ID is required");
    }
    if (byId.has(movement.id)) {
      throw new Error("Movement IDs must be unique");
    }
    signedAmount(movement);
    byId.set(movement.id, movement);
  }

  const reversedIds = new Set<string>();

  for (const reversal of movements) {
    if (!reversal.reversalOf) continue;
    if (reversal.reversalOf === reversal.id) {
      throw new Error("Movement cannot reverse itself");
    }
    const original = byId.get(reversal.reversalOf);
    if (!original) {
      throw new Error("Reversal references an unknown movement");
    }
    if (original.reversalOf) {
      throw new Error("A reversal cannot reverse another reversal");
    }
    if (reversedIds.has(original.id)) {
      throw new Error("Movement cannot have multiple full reversals");
    }
    if (
      original.amountMinor !== reversal.amountMinor ||
      original.direction === reversal.direction
    ) {
      throw new Error("Reversal must exactly offset the original movement");
    }
    reversedIds.add(original.id);
  }
}

function calendarDateFromIso(value: string): {
  date: string;
  month: string;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (!match) throw new Error("Date must be an ISO calendar date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (daysInMonth[month - 1] ?? 0)
  ) {
    throw new Error("Date is outside calendar bounds");
  }
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    month: `${match[1]}-${match[2]}`,
  };
}

export function reportingPeriods(input: {
  cashflowDate: string;
  accrualDate?: string | null;
}): {
  cashflowMonth: string;
  pnlMonth: string;
} {
  return {
    cashflowMonth: calendarDateFromIso(input.cashflowDate).month,
    pnlMonth: calendarDateFromIso(
      input.accrualDate ?? input.cashflowDate,
    ).month,
  };
}

export interface PayrollRuleVersion {
  id: string;
  version: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function selectPayrollRuleVersion<T extends PayrollRuleVersion>(
  rules: readonly T[],
  serviceDate: string,
): T {
  const normalizedServiceDate = calendarDateFromIso(serviceDate).date;
  const candidates = rules.filter((rule) => {
    const effectiveFrom = calendarDateFromIso(rule.effectiveFrom).date;
    const effectiveTo =
      rule.effectiveTo == null
        ? null
        : calendarDateFromIso(rule.effectiveTo).date;
    if (effectiveTo != null && effectiveTo < effectiveFrom) {
      throw new Error("Payroll rule effective range is invalid");
    }
    return (
      effectiveFrom <= normalizedServiceDate &&
      (effectiveTo == null || normalizedServiceDate <= effectiveTo)
    );
  });

  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "No payroll rule covers the service date"
        : "Payroll rule versions overlap for the service date",
    );
  }

  return candidates[0];
}

/**
 * Converts a decimal string to integer minor units with deterministic
 * half-away-from-zero rounding. No floating-point arithmetic is used.
 */
export function decimalToMinorUnits(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error("Money value must be a decimal string");

  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  const cents = BigInt((fraction.slice(0, 2) + "00").slice(0, 2));
  const roundUp = Number(fraction[2] ?? "0") >= 5;
  const magnitude = whole * 100n + cents + (roundUp ? 1n : 0n);

  return negative ? -magnitude : magnitude;
}
