"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./AlfaCrmSetupWizard.css";

type ModuleKey = "families" | "staff" | "groups" | "lessons" | "subscriptions" | "finance";
type ModuleState = {
  status: "not_started" | "previewed" | "importing" | "imported" | "error";
  previewCount: number;
  importedCount: number;
  lastPreviewAt: string;
  lastImportAt: string;
  previewToken: string;
  previewSignature: string;
  dateFrom: string;
  dateTo: string;
  cursor: number;
  note: string;
};
type AlfaState = {
  version: 1;
  connected: boolean;
  endpoint: string;
  emailMasked: string;
  hasAppKey: boolean;
  connectedAt: string;
  lastCheckedAt: string;
  remoteBranches: Array<{ id: string; name: string }>;
  branchMappings: Record<string, string>;
  modules: Record<ModuleKey, ModuleState>;
};
type AlfaPayload = {
  state: AlfaState;
  localBranches: Array<{ id: string; name: string }>;
  credentialStored: boolean;
  canManage: boolean;
  canManageCredentials: boolean;
  direction: string;
  boundary: string;
  error?: string;
};
type ActionResponse = Partial<AlfaPayload> & {
  state?: AlfaState;
  error?: string;
  message?: string;
  count?: number;
  countUnit?: string;
  previewToken?: string;
  complete?: boolean;
  nextCursor?: number;
};

type ModuleDefinition = {
  key: ModuleKey;
  order: number;
  title: string;
  description: string;
  dependsOn: ModuleKey[];
  kind: "current" | "period" | "transition" | "chunked";
};

const modules: ModuleDefinition[] = [
  { key: "families", order: 1, title: "Семьи и дети", description: "Только активные клиенты выбранных филиалов. Исторические архивы автоматически не подтягиваются.", dependsOn: [], kind: "current" },
  { key: "staff", order: 2, title: "Сотрудники", description: "Действующие педагоги. Карточки создаются без выдачи доступа в ArtHello OS.", dependsOn: [], kind: "current" },
  { key: "groups", order: 3, title: "Классы и группы", description: "Действующие группы и членство детей. Педагоги уже должны быть загружены.", dependsOn: ["staff"], kind: "current" },
  { key: "lessons", order: 4, title: "Расписание и занятия", description: "Только выбранный период. Никакой выгрузки занятий за всё время существования AlfaCRM.", dependsOn: ["staff", "groups"], kind: "period" },
  { key: "subscriptions", order: 5, title: "Абонементы и текущие остатки", description: "Читаются только по уже импортированным клиентам. Большой объём идёт безопасными пакетами.", dependsOn: ["families"], kind: "chunked" },
  { key: "finance", order: 6, title: "Оплаты с даты перехода", description: "CRM-движения с выбранной даты. Они хранятся отдельно от банковского ДДС, чтобы деньги не задвоились.", dependsOn: ["families"], kind: "transition" },
];

function emptyModule(): ModuleState {
  return { status: "not_started", previewCount: 0, importedCount: 0, lastPreviewAt: "", lastImportAt: "", previewToken: "", previewSignature: "", dateFrom: "", dateTo: "", cursor: 0, note: "" };
}

function emptyState(): AlfaState {
  return {
    version: 1,
    connected: false,
    endpoint: "",
    emailMasked: "",
    hasAppKey: false,
    connectedAt: "",
    lastCheckedAt: "",
    remoteBranches: [],
    branchMappings: {},
    modules: {
      families: emptyModule(), staff: emptyModule(), groups: emptyModule(),
      lessons: emptyModule(), subscriptions: emptyModule(), finance: emptyModule(),
    },
  };
}

