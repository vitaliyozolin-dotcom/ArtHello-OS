"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";
import { readJsonResponse } from "../../lib/response-json";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, SearchField, Tabs } from "./design-system";
import { AlfaCrmSetupWizard } from "./AlfaCrmSetupWizard";
import "./IntegrationWorkspace.ds.css";

type Connection = {
  id: string;
  system: string;
  category: string;
  targetModule: string;
  ownerEntityId: string;
  sourceOfTruth: string;
  mode: string;
  status: string;
  authStatus: string;
  credentialExpiresAt: string;
  lastSuccessAt: string;
  nextSyncAt: string;
  receivedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  errorCount: number;
  conflictCount: number;
  impact: string;
  adapterVersion: string;
  verifiedTransfer: boolean;
  isEnabled: boolean;
  connection: { state: string; label: string; connected: boolean };
  credentialState: string;
};

type Run = {
  id: string;
  connectionId: string;
  startedAt: string;
  finishedAt: string;
  trigger: string;
  status: string;
  receivedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  errorCount: number;
  conflictCount: number;
  checkpoint: string;
  errorMessage: string;
  initiatedBy: string;
  dryRun: boolean;
};

type Log = {
  id: number;
  runId: string;
  connectionId: string;
  level: string;
  event: string;
  message: string;
  recordRef: string;
  createdAt: string;
};

type Conflict = {
  id: string;
  connectionId: string;
  externalRecordId: string;
  internalEntityId: string;
  conflictType: string;
  fieldName: string;
  sourceValue: string;
  targetValue: string;
  ownerEntityId: string;
  status: string;
  resolution: string;
  evidence: string;
  relatedTaskId: number | null;
  detectedAt: string;
  resolvedAt: string;
};

type Data = {
  connections: Connection[];
  runs: Run[];
  logs: Log[];
  conflicts: Conflict[];
  setups: Record<string, IntegrationSetup>;
  legalEntities: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  summary: {
    total: number;
    connected: number;
    snapshots: number;
    waiting: number;
    openConflicts: number;
    errors: number;
    accepted: number;
  };
  boundary: string;
  capabilities: {
    canManageSetup: boolean;
    canRun: boolean;
    canChangeState: boolean;
    canResolve: boolean;
    canManageCredentials: boolean;
    canManageTochka: boolean;
    canManageTBank: boolean;
  };
  infrastructure: {
    bankEgressIp: string;
    bankEgressIpConfirmed: boolean;
  };
  bankSnapshot: {
    accounts: Array<{ id: string; connectionId: string; legalEntityId: string; maskedAccount: string; name: string; currency: string; status: string; balanceMinor: number | null; balanceAsOf: string; syncedAt: string }>;
    statementCount: number;
    transactionCount: number;
    latestStatementAt: string;
  };
  scopeMessage: string;
};

type IntegrationSetup = {
  connectionId: string;
  authMethod: string;
  startDate: string;
  syncIntervalMinutes: number;
  syncMinute: number;
  endpoint: string;
  legalEntityId: string;
  companySelectionConfirmed: boolean;
  branchId: string;
  allocationMode: "single_branch" | "classify_transactions";
  accountScope: string;
  channelType: string;
  sourceMapping: string;
  dataScopes: string[];
  readOnlyScopeConfirmed: boolean;
  secretStatus: "missing" | "stored" | "external_required";
  updatedAt: string;
};

const roles: Record<string, string> = {
  "Интеграции": "INTEGRATIONS",
  "Проекты": "PROJECTS",
  "Бухгалтерия": "ACCOUNTING",
  "Медработник": "MEDICAL",
  "Собственник": "OWNER",
  "Директор": "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
  "Безопасность": "SAFETY",
  "Финансы": "FINANCE",
  "Кухня": "KITCHEN",
  "Закупки": "PROCUREMENT",
  "Юрист": "LEGAL",
  "HR": "HR",
  "Продажи": "SALES",
  "Маркетинг": "MARKETING",
  "Педагог": "TEACHER",
  "Методист": "METHODIST",
  "Родитель": "PARENT",
};

const tabs = ["Контур", "Каталог", "Журнал", "Конфликты", "Авторизация"] as const;
type Tab = typeof tabs[number];
const TOCHKA_CONNECTION_ID = "INT-T-TOCHKA";
const TBANK_CONNECTION_ID = "INT-T-TBANK";
const PROTECTED_BANK_CONNECTION_IDS = new Set([TOCHKA_CONNECTION_ID, TBANK_CONNECTION_ID]);

type ActionPayload = {
  error?: string;
  message?: string;
  blocked?: boolean;
  reused?: boolean;
  needsAccess?: boolean;
  customerChoices?: Array<{ id: string; name: string }>;
};

type ActionResult = { ok: boolean; payload: ActionPayload };

