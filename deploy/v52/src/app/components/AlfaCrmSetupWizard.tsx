"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DiaryDirectoryPanel } from './DiaryDirectoryPanel';
import { runChunkedAlfaImport, ALFA_AUTO_MODULES, type AlfaAutosync } from "../../lib/alfacrm-import";
import "./AlfaCrmSetupWizard.css";

type ModuleKey = "families" | "staff" | "groups" | "lessons" | "subscriptions" | "finance";
type ModuleState = {
  scopeContract?: string;
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
  autosync?: AlfaAutosync;
  version: 1;
  connected: boolean;
  endpoint: string;
  emailMasked: string;
  hasAppKey: boolean;
  connectedAt: string;
  lastCheckedAt: string;
  remoteBranches: Array<{ id: string; name: string }>;
  branchMappings: Record<string, string>;
  educationRouting?: Record<string, string>;
  modules: Record<ModuleKey, ModuleState>;
  legacyDraft?: { remoteBranchId: string; localBranchId: string; startDate: string; dataScopes: string[] };
};
type ScopeAudit = { source:string; note:string; familyCardsByStatus:Array<{status:string;count:number}>; modules:Record<string,{observed:number;accepted:number;foreignBranch:number;inactive:number;unknown:number;uniqueCustomers:number;lastObservedAt:string;byBranch:Record<string,number>}> };
type AlfaPayload = {
  scopeAudit?: ScopeAudit;
  autosyncAvailable?: boolean;
  state: AlfaState;
  localBranches: Array<{ id: string; name: string }>;
  credentialStored: boolean;
  importEnabled: boolean;
  importBlockedReason: string;
  canManage: boolean;
  canManageCredentials: boolean;
  direction: string;
  boundary: string;
  error?: string;
};
type ActionResponse = Partial<AlfaPayload> & {
  legacyMigration?: { token: string; count: number; complete: boolean };
  educationGroups?: Array<{ key: string; sourceBranch: string; name: string; localBranch: string }>;
  customerPreview?: CustomerPreview;
  state?: AlfaState;
  error?: string;
  message?: string;
  count?: number;
  countUnit?: string;
  previewToken?: string;
  complete?: boolean;
  nextCursor?: number;
  rejected?: number;
  projectionBlocked?: boolean;
};

