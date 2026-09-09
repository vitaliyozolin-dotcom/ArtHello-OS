import assert from "node:assert/strict";
import test from "node:test";
import { calculateForecast, summarizeCash, summarizePnl } from "../lib/finance.ts";

test("cash summary uses integer minor units and reconciles receipts minus outflows", () => {
  const operations = [
    { id: "1", period: "2026-04", direction: "Поступление", amountMinor: 1138045000, reportClass: "Доходы ОПиУ", category: "Доход" },
    { id: "2", period: "2026-04", direction: "Списание", amountMinor: 750022105, reportClass: "Расходы ОПиУ", category: "Расход" },
  ];
  assert.deepEqual(summarizeCash(operations, "2026-04"), {
    receiptsMinor: 1138045000,
    outflowsMinor: 750022105,
    netMinor: 388022895,
  });
});

test("P&L excludes financing rows and keeps the plan separate from actual", () => {
  const operations = [
    { id: "1", period: "2026-04", direction: "Поступление", amountMinor: 10000, reportClass: "Доходы ОПиУ", category: "Выручка" },
    { id: "2", period: "2026-04", direction: "Списание", amountMinor: 4000, reportClass: "Расходы ОПиУ", category: "Зарплата" },
    { id: "3", period: "2026-04", direction: "Списание", amountMinor: 3000, reportClass: "Финансирование", category: "Займ" },
  ];
  assert.deepEqual(summarizePnl(operations, [
    { period: "2026-04", line: "Доходы ОПиУ", planMinor: 9000 },
    { period: "2026-04", line: "Расходы ОПиУ", planMinor: 3500 },
  ], "2026-04"), {
    revenueMinor: 10000,
    expenseMinor: 4000,
    resultMinor: 6000,
    planRevenueMinor: 9000,
    planExpenseMinor: 3500,
    planResultMinor: 5500,
  });
});

test("forecast exposes the first negative closing balance", () => {
  const rows = calculateForecast([
    { forecastDate: "2026-09-04", direction: "Списание", amountMinor: 700 },
    { forecastDate: "2026-09-05", direction: "Списание", amountMinor: 500 },
  ], 1000);
  assert.equal(rows[0].isGap, false);
  assert.equal(rows[1].isGap, true);
  assert.equal(rows[1].balanceMinor, -200);
});
