"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
};

type IntegrationSetup = {
  connectionId: string;
  authMethod: string;
  startDate: string;
  syncIntervalMinutes: number;
  syncMinute: number;
  endpoint: string;
  branchId: string;
  accountScope: string;
  channelType: string;
  sourceMapping: string;
  dataScopes: string[];
  secretStatus: "missing" | "external_required";
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
        headers: { "content-type": "application/json", "x-arthello-role": roleCode },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as {
        error?: string;
        message?: string;
        blocked?: boolean;
        reused?: boolean;
        needsAccess?: boolean;
      };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.message ?? (
        payload.reused ? "Задача уже существует"
          : payload.needsAccess ? "Интеграция ждёт доступ — зелёный статус не установлен"
            : payload.blocked ? "Повтор заблокирован и записан в журнал"
              : "Действие выполнено и записано в аудит"
      ));
      await load();
      onTasksChanged();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Ошибка");
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

  if (loading) return <section className="integration-state">Проверяем подключения и журналы…</section>;
  if (error || !data) {
    return <section className="integration-state">
      <strong>{error}</strong>
      <small>Доступ разрешён владельцу, Представителю, интеграторам, финансам и бухгалтерии.</small>
      <button onClick={() => void load()}>Повторить</button>
    </section>;
  }

  if (!data.connections.length) {
    return <section className="page integration-workspace">
      <div className="integration-heading">
        <div><p className="eyebrow">Источники и правила загрузки</p><h1>Центр интеграций</h1><p>Подключения появятся только после явной настройки и подтверждения доступа.</p></div>
      </div>
      <div className="manual-module-empty"><span>＋</span><h2>Подключений пока нет</h2><p>Добавьте первый источник, когда будете готовы передавать данные в систему.</p></div>
    </section>;
  }

  const current = data.connections.find((item) => item.id === selected) ?? data.connections[0];

  return <section className="page integration-workspace">
    <div className="integration-heading">
      <div>
        <p className="eyebrow">Источники и правила загрузки</p>
        <h1>Центр интеграций</h1>
        <p>Авторизация, синхронизации, конфликты и влияние ошибок — без декоративных подключений.</p>
      </div>
      <button disabled={busy === "INT-T-D1"} onClick={() => void action({ action: "retrySync", connectionId: "INT-T-D1" }, "INT-T-D1")}>Проверить ядро</button>
    </div>

    <section className="integration-connect-start">
      <Head p="Пошаговая настройка" h="Подключить источник" s="секреты — только в защищённом хранилище" />
      <div>
        {[
          ["INT-T-TOCHKA", "Точка", "Выписки с выбранной даты · каждый час"],
          ["INT-T-ALFABANK", "Альфа-Банк", "Банковские операции и расписание"],
          ["INT-T-ALFACRM", "AlfaCRM", "Семьи, лиды, договоры и статусы"],
          ["INT-T-FORMS", "Сайт", "Webhook форм → воронка"],
          ["INT-T-SOCIAL", "Соцсети", "Публикации, метрики и UTM"],
          ["INT-T-TG", "Мессенджеры", "Telegram webhook и обращения"],
          ["INT-T-OPENAI-IMAGES", "OpenAI Images", "Генерация по описанию и референсу"],
        ].map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>
          <strong>{name}</strong><small>{note}</small><span>Настроить →</span>
        </button>)}
      </div>
    </section>

    <div className="integration-boundary"><strong>БЕЗ СЕКРЕТОВ</strong><span>{data.boundary}</span></div>
    <div className="integration-kpis">
      <button onClick={() => setTab("Каталог")}><span>Всего источников</span><strong>{data.summary.total}</strong><small>единый реестр</small></button>
      <button className="ok" onClick={() => setTab("Контур")}><span>Проверено online</span><strong>{data.summary.connected}</strong><small>реальная передача</small></button>
      <button onClick={() => setTab("Каталог")}><span>Файловые снимки</span><strong>{data.summary.snapshots}</strong><small>не live-подключение</small></button>
      <button className="warn" onClick={() => setTab("Конфликты")}><span>Открытые конфликты</span><strong>{data.summary.openConflicts}</strong><small>{data.summary.errors} ошибок запуска</small></button>
    </div>
    <div className="integration-tabs">
      {tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
    </div>

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
      <div className="integration-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти систему или модуль" />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
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
            <button disabled={busy === `test-${current.id}`} onClick={() => void action({ action: "retrySync", connectionId: current.id }, `test-${current.id}`)}>Проверить соединение</button>
            <button disabled={busy === `sync-${current.id}`} onClick={() => void action({ action: "retrySync", connectionId: current.id }, `sync-${current.id}`)}>Запустить синхронизацию</button>
            <button onClick={() => setTab("Журнал")}>Посмотреть журнал</button>
            <button onClick={() => setTab("Журнал")}>Посмотреть ошибки</button>
            <button disabled={busy === `reconnect-${current.id}` || current.id === "INT-T-D1"} onClick={() => void action({ action: "resumeConnection", connectionId: current.id }, `reconnect-${current.id}`)}>Переподключить</button>
            <button className="danger" disabled={busy === `state-${current.id}` || current.id === "INT-T-D1" || current.status === "На паузе"} onClick={() => void action({ action: "pauseConnection", connectionId: current.id }, `state-${current.id}`)}>Отключить</button>
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
          {item.status !== "Закрыт" ? <><button disabled={busy === `task-${item.id}`} onClick={() => void action({ action: "createConflictTask", conflictId: item.id }, `task-${item.id}`)}>Задача</button><button disabled={busy === `resolve-${item.id}`} onClick={() => void action({ action: "resolveConflict", conflictId: item.id, resolution: "Проверено владельцем источника; выбран подтверждённый вариант", evidence: `CONTROL:EVIDENCE:${item.id}` }, `resolve-${item.id}`)}>Закрыть с доказательством</button></> : <strong>{item.resolution}</strong>}
        </footer>
      </article>)}
      {!data.conflicts.length ? <div className="integration-empty-panel"><Empty title="Открытых конфликтов нет" /></div> : null}
    </div> : null}

    {tab === "Авторизация" ? <div className="auth-board">
      {data.connections.map((item) => <article key={item.id}>
        <header><State state={item.credentialState} /><span>{item.category}</span></header><h2>{item.system}</h2><p>{item.authStatus}</p>
        <dl><Fact k="Срок ключа" v={item.credentialExpiresAt || "Не задан"} /><Fact k="Передача проверена" v={item.verifiedTransfer ? "Да" : "Нет"} /><Fact k="Адаптер" v={item.adapterVersion} /></dl>
        <footer>Секретные значения не хранятся и не отображаются</footer>
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
        {data.setups[current.id] ? <div className="saved-setup"><strong>Параметры сохранены</strong><span>с {data.setups[current.id].startDate} · каждые {data.setups[current.id].syncIntervalMinutes} мин. · {data.setups[current.id].dataScopes?.join(", ") || "состав данных не выбран"} · секрет не передан</span></div> : null}
        <footer>
          <button onClick={() => { setDetailOpen(false); setWizardId(current.id); }}>Настроить подключение</button>
          <button onClick={() => { setDetailOpen(false); setTab("Журнал"); }}>Журнал</button>
          <button disabled={busy === `sync-${current.id}`} onClick={() => void action({ action: "retrySync", connectionId: current.id }, `sync-${current.id}`)}>Запустить синхронизацию</button>
          <button className="danger" disabled={current.id === "INT-T-D1"} onClick={() => void action({ action: "pauseConnection", connectionId: current.id }, `state-${current.id}`)}>Отключить</button>
        </footer>
      </section>
    </div> : null}

    {wizardId ? <ConnectionWizard
      connection={data.connections.find((item) => item.id === wizardId)}
      existing={data.setups[wizardId]}
      busy={busy === `setup-${wizardId}`}
      close={() => setWizardId("")}
      save={(setup) => void action({ action: "saveSetup", setup }, `setup-${wizardId}`).then(() => setWizardId(""))}
    /> : null}
  </section>;
}

function ConnectionWizard({ connection, existing, busy, close, save }: {
  connection?: Connection;
  existing?: IntegrationSetup;
  busy: boolean;
  close: () => void;
  save: (setup: Record<string, unknown>) => void;
}) {
  const [startDate, setStartDate] = useState(existing?.startDate ?? "2026-01-01");
  const [interval, setInterval] = useState(existing?.syncIntervalMinutes ?? 60);
  const [minute, setMinute] = useState(existing?.syncMinute ?? 5);
  const [authMethod, setAuthMethod] = useState(existing?.authMethod ?? (connection?.id === "INT-T-TOCHKA" ? "JWT" : "API"));
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? "");
  const [branchId, setBranchId] = useState(existing?.branchId ?? "");
  const [accountScope, setAccountScope] = useState(existing?.accountScope ?? "");
  const [channelType, setChannelType] = useState(existing?.channelType ?? "");
  const [sourceMapping, setSourceMapping] = useState(existing?.sourceMapping ?? "utm_source, utm_medium, utm_campaign, client_id");
  const [dataScopes, setDataScopes] = useState<string[]>(existing?.dataScopes ?? []);
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
  const tochkaRedirectUrl = "https://arthello-os.ozolin.chatgpt.site/api/integrations/tochka/callback";
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
    save({ connectionId, startDate, syncIntervalMinutes: interval, syncMinute: minute, authMethod, endpoint, branchId, accountScope, channelType, sourceMapping, dataScopes });
  }
  return <div className="integration-modal-layer">
    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройку" />
    <form className="setup-wizard" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <header><div><p>Безопасное подключение</p><h2 id="setup-title">{connection.system}</h2></div><button type="button" onClick={close}>×</button></header>
      <div className="setup-intro">
        <strong>{openai ? "Генерация включится после установки OPENAI_API_KEY" : "Сначала сохраняем параметры, затем секрет передаётся отдельно"}</strong>
        <span>{crm ? "Создайте отдельного пользователя v2api в AlfaCRM. Токен кэшируется, запросы ограничиваются 5 RPS." : connection.id === "INT-T-TOCHKA" ? "Для собственной компании рекомендуется JWT. Нужны права на счета, остатки, выписки и webhook." : bank ? "Выберите дату первой выписки и часовое расписание." : openai ? "Ключ не вводится в эту форму и не сохраняется в D1. Референсы отправляются только при нажатии «Создать»." : channelGuide}</span>
      </div>
      <div className="setup-grid">
        <fieldset className="wide setup-scopes"><legend>Какие данные получать</legend>{scopeOptions.map((scope) => <label key={scope}><input type="checkbox" checked={dataScopes.includes(scope)} onChange={(event) => setDataScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} /><span>{scope}</span></label>)}</fieldset>
        <label><span>Куда загружать</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)} required><option value="">Выберите филиал</option><option value="BR-KINDERGARTEN">Атлас — садик</option><option value="BR-ATLAS-SCHOOL">Атлас — школа</option><option value="BR-SCHOOL">1–11</option><option value="BR-NEBO">Небо</option><option value="BR-LISTVENNAYA">Лиственная</option></select></label>
        <label><span>Загружать данные с</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
        <label><span>Автосинхронизация</span><select value={interval} onChange={(event) => setInterval(Number(event.target.value))}><option value={60}>Каждый час</option><option value={180}>Каждые 3 часа</option><option value={360}>Каждые 6 часов</option><option value={1440}>Раз в сутки</option></select></label>
        <label><span>На какой минуте</span><input type="number" min="0" max="59" value={minute} onChange={(event) => setMinute(Number(event.target.value))} /></label>
        <label><span>Способ авторизации</span><select value={authMethod} onChange={(event) => setAuthMethod(event.target.value)}>{connection.id === "INT-T-TOCHKA" ? <><option>JWT</option><option>OAuth 2.0</option></> : <><option>API</option><option>OAuth 2.0</option><option>Webhook</option></>}</select></label>
        {crm || bank ? <label><span>{crm ? "URL AlfaCRM" : "ID / маска счетов"}</span><input value={crm ? endpoint : accountScope} onChange={(event) => crm ? setEndpoint(event.target.value) : setAccountScope(event.target.value)} placeholder={crm ? "https://имя.alfacrm.pro" : "Все расчётные счета"} /></label> : null}
        {crm ? <label><span>ID филиала в AlfaCRM</span><input value={accountScope} onChange={(event) => setAccountScope(event.target.value)} placeholder="branch_id из AlfaCRM" /></label> : null}
        {connection.id === "INT-T-TOCHKA" ? <label className="wide"><span>Redirect URL для приложения Точки</span><input readOnly value={tochkaRedirectUrl} onFocus={(event) => event.currentTarget.select()} aria-describedby="tochka-redirect-help" /><small id="tochka-redirect-help">Скопируйте этот HTTPS-адрес в поле Redirect URL кабинета Точки. Адрес останется тем же после подключения банка.</small></label> : null}
        {!crm && !bank && !openai ? <><label><span>Канал</span><input value={channelType} onChange={(event) => setChannelType(event.target.value)} placeholder="Сайт / VK / Telegram" /></label><label><span>Webhook / endpoint</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://…" /></label></> : null}
        {!openai ? <label className="wide"><span>Поля и атрибуция</span><textarea value={sourceMapping} onChange={(event) => setSourceMapping(event.target.value)} /></label> : null}
      </div>
      <div className="secret-boundary"><strong>Секрет не запрашивается</strong><span>После сохранения администратор добавляет JWT/API key как защищённую переменную окружения. До этого тест соединения честно вернёт блокировку.</span></div>
      <footer>{docs ? <a href={docs} target="_blank" rel="noreferrer">Официальная инструкция ↗</a> : <span />}
        <div><button type="button" onClick={close}>Отмена</button><button disabled={busy || !dataScopes.length}>{busy ? "Сохраняем…" : "Сохранить выбор и расписание"}</button></div>
      </footer>
    </form>
  </div>;
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
  return <div className="integration-empty"><span>○</span><p>{title}</p></div>;
}
