"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, CompactListCard, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./AnalyticsWorkspace.ds.css";

type Signal = { id: string; contractId: string; domain: string; signalType: string; severity: string; title: string; evidence: string; explanation: string; recommendation: string; sourceRefs: string; confidence: number; status: string; relatedTaskId: number | null; humanDecision: string; decisionEvidence: string; detectedAt: string };
type Contract = { id: string; name: string; inputData: string; expectedResult: string; allowedActions: string; forbiddenActions: string; humanOwner: string; costMinor: number; benefitMetric: string; autoStopCondition: string; optOutAllowed: boolean; optOutProcedure: string; fallbackFunctionality: string; stoppedDataProcessing: string; historicalDataPolicy: string; optOutImpact: string; status: string; version: string; sourceRefs: string; activeOptOuts: number };
type Run = { id: string; contractId: string; ranAt: string; modelVersion: string; status: string; inputSnapshotRef: string; outputType: string; outputSummary: string; confidence: number; costMinor: number; explanation: string; humanDecision: string; isSynthetic: boolean };
type Metric = { id: string; name: string; category: string; definition: string; formula: string; unit: string; grain: string; sourceTables: string; sourceQuality: string; freshness: string; ownerEntityId: string; targetValue: number | null; sensitive: boolean };
type AnalyticsData = {
  dataMode: "test" | "source_only" | "empty";
  metricDefinitions: Metric[];
  signals: Signal[];
  contracts: Contract[];
  runs: Run[];
  optOuts: Array<{ id: string; contractId: string; scopeType: string; scopeRef: string; requestedBy: string; reason: string; status: string; stopsProcessingAt: string; historicalDataPolicy: string }>;
  owner: { cashPeriod: string; cashFlowMinor: number; cashAprilMinor: number; cashForecastFloorMinor: number; nextPaymentsMinor: number; highRiskFamilies: number; averageProgress: number; activeEmployees: number; openSafetyFaults: number; foodMarginPercent: number; projectsAtRisk: number; openDataIssues: number; verifiedLiveSources: number };
  charts: { cash: Array<{ period: string; receiptsMinor: number; outflowsMinor: number; netMinor: number; factRows: number; syntheticRows: number }>; forecast: Array<{ forecastDate: string; direction: string; amountMinor: number; probability: number; weightedMinor: number; balanceMinor: number; isGap: boolean }>; risks: Array<{ domain: string; total: number; high: number }> };
  sourceCoverage: { fact: string[]; synthetic: string[]; unavailable: string[] };
  boundary: string;
  modelBoundary: string;
};

const roles: Record<string, string> = {
  "Аналитика": "ANALYTICS", "Интеграции": "INTEGRATIONS", "Проекты": "PROJECTS", "Бухгалтерия": "ACCOUNTING",
  "Медработник": "MEDICAL", "Собственник": "OWNER", "Директор": "DIRECTOR", "Представитель Виталия": "REPRESENTATIVE",
  "Безопасность": "SAFETY", "Финансы": "FINANCE", "Кухня": "KITCHEN", "Закупки": "PROCUREMENT", "Юрист": "LEGAL",
  "HR": "HR", "Продажи": "SALES", "Маркетинг": "MARKETING", "Педагог": "TEACHER", "Методист": "METHODIST", "Родитель": "PARENT",
};

const tabs = ["Обзор", "Деньги", "Сигналы", "AI-контракты", "Решения и отказ", "Метрики"] as const;
type AnalyticsTab = typeof tabs[number];
const rub = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value / 100);
const short = (value: number) => new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value / 100);