export function IntegrationWorkspace({
  role,
  notify,
  onTasksChanged,
}: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Контур");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все");
  const [selected, setSelected] = useState("INT-T-D1");
  const [detailOpen, setDetailOpen] = useState(false);
  const [wizardId, setWizardId] = useState("");
  const [conflictDraft, setConflictDraft] = useState<{ id: string; resolution: string; evidence: string } | null>(null);
  const [busy, setBusy] = useState("");
  const roleCode = roles[role] ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations", {
        cache: "no-store",
        headers: { "x-arthello-role": roleCode },
      });
      const payload = await readJsonResponse<Data & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Нет доступа");
    } finally {
      setLoading(false);
    }
  }, [roleCode]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string): Promise<ActionResult> {
    setBusy(key);
    try {
      const response = await fetch("/api/integration-actions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-arthello-role": roleCode,
          "x-csrf-token": readClientCookie("__Host-arthello_csrf"),
        },
        body: JSON.stringify(body),
      });
      const payload = await readJsonResponse<ActionPayload>(response);
      if (!response.ok) {
        // TOCHKA_MULTI_COMPANY_SELECTION_STEP: company selection is a continuation step, not a failed key.
        if (payload.customerChoices?.length) notify("Ключ Точки подтверждён. Выберите компанию в этом окне.");
        else notify(payload.error ?? "Ошибка");
        return { ok: false, payload };
      }
      notify(payload.message ?? (
        payload.reused ? "Задача уже существует"
          : payload.needsAccess ? "Интеграция ждёт доступ — зелёный статус не установлен"
            : payload.blocked ? "Повтор заблокирован и записан в журнал"
              : "Действие выполнено и записано в аудит"
      ));
      await load();
      onTasksChanged();
      return { ok: true, payload };
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Ошибка");
      return { ok: false, payload: { error: cause instanceof Error ? cause.message : "Ошибка" } };
    } finally {
      setBusy("");
    }
  }

  const categories = useMemo(
    () => ["Все", ...new Set((data?.connections ?? []).map((item) => item.category))],
    [data],
  );
  const visible = useMemo(() => {
    const value = query.toLowerCase();
    return (data?.connections ?? []).filter((item) => (
      (category === "Все" || item.category === category)
      && `${item.system} ${item.targetModule} ${item.sourceOfTruth}`.toLowerCase().includes(value)
    ));
  }, [data, query, category]);

  if (loading) return <PageContainer className="ahIntegrationPage"><EmptyState className="ahIntegrationEmpty" density="compact" title="Проверяем подключения" description="Сверяем авторизацию, синхронизации и журналы." /></PageContainer>;
  if (error || !data) return <PageContainer className="ahIntegrationPage"><EmptyState className="ahIntegrationEmpty" density="compact" title={error || "Центр интеграций недоступен"} description="Доступ разрешён владельцу, Представителю, интеграторам, финансам и бухгалтерии." action={<Button variant="secondary" onClick={() => void load()}>Повторить</Button>} /></PageContainer>;

  const current = data.connections.find((item) => item.id === selected) ?? data.connections[0];
  const currentBankAllowed = current?.id === TOCHKA_CONNECTION_ID
    ? data.capabilities.canManageTochka
    : current?.id === TBANK_CONNECTION_ID
      ? data.capabilities.canManageTBank
      : true;
  const canManageCurrentSetup = data.capabilities.canManageSetup && currentBankAllowed;
  const canRunCurrent = data.capabilities.canRun && currentBankAllowed;
  const canChangeCurrentState = data.capabilities.canChangeState && currentBankAllowed;

  return <PageContainer className="ahIntegrationPage">
    <PageHeader
      eyebrow="ИСТОЧНИКИ · ПРАВИЛА ЗАГРУЗКИ · КОНТРОЛЬ"
      title="Центр интеграций"
      description="Авторизация, синхронизации, конфликты и влияние ошибок — без декоративных подключений."
      actions={data.capabilities.canRun ? <Button variant="primary" disabled={busy === "INT-T-D1"} onClick={() => data.connections.some((item) => item.id === "INT-T-D1") ? void action({ action: "retrySync", connectionId: "INT-T-D1" }, "INT-T-D1") : void load()}>{data.connections.length ? "Проверить ядро" : "Обновить контур"}</Button> : undefined}
    />

    {data.connections.length === 0 ? <Card className="ahIntegrationBoundary"><EmptyState className="ahIntegrationEmpty" density="compact" title="Интеграции не назначены" description={data.scopeMessage || "Собственник может назначить пользователю нужные подключения в настройках доступа."} /></Card> : null}

    {data.capabilities.canManageSetup ? <Card className="integration-connect-start">
      <Head p="Пошаговая настройка" h="Подключить источник" s="секреты — только в защищённом хранилище" />
      <div>
        {[
          ["INT-T-ALFACRM", "AlfaCRM", "Лиды, семьи, договоры, занятия и оплаты"],
          ["INT-T-FORMS", "Формы сайта", "Новая заявка сразу попадает на этап «Заявка»"],
          ["INT-T-PHONE", "Телефония", "Звонки и история контакта"],
          ["INT-T-WHATSAPP", "WhatsApp", "Обращения из WhatsApp для бизнеса"],
          ["INT-T-TG", "Telegram", "Бот, входящие события и обращения"],
          ["INT-T-VK", "VK", "Рекламные заявки, сообщения и метки рекламы"],
          ["INT-T-YANDEX", "Яндекс", "Директ, Метрика, Формы и метки рекламы"],
          ["INT-T-MAIL", "Email", "Письма, ответы и статусы доставки"],
          ["INT-T-ADS", "Рекламные кабинеты", "Расходы, кампании и креативы"],
          ["INT-T-SOCIAL", "Социальные сети", "Публикации, метрики и переходы"],
          ["INT-T-TOCHKA", "Точка", "Счета, остатки, выписки и реестр проведённых операций"],
          ["INT-T-TBANK", "Т‑Банк", "Счета и короткая выписка только для чтения"],
          ["INT-T-OPENAI-IMAGES", "Создание изображений OpenAI", "Генерация по описанию и примеру"],
        ].filter(([id]) => (
          data.connections.some((connection) => connection.id === id) && (
            id === TOCHKA_CONNECTION_ID ? data.capabilities.canManageTochka
              : id === TBANK_CONNECTION_ID ? data.capabilities.canManageTBank
                : true
          )
        )).map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>
          <strong>{name}</strong><small>{note}</small><span>Настроить →</span>
        </button>)}
      </div>
    </Card> : null}

    <Card className="ahIntegrationBoundary"><strong>ЗАЩИЩЁННЫЙ КОНТУР</strong><span>{data.boundary}</span></Card>
    <div className="ahIntegrationKpis">
      <KpiCard label="Всего источников" value={String(data.summary.total)} note="единый реестр" onClick={() => setTab("Каталог")} />
      <KpiCard className="ahIntegrationKpiOk" label="Проверено через источник" value={String(data.summary.connected)} note="реальная передача" onClick={() => setTab("Контур")} />
      <KpiCard label="Файловые загрузки" value={String(data.summary.snapshots)} note="не постоянное подключение" onClick={() => setTab("Каталог")} />
      <KpiCard className="ahIntegrationKpiWarning" label="Открытые конфликты" value={String(data.summary.openConflicts)} note={`${data.summary.errors} ошибок запуска`} onClick={() => setTab("Конфликты")} />
    </div>
    <div className="ahIntegrationTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы центра интеграций" /></div>

    {tab === "Контур" ? <div className="integration-overview">
      <article className="integration-map">
        <Head p="Фактическое состояние" h="Поток данных" s={`${data.summary.accepted} записей принято`} />
        <div className="integration-flow"><span>Источник</span><i>проверка доступа</i><span>Правила обмена</span><i>проверка данных</i><span>Хранилище</span><i>расхождение</i><span>Задача</span></div>
        <div className="integration-critical">
          {data.connections.filter((item) => item.impact.startsWith("Критичное")).map((item) => <button key={item.id} onClick={() => { setSelected(item.id); setTab("Каталог"); }}>
            <State state={item.connection.state} />
            <span><strong>{humanSystemName(item.system)}</strong><small>{humanIntegrationText(item.impact)}</small></span>
            <em>{item.connection.label}</em>
          </button>)}
          {!data.connections.length ? <Empty title="Подключения появятся после добавления источника" /> : null}
        </div>
      </article>
      <article className="integration-map">
        <Head p="Последние операции" h="Контрольные запуски" s={`${data.runs.length} в журнале`} />
        <div className="run-mini">
          {data.runs.slice(0, 5).map((run) => <button key={run.id} onClick={() => setTab("Журнал")}>
            <span className={`run-dot ${run.status.toLowerCase().includes("успеш") ? "good" : run.status === "Заблокировано" ? "bad" : "warn"}`} />
            <strong>{humanSystemName(data.connections.find((item) => item.id === run.connectionId)?.system ?? "Источник")}</strong>
            <small>{run.status} · {run.startedAt.slice(5, 16).replace("T", " ")}</small>
          </button>)}
          {!data.runs.length ? <Empty title="Контрольные запуски появятся после добавления данных" /> : null}
        </div>
      </article>
    </div> : null}

    {tab === "Каталог" ? <>
      <div className="ahIntegrationToolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Найти систему или модуль" label="Поиск по источникам и модулям" />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория источника">{categories.map((item) => <option key={item}>{item}</option>)}</select>
        <span>{visible.length} из {data.connections.length}</span>
      </div>
      <div className="integration-catalog">
        <div className="connection-list">
          {visible.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => { setSelected(item.id); setDetailOpen(true); }}>
            <State state={item.connection.state} />
            <span><strong>{humanSystemName(item.system)}</strong><small>{item.category} · {item.targetModule}</small></span>
            <em>{item.connection.label}</em><b>{item.receivedCount}/{item.acceptedCount}</b>
          </button>)}
          {!visible.length ? <Empty title="В каталоге пока нет подключений" /> : null}
        </div>
        {current ? <aside className="connection-detail">
          <header><div><p>{current.category} · {current.targetModule}</p><h2>{humanSystemName(current.system)}</h2></div><State state={current.connection.state} /></header>
          <p className="connection-impact">{humanIntegrationText(current.impact)}</p>
          <dl>
            <Fact k="Статус" v={current.status} /><Fact k="Ответственный" v={humanOwnerLabel(current.ownerEntityId)} />
            <Fact k="Источник данных" v={humanIntegrationText(current.sourceOfTruth)} /><Fact k="Режим" v={humanIntegrationText(current.mode)} />
            <Fact k="Последний успех" v={current.lastSuccessAt || "Никогда"} /><Fact k="Следующая синхронизация" v={current.nextSyncAt || "Не запланирована"} />
            <Fact k="Получено / принято" v={`${current.receivedCount} / ${current.acceptedCount}`} /><Fact k="Отклонено / ошибок / конфликтов" v={`${current.rejectedCount} / ${current.errorCount} / ${current.conflictCount}`} />
          </dl>
          {current.id === TOCHKA_CONNECTION_ID ? <section className="ahIntegrationBankSnapshot">
            <div><strong>Данные из Точки</strong><span>{data.bankSnapshot.statementCount} выписок · {data.bankSnapshot.transactionCount} операций в реестре</span></div>
            {data.bankSnapshot.accounts.filter((account) => account.connectionId === current.id).map((account) => <article key={account.id}><span><strong>{account.name}</strong><small>{account.maskedAccount} · {account.currency}</small></span><em>{account.balanceMinor === null ? "Остаток ещё не получен" : bankMoney(account.balanceMinor, account.currency)}<small>{account.balanceAsOf ? `на ${new Date(`${account.balanceAsOf}T00:00:00Z`).toLocaleDateString("ru-RU")}` : account.status}</small></em></article>)}
            {!data.bankSnapshot.accounts.some((account) => account.connectionId === current.id) ? <small>Счета и остатки появятся после первой загрузки.</small> : null}
          </section> : null}
          <div className="connection-actions">
            {canRunCurrent ? <><button disabled={busy === `test-${current.id}`} onClick={() => void action({ action: "testConnection", connectionId: current.id }, `test-${current.id}`)}>{current.id === TOCHKA_CONNECTION_ID ? "Проверить и загрузить данные" : PROTECTED_BANK_CONNECTION_IDS.has(current.id) ? "Проверить доступ только для чтения" : "Проверить соединение"}</button><button disabled={busy === `sync-${current.id}`} onClick={() => void action({ action: "retrySync", connectionId: current.id }, `sync-${current.id}`)}>{current.id === TOCHKA_CONNECTION_ID ? "Загрузить новые выписки и операции" : current.id === TBANK_CONNECTION_ID ? "Проверить счета и короткую выписку" : "Запустить синхронизацию"}</button></> : null}
            <button onClick={() => setTab("Журнал")}>Посмотреть журнал</button>
            <button onClick={() => setTab("Журнал")}>Посмотреть ошибки</button>
            {canChangeCurrentState ? <><button disabled={busy === `reconnect-${current.id}` || current.id === "INT-T-D1"} onClick={() => void action({ action: "resumeConnection", connectionId: current.id }, `reconnect-${current.id}`)}>Переподключить</button><button className="danger" disabled={busy === `state-${current.id}` || current.id === "INT-T-D1" || current.status === "На паузе"} onClick={() => void action({ action: "pauseConnection", connectionId: current.id }, `state-${current.id}`)}>Отключить</button></> : null}
          </div>
        </aside> : <div className="integration-empty-panel"><Empty title="Выберите подключение" /></div>}
      </div>
    </> : null}

    {tab === "Журнал" ? <div className="integration-run-list">
      {data.runs.map((run) => <article key={run.id}>
        <header><div><p>{recordLabel("Запуск", run.id)}</p><h2>{humanSystemName(data.connections.find((item) => item.id === run.connectionId)?.system ?? "Источник")}</h2></div><span className={run.status === "Успешно" ? "good" : run.status === "Заблокировано" ? "bad" : "warn"}>{run.status}</span></header>
        <div className="run-stats">
          <span><small>Получено</small><strong>{run.receivedCount}</strong></span><span><small>Принято</small><strong>{run.acceptedCount}</strong></span><span><small>Отклонено</small><strong>{run.rejectedCount}</strong></span><span><small>Ошибки</small><strong>{run.errorCount}</strong></span><span><small>Конфликты</small><strong>{run.conflictCount}</strong></span>
        </div>
        <p>{humanIntegrationText(run.trigger)} · {humanCheckpoint(run.checkpoint)}{run.dryRun ? " · предварительная проверка" : ""}</p>
        {run.errorMessage ? <strong className="run-error">{humanIntegrationText(run.errorMessage)}</strong> : null}
        <div className="run-logs">{data.logs.filter((log) => log.runId === run.id).map((log) => <div key={log.id}><em>{humanLogLevel(log.level)}</em><span><strong>{humanLogEvent(log.event)}</strong><small>{humanIntegrationText(log.message)}</small></span><code>{recordLabel("Запись", log.recordRef)}</code></div>)}</div>
      </article>)}
      {!data.runs.length ? <div className="integration-empty-panel"><Empty title="Журнал пока пуст" /></div> : null}
    </div> : null}

    {tab === "Конфликты" ? <div className="conflict-board">
      {data.conflicts.map((item) => <article key={item.id} className={item.status === "Закрыт" ? "closed" : ""}>
        <header><span>{item.conflictType}</span><em>{item.status}</em></header><h2>{item.fieldName}</h2>
        <p>{humanSystemName(data.connections.find((connection) => connection.id === item.connectionId)?.system ?? "Источник")} · {recordLabel("Запись источника", item.externalRecordId)}</p>
        <div><span><small>Источник</small><strong>{item.sourceValue}</strong></span><span><small>В системе</small><strong>{item.targetValue}</strong></span></div>
        <footer><small>{humanOwnerLabel(item.ownerEntityId)}{item.relatedTaskId ? ` · ${taskRecordLabel(item.relatedTaskId)}` : ""}</small>
          {item.status !== "Закрыт" ? data.capabilities.canResolve && (
            item.connectionId === TOCHKA_CONNECTION_ID ? data.capabilities.canManageTochka
              : item.connectionId === TBANK_CONNECTION_ID ? data.capabilities.canManageTBank
                : true
          ) ? <><button disabled={busy === `task-${item.id}`} onClick={() => void action({ action: "createConflictTask", conflictId: item.id }, `task-${item.id}`)}>Создать задачу</button><button onClick={() => setConflictDraft({ id: item.id, resolution: "", evidence: "" })}>Закрыть конфликт</button></> : <span>Только просмотр</span> : <strong>{item.resolution}</strong>}
        </footer>
      </article>)}
      {!data.conflicts.length ? <div className="integration-empty-panel"><Empty title="Открытых конфликтов нет" /></div> : null}
    </div> : null}

    {tab === "Авторизация" ? <div className="auth-board">
      {data.connections.map((item) => <article key={item.id}>
        <header><State state={item.credentialState} /><span>{item.category}</span></header><h2>{humanSystemName(item.system)}</h2><p>{humanIntegrationText(item.authStatus)}</p>
        <dl><Fact k="Срок ключа" v={item.credentialExpiresAt || "Не задан"} /><Fact k="Передача проверена" v={item.verifiedTransfer ? "Да" : "Нет"} /><Fact k="Тип подключения" v={friendlyAdapter(item.adapterVersion)} /></dl>
        <footer>{PROTECTED_BANK_CONNECTION_IDS.has(item.id) ? <>
          <span className="ahIntegrationCredentialRemovalNote">
            {item.id === TOCHKA_CONNECTION_ID ? "Ключ Точки" : "Токен Т‑Банка"} хранится только в зашифрованном виде и никогда не отображается. Удаление из ArtHello OS не отзывает ключ в банке. После удаления <a href={bankCredentialGuide(item.id)} target="_blank" rel="noreferrer">отзовите его отдельно {item.id === TOCHKA_CONNECTION_ID ? "в Точке" : "в Т‑Бизнесе"} ↗</a>
          </span>
          {currentBankCapability(item.id, data.capabilities) && data.setups[item.id]?.secretStatus === "stored" ? <button className="danger" disabled={busy === `revoke-${item.id}`} onClick={() => { if (window.confirm(`Удалить ${item.id === TOCHKA_CONNECTION_ID ? "ключ Точки" : "токен Т‑Банка"} только из ArtHello OS? Для прекращения его действия потребуется отдельно отозвать ключ в банке.`)) void action({ action: "revokeCredential", connectionId: item.id }, `revoke-${item.id}`); }}>Удалить из ArtHello OS</button> : null}
        </> : "Секретные значения передаются через защищённый контур"}</footer>
      </article>)}
      {!data.connections.length ? <div className="integration-empty-panel"><Empty title="Авторизации появятся после добавления источника" /></div> : null}
    </div> : null}

    {current && detailOpen ? <ConnectionDetailDialog
      connection={current}
      setup={data.setups[current.id]}
      canManageSetup={canManageCurrentSetup}
      canRun={canRunCurrent}
      canChangeState={canChangeCurrentState}
      busy={busy}
      close={() => setDetailOpen(false)}
      configure={() => { setDetailOpen(false); setWizardId(current.id); }}
      openLog={() => { setDetailOpen(false); setTab("Журнал"); }}
      action={action}
    /> : null}

    {wizardId === "INT-T-ALFACRM" && data.capabilities.canManageSetup ? <AlfaCrmSetupWizard
      roleCode={roleCode}
      close={() => setWizardId("")}
      notify={notify}
    /> : null}
    {wizardId && data.capabilities.canManageSetup && currentBankCapability(wizardId, data.capabilities) && wizardId !== "INT-T-ALFACRM" ? <ConnectionWizard
      connection={data.connections.find((item) => item.id === wizardId)}
      existing={data.setups[wizardId]}
      legalEntities={data.legalEntities}
      branches={data.branches}
      busy={busy === `setup-${wizardId}`}
      canManageCredentials={data.capabilities.canManageCredentials}
      bankEgressIp={data.infrastructure.bankEgressIp}
      bankEgressIpConfirmed={data.infrastructure.bankEgressIpConfirmed}
      close={() => setWizardId("")}
      save={async (setup, credential, customerChoiceId) => {
        const result = await action({ action: "saveSetup", setup, ...(credential ? { credential } : {}), ...(customerChoiceId ? { customerChoiceId } : {}) }, `setup-${wizardId}`);
        if (result.ok) setWizardId("");
        return result;
      }}
    /> : null}
    {conflictDraft ? <ConflictResolutionDialog
      value={conflictDraft}
      busy={busy === `resolve-${conflictDraft.id}`}
      close={() => setConflictDraft(null)}
      change={setConflictDraft}
      save={async () => {
        const result = await action({ action: "resolveConflict", conflictId: conflictDraft.id, resolution: conflictDraft.resolution, evidence: conflictDraft.evidence }, `resolve-${conflictDraft.id}`);
        if (result.ok) setConflictDraft(null);
      }}
    /> : null}
  </PageContainer>;
}

