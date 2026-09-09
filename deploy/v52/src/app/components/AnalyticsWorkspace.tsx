"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  humanFormulaLabel,
  humanPeriodLabel,
  humanReferenceLabel,
  humanSourceList,
  humanTechnicalText,
  humanVersionLabel,
  recordLabel,
} from "../../lib/record-labels";
import {
  Button,
  Card,
  CompactListCard,
  EmptyState,
  KpiCard,
  PageContainer,
  PageHeader,
  Tabs,
} from "./design-system";
import "./AnalyticsWorkspace.ds.css";

type Signal = {
  id: string;
  contractId: string;
  domain: string;
  signalType: string;
  severity: string;
  title: string;
  evidence: string;
  explanation: string;
  recommendation: string;
  sourceRefs: string;
  confidence: number;
  status: string;
  relatedTaskId: number | null;
  humanDecision: string;
  decisionEvidence: string;
  detectedAt: string;
};

type Contract = {
  id: string;
  name: string;
  inputData: string;
  expectedResult: string;
  allowedActions: string;
  forbiddenActions: string;
  humanOwner: string;
  costMinor: number;
  benefitMetric: string;
  autoStopCondition: string;
  optOutAllowed: boolean;
  optOutProcedure: string;
  fallbackFunctionality: string;
  stoppedDataProcessing: string;
  historicalDataPolicy: string;
  optOutImpact: string;
  status: string;
  version: string;
  sourceRefs: string;
  activeOptOuts: number;
};

type Run = {
  id: string;
  contractId: string;
  ranAt: string;
  modelVersion: string;
  status: string;
  inputSnapshotRef: string;
  outputType: string;
  outputSummary: string;
  confidence: number;
  costMinor: number;
  explanation: string;
  humanDecision: string;
  isSynthetic: boolean;
};

type Metric = {
  id: string;
  name: string;
  category: string;
  definition: string;
  formula: string;
  unit: string;
  grain: string;
  sourceTables: string;
  sourceQuality: string;
  freshness: string;
  ownerEntityId: string;
  targetValue: number | null;
  sensitive: boolean;
};

type Data = {
  dataMode: "test" | "source_only" | "empty";
  metricDefinitions: Metric[];
  signals: Signal[];
  contracts: Contract[];
  runs: Run[];
  optOuts: Array<{
    id: string;
    contractId: string;
    scopeType: string;
    scopeRef: string;
    requestedBy: string;
    reason: string;
    status: string;
    stopsProcessingAt: string;
    historicalDataPolicy: string;
  }>;
  owner: {
    cashPeriod: string;
    cashFlowMinor: number;
    cashAprilMinor: number;
    cashForecastFloorMinor: number;
    nextPaymentsMinor: number;
    highRiskFamilies: number;
    averageProgress: number;
    activeEmployees: number;
    openSafetyFaults: number;
    foodMarginPercent: number;
    projectsAtRisk: number;
    openDataIssues: number;
    verifiedLiveSources: number;
  };
  charts: {
    cash: Array<{
      period: string;
      receiptsMinor: number;
      outflowsMinor: number;
      netMinor: number;
      factRows: number;
      syntheticRows: number;
    }>;
    forecast: Array<{
      forecastDate: string;
      direction: string;
      amountMinor: number;
      probability: number;
      weightedMinor: number;
      balanceMinor: number;
      isGap: boolean;
    }>;
    risks: Array<{ domain: string; total: number; high: number }>;
  };
  sourceCoverage: { fact: string[]; synthetic: string[]; unavailable: string[] };
  boundary: string;
  modelBoundary: string;
};

const roles: Record<string, string> = {
  Аналитика: "ANALYTICS",
  Интеграции: "INTEGRATIONS",
  Проекты: "PROJECTS",
  Бухгалтерия: "ACCOUNTING",
  Медработник: "MEDICAL",
  Собственник: "OWNER",
  Директор: "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
  Безопасность: "SAFETY",
  Финансы: "FINANCE",
  Кухня: "KITCHEN",
  Закупки: "PROCUREMENT",
  Юрист: "LEGAL",
  HR: "HR",
  Продажи: "SALES",
  Маркетинг: "MARKETING",
  Педагог: "TEACHER",
  Методист: "METHODIST",
  Родитель: "PARENT",
};