export function AnalyticsWorkspace({ role, notify, onTasksChanged, onOpenIntegrations }: { role: string; notify: (value: string) => void; onTasksChanged: () => void; onOpenIntegrations: () => void }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<AnalyticsTab>("Обзор");
  const [selectedSignal, setSelectedSignal] = useState("");
  const [selectedContract, setSelectedContract] = useState("");
  const [domain, setDomain] = useState("Все");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/analytics", { cache: "no-store", headers: { "x-arthello-role": roles[role] ?? "" } });
      const payload = await response.json() as AnalyticsData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Нет доступа");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/analytics-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Запись уже существует" : "Действие сохранено; бизнес-данные не изменены");
      await load();
      onTasksChanged();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Ошибка");
    } finally {
      setBusy("");
    }
  }

  const domains = useMemo(() => ["Все", ...new Set((data?.signals ?? []).map((item) => item.domain))], [data]);
  if (loading) return <section className="ahAnalyticsStatus">Собираем доказательную аналитику…</section>;
  if (error || !data) return <section className="ahAnalyticsStatus"><Card><EmptyState title="Аналитика недоступна" description={error || "Для просмотра требуется разрешённая роль."} density="compact" action={<Button variant="secondary" onClick={() => void load()}>Повторить</Button>} /></Card></section>;

  const signal = data.signals.find((item) => item.id === selectedSignal) ?? data.signals[0];
  const contract = data.contracts.find((item) => item.id === selectedContract) ?? data.contracts[0];
  const visibleSignals = data.signals.filter((item) => domain === "Все" || item.domain === domain);
  const maxCash = Math.max(1, ...data.charts.cash.flatMap((item) => [item.receiptsMinor, item.outflowsMinor]));
  const hasData = Boolean(data.metricDefinitions.length || data.signals.length || data.contracts.length || data.runs.length || data.charts.cash.length || data.charts.forecast.length);
  const isDemo = data.dataMode === "test";

  return <PageContainer className="ahAnalyticsPage">
    <PageHeader
      eyebrow="ФАКТЫ · ПРОГНОЗЫ · РЕШЕНИЯ"
      title="Аналитика и ИИ"
      description="Каждый показатель раскрывается до формулы и источника, каждый модельный сигнал — до факторов, контракта и решения человека."
      actions={contract
        ? <Button variant="primary" disabled={busy === contract.id} onClick={() => void action({ action: "runScenario", contractId: contract.id }, contract.id)}>Контрольный запуск</Button>
        : <Button variant="primary" onClick={onOpenIntegrations}>Загрузить данные</Button>}
    />

    <Card className="ahAnalyticsBoundary"><strong>{hasData ? (isDemo ? "Тестовый снимок" : "Рабочие данные") : "Рабочая структура"}</strong><span>{hasData ? data.boundary : "Источники, метрики и модельные контракты не создаются автоматически. Подключите проверяемые рабочие данные."}</span></Card>

    <div className="ahAnalyticsKpis">
      <KpiCard label="Чистый поток" value={`${short(isDemo ? data.owner.cashAprilMinor : data.owner.cashFlowMinor)} ₽`} note={data.owner.cashPeriod || "по операциям"} onClick={() => setTab("Деньги")} />
      <KpiCard className={data.owner.cashForecastFloorMinor < 0 ? "ahAnalyticsKpiWarning" : undefined} label="Минимум прогноза" value={`${short(data.owner.cashForecastFloorMinor)} ₽`} note="сценарий, не факт" onClick={() => setTab("Деньги")} />
      <KpiCard label="Сигналы риска" value={data.owner.highRiskFamilies} note="требуют решения человека" onClick={() => setTab("Сигналы")} />
      <KpiCard className={data.owner.openDataIssues ? "ahAnalyticsKpiWarning" : undefined} label="Проблемы данных" value={data.owner.openDataIssues} note={`${data.owner.verifiedLiveSources} live-источников`} onClick={() => setTab("Метрики")} />
    </div>

    <div className="ahAnalyticsTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы аналитики" /></div>

    {tab === "Обзор" ? <AnalyticsOverview data={data} hasData={hasData} isDemo={isDemo} openSignals={(nextDomain) => { setDomain(nextDomain); setTab("Сигналы"); }} /> : null}
    {tab === "Деньги" ? <AnalyticsMoney data={data} maxCash={maxCash} isDemo={isDemo} /> : null}
    {tab === "Сигналы" ? <AnalyticsSignals signals={visibleSignals} signal={signal} domain={domain} domains={domains} busy={busy} setDomain={setDomain} select={setSelectedSignal} action={action} /> : null}
    {tab === "AI-контракты" ? <AnalyticsContracts contracts={data.contracts} contract={contract} selected={selectedContract} busy={busy} isDemo={isDemo} select={setSelectedContract} action={action} /> : null}
    {tab === "Решения и отказ" ? <AnalyticsDecisions data={data} /> : null}
    {tab === "Метрики" ? <AnalyticsMetrics metrics={data.metricDefinitions} /> : null}
  </PageContainer>;
}