type CustomerPreview = {
  comparison?: { archiveIds:string[]; preservedArchiveIds:string[]; reviewIds:string[]; updateIds:string[]; moves:Array<{id:string;from:string;to:string}>; newSourceKeys:string[] };
  observedAt: string; branchNames: Record<string, string>;
  byBranch: Record<string, { observed: number; included: number; active: number; open: number; single: number; leads: number; excluded: number; review: number }>;
  includedAssignments: number; uniqueIncludedCustomerIds: number;
  excludedStatus: number; excludedLifecycle: number; foreignBranch: number; unknown: number; duplicates: number;
  intersections: Array<{id: string; branches: string[]}>;
  schoolAssignments: Array<{id: string; branch: string}>;
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
  const [autoModules, setAutoModules] = useState<string[]>(['families', 'staff', 'groups']);
  const [payload, setPayload] = useState<AlfaPayload>({
    state: emptyState(), localBranches: [], credentialStored: false, canManage: false, canManageCredentials: false,
    importEnabled: false, importBlockedReason: "",
    direction: "AlfaCRM → ArtHello OS", boundary: "Только чтение",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [customerPreview, setCustomerPreview] = useState<CustomerPreview | null>(null);
  const [legacyMigration, setLegacyMigration] = useState<ActionResponse['legacyMigration']>();
  const [educationGroups, setEducationGroups] = useState<ActionResponse['educationGroups']>();
  const [routingDraft, setRoutingDraft] = useState<Record<string, string>>({});
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

  async function auditBranches() {
    setBusy("scopeAudit");
    try {
      const response=await fetch("/api/integrations/alfacrm?scopeAudit=1",{cache:"no-store"});
      const body=await response.json() as AlfaPayload;
      if(!response.ok)throw new Error(body.error||"Сверка недоступна");
      applyPayload(body);
    }catch(error){notify(error instanceof Error?error.message:"Сверка недоступна","error")}finally{setBusy("")}
  }

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

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Initial connector state is intentionally loaded only once when the modal mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/integrations/alfacrm", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-arthello-role": roleCode,
        "x-csrf-token": readCookie("__Host-arthello_csrf"),
      },
      body: JSON.stringify(body),
    });
    const result = await response.json() as ActionResponse;
    if (!response.ok) throw new Error(result.error || "Действие AlfaCRM не выполнено");
    return result;
  }

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const result = await request(body);
      if (result.educationGroups) { setEducationGroups(result.educationGroups); setRoutingDraft(payload.state.educationRouting ?? {}); }
      if (result.state) setCustomerPreview(null);
      if (result.customerPreview) setCustomerPreview(result.customerPreview);
      if (result.legacyMigration) setLegacyMigration(result.legacyMigration);
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

  async function importData(definition: ModuleDefinition, period: { dateFrom: string; dateTo: string; transitionDate: string }, previewToken: string) {
    const key = `import-${definition.key}`;
    const body = { ...moduleRequest("importModule", definition, period), previewToken };
    setBusy(key);
    try {
      const result = definition.kind === "chunked"
        ? await runChunkedAlfaImport(
          () => request(body),
          (batch) => { if (batch.state) applyPayload({ state: batch.state }); },
        )
        : await request(body);
      if (definition.kind !== "chunked" && result.state) applyPayload({ state: result.state });
      if (result.error) throw new Error(result.error);
      if (result.message) notify(result.message, Number(result.rejected) > 0 || result.projectionBlocked ? "error" : "success");
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
          {!loading && !payload.importEnabled && payload.importBlockedReason ? <div className="ahAlfaCrmWarning">{payload.importBlockedReason}</div> : null}

          {!loading ? <section className="ahAlfaCrmPanel">
            <div className="ahAlfaCrmPanelHeading">
              <div>
                <span className="ahAlfaCrmEyebrow">1 · Подключение</span>
                <h3>Сначала только проверяем доступ</h3>
                <p>На этом шаге ArtHello OS не загружает семьи, занятия или оплаты. Авторизация v2api выполняется по e-mail и ключу API; X-APP-KEY можно передать дополнительно, если он используется в вашем аккаунте.</p>
              </div>
              {state.connected ? <StatusBadge status="connected" text="Подключено" /> : <StatusBadge status="waiting" text="Не подключено" />}
            </div>

            {state.legacyDraft ? <div className="ahAlfaCrmReadOnlyNote">
              <strong>Ранее сохранённый выбор</strong>
              <span>Филиал AlfaCRM: {state.legacyDraft.remoteBranchId || "не выбран"} → {payload.localBranches.find((branch) => branch.id === state.legacyDraft?.localBranchId)?.name || "филиал ArtHello OS недоступен"}. Данные с {state.legacyDraft.startDate || "неуказанной даты"}. {state.legacyDraft.dataScopes.join(", ")}.</span>
              {!state.connected ? <span>Старая форма сохраняла параметры подключения. Доступ проверяется ниже; сопоставление восстановится, если оба филиала доступны.</span> : <span>Каждый нужный модуль запускается отдельно после предпросмотра.</span>}
            </div> : null}

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
            {payload.canManageCredentials?<div><button type="button" disabled={Boolean(busy)} onClick={()=>void auditBranches()}>{busy==="scopeAudit"?"Сверяю…":"Сверить сохранённые данные по филиалам"}</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => { setCustomerPreview(null); void post({ action: 'previewCustomers' }, 'customerPreview'); }}>{busy === 'customerPreview' ? 'Читаю Альфу…' : 'Проверить клиентов без применения'}</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void post({ action: 'previewEducationRouting' }, 'educationRouting')}>Разнести учебные группы</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void post({ action: 'previewLegacyMigration' }, 'legacyMigration')}>Проверить историю старого импорта</button>
              {legacyMigration ? <div role="status"><p>Записей старого импорта: {legacyMigration.count}. {legacyMigration.complete ? 'История сохранена и проверена.' : 'Перед повторной загрузкой нужно сохранить историю старого импорта.'}</p>
                {!legacyMigration.complete ? <button type="button" disabled={Boolean(busy)} onClick={() => void post({ action: 'migrateLegacySources', token: legacyMigration.token }, 'legacyMigration')}>Сохранить историю импорта</button> : null}
              </div> : null}
              {educationGroups ? <section aria-label="Разнесение учебных групп">
                <p>Выберите филиал ОС для каждой группы. Исходные ID Альфы сохранятся; изменения применятся при следующей загрузке семей и групп.</p>
                <div style={{ maxHeight: 360, overflow: 'auto' }}><table><thead><tr><th>Группа Альфы</th><th>Исходный филиал</th><th>Филиал ОС</th></tr></thead><tbody>{educationGroups.map(group => <tr key={group.key}>
                  <td>{group.name}</td><td>{state.remoteBranches.find(branch => branch.id === group.sourceBranch)?.name ?? group.sourceBranch}</td>
                  <td><select aria-label={`Филиал для ${group.name}`} disabled={Boolean(busy)} value={routingDraft[group.key] ?? state.branchMappings[group.sourceBranch]} onChange={event => setRoutingDraft(current => { const next = { ...current }; if (event.target.value === state.branchMappings[group.sourceBranch]) delete next[group.key]; else next[group.key] = event.target.value; return next; })}>
                    {payload.localBranches.filter(branch => Object.values(state.branchMappings).includes(branch.id)).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select></td></tr>)}</tbody></table></div>
                <button type="button" disabled={Boolean(busy)} onClick={() => void post({ action: 'saveEducationRouting', routing: routingDraft }, 'saveEducationRouting')}>Сохранить разнесение групп</button>
              </section> : null}
              <DiaryDirectoryPanel busy={Boolean(busy)} branches={payload.localBranches.filter(branch=>['BR-SCHOOL','BR-ATLAS-SCHOOL'].includes(branch.id)&&Object.values(state.branchMappings).includes(branch.id))} onAction={body=>post(body,'diaryDirectory')}/>
              {customerPreview ? <div role="status">
                <p>Сверка источника: {customerPreview.observedAt}. Данные ОС не изменены.</p>
                <table><thead><tr><th>Филиал Альфы</th><th>Активные</th><th>Открыто</th><th>Разовые</th><th>Запись</th><th>Исключены по статусу</th><th>На сверку</th></tr></thead><tbody>
                  {Object.entries(customerPreview.byBranch).map(([id, row]) => <tr key={id}><td>{customerPreview.branchNames[id] ?? id}</td><td>{row.active}</td><td>{row.open}</td><td>{row.single}</td><td>{row.leads}</td><td>{row.excluded}</td><td>{row.review}</td></tr>)}
                </tbody></table>
                <p>Включено назначений: {customerPreview.includedAssignments}. Уникальных ID клиентов: {customerPreview.uniqueIncludedCustomerIds}. Это не количество семей.</p>
                <p>Межфилиальных пересечений по ID: {customerPreview.intersections.length}. Чужой филиал: {customerPreview.foreignBranch}. Исключены по состоянию записи: {customerPreview.excludedLifecycle}. Не подтверждено: {customerPreview.unknown}. Повторов: {customerPreview.duplicates}.</p>
                <p>Школьных назначений для проверки разнесения: {customerPreview.schoolAssignments.length}.</p>
                {customerPreview.comparison ? <p>Предварительный план по карточкам ОС: обновить {customerPreview.comparison.updateIds.length}; создать исходных связей {customerPreview.comparison.newSourceKeys.length}; перенести в другой филиал {customerPreview.comparison.moves.length}; архивировать исходных связей {customerPreview.comparison.archiveIds.length}; сохранить ручной архив {customerPreview.comparison.preservedArchiveIds.length}; требуют сверки {customerPreview.comparison.reviewIds.length}. Изменения не применены.</p> : null}
              </div> : null}
              {payload.scopeAudit?<div role="status"><p>{payload.scopeAudit.source}. {payload.scopeAudit.note}</p>
                <table><thead><tr><th>Раздел</th><th>Записей</th><th>В своём филиале</th><th>Чужой филиал</th><th>Неактивные</th><th>Не подтверждено</th></tr></thead><tbody>
                {Object.entries(payload.scopeAudit.modules).map(([key,row])=><tr key={key}><td>{modules.find(m=>m.key===key)?.title??key}</td><td>{row.observed}</td><td>{row.accepted}</td><td>{row.foreignBranch}</td><td>{row.inactive}</td><td>{row.unknown}</td></tr>)}
                </tbody></table>
                <p>Карточки семей в ОС: {payload.scopeAudit.familyCardsByStatus.map(row=>`${row.status}: ${row.count}`).join("; ")}. Это карточки, а не подтверждённое число действующих семей.</p>
                {payload.scopeAudit.modules.families?<p>Уникальные ID клиентов с подтверждённым филиалом: {payload.scopeAudit.modules.families.uniqueCustomers}. Последний сохранённый ответ: {payload.scopeAudit.modules.families.lastObservedAt||"нет"}.</p>:null}
              </div>:null}</div>:null}
            <div className="ahAlfaCrmPanelActions"><button type="button" disabled={!payload.canManageCredentials || Boolean(busy) || !Object.values(mappings).some(Boolean)} onClick={() => void post({ action: "saveBranchMappings", mappings }, "mapping")}>{busy === "mapping" ? "Сохраняю…" : "Сохранить сопоставление филиалов"}</button></div>
          </section> : null}

          {!loading && state.connected && mappedCount > 0 ? <section className="ahAlfaCrmPanel">
            <div className="ahAlfaCrmPanelHeading"><div>
              <h3>Автоматическое обновление</h3>
              <p>Обновление из AlfaCRM каждый час после завершения предыдущего цикла. Доступы выдаются отдельно.</p>
            </div><StatusBadge status={state.autosync?.enabled ? 'connected' : 'info'} text={state.autosync?.enabled ? 'Включено' : 'Остановлено'} /></div>
            <p>Последний полный цикл: {state.autosync?.lastSuccessAt ? new Date(state.autosync.lastSuccessAt).toLocaleString('ru-RU') : 'Ещё не завершён'}.
              {state.autosync?.enabled ? ` Следующий шаг: ${new Date(state.autosync.nextAt).toLocaleString('ru-RU')}.` : ''}</p>
            {state.autosync?.outcome === 'retry' ? <p role="status">Временная ошибка. Повтор запланирован; попыток: {state.autosync.failures}.</p> : null}
            {state.autosync?.outcome === 'paused' ? <p role="status">Обновление остановлено. Проверьте данные и журнал перед включением.</p> : null}
            {!payload.autosyncAvailable ? <p>Фоновое обновление ещё не подключено на сервере.</p> : null}
            {ALFA_AUTO_MODULES.map(key => <label key={key} style={{ display: 'block' }}>
              <input type="checkbox" checked={state.autosync?.enabled ? state.autosync.modules.includes(key) : autoModules.includes(key)}
                disabled={!payload.canManageCredentials || Boolean(state.autosync?.enabled) || (state.modules[key].status !== 'imported' || state.modules[key].scopeContract !== 'source-branch-membership-v1')}
                onChange={e => setAutoModules(current => e.target.checked ? [...current, key] : current.filter(m => m !== key))} />
              {modules.find(m => m.key === key)?.title}{(state.modules[key].status !== 'imported' || state.modules[key].scopeContract !== 'source-branch-membership-v1') ? ' — первичная загрузка не завершена' : ''}
            </label>)}
            <div className="ahAlfaCrmPanelActions">
              <button type="button" disabled={!payload.canManageCredentials || Boolean(busy) || (!state.autosync?.enabled && (!payload.autosyncAvailable || !autoModules.length || autoModules.some(key => (state.modules[key as ModuleKey].status !== 'imported' || state.modules[key as ModuleKey].scopeContract !== 'source-branch-membership-v1'))))}
                onClick={() => void post({ action: 'setAutosync', enabled: !state.autosync?.enabled, modules: autoModules }, 'autosync')}>
                {state.autosync?.enabled ? 'Остановить обновление' : 'Включить обновление'}</button>
              <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void load()}>Обновить статус</button>
            </div>
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
                canManage={payload.canManage && !state.autosync?.enabled}
                importEnabled={payload.importEnabled}
                preview={() => post(moduleRequest("previewModule", definition, periods[definition.key]), `preview-${definition.key}`)}
                importData={() => importData(definition, periods[definition.key], state.modules[definition.key].previewToken)}
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

function ModuleCard({ definition, state, period, setPeriod, busy, canManage, importEnabled, preview, importData }: {
  definition: ModuleDefinition;
  state: AlfaState;
  period: { dateFrom: string; dateTo: string; transitionDate: string };
  setPeriod: (value: { dateFrom: string; dateTo: string; transitionDate: string }) => void;
  busy: string;
  canManage: boolean;
  importEnabled: boolean;
  preview: () => Promise<ActionResponse>;
  importData: () => Promise<ActionResponse>;
}) {
  const moduleState = state.modules[definition.key];
  const dependencyMissing = definition.dependsOn.find((key) => state.modules[key].status !== "imported");
  const previewBusy = busy === `preview-${definition.key}`;
  const importBusy = busy === `import-${definition.key}`;
  const canImport = importEnabled && canManage && Boolean(moduleState.previewToken) && !dependencyMissing;
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
      <button type="button" disabled={Boolean(busy) || !canImport} onClick={() => void importData()}>{importBusy ? "Загружаю автоматически…" : moduleState.status === "importing" ? "Продолжить автоматически" : imported ? "Обновить выбранный блок" : "Импортировать"}</button>
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
