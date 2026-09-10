export type FinanceOperationShape = {
  id: string;
  period: string;
  direction: string;
  amountMinor: number;
  reportClass: string;
  category: string;
};

export type FinanceBudgetShape = {
  period: string;
  line: string;
  planMinor: number;
};

export function summarizeCash(operations: FinanceOperationShape[], period: string) {
  const selected = operations.filter((operation) => operation.period === period);
  const receiptsMinor = selected
    .filter((operation) => operation.direction === "Поступление")
    .reduce((sum, operation) => sum + operation.amountMinor, 0);
  const outflowsMinor = selected
    .filter((operation) => operation.direction === "Списание")
    .reduce((sum, operation) => sum + operation.amountMinor, 0);
  return { receiptsMinor, outflowsMinor, netMinor: receiptsMinor - outflowsMinor };
}

export function summarizePnl(operations: FinanceOperationShape[], budgets: FinanceBudgetShape[], period: string) {
  const selected = operations.filter((operation) => operation.period === period);
  const revenueMinor = selected
    .filter((operation) => operation.reportClass === "Доходы ОПиУ")
    .reduce((sum, operation) => sum + operation.amountMinor, 0);
  const expenseMinor = selected
    .filter((operation) => operation.reportClass === "Расходы ОПиУ")
    .reduce((sum, operation) => sum + operation.amountMinor, 0);
  const planRevenueMinor = budgets
    .filter((budget) => budget.period === period && budget.line === "Доходы ОПиУ")
    .reduce((sum, budget) => sum + budget.planMinor, 0);
  const planExpenseMinor = budgets
    .filter((budget) => budget.period === period && budget.line === "Расходы ОПиУ")
    .reduce((sum, budget) => sum + budget.planMinor, 0);
  return {
    revenueMinor,
    expenseMinor,
    resultMinor: revenueMinor - expenseMinor,
    planRevenueMinor,
    planExpenseMinor,
    planResultMinor: planRevenueMinor - planExpenseMinor,
  };
}

export function calculateForecast(items: Array<{ forecastDate: string; direction: string; amountMinor: number }>, openingBalanceMinor: number) {
  let balanceMinor = openingBalanceMinor;
  return [...items]
    .sort((left, right) => left.forecastDate.localeCompare(right.forecastDate))
    .map((item) => {
      balanceMinor += item.direction === "Поступление" ? item.amountMinor : -item.amountMinor;
      return { ...item, balanceMinor, isGap: balanceMinor < 0 };
    });
}

export function formatPeriod(period: string) {
  const labels: Record<string, string> = {
    "2026-01": "Январь 2026",
    "2026-02": "Февраль 2026",
    "2026-03": "Март 2026",
    "2026-04": "Апрель 2026",
    "2026-05": "Май 2026",
    "2026-06": "Июнь 2026",
  };
  return labels[period] ?? period;
}