function ConnectionDetailDialog({ connection, setup, canManageSetup, canRun, canChangeState, busy, close, configure, openLog, action }: {
  connection: Connection;
  setup?: IntegrationSetup;
  canManageSetup: boolean;
  canRun: boolean;
  canChangeState: boolean;
  busy: string;
  close: () => void;
  configure: () => void;
  openLog: () => void;
  action: (body: Record<string, unknown>, key: string) => Promise<ActionResult>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useIntegrationDialog(dialogRef, close);
  return createPortal(<div className="ahIntegrationModalLayer">
    <button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть подключение" />
    <section ref={dialogRef} className="connection-modal ahIntegrationConnectionModal" role="dialog" aria-modal="true" aria-labelledby="connection-modal-title" tabIndex={-1}>
      <header><div><p>Карточка подключения</p><h2 id="connection-modal-title">{humanSystemName(connection.system)}</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
      <p className="connection-impact">{humanIntegrationText(connection.impact)}</p>
      <dl>
        <Fact k="Статус" v={connection.status} /><Fact k="Доступ" v={humanIntegrationText(connection.authStatus)} />
        <Fact k="Источник данных" v={humanIntegrationText(connection.sourceOfTruth)} /><Fact k="Режим" v={humanIntegrationText(connection.mode)} />
        <Fact k="Последний успех" v={connection.lastSuccessAt || "Никогда"} /><Fact k="Следующая синхронизация" v={connection.nextSyncAt || "Не запланирована"} />
        <Fact k="Получено / принято" v={`${connection.receivedCount} / ${connection.acceptedCount}`} /><Fact k="Ошибки / конфликты" v={`${connection.errorCount} / ${connection.conflictCount}`} />
      </dl>
      {setup ? <div className="saved-setup"><strong>Параметры сохранены</strong><span>{savedSetupSummary(connection.id, setup)}</span></div> : null}
      <footer>
        {canManageSetup ? <button type="button" onClick={configure}>Настроить подключение</button> : null}
        <button type="button" onClick={openLog}>Журнал</button>
        {canRun && connection.id !== "INT-T-ALFACRM" ? <button type="button" disabled={busy === `sync-${connection.id}`} onClick={() => void action({ action: "retrySync", connectionId: connection.id }, `sync-${connection.id}`)}>{connection.id === TOCHKA_CONNECTION_ID ? "Загрузить выписки и операции" : connection.id === TBANK_CONNECTION_ID ? "Проверить счета и выписку" : "Запустить синхронизацию"}</button> : null}
        {canChangeState ? <button type="button" className="danger" disabled={connection.id === "INT-T-D1"} onClick={() => void action({ action: "pauseConnection", connectionId: connection.id }, `state-${connection.id}`)}>Отключить</button> : null}
      </footer>
    </section>
  </div>, document.body);
}

function ConflictResolutionDialog({ value, busy, close, change, save }: {
  value: { id: string; resolution: string; evidence: string };
  busy: boolean;
  close: () => void;
  change: (value: { id: string; resolution: string; evidence: string }) => void;
  save: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  useIntegrationDialog(dialogRef, close);
  return createPortal(<div className="ahIntegrationModalLayer">
    <button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть форму решения" />
    <form ref={dialogRef} className="ahIntegrationConflictDialog" role="dialog" aria-modal="true" aria-labelledby="integration-conflict-title" tabIndex={-1} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><p>Ручная сверка</p><h2 id="integration-conflict-title">Закрыть конфликт</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
      <div className="ahIntegrationConflictFields">
        <label><span>Какое решение принято</span><textarea required minLength={8} value={value.resolution} onChange={(event) => change({ ...value, resolution: event.target.value })} placeholder="Опишите выбранный вариант и кто его проверил" /></label>
        <label><span>Проверяемое доказательство</span><textarea required minLength={8} value={value.evidence} onChange={(event) => change({ ...value, evidence: event.target.value })} placeholder="Документ, ссылка, дата сверки или номер акта" /></label>
      </div>
      <footer><button type="button" onClick={close}>Отмена</button><button type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить решение"}</button></footer>
    </form>
  </div>, document.body);
}

function useIntegrationDialog(dialogRef: RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const initial = dialog.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]");
      (initial ?? dialog).focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dialogRef]);
}