export function AlfaCrmSetupWizard({ roleCode, close, notify }: {
  roleCode: string;
  close: () => void;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [payload, setPayload] = useState<AlfaPayload>({
    state: emptyState(), localBranches: [], credentialStored: false, canManage: false, canManageCredentials: false,
    direction: "AlfaCRM → ArtHello OS", boundary: "Только чтение",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [connectionEdit, setConnectionEdit] = useState(false);
  const [connection, setConnection] = useState({ endpoint: "https://arthellonew.s20.online", email: "", apiKey: "", appKey: "" });
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const defaults = useMemo(() => defaultDates(), []);
  const [periods, setPeriods] = useState<Record<ModuleKey, { dateFrom: string; dateTo: string; transitionDate: string }>>({
    families: { dateFrom: "", dateTo: "", transitionDate: "" },
    staff: { dateFrom: "", dateTo: "", transitionDate: "" },
    groups: { dateFrom: "", dateTo: "", transitionDate: "" },
    lessons: { dateFrom: defaults.lessonFrom, dateTo: defaults.lessonTo, transitionDate: "" },
    subscriptions: { dateFrom: "", dateTo: "", transitionDate: "" },
    finance: { dateFrom: "", dateTo: "", transitionDate: defaults.transitionDate },
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [close]);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations/alfacrm", { cache: "no-store", credentials: "include", headers: { "x-arthello-role": roleCode } });
      const body = await response.json() as AlfaPayload;
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить настройки AlfaCRM");
      applyPayload(body);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось загрузить AlfaCRM", "error");
    } finally {
      setLoading(false);
      window.setTimeout(() => dialogRef.current?.focus(), 0);
    }
  }

  function applyPayload(next: Partial<AlfaPayload> & { state?: AlfaState }) {
    setPayload((current) => ({ ...current, ...next, state: next.state ?? current.state }));
    if (next.state) {
      setMappings(next.state.branchMappings ?? {});
      setConnection((current) => ({ ...current, endpoint: next.state?.endpoint || current.endpoint }));
      setPeriods((current) => ({
        ...current,
        lessons: {
          ...current.lessons,
          dateFrom: next.state?.modules.lessons.dateFrom || current.lessons.dateFrom,
          dateTo: next.state?.modules.lessons.dateTo || current.lessons.dateTo,
        },
        finance: {
          ...current.finance,
          transitionDate: next.state?.modules.finance.dateFrom || current.finance.transitionDate,
        },
      }));
    }
  }

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/integrations/alfacrm", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-arthello-role": roleCode,
          "x-arthello-csrf": readCookie("arthello_csrf"),
        },
        body: JSON.stringify(body),
      });
      const result = await response.json() as ActionResponse;
      if (!response.ok) throw new Error(result.error || "Действие AlfaCRM не выполнено");
      if (result.state) applyPayload({ state: result.state });
      if (result.message) notify(result.message, "success");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Действие AlfaCRM не выполнено";
      notify(message, "error");
      return { error: message } as ActionResponse;
    } finally {
      setBusy("");
    }
  }

  const state = payload.state;
  const mappedCount = Object.values(state.branchMappings).filter(Boolean).length;
  const step = !state.connected ? 1 : mappedCount === 0 ? 2 : 3;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="ahIntegrationModalLayer ahAlfaCrmLayer">
      <button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть настройку AlfaCRM" />
      <section ref={dialogRef} className="ahAlfaCrmWizard" role="dialog" aria-modal="true" aria-labelledby="alfacrm-wizard-title" tabIndex={-1}>
        <header className="ahAlfaCrmHeader">
          <div>
            <p>БЕЗОПАСНОЕ ПОДКЛЮЧЕНИЕ</p>
            <h2 id="alfacrm-wizard-title">AlfaCRM</h2>
            <span>{payload.direction} · без обратной записи</span>
          </div>
          <button type="button" className="ahAlfaCrmClose" onClick={close} aria-label="Закрыть">×</button>
        </header>

        <div className="ahAlfaCrmStepper" aria-label="Этапы настройки">
          <Step index={1} title="Подключение" active={step === 1} complete={state.connected} />
          <Step index={2} title="Филиалы" active={step === 2} complete={state.connected && mappedCount > 0} />
          <Step index={3} title="Данные" active={step === 3} complete={modules.every((module) => state.modules[module.key].status === "imported")} />
        </div>

        <div className="ahAlfaCrmBody">
          {loading ? <div className="ahAlfaCrmLoading">Загружаю настройки подключения…</div> : null}

          {!loading ? <section className="ahAlfaCrmPanel">
            <div className="ahAlfaCrmPanelHeading">
              <div>
                <span className="ahAlfaCrmEyebrow">1 · Подключение</span>
                <h3>Сначала только проверяем доступ</h3>
                <p>На этом шаге ArtHello OS не загружает семьи, занятия или оплаты. Авторизация v2api выполняется по e-mail и ключу API; X-APP-KEY можно передать дополнительно, если он используется в вашем аккаунте.</p>
              </div>
              {state.connected ? <StatusBadge status="connected" text="Подключено" /> : <StatusBadge status="waiting" text="Не подключено" />}
            </div>

            {state.connected && !connectionEdit ? <div className="ahAlfaCrmConnectionSummary">
              <div><small>Адрес AlfaCRM</small><strong>{state.endpoint}</strong></div>
              <div><small>Пользователь</small><strong>{state.emailMasked || "Скрыт"}</strong></div>
              <div><small>X-APP-KEY</small><strong>{state.hasAppKey ? "Сохранён" : "Не используется"}</strong></div>
              <div><small>Последняя проверка</small><strong>{formatDateTime(state.lastCheckedAt)}</strong></div>
              <div className="ahAlfaCrmSummaryActions">
                <button type="button" disabled={!payload.canManage || Boolean(busy)} onClick={() => void post({ action: "refreshBranches" }, "refresh")}>{busy === "refresh" ? "Проверяю…" : "Проверить соединение"}</button>
                {payload.canManageCredentials ? <button type="button" className="secondary" onClick={() => setConnectionEdit(true)}>Заменить ключи</button> : null}
              </div>
            </div> : payload.canManageCredentials ? <form className="ahAlfaCrmConnectForm" onSubmit={(event) => {
              event.preventDefault();
              void post({ action: "connect", ...connection }, "connect").then((result) => { if (!result.error) { setConnection({ endpoint: connection.endpoint, email: "", apiKey: "", appKey: "" }); setConnectionEdit(false); } });
            }}>
              <label><span>Адрес AlfaCRM</span><input required inputMode="url" value={connection.endpoint} onChange={(event) => setConnection({ ...connection, endpoint: event.target.value })} placeholder="https://arthellonew.s20.online" /><small>Только адрес аккаунта, без /v2api и без параметров.</small></label>
              <label><span>E-mail пользователя AlfaCRM</span><input required type="email" autoComplete="username" value={connection.email} onChange={(event) => setConnection({ ...connection, email: event.target.value })} placeholder="user@example.ru" /></label>
              <label><span>Ключ API (v2api)</span><input required type="password" autoComplete="new-password" value={connection.apiKey} onChange={(event) => setConnection({ ...connection, apiKey: event.target.value })} placeholder="Вставьте ключ из карточки пользователя" /><small>Сохраняется только в зашифрованном хранилище и после сохранения не показывается.</small></label>
              <label><span>X-APP-KEY · если используется</span><input type="password" autoComplete="new-password" value={connection.appKey} onChange={(event) => setConnection({ ...connection, appKey: event.target.value })} placeholder="Можно оставить пустым" /></label>
              <div className="ahAlfaCrmFormActions">
                {state.connected ? <button type="button" className="secondary" onClick={() => setConnectionEdit(false)}>Отмена</button> : null}
                <button type="submit" disabled={Boolean(busy)}>{busy === "connect" ? "Проверяю AlfaCRM…" : "Проверить и подключить"}</button>
              </div>
            </form> : <p>Подключение и замену ключей выполняет собственник.</p>}
          </section> : null}

          {!loading && state.connected ? <section className="ahAlfaCrmPanel">
            <div className="ahAlfaCrmPanelHeading">
              <div>
                <span className="ahAlfaCrmEyebrow">2 · Филиалы</span>
                <h3>Выберите, какие филиалы вообще участвуют</h3>
                <p>Пустое сопоставление означает: этот филиал AlfaCRM не трогаем. До сохранения сопоставлений никакие рабочие данные не загружаются.</p>
              </div>
              <StatusBadge status={mappedCount ? "connected" : "waiting"} text={mappedCount ? `Выбрано: ${mappedCount}` : "Нужно сопоставить"} />
            </div>
            <div className="ahAlfaCrmBranchTable" role="table" aria-label="Сопоставление филиалов">
              <div className="ahAlfaCrmBranchRow header" role="row"><span>Филиал в AlfaCRM</span><span>Куда в ArtHello OS</span></div>
              {state.remoteBranches.map((branch) => <div className="ahAlfaCrmBranchRow" role="row" key={branch.id}>
                <div><strong>{branch.name}</strong><small>ID AlfaCRM: {branch.id}</small></div>
                <select disabled={!payload.canManageCredentials} value={mappings[branch.id] ?? ""} onChange={(event) => setMappings({ ...mappings, [branch.id]: event.target.value })}>
                  <option value="">Не загружать этот филиал</option>
                  {payload.localBranches.map((local) => <option key={local.id} value={local.id}>{local.name}</option>)}
                </select>
              </div>)}
            </div>
            {!payload.localBranches.length ? <div className="ahAlfaCrmWarning">В ArtHello OS нет активных филиалов для сопоставления. Сначала создайте их в настройках структуры.</div> : null}
            <div className="ahAlfaCrmPanelActions"><button type="button" disabled={!payload.canManageCredentials || Boolean(busy) || !Object.values(mappings).some(Boolean)} onClick={() => void post({ action: "saveBranchMappings", mappings }, "mapping")}>{busy === "mapping" ? "Сохраняю…" : "Сохранить сопоставление филиалов"}</button></div>
          </section> : null}

          {!loading && state.connected && mappedCount > 0 ? <section className="ahAlfaCrmPanel ahAlfaCrmDataPanel">
            <div className="ahAlfaCrmPanelHeading">
              <div>
                <span className="ahAlfaCrmEyebrow">3 · Выборочная загрузка</span>
                <h3>Никакой кнопки «слить всё»</h3>
                <p>Каждый блок сначала считает записи, ничего не меняя. После проверки количества появляется безопасный импорт именно этого блока.</p>
              </div>
              <StatusBadge status="info" text="Только выбранные данные" />
            </div>
            <div className="ahAlfaCrmModules">
              {modules.map((definition) => <ModuleCard
                key={definition.key}
                definition={definition}
                state={state}
                period={periods[definition.key]}
                setPeriod={(period) => setPeriods({ ...periods, [definition.key]: period })}
                busy={busy}
                canManage={payload.canManage}
                preview={() => post(moduleRequest("previewModule", definition, periods[definition.key]), `preview-${definition.key}`)}
                importData={() => post({ ...moduleRequest("importModule", definition, periods[definition.key]), previewToken: state.modules[definition.key].previewToken }, `import-${definition.key}`)}
              />)}
            </div>
            <div className="ahAlfaCrmReadOnlyNote"><strong>Что будет дальше</strong><span>После успешной первичной загрузки каждого модуля можно подключать его инкрементальную автосинхронизацию. Пока она намеренно не включается автоматически: сначала нужно проверить фактические связи и количество данных.</span></div>
          </section> : null}
        </div>

        <footer className="ahAlfaCrmFooter">
          <div><strong>Секреты защищены</strong><span>{payload.boundary}</span></div>
          <div>
            {state.connected && payload.canManageCredentials ? <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => {
              if (window.confirm("Удалить доступ AlfaCRM из ArtHello OS? Уже импортированные данные останутся.")) void post({ action: "disconnect" }, "disconnect");
            }}>{busy === "disconnect" ? "Отключаю…" : "Отключить AlfaCRM"}</button> : null}
            <button type="button" className="secondary" onClick={close}>Закрыть</button>
          </div>
        </footer>
      </section>
    </div>, document.body,
  );
}

