"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";
import { readJsonResponse } from "../../lib/response-json";
import { Button, Card, EmptyState, PageContainer, PageHeader, Tabs } from "./design-system";
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
  providerAccountId: string;
  provider: string;
  legalEntityName: string;
  maskedAccount: string;
  name: string;
  currency: string;
  status: string;
  balanceMinor: number | null;
  balanceAsOf: string;
  syncedAt: string;
};

type FinanceBankOperation = {
  id: string;
  financialOperationId: string;
  provider: string;
  accountName: string;
  maskedAccount: string;
  legalEntityName: string;
  operationDate: string;
  direction: string;
  amountMinor: number;
  currency: string;
  status: string;
  documentNumber: string;
  transactionType: string;
  description: string;
  counterpartyName: string;
  importedAt: string;
  allocated: boolean;
};

type FinanceOperationComment = {
  id: number;
  targetType: "bank" | "management";
  operationId: string;
  body: string;
  author: string;
  createdAt: string;
};

type FinanceBankSynchronization = {
  id: string;
  system: string;
  status: string;
  enabled: boolean;
  verified: boolean;
  lastSuccessAt: string;
  nextSyncAt: string;
  receivedCount: number;
  acceptedCount: number;
  errorCount: number;
};

type FinanceData = {
  selectedPeriod: string;
  branch: { id: string; name: string };
  accountingStartDate: string;
  operations: FinanceOperation[];
  reviewOperations: FinanceOperation[];
  articleSuggestions: string[];
  articleCatalog: ArticleCatalog;
  articlePermissions: { canEdit: boolean; canApprove: boolean };
  classificationPermissions: { canEdit: boolean; canReviewUnassigned: boolean };
  bankAccounts: FinanceBankAccount[];
  bankOperations: FinanceBankOperation[];
  operationComments: FinanceOperationComment[];
  bankMonthly: Array<{ period: string; transactionCount: number; incomingMinor: number; outgoingMinor: number; netMinor: number }>;
  bankSynchronization: FinanceBankSynchronization[];
  bankSummary: { period: string; transactionCount: number; incomingMinor: number; outgoingMinor: number; netMinor: number; accountCount: number; accountsWithBalance: number; rubBalanceMinor: number; statementCount: number; latestSyncedAt: string };
  bankBoundary: string;
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

type Tab = "bank" | "articles" | "register" | "cashflow" | "pnl" | "plan" | "debts" | "reconciliation";

const tabs: Array<{ id: Tab; label: string; ariaLabel?: string }> = [
  { id: "bank", label: "Банк" },
  { id: "register", label: "Разнесение" },
  { id: "articles", label: "Статьи" },
  { id: "cashflow", label: "ДДС", ariaLabel: "ДДС филиала" },
  { id: "pnl", label: "ОПиУ", ariaLabel: "ОПиУ филиала" },
  { id: "plan", label: "План", ariaLabel: "План и прогноз" },
  { id: "debts", label: "Долги", ariaLabel: "Начисления и долги" },
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
const russianCount = (value: number, forms: [string, string, string]) => {
  const hundred = Math.abs(value) % 100;
  const ten = hundred % 10;
  const form = hundred >= 11 && hundred <= 19 ? forms[2] : ten === 1 ? forms[0] : ten >= 2 && ten <= 4 ? forms[1] : forms[2];
  return `${value.toLocaleString("ru-RU")} ${form}`;
};
const isIncomingBankOperation = (direction: string) => /credit|incoming|приход|поступ|вход/i.test(direction);
const bankHistoryDate = (value: string) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
};
const groupBankOperations = (operations: FinanceBankOperation[]) => {
  const groups = new Map<string, FinanceBankOperation[]>();
  for (const operation of operations) {
    const rows = groups.get(operation.operationDate) ?? [];
    rows.push(operation);
    groups.set(operation.operationDate, rows);
  }
  return [...groups].map(([date, rows]) => ({ date, rows }));
};
const bankSyncDate = (value: string) => {
  if (!value) return "Нет успешной синхронизации";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const formatCommentDate = (value: string) => {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function FinanceWorkspace({ role, notify, onTasksChanged, onOpenIntegrations, selectedBranch, focusId }: { role: string; notify: (message: string) => void; onTasksChanged: () => void; onOpenIntegrations: () => void; selectedBranch: string; branchName: string; focusId?: string }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("bank");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("Все направления");
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<FinanceOperation | null>(null);
  const [selectedBank, setSelectedBank] = useState<FinanceBankOperation | null>(null);
  const [classificationOpen, setClassificationOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [classificationDraft, setClassificationDraft] = useState<ClassificationDraft | null>(null);
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const operationCloseRef = useRef<HTMLButtonElement>(null);

  const closeOperation = useCallback(() => {
    setSelected(null);
    setSelectedBank(null);
    setClassificationOpen(false);
    setCommentText("");
  }, []);

  const openOperation = useCallback((operation: FinanceOperation, bankOperation?: FinanceBankOperation | null) => {
    setSelectedBank(bankOperation ?? data?.bankOperations.find((row) => row.financialOperationId === operation.id || row.id === operation.bankOperationRef) ?? null);
    setClassificationOpen(false);
    setCommentText("");
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
      objectEntityId: operation.objectEntityId || selectedBranch,
      cfrEntityId: operation.cfrEntityId || "",
    });
    setSelected(operation);
  }, [data, selectedBranch]);

  const openBankOperation = useCallback((operation: FinanceBankOperation) => {
    const managementOperation = data?.operations.find((row) => row.id === operation.financialOperationId || row.bankOperationRef === operation.id) ?? null;
    if (managementOperation) openOperation(managementOperation, operation);
    else {
      setSelected(null);
      setSelectedBank(operation);
      setClassificationDraft(null);
      setClassificationOpen(false);
      setCommentText("");
    }
  }, [data, openOperation]);

  const load = useCallback(async () => {
    if (!selectedBranch || selectedBranch === "ALL") {
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ period, branchId: selectedBranch });
      const response = await fetch(`/api/finance?${params.toString()}`, { cache: "no-store" });
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
  }, [period, selectedBranch]);

  useEffect(() => {
    const handle = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    if (!focusId || !data) return;
    const handle = window.setTimeout(() => {
      const operation = data.operations.find((row) => row.id === focusId || row.counterpartyEntityId === focusId || row.contractId === focusId);
      if (operation) {
        setTab(operationArticle(operation) ? "bank" : "register");
        setQuery("");
        openOperation(operation);
        if (operation.period !== period) setPeriod(operation.period);
      } else {
        setTab("register");
        setQuery(focusId);
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [data, focusId, openOperation, period]);

  useEffect(() => {
    if (!selected && !selectedBank) return;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => operationCloseRef.current?.focus());
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [selected, selectedBank]);

  useEffect(() => {
    if (!selected && !selectedBank) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeOperation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOperation, selected, selectedBank]);

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
      .filter((operation) => !operationArticle(operation))
      .filter((operation) => !previewIds || previewIds.includes(operation.id))
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
  }, [data, direction, period, query, previewIds]);

  if (!selectedBranch || selectedBranch === "ALL") return <PageContainer className="ahFinanceDenied"><Card><EmptyState title="Выберите филиал" description="Финансовые отчёты ведутся отдельно по каждому филиалу. Общий отчёт пока отключён." density="compact" /></Card></PageContainer>;
  if (loading && !data) return <section className="ahFinanceStatus">Собираем финансовый контур филиала…</section>;
  if (error && !data) return <PageContainer className="ahFinanceDenied"><Card><EmptyState title="Финансовый раздел временно недоступен" description={error} density="compact" action={<Button onClick={() => void load()}>Повторить</Button>} /></Card></PageContainer>;
  if (!data) return null;

  const maxMonthly = Math.max(1, ...data.monthly.flatMap((month) => [month.receiptsMinor, month.outflowsMinor]));
  const periodOptions = [...new Set([period, ...data.monthly.map((month) => month.period)])].sort();
  const reviewOperations = data.reviewOperations.filter((operation) => operation.period === period);
  const bankOperationGroups = groupBankOperations(data.bankOperations);
  const commentTarget = selectedBank
    ? { targetType: "bank" as const, operationId: selectedBank.id }
    : selected ? { targetType: "management" as const, operationId: selected.id } : null;
  const operationComments = commentTarget ? data.operationComments.filter((comment) => comment.targetType === commentTarget.targetType && comment.operationId === commentTarget.operationId) : [];
  const cardIncoming = selectedBank ? isIncomingBankOperation(selectedBank.direction) : selected?.direction === "Поступление";
  const cardDirection = cardIncoming ? "Поступление" : "Списание";
  const cardAmountMinor = Math.abs(selectedBank?.amountMinor ?? selected?.amountMinor ?? 0);
  const cardCurrency = selectedBank?.currency ?? "RUB";
  const cardTitle = selectedBank?.counterpartyName || selected?.counterpartyLabel || selected?.bankDetails?.counterpartyName || "Банковская операция";
  const cardPurpose = selectedBank?.description || selected?.managementPurpose || selected?.bankDetails?.description || selected?.category || "Назначение не передано";
  const cardDate = selectedBank?.operationDate || selected?.operationDate || "";
  const cardAccount = selectedBank ? `${selectedBank.accountName} · ${selectedBank.maskedAccount || selectedBank.legalEntityName}` : selected?.bankDetails ? "Банковская выписка" : "Управленческий учёт";
  const cardStatus = selected?.status || (selectedBank?.allocated ? "Разнесено" : "Ожидает разнесения");
  const cardArticle = selected ? operationArticle(selected) || "Не выбрана" : "Не выбрана";
  const cardId = selectedBank?.id || selected?.id || "operation";

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

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!commentTarget || !commentText.trim()) return;
    const saved = await action({ action: "addOperationComment", ...commentTarget, comment: commentText }, `comment:${commentTarget.operationId}`);
    if (saved) setCommentText("");
  }

  return (
    <PageContainer className="ahFinancePage" data-d179-marker="D179_FINANCE_COMPACT_OPERATION_CARD">
      <PageHeader
        eyebrow="ФИНАНСЫ"
        title="Деньги"
      />

      <div className="ahFinanceControls">
        <label className="ahFinancePeriod">
          <span>Период</span>
          <select aria-label="Месяц финансового отчёта" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {periodOptions.map((value) => <option key={value} value={value}>{financePeriodLabel(value)}</option>)}
          </select>
        </label>
        {data.summary.openIssues ? <button className="ahFinanceIssueButton" onClick={() => { setTab("reconciliation"); closeOperation(); }}>Расхождения <b>{data.summary.openIssues}</b></button> : null}
      </div>

      <section className="ahFinancePulse" data-d177-marker="D177_MONEY_MOBILE_HISTORY" aria-label={`Банковский итог за ${financePeriodLabel(period)}`}>
        <header>
          <div><span>Обороты · {financePeriodLabel(period)}</span><small>Единый банковский факт</small></div>
          <b>{russianCount(data.bankSummary.transactionCount, ["операция", "операции", "операций"])}</b>
        </header>
        <div className="ahFinancePulseMain">
          <span>Чистый денежный поток</span>
          <strong className={data.bankSummary.netMinor < 0 ? "isNegative" : "isPositive"}>{signedRubles(data.bankSummary.netMinor)}</strong>
          <small>поступления минус списания</small>
        </div>
        <dl>
          <div><dt>Поступления</dt><dd className="isPositive">+{rubles(data.bankSummary.incomingMinor)}</dd></div>
          <div><dt>Списания</dt><dd>−{rubles(data.bankSummary.outgoingMinor)}</dd></div>
        </dl>
      </section>

      {/* D066_TOCHKA_FINANCE_BANK_VISIBILITY is retained as historical patch identity. */}
      {data.bankAccounts.length ? (
        <section className="finance-panel ahFinanceBankPanel" data-d172-marker="D172_CANONICAL_MONEY_SOURCE">
          <div className="finance-panel-head ahFinanceBankAccountsHead">
            <div><p>Банк · юридические лица группы</p><h2>Счета и текущие остатки</h2></div>
            <div className="ahFinanceBankAccountsTotal"><strong>{data.bankSummary.accountsWithBalance ? rubles(data.bankSummary.rubBalanceMinor) : "Остатки не переданы"}</strong><span>{russianCount(data.bankAccounts.length, ["счёт", "счёта", "счетов"])}</span></div>
          </div>
          <div className="ahFinanceBankGrid">
            {data.bankAccounts.map((account) => (
              <article key={account.id} className="ahFinanceBankAccount">
                <span className="ahFinanceBankMark" aria-hidden="true">{account.provider.trim().slice(0, 1).toLocaleUpperCase("ru-RU") || "Б"}</span>
                <div className="ahFinanceBankAccountCopy"><strong>{account.name || "Расчётный счёт"}</strong><span>{account.legalEntityName}</span><small>{account.provider} · {account.maskedAccount} · {account.currency}</small></div>
                <div className="ahFinanceBankAccountBalance"><b>{bankMoney(account.balanceMinor, account.currency)}</b><small>{account.balanceAsOf ? `на ${new Date(`${account.balanceAsOf}T00:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" })}` : "дата не передана"}</small></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="ahFinanceNavigation">
        <div className="ahFinanceTabs"><Tabs items={tabs.map((item) => ({ id: item.id, ariaLabel: item.ariaLabel, label: item.id === "reconciliation" ? <>{item.label}{data.summary.openIssues ? <b>{data.summary.openIssues}</b> : null}</> : item.label }))} value={tab} onChange={setTab} ariaLabel="Разделы финансов" /></div>
      </div>

      {tab === "bank" ? <div className="finance-two-column ahFinanceBankWorkspace">
        <section className="finance-panel ahFinanceBankOperationsPanel">
          <div className="finance-panel-head"><div><p>Единый банковский факт · {financePeriodLabel(period)}</p><h2>История операций</h2></div><span className="finance-count">{russianCount(data.bankSummary.transactionCount, ["операция", "операции", "операций"])}</span></div>
          {bankOperationGroups.length ? <div className="ahFinanceBankHistory">{bankOperationGroups.map((group) => (
            <section key={group.date} className="ahFinanceBankHistoryGroup" aria-labelledby={`bank-history-${group.date}`}>
              <h3 id={`bank-history-${group.date}`}>{bankHistoryDate(group.date)}</h3>
              <div>{group.rows.map((operation) => {
                const credit = isIncomingBankOperation(operation.direction);
                const title = operation.counterpartyName || operation.transactionType || "Банковская операция";
                const description = operation.description && operation.description !== title ? operation.description : "Назначение не передано банком";
                return <button type="button" key={operation.id} className="ahFinanceBankHistoryRow" onClick={() => openBankOperation(operation)} aria-label={`Открыть операцию: ${title}, ${credit ? "поступление" : "списание"} ${bankMoney(Math.abs(operation.amountMinor), operation.currency)}`}>
                  <span className={credit ? "ahFinanceBankHistoryIcon isIncoming" : "ahFinanceBankHistoryIcon isOutgoing"} aria-hidden="true">{credit ? "↓" : "↑"}</span>
                  <div className="ahFinanceBankHistoryCopy"><strong>{title}</strong><span>{description}</span><small>{operation.accountName} · {operation.maskedAccount || operation.legalEntityName}</small></div>
                  <div className="ahFinanceBankHistoryAmount"><b className={credit ? "isIncoming" : "isOutgoing"}>{credit ? "+" : "−"}{bankMoney(Math.abs(operation.amountMinor), operation.currency)}</b><span>{credit ? "Зачислено" : "Списано"}</span><small className={operation.allocated ? "quality-ok" : "quality-warn"}>{operation.allocated ? "Разнесено" : "Ожидает разнесения"}</small></div>
                </button>;
              })}</div>
            </section>
          ))}</div> : <EmptyState title="Банковских операций за этот месяц нет" description="Здесь показываются только неизменяемые факты из банковской выписки." density="compact" />}
        </section>
        <section className="finance-panel ahFinanceBankSyncPanel">
          <div className="finance-panel-head"><div><p>Банк · только чтение</p><h2>Синхронизация</h2></div><span className="source-pill">{data.bankSummary.statementCount} пакетов выписки за период</span></div>
          {data.bankSynchronization.length ? <div className="ahFinanceBankSyncList">{data.bankSynchronization.map((item) => <article key={item.id}><header><span className={item.errorCount ? "isError" : item.verified ? "isReady" : "isWaiting"} /><strong>{item.system}</strong><em>{item.status}</em></header><dl><div><dt>Последний успех</dt><dd>{bankSyncDate(item.lastSuccessAt)}</dd></div><div><dt>Следующий запуск</dt><dd>{bankSyncDate(item.nextSyncAt)}</dd></div><div><dt>Принято</dt><dd>{item.acceptedCount} из {item.receivedCount}</dd></div></dl></article>)}</div> : <EmptyState title="Банковское подключение не найдено" description="Проверьте настройки интеграции банка." density="compact" />}
          <div className="ahFinanceBankSyncFooter"><span>Обновлено: {bankSyncDate(data.bankSummary.latestSyncedAt)}</span><Button variant="secondary" onClick={onOpenIntegrations}>Настройки подключения</Button></div>
        </section>
      </div> : null}

      {tab === "articles" ? <FinanceArticlesWorkspace key={`${period}:${data.articleCatalog.revision}`} catalog={data.articleCatalog} permissions={data.articlePermissions} operations={data.operations} period={period} busy={Boolean(busy)} action={action} showOperations={(ids) => { setPreviewIds(ids); setDirection("Все направления"); setQuery(""); setTab("register"); }} /> : null}
      {tab === "register" ? (
        <div className="finance-panel">
          <div className="finance-panel-head"><div><p>{data.branch.name}</p><h2>Операции для разнесения</h2></div><span className="finance-count">{filteredOperations.length} к обработке</span></div>
          <div className="finance-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Контрагент или назначение" aria-label="Поиск финансовых операций" /><select value={direction} onChange={(event) => setDirection(event.target.value)}><option>Все направления</option><option>Поступление</option><option>Списание</option></select>{previewIds ? <Button onClick={() => setPreviewIds(null)}>Сбросить подбор</Button> : null}</div>
          {data.classificationPermissions.canReviewUnassigned && reviewOperations.length ? <section className="finance-panel ahFinanceReviewQueue"><div className="finance-panel-head"><div><p>Не привязаны к филиалу</p><h2>Требует разбора</h2></div><span className="finance-count">{reviewOperations.length}</span></div><div className="ahFinanceAllocationList">{reviewOperations.map((operation) => <OperationQueueRow key={operation.id} operation={operation} onOpen={() => openOperation(operation)} />)}</div></section> : null}
          {filteredOperations.length ? <div className="ahFinanceAllocationList">{filteredOperations.map((operation) => <OperationQueueRow key={operation.id} operation={operation} onOpen={() => openOperation(operation)} />)}</div> : data.operations.some(op => op.period === period) ? <EmptyState title="Все операции разнесены" description="Историю банковских операций смотрите во вкладке «Банк»." density="compact" /> : <EmptyState title="Операций за период пока нет" description="История появится после загрузки банковской выписки." density="compact" />}
        </div>
      ) : null}

      {tab === "cashflow" ? <section className="finance-panel"><div className="finance-panel-head"><div><p>Управленческое разнесение · {data.branch.name}</p><h2>ДДС филиала по статьям · {financePeriodLabel(period)}</h2></div><span className="projection-pill">РАЗНЕСЁННЫЕ ОПЕРАЦИИ</span></div><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Статья</th><th>Операций</th><th>Поступления</th><th>Списания</th></tr></thead><tbody>{cashflowBreakdown(data.operations.filter(op => Boolean(operationArticle(op))), period).map(row => <tr key={row.article}><td><strong>{row.article}</strong></td><td>{row.count}</td><td>{rubles(row.receiptsMinor)}</td><td>{rubles(row.outflowsMinor)}</td></tr>)}</tbody><tfoot><tr><th>Итого разнесено</th><td>{data.operations.filter(op => op.period === period && Boolean(operationArticle(op))).length}</td><td>{rubles(data.summary.receiptsMinor)}</td><td>{rubles(data.summary.outflowsMinor)}</td></tr></tfoot></table></div></section> : null}
      {tab === "cashflow" ? (
        <div className="finance-two-column">
          <article className="finance-panel cashflow-card"><div className="finance-panel-head"><div><p>Управленческий ДДС филиала</p><h2>Разнесённые поступления и списания</h2></div><span className="projection-pill">ОТДЕЛЬНО ОТ БАНКА</span></div>
            <div className="finance-bars">{data.monthly.map((month) => <button key={month.period} className={month.period === period ? "active" : ""} onClick={() => setPeriod(month.period)}><div><i className="income-bar" style={{ height: `${Math.max(10, month.receiptsMinor / maxMonthly * 100)}%` }} /><i className="expense-bar" style={{ height: `${Math.max(10, month.outflowsMinor / maxMonthly * 100)}%` }} /></div><span>{financePeriodLabel(month.period).split(" ")[0]}</span><small className={month.netMinor >= 0 ? "positive-text" : "negative-text"}>{signedRubles(month.netMinor)}</small></button>)}</div>
            <div className="finance-legend"><span><i className="income-dot" />Поступления</span><span><i className="expense-dot" />Списания</span></div>
          </article>
          <article className="finance-panel checks-card"><div className="finance-panel-head"><div><p>Контроль модели</p><h2>Сверка с ОДДС</h2></div><strong className={data.checks.length && data.checks.every((check) => check.status === "OK") ? "model-pass" : "model-fail"}>{data.checks.length ? data.checks.every((check) => check.status === "OK") ? "ПРОЙДЕНО" : "ЕСТЬ ОТКЛОНЕНИЯ" : "НЕТ ПРОВЕРОК"}</strong></div>{data.checks.length ? <div className="check-list">{data.checks.map((check) => <button key={check.id} onClick={() => setTab("register")}><span className={check.status === "OK" ? "ok" : "fail"}>{check.status === "OK" ? "Сверено" : "Расхождение"}</span><div><strong>{humanTechnicalText(check.title)}</strong><small>Исходная таблица проверена</small></div><em>{check.differenceMinor === 0 ? "Разница 0 ₽" : signedRubles(check.differenceMinor)}</em></button>)}</div> : <EmptyState title="Сверки пока не запускались" description="Контроль появится после загрузки подтверждённых строк ОДДС." density="compact" />}</article>
          <article className="finance-panel monthly-detail"><div className="finance-panel-head"><div><p>{financePeriodLabel(period)}</p><h2>Структура денежного потока</h2></div><button onClick={() => setTab("register")}>Разнести операции →</button></div><div className="money-waterfall"><div><span>Поступления</span><strong>{rubles(data.summary.receiptsMinor)}</strong></div><i>−</i><div><span>Списания</span><strong>{rubles(data.summary.outflowsMinor)}</strong></div><i>=</i><div className={data.summary.netMinor >= 0 ? "positive" : "negative"}><span>Чистый поток</span><strong>{signedRubles(data.summary.netMinor)}</strong></div></div></article>
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

      {(selected || selectedBank) ? createPortal(
        <div className="finance-drawer-layer">
          <button className="drawer-scrim" aria-label="Закрыть карточку операции" onClick={closeOperation} />
          <aside className="finance-drawer ahFinanceOperationDrawer ahFinanceOperationCard" role="dialog" aria-modal="true" aria-labelledby={`operation-title-${cardId}`}>
            <header>
              <div>
                <span className={cardIncoming ? "isIncoming" : "isOutgoing"}>{cardDirection}</span>
                <h2 id={`operation-title-${cardId}`}>{cardTitle}</h2>
                <p>{cardDate ? new Date(`${cardDate}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "Дата не передана"} · {cardAccount}</p>
              </div>
              <button ref={operationCloseRef} onClick={closeOperation} aria-label="Закрыть">×</button>
            </header>
            <div className="finance-drawer-body">
              <section className="ahFinanceOperationHero">
                <strong className={cardIncoming ? "isIncoming" : "isOutgoing"}>{cardIncoming ? "+" : "−"}{bankMoney(cardAmountMinor, cardCurrency)}</strong>
                <p>{cardPurpose}</p>
              </section>
              <dl className="ahFinanceOperationFacts">
                <div><dt>Статус</dt><dd>{cardStatus}</dd></div>
                <div><dt>Статья ДДС</dt><dd>{cardArticle}</dd></div>
                {selectedBank?.documentNumber ? <div><dt>Документ</dt><dd>{selectedBank.documentNumber}</dd></div> : null}
                <div><dt>Источник</dt><dd>{selectedBank?.provider || "Финансовый реестр"}</dd></div>
              </dl>

              {selected && data.classificationPermissions.canEdit ? <section className="operation-classification" data-d069-marker="D069_FINANCE_OPERATION_ALLOCATION">
                <div className="operation-classification-head">
                  <div><p>Разнесение</p><span>{cardArticle === "Не выбрана" ? "Выберите статью для ДДС" : cardArticle}</span></div>
                  <button type="button" onClick={() => setClassificationOpen((current) => !current)}>{classificationOpen ? "Свернуть" : cardArticle === "Не выбрана" ? "Разнести" : "Изменить"}</button>
                </div>
                {classificationOpen && classificationDraft ? <form className="operation-classification-form" onSubmit={submitClassification}>
                  <label><span>Кто</span><input value={classificationDraft.counterpartyLabel} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, counterpartyLabel: event.target.value }) : current)} placeholder={selected.bankDetails?.counterpartyName || "Контрагент / плательщик"} /></label>
                  <label><span>За что</span><input value={classificationDraft.managementPurpose} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, managementPurpose: event.target.value }) : current)} placeholder={selected.bankDetails?.description || "Назначение"} /></label>
                  <label><span>Статья ДДС</span><select required value={classificationDraft.cashflowArticle} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, cashflowArticle: event.target.value }) : current)}><option value="">Выберите статью</option>{classificationOptions(data.articleCatalog, "cashflow", selected.direction, operationArticle(selected)).map(article => <option key={article} value={article}>{article}</option>)}</select></label>
                  <label><span>Класс ОПиУ</span><select value={classificationDraft.reportClass} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, reportClass: event.target.value }) : current)}><option>Доходы ОПиУ</option><option>Расходы ОПиУ</option><option>Финансирование</option><option>Не включено в ОПиУ</option></select></label>
                  <label><span>Статья ОПиУ</span><select value={classificationDraft.pnlArticle} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, pnlArticle: event.target.value }) : current)}><option value="">Не выбрана</option>{classificationOptions(data.articleCatalog, "pnl", classificationDraft.reportClass === "Доходы ОПиУ" ? "Поступление" : "Списание", selected.pnlArticle).map(article => <option key={article} value={article}>{article}</option>)}</select></label>
                  <label><span>Период ОПиУ</span><input type="month" value={classificationDraft.accrualPeriod} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, accrualPeriod: event.target.value }) : current)} /></label>
                  <label><span>Договор</span><input value={classificationDraft.contractId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, contractId: event.target.value }) : current)} placeholder="Необязательно" /></label>
                  <label><span>Документ</span><input value={classificationDraft.documentId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, documentId: event.target.value }) : current)} placeholder="Необязательно" /></label>
                  <label><span>Объект / филиал</span><input value={classificationDraft.objectEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, objectEntityId: event.target.value }) : current)} placeholder="Филиал" /></label>
                  <label><span>Проект</span><input value={classificationDraft.projectEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, projectEntityId: event.target.value }) : current)} placeholder="Необязательно" /></label>
                  <label><span>ЦФО</span><input value={classificationDraft.cfrEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, cfrEntityId: event.target.value }) : current)} placeholder="Необязательно" /></label>
                  <div className="operation-classification-actions"><button type="button" onClick={() => setClassificationDraft((current) => current ? ({ ...current, reportClass: "Не включено в ОПиУ", pnlArticle: "", accrualPeriod: "" }) : current)}>Не включать в ОПиУ</button><button disabled={Boolean(busy)}>Сохранить</button></div>
                </form> : null}
              </section> : null}

              <section className="ahFinanceOperationComments">
                <div className="ahFinanceOperationCommentsHead"><h3>Комментарии</h3><span>{operationComments.length || ""}</span></div>
                {operationComments.length ? <div className="ahFinanceOperationCommentList">{operationComments.map((comment) => <article key={comment.id}><p>{comment.body}</p><footer><strong>{comment.author}</strong><time>{formatCommentDate(comment.createdAt)}</time></footer></article>)}</div> : <p className="ahFinanceOperationCommentsEmpty">Комментариев пока нет</p>}
                <form onSubmit={submitComment}>
                  <label><span className="sr-only">Новый комментарий</span><textarea rows={2} maxLength={600} value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Добавить комментарий…" /></label>
                  <button disabled={!commentText.trim() || busy === `comment:${commentTarget?.operationId}`}>Добавить</button>
                </form>
              </section>
            </div>
          </aside>
        </div>, document.body
      ) : null}
    </PageContainer>
  );
}

function forecastSourceLabel(value: string) {
  if (value.includes("SYNTHETIC")) return "Тестовое допущение";
  if (value.includes("MANUAL")) return "Ручной план";
  return humanTechnicalText(value);
}

function OperationQueueRow({ operation, onOpen }: { operation: FinanceOperation; onOpen: () => void }) {
  const incoming = operation.direction === "Поступление";
  const title = operation.bankDetails?.counterpartyName || operation.counterpartyLabel || recordLabel("Операция", operation.id);
  const purpose = operation.bankDetails?.description || operation.managementPurpose || operation.sourceFile || "Назначение не передано";
  return <button type="button" className="ahFinanceAllocationRow" onClick={onOpen} aria-label={`Открыть ${recordLabel("операцию", operation.id)} для разнесения`}>
    <span className={incoming ? "ahFinanceBankHistoryIcon isIncoming" : "ahFinanceBankHistoryIcon isOutgoing"} aria-hidden="true">{incoming ? "↓" : "↑"}</span>
    <span className="ahFinanceBankHistoryCopy"><strong>{title}</strong><span>{purpose}</span><small>{new Date(`${operation.operationDate}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })}</small></span>
    <span className="ahFinanceBankHistoryAmount"><b className={incoming ? "isIncoming" : "isOutgoing"}>{incoming ? "+" : "−"}{rubles(operation.amountMinor)}</b><span>Разнести</span></span>
  </button>;
}

function classificationOptions(catalog: ArticleCatalog, report: "cashflow" | "pnl", direction: string, previous: string) {
  return [...new Set([...catalog.articles.filter(a => a.report === report && a.direction === direction && a.status === "active").map(a => a.name), ...(previous ? [previous] : [])])].sort((a, b) => a.localeCompare(b, "ru"));
}
function readFinanceCsrfCookie() {
  const value = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("__Host-arthello_csrf="));
  try { return value ? decodeURIComponent(value.slice("__Host-arthello_csrf=".length)) : ""; } catch { return ""; }
}