function AnalyticsOverview({ data, hasData, isDemo, openSignals }: { data: AnalyticsData; hasData: boolean; isDemo: boolean; openSignals: (domain: string) => void }) {
  if (!hasData) return <Card className="ahAnalyticsPanel"><EmptyState title="Данных для аналитики пока нет" description="Подключите источники через интеграции или создайте рабочие записи в профильных разделах." density="compact" /></Card>;
  const domains = [
    ["Следующие оплаты", rub(data.owner.nextPaymentsMinor), "по сохранённым данным"],
    ["Учебный прогресс", `${data.owner.averageProgress}%`, "обезличенный показатель"],
    ["Активный штат", String(data.owner.activeEmployees), "рабочие записи HR"],
    ["Безопасность", String(data.owner.openSafetyFaults), "открытые неисправности"],
    ["Маржа кухни", `${data.owner.foodMarginPercent}%`, "по сохранённым данным"],
    ["Проекты под риском", String(data.owner.projectsAtRisk), "стратегический контур"],
  ];
  return <div className="ahAnalyticsLayout">
    <Card className="ahAnalyticsPanel"><PanelHead eyebrow="Управленческий обзор" title="Состояние контуров" note="без медицинских данных" /><div className="ahAnalyticsDomainGrid">{domains.map(([label, value, note], index) => <CompactListCard key={label} index={String(index + 1).padStart(2, "0")} title={`${label}: ${value}`} description={note} />)}</div></Card>
    <Card className="ahAnalyticsPanel"><PanelHead eyebrow="Ранние сигналы" title="Где нужен человек" note={`${data.signals.filter((item) => item.status !== "Закрыт").length} открыто`} />{data.charts.risks.length ? <div className="ahAnalyticsRiskList">{data.charts.risks.map((item) => <button type="button" key={item.domain} onClick={() => openSignals(item.domain)}><span><strong>{item.domain}</strong><small>{item.high} высокой важности</small></span><i><b style={{ width: `${Math.min(100, Math.max(8, item.total * 16))}%` }} /></i><em>{item.total}</em></button>)}</div> : <EmptyState title="Сигналов пока нет" description="Модель не создаёт риск без входных данных и проверяемого контракта." density="compact" />}</Card>
    <Card className="ahAnalyticsPanel ahAnalyticsSources"><PanelHead eyebrow="Покрытие источников" title="Факт, расчёт и пробелы" note={isDemo ? "тестовый режим" : "рабочий режим"} /><div>{[["Факт", data.sourceCoverage.fact], [isDemo ? "Синтетическое" : "Расчётное", data.sourceCoverage.synthetic], ["Нет источника", data.sourceCoverage.unavailable]].map(([label, values]) => <section key={label as string}><strong>{label as string}</strong>{(values as string[]).length ? (values as string[]).map((value) => <span key={value}>{value}</span>) : <small>нет записей</small>}</section>)}</div></Card>
  </div>;
}

function AnalyticsMoney({ data, maxCash, isDemo }: { data: AnalyticsData; maxCash: number; isDemo: boolean }) {
  if (!data.charts.cash.length && !data.charts.forecast.length) return <Card className="ahAnalyticsPanel"><EmptyState title="Денежной аналитики пока нет" description="Поступления, списания и прогноз появятся только из сохранённых операций и планов." density="compact" /></Card>;
  return <div className="ahAnalyticsLayout">
    <Card className="ahAnalyticsPanel"><PanelHead eyebrow="ДДС" title="Поступления и списания" note="₽ · по месяцам" /><div className="ahAnalyticsCashBars">{data.charts.cash.map((item) => <article key={item.period}><div><i className="in" style={{ height: `${Math.max(3, item.receiptsMinor / maxCash * 100)}%` }} /><i className="out" style={{ height: `${Math.max(3, item.outflowsMinor / maxCash * 100)}%` }} /></div><strong>{item.period.slice(5)}</strong><small>{short(item.netMinor)} ₽</small><em>{isDemo ? (item.factRows ? "XLSX" : "TEST") : (item.factRows ? "Факт" : "Расчёт")}</em></article>)}</div></Card>
    <Card className="ahAnalyticsPanel"><PanelHead eyebrow="Вероятностный сценарий" title="Прогноз остатка" note="не является фактом" /><div className="ahAnalyticsForecast">{data.charts.forecast.map((item, index) => <CompactListCard key={item.forecastDate} index={String(index + 1).padStart(2, "0")} title={`${item.forecastDate.slice(5)} · ${item.direction} · ${rub(item.weightedMinor)}`} description={`${item.probability}% от ${rub(item.amountMinor)} · остаток ${rub(item.balanceMinor)}${item.isGap ? " · разрыв" : ""}`} />)}</div><p className="ahAnalyticsModelBoundary">{data.modelBoundary}</p></Card>
  </div>;
}

