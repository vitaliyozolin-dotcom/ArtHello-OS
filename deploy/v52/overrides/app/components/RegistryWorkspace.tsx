"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { entityTypes, relationTypes } from "../../lib/registry";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, SearchField, Tabs } from "./design-system";
import "./RegistryWorkspace.ds.css";

type EntityRecord = {
  id: string;
  entityType: string;
  displayName: string;
  status: string;
  sourceSystem: string;
  sourceRecordId: string;
  dataQuality: string;
  scope: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type RegistryStats = { total: number; needsReview: number; duplicateGroups: number; sources: number };
type EntityRelation = { id: number; relationType: string; direction: string; peer: EntityRecord | null; createdAt: string };
type EntityDocument = { id: number; title: string; documentType: string; status: string; validUntil: string; source: string; createdAt: string };
type AuditEvent = { id: number; action: string; actor: string; payload: string; createdAt: string };
type MergeRecord = { id: number; duplicateId: string; reason: string; createdAt: string };
type DetailPayload = {
  entity: EntityRecord;
  canonicalId: string;
  relations: EntityRelation[];
  documents: EntityDocument[];
  history: AuditEvent[];
  usages: string[];
  mergedCards: MergeRecord[];
  duplicateCandidates: EntityRecord[];
  relationCandidates: EntityRecord[];
};
type RegistryAction = "create" | "edit" | "relation" | "document" | "merge";

const qualityOptions = ["Проверено", "Требует сверки", "На проверке"];

export function RegistryWorkspace({ notify }: { notify: (value: string) => void }) {
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [stats, setStats] = useState<RegistryStats>({ total: 0, needsReview: 0, duplicateGroups: 0, sources: 0 });
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [quality, setQuality] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<RegistryAction | null>(null);

  const loadEntities = useCallback(async function loadEntities() {
    setState("loading");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (type) params.set("type", type);
      if (quality) params.set("quality", quality);
      const response = await fetch(`/api/entities?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { entities: EntityRecord[]; stats: RegistryStats; typeCounts: Record<string, number> };
      setEntities(payload.entities);
      setStats(payload.stats);
      setTypeCounts(payload.typeCounts);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [query, type, quality]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEntities(), 220);
    return () => window.clearTimeout(timer);
  }, [loadEntities]);

  async function actionDone(entityId?: string) {
    setAction(null);
    await loadEntities();
    if (entityId) setSelectedId(entityId);
  }

  const registryTabs = [
    { id: "", label: <>Все <b>{stats.total}</b></> },
    ...entityTypes.filter((item) => typeCounts[item]).map((item) => ({ id: item, label: <>{item} <b>{typeCounts[item]}</b></> })),
  ];

  return <PageContainer className="ahRegistryPage">
    <PageHeader
      eyebrow="ЛЮДИ · ОРГАНИЗАЦИИ · СВЯЗИ"
      title="Единые карточки"
      description="Сотрудник, ребёнок или организация создаются один раз и связываются со всеми рабочими контурами."
      actions={<Button variant="primary" onClick={() => setAction("create")}>Новая карточка</Button>}
    />

    <div className="ahRegistryKpis">
      <KpiCard label="Активные карточки" value={String(stats.total)} note="единый центральный реестр" />
      <KpiCard className={stats.needsReview ? "ahRegistryKpiWarning" : undefined} label="Требуют сверки" value={String(stats.needsReview)} note="не выдаём за проверенные" />
      <KpiCard className={stats.duplicateGroups ? "ahRegistryKpiDanger" : undefined} label="Группы дублей" value={String(stats.duplicateGroups)} note="без удаления истории" />
      <KpiCard label="Источники" value={String(stats.sources)} note="ручной ввод · импорт · интеграции" />
    </div>

    <Card className="ahRegistryShell">
      <div className="ahRegistryToolbar">
        <SearchField className="ahRegistrySearch" value={query} onChange={setQuery} placeholder="Найти по ID, названию, источнику или области" label="Поиск по единому реестру" />
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Фильтр по типу"><option value="">Все типы</option>{entityTypes.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={quality} onChange={(event) => setQuality(event.target.value)} aria-label="Фильтр по качеству"><option value="">Любое качество</option>{qualityOptions.map((item) => <option key={item}>{item}</option>)}</select>
        {(query || type || quality) ? <Button variant="ghost" className="ahRegistryClear" onClick={() => { setQuery(""); setType(""); setQuality(""); }}>Сбросить</Button> : null}
      </div>
      <div className="ahRegistryTabs"><Tabs items={registryTabs} value={type} onChange={setType} ariaLabel="Типы карточек" /></div>

      {state === "loading" ? <RegistryState title="Загружаем реестр" text="Проверяем карточки, источники и устойчивые ID." /> : null}
      {state === "error" ? <RegistryState title="Реестр временно недоступен" text="Данные не заменены заглушкой." action="Повторить" onAction={() => void loadEntities()} /> : null}
      {state === "ready" && entities.length === 0 ? <RegistryState title="Карточки не найдены" text="Измените фильтры или создайте новую карточку." action="Создать карточку" onAction={() => setAction("create")} /> : null}
      {state === "ready" && entities.length > 0 ? <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Карточка</th><th>Тип</th><th>Используется в</th><th>Источник</th><th>Качество</th><th>Статус</th><th /></tr></thead><tbody>
        {entities.map((entity) => <tr key={entity.id} onClick={() => setSelectedId(entity.id)}>
          <td><strong>{entity.displayName}</strong><small>{entity.id}</small></td>
          <td><span className="entity-type-badge">{entity.entityType}</span></td>
          <td><strong>{entity.scope}</strong><small>единый ID во всех модулях</small></td>
          <td><strong>{sourceLabel(entity.sourceSystem)}</strong><small>{entity.sourceRecordId}</small></td>
          <td><span className={`quality-badge ${qualityClass(entity.dataQuality)}`}>{entity.dataQuality}</span></td>
          <td>{entity.status}</td><td><button aria-label={`Открыть ${entity.displayName}`}>→</button></td>
        </tr>)}
      </tbody></table></div> : null}
    </Card>

    {selectedId ? <EntityPanel key={selectedId} entityId={selectedId} close={() => setSelectedId(null)} notify={notify} refreshList={loadEntities} onNavigate={setSelectedId} /> : null}
    {action === "create" ? <RegistryActionModal action="create" close={() => setAction(null)} onDone={actionDone} notify={notify} /> : null}
  </PageContainer>;
}

function RegistryState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <EmptyState className="ahRegistryEmpty" density="compact" title={title} description={text} action={action ? <Button variant="secondary" onClick={onAction}>{action}</Button> : undefined} />;
}

export function EntityPanel({ entityId, close, notify, refreshList, onNavigate, readOnly = false, backLabel, initialTab = "overview" }: { entityId: string; close: () => void; notify: (value: string) => void; refreshList?: () => Promise<void>; onNavigate?: (id: string) => void; readOnly?: boolean; backLabel?: string; initialTab?: "overview" | "relations" | "documents" | "history" }) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<"overview" | "relations" | "documents" | "history">(initialTab);
  const [localAction, setLocalAction] = useState<Exclude<RegistryAction, "create"> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const loadDetail = useCallback(async function loadDetail() {
    setState("loading");
    try {
      const response = await fetch(`/api/entity-detail?id=${encodeURIComponent(entityId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setDetail((await response.json()) as DetailPayload);
      setState("ready");
    } catch { setState("error"); }
  }, [entityId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadDetail(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail]);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  async function done(id?: string) {
    setLocalAction(null);
    await Promise.all([loadDetail(), refreshList?.() ?? Promise.resolve()]);
    if (id && id !== entityId) notify(`Основной карточкой стала ${id}`);
  }

  return createPortal(<div className="registry-drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть карточку" /><aside className="entity-panel" role="dialog" aria-modal="true" aria-labelledby={`entity-title-${entityId}`}>
    {state === "loading" ? <RegistryState title="Открываем карточку" text="Собираем связи, документы и историю." /> : null}
    {state === "error" ? <RegistryState title="Карточка недоступна" text="Повторите загрузку." action="Повторить" onAction={() => void loadDetail()} /> : null}
    {state === "ready" && detail ? <>
      <div className="entity-panel-head"><div><span className="entity-type-badge">{detail.entity.entityType}</span><h2 id={`entity-title-${entityId}`}>{detail.entity.displayName}</h2><p>{detail.entity.id} · {detail.entity.status}</p></div><button ref={closeRef} className={backLabel ? "entity-panel-back" : ""} onClick={close} aria-label={backLabel || "Закрыть"}>{backLabel ? <><span>←</span>{backLabel}</> : "×"}</button></div>
      <div className="entity-source-line"><span className={qualityClass(detail.entity.dataQuality)} /> <strong>{detail.entity.dataQuality}</strong><small>{sourceLabel(detail.entity.sourceSystem)} · {detail.entity.sourceRecordId}</small></div>
      <nav className="entity-tabs"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Обзор</button><button className={tab === "relations" ? "active" : ""} onClick={() => setTab("relations")}>Связи <b>{detail.relations.length}</b></button><button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>{detail.entity.entityType === "Семья" ? "Договоры" : "Документы"} <b>{detail.documents.length}</b></button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>История <b>{detail.history.length}</b></button></nav>
      <div className="entity-panel-body">
        {tab === "overview" ? <>
          <dl className="entity-facts"><div><dt>Область</dt><dd>{detail.entity.scope}</dd></div><div><dt>Источник истины</dt><dd>{sourceLabel(detail.entity.sourceSystem)}</dd></div><div><dt>ID источника</dt><dd>{detail.entity.sourceRecordId}</dd></div><div><dt>Последнее изменение</dt><dd>{detail.entity.updatedAt}</dd></div><div><dt>Создано</dt><dd>{detail.entity.createdAt}</dd></div><div><dt>Автор записи</dt><dd>{detail.entity.createdBy}</dd></div></dl>
          {detail.mergedCards.length ? <section className="merged-box"><p>Объединённые карточки</p>{detail.mergedCards.map((merge) => <div key={merge.id}><strong>{merge.duplicateId}</strong><span>{merge.reason}</span></div>)}</section> : null}
          {!readOnly ? <div className="entity-actions"><button onClick={() => setLocalAction("edit")}>Редактировать</button><button onClick={() => setLocalAction("relation")}>+ Связь</button><button onClick={() => setLocalAction("document")}>+ Документ</button><button className="danger-lite" onClick={() => setLocalAction("merge")}>Объединить дубль</button></div> : null}
        </> : null}
        {tab === "relations" ? <section className="entity-list-section"><div className="entity-section-head"><div><p>Сквозная модель</p><h3>Связанные сущности</h3></div>{!readOnly ? <button onClick={() => setLocalAction("relation")}>+ Добавить связь</button> : null}</div>{detail.relations.length ? <div className="relation-list">{detail.relations.map((relation) => <button type="button" disabled={!relation.peer} key={relation.id} onClick={() => relation.peer && onNavigate?.(relation.peer.id)}><span>↔</span><div><strong>{relation.peer?.displayName || "Карточка объединена"}</strong><small>{relation.relationType} · {relation.direction}</small></div><em>{relation.peer ? `${relation.peer.id} →` : "—"}</em></button>)}</div> : <EmptyDetail text="Связей пока нет." />}</section> : null}
        {tab === "documents" ? <section className="entity-list-section"><div className="entity-section-head"><div><p>Метаданные без загрузки файла</p><h3>{detail.entity.entityType === "Семья" ? "Договоры семьи" : "Связанные документы"}</h3></div>{!readOnly ? <button onClick={() => setLocalAction("document")}>{detail.entity.entityType === "Семья" ? "+ Добавить договор" : "+ Связать документ"}</button> : null}</div>{detail.documents.length ? <div className="document-list">{detail.documents.map((document) => <article key={document.id}><div><strong>{document.title}</strong><small>{document.documentType} · {document.source}</small></div><span className={`quality-badge ${document.status === "Актуален" ? "verified" : "review"}`}>{document.status}</span><em>{document.validUntil || "Без срока"}</em></article>)}</div> : <EmptyDetail text={detail.entity.entityType === "Семья" ? "Договоров пока нет. Добавьте номер, срок и статус." : "Документы пока не связаны."} />}</section> : null}
        {tab === "history" ? <section className="entity-list-section"><div className="entity-section-head"><div><p>Неизменяемый аудит</p><h3>История карточки</h3></div></div>{detail.history.length ? <div className="entity-history">{detail.history.map((event) => <article key={event.id}><span /><div><strong>{auditTitle(event.action)}</strong><small>{auditDescription(event)}</small><em>{event.actor} · {event.createdAt}</em></div></article>)}</div> : <EmptyDetail text="История начнётся с первого изменения." />}</section> : null}
      </div>
      {localAction && !readOnly ? <RegistryActionModal action={localAction} detail={detail} close={() => setLocalAction(null)} onDone={done} notify={notify} /> : null}
    </> : null}
  </aside></div>, document.body);
}

function EmptyDetail({ text }: { text: string }) { return <div className="empty-detail"><span>＋</span><p>{text}</p></div>; }

function RegistryActionModal({ action, detail, close, onDone, notify }: { action: RegistryAction; detail?: DetailPayload; close: () => void; onDone: (id?: string) => Promise<void>; notify: (value: string) => void }) {
  const [saving, setSaving] = useState(false);
  const entity = detail?.entity;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    let endpoint = "/api/entities"; let method = "POST"; let payload: Record<string, string> = values; let success = "Карточка создана";
    if (action === "edit" && entity) { method = "PATCH"; payload = { ...values, id: entity.id, expectedUpdatedAt: entity.updatedAt }; success = "Карточка обновлена"; }
    if (action === "relation" && entity) { endpoint = "/api/entity-relations"; payload = { ...values, fromEntityId: entity.id }; success = "Связь добавлена"; }
    if (action === "document" && entity) { endpoint = "/api/entity-documents"; payload = { ...values, entityId: entity.id }; success = "Документ связан с карточкой"; }
    if (action === "merge" && entity) { endpoint = "/api/entity-merge"; payload = { ...values, survivorId: entity.id }; success = "Дубль объединён без удаления истории"; }
    try {
      const response = await fetch(endpoint, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = (await response.json()) as { error?: string; entity?: EntityRecord };
      if (!response.ok) throw new Error(result.error || "Операция не выполнена");
      notify(success); await onDone(result.entity?.id || entity?.id);
    } catch (error) { notify(error instanceof Error ? error.message : "Операция не выполнена"); }
    finally { setSaving(false); }
  }

  return <div className="modal-layer registry-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть форму" /><form className="task-modal registry-modal" onSubmit={submit}>
    <div className="drawer-head"><div><p>Единый справочник</p><h2>{actionTitle(action)}</h2></div><button type="button" onClick={close}>×</button></div>
    {action === "create" ? <>
      <label><span>Тип сущности</span><select name="entityType" defaultValue="Семья">{entityTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Название карточки</span><input name="displayName" required minLength={3} placeholder="Например: Семья Ивановых" /></label>
      <label><span>Область использования</span><input name="scope" required placeholder="Подразделение, объект или проект" /></label>
      <input type="hidden" name="sourceSystem" value="MANUAL" />
      <div className="merge-warning"><strong>ID назначит система</strong><span>Карточка получит постоянный рабочий идентификатор после сохранения. Источник записи — ручной ввод.</span></div>
    </> : null}
    {action === "edit" && entity ? <>
      <label><span>Название карточки</span><input name="displayName" required minLength={3} defaultValue={entity.displayName} /></label><label><span>Область использования</span><input name="scope" required defaultValue={entity.scope} /></label>
      <div className="form-row"><label><span>Качество данных</span><select name="dataQuality" defaultValue={entity.dataQuality}>{qualityOptions.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Статус</span><select name="status" defaultValue={entity.status}><option>Активна</option><option>На проверке</option><option>Архив</option></select></label></div>
    </> : null}
    {action === "relation" && detail ? <><label><span>Связать с карточкой</span><select name="toEntityId" required defaultValue=""><option value="" disabled>Выберите карточку</option>{detail.relationCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.id}</option>)}</select></label><label><span>Тип связи</span><select name="relationType" defaultValue={relationTypes[0]}>{relationTypes.map((item) => <option key={item}>{item}</option>)}</select></label></> : null}
    {action === "document" ? <><div className="form-row"><label><span>Название / номер</span><input name="title" required minLength={3} placeholder="Например: Договор 15/2026" /></label><label><span>Тип документа</span><input name="documentType" required defaultValue={entity?.entityType === "Семья" ? "Договор с семьёй" : ""} placeholder="Договор, акт, согласие" /></label></div><div className="form-row"><label><span>Статус</span><select name="status" defaultValue="На проверке"><option>Актуален</option><option>На проверке</option><option>Истекает</option><option>Нет файла</option></select></label><label><span>Действует до</span><input type="date" name="validUntil" /></label></div><input type="hidden" name="source" value="MANUAL" /></> : null}
    {action === "merge" && detail ? <><div className="merge-warning"><strong>История не удаляется</strong><span>Дубль станет неактивным, а его связи, документы и аудит останутся доступны из основной карточки.</span></div><label><span>Карточка-дубль</span><select name="duplicateId" required defaultValue=""><option value="" disabled>Выберите дубль того же типа</option>{detail.duplicateCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.id}</option>)}</select></label><label><span>Причина объединения</span><textarea name="reason" required minLength={8} placeholder="Как подтверждено, что это одна сущность" /></label></> : null}
    <div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button type="submit" disabled={saving}>{saving ? "Сохраняем…" : actionSubmit(action)}</button></div>
  </form></div>;
}

function sourceLabel(source: string) { return source === "MANUAL" ? "Ручной ввод" : source.endsWith("_IMPORT") ? "Подтверждённый импорт" : "Интеграция"; }
function qualityClass(value: string) { return value === "Проверено" ? "verified" : value === "Требует сверки" ? "warning" : "review"; }
function actionTitle(action: RegistryAction) { return ({ create: "Новая единая карточка", edit: "Редактировать карточку", relation: "Добавить связь", document: "Связать документ", merge: "Объединить дубль" })[action]; }
function actionSubmit(action: RegistryAction) { return ({ create: "Создать карточку", edit: "Сохранить изменения", relation: "Добавить связь", document: "Связать документ", merge: "Объединить" })[action]; }
function auditTitle(action: string) { return ({ "entity.created": "Карточка создана", "entity.updated": "Карточка изменена", "entity.relation_added": "Добавлена связь", "entity.document_linked": "Связан документ", "entity.merge_survivor": "Присоединён дубль", "entity.merged": "Карточка объединена" } as Record<string, string>)[action] || action; }
function auditDescription(event: AuditEvent) { try { const payload = JSON.parse(event.payload) as Record<string, string | number>; return Object.entries(payload).map(([key, value]) => `${key}: ${value}`).join(" · "); } catch { return "Событие записано"; } }
