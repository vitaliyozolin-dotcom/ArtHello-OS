export type BankFactRow = {
  operationDate: string;
  direction: string;
  amountMinor: number;
  currency: string;
};

export type BankPeriodSummary = {
  period: string;
  transactionCount: number;
  incomingMinor: number;
  outgoingMinor: number;
  netMinor: number;
};

// D172_CANONICAL_MONEY_SOURCE: bank_transactions is the only source for
// generic operation counts, receipts and outflows shown on Home and Money.
export function isIncomingBankDirection(direction: string) {
  return /credit|incoming|приход|поступ|вход/i.test(direction);
}

export function bankOperationPeriod(operationDate: string) {
  return /^\d{4}-\d{2}/.test(operationDate) ? operationDate.slice(0, 7) : "";
}

export function summarizeBankPeriod<T extends BankFactRow>(rows: readonly T[], period: string): BankPeriodSummary {
  const selected = rows.filter((row) => bankOperationPeriod(row.operationDate) === period && row.currency === "RUB");
  const incomingMinor = selected
    .filter((row) => isIncomingBankDirection(row.direction))
    .reduce((sum, row) => sum + Math.abs(Number(row.amountMinor)), 0);
  const outgoingMinor = selected
    .filter((row) => !isIncomingBankDirection(row.direction))
    .reduce((sum, row) => sum + Math.abs(Number(row.amountMinor)), 0);
  return {
    period,
    transactionCount: selected.length,
    incomingMinor,
    outgoingMinor,
    netMinor: incomingMinor - outgoingMinor,
  };
}

export function summarizeBankMonths<T extends BankFactRow>(rows: readonly T[]) {
  const periods = [...new Set(rows.map((row) => bankOperationPeriod(row.operationDate)).filter(Boolean))].sort();
  return periods.map((period) => summarizeBankPeriod(rows, period));
}
