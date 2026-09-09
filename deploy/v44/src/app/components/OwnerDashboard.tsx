"use client";

import { useEffect, useMemo, useState } from "react";
import { ModuleId, snapshot } from "../../data/test-snapshot";
import { AppIcon } from "./AppIcon";
import styles from "./OwnerDashboard.module.css";
import chartStyles from "./OwnerDashboardChart.module.css";

type TaskSummary = {
  id: number;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  sourceId: string;
};

type FinanceOperation = {
  id: string;
  operationDate: string;
  direction: string;
  amountMinor: number;
  category: string;
  reportClass: string;
  counterpartyEntityId: string;
  contractId: string;
  documentId: string;
  bankOperationRef: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRef: string;
  dataQuality: string;
  status: string;
};

type FinancePayload = {
  selectedPeriod: string;
  operations: FinanceOperation[];
  entityNames: Record<string, string>;
  monthly: Array<{
    period: string;
    receiptsMinor: number;
    outflowsMinor: number;
    netMinor: number;
  }>;
  summary: {
    receiptsMinor: number;
    outflowsMinor: number;
    netMinor: number;
    debtMinor: number;
  };
};

type OperationDetail = {
  title: string;
  value: string;
  summary: string;
  source: string;
  calculation: string;
  updated: string;
  owner: string;
  quality: string;
  lineage: string[];
};

type OwnerDashboardProps = {
  displayName: string;
  roleLabel: string;
  tasks: TaskSummary[];
  sourceOnly: boolean;
  navigate: (module: ModuleId) => void;
  createTask: () => void;
  openOperation: (detail: OperationDetail) => void;
};

const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function rubles(minor: number) {
  return rub.format(minor / 100);
}

function compactMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} млн ₽`;
  if (absolute >= 1_000) return `${Math.round(value / 1_000)} тыс. ₽`;
  return rub.format(value);
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function monthLabel(period: string, format: "short" | "long" = "short") {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { month: format, year: format === "long" ? "numeric" : undefined })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace(/^./, (letter) => letter.toUpperCase())
    .replace(" г.", "");
}

function chartTick(value: number) {
  if (value === 0) return "0";
  return `${Number((value / 100_000_000).toFixed(1)).toLocaleString("ru-RU")} млн`;
}

const kpiIcons = ["finance", "sales", "legal", "clients", "registry", "hr"] as const;

export function OwnerDashboard({ displayName, roleLabel, tasks, sourceOnly, navigate, createTask, openOperation }: OwnerDashboardProps) {
  const [finance, setFinance] = useState<FinancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("Все типы");
  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/finance?period=2026-04", { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as FinancePayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить финансовый контур");
        setFinance(payload);
        setSelectedId((current) => current || payload.operations[0]?.id || "");
        setError("");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить финансовый контур");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const operations = useMemo(() => {
    if (!finance) return [];
    const clean = query.trim().toLocaleLowerCase("ru");
    return finance.operations
      .filter((operation) => direction === "Все типы" || operation.direction === direction)
      .filter((operation) => !clean || [operation.id, operation.category, operation.counterpartyEntityId, operation.contractId].some((value) => value.toLocaleLowerCase("ru").includes(clean)))
      .slice(0, 6);
  }, [direction, finance, query]);

  const selected = operations.find((operation) => operation.id === selectedId) ?? operations[0] ?? null;
  const firstName = displayName.split(" ")[0] || "Виталий";
  const paymentDebt = snapshot.payments.schoolMay.outstanding
    + snapshot.payments.kindergartenMay.outstanding
    + snapshot.payments.campJune.outstanding
    + snapshot.payments.kindergartenJune.outstanding;
  const summary = finance?.summary;
  const metrics = [
    { label: "Чистый денежный поток", value: summary ? compactMoney(summary.netMinor / 100) : compactMoney(snapshot.finance.currentCashFlow), note: "Апрель 2026 · факт ОДДС", tone: "indigo", module: "finance" as ModuleId },
    { label: "Поступления", value: summary ? compactMoney(summary.receiptsMinor / 100) : compactMoney(snapshot.finance.currentRevenue), note: "Апрель 2026 · источник XLSX", tone: "green", module: "finance" as ModuleId },
    { label: "Списания", value: summary ? compactMoney(summary.outflowsMinor / 100) : compactMoney(snapshot.finance.currentOutflows), note: "Апрель 2026 · нужна сверка банка", tone: "orange", module: "finance" as ModuleId },
    { label: "Задолженность", value: summary?.debtMinor ? compactMoney(summary.debtMinor / 100) : compactMoney(paymentDebt), note: "Оплаты · обезличенный агрегат", tone: "red", module: "finance" as ModuleId },
    { label: "Реестр оплат", value: `${snapshot.registers.paymentSheets} листов`, note: "Последний факт · июнь 2026", tone: "blue", module: "integrations" as ModuleId },
    { label: "Сотрудники", value: `${snapshot.registers.employeeRows} строк`, note: "Активный состав не подтверждён", tone: "violet", module: "hr" as ModuleId },
  ];

  const decisions = tasks.slice(0, 5);
  const chartData = useMemo(() => finance?.monthly?.length
    ? finance.monthly.filter((item) => item.period >= "2026-01" && item.period <= "2026-04")
    : snapshot.finance.months.map((label, index) => ({
      period: `2026-${String(index + 1).padStart(2, "0")}`,
      receiptsMinor: Math.round(snapshot.finance.receipts[index] * 100),
      outflowsMinor: Math.round(snapshot.finance.outflows[index] * 100),
      netMinor: Math.round((snapshot.finance.receipts[index] - snapshot.finance.outflows[index]) * 100),
      label,
    })), [finance]);
  const chartGeometry = useMemo(() => {
    const width = 720;
    const height = 190;
    const left = 38;
    const right = 8;
    const top = 18;
    const bottom = 32;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const rawMax = Math.max(1, ...chartData.flatMap((item) => [item.receiptsMinor, item.outflowsMinor]));
    const step = rawMax > 900_000_000 ? 300_000_000 : rawMax > 400_000_000 ? 200_000_000 : 100_000_000;
    const max = Math.ceil(rawMax / step) * step;
    const point = (value: number, index: number) => ({
      x: left + (chartData.length === 1 ? plotWidth / 2 : index * (plotWidth / (chartData.length - 1))),
      y: top + plotHeight - (value / max) * plotHeight,
    });
    const receipts = chartData.map((item, index) => point(item.receiptsMinor, index));
    const outflows = chartData.map((item, index) => point(item.outflowsMinor, index));
    const path = (points: Array<{ x: number; y: number }>) => points.reduce((result, item, index) => {
      if (index === 0) return `M${item.x.toFixed(1)} ${item.y.toFixed(1)}`;
      const previous = points[index - 1];
      const midpoint = (previous.x + item.x) / 2;
      return `${result} C${midpoint.toFixed(1)} ${previous.y.toFixed(1)}, ${midpoint.toFixed(1)} ${item.y.toFixed(1)}, ${item.x.toFixed(1)} ${item.y.toFixed(1)}`;
    }, "");
    return {
      width, height, left, right, top, bottom, plotWidth, plotHeight, max,
      receipts, outflows,
      receiptsPath: path(receipts),
      outflowsPath: path(outflows),
      areaPath: receipts.length ? `${path(receipts)} L${receipts.at(-1)?.x} ${height - bottom} L${receipts[0].x} ${height - bottom} Z` : "",
      ticks: Array.from({ length: 5 }, (_, index) => max - (max / 4) * index),
    };
  }, [chartData]);
  const shownChartIndex = activeChartIndex ?? Math.max(chartData.length - 1, 0);
  const shownChartItem = chartData[shownChartIndex];
  const shownChartPoint = chartGeometry.receipts[shownChartIndex];

  function showOperation(operation: FinanceOperation) {
    openOperation({
      title: operation.category,
      value: `${operation.direction === "Поступление" ? "+" : "−"}${rubles(operation.amountMinor)}`,
      summary: `${operation.id} · ${finance?.entityNames[operation.counterpartyEntityId] ?? operation.counterpartyEntityId}`,
      source: `${operation.sourceFile} · ${operation.sourceSheet} · ${operation.sourceRef}`,
      calculation: `${operation.direction}; статья ${operation.reportClass}; исходная сумма операции без перезаписи`,
      updated: formatDate(operation.operationDate),
      owner: "Финансовый контролёр",
      quality: operation.dataQuality || operation.status,
      lineage: ["Источник", "Банковская операция", "Контрагент", "Договор", "Статья ДДС", "Документ"],
    });
  }

  return (
    <section className={styles.dashboard} aria-label={`Персональный дашборд: ${roleLabel}`}>
      <header className={styles.heading}>
        <div>
          <h1>Доброе утро, {firstName}!</h1>
          <p>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).replace(/^./, (letter) => letter.toUpperCase())}</p>
        </div>
        <button type="button" onClick={createTask}><AppIcon name="plus" /> Новая задача</button>
      </header>

      <div className={styles.kpis}>
        {metrics.map((metric, index) => (
          <button key={metric.label} type="button" onClick={() => navigate(metric.module)} className={styles[metric.tone]}>
            <span className={styles.kpiIcon}><AppIcon name={kpiIcons[index]} /></span>
            <span className={styles.kpiCopy}><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.note}</em></span>
          </button>
        ))}
      </div>

      <div className={styles.insights}>
        <article className={styles.panel}>
          <header><strong>Сигналы и риски</strong><button onClick={() => navigate("analytics")}>Смотреть все ({snapshot.qualitySignals.length})</button></header>
          <div className={styles.signalList}>
            {snapshot.qualitySignals.map((signal, index) => (
              <button key={signal.id} onClick={() => navigate(index === 2 ? "hr" : "finance")}>
                <span className={styles.signalIcon}><AppIcon name={index === 2 ? "hr" : "finance"} /></span>
                <span><strong>{signal.title}</strong><small>{signal.action}</small></span>
              </button>
            ))}
            <button onClick={() => navigate("integrations")}>
              <span className={styles.signalIcon}><AppIcon name="integrations" /></span>
              <span><strong>Банковский источник не подключён</strong><small>Точка и Альфа-Банк ожидают защищённую авторизацию</small></span>
            </button>
          </div>
        </article>

        <article className={styles.panel}>
          <header><strong>Что требует моего решения</strong><button onClick={() => navigate("tasks")}>Все задачи ({tasks.length})</button></header>
          <div className={styles.decisionList}>
            {decisions.length ? decisions.map((task) => (
              <button key={task.id} onClick={() => navigate("tasks")}>
                <AppIcon name="tasks" />
                <span><strong>{task.title}</strong><small>{task.sourceId || "Ручная задача"}</small></span>
                <em>{task.dueDate || task.status}</em>
              </button>
            )) : <div className={styles.inlineEmpty}><strong>Нет открытых решений</strong><span>Создайте задачу или подключите источник сигналов.</span><button onClick={createTask}>Создать задачу</button></div>}
          </div>
        </article>

        <article className={`${styles.panel} ${chartStyles.chartPanel}`}>
          <header><span><strong>Денежный поток</strong><small>{chartData.length ? `${monthLabel(chartData[0].period)} — ${monthLabel(chartData.at(-1)?.period ?? chartData[0].period, "long")}` : "Нет данных"}</small></span><button onClick={() => navigate("finance")}>Открыть отчёт</button></header>
          {shownChartItem ? <div className={chartStyles.chartLegend} aria-live="polite">
            <span><i className={chartStyles.inDot} /><small>Поступления</small><strong>{compactMoney(shownChartItem.receiptsMinor / 100)}</strong></span>
            <span><i className={chartStyles.outDot} /><small>Списания</small><strong>{compactMoney(shownChartItem.outflowsMinor / 100)}</strong></span>
            <span className={shownChartItem.netMinor >= 0 ? chartStyles.netPositive : chartStyles.netNegative}><small>Сальдо</small><strong>{shownChartItem.netMinor >= 0 ? "+" : "−"}{compactMoney(Math.abs(shownChartItem.netMinor) / 100)}</strong></span>
          </div> : null}
          <div className={chartStyles.lineChart} onMouseLeave={() => setActiveChartIndex(null)} role="group" aria-label="График поступлений и списаний по месяцам">
            <svg viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`} role="img" aria-label="Фактическая динамика поступлений и списаний из ОДДС">
              <defs><linearGradient id="cashflow-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b56f5" stopOpacity=".17" /><stop offset="100%" stopColor="#5b56f5" stopOpacity="0" /></linearGradient></defs>
              {chartGeometry.ticks.map((tick, index) => {
                const y = chartGeometry.top + index * (chartGeometry.plotHeight / 4);
                return <g key={tick}><line x1={chartGeometry.left} y1={y} x2={chartGeometry.width - chartGeometry.right} y2={y} className={chartStyles.gridLine} /><text x={chartGeometry.left - 8} y={y + 3} textAnchor="end" className={chartStyles.yLabel}>{chartTick(tick)}</text></g>;
              })}
              {chartData.map((item, index) => <line key={item.period} x1={chartGeometry.receipts[index].x} y1={chartGeometry.top} x2={chartGeometry.receipts[index].x} y2={chartGeometry.height - chartGeometry.bottom} className={chartStyles.verticalGrid} />)}
              <path d={chartGeometry.areaPath} className={chartStyles.inArea} />
              <path d={chartGeometry.outflowsPath} className={chartStyles.outLine} />
              <path d={chartGeometry.receiptsPath} className={chartStyles.inLine} />
              {chartGeometry.receipts.map((point, index) => <g key={chartData[index].period}>
                <circle cx={point.x} cy={point.y} r={shownChartIndex === index ? 4 : 2.7} className={chartStyles.inPoint} />
                <circle cx={chartGeometry.outflows[index].x} cy={chartGeometry.outflows[index].y} r={shownChartIndex === index ? 4 : 2.7} className={chartStyles.outPoint} />
              </g>)}
              {activeChartIndex !== null && shownChartPoint ? <line x1={shownChartPoint.x} y1={chartGeometry.top} x2={shownChartPoint.x} y2={chartGeometry.height - chartGeometry.bottom} className={chartStyles.crosshair} /> : null}
              {chartData.map((item, index) => <text key={`${item.period}-label`} x={chartGeometry.receipts[index].x} y={chartGeometry.height - 8} textAnchor="middle" className={chartStyles.xLabel}>{monthLabel(item.period)}</text>)}
            </svg>
            <div className={chartStyles.chartHitGrid} style={{ left: `${(chartGeometry.left / chartGeometry.width) * 100}%`, right: `${(chartGeometry.right / chartGeometry.width) * 100}%` }}>
              {chartData.map((item, index) => <button key={item.period} type="button" aria-label={`${monthLabel(item.period, "long")}: открыть операции`} onMouseEnter={() => setActiveChartIndex(index)} onFocus={() => setActiveChartIndex(index)} onClick={() => navigate("finance")} />)}
            </div>
            {activeChartIndex !== null && shownChartItem && shownChartPoint ? <div className={chartStyles.chartTooltip} style={{ left: `${(shownChartPoint.x / chartGeometry.width) * 100}%` }}><strong>{monthLabel(shownChartItem.period, "long")}</strong><span>Факт ОДДС · нажмите для детализации</span></div> : null}
          </div>
        </article>

        <article className={styles.panel}>
          <header><strong>Ближайшие контрольные точки</strong><button onClick={() => navigate("projects")}>Календарь</button></header>
          <div className={styles.eventList}>
            <button onClick={() => navigate("finance")}><time>СЕГОДНЯ</time><span><strong>Проверить свежесть реестра оплат</strong><small>Финансы · источник XLSX</small></span></button>
            <button onClick={() => navigate("integrations")}><time>СЛЕДОМ</time><span><strong>Подключить банковский источник</strong><small>Интеграции · постоянный домен</small></span></button>
            <button onClick={() => navigate("acceptance")}><time>ПОСЛЕ</time><span><strong>Проверка визуального этапа</strong><small>Представитель Виталия</small></span></button>
          </div>
        </article>
      </div>

      <div className={styles.workArea}>
        <article className={`${styles.panel} ${styles.registry}`}>
          <header><strong>Реестр операций</strong><button onClick={() => navigate("finance")}>Открыть финансы</button></header>
          <div className={styles.registryToolbar}>
            <button type="button">01.04.2026 — 30.04.2026</button>
            <select value={direction} onChange={(event) => setDirection(event.target.value)} aria-label="Тип операции"><option>Все типы</option><option>Поступление</option><option>Списание</option></select>
            <label><AppIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по реестру" /></label>
            <button type="button" onClick={() => navigate("finance")}><AppIcon name="settings" /> Фильтры</button>
          </div>
          <div className={styles.registrySummary}><span>Записей: <strong>{finance?.operations.length ?? 0}</strong></span><span>Поступления: <strong>{summary ? rubles(summary.receiptsMinor) : "—"}</strong></span><span>Списания: <strong>{summary ? rubles(summary.outflowsMinor) : "—"}</strong></span></div>
          {loading ? <div className={styles.registryState}><span className={styles.loader} /><strong>Загружаем реестр…</strong></div> : error ? <div className={styles.registryState}><strong>Реестр временно недоступен</strong><span>{error}</span><button onClick={() => navigate("finance")}>Открыть финансовый раздел</button></div> : operations.length ? (
            <div className={styles.tableWrap}><table><thead><tr><th>Дата</th><th>Контрагент</th><th>Назначение</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{operations.map((operation) => (
              <tr key={operation.id} className={selected?.id === operation.id ? styles.selectedRow : ""} onClick={() => setSelectedId(operation.id)} onDoubleClick={() => showOperation(operation)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") showOperation(operation); }}>
                <td>{formatDate(operation.operationDate)}</td><td><strong>{finance?.entityNames[operation.counterpartyEntityId] ?? operation.counterpartyEntityId}</strong><small>{operation.contractId || "Без договора"}</small></td><td><strong>{operation.category}</strong><small>{operation.reportClass}</small></td><td className={operation.direction === "Поступление" ? styles.income : styles.expense}>{operation.direction === "Поступление" ? "+" : "−"}{rubles(operation.amountMinor)}</td><td><span className={styles.status}>{operation.status}</span></td>
              </tr>
            ))}</tbody></table></div>
          ) : <div className={styles.registryState}><strong>Операций пока нет</strong><span>{sourceOnly ? "Демонстрационные записи удалены. Реестр заполнится после подключения банка." : "В выбранном периоде нет операций."}</span><button onClick={() => navigate("integrations")}>Подключить банк</button></div>}
        </article>

        <aside className={`${styles.panel} ${styles.preview}`} aria-live="polite">
          {selected ? <>
            <header><span><strong>Операция {selected.id}</strong><small>{formatDate(selected.operationDate)}</small></span><button aria-label="Открыть полную карточку" onClick={() => showOperation(selected)}><AppIcon name="more" /></button></header>
            <div className={styles.operationHero}><span>{selected.direction}</span><strong>{selected.direction === "Поступление" ? "+" : "−"}{rubles(selected.amountMinor)}</strong><small>{selected.status} · {selected.dataQuality}</small></div>
            <nav><button className={styles.activeTab}>Детали</button><button onClick={() => showOperation(selected)}>Связи</button><button onClick={() => showOperation(selected)}>Источник</button></nav>
            <dl><div><dt>Источник</dt><dd>{selected.sourceFile}</dd></div><div><dt>Контрагент</dt><dd>{finance?.entityNames[selected.counterpartyEntityId] ?? selected.counterpartyEntityId}</dd></div><div><dt>Назначение</dt><dd>{selected.category}</dd></div><div><dt>Договор</dt><dd>{selected.contractId || "Не указан"}</dd></div><div><dt>Документ</dt><dd>{selected.documentId || "Не указан"}</dd></div></dl>
            <footer><button onClick={() => showOperation(selected)}>Открыть карточку</button><button onClick={() => navigate("finance")}>Все действия</button></footer>
          </> : <div className={styles.previewEmpty}><AppIcon name="finance" /><strong>Выберите операцию</strong><span>Предпросмотр появится здесь, а полная карточка откроется по центру экрана.</span></div>}
        </aside>
      </div>
    </section>
  );
}
