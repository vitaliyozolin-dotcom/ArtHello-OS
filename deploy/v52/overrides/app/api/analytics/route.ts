import { requiresAssignedReadScope } from "../../../lib/section-read-scope";
import { canAccessApi } from "../../../lib/access-policy";
import { asc, desc } from "drizzle-orm";
import { ensureAnalyticsDemoBootstrap, ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import {
  aiModelRuns,
  aiOptOuts,
  aiProcessContracts,
  analyticsMetricDefinitions,
  analyticsSignals,
  clientLifecycles,
  educationProgress,
  financeForecastItems,
  financeReconciliationIssues,
  financialOperations,
  foodProduction,
  foodShipments,
  foodShifts,
  hrEmployees,
  integrationConflicts,
  integrationConnections,
  safetyFaults,
  strategyProjects,
} from "../../../db/schema";
import { forecastCash, marginPercent, riskRank, safeAverage } from "../../../lib/analytics";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";


export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!canAccessApi(context.auth.user, "/api/analytics", "GET")) return Response.json({ error: "Нет доступа к управленческой аналитике" }, { status: 403 });

  try {
    await ensureCoreTables();
    const scopedRead=requiresAssignedReadScope(context.auth.user,"/api/analytics");
    const dataMode = await getSystemDataMode();
    const isEmptyMode = scopedRead || dataMode === "empty";
    if (!scopedRead && await getSystemDataMode()!=="empty") await ensureAnalyticsDemoBootstrap();

    const db = getDb();
    let [metricDefinitions, signals, contracts, runs, optOuts, operations, forecastItems, reconciliation, lifecycles, progress, employees, faults, shipments, production, shifts, projects, connections, conflicts, allTasks] = await Promise.all([
      db.select().from(analyticsMetricDefinitions).orderBy(asc(analyticsMetricDefinitions.category)),
      db.select().from(analyticsSignals),
      db.select().from(aiProcessContracts).orderBy(asc(aiProcessContracts.name)),
      db.select().from(aiModelRuns).orderBy(desc(aiModelRuns.ranAt)),
      db.select().from(aiOptOuts).orderBy(desc(aiOptOuts.createdAt)),
      db.select().from(financialOperations),
      db.select().from(financeForecastItems).orderBy(asc(financeForecastItems.forecastDate)),
      db.select().from(financeReconciliationIssues),
      db.select().from(clientLifecycles),
      db.select().from(educationProgress),
      db.select().from(hrEmployees),
      db.select().from(safetyFaults),
      db.select().from(foodShipments),
      db.select().from(foodProduction),
      db.select().from(foodShifts),
      db.select().from(strategyProjects),
      db.select().from(integrationConnections),
      db.select().from(integrationConflicts),
      selectVisibleTasks(db, context),
    ]);

    if(scopedRead){metricDefinitions=[];signals=[];contracts=[];runs=[];optOuts=[];operations=[];forecastItems=[];reconciliation=[];lifecycles=[];progress=[];employees=[];faults=[];shipments=[];production=[];shifts=[];projects=[];connections=[];conflicts=[];allTasks=[];}
    const monthlyMap = new Map<string, { period: string; receiptsMinor: number; outflowsMinor: number; netMinor: number; factRows: number; syntheticRows: number }>();
    for (const item of operations) {
      const row = monthlyMap.get(item.period) ?? { period: item.period, receiptsMinor: 0, outflowsMinor: 0, netMinor: 0, factRows: 0, syntheticRows: 0 };
      if (item.direction === "Поступление") row.receiptsMinor += item.amountMinor;
      else row.outflowsMinor += item.amountMinor;
      row.netMinor = row.receiptsMinor - row.outflowsMinor;
      if (item.operationKind === "XLSX_AGGREGATE") row.factRows += 1;
      else row.syntheticRows += 1;
      monthlyMap.set(item.period, row);
    }

    const cash = [...monthlyMap.values()].sort((a, b) => a.period.localeCompare(b.period));
    const currentNetMinor = cash.reduce((sum, item) => sum + item.netMinor, 0);
    const openingBalanceMinor = isEmptyMode ? currentNetMinor : 120000000;
    const forecast = forecastCash(forecastItems, openingBalanceMinor);
    const floor = forecast.length ? Math.min(openingBalanceMinor, ...forecast.map((item) => item.balanceMinor)) : openingBalanceMinor;
    const revenue = shipments.reduce((sum, item) => sum + item.revenueMinor, 0);
    const cost = production.reduce((sum, item) => sum + item.materialCostMinor, 0) + shifts.reduce((sum, item) => sum + item.rateMinor, 0);
    const rankedSignals = redactHiddenTaskReferences(signals, allTasks)
      .sort((a, b) => riskRank(b.severity, b.confidence) - riskRank(a.severity, a.confidence));
    const domains = [...new Set(signals.map((item) => item.domain))].map((domain) => ({
      domain,
      total: signals.filter((item) => item.domain === domain && item.status !== "Закрыт").length,
      high: signals.filter((item) => item.domain === domain && item.severity === "Высокий" && item.status !== "Закрыт").length,
    })).sort((a, b) => b.high - a.high || b.total - a.total);
    const currentCashPeriod = cash.at(-1)?.period ?? "";

    return Response.json({
      scopeBoundary:scopedRead?"Раздел открыт для чтения. Записи без подтверждённой области филиала и юридического лица скрыты; общие показатели по ним не раскрываются.":"",
      dataMode,
      metricDefinitions,
      signals: rankedSignals,
      contracts: contracts.map((item) => ({ ...item, activeOptOuts: optOuts.filter((row) => row.contractId === item.id && row.status === "Активен").length })),
      runs: runs.slice(0, 40),
      optOuts,
      owner: {
        cashPeriod: currentCashPeriod,
        cashFlowMinor: currentCashPeriod ? monthlyMap.get(currentCashPeriod)?.netMinor ?? 0 : 0,
        cashAprilMinor: isEmptyMode ? 0 : monthlyMap.get("2026-04")?.netMinor ?? 0,
        cashForecastFloorMinor: floor,
        nextPaymentsMinor: lifecycles.reduce((sum, item) => sum + item.nextPaymentMinor, 0),
        highRiskFamilies: lifecycles.filter((item) => item.churnRiskBand === "Высокий").length,
        averageProgress: safeAverage(progress.map((item) => item.score)),
        activeEmployees: employees.filter((item) => item.status === "Работает").length,
        openSafetyFaults: faults.filter((item) => item.status !== "Закрыт").length,
        foodMarginPercent: marginPercent(revenue, cost),
        projectsAtRisk: projects.filter((item) => item.status === "Под риском").length,
        openDataIssues: reconciliation.filter((item) => item.status !== "Закрыто").length + conflicts.filter((item) => item.status !== "Закрыт").length,
        verifiedLiveSources: connections.filter((item) => item.verifiedTransfer && item.isEnabled && item.lastSuccessAt).length,
      },
      charts: { cash, forecast, risks: domains },
      sourceCoverage: isEmptyMode ? { fact: [], synthetic: [], unavailable: [] } : {
        fact: ["Атлас ОДДС.xlsx · агрегаты 2026-01…04", "Контроль качества исходного ОДДС"],
        synthetic: ["Продажи и семьи", "Обучение", "HR", "Питание", "Безопасность", "Проекты"],
        unavailable: ["Банки", "CRM", "электронный дневник", "рекламные платформы", "ЭДО/1С", "СКУД/камеры"],
      },
      boundary: scopedRead ? "Раздел открыт. Общие финансовые и кадровые показатели скрыты: область доступа по филиалам и юридическим лицам ещё не подтверждена." : isEmptyMode
        ? "Аналитика строится только по сохранённым рабочим записям. Источники и показатели ещё не подключены."
        : "Панель является опубликованным тестовым снимком на 21 августа 2026. Только ОДДС и контроль исходных XLSX основаны на предоставленных файлах; остальные прогнозы и сигналы синтетические. Медицинские данные полностью исключены.",
      modelBoundary: isEmptyMode
        ? "Модельные расчёты появятся только после подключения источника и отдельного подтверждения человеком."
        : "Внешняя модель ИИ не вызывается: правила с ручным подтверждением проверяют объяснимость и решение человека без автоматических действий с высоким влиянием.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "Аналитическая база ещё не подключена" : "Не удалось загрузить аналитику" }, { status: 503 });
  }
}