function AnalyticsSignals({ signals, signal, domain, domains, busy, setDomain, select, action }: { signals: Signal[]; signal?: Signal; domain: string; domains: string[]; busy: string; setDomain: (value: string) => void; select: (id: string) => void; action: (body: Record<string, unknown>, key: string) => Promise<void> }) {
  if (!signals.length) return <Card className="ahAnalyticsPanel"><EmptyState title="Сигналов пока нет" description="Решение и задача появляются только после проверяемого модельного сигнала." density="compact" action={<select aria-label="Домен сигналов" value={domain} onChange={(event) => setDomain(event.target.value)}>{domains.map((item) => <option key={item}>{item}</option>)}</select>} /></Card>;
  return <div className="ahAnalyticsSignalShell"><Card className="ahAnalyticsPanel"><div className="ahAnalyticsFilter"><select aria-label="Домен сигналов" value={domain} onChange={(event) => setDomain(event.target.value)}>{domains.map((item) => <option key={item}>{item}</option>)}</select><span>{signals.length} сигналов · решение за человеком</span></div><div className="ahAnalyticsSignalList">{signals.map((item) => <button type="button" key={item.id} className={signal?.id === item.id ? "active" : ""} onClick={() => select(item.id)}><span><small>{item.domain} · {item.signalType}</small><strong>{item.title}</strong><em>{item.status}</em></span><b>{item.confidence}%</b></button>)}</div></Card>{signal ? <Card className="ahAnalyticsPanel"><PanelHead eyebrow={`${signal.id} · ${signal.severity}`} title={signal.title} note={`${signal.confidence}%`} /><div className="ahAnalyticsCompactList"><CompactListCard title="Доказательство" description={signal.evidence} /><CompactListCard title="Объяснение" description={signal.explanation} /><CompactListCard title="Рекомендация" description={signal.recommendation} /><CompactListCard title="Источники" description={signal.sourceRefs} /><CompactListCard title="Решение человека" description={signal.humanDecision || "Ожидается"} /></div><footer className="ahAnalyticsActions"><Button variant="secondary" disabled={busy === `task-${signal.id}`} onClick={() => void action({ action: "createSignalTask", signalId: signal.id }, `task-${signal.id}`)}>Создать задачу</Button><Button variant="primary" disabled={busy === `decision-${signal.id}`} onClick={() => void action({ action: "recordDecision", signalId: signal.id, decision: "Проверить владельцем процесса и выполнить контролируемое действие", evidence: `HUMAN-REVIEW:${signal.id}` }, `decision-${signal.id}`)}>Зафиксировать решение</Button></footer></Card> : null}</div>;
}

function AnalyticsContracts({ contracts, contract, selected, busy, isDemo, select, action }: { contracts: Contract[]; contract?: Contract; selected: string; busy: string; isDemo: boolean; select: (id: string) => void; action: (body: Record<string, unknown>, key: string) => Promise<void> }) {
  if (!contracts.length || !contract) return <Card className="ahAnalyticsPanel"><EmptyState title="AI-контрактов пока нет" description="Сценарий нельзя запустить без входных данных, владельца, ограничений и процедуры отказа." density="compact" /></Card>;
  const facts = [["Входные данные", contract.inputData], ["Ожидаемый результат", contract.expectedResult], ["Разрешено", contract.allowedActions], ["Запрещено", contract.forbiddenActions], ["Ответственный человек", contract.humanOwner], ["Стоимость запуска", `${rub(contract.costMinor)} · ${isDemo ? "тестовый rule engine" : "расчётный модуль"}`], ["Метрика пользы", contract.benefitMetric], ["Автоотключение", contract.autoStopCondition], ["Как отказаться", contract.optOutProcedure], ["Без ИИ продолжит работать", contract.fallbackFunctionality], ["Перестанет обрабатываться", contract.stoppedDataProcessing], ["Исторические данные", contract.historicalDataPolicy], ["Влияние отказа", contract.optOutImpact], ["Источники", contract.sourceRefs]];
  return <div className="ahAnalyticsSignalShell"><Card className="ahAnalyticsPanel"><PanelHead eyebrow="Реестр контрактов" title="Модельные сценарии" note={`${contracts.length}`} /><div className="ahAnalyticsContractList">{contracts.map((item, index) => <button type="button" key={item.id} className={(selected || contract.id) === item.id ? "active" : ""} onClick={() => select(item.id)}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.name}</strong><small>{item.id} · {item.version}</small></span><em>{item.status}</em></button>)}</div></Card><Card className="ahAnalyticsPanel"><PanelHead eyebrow={contract.id} title={contract.name} note={contract.status} /><div className="ahAnalyticsContractFacts">{facts.map(([label, value]) => <CompactListCard key={label} title={label} description={value} />)}</div><footer className="ahAnalyticsActions"><Button variant="primary" disabled={busy === contract.id || contract.status !== "Активен"} onClick={() => void action({ action: "runScenario", contractId: contract.id }, contract.id)}>Запустить проверку</Button><Button variant="secondary" disabled={busy === `opt-${contract.id}`} onClick={() => void action(contract.status === "Активен" ? { action: "optOut", contractId: contract.id, reason: isDemo ? "Контрольный отказ пользователя на тестовом контуре" : "Отказ пользователя от сценария", scopeRef: "ALL" } : { action: "restoreContract", contractId: contract.id, reason: "Возобновить после контрольной проверки отказа" }, `opt-${contract.id}`)}>{contract.status === "Активен" ? "Отказаться от сценария" : "Возобновить"}</Button></footer></Card></div>;
}

