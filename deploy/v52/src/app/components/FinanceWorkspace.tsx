"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";
import { readJsonResponse } from "../../lib/response-json";
import { EntityPanel } from "./RegistryWorkspace";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import { FinanceArticlesWorkspace } from "./FinanceArticlesWorkspace";
import { cashflowBreakdown, operationArticle, type ArticleCatalog } from "../../lib/finance-articles";
import "./FinanceWorkspace.ds.css";

type FinanceOperation = {
  id: string;
  updatedAt: string;
  operationDate: string;
  period: string;
  direction: string;
  amountMinor: number;
  category: string;
  reportClass: string;
  counterpartyEntityId: string;
  contractId: string;
  documentId: string;
  projectEntityId: string;
  legalEntityId: string;
  objectEntityId: string;
  cfrEntityId: string;
  bankOperationRef: string;
  operationKind: string;
  sourceSystem: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRef: string;
  dataQuality: string;
  cashflowArticle: string;
  pnlArticle: string;
  accrualPeriod: string;
  counterpartyLabel: string;
  managementPurpose: string;
  status: string;
  bankDetails: null | {
    operationDate: string;
    direction: string;
    amountMinor: number;
    currency: string;
    documentNumber: string;
    transactionType: string;
    description: string;
    counterpartyName: string;
    counterpartyInn: string;
    counterpartyKpp: string;
    importedAt: string;
  };
};

type FinanceBankAccount = {
  id: string;
  connectionId: string;
  legalEntityId: string;
  maskedAccount: string;
  name: string;
  currency: string;
  status: string;
  balanceMinor: number | null;
  balanceAsOf: string;
  syncedAt: string;
};

type FinanceData = {
  selectedPeriod: string;
  operations: FinanceOperation[];
  articleSuggestions: string[];
  articleCatalog: ArticleCatalog;
  articlePermissions: { canEdit: boolean; canApprove: boolean };
  bankAccounts: FinanceBankAccount[];
  bankSummary: { accountCount: number; accountsWithBalance: number; rubBalanceMinor: number; latestSyncedAt: string };
  accruals: Array<{ id: string; period: string; contour: string; recordsCount: number; accrualMinor: number; paidMinor: number; debtMinor: number; debtCases: number; sourceFile: string; sourceSheet: string; dataQuality: string }>;
  budgets: Array<{ id: string; period: string; line: string; planMinor: number; scenario: string; assumption: string; sourceType: string }>;
  payroll: Array<{ id: string; period: string; amountMinor: number; scope: string; sourceSheet: string; dataQuality: string }>;
  corrections: Array<{ id: number; operationId: string; fieldName: string; beforeValue: string; afterValue: string; reason: string; status: string; createdBy: string; createdAt: string }>;
  issues: Array<{ id: string; title: string; severity: string; sourceA: string; sourceB: string; differenceMinor: number; ownerEntityId: string; status: string; relatedTaskId: number | null; resolution: string }>;
  entityNames: Record<string, string>;
  monthly: Array<{ period: string; receiptsMinor: number; outflowsMinor: number; netMinor: number; revenueMinor: number; expenseMinor: number; resultMinor: number; planRevenueMinor: number; planExpenseMinor: number; planResultMinor: number }>;
  pnlLines: Array<{ category: string; reportClass: string; amountMinor: number; operationIds: string[] }>;
  forecast: { openingBalanceMinor: number; timeline: Array<{ id: string; forecastDate: string; direction: string; amountMinor: number; probability: number; category: string; sourceType: string; assumption: string; linkedEntityId: string; balanceMinor: number; isGap: boolean }>; firstGap: { forecastDate: string; balanceMinor: number } | null };
  ltvPlan: {
    families: Array<{ familyEntityId: string; actualLtvMinor: number; monthlyValueMinor: number; retentionProbability: number; baseNext12MonthsMinor: number; riskAdjustedNext12MonthsMinor: number; forecastLtvMinor: number }>;
    actualLtvMinor: number; averageActualLtvMinor: number; baseNext12MonthsMinor: number; riskAdjustedNext12MonthsMinor: number; forecastLtvMinor: number; method: string;
  };
  summary: { receiptsMinor: number; outflowsMinor: number; netMinor: number; revenueMinor: number; expenseMinor: number; resultMinor: number; planRevenueMinor: number; planExpenseMinor: number; planResultMinor: number; debtMinor: number; openIssues: number };
  checks: Array<{ id: string; title: string; actualMinor: number; expectedMinor: number; differenceMinor: number; status: string; source: string }>;
  sourcePolicy: Record<string, string>;
};

type ClassificationDraft = {
  cashflowArticle: string;
  pnlArticle: string;
  reportClass: string;
  accrualPeriod: string;
  counterpartyLabel: string;
  managementPurpose: string;
  contractId: string;
  documentId: string;
  projectEntityId: string;
  objectEntityId: string;
  cfrEntityId: string;
};

type Tab = "articles" | "register" | "cashflow" | "pnl" | "plan" | "debts" | "reconciliation";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "register", label: "Реестр" },
  { id: "articles", label: "Статьи" },
  { id: "cashflow", label: "ДДС" },
  { id: "pnl", label: "ОПиУ" },
  { id: "plan", label: "План и прогноз" },
  { id: "debts", label: "Начисления и долги" },
  { id: "reconciliation", label: "Сверка" },
];

const financePeriodLabel = (period: string) => humanPeriodLabel(period) || period;

const roleCodes: Record<string, string> = {
  "Собственник": "OWNER",
  "Директор": "DIRECTOR",
  "Финансы": "FINANCE",
  "Педагог": "TEACHER",
  "Представитель Виталия": "REPRESENTATIVE",
};

