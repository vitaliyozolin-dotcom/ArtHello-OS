"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, SearchField, Tabs } from "./design-system";
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
  };
};

type IntegrationSetup = {
  connectionId: string;
  authMethod: string;
  startDate: string;
  syncIntervalMinutes: number;
  syncMinute: number;
  endpoint: string;
  legalEntityId: string;
  customerCode: string;
  branchId: string;
  allocationMode: "single_branch" | "classify_transactions";
  accountScope: string;
  channelType: string;
  sourceMapping: string;
  dataScopes: string[];
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
  const [busy, setBusy] = useState("");
  const roleCode = roles[role] ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations", {
        cache: "no-store",
        headers: { "x-arthello-role": roleCode },
      });
      const payload = await response.json() as Data & { error?: string };
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

  async function action(body: Record<string, unknown>, key: string) {
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
      const payload = await response.json() as {
        error?: string;
        message?: string;
        blocked?: boolean;
        reused?: boolean;
        needsAccess?: boolean;
        customerChoices?: Array<{ code: string; name: string }>;
      };
      if (!response.ok) {
        const choices = payload.customerChoices?.map((customer) => (
          customer.name ? `${customer.code} — ${customer.name}` : customer.code
        )).join("; ");
        throw new Error(`${payload.error ?? "Ошибка"}${choices ? ` Доступны: ${choices}` : ""}`);
      }
      notify(payload.message ?? (
        payload.reused ? "Задача уже существует"
          : payload.needsAccess ? "Интеграция ждёт доступ — зелёный статус не установлен"
            : payload.blocked ? "Повтор заблокирован и записан в журнал"
              : "Действие выполнено и записано в аудит"
      ));
      await load();
      onTasksChanged();
      return true;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Ошибка");
      return false;
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
  const currentTochkaAllowed = current?.id !== TOCHKA_CONNECTION_ID || data.capabilities.canManageTochka;
  const canManageCurrentSetup = data.capabilities.canManageSetup && currentTochkaAllowed;
  const canRunCurrent = data.capabilities.canRun && currentTochkaAllowed;
  const canChangeCurrentState = data.capabilities.canChangeState && currentTochkaAllowed;

  return <PageContainer className="ahIntegrationPage">
    <PageHeader
      eyebrow="ИСТОЧНИКИ · ПРАВИЛА ЗАГРУЗКИ · КОНТРОЛЬ"
      title="Центр интеграций"
      description="Авторизация, синхронизации, конфликты и влияние ошибок — без декоративных подключений."
      actions={data.capabilities.canRun ? <Button variant="primary" disabled={busy === "INT-T-D1"} onClick={() => data.connections.some((item) => item.id === "INT-T-D1") ? void action({ action: "retrySync", connectionId: "INT-T-D1" }, "INT-T-D1") : void load()}>{data.connections.length ? "Проверить ядро" : "Обновить контур"}</Button> : undefined}
    />

    {data.capabilities.canManageSetup ? <Card className="integration-connect-start">
      <Head p="Пошаговая настройка" h="Подключить источник" s="секреты — только в защищённом хранилище" />
      <div>
        {[
          ["INT-T-TOCHKA", "Точка", "JWT и список доступных счетов"],
          ["INT-T-ALFABANK", "Альфа-Банк", "Банковские операции и расписание"],
          ["INT-T-ALFACRM", "AlfaCRM", "Семьи, лиды, договоры и статусы"],
          ["INT-T-FORMS", "Сайт", "Webhook форм → воронка"],
          ["INT-T-SOCIAL", "Соцсети", "Публикации, метрики и UTM"],
          ["INT-T-TG", "Мессенджеры", "Telegram webhook и обращения"],
          ["INT-T-OPENAI-IMAGES", "OpenAI Images", "Генерация по описанию и референсу"],
        ].filter(([id]) => id !== TOCHKA_CONNECTION_ID || data.capabilities.canManageTochka).map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>
          <strong>{name}</strong><small>{note}</small><span>Настроить →</span>
        </button>)}
      </div>
    </Card> : null}

    <Card className="ahIntegrationBoundary"><strong>ЗАЩИЩЁННЫЙ КОНТУР</strong><span>{data.boundary}</span></Card>
    <div className="ahIntegrationKpis">
      <KpiCard label="Всего источников" value={String(data.summary.total)} note="единый реестр" onClick={() => setTab("Каталог")} />
      <KpiCard className="ahIntegrationKpiOk" label="Проверено online" value={String(data.summary.connected)} note="реальная передача" onClick={() => setTab("Контур")} />
      <KpiCard label="Файловые снимки" value={String(data.summary.snapshots)} note="не live-подключение" onClick={() => setTab("Каталог")} />
      <KpiCard className="ahIntegrationKpiWarning" label="Открытые конфликты" value={String(data.summary.openConflicts)} note={`${data.summary.errors} ошибок запуска`} onClick={() => setTab("Конфликты")} />
    </div>
    <div className="ahIntegrationTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы центра интеграций" /></div>

    {tab === "Контур" ? <div className="integration-overview">
      <article className="integration-map">
        <Head p="Фактическое состояние" h="Поток данных" s={`${data.summary.accepted} записей принято`} />
        <div className="integration-flow"><span>Источник</span><i>авторизация</i><span>Адаптер</span><i>валидация</i><span>D1</span><i>конфликт</i><span>Задача</span></div>
        <div className="integration-critical">
          {data.connections.filter((item) => item.impact.startsWith("Критичное")).map((item) => <button key={item.id} onClick={() => { setSelected(item.id); setTab("Каталог"); }}>
            <State state={item.connection.state} />
            <span><strong>{item.system}</strong><small>{item.impact}</small></span>
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
            <strong>{data.connections.find((item) => item.id === run.connectionId)?.system}</strong>
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
            <span><strong>{item.system}</strong><small>{item.category} · {item.targetModule}</small></span>
            <em>{item.connection.label}</em><b>{item.receivedCount}/{item.acceptedCount}</b>
          </button>)}
          {!visible.length ? <Empty title="В каталоге пока нет подключений" /> : null}
        </div>
        {current ? <aside className="connection-detail">
          <header><div><p>{current.id} · {current.adapterVersion}</p><h2>{current.system}</h2></div><State state={current.connection.state} /></header>
          <p className="connection-impact">{current.impact}</p>
          <dl>
            <Fact k="Статус" v={current.status} /><Fact k="Владелец" v={current.ownerEntityId} />
            <Fact k="Источник истины" v={current.sourceOfTruth} /><Fact k="Режим" v={current.mode} />
            <Fact k="Последний успех" v={current.lastSuccessAt || "Никогда"} /><Fact k="Следующая синхронизация" v={current.nextSyncAt || "Не запланирована"} />
            <Fact k="Получено / принято" v={`${current.receivedCount} / ${current.acceptedCount}`} /><Fact k="Отклонено / ошибок / конфликтов" v={`${current.rejectedCount} / ${current.errorCount} / ${current.conflictCount}`} />
          </dl>
          <div className="connection-actions">
            {canRunCurrent ? <><button disabled={busy === `test-${current.id}`} onClick={() => void action({ action: "testConnection", connectionId: current.id }, `test-${current.id}`)}>{current.id === TOCHKA_CONNECTION_ID ? "Проверить JWT и customerCode" : "Проверить соединение"}</button><button disabled={busy === `sync-${current.id}`} onClick={() => void action({ action: "retrySync", connectionId: current.id }, `sync-${current.id}`)}>{current.id === TOCHKA_CONNECTION_ID ? "Обновить список счетов" : "Запустить синхронизацию"}</button></> : null}
            <button onClick={() => setTab("Журнал")}>Посмотреть журнал</button>
            <button onClick={() => setTab("Журнал")}>Посмотреть ошибки</button>
            {canChangeCurrentState ? <><button disabled={busy === `reconnect-${current.id}` || current.id === "INT-T-D1"} onClick={() => void action({ action: "resumeConnection", connectionId: current.id }, `reconnect-${current.id}`)}>Переподключить</button><button className="danger" disabled={busy === `state-${current.id}` || current.id === "INT-T-D1" || current.status === "На паузе"} onClick={() => void action({ action: "pauseConnection", connectionId: current.id }, `state-${current.id}`)}>Отключить</button></> : null}
          </div>
        </aside> : <div className="integration-empty-panel"><Empty title="Выберите подключение" /></div>}
      </div>
    </> : null}

    {tab === "Журнал" ? <div className="integration-run-list">
      {data.runs.map((run) => <article key={run.id}>
        <header><div><p>{run.id}</p><h2>{data.connections.find((item) => item.id === run.connectionId)?.system}</h2></div><span className={run.status === "Успешно" ? "good" : run.status === "Заблокировано" ? "bad" : "warn"}>{run.status}</span></header>
        <div className="run-stats">
          <span><small>Получено</small><strong>{run.receivedCount}</strong></span><span><small>Принято</small><strong>{run.acceptedCount}</strong></span><span><small>Отклонено</small><strong>{run.rejectedCount}</strong></span><span><small>Ошибки</small><strong>{run.errorCount}</strong></span><span><small>Конфликты</small><strong>{run.conflictCount}</strong></span>
        </div>
        <p>{run.trigger} · {run.checkpoint || "без checkpoint"}{run.dryRun ? " · preflight" : ""}</p>
        {run.errorMessage ? <strong className="run-error">{run.errorMessage}</strong> : null}
        <div className="run-logs">{data.logs.filter((log) => log.runId === run.id).map((log) => <div key={log.id}><em>{log.level}</em><span><strong>{log.event}</strong><small>{log.message}</small></span><code>{log.recordRef}</code></div>)}</div>
      </article>)}
      {!data.runs.length ? <div className="integration-empty-panel"><Empty title="Журнал пока пуст" /></div> : null}
    </div> : null}

    {tab === "Конфликты" ? <div className="conflict-board">
      {data.conflicts.map((item) => <article key={item.id} className={item.status === "Закрыт" ? "closed" : ""}>
        <header><span>{item.conflictType}</span><em>{item.status}</em></header><h2>{item.fieldName}</h2>
        <p>{data.connections.find((connection) => connection.id === item.connectionId)?.system} · {item.externalRecordId}</p>
        <div><span><small>Источник</small><strong>{item.sourceValue}</strong></span><span><small>В системе</small><strong>{item.targetValue}</strong></span></div>
        <footer><small>{item.ownerEntityId}{item.relatedTaskId ? ` · задача #${item.relatedTaskId}` : ""}</small>
          {item.status !== "Закрыт" ? data.capabilities.canResolve && (item.connectionId !== TOCHKA_CONNECTION_ID || data.capabilities.canManageTochka) ? <><button disabled={busy === `task-${item.id}`} onClick={() => void action({ action: "createConflictTask", conflictId: item.id }, `task-${item.id}`)}>Задача</button><button disabled={busy === `resolve-${item.id}`} onClick={() => void action({ action: "resolveConflict", conflictId: item.id, resolution: "Проверено владельцем источника; выбран подтверждённый вариант", evidence: `CONTROL:EVIDENCE:${item.id}` }, `resolve-${item.id}`)}>Закрыть с доказательством</button></> : <span>Только просмотр</span> : <strong>{item.resolution}</strong>}
        </footer>
      </article>)}
      {!data.conflicts.length ? <div className="integration-empty-panel"><Empty title="Открытых конфликтов нет" /></div> : null}
    </div> : null}

    {tab === "Авторизация" ? <div className="auth-board">
      {data.connections.map((item) => <article key={item.id}>
        <header><State state={item.credentialState} /><span>{item.category}</span></header><h2>{item.system}</h2><p>{item.authStatus}</p>
        <dl><Fact k="Срок ключа" v={item.credentialExpiresAt || "Не задан"} /><Fact k="Передача проверена" v={item.verifiedTransfer ? "Да" : "Нет"} /><Fact k="Адаптер" v={item.adapterVersion} /></dl>
        <footer>{item.id === TOCHKA_CONNECTION_ID ? <><span>JWT хранится только в зашифрованном виде и никогда не отображается</span>{data.capabilities.canManageTochka && data.setups[item.id]?.secretStatus === "stored" ? <button className="danger" disabled={busy === `revoke-${item.id}`} onClick={() => { if (window.confirm("Отозвать JWT Точки? Сохранённый ключ будет удалён, а проверку счетов потребуется пройти заново.")) void action({ action: "revokeCredential", connectionId: item.id }, `revoke-${item.id}`); }}>Отозвать JWT</button> : null}</> : "Секретные значения передаются через защищённый runtime-контур"}</footer>
      </article>)}
      {!data.connections.length ? <div className="integration-empty-panel"><Empty title="Авторизации появятся после добавления источника" /></div> : null}
    </div> : null}

    {current && detailOpen ? <div className="integration-modal-layer">
      <button className="drawer-scrim" onClick={() => setDetailOpen(false)} aria-label="Закрыть подключение" />
      <section className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-modal-title">
        <header><div><p>{current.id} · {current.adapterVersion}</p><h2 id="connection-modal-title">{current.system}</h2></div><button onClick={() => setDetailOpen(false)} aria-label="Закрыть">×</button></header>
        <p className="connection-impact">{current.impact}</p>
        <dl>
          <Fact k="Статус" v={current.status} /><Fact k="Авторизация" v={current.authStatus} />
          <Fact k="Источник истины" v={current.sourceOfTruth} /><Fact k="Режим" v={current.mode} />
          <Fact k="Последний успех" v={current.lastSuccessAt || "Никогда"} /><Fact k="Следующая синхронизация" v={current.nextSyncAt || "Не запланирована"} />
          <Fact k="Получено / принято" v={`${current.receivedCount} / ${current.acceptedCount}`} /><Fact k="Ошибки / конфликты" v={`${current.errorCount} / ${current.conflictCount}`} />
        </dl>
        {data.setups[current.id] ? <div className="saved-setup"><strong>Параметры сохранены</strong><span>{savedSetupSummary(current.id, data.setups[current.id])}</span></div> : null}
        <footer>
          {canManageCurrentSetup ? <button onClick={() => { setDetailOpen(false); setWizardId(current.id); }}>Настроить подключение</button> : null}
          <button onClick={() => { setDetailOpen(false); setTab("Журнал"); }}>Журнал</button>
          {canRunCurrent ? <button disabled={busy === `sync-${current.id}`} onClick={() => void action({ action: "retrySync", connectionId: current.id }, `sync-${current.id}`)}>{current.id === TOCHKA_CONNECTION_ID ? "Обновить список счетов" : "Запустить синхронизацию"}</button> : null}
          {canChangeCurrentState ? <button className="danger" disabled={current.id === "INT-T-D1"} onClick={() => void action({ action: "pauseConnection", connectionId: current.id }, `state-${current.id}`)}>Отключить</button> : null}
        </footer>
      </section>
    </div> : null}

    {wizardId && data.capabilities.canManageSetup && (wizardId !== TOCHKA_CONNECTION_ID || data.capabilities.canManageTochka) ? <ConnectionWizard
      connection={data.connections.find((item) => item.id === wizardId)}
      existing={data.setups[wizardId]}
      legalEntities={data.legalEntities}
      branches={data.branches}
      busy={busy === `setup-${wizardId}`}
      canManageCredentials={data.capabilities.canManageCredentials}
      close={() => setWizardId("")}
      save={async (setup, credential) => {
        const saved = await action({ action: "saveSetup", setup, ...(credential ? { credential } : {}) }, `setup-${wizardId}`);
        if (saved) setWizardId("");
      }}
    /> : null}
  </PageContainer>;
}

