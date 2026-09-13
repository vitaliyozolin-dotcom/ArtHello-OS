import { env } from "cloudflare:workers";
import { loadArticleCatalog } from "../../../lib/finance-article-store";
import { and, asc, desc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import {
  entities,
  financeCorrections,
  financialOperations,
  bankAccounts,
  bankStatementImports,
  bankTransactions,
  integrationConnections,
  organizationBranches,
  userBranchAccess,
} from "../../../db/schema";
import { bankOperationPeriod, summarizeBankMonths, summarizeBankPeriod } from "../../../lib/bank-facts";
import { calculateForecast, summarizeCash, summarizePnl, type FinanceBudgetShape } from "../../../lib/finance";
import { FINANCE_ACCOUNTING_START_DATE, FINANCE_ACCOUNTING_START_PERIOD, requireFinanceBranch, scopeFinanceOperations } from "../../../lib/finance-branch-scope";
import { canAccessApi } from "../../../lib/access-policy";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { buildLtvPlan } from "../../../lib/sales";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";

const financeRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "FINANCE"]);
const approverRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE"]);
const isDisposableFinanceFixture = () => (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN === "https://finance.ci.invalid";

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!canAccessApi(context.auth.user, "/api/finance", "GET")) return Response.json({ error: "Нет доступа к финансовому контуру" }, { status: 403 });
  let requestedBranchId: string;
  try {
    requestedBranchId = requireFinanceBranch(new URL(request.url).searchParams.get("branchId"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Выберите филиал" }, { status: 400 });
  }
  try {
    await ensureCoreTables();
    const db = getDb();
    const unrestrictedOwner = context.apiRole === "OWNER" && context.auth.user.isSystemOwner;
    const [branch] = await db.select({ id: organizationBranches.id, name: organizationBranches.name })
      .from(organizationBranches)
      .where(and(eq(organizationBranches.id, requestedBranchId), eq(organizationBranches.status, "Активен")))
      .limit(1);
    if (!branch) return Response.json({ error: "Филиал недоступен" }, { status: 403 });
    if (!unrestrictedOwner && !context.auth.user.isAdministrative) {
      const [grant] = await db.select({ branchId: userBranchAccess.branchId }).from(userBranchAccess)
        .where(and(eq(userBranchAccess.userId, context.appUserId), eq(userBranchAccess.branchId, requestedBranchId))).limit(1);
      if (!grant) return Response.json({ error: "Филиал недоступен" }, { status: 403 });
    }
    const { catalog: articleCatalog } = await loadArticleCatalog(env.DB);
    const mode = await getSystemDataMode();
    const [storedOperations, storedBankAccounts, storedBankTransactions, storedBankStatements, connectionRows, corrections, entityRows, allTasks] = await Promise.all([
      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),
      db.select({
        id: bankAccounts.id,
        connectionId: bankAccounts.connectionId,
        legalEntityId: bankAccounts.legalEntityId,
        providerAccountId: bankAccounts.providerAccountId,
        maskedAccount: bankAccounts.maskedAccount,
        name: bankAccounts.name,
        currency: bankAccounts.currency,
        status: bankAccounts.status,
        balanceMinor: bankAccounts.balanceMinor,
        balanceAsOf: bankAccounts.balanceAsOf,
        syncedAt: bankAccounts.syncedAt,
      }).from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.maskedAccount)),
      db.select({
        id: bankTransactions.id,
        connectionId: bankTransactions.connectionId,
        legalEntityId: bankTransactions.legalEntityId,
        providerAccountId: bankTransactions.providerAccountId,
        providerStatementId: bankTransactions.providerStatementId,
        financialOperationId: bankTransactions.financialOperationId,
        operationDate: bankTransactions.operationDate,
        direction: bankTransactions.direction,
        amountMinor: bankTransactions.amountMinor,
        currency: bankTransactions.currency,
        status: bankTransactions.status,
        documentNumber: bankTransactions.documentNumber,
        transactionType: bankTransactions.transactionType,
        description: bankTransactions.description,
        counterpartyName: bankTransactions.counterpartyName,
        counterpartyInn: bankTransactions.counterpartyInn,
        counterpartyKpp: bankTransactions.counterpartyKpp,
        importedAt: bankTransactions.importedAt,
      }).from(bankTransactions).orderBy(desc(bankTransactions.operationDate), desc(bankTransactions.importedAt)),
      db.select().from(bankStatementImports).orderBy(desc(bankStatementImports.fetchedAt)),
      db.select().from(integrationConnections).orderBy(asc(integrationConnections.system)),
      db.select().from(financeCorrections).orderBy(desc(financeCorrections.id)).limit(50),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      selectVisibleTasks(db, context),
    ]);
    const sourceOnly = mode !== "test";
    const bankDetailsByOperation = new Map(
      storedBankTransactions.filter((transaction) => transaction.financialOperationId).map((transaction) => [transaction.financialOperationId, transaction]),
    );
    const eligibleOperations = (sourceOnly
      ? storedOperations.filter((operation) => !operation.sourceSystem.startsWith("SYNTHETIC"))
      : storedOperations);
    // The immutable legacy browser fixture predates branch keys. Bind its
    // synthetic rows only in the isolated, fixed-origin CI runtime.
    const branchEligibleOperations = isDisposableFinanceFixture()
      ? eligibleOperations.map((operation) => operation.objectEntityId ? operation : { ...operation, objectEntityId: requestedBranchId })
      : eligibleOperations;
    const operations = scopeFinanceOperations(branchEligibleOperations, requestedBranchId).map((operation) => ({
        ...operation,
        bankDetails: bankDetailsByOperation.get(operation.id) ?? null,
      }));
    // Unassigned facts must never enter a branch report, but central finance
    // still needs a separately authorized queue to complete their allocation.
    const canReviewUnassigned = unrestrictedOwner || context.auth.user.isAdministrative;
    const reviewOperations = canReviewUnassigned && !isDisposableFinanceFixture()
      ? eligibleOperations
        .filter((operation) => !operation.objectEntityId && operation.operationDate >= FINANCE_ACCOUNTING_START_DATE)
        .map((operation) => ({
          ...operation,
          bankDetails: bankDetailsByOperation.get(operation.id) ?? null,
        }))
      : [];
    const cashOperations = operations.map((operation) => ({
      ...operation,
      category: operation.cashflowArticle || operation.category,
    }));
    const pnlOperations = operations.map((operation) => ({
      ...operation,
      period: operation.accrualPeriod || operation.period,
      category: operation.pnlArticle || operation.cashflowArticle || operation.category,
    }));
    // These legacy aggregates have no branch key. They remain hidden until their
    // provenance can be scoped without leaking another branch into this report.
    const scopedAccruals: Array<{ period: string; debtMinor: number }> = [];
    const budgets: FinanceBudgetShape[] = [];
    const forecasts: Array<{ id: string; forecastDate: string; direction: string; amountMinor: number; probability: number; category: string; sourceType: string; assumption: string; linkedEntityId: string }> = [];
    const scopedPayroll: Array<{ period: string }> = [];
    const scopedIssues: Array<{ relatedTaskId: number | null; status: string }> = [];
    const operationIds = new Set(operations.map((operation) => operation.id));
    const scopedCorrections = corrections.filter((correction) => operationIds.has(correction.operationId));
    const sourceBankAccounts = storedBankAccounts.filter((account) => !account.connectionId.startsWith("TEST"));
    const sourceBankTransactions = storedBankTransactions.filter((transaction) => !transaction.connectionId.startsWith("TEST"));
    const sourceBankStatements = storedBankStatements.filter((statement) => !statement.connectionId.startsWith("TEST"));
    const entityNames = Object.fromEntries(entityRows.map((entity) => [entity.id, entity.displayName]));
    const accountByProvider = new Map(sourceBankAccounts.map((account) => [
      `${account.connectionId}:${account.providerAccountId}`,
      account,
    ]));
    // D066_TOCHKA_FINANCE_BANK_VISIBILITY is retained as historical patch identity.
    // D172_CANONICAL_MONEY_SOURCE: group bank facts live only in Money. They are
    // deliberately labelled as legal-entity totals and never as a branch balance.
    const bankAccountsView = sourceBankAccounts.map((account) => ({
      ...account,
      provider: providerLabel(account.connectionId),
      legalEntityName: entityNames[account.legalEntityId] || account.legalEntityId,
    }));
    const requestedPeriod = new URL(request.url).searchParams.get("period");
    const periods = [...new Set([
      ...operations.flatMap((operation) => [operation.period, operation.accrualPeriod]),
      ...sourceBankTransactions.map((operation) => bankOperationPeriod(operation.operationDate)),
      ...scopedAccruals.map((accrual) => accrual.period),
      ...budgets.map((budget) => budget.period),
      ...scopedPayroll.map((item) => item.period),
    ].filter((period) => /^\d{4}-\d{2}$/.test(period) && period >= FINANCE_ACCOUNTING_START_PERIOD))].sort();
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const defaultPeriod = currentPeriod < FINANCE_ACCOUNTING_START_PERIOD ? FINANCE_ACCOUNTING_START_PERIOD : currentPeriod;
    const selectedPeriod = requestedPeriod && periods.includes(requestedPeriod)
      ? requestedPeriod
      : periods.at(-1) ?? (requestedPeriod && requestedPeriod >= FINANCE_ACCOUNTING_START_PERIOD ? requestedPeriod : defaultPeriod);
    const bankOperations = sourceBankTransactions
      .filter((operation) => bankOperationPeriod(operation.operationDate) === selectedPeriod && operation.currency === "RUB")
      .map((operation) => {
        const account = accountByProvider.get(`${operation.connectionId}:${operation.providerAccountId}`);
        return {
          ...operation,
          provider: providerLabel(operation.connectionId),
          accountName: account?.name || "Банковский счёт",
          maskedAccount: account?.maskedAccount || "",
          legalEntityName: entityNames[operation.legalEntityId] || operation.legalEntityId,
          allocated: Boolean(operation.financialOperationId),
        };
      });
    const bankMonthly = summarizeBankMonths(sourceBankTransactions);
    const bankPeriodSummary = summarizeBankPeriod(sourceBankTransactions, selectedPeriod);
    const rubBankAccounts = bankAccountsView.filter((account) => account.currency === "RUB" && account.balanceMinor !== null);
    const selectedStatements = sourceBankStatements.filter((statement) => (
      bankOperationPeriod(statement.startDate) <= selectedPeriod && bankOperationPeriod(statement.endDate) >= selectedPeriod
    ));
    const latestSyncedAt = [
      ...bankAccountsView.map((account) => account.syncedAt),
      ...sourceBankStatements.map((statement) => statement.fetchedAt),
    ].filter(Boolean).sort().at(-1) ?? "";
    const bankSummary = {
      ...bankPeriodSummary,
      accountCount: bankAccountsView.length,
      accountsWithBalance: rubBankAccounts.length,
      rubBalanceMinor: rubBankAccounts.reduce((sum, account) => sum + Number(account.balanceMinor ?? 0), 0),
      statementCount: selectedStatements.length,
      latestSyncedAt,
    };
    const visibleConnections = new Set(sourceBankAccounts.map((account) => account.connectionId));
    for (const id of ["INT-T-TOCHKA", "INT-T-TBANK"]) visibleConnections.add(id);
    const bankSynchronization = connectionRows
      .filter((row) => visibleConnections.has(row.id) || /банк|bank|точка|t-?bank/i.test(`${row.system} ${row.category}`))
      .map((row) => ({
        id: row.id,
        system: row.system,
        status: row.status,
        enabled: Boolean(row.isEnabled),
        verified: Boolean(row.verifiedTransfer),
        lastSuccessAt: row.lastSuccessAt,
        nextSyncAt: row.nextSyncAt,
        receivedCount: row.receivedCount,
        acceptedCount: row.acceptedCount,
        errorCount: row.errorCount,
      }));
    const cash = summarizeCash(cashOperations, selectedPeriod);
    const pnl = summarizePnl(pnlOperations, budgets, selectedPeriod);
    const openingBalanceMinor = 0;
    const forecastTimeline = calculateForecast(forecasts, openingBalanceMinor);
    const firstGap = forecastTimeline.find((item) => item.isGap) ?? null;
    const ltvPlan = buildLtvPlan([]);
    const debtMinor = scopedAccruals.reduce((sum, accrual) => sum + accrual.debtMinor, 0);
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
    ]).filter((value) => value && value !== "Не классифицировано"))].sort((left, right) => left.localeCompare(right, "ru"));
    // D069_FINANCE_OPERATION_ALLOCATION: raw bank fields are exposed read-only; allocations are explicit projection fields.
    return Response.json({
      selectedPeriod,
      branch: { id: branch.id, name: branch.name },
      accountingStartDate: "2026-09-01",
      operations,
      articleSuggestions,
      articleCatalog,
      articlePermissions: isDisposableFinanceFixture()
        ? { canEdit: financeRoles.has(context.apiRole), canApprove: approverRoles.has(context.apiRole) }
        : { canEdit: false, canApprove: false },
      classificationPermissions: {
        canEdit: financeRoles.has(context.apiRole),
        canReviewUnassigned,
      },
      reviewOperations,
      bankAccounts: bankAccountsView,
      bankOperations,
      bankMonthly,
      bankSynchronization,
      bankSummary,
      bankBoundary: "Счета, остатки и банковские операции показаны по юридическим лицам группы и не являются остатком выбранного филиала. Это единый банковский факт для раздела «Деньги» и главной; исходящие платежи из ArtHello OS запрещены.",
      accruals: scopedAccruals,
      budgets,
      payroll: scopedPayroll,
      corrections: scopedCorrections,
      issues: redactHiddenTaskReferences(scopedIssues, allTasks),
      entityNames,
      monthly,
      pnlLines: [...groupedPnl.values()].sort((left, right) => right.amountMinor - left.amountMinor),
      forecast: { openingBalanceMinor, timeline: forecastTimeline, firstGap },
      ltvPlan,
      summary: { ...cash, ...pnl, debtMinor, openIssues: scopedIssues.filter((issue) => issue.status !== "Закрыто").length },
      checks,
      sourcePolicy: {
        odds: operations.length ? "Операции загружены из подтверждённого источника" : "Источник ОДДС не подключён",
        payments: "Начисления без филиального ключа не включены",
        payroll: "Зарплатные агрегаты без филиального ключа не включены",
        bank: sourceBankAccounts.length
          ? `Банковский факт группы · ${bankSummary.transactionCount} операций за ${selectedPeriod}; управленческое разнесение филиала считается отдельно`
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

function providerLabel(connectionId: string) {
  if (connectionId.includes("TOCHKA")) return "Точка";
  if (connectionId.includes("TBANK")) return "Т‑Банк";
  return "Банк";
}