function ModuleCard({ definition, state, period, setPeriod, busy, canManage, preview, importData }: {
  definition: ModuleDefinition;
  state: AlfaState;
  period: { dateFrom: string; dateTo: string; transitionDate: string };
  setPeriod: (value: { dateFrom: string; dateTo: string; transitionDate: string }) => void;
  busy: string;
  canManage: boolean;
  preview: () => Promise<ActionResponse>;
  importData: () => Promise<ActionResponse>;
}) {
  const moduleState = state.modules[definition.key];
  const dependencyMissing = definition.dependsOn.find((key) => state.modules[key].status !== "imported");
  const previewBusy = busy === `preview-${definition.key}`;
  const importBusy = busy === `import-${definition.key}`;
  const canImport = canManage && Boolean(moduleState.previewToken) && !dependencyMissing;
  const imported = moduleState.status === "imported";
  return <article className={`ahAlfaCrmModule ${imported ? "complete" : ""}`}>
    <div className="ahAlfaCrmModuleTop">
      <span className="ahAlfaCrmModuleNumber">{definition.order}</span>
      <div><h4>{definition.title}</h4><p>{definition.description}</p></div>
      <ModuleStatus state={moduleState} />
    </div>

    {definition.kind === "period" ? <div className="ahAlfaCrmPeriodFields">
      <label><span>Занятия с</span><input type="date" value={period.dateFrom} onChange={(event) => setPeriod({ ...period, dateFrom: event.target.value })} /></label>
      <label><span>по</span><input type="date" value={period.dateTo} onChange={(event) => setPeriod({ ...period, dateTo: event.target.value })} /></label>
    </div> : null}
    {definition.kind === "transition" ? <div className="ahAlfaCrmTransitionField">
      <label><span>Дата перехода</span><input type="date" value={period.transitionDate} onChange={(event) => setPeriod({ ...period, transitionDate: event.target.value })} /></label>
      <p>До этой даты движения не импортируются. Исторический депозит на прошлую дату система не выдумывает: текущие остатки абонементов загружаются отдельным предыдущим блоком.</p>
    </div> : null}

    {dependencyMissing ? <div className="ahAlfaCrmDependency">Сначала завершите: {moduleTitle(dependencyMissing)}.</div> : null}
    {moduleState.status === "error" ? <div className="ahAlfaCrmWarning">{moduleState.note || "Загрузка не завершена. Повторите предпросмотр."}</div> : null}
    {moduleState.status === "previewed" ? <div className="ahAlfaCrmPreviewResult"><strong>Найдено: {moduleState.previewCount}</strong><span>Проверено без записи в ArtHello OS.</span></div> : null}
    {moduleState.status === "importing" ? <div className="ahAlfaCrmPreviewResult"><strong>Загружено записей: {moduleState.importedCount}</strong><span>{moduleState.note || "Продолжите пакетную загрузку."}</span></div> : null}
    {imported ? <div className="ahAlfaCrmPreviewResult success"><strong>Загружено: {moduleState.importedCount}</strong><span>{moduleState.note || `Последняя загрузка: ${formatDateTime(moduleState.lastImportAt)}`}</span></div> : null}

    <div className="ahAlfaCrmModuleActions">
      <button type="button" className="secondary" disabled={!canManage || Boolean(busy) || Boolean(dependencyMissing)} onClick={() => void preview()}>{previewBusy ? "Считаю…" : imported ? "Пересчитать" : "Проверить данные"}</button>
      <button type="button" disabled={Boolean(busy) || !canImport} onClick={() => void importData()}>{importBusy ? "Загружаю…" : moduleState.status === "importing" ? "Продолжить загрузку" : imported ? "Обновить выбранный блок" : "Импортировать"}</button>
    </div>
  </article>;
}

