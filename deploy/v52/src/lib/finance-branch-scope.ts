export const FINANCE_ACCOUNTING_START_DATE = "2026-09-01";
export const FINANCE_ACCOUNTING_START_PERIOD = FINANCE_ACCOUNTING_START_DATE.slice(0, 7);

export function requireFinanceBranch(branchId: string | null | undefined) {
  const value = String(branchId ?? "").trim();
  if (!value || value === "ALL") throw new Error("Выберите конкретный филиал для финансового отчёта");
  return value;
}

export function scopeFinanceOperations<T extends { operationDate: string; objectEntityId: string }>(operations: T[], branchId: string) {
  const selectedBranch = requireFinanceBranch(branchId);
  return operations.filter((operation) => operation.operationDate >= FINANCE_ACCOUNTING_START_DATE && operation.objectEntityId === selectedBranch);
}