function AnalyticsDecisions({ data }: { data: AnalyticsData }) {
  if (!data.runs.length && !data.optOuts.length) return <Card className="ahAnalyticsPanel"><EmptyState title="Решений и отказов пока нет" description="История запуска и право на отказ записываются только после действия пользователя." density="compact" /></Card>;
  return <div className="ahAnalyticsLayout"><Card className="ahAnalyticsPanel"><PanelHead eyebrow="Append-only" title="Запуски моделей" note={`${data.runs.length}`} /><div className="ahAnalyticsRunList">{data.runs.map((item, index) => <CompactListCard key={item.id} index={String(index + 1).padStart(2, "0")} title={`${data.contracts.find((contract) => contract.id === item.contractId)?.name || item.contractId} · ${item.status}`} description={`${item.outputSummary} · ${item.confidence}% · ${rub(item.costMinor)} · ${item.isSynthetic ? "синтетический" : "внешний"}`} />)}</div></Card><Card className="ahAnalyticsPanel"><PanelHead eyebrow="Права пользователя" title="Отказы" note={`${data.optOuts.filter((item) => item.status === "Активен").length} активно`} /><div className="ahAnalyticsRunList">{data.optOuts.length ? data.optOuts.map((item, index) => <CompactListCard key={item.id} index={String(index + 1).padStart(2, "0")} title={data.contracts.find((contract) => contract.id === item.contractId)?.name || item.contractId} description={`${item.reason} · ${item.scopeType}: ${item.scopeRef} · ${item.status} · ${item.historicalDataPolicy}`} />) : <EmptyState title="Отказов ещё нет" description="Любой модельный сценарий можно отключить в его контракте." density="compact" />}</div></Card></div>;
}

function AnalyticsMetrics({ metrics }: { metrics: Metric[] }) {
  if (!metrics.length) return <Card className="ahAnalyticsPanel"><EmptyState title="Метрики пока не определены" description="Для каждой метрики нужны формула, зерно, источник, свежесть и владелец." density="compact" /></Card>;
  return <Card className="ahAnalyticsPanel"><PanelHead eyebrow="Словарь показателей" title="Метрики и источники" note={`${metrics.length} записей`} /><div className="ahAnalyticsMetricTable"><table><thead><tr><th>Метрика</th><th>Определение и формула</th><th>Источник</th><th>Свежесть / качество</th></tr></thead><tbody>{metrics.map((item) => <tr key={item.id}><td data-label="Метрика">{item.name}<small>{item.id} · {item.category} · {item.unit}</small></td><td data-label="Определение">{item.definition}<small>{item.formula} · grain: {item.grain}</small></td><td data-label="Источник">{item.sourceTables}<small>{item.ownerEntityId}</small></td><td data-label="Качество">{item.freshness}<small>{item.sourceQuality}</small></td></tr>)}</tbody></table></div></Card>;
}

function PanelHead({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return <header className="ahAnalyticsPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{note}</span></header>;
}