function Step({ index, title, active, complete }: { index: number; title: string; active: boolean; complete: boolean }) {
  return <div className={`ahAlfaCrmStep ${active ? "active" : ""} ${complete ? "complete" : ""}`}><span>{complete ? "✓" : index}</span><strong>{title}</strong></div>;
}

function StatusBadge({ status, text }: { status: "connected" | "waiting" | "info"; text: string }) {
  return <span className={`ahAlfaCrmStatus ${status}`}>{text}</span>;
}

function ModuleStatus({ state }: { state: ModuleState }) {
  if (state.status === "error") return <span className="ahAlfaCrmModuleStatus waiting">Требует проверки</span>;
  if (state.status === "imported") return <span className="ahAlfaCrmModuleStatus complete">Загружено</span>;
  if (state.status === "importing") return <span className="ahAlfaCrmModuleStatus progress">В процессе</span>;
  if (state.status === "previewed") return <span className="ahAlfaCrmModuleStatus preview">Проверено</span>;
  return <span className="ahAlfaCrmModuleStatus waiting">Не загружено</span>;
}

function moduleRequest(action: "previewModule" | "importModule", definition: ModuleDefinition, period: { dateFrom: string; dateTo: string; transitionDate: string }) {
  return {
    action,
    module: definition.key,
    ...(definition.kind === "period" ? { dateFrom: period.dateFrom, dateTo: period.dateTo } : {}),
    ...(definition.kind === "transition" ? { transitionDate: period.transitionDate } : {}),
  };
}

function moduleTitle(module: ModuleKey) {
  return modules.find((definition) => definition.key === module)?.title ?? module;
}

function defaultDates() {
  const now = new Date();
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lessonFrom = new Date(current); lessonFrom.setDate(lessonFrom.getDate() - 7);
  const lessonTo = new Date(current); lessonTo.setDate(lessonTo.getDate() + 120);
  const transitionYear = current.getMonth() >= 7 ? current.getFullYear() : current.getFullYear() - 1;
  return { lessonFrom: localDate(lessonFrom), lessonTo: localDate(lessonTo), transitionDate: `${transitionYear}-09-01` };
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: string) {
  if (!value) return "Ещё не проверялось";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}