const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rubles = (minor: number) => rub.format(minor / 100);
const bankMoney = (minor: number | null, currency: string) => {
  if (minor === null) return "Остаток не передан";
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${(minor / 100).toLocaleString("ru-RU")} ${currency}`;
  }
};
const signedRubles = (minor: number) => `${minor > 0 ? "+" : ""}${rubles(minor)}`;
const shortMoney = (minor: number) => `${(minor / 100000000).toFixed(2).replace(".", ",")} млн`;

export function FinanceWorkspace({ role, notify, onTasksChanged, focusId }: { role: string; notify: (message: string) => void; onTasksChanged: () => void; focusId?: string }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("register");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("Все направления");
  const [articleFilter, setArticleFilter] = useState("all");
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<FinanceOperation | null>(null);
  const [linkedEntityId, setLinkedEntityId] = useState<string | null>(null);
  const [classificationDraft, setClassificationDraft] = useState<ClassificationDraft | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionField, setCorrectionField] = useState("amountMinor");
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const operationCloseRef = useRef<HTMLButtonElement>(null);

  const closeOperation = useCallback(() => {
    setLinkedEntityId(null);
    setSelected(null);
  }, []);

  const openOperation = useCallback((operation: FinanceOperation) => {
    setLinkedEntityId(null);
    setCorrectionOpen(false);
    setClassificationDraft({
      cashflowArticle: operation.cashflowArticle || (operation.category === "Не классифицировано" ? "" : operation.category),
      pnlArticle: operation.pnlArticle || "",
      reportClass: operation.reportClass || "Не включено в ОПиУ",
      accrualPeriod: operation.accrualPeriod || operation.period,
      counterpartyLabel: operation.counterpartyLabel || operation.bankDetails?.counterpartyName || "",
      managementPurpose: operation.managementPurpose || operation.bankDetails?.description || "",
      contractId: operation.contractId || "",
      documentId: operation.documentId || "",
      projectEntityId: operation.projectEntityId || "",
      objectEntityId: operation.objectEntityId || "",
      cfrEntityId: operation.cfrEntityId || "",
    });
    setSelected(operation);
  }, []);

  const handleOperationKey = useCallback((event: KeyboardEvent<HTMLTableRowElement>, operation: FinanceOperation) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openOperation(operation);
  }, [openOperation]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/finance?period=${period}`, { cache: "no-store" });
      const payload = await readJsonResponse<FinanceData & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить финансы");
      setData(payload);
      if (payload.selectedPeriod && payload.selectedPeriod !== period) setPeriod(payload.selectedPeriod);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить финансы");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const handle = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    if (!focusId || !data) return;
    const handle = window.setTimeout(() => {
      const operation = data.operations.find((row) => row.id === focusId || row.counterpartyEntityId === focusId || row.contractId === focusId);
      setTab("register");
      setQuery(focusId);
      if (operation?.period && operation.period !== period) setPeriod(operation.period);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [data, focusId, period]);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => operationCloseRef.current?.focus());
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [selected]);

  useEffect(() => {
    if (!selected || linkedEntityId) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeOperation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOperation, linkedEntityId, selected]);

  async function action(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    try {
      const response = await fetch("/api/finance-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roleCodes[role] ?? "", "x-csrf-token": readFinanceCsrfCookie() },
        body: JSON.stringify(body),
      });
      const payload = await readJsonResponse<{ error?: string; reused?: boolean; message?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");
      notify(payload.reused ? "Связанная задача уже существует" : payload.message ?? "Финансовое действие сохранено");
      await load();
      onTasksChanged();
      return true;
    } catch (actionError) {
      notify(actionError instanceof Error ? actionError.message : "Действие не выполнено");
      return false;
    } finally {
      setBusy("");
    }
  }

  const filteredOperations = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase("ru");
    return data.operations.filter((operation) => operation.period === period)
      .filter((operation) => !previewIds || previewIds.includes(operation.id))
      .filter((operation) => articleFilter === "all" || (articleFilter === "unassigned" ? !operationArticle(operation) : operationArticle(operation) === articleFilter.slice(8)))
      .filter((operation) => direction === "Все направления" || operation.direction === direction)
      .filter((operation) => !normalized || [
        operation.id,
        operation.category,
        operation.cashflowArticle,
        operation.pnlArticle,
        operation.counterpartyLabel,
        operation.managementPurpose,
        operation.bankDetails?.counterpartyName ?? "",
        operation.bankDetails?.description ?? "",
        operation.counterpartyEntityId,
        operation.contractId,
        operation.documentId,
        operation.bankOperationRef,
      ].some((value) => value.toLocaleLowerCase("ru").includes(normalized)));
  }, [data, direction, period, query, articleFilter, previewIds]);

  if (loading && !data) return <section className="ahFinanceStatus">Собираем финансовый контур…</section>;
  if (error && !data) return <PageContainer className="ahFinanceDenied"><Card><EmptyState title="Финансовый раздел временно недоступен" description={error} density="compact" action={<Button onClick={() => void load()}>Повторить</Button>} /></Card></PageContainer>;
  if (!data) return null;

  const maxMonthly = Math.max(1, ...data.monthly.flatMap((month) => [month.receiptsMinor, month.outflowsMinor]));
  const operationCorrections = selected ? data.corrections.filter((correction) => correction.operationId === selected.id) : [];
  const periodOptions = [...new Set([period, ...data.monthly.map((month) => month.period)])].sort();
  const linkedEntities = selected ? uniqueLinks([
    { label: counterpartyLabel(selected.counterpartyEntityId), id: selected.counterpartyEntityId },
    { label: "Юрлицо", id: selected.legalEntityId },
    { label: "Объект", id: selected.objectEntityId },
    { label: "Проект", id: selected.projectEntityId },
    { label: "ЦФО", id: selected.cfrEntityId },
  ]) : [];

  async function submitClassification(event: FormEvent) {
    event.preventDefault();
    if (!selected || !classificationDraft) return;
    const saved = await action({
      action: "classifyOperation",
      operationId: selected.id,
      ...classificationDraft,
      expectedUpdatedAt: selected.updatedAt,
      catalogRevision: data?.articleCatalog.revision,
    }, `classify:${selected.id}`);
    if (saved) closeOperation();
  }

  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const saved = await action({ action: "addCorrection", operationId: selected.id, fieldName: correctionField, afterValue: correctionValue, reason: correctionReason }, `correction:${selected.id}`);
    if (saved) {
      setCorrectionOpen(false);
      setCorrectionValue("");
      setCorrectionReason("");
    }
  }

  return (
    <PageContainer className="ahFinancePage">
      <PageHeader
        eyebrow="ДЕНЬГИ · ИСТОЧНИКИ · КОНТРОЛЬ"
        title="Финансы"
        description="От строки ОДДС до статьи, контрагента, договора, документа и ответственного — с честной маркировкой тестовых проекций."
        actions={<Button variant="primary" onClick={() => { setTab("reconciliation"); setSelected(null); }}>Расхождения · {data.summary.openIssues}</Button>}
      />

      <div className="ahFinanceBoundary">
        <strong>ФАКТ · 3 ТАБЛИЦЫ</strong>
        <span>ОДДС, начисления и зарплатные агрегаты прочитаны без изменения оригиналов.</span>
        <b>ПРОЕКЦИЯ</b>
        <span>{data.sourcePolicy.bank}</span>
      </div>

      <label className="ahFinancePeriod ahFinancePeriodMobile">
        <span>Период отчёта</span>
        <select aria-label="Месяц финансового отчёта" value={period} onChange={(event) => setPeriod(event.target.value)}>
          {periodOptions.map((value) => <option key={value} value={value}>{financePeriodLabel(value)}</option>)}
        </select>
      </label>

      <div className="ahFinanceKpis">
        <KpiCard label={`Поступления · ${financePeriodLabel(period)}`} value={rubles(data.summary.receiptsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />
        <KpiCard label="Списания" value={rubles(data.summary.outflowsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />
        <KpiCard label="Чистый денежный поток" value={signedRubles(data.summary.netMinor)} note={data.checks.length ? "контрольная модель рассчитана" : "проверок пока нет"} onClick={() => setTab("cashflow")} className={data.summary.netMinor < 0 ? "ahFinanceKpiRisk" : undefined} />
        <KpiCard label="Задолженность по оплатам" value={rubles(data.summary.debtMinor)} note={`обезличено · ${data.accruals.reduce((sum, row) => sum + row.debtCases, 0)} случаев`} onClick={() => setTab("debts")} className={data.summary.debtMinor > 0 ? "ahFinanceKpiWarning" : undefined} />
      </div>

      {data.bankAccounts.length ? (
        <section className="finance-panel ahFinanceBankPanel" data-d066-marker="D066_TOCHKA_FINANCE_BANK_VISIBILITY">
          <div className="finance-panel-head">
            <div><p>Банк · факт</p><h2>Счета Точки и текущие остатки</h2></div>
            <span className="source-pill">{data.bankSummary.accountsWithBalance ? `${rubles(data.bankSummary.rubBalanceMinor)} · ${data.bankAccounts.length} счетов` : `${data.bankAccounts.length} счетов · остатки не переданы`}</span>
          </div>
          <div className="ahFinanceBankGrid">
            {data.bankAccounts.map((account) => (
              <article key={account.id} className="ahFinanceBankAccount">
                <div><strong>{account.name || "Расчётный счёт"}</strong><span>{account.maskedAccount} · {account.currency}</span></div>
                <b>{bankMoney(account.balanceMinor, account.currency)}</b>
                <small>{account.balanceAsOf ? `Остаток на ${new Date(`${account.balanceAsOf}T00:00:00Z`).toLocaleDateString("ru-RU")}` : "Дата остатка не передана"}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="ahFinanceNavigation">
        <div className="ahFinanceTabs"><Tabs items={tabs.map((item) => ({ id: item.id, label: item.id === "reconciliation" ? <>{item.label}{data.summary.openIssues ? <b>{data.summary.openIssues}</b> : null}</> : item.label }))} value={tab} onChange={setTab} ariaLabel="Разделы финансов" /></div>
        <label className="ahFinancePeriod ahFinancePeriodDesktop"><span>Период</span><select aria-label="Месяц финансового отчёта" value={period} onChange={(event) => setPeriod(event.target.value)}>{periodOptions.map((value) => <option key={value} value={value}>{financePeriodLabel(value)}</option>)}</select></label>
      </div>

      {tab === "articles" ? <FinanceArticlesWorkspace key={`${period}:${data.articleCatalog.revision}`} catalog={data.articleCatalog} permissions={data.articlePermissions} operations={data.operations} period={period} busy={Boolean(busy)} action={action} showOperations={(ids) => { setPreviewIds(ids); setArticleFilter("unassigned"); setDirection("Все направления"); setQuery(""); setTab("register"); }} /> : null}
      {tab === "register" ? (
        <div className="finance-panel">
          <div className="finance-panel-head"><div><p>Ежедневный реестр</p><h2>Операции периода</h2></div><span className="finance-count">{filteredOperations.length} записей</span></div>
          <div className="finance-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Контрагент, назначение, статья, договор…" aria-label="Поиск финансовых операций" /><select value={direction} onChange={(event) => setDirection(event.target.value)}><option>Все направления</option><option>Поступление</option><option>Списание</option></select><select aria-label="Разнесение по статье" value={articleFilter} onChange={(event) => { setArticleFilter(event.target.value); setPreviewIds(null); }}><option value="all">Все статьи</option><option value="unassigned">Без статьи · {data.operations.filter(op => op.period === period && !operationArticle(op)).length}</option>{[...new Set(data.operations.filter(op => op.period === period).map(operationArticle).filter(Boolean))].sort().map(name => <option key={name} value={`article:${name}`}>{name}</option>)}</select>{previewIds ? <Button onClick={() => setPreviewIds(null)}>Сбросить подбор</Button> : null}<span>Банковский факт неизменяем · разнесение хранится отдельно</span></div>
          {filteredOperations.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Операция</th><th>Дата</th><th>Направление</th><th>Статья</th><th>Контрагент</th><th>Сумма</th><th>Контроль</th></tr></thead><tbody>
            {filteredOperations.map((operation) => <tr key={operation.id} tabIndex={0} aria-label={`Открыть ${recordLabel("операцию", operation.id)}`} onClick={() => openOperation(operation)} onKeyDown={(event) => handleOperationKey(event, operation)}><td><strong>{operation.bankDetails?.counterpartyName || operation.counterpartyLabel || recordLabel("Операция", operation.id)}</strong><small>{operation.bankDetails?.description || operation.sourceFile || "Финансовый реестр"}</small></td><td>{new Date(`${operation.operationDate}T00:00:00Z`).toLocaleDateString("ru-RU")}</td><td><span className={`direction-chip ${operation.direction === "Поступление" ? "in" : "out"}`}>{operation.direction}</span></td><td><strong>{operation.cashflowArticle || operation.category}</strong><small>{operation.pnlArticle ? `ОПиУ: ${operation.pnlArticle}` : operation.reportClass}</small></td><td><strong>{operation.counterpartyLabel || operation.bankDetails?.counterpartyName || "Не указан"}</strong><small>{operation.bankDetails?.counterpartyInn ? `ИНН ${operation.bankDetails.counterpartyInn}` : operation.contractId ? recordLabel("Договор", operation.contractId) : "Без привязки"}</small></td><td className="money-cell">{operation.direction === "Поступление" ? "+" : "−"}{rubles(operation.amountMinor)}</td><td><span className={operation.status === "Разнесено" ? "quality-ok" : "quality-warn"}>{operation.status}</span></td></tr>)}
          </tbody></table></div> : data.operations.some(op => op.period === period) ? <EmptyState title="Нет операций по выбранным условиям" description="Измените фильтры или выберите другой месяц." density="compact" /> : <EmptyState title="Операций за период пока нет" description="Реестр заполнится только после загрузки и сохранения подтверждённого финансового источника." density="compact" />}
        </div>
      ) : null}

      {tab === "cashflow" ? <section className="finance-panel"><h2>ДДС по статьям · {financePeriodLabel(period)}</h2><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Статья</th><th>Операций</th><th>Поступления</th><th>Списания</th></tr></thead><tbody>{cashflowBreakdown(data.operations, period).map(row => <tr key={row.article}><td><Button onClick={() => { setArticleFilter(row.article === "Без статьи" ? "unassigned" : `article:${row.article}`); setPreviewIds(null); setQuery(""); setDirection("Все направления"); setTab("register"); }}>{row.article}</Button></td><td>{row.count}</td><td>{rubles(row.receiptsMinor)}</td><td>{rubles(row.outflowsMinor)}</td></tr>)}</tbody><tfoot><tr><th>Итого</th><td>{data.operations.filter(op => op.period === period).length}</td><td>{rubles(data.summary.receiptsMinor)}</td><td>{rubles(data.summary.outflowsMinor)}</td></tr></tfoot></table></div></section> : null}
      {tab === "cashflow" ? (
        <div className="finance-two-column">
          <article className="finance-panel cashflow-card"><div className="finance-panel-head"><div><p>Движение денег</p><h2>Поступления и списания</h2></div><span className="source-pill">Исходные таблицы · факт</span></div>
            <div className="finance-bars">{data.monthly.map((month) => <button key={month.period} className={month.period === period ? "active" : ""} onClick={() => setPeriod(month.period)}><div><i className="income-bar" style={{ height: `${Math.max(10, month.receiptsMinor / maxMonthly * 100)}%` }} /><i className="expense-bar" style={{ height: `${Math.max(10, month.outflowsMinor / maxMonthly * 100)}%` }} /></div><span>{financePeriodLabel(month.period).split(" ")[0]}</span><small className={month.netMinor >= 0 ? "positive-text" : "negative-text"}>{signedRubles(month.netMinor)}</small></button>)}</div>
            <div className="finance-legend"><span><i className="income-dot" />Поступления</span><span><i className="expense-dot" />Списания</span></div>
          </article>
          <article className="finance-panel checks-card"><div className="finance-panel-head"><div><p>Контроль модели</p><h2>Сверка с ОДДС</h2></div><strong className={data.checks.length && data.checks.every((check) => check.status === "OK") ? "model-pass" : "model-fail"}>{data.checks.length ? data.checks.every((check) => check.status === "OK") ? "ПРОЙДЕНО" : "ЕСТЬ ОТКЛОНЕНИЯ" : "НЕТ ПРОВЕРОК"}</strong></div>{data.checks.length ? <div className="check-list">{data.checks.map((check) => <button key={check.id} onClick={() => setTab("register")}><span className={check.status === "OK" ? "ok" : "fail"}>{check.status === "OK" ? "Сверено" : "Расхождение"}</span><div><strong>{humanTechnicalText(check.title)}</strong><small>Исходная таблица проверена</small></div><em>{check.differenceMinor === 0 ? "Разница 0 ₽" : signedRubles(check.differenceMinor)}</em></button>)}</div> : <EmptyState title="Сверки пока не запускались" description="Контроль появится после загрузки подтверждённых строк ОДДС." density="compact" />}</article>
          <article className="finance-panel monthly-detail"><div className="finance-panel-head"><div><p>{financePeriodLabel(period)}</p><h2>Структура денежного потока</h2></div><button onClick={() => setTab("register")}>Открыть реестр →</button></div><div className="money-waterfall"><div><span>Поступления</span><strong>{rubles(data.summary.receiptsMinor)}</strong></div><i>−</i><div><span>Списания</span><strong>{rubles(data.summary.outflowsMinor)}</strong></div><i>=</i><div className={data.summary.netMinor >= 0 ? "positive" : "negative"}><span>Чистый поток</span><strong>{signedRubles(data.summary.netMinor)}</strong></div></div></article>
        </div>
      ) : null}

      {tab === "pnl" ? (
        <div className="finance-two-column pnl-layout">
          <article className="finance-panel pnl-summary"><div className="finance-panel-head"><div><p>Рабочая управленческая проекция</p><h2>ОПиУ · {financePeriodLabel(period)}</h2></div><span className="projection-pill">НЕ УТВЕРЖДЁННЫЙ ФАКТ</span></div><div className="pnl-warning"><strong>Отдельный источник ОПиУ не предоставлен</strong><span>Результат рассчитан из классифицированных денежных статей ОДДС. Финансирование исключено, но начислительный метод пока не подтверждён.</span></div><div className="pnl-bridge"><div><span>Доходы</span><strong>{rubles(data.summary.revenueMinor)}</strong></div><div><span>Операционные расходы</span><strong>−{rubles(data.summary.expenseMinor)}</strong></div><div className={data.summary.resultMinor >= 0 ? "positive" : "negative"}><span>Рабочий результат</span><strong>{signedRubles(data.summary.resultMinor)}</strong></div></div></article>
          <article className="finance-panel pnl-lines"><div className="finance-panel-head"><div><p>Расшифровка</p><h2>Статьи результата</h2></div><span>Нажмите на строку</span></div><div>{data.pnlLines.filter((line) => line.reportClass !== "Не включено в ОПиУ").map((line) => <button key={`${line.reportClass}-${line.category}`} onClick={() => { const operation = data.operations.find((item) => item.id === line.operationIds[0]); if (operation) openOperation(operation); }}><span><strong>{line.category}</strong><small>{line.reportClass} · {line.operationIds.length} операция</small></span><em className={line.reportClass === "Доходы ОПиУ" ? "income" : line.reportClass === "Расходы ОПиУ" ? "expense" : "finance"}>{line.reportClass === "Расходы ОПиУ" ? "−" : "+"}{rubles(line.amountMinor)}</em></button>)}</div></article>
        </div>
      ) : null}

      {tab === "plan" ? (
        <div className="finance-two-column plan-layout">
          <article className="finance-panel"><div className="finance-panel-head"><div><p>Базовый сценарий</p><h2>План‑факт ОПиУ</h2></div><span className="projection-pill">ТЕСТОВЫЙ БЮДЖЕТ</span></div><div className="plan-table"><div className="plan-head"><span>Период</span><span>Доходы факт / план</span><span>Расходы факт / план</span><span>Результат</span></div>{data.monthly.map((month) => <button key={month.period} className={month.period === period ? "active" : ""} onClick={() => setPeriod(month.period)}><strong>{financePeriodLabel(month.period).split(" ")[0]}</strong><span>{shortMoney(month.revenueMinor)} / {shortMoney(month.planRevenueMinor)}</span><span>{shortMoney(month.expenseMinor)} / {shortMoney(month.planExpenseMinor)}</span><em className={month.resultMinor - month.planResultMinor >= 0 ? "positive-text" : "negative-text"}>{signedRubles(month.resultMinor - month.planResultMinor)}</em></button>)}</div><p className="assumption-note">Допущение: план создан только для проверки механики. Утверждённая финансовая модель 2026/27 в источниках отсутствует.</p></article>
          <article className="finance-panel forecast-card"><div className="finance-panel-head"><div><p>Платёжный календарь</p><h2>Прогноз ликвидности</h2></div><span>Старт {rubles(data.forecast.openingBalanceMinor)}</span></div>{data.forecast.firstGap ? <div className="cash-gap"><span>!</span><div><strong>Кассовый разрыв {new Date(`${data.forecast.firstGap.forecastDate}T00:00:00Z`).toLocaleDateString("ru-RU")}</strong><small>Прогнозный остаток {rubles(data.forecast.firstGap.balanceMinor)}</small></div><button disabled={busy === "gap-task"} onClick={() => void action({ action: "createIssueTask", issueId: "FIN-RISK-001" }, "gap-task")}>Создать задачу</button></div> : null}<div className="forecast-list">{data.forecast.timeline.map((item) => <div className={item.isGap ? "gap" : ""} key={item.id}><time>{new Date(`${item.forecastDate}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}</time><span><strong>{item.category}</strong><small>{forecastSourceLabel(item.sourceType)} · вероятность {item.probability}%</small></span><em className={item.direction === "Поступление" ? "income" : "expense"}>{item.direction === "Поступление" ? "+" : "−"}{rubles(item.amountMinor)}</em><b>{rubles(item.balanceMinor)}</b></div>)}</div></article>
          <article className="finance-panel ltv-finance-card"><div className="finance-panel-head"><div><p>Клиентская экономика</p><h2>Ценность семьи в финансовом плане</h2></div><span className="projection-pill">ФАКТ + СЦЕНАРИЙ</span></div><div className="ltv-finance-kpis"><div><span>Подтверждённая выручка</span><strong>{rubles(data.ltvPlan.actualLtvMinor)}</strong></div><div><span>Средний на семью</span><strong>{rubles(data.ltvPlan.averageActualLtvMinor)}</strong></div><div><span>База 12 месяцев</span><strong>{rubles(data.ltvPlan.baseNext12MonthsMinor)}</strong></div><div><span>12 месяцев с риском</span><strong>{rubles(data.ltvPlan.riskAdjustedNext12MonthsMinor)}</strong></div><div><span>Факт + прогноз</span><strong>{rubles(data.ltvPlan.forecastLtvMinor)}</strong></div></div><div className="ltv-finance-table"><div className="ltv-finance-head"><span>Семья</span><span>Факт</span><span>В месяц</span><span>Удержание</span><span>Прогноз 12 мес.</span></div>{data.ltvPlan.families.map((row) => <div key={row.familyEntityId}><strong>{data.entityNames[row.familyEntityId] ?? recordLabel("Семья", row.familyEntityId)}</strong><span>{rubles(row.actualLtvMinor)}</span><span>{rubles(row.monthlyValueMinor)}</span><span>{row.retentionProbability}%</span><span>{rubles(row.riskAdjustedNext12MonthsMinor)}</span></div>)}</div><p className="ltv-finance-method"><strong>Методика:</strong> {humanTechnicalText(data.ltvPlan.method)}</p></article>
        </div>
      ) : null}

      {tab === "debts" ? (
        <div className="finance-two-column debt-layout">
          <article className="finance-panel"><div className="finance-panel-head"><div><p>Взаиморасчёты</p><h2>Начисления и задолженности</h2></div><span className="source-pill">Таблица · обезличено</span></div><div className="accrual-list">{data.accruals.map((row) => <article key={row.id}><header><span>{row.contour.slice(0, 2).toLocaleUpperCase("ru")}</span><div><strong>{row.contour}</strong><small>{humanPeriodLabel(row.period)} · {row.recordsCount} записей</small></div><em>{rubles(row.debtMinor)}</em></header><div><span><small>Начислено</small><strong>{rubles(row.accrualMinor)}</strong></span><span><small>Оплачено</small><strong>{rubles(row.paidMinor)}</strong></span><span><small>Долг</small><strong>{row.debtCases} случаев</strong></span></div><footer>Исходная таблица · {humanTechnicalText(row.dataQuality)}</footer></article>)}</div></article>
          <article className="finance-panel payroll-card"><div className="finance-panel-head"><div><p>Зарплаты</p><h2>Свод начислений</h2></div><span className="source-pill">22 листа</span></div><div className="payroll-trend">{data.payroll.map((row) => { const max = Math.max(...data.payroll.map((item) => item.amountMinor)); return <div key={row.id}><span>{humanPeriodLabel(row.period)}</span><i><b style={{ width: `${row.amountMinor / max * 100}%` }} /></i><strong>{rubles(row.amountMinor)}</strong><small>Обезличенный итог</small></div>; })}</div><div className="privacy-note"><strong>Персональные начисления не перенесены</strong><span>Карточки сотрудников будут связаны после сверки кадрового реестра; сейчас доступен только общий итог.</span></div></article>
        </div>
      ) : null}

      {tab === "reconciliation" ? (
        <div className="finance-two-column reconciliation-layout">
          <article className="finance-panel"><div className="finance-panel-head"><div><p>Очередь контроля</p><h2>Расхождения и ограничения</h2></div><span>{data.issues.length} сигналов</span></div><div className="issue-list">{data.issues.map((issue) => <article key={issue.id} className={issue.status === "Закрыто" ? "resolved" : ""}><header><span className={`severity ${issue.severity === "Высокий" ? "high" : "medium"}`}>{issue.severity}</span><strong>{recordLabel("Сверка", issue.id)}</strong><em>{issue.status}</em></header><h3>{humanTechnicalText(issue.title)}</h3><div className="issue-sources"><span>{humanTechnicalText(issue.sourceA)}</span><i>↔</i><span>{humanTechnicalText(issue.sourceB)}</span></div>{issue.differenceMinor ? <p>Контрольная сумма: <strong>{signedRubles(issue.differenceMinor)}</strong></p> : null}<footer>{issue.relatedTaskId ? <button onClick={() => notify(`Связана ${taskRecordLabel(issue.relatedTaskId).toLocaleLowerCase("ru")}`)}>{taskRecordLabel(issue.relatedTaskId)}</button> : <button disabled={busy === issue.id} onClick={() => void action({ action: "createIssueTask", issueId: issue.id }, issue.id)}>+ Создать задачу</button>}{issue.status === "В работе" ? <form onSubmit={(event) => { event.preventDefault(); void action({ action: "resolveIssue", issueId: issue.id, resolution: resolution[issue.id] ?? "" }, `resolve:${issue.id}`); }}><input value={resolution[issue.id] ?? ""} onChange={(event) => setResolution((current) => ({ ...current, [issue.id]: event.target.value }))} placeholder="Доказательство устранения" /><button disabled={busy === `resolve:${issue.id}`}>Закрыть</button></form> : null}</footer>{issue.resolution ? <small className="resolution">Решение: {humanTechnicalText(issue.resolution)}</small> : null}</article>)}</div></article>
          <article className="finance-panel corrections-card"><div className="finance-panel-head"><div><p>История без перезаписи</p><h2>Журнал корректировок</h2></div><span>{data.corrections.length}</span></div>{data.corrections.length ? <div className="correction-list">{data.corrections.map((correction) => <article key={correction.id}><header><strong>{recordLabel("Корректировка", correction.id)}</strong><span>{correction.status}</span></header><p>{recordLabel("Операция", correction.operationId)} · {correction.fieldName === "amountMinor" ? "Сумма" : "Статья"}</p><small>{humanTechnicalText(correction.reason)}</small><footer>Ответственный пользователь · {new Date(`${correction.createdAt.replace(" ", "T")}Z`).toLocaleString("ru-RU")}</footer></article>)}</div> : <div className="finance-empty"><span>↺</span><strong>Корректировок пока нет</strong><p>Исходная операция никогда не перезаписывается. Новое значение добавляется отдельной записью аудита.</p><button onClick={() => setTab("register")}>Выбрать операцию</button></div>}</article>
        </div>
      ) : null}

      {selected ? createPortal(<div className="finance-drawer-layer"><button className="drawer-scrim" aria-label="Закрыть карточку операции" onClick={closeOperation} /><aside className="finance-drawer" role="dialog" aria-modal="true" aria-labelledby={`operation-title-${selected.id}`}><header><div><span>{selected.direction}</span><h2 id={`operation-title-${selected.id}`}>{selected.category}</h2><p>{recordLabel("Операция", selected.id)} · {financePeriodLabel(selected.period)}</p></div><button ref={operationCloseRef} onClick={closeOperation} aria-label="Закрыть">×</button></header><div className="finance-drawer-body"><div className="operation-amount"><span>Сумма операции</span><strong>{selected.direction === "Поступление" ? "+" : "−"}{rubles(selected.amountMinor)}</strong><small>{selected.status} · {operationKindLabel(selected.operationKind)}</small></div><div className="bank-projection-note"><strong>{selected.sourceSystem === "BANK_TOCHKA_API" ? "Подтверждённая операция Точки" : "Банковская выписка пока не подтверждена"}</strong><span>{selected.sourceSystem === "BANK_TOCHKA_API" ? "Операция получена напрямую из банковской выписки только для чтения. Исходная сумма не перезаписывается." : "Банковская проекция. Реальная выписка для этой записи не подключена."}</span></div><section className="operation-links lineage-section"><p>Связанные данные</p><span className="operation-links-note">Открываются поверх операции — контекст реестра не теряется</span><div className="operation-link-grid">{linkedEntities.map((link) => <button key={link.id} onClick={() => setLinkedEntityId(link.id)}><small>{link.label}</small><strong>{data.entityNames[link.id] ?? recordLabel(link.label, link.id)}</strong><span>Открыть →</span></button>)}</div></section><section className="lineage-section"><p>Доказательная цепочка</p><div className="lineage-grid"><article><small>1 · Источник</small><strong>{selected.sourceFile || "Финансовый реестр"}</strong><span>Исходная строка сохранена для проверки</span></article><i>→</i><article><small>2 · Операция</small><strong>{recordLabel("Операция", selected.id)}</strong><span>{selected.operationDate}</span></article><i>→</i><article><small>3 · Договор</small><strong>{selected.contractId ? recordLabel("Договор", selected.contractId) : "Не указан"}</strong><span>связь сохранённого контура</span></article><i>→</i><article><small>4 · Контрагент</small><strong>{data.entityNames[selected.counterpartyEntityId] ?? recordLabel(counterpartyLabel(selected.counterpartyEntityId), selected.counterpartyEntityId)}</strong><span>карточка контрагента</span></article><i>→</i><article><small>5 · Статья / период</small><strong>{selected.category}</strong><span>{financePeriodLabel(selected.period)} · {selected.reportClass}</span></article><i>→</i><article><small>6 · Документ</small><strong>{selected.documentId ? recordLabel("Документ", selected.documentId) : "Не указан"}</strong><span>{humanTechnicalText(selected.dataQuality)}</span></article></div></section><section className="operation-dimensions"><p>Аналитики</p><dl><div><dt>Юрлицо</dt><dd>{data.entityNames[selected.legalEntityId] ?? "Не указано"}</dd></div><div><dt>Объект</dt><dd>{data.entityNames[selected.objectEntityId] ?? "Не указан"}</dd></div><div><dt>Центр ответственности</dt><dd>{data.entityNames[selected.cfrEntityId] ?? "Не указан"}</dd></div><div><dt>Проект</dt><dd>{data.entityNames[selected.projectEntityId] ?? "Не указан"}</dd></div></dl></section><section className="operation-classification" data-d069-marker="D069_FINANCE_OPERATION_ALLOCATION">
    <div className="operation-classification-head"><div><p>Разнесение операции</p><span>Банковская дата и сумма не меняются. Эти поля формируют управленческие ДДС и ОПиУ.</span></div><b>{selected.status}</b></div>
    {classificationDraft && data.articlePermissions.canEdit ? <form className="operation-classification-form" onSubmit={submitClassification}>
      <label><span>Кто</span><input value={classificationDraft.counterpartyLabel} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, counterpartyLabel: event.target.value }) : current)} placeholder={selected.bankDetails?.counterpartyName || "Контрагент / плательщик"} /></label>
      <label><span>За что</span><input value={classificationDraft.managementPurpose} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, managementPurpose: event.target.value }) : current)} placeholder={selected.bankDetails?.description || "Управленческий смысл операции"} /></label>
      <label><span>Статья ДДС</span><select required value={classificationDraft.cashflowArticle} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, cashflowArticle: event.target.value }) : current)}><option value="">Выберите утверждённую статью</option>{classificationOptions(data.articleCatalog, "cashflow", selected.direction, operationArticle(selected)).map(article => <option key={article} value={article}>{article}</option>)}</select></label>
      <label><span>Класс ОПиУ</span><select value={classificationDraft.reportClass} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, reportClass: event.target.value }) : current)}><option>Доходы ОПиУ</option><option>Расходы ОПиУ</option><option>Финансирование</option><option>Не включено в ОПиУ</option></select></label>
      <label><span>Статья ОПиУ</span><select value={classificationDraft.pnlArticle} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, pnlArticle: event.target.value }) : current)}><option value="">Не выбрана</option>{classificationOptions(data.articleCatalog, "pnl", classificationDraft.reportClass === "Доходы ОПиУ" ? "Поступление" : "Списание", selected.pnlArticle).map(article => <option key={article} value={article}>{article}</option>)}</select></label>
      <label><span>Период ОПиУ</span><input type="month" value={classificationDraft.accrualPeriod} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, accrualPeriod: event.target.value }) : current)} /></label>
      <label><span>Договор</span><input value={classificationDraft.contractId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, contractId: event.target.value }) : current)} placeholder="Необязательно" /></label>
      <label><span>Документ</span><input value={classificationDraft.documentId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, documentId: event.target.value }) : current)} placeholder="Необязательно" /></label>
      <label><span>Объект / филиал</span><input value={classificationDraft.objectEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, objectEntityId: event.target.value }) : current)} placeholder="Можно заполнить позже" /></label>
      <label><span>Проект</span><input value={classificationDraft.projectEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, projectEntityId: event.target.value }) : current)} placeholder="Можно заполнить позже" /></label>
      <label><span>ЦФО</span><input value={classificationDraft.cfrEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, cfrEntityId: event.target.value }) : current)} placeholder="Можно заполнить позже" /></label>
      <div className="operation-classification-actions"><button type="button" onClick={() => setClassificationDraft((current) => current ? ({ ...current, reportClass: "Не включено в ОПиУ", pnlArticle: "", accrualPeriod: "" }) : current)}>Не включать в ОПиУ</button><button disabled={Boolean(busy)}>Сохранить разнесение</button></div>
      <p>Новые статьи добавляются и утверждаются во вкладке «Статьи». Старые назначения сохраняются.</p>
    </form> : null}
  </section><section className="operation-corrections"><div><p>Корректировки</p><button onClick={() => setCorrectionOpen((current) => !current)}>+ Предложить</button></div>{operationCorrections.map((correction) => <article key={correction.id}><strong>{recordLabel("Корректировка", correction.id)} · {correction.status}</strong><span>{humanTechnicalText(correction.reason)}</span></article>)}{!operationCorrections.length ? <small>Нет корректировок. Исходная операция сохранена без изменений.</small> : null}{correctionOpen ? <form onSubmit={submitCorrection}><label><span>Поле</span><select value={correctionField} onChange={(event) => setCorrectionField(event.target.value)}><option value="amountMinor">Сумма, ₽</option><option value="category">Статья</option></select></label><label><span>Новое значение</span><input value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)} placeholder={correctionField === "amountMinor" ? "Например, 502000" : "Новая статья"} /></label><label className="wide"><span>Причина и доказательство</span><textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Почему требуется корректировка; какой документ это подтверждает" /></label><div className="wide"><button type="button" onClick={() => setCorrectionOpen(false)}>Отмена</button><button disabled={busy === `correction:${selected.id}`}>Сохранить отдельно от исходника</button></div></form> : null}</section></div></aside></div>, document.body) : null}
      {linkedEntityId ? <EntityPanel key={linkedEntityId} entityId={linkedEntityId} close={() => setLinkedEntityId(null)} notify={notify} onNavigate={setLinkedEntityId} readOnly backLabel="К операции" initialTab="overview" /> : null}
    </PageContainer>
  );
}

function counterpartyLabel(id: string) {
  if (id.startsWith("FAM-")) return "Семья";
  if (id.startsWith("EMP-")) return "Сотрудники";
  if (id.startsWith("SUP-")) return "Поставщик";
  return "Контрагент";
}

function operationKindLabel(value: string) {
  if (value === "XLSX_AGGREGATE") return "Факт из исходной таблицы";
  if (value === "BANK_STATEMENT") return "Факт из банковской выписки";
  if (value === "SYNTHETIC_TRACE") return "Тестовая связанная запись";
  return humanTechnicalText(value);
}

function forecastSourceLabel(value: string) {
  if (value.includes("SYNTHETIC")) return "Тестовое допущение";
  if (value.includes("MANUAL")) return "Ручной план";
  return humanTechnicalText(value);
}

function uniqueLinks(links: Array<{ label: string; id: string }>) {
  const seen = new Set<string>();
  return links.filter((link) => link.id && !seen.has(link.id) && seen.add(link.id));
}

function classificationOptions(catalog: ArticleCatalog, report: "cashflow" | "pnl", direction: string, previous: string) {
  return [...new Set([...catalog.articles.filter(a => a.report === report && a.direction === direction && a.status === "active").map(a => a.name), ...(previous ? [previous] : [])])].sort((a, b) => a.localeCompare(b, "ru"));
}
function readFinanceCsrfCookie() {
  const value = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("__Host-arthello_csrf="));
  try { return value ? decodeURIComponent(value.slice("__Host-arthello_csrf=".length)) : ""; } catch { return ""; }
}