function ConnectionWizard({ connection, existing, legalEntities, branches, busy, canManageCredentials, bankEgressIp, bankEgressIpConfirmed, close, save }: {
  connection?: Connection;
  existing?: IntegrationSetup;
  legalEntities: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  busy: boolean;
  canManageCredentials: boolean;
  bankEgressIp: string;
  bankEgressIpConfirmed: boolean;
  close: () => void;
  save: (setup: Record<string, unknown>, credential: string, customerChoiceId: string) => Promise<ActionResult>;
}) {
  const configuredStartDate = existing?.startDate || (connection?.id === TOCHKA_CONNECTION_ID ? "2026-09-01" : "2026-01-01");
  const [startDate, setStartDate] = useState(connection?.id === TOCHKA_CONNECTION_ID && configuredStartDate < "2026-09-01" ? "2026-09-01" : configuredStartDate);
  const [interval, setInterval] = useState(existing?.syncIntervalMinutes ?? 60);
  const [minute, setMinute] = useState(existing?.syncMinute ?? 5);
  const [authMethod, setAuthMethod] = useState(existing?.authMethod ?? (
    connection?.id === TOCHKA_CONNECTION_ID ? "JWT" : connection?.id === TBANK_CONNECTION_ID ? "Bearer token" : "API"
  ));
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? "");
  const [legalEntityId, setLegalEntityId] = useState(existing?.legalEntityId ?? "");
  const [branchId, setBranchId] = useState(existing?.branchId ?? "");
  const [allocationMode, setAllocationMode] = useState<"single_branch" | "classify_transactions">(existing?.allocationMode ?? "classify_transactions");
  const [accountScope, setAccountScope] = useState(existing?.accountScope ?? "");
  const [channelType, setChannelType] = useState(existing?.channelType ?? "");
  const [sourceMapping, setSourceMapping] = useState(humanIntegrationText(existing?.sourceMapping ?? "Источник рекламы, тип размещения, кампания, карточка клиента"));
  const [dataScopes, setDataScopes] = useState<string[]>(existing?.dataScopes ?? []);
  const [credential, setCredential] = useState("");
  const [customerChoices, setCustomerChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [customerChoiceId, setCustomerChoiceId] = useState("");
  const customerChoiceRef = useRef<HTMLSelectElement>(null);
  const [readOnlyScopeConfirmed, setReadOnlyScopeConfirmed] = useState(existing?.readOnlyScopeConfirmed ?? false);
  const [bankIpCopied, setBankIpCopied] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const bankIpRef = useRef<HTMLInputElement>(null);
  useIntegrationDialog(dialogRef, close);
  if (!connection) return null;
  const connectionId = connection.id;
  const bank = PROTECTED_BANK_CONNECTION_IDS.has(connection.id);
  const crm = connection.id === "INT-T-ALFACRM";
  const openai = connection.id === "INT-T-OPENAI-IMAGES";
  const salesChannel = ["INT-T-FORMS", "INT-T-PHONE", "INT-T-WHATSAPP", "INT-T-TG", "INT-T-VK", "INT-T-YANDEX", "INT-T-MAIL", "INT-T-ADS", "INT-T-SOCIAL"].includes(connection.id);
  const tochka = connection.id === "INT-T-TOCHKA";
  const tbank = connection.id === TBANK_CONNECTION_ID;
  const scopeOptions = tochka
    ? ["Счета", "Выписки", "Операции и платежи", "Реестр операций", "Остатки"]
    : bank
      ? ["Операции по счетам", "Остатки", "Счета", "Контрагенты", "Назначения платежей"]
    : crm
      ? ["Семьи", "Дети", "Сотрудники", "Классы и группы", "Расписание", "Занятия", "Абонементы и договоры", "Начисления и оплаты", "Лиды и статусы"]
      : openai
        ? ["Созданные изображения"]
        : salesChannel
          ? ["Лиды", "Контакты", "Сообщения и звонки", "Согласия", "Рекламные метки и источник", "Статусы", "Менеджер", "Филиал", "Кампании и материалы"]
          : ["Обращения", "Контакты", "Согласия", "Рекламные метки и источник", "Публикации", "Метрики контента"];
  const credentialStoredForSelection = existing?.secretStatus === "stored"
    && existing.legalEntityId === legalEntityId;
  const credentialRequired = bank && canManageCredentials && !credentialStoredForSelection;
  const docs = tochka
    ? "https://developers.tochka.com/docs/tochka-api/"
    : tbank
      ? "https://developer.tbank.ru/docs/intro/manuals/self-service-auth"
      : connection.id === "INT-T-ALFACRM"
        ? "https://alfacrm.pro/knowledge/integration/api"
        : openai ? "https://platform.openai.com/docs/guides/image-generation" : "";
  const channelGuide = connection.id === "INT-T-FORMS"
    ? "Укажите адрес приёма заявок с сайта и сопоставьте телефон, имя, согласие и рекламные метки. После выдачи защищённого ключа заявка будет создаваться на первом этапе воронки."
    : connection.id === "INT-T-SOCIAL"
      ? "Выберите соцсеть и способ защищённого входа. Сохраняйте кампанию, материал и рекламные метки, чтобы видеть путь от публикации до заявки и оплаты."
      : connection.id === "INT-T-TG"
        ? "Создайте отдельного Telegram-бота, укажите адрес приёма событий и канал. Ключ бота передаётся только через защищённый контур."
        : "Укажите канал, адрес приёма событий и правила определения источника.";
  async function copyBankEgressIp() {
    if (!bankEgressIpConfirmed || !bankEgressIp) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(bankEgressIp);
      copied = true;
    } catch {
      const field = bankIpRef.current;
      if (field) {
        field.focus();
        field.select();
        try { copied = document.execCommand("copy"); } catch { copied = false; }
      }
    }
    setBankIpCopied(copied);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await save({
      connectionId,
      startDate: tochka ? startDate : bank ? "" : startDate,
      syncIntervalMinutes: tochka ? interval : bank ? 0 : interval,
      syncMinute: tochka ? minute : bank ? 0 : minute,
      authMethod,
      endpoint,
      legalEntityId,
      branchId,
      allocationMode,
      accountScope: bank ? "all_permitted" : accountScope,
      channelType,
      sourceMapping,
      dataScopes: tochka ? ["Счета", "Выписки", "Операции и платежи", "Реестр операций", "Остатки"] : tbank ? ["Счета", "Короткая выписка"] : dataScopes,
      readOnlyScopeConfirmed: tbank && readOnlyScopeConfirmed,
    }, credential, customerChoiceId);
    if (!result.ok && result.payload.customerChoices?.length) {
      setCustomerChoices(result.payload.customerChoices);
      setCustomerChoiceId("");
      window.requestAnimationFrame(() => {
        customerChoiceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        customerChoiceRef.current?.focus();
      });
    }
  }
  return createPortal(<div className="ahIntegrationModalLayer">
    <button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть настройку" />
    <form ref={dialogRef} className="setup-wizard ahIntegrationSetupWizard" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="setup-title" tabIndex={-1}>
      <header><div><p>Безопасное подключение</p><h2 id="setup-title">{humanSystemName(connection.system)}</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
      <div className="ahIntegrationSetupBody">
      <div className="setup-intro">
        <strong>{tochka ? "Один ключ Точки для выбранной карточки юрлица — не отдельный ключ на каждый счёт или филиал" : tbank ? "ArtHello OS использует только два метода чтения Т‑Банка" : openai ? "Генерация включится после безопасной настройки ключа OpenAI" : "Настройте источник и расписание загрузки"}</strong>
        <span>{crm ? "Создайте в AlfaCRM отдельного пользователя для подключения. Ключ используется только во время защищённых запросов, не чаще 5 в секунду." : tochka ? "После сохранения ArtHello OS загрузит разрешённые счета, остатки, выписки и реестр проведённых операций. Создание, подписание и отправка новых платежей не выполняются." : tbank ? "В Т‑Бизнесе выпустите отдельный токен только с доступами «Информация о счетах компании» и «Информация об операциях компании». ArtHello OS запросит список счетов и до 10 операций за 7 дней; система не может по ответу банка доказать отсутствие у токена лишних прав, поэтому это подтверждает собственник. Платёжные методы не вызываются." : openai ? "Ключ не вводится в эту форму и не сохраняется в базе приложения. Примеры отправляются только при нажатии «Создать»." : channelGuide}</span>
      </div>
      <div className="setup-grid">
        {tochka ? <fieldset className="wide setup-scopes"><legend>Что загрузится из Точки</legend>{scopeOptions.map((scope) => <label key={scope}><input type="checkbox" checked readOnly aria-readonly="true" /><span>{scope}</span></label>)}</fieldset> : bank ? <div className="wide ahIntegrationRoutingNote" role="note"><strong>Проверяются только счета и короткая выписка</strong><span>Один запрос получает список счетов, второй — до 10 операций за 7 дней. Ответ используется только для проверки доступа и не становится банковским фактом в системе. Режим распределения ниже сохраняется как черновик.</span></div> : <fieldset className="wide setup-scopes"><legend>Какие данные получать</legend>{scopeOptions.map((scope) => <label key={scope}><input type="checkbox" checked={dataScopes.includes(scope)} onChange={(event) => setDataScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} /><span>{scope}</span></label>)}</fieldset>}
        {tbank ? <div className="wide ahIntegrationCredentialNotice" role="note">
          <strong>Разрешите исходящий адрес сервера</strong>
          <span>При выпуске токена укажите статический исходящий IP основного сервера, на котором работает ArtHello OS, — не адрес вашего компьютера или браузера. Т‑Банк разрешает указать до 9 адресов.</span>
          <label>
            <span>Подтверждённый исходящий IP основного сервера</span>
            <div className="ahIntegrationCopyField">
              <input ref={bankIpRef} readOnly value={bankEgressIp || "Не настроен"} aria-readonly="true" onFocus={(event) => event.currentTarget.select()} />
              <button type="button" disabled={!bankEgressIpConfirmed || !bankEgressIp} onClick={() => void copyBankEgressIp()}>{bankIpCopied ? "Скопировано" : "Скопировать"}</button>
            </div>
            <small>{bankEgressIpConfirmed ? "Адрес вручную задан администратором сервера; это не автоматическая проверка. Подтвердите у хостинга, что исходящие запросы ArtHello OS действительно используют этот адрес." : "Исходящий IP не подтверждён администратором сервера. Настройка и проверка Т‑Банка заблокированы."}</small>
          </label>
          {!bankEgressIpConfirmed ? <span><strong>Важно:</strong> входящий адрес сайта 188.225.38.55 не подтверждает исходящий адрес сервера — не добавляйте его в Т‑Банке без подтверждения хостинга.</span> : null}
          <span>Если токен не использовать 90 дней, банк отключит его; регулярные проверки сохраняют его действующим.</span>
        </div> : null}
        {tbank ? <label className="wide ahIntegrationReadScopeAttestation"><span><input type="checkbox" checked={readOnlyScopeConfirmed} onChange={(event) => setReadOnlyScopeConfirmed(event.target.checked)} /> Подтверждаю: для этого токена выбраны только «Информация о счетах компании» и «Информация об операциях компании», без прав на платежи</span><small>ArtHello OS технически ограничен двумя разрешёнными адресами чтения, но состав прав самого токена задаёт и подтверждает собственник в Т‑Бизнесе.</small></label> : null}
        {bank ? <label><span>Карточка юридического лица</span><select value={legalEntityId} onChange={(event) => { setLegalEntityId(event.target.value); setCustomerChoices([]); setCustomerChoiceId(""); }} required disabled={!legalEntities.length}><option value="">{legalEntities.length ? "Выберите юрлицо" : "Сначала создайте карточку юрлица"}</option>{legalEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select><small>Можно выбрать только существующую карточку юрлица. Соответствие банковского доступа этой карточке фиксирует собственник.</small></label> : <label><span>Куда загружать</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)} required><option value="">Выберите филиал</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        {tochka && customerChoices.length ? <label><span>Компания в Точке</span><select ref={customerChoiceRef} value={customerChoiceId} onChange={(event) => setCustomerChoiceId(event.target.value)} required><option value="">Выберите компанию</option>{customerChoices.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select><small>Если Точка не передаёт название компании, ArtHello OS показывает только безопасные маски её счетов. Служебный customerCode в браузер и журнал не передаётся.</small></label> : null}
        {bank ? <label><span>Расчётные счета</span><input readOnly value={tochka ? "Все счета, разрешённые ключом Точки" : "Все счета, разрешённые токеном Т‑Банка"} aria-readonly="true" /><small>Отдельный ключ для каждого счёта не нужен.</small></label> : null}
        {bank ? <label className="wide"><span>Распределение по филиалам</span><select value={allocationMode} onChange={(event) => setAllocationMode(event.target.value === "single_branch" ? "single_branch" : "classify_transactions")}><option value="classify_transactions">Несколько филиалов — классифицировать операции</option><option value="single_branch">Один филиал по умолчанию</option></select><small>{allocationMode === "classify_transactions" ? "После настройки правил операции можно будет классифицировать по назначению платежа и контрагенту; неопределённые должны оставаться в очереди «Требует разбора»." : "После запуска импорта новые операции можно будет сначала относить к одному выбранному филиалу."}</small></label> : null}
        {bank && allocationMode === "single_branch" ? <label><span>Филиал по умолчанию</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)} required disabled={!branches.length}><option value="">{branches.length ? "Выберите филиал" : "Нет действующих филиалов"}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
        {bank && allocationMode === "classify_transactions" ? <div className="wide ahIntegrationRoutingNote" role="note"><strong>Смешанные поступления допустимы</strong><span>Один счёт может принимать деньги школы и садика. Настройка не закрепляет такой счёт за одним филиалом; до появления проверенных правил сомнительные операции нельзя разносить автоматически.</span></div> : null}
        {!bank || tochka ? <><label><span>{tochka ? "Загружать выписки с" : "Загружать данные с"}</span><input type="date" min={tochka ? "2026-09-01" : undefined} value={startDate} onChange={(event) => setStartDate(event.target.value)} required />{tochka ? <small>Начало управленческого учёта: 1 сентября 2026</small> : null}</label><label><span>Автосинхронизация</span><select value={interval} onChange={(event) => setInterval(Number(event.target.value))}><option value={60}>Каждый час</option><option value={180}>Каждые 3 часа</option><option value={360}>Каждые 6 часов</option><option value={1440}>Раз в сутки</option></select></label><label><span>На какой минуте</span><input type="number" min="0" max="59" value={minute} onChange={(event) => setMinute(Number(event.target.value))} /></label></> : null}
        <label><span>Способ авторизации</span><select value={authMethod} onChange={(event) => setAuthMethod(event.target.value)}>{tochka ? <option value="JWT">Защищённый ключ Точки</option> : tbank ? <option value="Bearer token">Токен Т‑Банка</option> : <><option value="API">Ключ подключения</option><option value="OAuth 2.0">Вход через сервис</option><option value="Webhook">Защищённый адрес приёма событий</option></>}</select></label>
        {crm ? <label><span>Адрес AlfaCRM</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://имя.alfacrm.pro" /></label> : null}
        {crm ? <label><span>Номер филиала в AlfaCRM</span><input value={accountScope} onChange={(event) => setAccountScope(event.target.value)} placeholder="Номер из настроек AlfaCRM" /></label> : null}
        {bank && canManageCredentials ? <label className="wide"><span>{tochka ? "Ключ Точки" : "Токен Т‑Банка"}</span><input type="password" value={credential} onChange={(event) => { setCredential(event.target.value); setCustomerChoices([]); setCustomerChoiceId(""); }} required={credentialRequired} disabled={tbank && !bankEgressIpConfirmed} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={credentialStoredForSelection ? "Ключ уже сохранён — оставьте пустым, чтобы не менять" : tochka ? "Вставьте ключ из Точки" : bankEgressIpConfirmed ? "Вставьте токен из раздела интеграций Т‑Бизнеса" : "Сначала подтвердите исходящий IP сервера"} aria-describedby="bank-credential-help" /><small id="bank-credential-help">Ключ сначала проверяется запросами только на чтение. После успешной проверки он шифруется и больше не показывается.</small></label> : null}
        {!crm && !bank && !openai ? <><label><span>Канал</span><input value={channelType} onChange={(event) => setChannelType(event.target.value)} placeholder="Сайт / VK / Telegram" /></label><label><span>Адрес приёма событий</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://…" /></label></> : null}
        {!openai && !bank ? <label className="wide"><span>Поля и атрибуция</span><textarea value={sourceMapping} onChange={(event) => setSourceMapping(event.target.value)} /></label> : null}
      </div>
      <div className="secret-boundary"><strong>{tochka ? "Ключ Точки защищён" : tbank ? "Токен Т‑Банка защищён" : "Секреты защищены"}</strong><span>{bank ? `В интерфейс и ответы системы ${tochka ? "ключ и код компании" : "токен, номера счетов и операции"} не возвращаются. Зашифрованный ключ привязан к выбранной карточке юрлица, а соответствие подтверждает собственник.` : "Секретные значения передаются отдельно от обычных параметров и никогда не отображаются после сохранения."}</span></div>
      </div>
      <footer>{docs ? <a href={docs} target="_blank" rel="noreferrer">Официальная инструкция ↗</a> : <span />}
        <div><button type="button" onClick={close}>Отмена</button><button type="submit" disabled={busy || (tochka && authMethod !== "JWT") || (tbank && (authMethod !== "Bearer token" || !bankEgressIpConfirmed || !bankEgressIp || !readOnlyScopeConfirmed)) || (!bank && !dataScopes.length) || (bank && (!legalEntityId || !legalEntities.length)) || (bank && allocationMode === "single_branch" && (!branchId || !branches.length)) || (credentialRequired && !credential) || (customerChoices.length > 0 && !customerChoiceId)}>{busy ? tochka ? "Загружаем данные…" : "Проверяем…" : credential ? tochka ? "Подключить и загрузить данные" : tbank ? "Проверить чтение и сохранить" : "Сохранить" : bank ? "Сохранить параметры" : "Сохранить выбор и расписание"}</button></div>
      </footer>
    </form>
  </div>, document.body);
}

function savedSetupSummary(connectionId: string, setup: IntegrationSetup) {
  if (connectionId === "INT-T-TOCHKA") {
    const allocation = setup.allocationMode === "classify_transactions"
      ? "черновик классификации по филиалам с ручным разбором"
      : `черновик одного филиала: ${setup.branchId || "не выбран"}`;
    return `карточка юрлица выбрана · компания ${setup.companySelectionConfirmed ? "подтверждена" : "ещё не подтверждена"} · счета, остатки, выписки и операции с ${setup.startDate || "выбранной даты"} · ${allocation} · ключ ${setup.secretStatus === "stored" ? "сохранён защищённо" : "не введён"}`;
  }
  if (connectionId === TBANK_CONNECTION_ID) {
    return `карточка юрлица выбрана · ArtHello OS проверяет только чтение счетов и короткой выписки · ограниченные права токена ${setup.readOnlyScopeConfirmed ? "подтверждены собственником" : "ещё не подтверждены"} · токен ${setup.secretStatus === "stored" ? "сохранён защищённо" : "не введён"} · данные и платежи не импортируются`;
  }
  return `с ${setup.startDate} · каждые ${setup.syncIntervalMinutes} мин. · ${setup.branchId || "филиал не выбран"}`;
}

function currentBankCapability(connectionId: string, capabilities: Data["capabilities"]) {
  if (connectionId === TOCHKA_CONNECTION_ID) return capabilities.canManageTochka;
  if (connectionId === TBANK_CONNECTION_ID) return capabilities.canManageTBank;
  return true;
}

function bankCredentialGuide(connectionId: string) {
  return connectionId === TBANK_CONNECTION_ID
    ? "https://developer.tbank.ru/docs/intro/manuals/self-service-auth"
    : "https://developers.tochka.com/docs/tochka-api/";
}

function friendlyAdapter(value: string) {
  const key = value.split("@")[0];
  const labels: Record<string, string> = {
    "tbank-h2h-readonly": "Защищённое подключение Т‑Банка только для чтения",
    "bank-tochka": "Защищённое подключение Точки",
    "d1-core": "Встроенное хранилище ArtHello OS",
    "xlsx-odds": "Импорт движения денег из таблицы",
    "xlsx-payroll": "Импорт зарплаты из таблицы",
    "xlsx-payments": "Импорт оплат из таблицы",
    alfacrm: "Подключение AlfaCRM",
    diary: "Подключение электронного дневника",
    edo: "Подключение электронного документооборота",
    "1c": "Подключение 1С",
    "openai-images": "Подключение создания изображений",
  };
  return labels[key] ?? "Подключение источника";
}

function humanSystemName(value: string) {
  return value
    .replace(/ArtHello OS D1/g, "Хранилище ArtHello OS")
    .replace(/OpenAI Images/g, "Создание изображений OpenAI");
}

function humanIntegrationText(value: string) {
  return humanTechnicalText(value)
    .replace(/ArtHello OS D1/g, "хранилище ArtHello OS")
    .replace(/D1 binding/gi, "хранилище данных")
    .replace(/\bD1\b/g, "хранилище данных")
    .replace(/API-ключ/gi, "ключ подключения")
    .replace(/\bAPI\b/g, "программный обмен")
    .replace(/webhook/gi, "приём событий")
    .replace(/OAuth(?:\s*2\.0)?/gi, "вход через сервис")
    .replace(/\bUTM\b/g, "рекламные метки")
    .replace(/Lead Ads/gi, "рекламные заявки")
    .replace(/first-click/gi, "первый рекламный переход")
    .replace(/\bsnapshot\b/gi, "снимок данных")
    .replace(/read\s*\/\s*write/gi, "чтение и запись")
    .replace(/read[ -]?only/gi, "только для чтения")
    .replace(/\bendpoint\b/gi, "адрес подключения")
    .replace(/\bpreflight\b/gi, "предварительная проверка")
    .replace(/\bJWT\b/g, "ключ Точки")
    .replace(/T[‑-]API/g, "систему Т‑Банка")
    .replace(/\bVMS\b/g, "система видеонаблюдения")
    .replace(/\bСКУД\b/g, "система контроля доступа")
    .replace(/\bROMI\b/g, "окупаемость рекламы");
}

function humanOwnerLabel(value: string) {
  if (/^(?:ROLE:OWNER|USR-OWNER)$/i.test(value)) return "Собственник";
  if (/(?:INT|INTEGRATION)/i.test(value)) return "Ответственный за интеграции";
  if (/(?:ACC|ACCOUNT)/i.test(value)) return "Бухгалтерия";
  if (/SALES/i.test(value)) return "Отдел продаж";
  if (/(?:MKT|MARKETING)/i.test(value)) return "Маркетинг";
  if (/METHOD/i.test(value)) return "Методист";
  if (/SAFE/i.test(value)) return "Ответственный за безопасность";
  return "Ответственный назначен";
}

function humanCheckpoint(value: string) {
  if (!value) return "контрольная точка не зафиксирована";
  const imported = /^accounts:(\d+);statements:(\d+);transactions:(\d+)$/i.exec(value);
  if (imported) return `счетов: ${imported[1]} · выписок: ${imported[2]} · операций: ${imported[3]}`;
  const accounts = /^accounts:(\d+)$/i.exec(value);
  if (accounts) return `проверено счетов: ${accounts[1]}`;
  const readonly = /^read-only:(\d+):(\d+)$/i.exec(value);
  if (readonly) return `проверено счетов: ${readonly[1]} · записей выписки: ${readonly[2]}`;
  const entities = /^entities:(\d+)$/i.exec(value);
  if (entities) return `проверено карточек: ${entities[1]}`;
  const period = /^period:(\d{4}-\d{2})$/i.exec(value);
  if (period) return `проверенный период: ${humanPeriodLabel(period[1])}`;
  if (/^D1:health:ok$/i.test(value)) return "хранилище отвечает";
  if (/^preflight:/i.test(value)) return "предварительная проверка доступа";
  return "контрольная точка зафиксирована";
}

function humanLogLevel(value: string) {
  if (/error|critical/i.test(value)) return "Ошибка";
  if (/warn/i.test(value)) return "Предупреждение";
  if (/success|ok/i.test(value)) return "Успешно";
  return "Информация";
}

function humanLogEvent(value: string) {
  const labels: Record<string, string> = {
    "health.verified": "Источник отвечает",
    "file.read": "Файл прочитан",
    "quality.conflict": "Обнаружено расхождение",
    "identity.conflict": "Нужно сверить совпадение",
    "freshness.stale": "Данные устарели",
    "auth.missing": "Не хватает ключа доступа",
    "retry.blocked": "Повторная проверка остановлена",
    "tochka.credential_rejected": "Точка отклонила ключ",
    "tochka.accounts_verified": "Доступ к счетам Точки подтверждён",
    "tochka.statements_imported": "Выписки и операции Точки загружены",
    "tochka.statements_pending": "Точка формирует выписки",
    "tbank.readonly_probe_rejected": "Т‑Банк отклонил проверку",
    "tbank.readonly_access_verified": "Доступ к данным Т‑Банка подтверждён",
  };
  return labels[value] ?? "Событие проверки";
}

function Head({ p, h, s }: { p: string; h: string; s: string }) {
  return <header className="integration-panel-head"><div><p>{p}</p><h2>{h}</h2></div><span>{s}</span></header>;
}

function State({ state }: { state: string }) {
  const label = state === "good" ? "Работает" : state === "bad" ? "Ошибка" : state === "paused" ? "На паузе" : state === "empty" ? "Не настроено" : "Требует внимания";
  return <i className={`connection-state state-${state}`} aria-label={label} />;
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div><dt>{k}</dt><dd>{v}</dd></div>;
}

function Empty({ title }: { title: string }) {
  return <EmptyState className="ahIntegrationEmpty" density="compact" title={title} description="Данные появятся после подтверждённой настройки или синхронизации." />;
}

function bankMoney(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toLocaleString("ru-RU")} ${currency}`;
  }
}

function readClientCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return "";
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ""; }
}
