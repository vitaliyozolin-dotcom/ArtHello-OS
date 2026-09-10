import { env } from "cloudflare:workers";
import { loadArticleCatalog } from "../../../lib/finance-article-store";
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
  bankAccounts,
  bankTransactions,
} from "../../../db/schema";
import { calculateForecast, summarizeCash, summarizePnl } from "../../../lib/finance";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { buildLtvPlan } from "../../../lib/sales";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const { catalog: articleCatalog } = await loadArticleCatalog(env.DB);
    const mode = await getSystemDataMode();
    const [storedOperations, storedBankAccounts, storedBankTransactions, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([
      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),
      db.select({
        id: bankAccounts.id,
        connectionId: bankAccounts.connectionId,
        legalEntityId: bankAccounts.legalEntityId,
        maskedAccount: bankAccounts.maskedAccount,
        name: bankAccounts.name,
        currency: bankAccounts.currency,
        status: bankAccounts.status,
        balanceMinor: bankAccounts.balanceMinor,
        balanceAsOf: bankAccounts.balanceAsOf,
        syncedAt: bankAccounts.syncedAt,
      }).from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.maskedAccount)),
      db.select({
        financialOperationId: bankTransactions.financialOperationId,
        operationDate: bankTransactions.operationDate,
        direction: bankTransactions.direction,
        amountMinor: bankTransactions.amountMinor,
        currency: bankTransactions.currency,
        documentNumber: bankTransactions.documentNumber,
        transactionType: bankTransactions.transactionType,
        description: bankTransactions.description,
        counterpartyName: bankTransactions.counterpartyName,
        counterpartyInn: bankTransactions.counterpartyInn,
        counterpartyKpp: bankTransactions.counterpartyKpp,
        importedAt: bankTransactions.importedAt,
      }).from(bankTransactions),
      db.select().from(financeAccruals).orderBy(desc(financeAccruals.period), asc(financeAccruals.contour)),
      db.select().from(financeBudgets).orderBy(asc(financeBudgets.period), asc(financeBudgets.line)),
      db.select().from(financeForecastItems).orderBy(asc(financeForecastItems.forecastDate)),
      db.select().from(financePayrollSummary).orderBy(asc(financePayrollSummary.period)),
      db.select().from(financeCorrections).orderBy(desc(financeCorrections.id)).limit(50),
      db.select().from(financeReconciliationIssues).orderBy(asc(financeReconciliationIssues.id)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      db.select().from(clientLifecycles),
      selectVisibleTasks(db, context),
    ]);
    const sourceOnly = mode !== "test";
    const bankDetailsByOperation = new Map(
      storedBankTransactions.filter((transaction) => transaction.financialOperationId).map((transaction) => [transaction.financialOperationId, transaction]),
    );
    const operations = (sourceOnly
      ? storedOperations.filter((operation) => !operation.sourceSystem.startsWith("SYNTHETIC"))
      : storedOperations).map((operation) => ({
        ...operation,
        bankDetails: bankDetailsByOperation.get(operation.id) ?? null,
      }));
    const cashOperations = operations.map((operation) => ({
      ...operation,
      category: operation.cashflowArticle || operation.category,
    }));
    const pnlOperations = operations.map((operation) => ({
      ...operation,
      period: operation.accrualPeriod || operation.period,
      category: operation.pnlArticle || operation.cashflowArticle || operation.category,
    }));
    const budgets = sourceOnly ? [] : storedBudgets;
    const forecasts = sourceOnly ? [] : storedForecasts;
    const bankOperationCount = operations.filter((operation) => operation.sourceSystem === "BANK_TOCHKA_API").length;
    const bankAccountsView = storedBankAccounts.filter((account) => !account.connectionId.startsWith("TEST"));
    const rubBankAccounts = bankAccountsView.filter((account) => account.currency === "RUB" && account.balanceMinor !== null);
    const rubBalanceMinor = rubBankAccounts.reduce((sum, account) => sum + Number(account.balanceMinor ?? 0), 0);
    const bankSummary = {
      accountCount: bankAccountsView.length,
      accountsWithBalance: bankAccountsView.filter((account) => account.balanceMinor !== null).length,
      rubBalanceMinor,
      latestSyncedAt: bankAccountsView.map((account) => account.syncedAt).filter(Boolean).sort().at(-1) ?? "",
    };
    // D066_TOCHKA_FINANCE_BANK_VISIBILITY: stored bank accounts are finance facts even with zero operations.
    const entityNames = Object.fromEntries(entityRows.map((entity) => [entity.id, entity.displayName]));
    const requestedPeriod = new URL(request.url).searchParams.get("period");
    const periods = [...new Set([
      ...operations.flatMap((operation) => [operation.period, operation.accrualPeriod]),
      ...accruals.map((accrual) => accrual.period),
      ...budgets.map((budget) => budget.period),
      ...payroll.map((item) => item.period),
    ].filter((period) => /^\d{4}-\d{2}$/.test(period)))].sort();
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const selectedPeriod = requestedPeriod && periods.includes(requestedPeriod)
      ? requestedPeriod
      : periods.at(-1) ?? requestedPeriod ?? currentPeriod;
    const cash = summarizeCash(cashOperations, selectedPeriod);
    const pnl = summarizePnl(pnlOperations, budgets, selectedPeriod);
    const openingBalanceMinor = 0;
    const forecastTimeline = calculateForecast(forecasts, openingBalanceMinor);
    const firstGap = forecastTimeline.find((item) => item.isGap) ?? null;
    const ltvPlan = buildLtvPlan(lifecycles);
    const debtMinor = accruals.reduce((sum, accrual) => sum + accrual.debtMinor, 0);
    const monthly = periods.map((period) => {
      const periodCash = summarizeCash(cashOperations, period);
      const periodPnl = summarizePnl(pnlOperations, budgets, period);
      return { period, ...periodCash, ...periodPnl };
    });
    const groupedPnl = new Map<string, { category: string; reportClass: string; amountMinor: number; operationIds: string[] }>();
    pnlOperations.filter((operation) => operation.period === selectedPeriod).forEach((operation) => {
      const key = `${operation.reportClass}:${operation.category}`;
      const group = groupedPnl.get(key) ?? { category: operation.category, reportClass: operation.reportClass, amountMinor: 0, operationIds: [] };
      group.amountMinor += operation.amountMinor;
      group.operationIds.push(operation.id);
      groupedPnl.set(key, group);
    });
    const checks: Array<{ id: string; title: string; actualMinor: number; expectedMinor: number; differenceMinor: number; status: string; source: string }> = [];
    const articleSuggestions = [...new Set(operations.flatMap((operation) => [
      operation.cashflowArticle,
      operation.pnlArticle,
      operation.category,
    ]).filter((value) => value && value !== "Не классифицировано"))].sort((left, right) => left.localeCompare(right, "ru"));
    // D069_FINANCE_OPERATION_ALLOCATION: raw bank fields are exposed read-only; allocations are explicit projection fields.
    return Response.json({
      selectedPeriod,
      operations,
      articleSuggestions,
      articleCatalog,
      articlePermissions: { canEdit: ["OWNER", "DIRECTOR", "REPRESENTATIVE", "FINANCE"].includes(context.apiRole), canApprove: ["OWNER", "DIRECTOR", "REPRESENTATIVE"].includes(context.apiRole) },
      bankAccounts: bankAccountsView,
      bankSummary,
      accruals,
      budgets,
      payroll,
      corrections,
      issues: redactHiddenTaskReferences(issues, allTasks),
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
        bank: bankSummary.accountCount
          ? bankOperationCount
            ? `Точка подключена · ${bankSummary.accountCount} счетов · ${bankOperationCount} проведённых операций в реестре`
            : `Точка подключена · ${bankSummary.accountCount} счетов · остатки загружены, операций за выбранный период пока нет`
          : "Банковский источник не подключён",
        pnl: operations.length ? "Рабочая проекция из классифицированных операций" : "Нет данных для расчёта ОПиУ",
        budget: budgets.length ? "Бюджетный сценарий загружен" : "Утверждённый бюджет не подключён",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка финансового контура";
    return Response.json({ error: message.includes("D1 binding") ? "Финансовая база ещё не подключена" : "Не удалось загрузить финансовый контур" }, { status: 503 });
  }
}
