import { asc, desc } from "drizzle-orm";
import { ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import {
  clientLifecycles,
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
import { buildLtvPlan } from "../../../lib/sales";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const mode = await getSystemDataMode();
    const [storedOperations, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles] = await Promise.all([
      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),
      db.select().from(financeAccruals).orderBy(desc(financeAccruals.period), asc(financeAccruals.contour)),
      db.select().from(financeBudgets).orderBy(asc(financeBudgets.period), asc(financeBudgets.line)),
      db.select().from(financeForecastItems).orderBy(asc(financeForecastItems.forecastDate)),
      db.select().from(financePayrollSummary).orderBy(asc(financePayrollSummary.period)),
      db.select().from(financeCorrections).orderBy(desc(financeCorrections.id)).limit(50),
      db.select().from(financeReconciliationIssues).orderBy(asc(financeReconciliationIssues.id)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      db.select().from(clientLifecycles),
    ]);
    const sourceOnly = mode !== "test";
    const operations = sourceOnly
      ? storedOperations.filter((operation) => !operation.sourceSystem.startsWith("SYNTHETIC"))
      : storedOperations;
    const budgets = sourceOnly ? [] : storedBudgets;
    const forecasts = sourceOnly ? [] : storedForecasts;
    const entityNames = Object.fromEntries(entityRows.map((entity) => [entity.id, entity.displayName]));
    const requestedPeriod = new URL(request.url).searchParams.get("period");
    const periods = [...new Set([
      ...operations.map((operation) => operation.period),
      ...accruals.map((accrual) => accrual.period),
      ...budgets.map((budget) => budget.period),
      ...payroll.map((item) => item.period),
    ].filter((period) => /^\d{4}-\d{2}$/.test(period)))].sort();
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const selectedPeriod = requestedPeriod && periods.includes(requestedPeriod)
      ? requestedPeriod
      : periods.at(-1) ?? requestedPeriod ?? currentPeriod;
    const cash = summarizeCash(operations, selectedPeriod);
    const pnl = summarizePnl(operations, budgets, selectedPeriod);
    const openingBalanceMinor = 0;
    const forecastTimeline = calculateForecast(forecasts, openingBalanceMinor);
    const firstGap = forecastTimeline.find((item) => item.isGap) ?? null;
    const ltvPlan = buildLtvPlan(lifecycles);
    const debtMinor = accruals.reduce((sum, accrual) => sum + accrual.debtMinor, 0);
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
    const checks: Array<{ id: string; title: string; actualMinor: number; expectedMinor: number; differenceMinor: number; status: string; source: string }> = [];
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
      ltvPlan,
      summary: { ...cash, ...pnl, debtMinor, openIssues: issues.filter((issue) => issue.status !== "Закрыто").length },
      checks,
      sourcePolicy: {
        odds: operations.length ? "Операции загружены из подтверждённого источника" : "Источник ОДДС не подключён",
        payments: accruals.length ? "Начисления загружены" : "Источник начислений не подключён",
        payroll: payroll.length ? "Свод начислений загружен" : "Источник зарплат не подключён",
        bank: "Банковский источник не подключён",
        pnl: operations.length ? "Рабочая проекция из классифицированных операций" : "Нет данных для расчёта ОПиУ",
        budget: budgets.length ? "Бюджетный сценарий загружен" : "Утверждённый бюджет не подключён",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка финансового контура";
    return Response.json({ error: message.includes("D1 binding") ? "Финансовая база ещё не подключена" : "Не удалось загрузить финансовый контур" }, { status: 503 });
  }
}