function ConnectionWizard({ connection, existing, legalEntities, branches, busy, canManageCredentials, close, save }: {
  connection?: Connection;
  existing?: IntegrationSetup;
  legalEntities: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  busy: boolean;
  canManageCredentials: boolean;
  close: () => void;
  save: (setup: Record<string, unknown>, credential: string) => Promise<void>;
}) {
  const [startDate, setStartDate] = useState(existing?.startDate ?? "2026-01-01");
  const [interval, setInterval] = useState(existing?.syncIntervalMinutes ?? 60);
  const [minute, setMinute] = useState(existing?.syncMinute ?? 5);
  const [authMethod, setAuthMethod] = useState(existing?.authMethod ?? (connection?.id === "INT-T-TOCHKA" ? "JWT" : "API"));
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? "");
  const [legalEntityId, setLegalEntityId] = useState(existing?.legalEntityId ?? "");
  const [customerCode, setCustomerCode] = useState(existing?.customerCode ?? "");
  const [branchId, setBranchId] = useState(existing?.branchId ?? "");
  const [allocationMode, setAllocationMode] = useState<"single_branch" | "classify_transactions">(existing?.allocationMode ?? "classify_transactions");
  const [accountScope, setAccountScope] = useState(existing?.accountScope ?? "");
  const [channelType, setChannelType] = useState(existing?.channelType ?? "");
  const [sourceMapping, setSourceMapping] = useState(existing?.sourceMapping ?? "utm_source, utm_medium, utm_campaign, client_id");
  const [dataScopes, setDataScopes] = useState<string[]>(existing?.dataScopes ?? []);
  const [credential, setCredential] = useState("");
  const tochkaRedirectUrl = useMemo(
    () => typeof window === "undefined" ? "/api/integrations/tochka/callback" : `${window.location.origin}/api/integrations/tochka/callback`,
    [],
  );
  if (!connection) return null;
  const connectionId = connection.id;
  const bank = connection.id === "INT-T-TOCHKA" || connection.id === "INT-T-ALFABANK";
  const crm = connection.id === "INT-T-ALFACRM";
  const openai = connection.id === "INT-T-OPENAI-IMAGES";
  const scopeOptions = bank
    ? ["Операции по счетам", "Остатки", "Счета", "Контрагенты", "Назначения платежей"]
    : crm
      ? ["Семьи", "Дети", "Сотрудники", "Классы и группы", "Расписание", "Занятия", "Абонементы и договоры", "Начисления и оплаты", "Лиды и статусы"]
      : openai
        ? ["Созданные изображения"]
        : ["Обращения", "Контакты", "Согласия", "UTM и источник", "Публикации", "Метрики контента"];
  const tochka = connection.id === "INT-T-TOCHKA";
  const credentialStoredForSelection = existing?.secretStatus === "stored"
    && existing.legalEntityId === legalEntityId
    && existing.customerCode === customerCode;
  const credentialRequired = tochka && authMethod === "JWT" && canManageCredentials && !credentialStoredForSelection;
  const docs = connection.id === "INT-T-TOCHKA" ? "https://developers.tochka.com/docs/tochka-api/" : connection.id === "INT-T-ALFACRM" ? "https://alfacrm.pro/knowledge/integration/api" : openai ? "https://platform.openai.com/docs/guides/image-generation" : "";
  const channelGuide = connection.id === "INT-T-FORMS"
    ? "Укажите адрес обработчика формы сайта и сопоставьте телефон, имя, согласие и UTM. После установки ingest-secret заявка будет создаваться в первом этапе воронки."
    : connection.id === "INT-T-SOCIAL"
      ? "Выберите соцсеть и OAuth/API endpoint. Сохраняйте campaign, creative и UTM, чтобы публикация раскрывалась до заявки и оплаты."
      : connection.id === "INT-T-TG"
        ? "Создайте отдельного Telegram-бота, укажите webhook и канал. Bot token передаётся только как защищённая переменная."
        : "Укажите канал, endpoint webhook и правила атрибуции.";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({
      connectionId,
      startDate: tochka ? "" : startDate,
      syncIntervalMinutes: tochka ? 0 : interval,
      syncMinute: tochka ? 0 : minute,
      authMethod,
      endpoint,
      legalEntityId,
      customerCode,
      branchId,
      allocationMode,
      accountScope: bank ? "all_permitted" : accountScope,
      channelType,
      sourceMapping,
      dataScopes: tochka ? ["Счета"] : dataScopes,
    }, credential);
  }
  return <div className="integration-modal-layer">
    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройку" />
    <form className="setup-wizard ahIntegrationSetupWizard" data-ah-help-root="true" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <header><div><p>Безопасное подключение</p><h2 id="setup-title">{connection.system}</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
      <div className="setup-intro">
        <strong>{tochka ? "Один JWT для выбранной карточки юрлица — не отдельный ключ на каждый счёт или филиал" : openai ? "Генерация включится после установки OPENAI_API_KEY" : "Настройте источник и расписание загрузки"}</strong>
        <span>{crm ? "Создайте отдельного пользователя v2api в AlfaCRM. Токен кэшируется, запросы ограничиваются 5 RPS." : tochka ? "Проверка запросит все счета, доступные этому JWT, и покажет их количество. Банк не подтверждает их принадлежность выбранной карточке — это сверяет владелец. Выписки и операции сейчас не загружаются." : bank ? "Выберите юридическое лицо, дату первой выписки и расписание." : openai ? "Ключ не вводится в эту форму и не сохраняется в D1. Референсы отправляются только при нажатии «Создать»." : channelGuide}</span>
      </div>
      <div className="setup-grid">
        {tochka ? <div className="wide ahIntegrationRoutingNote" role="note"><strong>Сейчас проверяется только доступ к счетам</strong><span>Загрузка выписок, расписание синхронизации и правила распределения операций ещё не запущены. Режим распределения ниже сохраняется как черновик.</span></div> : <fieldset className="wide setup-scopes"><legend>Какие данные получать</legend>{scopeOptions.map((scope) => <label key={scope}><input type="checkbox" checked={dataScopes.includes(scope)} onChange={(event) => setDataScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} /><span>{scope}</span></label>)}</fieldset>}
        {bank ? <label><span>Карточка юридического лица</span><select value={legalEntityId} onChange={(event) => setLegalEntityId(event.target.value)} required disabled={!legalEntities.length}><option value="">{legalEntities.length ? "Выберите юрлицо" : "Сначала создайте карточку юрлица"}</option>{legalEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name} · {entity.id}</option>)}</select><small>Можно выбрать только существующую карточку юрлица. Банк подтверждает customerCode и доступные ключу счета; соответствие внутренней карточке фиксирует собственник.</small></label> : <label><span>Куда загружать</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)} required><option value="">Выберите филиал</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        {tochka ? <label><span>customerCode Точки</span><input value={customerCode} onChange={(event) => setCustomerCode(event.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9._:-]{1,79}" placeholder="Определить по JWT" aria-describedby="tochka-customer-code-help" /><small id="tochka-customer-code-help">customerCode обязателен для завершения. Если банк вернёт один код, система выберет его автоматически; если несколько — покажет безопасный список для выбора.</small></label> : null}
        {bank ? <label><span>Расчётные счета</span><input readOnly value="Все счета, разрешённые JWT" aria-readonly="true" /><small>Новый JWT для каждого счёта не нужен.</small></label> : null}
        {bank ? <label className="wide"><span>Распределение по филиалам</span><select value={allocationMode} onChange={(event) => setAllocationMode(event.target.value === "single_branch" ? "single_branch" : "classify_transactions")}><option value="classify_transactions">Несколько филиалов — классифицировать операции</option><option value="single_branch">Один филиал по умолчанию</option></select><small>{allocationMode === "classify_transactions" ? "После настройки правил операции можно будет классифицировать по назначению платежа и контрагенту; неопределённые должны оставаться в очереди «Требует разбора»." : "После запуска импорта новые операции можно будет сначала относить к одному выбранному филиалу."}</small></label> : null}
        {bank && allocationMode === "single_branch" ? <label><span>Филиал по умолчанию</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)} required disabled={!branches.length}><option value="">{branches.length ? "Выберите филиал" : "Нет действующих филиалов"}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
        {bank && allocationMode === "classify_transactions" ? <div className="wide ahIntegrationRoutingNote" role="note"><strong>Смешанные поступления допустимы</strong><span>Один счёт может принимать деньги школы и садика. Настройка не закрепляет такой счёт за одним филиалом; до появления проверенных правил сомнительные операции нельзя разносить автоматически.</span></div> : null}
        {!tochka ? <><label><span>Загружать данные с</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label><span>Автосинхронизация</span><select value={interval} onChange={(event) => setInterval(Number(event.target.value))}><option value={60}>Каждый час</option><option value={180}>Каждые 3 часа</option><option value={360}>Каждые 6 часов</option><option value={1440}>Раз в сутки</option></select></label><label><span>На какой минуте</span><input type="number" min="0" max="59" value={minute} onChange={(event) => setMinute(Number(event.target.value))} /></label></> : null}
        <label><span>Способ авторизации</span><select value={authMethod} onChange={(event) => setAuthMethod(event.target.value)}>{connection.id === "INT-T-TOCHKA" ? <><option>JWT</option><option value="OAuth 2.0" disabled>OAuth 2.0 — пока недоступен</option></> : <><option>API</option><option>OAuth 2.0</option><option>Webhook</option></>}</select></label>
        {crm ? <label><span>URL AlfaCRM</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://имя.alfacrm.pro" /></label> : null}
        {crm ? <label><span>ID филиала в AlfaCRM</span><input value={accountScope} onChange={(event) => setAccountScope(event.target.value)} placeholder="branch_id из AlfaCRM" /></label> : null}
        {tochka && authMethod === "JWT" && canManageCredentials ? <label className="wide"><span>JWT-ключ Точки</span><input type="password" value={credential} onChange={(event) => setCredential(event.target.value)} required={credentialRequired} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={credentialStoredForSelection ? "Ключ уже сохранён — оставьте пустым, чтобы не менять" : "Вставьте готовый JWT"} aria-describedby="tochka-jwt-help" /><small id="tochka-jwt-help">Ключ сначала проверяется запросом списка счетов. Только после успешной проверки он шифруется и больше не показывается.</small></label> : null}
        {tochka && authMethod === "OAuth 2.0" ? <label className="wide"><span>Redirect URL для приложения Точки</span><input readOnly value={tochkaRedirectUrl} onFocus={(event) => event.currentTarget.select()} aria-describedby="tochka-redirect-help" /><small id="tochka-redirect-help">Скопируйте этот HTTPS-адрес в поле Redirect URL кабинета Точки. Для готового JWT это поле не требуется.</small></label> : null}
        {!crm && !bank && !openai ? <><label><span>Канал</span><input value={channelType} onChange={(event) => setChannelType(event.target.value)} placeholder="Сайт / VK / Telegram" /></label><label><span>Webhook / endpoint</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://…" /></label></> : null}
        {!openai && !bank ? <label className="wide"><span>Поля и атрибуция</span><textarea value={sourceMapping} onChange={(event) => setSourceMapping(event.target.value)} /></label> : null}
      </div>
      <div className="secret-boundary"><strong>{tochka && authMethod === "JWT" ? "JWT защищён" : "Секреты защищены"}</strong><span>{tochka && authMethod === "JWT" ? "В интерфейс и API-ответы ключ не возвращается. Зашифрованная версия хранится по связке Точка + выбранная карточка юрлица + подтверждённый банком customerCode — не для отдельного счёта или филиала. Связь customerCode с внутренней карточкой подтверждает владелец." : "Секретные значения передаются отдельно от обычных параметров и никогда не отображаются после сохранения."}</span></div>
      <footer>{docs ? <a href={docs} target="_blank" rel="noreferrer">Официальная инструкция ↗</a> : <span />}
        <div><button type="button" onClick={close}>Отмена</button><button disabled={busy || (tochka && authMethod !== "JWT") || (!tochka && !dataScopes.length) || (bank && (!legalEntityId || !legalEntities.length)) || (bank && allocationMode === "single_branch" && (!branchId || !branches.length)) || (credentialRequired && !credential)}>{busy ? "Проверяем…" : tochka && authMethod === "JWT" ? credential ? "Сохранить JWT и проверить доступные счета" : "Сохранить черновик без проверки банка" : "Сохранить выбор и расписание"}</button></div>
      </footer>
    </form>
  </div>;
}

function savedSetupSummary(connectionId: string, setup: IntegrationSetup) {
  if (connectionId === "INT-T-TOCHKA") {
    const allocation = setup.allocationMode === "classify_transactions"
      ? "черновик классификации по филиалам с ручным разбором"
      : `черновик одного филиала: ${setup.branchId || "не выбран"}`;
    return `выбранная карточка юрлица: ${setup.legalEntityId || "не указана"} · customerCode: ${setup.customerCode || "ещё не подтверждён"} · все счета, доступные JWT · ${allocation} · JWT ${setup.secretStatus === "stored" ? "сохранён защищённо" : "не введён"} · выписки и операции не загружаются`;
  }
  return `с ${setup.startDate} · каждые ${setup.syncIntervalMinutes} мин. · ${setup.branchId || "филиал не выбран"}`;
}

function Head({ p, h, s }: { p: string; h: string; s: string }) {
  return <header className="integration-panel-head"><div><p>{p}</p><h2>{h}</h2></div><span>{s}</span></header>;
}

function State({ state }: { state: string }) {
  return <i className={`connection-state state-${state}`} aria-label={state} />;
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div><dt>{k}</dt><dd>{v}</dd></div>;
}

function Empty({ title }: { title: string }) {
  return <EmptyState className="ahIntegrationEmpty" density="compact" title={title} description="Данные появятся после подтверждённой настройки или синхронизации." />;
}

function readClientCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return "";
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ""; }
}