const tabs = ["Обзор", "Деньги", "Сигналы", "Сценарии ИИ", "Решения и отказ", "Метрики"] as const;
type Tab = (typeof tabs)[number];

const rub = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value / 100);

const short = (value: number) =>
  new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value / 100);

export function AnalyticsWorkspace({
  role,
  notify,
  onTasksChanged,
  onOpenIntegrations,
}: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
  onOpenIntegrations: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Обзор");
  const [selectedSignal, setSelectedSignal] = useState("");
  const [selectedContract, setSelectedContract] = useState("");
  const [domain, setDomain] = useState("Все");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/analytics", {
        cache: "no-store",
        headers: { "x-arthello-role": roles[role] ?? "" },
      });
      const payload = (await response.json()) as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Нет доступа");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/analytics-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Запись уже существует" : "Действие сохранено; бизнес-данные не изменены");
      await load();
      onTasksChanged();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Ошибка");
    } finally {
      setBusy("");
    }
  }

  const domains = useMemo(
    () => ["Все", ...new Set((data?.signals ?? []).map((item) => item.domain))],
    [data],
  );

  if (loading) return <section className="ahAnalyticsStatus">Собираем доказательную аналитику…</section>;
  if (error || !data) {
    return (
      <PageContainer className="ahAnalyticsDenied">
        <Card>
          <EmptyState
            title="Контур аналитики недоступен"
            description={error || "Доступ разрешён владельцу, Представителю, аналитикам и финансам."}
            density="compact"
            action={<Button onClick={() => void load()}>Повторить</Button>}
          />
        </Card>
      </PageContainer>
    );
  }

  const signal = data.signals.find((item) => item.id === selectedSignal) ?? data.signals[0];
  const contract = data.contracts.find((item) => item.id === selectedContract) ?? data.contracts[0];
  const visibleSignals = data.signals.filter((item) => domain === "Все" || item.domain === domain);
  const maxCash = Math.max(1, ...data.charts.cash.flatMap((item) => [item.receiptsMinor, item.outflowsMinor]));
  const hasAnalyticsData = Boolean(
    data.metricDefinitions.length ||
      data.signals.length ||
      data.contracts.length ||
      data.runs.length ||
      data.optOuts.length ||
      data.charts.cash.length ||
      data.charts.forecast.length,
  );

  return (
    <PageContainer className="ahAnalyticsPage">
      <PageHeader
        eyebrow="АНАЛИТИКА · ИСТОЧНИКИ · РЕШЕНИЯ"
        title="Аналитика и ИИ"
        description="Каждый показатель раскрывается до формулы и источника, а модельный сигнал — до факторов, контракта и решения человека."
        actions={
          contract ? (
            <Button
              variant="primary"
              disabled={busy === contract.id || contract.status !== "Активен"}
              onClick={() => void action({ action: "runScenario", contractId: contract.id }, contract.id)}
            >
              Контрольный запуск
            </Button>
          ) : (
            <Button variant="primary" onClick={onOpenIntegrations}>Подключить источники</Button>
          )
        }
      />

      <div className="ahAnalyticsBoundary">
        <strong>{hasAnalyticsData ? "СОХРАНЁННЫЕ ДАННЫЕ" : "НЕТ ИСХОДНЫХ ДАННЫХ"}</strong>
        <span>{humanTechnicalText(data.boundary)}</span>
      </div>

      <div className="ahAnalyticsKpis">
        <KpiCard
          label={data.owner.cashPeriod ? `Чистый поток · ${humanPeriodLabel(data.owner.cashPeriod)}` : "Чистый поток"}
          value={rub(data.owner.cashFlowMinor)}
          note={data.charts.cash.length ? "по сохранённым операциям" : "операций пока нет"}
        />
        <KpiCard
          label="Семьи высокого риска"
          value={data.owner.highRiskFamilies}
          note={data.owner.highRiskFamilies ? "требуют проверки человеком" : "сигналов пока нет"}
          className={data.owner.highRiskFamilies ? "ahAnalyticsKpiWarning" : undefined}
        />
        <KpiCard
          label="Качество данных"
          value={data.owner.openDataIssues}
          note={data.owner.openDataIssues ? "открытые сверки и конфликты" : "открытых сверок нет"}
          className={data.owner.openDataIssues ? "ahAnalyticsKpiWarning" : undefined}
        />
        <KpiCard
          label="Подключённые источники"
          value={data.owner.verifiedLiveSources}
          note={data.owner.verifiedLiveSources ? "подтверждённая передача" : "источники не подключены"}
        />
      </div>

      <div className="ahAnalyticsTabs">
        <Tabs
          items={tabs.map((item) => ({ id: item, label: item }))}
          value={tab}
          onChange={setTab}
          ariaLabel="Разделы аналитики"
        />
      </div>

      {tab === "Обзор" ? (
        <OverviewPanel
          data={data}
          hasAnalyticsData={hasAnalyticsData}
          onOpenSignals={(nextDomain) => {
            setDomain(nextDomain);
            setTab("Сигналы");
          }}
        />
      ) : null}

      {tab === "Деньги" ? <MoneyPanel data={data} maxCash={maxCash} /> : null}

      {tab === "Сигналы" ? (
        <Card className="ahAnalyticsPanel">
          <PanelHead eyebrow="Ранние сигналы" title="Где нужен человек" meta={`${visibleSignals.length} открыто`} />
          <div className="ahAnalyticsFilter">
            <label>
              <span>Контур</span>
              <select value={domain} onChange={(event) => setDomain(event.target.value)}>
                {domains.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <span>Решение всегда остаётся за человеком</span>
          </div>
          {visibleSignals.length ? (
            <div className="ahAnalyticsSignalLayout">
              <div className="ahAnalyticsSignalList">
                {visibleSignals.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={signal?.id === item.id}
                    onClick={() => setSelectedSignal(item.id)}
                  >
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>
                      <small>{humanTechnicalText(item.domain)} · {item.signalType}</small>
                      <strong>{humanTechnicalText(item.title)}</strong>
                      <em>{item.status}</em>
                    </span>
                    <i>{item.confidence}%</i>
                  </button>
                ))}
              </div>
              {signal ? (
                <aside className="ahAnalyticsSignalDetail">
                  <header>
                    <div><p>{recordLabel("Сигнал", signal.id)} · {signal.severity}</p><h2>{humanTechnicalText(signal.title)}</h2></div>
                    <strong>{signal.confidence}%</strong>
                  </header>
                  <Fact label="Доказательство" value={humanTechnicalText(signal.evidence)} />
                  <Fact label="Объяснение" value={humanTechnicalText(signal.explanation)} />
                  <Fact label="Рекомендация" value={humanTechnicalText(signal.recommendation)} />
                  <dl>
                    <div><dt>Связанные записи</dt><dd>{signal.sourceRefs.split(",").map((item) => humanReferenceLabel(item)).join(" · ")}</dd></div>
                    <div><dt>Сценарий ИИ</dt><dd>{recordLabel("Сценарий", signal.contractId)}</dd></div>
                    <div><dt>Решение человека</dt><dd>{signal.humanDecision ? humanTechnicalText(signal.humanDecision) : "Ожидается"}</dd></div>
                  </dl>
                  <footer>
                    <Button
                      disabled={busy === `task-${signal.id}`}
                      onClick={() => void action({ action: "createSignalTask", signalId: signal.id }, `task-${signal.id}`)}
                    >
                      Создать задачу
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy === `decision-${signal.id}`}
                      onClick={() => void action({
                        action: "recordDecision",
                        signalId: signal.id,
                        decision: "Проверить владельцем процесса и выполнить контролируемое действие",
                        evidence: `Решение человека по ${recordLabel("сигналу", signal.id).toLocaleLowerCase("ru")}`,
                      }, `decision-${signal.id}`)}
                    >
                      Зафиксировать решение
                    </Button>
                  </footer>
                </aside>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="Сигналов пока нет"
              description="Риск или рекомендация появятся только с доказательством, источником и ответственным человеком."
              density="compact"
            />
          )}
        </Card>
      ) : null}

      {tab === "Сценарии ИИ" ? (
        <Card className="ahAnalyticsPanel">
          <PanelHead eyebrow="Управляемый ИИ" title="Сценарии и правила" meta={String(data.contracts.length)} />
          {data.contracts.length ? (
            <div className="ahAnalyticsContractLayout">
              <div className="ahAnalyticsContractList">
                {data.contracts.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={contract?.id === item.id}
                    onClick={() => setSelectedContract(item.id)}
                  >
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span><strong>{humanTechnicalText(item.name)}</strong><small>{recordLabel("Сценарий", item.id)} · {humanVersionLabel(item.version)}</small></span>
                    <em>{item.status}</em>
                  </button>
                ))}
              </div>
              {contract ? (
                <aside className="ahAnalyticsContractDetail">
                  <header>
                    <div><p>{recordLabel("Сценарий", contract.id)}</p><h2>{humanTechnicalText(contract.name)}</h2></div>
                    <span>{contract.status}</span>
                  </header>
                  <div className="ahAnalyticsFactGrid">
                    <Fact label="Входные данные" value={contract.inputData} />
                    <Fact label="Ожидаемый результат" value={contract.expectedResult} />
                    <Fact label="Разрешено" value={contract.allowedActions} />
                    <Fact label="Запрещено" value={contract.forbiddenActions} />
                    <Fact label="Ответственный человек" value={contract.humanOwner} />
                    <Fact label="Стоимость запуска" value={rub(contract.costMinor)} />
                    <Fact label="Метрика пользы" value={contract.benefitMetric} />
                    <Fact label="Автоотключение" value={contract.autoStopCondition} />
                    <Fact label="Как отказаться" value={contract.optOutProcedure} />
                    <Fact label="Без ИИ продолжит работать" value={contract.fallbackFunctionality} />
                    <Fact label="Перестанет обрабатываться" value={contract.stoppedDataProcessing} />
                    <Fact label="Исторические данные" value={contract.historicalDataPolicy} />
                    <Fact label="Влияние отказа" value={contract.optOutImpact} />
                    <Fact label="Источники" value={humanSourceList(contract.sourceRefs)} />
                  </div>
                  <footer>
                    <Button
                      disabled={busy === contract.id || contract.status !== "Активен"}
                      onClick={() => void action({ action: "runScenario", contractId: contract.id }, contract.id)}
                    >
                      Запустить проверку
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy === `opt-${contract.id}`}
                      onClick={() => void action(
                        contract.status === "Активен"
                          ? { action: "optOut", contractId: contract.id, reason: "Отказ пользователя от сценария", scopeRef: "ALL" }
                          : { action: "restoreContract", contractId: contract.id, reason: "Возобновить после контрольной проверки отказа" },
                        `opt-${contract.id}`,
                      )}
                    >
                      {contract.status === "Активен" ? "Отказаться от сценария" : "Возобновить"}
                    </Button>
                  </footer>
                </aside>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="Сценарии ИИ не созданы"
              description="Сначала определите входные данные, разрешённые действия, стоимость, метрику пользы, отказ и автоотключение."
              density="compact"
              action={<Button onClick={onOpenIntegrations}>Подключить источники</Button>}
            />
          )}
        </Card>
      ) : null}

      {tab === "Решения и отказ" ? (
        <div className="ahAnalyticsDecisionGrid">
          <Card className="ahAnalyticsPanel">
            <PanelHead eyebrow="Неизменяемая история" title="Запуски моделей" meta={String(data.runs.length)} />
            {data.runs.length ? (
              <div className="ahAnalyticsRunList">
                {data.runs.map((item, index) => (
                  <CompactListCard
                    key={item.id}
                    index={String(index + 1).padStart(2, "0")}
                    title={`${humanTechnicalText(data.contracts.find((entry) => entry.id === item.contractId)?.name ?? recordLabel("Сценарий", item.contractId))} · ${item.status}`}
                    description={`${humanTechnicalText(item.outputSummary)} · уверенность ${item.confidence}% · ${rub(item.costMinor)}`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="Запусков пока нет" description="История появится после ручного запуска утверждённого сценария." density="compact" />
            )}
          </Card>
          <Card className="ahAnalyticsPanel">
            <PanelHead
              eyebrow="Права пользователя"
              title="Отказы"
              meta={`${data.optOuts.filter((item) => item.status === "Активен").length} активно`}
            />
            {data.optOuts.length ? (
              <div className="ahAnalyticsRunList">
                {data.optOuts.map((item, index) => (
                  <CompactListCard
                    key={item.id}
                    index={String(index + 1).padStart(2, "0")}
                    title={`${humanTechnicalText(data.contracts.find((entry) => entry.id === item.contractId)?.name ?? recordLabel("Сценарий", item.contractId))} · ${item.status}`}
                    description={`${humanTechnicalText(item.reason)} · ${humanTechnicalText(item.scopeType)}: ${item.scopeRef === "ALL" ? "весь сценарий" : humanReferenceLabel(item.scopeRef)}`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="Отказов пока нет" description="Любой разрешённый сценарий можно отключить в его карточке правил." density="compact" />
            )}
          </Card>
        </div>
      ) : null}

      {tab === "Метрики" ? (
        <Card className="ahAnalyticsPanel">
          <PanelHead eyebrow="Словарь показателей" title="Метрики, формулы и источники" meta={String(data.metricDefinitions.length)} />
          {data.metricDefinitions.length ? (
            <div className="ahAnalyticsMetricTable">
              <header><span>Показатель</span><span>Определение и расчёт</span><span>Источник</span><span>Свежесть / качество</span></header>
              {data.metricDefinitions.map((item) => (
                <article key={item.id}>
                  <span><strong>{humanTechnicalText(item.name)}</strong><small>{recordLabel("Показатель", item.id)} · {humanTechnicalText(item.category)} · {item.unit}</small></span>
                  <span><strong>{humanTechnicalText(item.definition)}</strong><small>{humanFormulaLabel(item.formula)} · детализация: {humanTechnicalText(item.grain)}</small></span>
                  <span><strong>{humanSourceList(item.sourceTables)}</strong><small>Ответственный за показатель назначен</small></span>
                  <span><strong>{humanPeriodLabel(item.freshness)}</strong><small>{humanTechnicalText(item.sourceQuality)}</small></span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Словарь метрик пуст"
              description="Определения появятся после утверждения показателей, формул, владельцев и источников."
              density="compact"
            />
          )}
        </Card>
      ) : null}
    </PageContainer>
  );
}

function OverviewPanel({
  data,
  hasAnalyticsData,
  onOpenSignals,
}: {
  data: Data;
  hasAnalyticsData: boolean;
  onOpenSignals: (domain: string) => void;
}) {
  return (
    <Card className="ahAnalyticsPanel">
      <PanelHead eyebrow="Управленческий обзор" title="Состояние контуров" meta="Без медицинских данных" />
      {hasAnalyticsData ? (
        <>
          <div className="ahAnalyticsDomainGrid">
            <Domain label="Следующие оплаты" value={rub(data.owner.nextPaymentsMinor)} note="по сохранённым данным" />
            <Domain label="Учебный прогресс" value={`${data.owner.averageProgress}%`} note="по сохранённым данным" />
            <Domain label="Активный штат" value={String(data.owner.activeEmployees)} note="по сохранённым данным" />
            <Domain label="Безопасность" value={String(data.owner.openSafetyFaults)} note="открытые неисправности" />
            <Domain label="Маржа кухни" value={`${data.owner.foodMarginPercent}%`} note="по сохранённым данным" />
            <Domain label="Проекты под риском" value={String(data.owner.projectsAtRisk)} note="по сохранённым данным" />
          </div>
          {data.charts.risks.length ? (
            <div className="ahAnalyticsRiskList">
              {data.charts.risks.map((item) => (
                <button type="button" key={item.domain} onClick={() => onOpenSignals(item.domain)}>
                  <span><strong>{humanTechnicalText(item.domain)}</strong><small>{item.high} высокой важности</small></span>
                  <i style={{ width: `${Math.min(100, Math.max(8, item.total * 16))}%` }} />
                  <em>{item.total}</em>
                </button>
              ))}
            </div>
          ) : null}
          <div className="ahAnalyticsCoverage">
            <Coverage title="ФАКТ" items={data.sourceCoverage.fact} />
            <Coverage title="РАСЧЁТНОЕ" items={data.sourceCoverage.synthetic} />
            <Coverage title="НЕТ ИСТОЧНИКА" items={data.sourceCoverage.unavailable} />
          </div>
        </>
      ) : (
        <EmptyState
          title="Данных для обзора пока нет"
          description="Показатели и сигналы появятся только после подключения и сохранения рабочих источников."
          density="compact"
        />
      )}
    </Card>
  );
}

function MoneyPanel({ data, maxCash }: { data: Data; maxCash: number }) {
  return (
    <div className="ahAnalyticsMoneyGrid">
      <Card className="ahAnalyticsPanel">
        <PanelHead eyebrow="ДДС" title="Поступления и списания" meta="₽ · по месяцам" />
        {data.charts.cash.length ? (
          <div className="ahAnalyticsCashBars">
            {data.charts.cash.map((item) => (
              <div key={item.period}>
                <div>
                  <i className="ahAnalyticsCashIn" style={{ height: `${Math.max(3, item.receiptsMinor / maxCash * 100)}%` }} />
                  <i className="ahAnalyticsCashOut" style={{ height: `${Math.max(3, item.outflowsMinor / maxCash * 100)}%` }} />
                </div>
                <strong>{humanPeriodLabel(item.period).split(" ")[0].slice(0, 3)}</strong>
                <small>{short(item.netMinor)}</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Финансовых операций пока нет" description="График появится после загрузки поступлений и списаний." density="compact" />
        )}
      </Card>
      <Card className="ahAnalyticsPanel">
        <PanelHead eyebrow="Вероятностный сценарий" title="Прогноз остатка" meta="По сохранённому плану" />
        {data.charts.forecast.length ? (
          <div className="ahAnalyticsForecast">
            {data.charts.forecast.map((item) => (
              <article key={item.forecastDate}>
                <time>{item.forecastDate.slice(5)}</time>
                <span><strong>{item.direction} · {rub(item.weightedMinor)}</strong><small>{item.probability}% · {rub(item.amountMinor)}</small></span>
                <em>{rub(item.balanceMinor)}</em>
              </article>
            ))}
            <footer>{humanTechnicalText(data.modelBoundary)}</footer>
          </div>
        ) : (
          <EmptyState title="Прогноз пока не рассчитан" description="Вероятностный сценарий строится только по сохранённому платёжному календарю." density="compact" />
        )}
      </Card>
    </div>
  );
}

function PanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return (
    <header className="ahAnalyticsPanelHead">
      <div><p>{eyebrow}</p><h2>{title}</h2></div>
      <span>{meta}</span>
    </header>
  );
}

function Domain({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="ahAnalyticsDomain"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Coverage({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="ahAnalyticsCoverageCard">
      <strong>{title}</strong>
      {items.length ? items.map((item) => <span key={item}>{humanTechnicalText(item)}</span>) : <small>Нет записей</small>}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <article className="ahAnalyticsFact"><small>{label}</small><p>{value ? humanTechnicalText(value) : "Не указано"}</p></article>;
}
