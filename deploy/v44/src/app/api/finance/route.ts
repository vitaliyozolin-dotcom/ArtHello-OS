import { asc, desc } from "drizzle-orm";
import { ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import {
  entities,
  financeAccruals,
  financeBudgets,
  financeCorrections,
  financeForecastItems,
  financePayrollSummary,
  financeReconciliationIssues,
  financialOperations,
} from "../../../db/schema";
import { calculateForecast, summarizeCash, summarizePnl } from "../../../lib/finance";
import { getRequestUser } from "../../../lib/request-user";

const sourceTotals: Record<string, { receiptsMinor: number; outflowsMinor: number; netMinor: number }> = {
  "2026-01": { receiptsMinor: 657689500, outflowsMinor: 674834821, netMinor: -3670883 },
  "2026-02": { receiptsMinor: 738371000, outflowsMinor: 806436008, netMinor: -68065008 },
  "2026-03": { receiptsMinor: 818974150, outflowsMinor: 856577400, netMinor: -37603250 },
  "2026-04": { receiptsMinor: 1138045000, outflowsMinor: 750022105, netMinor: 388022895 },
  "2026-08": { receiptsMinor: 13100000, outflowsMinor: 0, netMinor: 13100000 },
};

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const mode = await getSystemDataMode();
    const [storedOperations, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows] = await Promise.all([
      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),
      db.select().from(financeAccruals).orderBy(desc(financeAccruals.period), asc(financeAccruals.contour)),
      db.select().from(financeBudgets).orderBy(asc(financeBudgets.period), asc(financeBudgets.line)),
      db.select().from(financeForecastItems).orderBy(asc(financeForecastItems.forecastDate)),
      db.select().from(financePayrollSummary).orderBy(asc(financePayrollSummary.period)),
      db.select().from(financeCorrections).orderBy(desc(financeCorrections.id)).limit(50),
      db.select().from(financeReconciliationIssues).orderBy(asc(financeReconciliationIssues.id)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
    ]);
    const operations = mode === "source_only"
      ? storedOperations.filter((operation) => !operation.sourceSystem.startsWith("SYNTHETIC"))
      : storedOperations;
    const budgets = mode === "source_only" ? [] : storedBudgets;
    const forecasts = mode === "source_only" ? [] : storedForecasts;
    const entityNames = Object.fromEntries(entityRows.map((entity) => [entity.id, entity.displayName]));
    const requestedPeriod = new URL(request.url).searchParams.get("period") ?? "2026-04";
    const selectedPeriod = sourceTotals[requestedPeriod] && !(mode === "source_only" && requestedPeriod === "2026-08") ? requestedPeriod : "2026-04";
    const cash = summarizeCash(operations, selectedPeriod);
    const pnl = summarizePnl(operations, budgets, selectedPeriod);
    const openingBalanceMinor = 120000000;
    const forecastTimeline = calculateForecast(forecasts, openingBalanceMinor);
    const firstGap = forecastTimeline.find((item) => item.isGap) ?? null;
    const debtMinor = accruals.reduce((sum, accrual) => sum + accrual.debtMinor, 0);
    const periods = mode === "source_only" ? Object.keys(sourceTotals).filter((period) => period !== "2026-08") : Object.keys(sourceTotals);
    const monthly = periods.map((period) => {
      const periodCash = summarizeCash(operations, period);
      const periodPnl = summarizePnl(operations, budgets, period);
      return { period, ...periodCash, ...periodPnl };
    });
    const groupedPnl = new Map<string, { category: string; reportClass: string; amountMinor: number; operationIds: string[] }>();
    operations.filter((operation) => operation.period === selectedPeriod).forEach((operation) => {
      const key = `${operation.reportClass}:${operation.category}`;
      const group = groupedPnl.get(key) ?? { category: operation.category, reportClass: operation.reportClass, amountMinor: 0, operationIds: [] };
      group.amountMinor += operation.amountMinor;
      group.operationIds.push(operation.id);
      groupedPnl.set(key, group);
    });
    const expected = sourceTotals[selectedPeriod];
    const isSyntheticSalesPeriod = selectedPeriod === "2026-08";
    const checks = [
      {
        id: "CHECK-RECEIPTS",
        title: isSyntheticSalesPeriod ? "Платёж CRM = операция финансов" : "Поступления реестра = строка ОДДС",
        actualMinor: cash.receiptsMinor,
        expectedMinor: expected.receiptsMinor,
        differenceMinor: cash.receiptsMinor - expected.receiptsMinor,
        status: cash.receiptsMinor === expected.receiptsMinor ? "OK" : "FAIL",
        source: isSyntheticSalesPeriod ? "CRM · тестовая цепочка LEAD-T-014" : `Атлас ОДДС · 2026 · строка 2`,
      },
      {
        id: "CHECK-OUTFLOWS",
        title: isSyntheticSalesPeriod ? "Списания тестовой цепочки = 0" : "Списания реестра = строка ОДДС",
        actualMinor: cash.outflowsMinor,
        expectedMinor: expected.outflowsMinor,
        differenceMinor: cash.outflowsMinor - expected.outflowsMinor,
        status: cash.outflowsMinor === expected.outflowsMinor ? "OK" : "FAIL",
        source: isSyntheticSalesPeriod ? "CRM · тестовый период без списаний" : `Атлас ОДДС · 2026 · строка 34`,
      },
      {
        id: "CHECK-NET",
        title: isSyntheticSalesPeriod ? "Тестовый платёж = чистый поток" : "Поступления − списания = чистый поток",
        actualMinor: cash.netMinor,
        expectedMinor: expected.netMinor,
        differenceMinor: cash.netMinor - expected.netMinor,
        status: cash.netMinor === expected.netMinor ? "OK" : "FAIL",
        source: isSyntheticSalesPeriod ? "FIN-TEST-CLIENT-014 · синтетический платёж" : `Атлас ОДДС · 2026 · строка 111`,
      },
    ];
    return Response.json({
      selectedPeriod,
      operations,
      accruals,
      budgets,
      payroll,
      corrections,
      issues,
      entityNames,
      monthly,
      pnlLines: [...groupedPnl.values()].sort((left, right) => right.amountMinor - left.amountMinor),
      forecast: { openingBalanceMinor, timeline: forecastTimeline, firstGap },
      summary: { ...cash, ...pnl, debtMinor, openIssues: issues.filter((issue) => issue.status !== "Закрыто").length },
      checks,
      sourcePolicy: {
        odds: "Факт XLSX · только чтение",
        payments: "Обезличенные агрегаты · только чтение",
        payroll: "Обезличенные агрегаты · только чтение",
        bank: "Не подключён · ссылки BANK-TEST являются тестовой проекцией",
        pnl: "Рабочая проекция из статей ОДДС; утверждённый источник ОПиУ не предоставлен",
        budget: mode === "source_only" ? "Демонстрационный бюджет удалён; подключите утверждённый источник" : "Синтетический тестовый сценарий, не утверждённый бюджет",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка финансового контура";
    return Response.json({ error: message.includes("D1 binding") ? "Финансовая база ещё не подключена" : "Не удалось загрузить финансовый контур" }, { status: 503 });
  }
}
