"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getNextTaskStatus, taskStatuses } from "../../lib/workflow";

type Task = {
  id: number; title: string; owner: string; dueDate: string; priority: string; status: string;
  sourceType: string; sourceId: string; description: string; assigneeEntityId: string;
  parentTaskId: number | null; kind: string; recurrenceRule: string; requiresApproval: boolean;
  result: string; resultEvidence: string; completedAt: string; createdBy: string; createdAt: string; updatedAt: string;
};
type Entity = { id: string; displayName: string };
type Notification = { id: number; recipientEntityId: string; notificationType: string; title: string; body: string; sourceType: string; sourceId: string; status: string; createdAt: string };
type Escalation = { id: number; taskId: number; level: number; reason: string; status: string; recipientEntityId: string; createdAt: string };
type WorkflowDocument = { id: string; title: string; documentType: string; currentVersion: number; status: string; validUntil: string; ownerEntityId: string; source: string };
type Obligation = { id: number; documentId: string; title: string; dueDate: string; ownerEntityId: string; status: string; warningDays: number };
type Overview = {
  tasks: Task[]; notifications: Notification[]; escalations: Escalation[]; documents: WorkflowDocument[];
  obligations: Obligation[]; assignees: Entity[]; stats: { open: number; overdue: number; waitingApproval: number; escalations: number };
};
type TaskDetail = {
  task: Task; parent: Task | null; subtasks: Task[];
  watchers: Array<{ id: number; entityId: string; entity: Entity | null }>;
  checklist: Array<{ id: number; title: string; isDone: boolean }>;
  comments: Array<{ id: number; body: string; createdBy: string; createdAt: string }>;
  approvals: Array<{ id: number; stepName: string; status: string; decidedBy: string; comment: string; updatedAt: string }>;
  documents: Array<WorkflowDocument & { versions: Array<{ id: number; version: number; note: string; reference: string; createdBy: string; createdAt: string }> }>;
  history: Array<{ id: number; action: string; actor: string; payload: string; createdAt: string }>;
  assignees: Entity[];
};
type View = "queue" | "board" | "notifications" | "documents";

const statuses = [...taskStatuses];
const emptyOverview: Overview = { tasks: [], notifications: [], escalations: [], documents: [], obligations: [], assignees: [], stats: { open: 0, overdue: 0, waitingApproval: 0, escalations: 0 } };

export function WorkflowWorkspace({ role, notify, onChanged }: { role: string; notify: (value: string) => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Overview>(emptyOverview);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [view, setView] = useState<View>("queue");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createParent, setCreateParent] = useState<number | null | undefined>(undefined);
  const [documentAction, setDocumentAction] = useState<{ mode: "create" | "version"; document?: WorkflowDocument } | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/work-items", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData((await response.json()) as Overview);
      setState("ready");
    } catch { setState("error"); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const filtered = useMemo(() => data.tasks.filter((task) => {
    const clean = query.trim().toLocaleLowerCase("ru-RU");
    if (status && task.status !== status) return false;
    if (!clean) return true;
    return [task.title, task.owner, task.sourceId, task.sourceType, String(task.id)].some((value) => value.toLocaleLowerCase("ru-RU").includes(clean));
  }), [data.tasks, query, status]);

  const expiry = data.obligations.find((item) => item.status === "Открыто");
  const expiryTask = data.tasks.find((task) => task.sourceId === expiry?.documentId);

  async function changed(message: string) { notify(message); await Promise.all([load(), onChanged()]); }
  async function markNotification(id: number) {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) { notify("Уведомление не обновлено"); return; }
    await changed("Уведомление отмечено прочитанным");
  }

  return <section className="page workflow-page">
    <div className="page-heading workflow-heading"><div><p className="eyebrow">Исполнение и контроль</p><h1>Задачи и процессы</h1><p>Сигнал проходит путь до подтверждённого результата; сроки, документы и решения остаются в истории.</p></div><button className="primary-action" onClick={() => setCreateParent(null)}>+ Новая задача</button></div>
    <div className="workflow-kpis">
      <WorkflowKpi label="Открытые" value={data.stats.open} note="задачи и поручения" />
      <WorkflowKpi label="Просрочены" value={data.stats.overdue} note="требуют эскалации" tone={data.stats.overdue ? "danger" : ""} />
      <WorkflowKpi label="На согласовании" value={data.stats.waitingApproval} note="нужен вердикт руководителя" tone="blue" />
      <WorkflowKpi label="Эскалации" value={data.stats.escalations} note="видит руководитель" tone={data.stats.escalations ? "amber" : ""} />
    </div>

    {expiry ? <button className="workflow-risk" onClick={() => expiryTask && setSelectedId(expiryTask.id)}><span>!</span><div><small>Автоматический контроль обязательства</small><strong>Договор {expiry.documentId} истекает {formatDate(expiry.dueDate)}</strong><p>Уведомление руководителю и задача ответственному созданы системой. Нажмите, чтобы проверить цепочку.</p></div><em>Открыть риск →</em></button> : null}

    <article className="workflow-shell">
      <div className="workflow-viewbar">
        <nav>{([ ["queue", "Моя очередь"], ["board", "Доска процесса"], ["notifications", `Уведомления ${data.notifications.filter((item) => item.status === "Новое").length}`], ["documents", `Документы ${data.documents.length}`] ] as Array<[View, string]>).map(([id, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>)}</nav>
        {(view === "queue" || view === "board") ? <div className="workflow-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по задаче, ID или источнику" aria-label="Поиск задач" /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Фильтр статуса"><option value="">Все статусы</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></div> : null}
      </div>

      {state === "loading" ? <WorkflowState title="Загружаем процессы" text="Собираем задачи, сроки, уведомления и документы." /> : null}
      {state === "error" ? <WorkflowState title="Процессы временно недоступны" text="Ложный список не показываем." action="Повторить" onAction={() => void load()} /> : null}
      {state === "ready" && view === "queue" ? <QueueView tasks={filtered} open={setSelectedId} create={() => setCreateParent(null)} /> : null}
      {state === "ready" && view === "board" ? <BoardView tasks={filtered} open={setSelectedId} /> : null}
      {state === "ready" && view === "notifications" ? <NotificationView notifications={data.notifications} escalations={data.escalations} openTask={setSelectedId} markRead={markNotification} /> : null}
      {state === "ready" && view === "documents" ? <DocumentView documents={data.documents} obligations={data.obligations} assignees={data.assignees} create={() => setDocumentAction({ mode: "create" })} version={(document) => setDocumentAction({ mode: "version", document })} /> : null}
    </article>

    {selectedId ? <TaskPanel role={role} taskId={selectedId} close={() => setSelectedId(null)} notify={notify} changed={changed} createSubtask={() => setCreateParent(selectedId)} /> : null}
    {createParent !== undefined ? <TaskCreateModal parentTaskId={createParent} assignees={data.assignees} close={() => setCreateParent(undefined)} done={async () => { const parent = createParent; setCreateParent(undefined); await changed(parent ? "Подзадача создана" : "Задача создана"); if (parent) { setSelectedId(null); window.setTimeout(() => setSelectedId(parent), 0); } }} notify={notify} /> : null}
    {documentAction ? <DocumentModal action={documentAction} assignees={data.assignees} close={() => setDocumentAction(null)} done={async (message) => { setDocumentAction(null); await changed(message); }} notify={notify} /> : null}
  </section>;
}

function WorkflowKpi({ label, value, note, tone = "" }: { label: string; value: number; note: string; tone?: string }) { return <article className={`workflow-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

function WorkflowState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) { return <div className="workflow-state"><span>↻</span><h2>{title}</h2><p>{text}</p>{action ? <button onClick={onAction}>{action}</button> : null}</div>; }

function QueueView({ tasks, open, create }: { tasks: Task[]; open: (id: number) => void; create: () => void }) {
  if (!tasks.length) return <WorkflowState title="Задач не найдено" text="Измените фильтры или создайте задачу." action="Создать задачу" onAction={create} />;
  return <div className="workflow-table-wrap"><table className="workflow-table"><thead><tr><th>Задача</th><th>Цепочка</th><th>Ответственный</th><th>Срок</th><th>Статус</th><th /></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} onClick={() => open(task.id)}><td><div className="task-title-cell"><span className={`priority-dot ${priorityClass(task.priority)}`} /><div><strong>{task.title}</strong><small>TSK-{String(task.id).padStart(4, "0")} · {task.kind}{task.parentTaskId ? " · подзадача" : ""}</small></div></div></td><td><strong>{task.sourceType}</strong><small>{task.sourceId}</small></td><td><strong>{task.owner}</strong><small>{task.assigneeEntityId || "не связан с карточкой"}</small></td><td><strong className={isOverdue(task) ? "due-over" : ""}>{task.dueDate ? formatDate(task.dueDate) : "Без срока"}</strong><small>{task.recurrenceRule || "однократно"}</small></td><td><span className={`status-pill ${statusClass(task.status)}`}>{task.status}</span></td><td><button aria-label={`Открыть задачу ${task.title}`}>→</button></td></tr>)}</tbody></table></div>;
}

function BoardView({ tasks, open }: { tasks: Task[]; open: (id: number) => void }) { return <div data-ah-compact-card="true" className="process-board">{statuses.map((status) => { const list = tasks.filter((task) => task.status === status); return <section key={status}><header><strong>{status}</strong><span>{list.length}</span></header><div>{list.length ? list.map((task) => <button key={task.id} onClick={() => open(task.id)}><i className={priorityClass(task.priority)} /><strong>{task.title}</strong><small>{task.owner}</small><em>{task.dueDate ? formatDate(task.dueDate) : "Без срока"}</em></button>) : <p>Нет задач</p>}</div></section>; })}</div>; }

function NotificationView({ notifications, escalations, openTask, markRead }: { notifications: Notification[]; escalations: Escalation[]; openTask: (id: number) => void; markRead: (id: number) => Promise<void> }) { return <div className="notification-layout"><section><div className="workflow-section-head"><div><small>Системные события</small><h2>Уведомления</h2></div><span>{notifications.length}</span></div>{notifications.length ? <div className="notification-list">{notifications.map((item) => <article key={item.id}><span className={item.status === "Новое" ? "new" : ""} /><div><strong>{item.title}</strong><p>{item.body}</p><small>{item.notificationType} · {item.sourceType}:{item.sourceId} · {item.createdAt}</small></div><button disabled={item.status !== "Новое"} onClick={() => void markRead(item.id)}>{item.status === "Новое" ? "Прочитано" : item.status}</button></article>)}</div> : <WorkflowState title="Уведомлений нет" text="Новые события появятся здесь." />}</section><aside><div className="workflow-section-head"><div><small>SLA и контроль</small><h2>Эскалации</h2></div><span>{escalations.length}</span></div>{escalations.map((item) => <button key={item.id} onClick={() => openTask(item.taskId)}><span>L{item.level}</span><div><strong>{item.reason}</strong><small>{item.recipientEntityId} · {item.status}</small></div><em>→</em></button>)}</aside></div>; }

function DocumentView({ documents, obligations, assignees, create, version }: { documents: WorkflowDocument[]; obligations: Obligation[]; assignees: Entity[]; create: () => void; version: (document: WorkflowDocument) => void }) { return <div className="document-workspace"><section><div className="workflow-section-head"><div><small>Контролируемые версии</small><h2>Документы</h2></div><button onClick={create}>+ Новый документ</button></div><div data-ah-compact-card="true" className="workflow-doc-list">{documents.map((document) => <article key={document.id}><span>DOC</span><div><strong>{document.title}</strong><small>{document.id} · {document.documentType} · источник {document.source}</small></div><b>v{document.currentVersion}</b><em className={document.status === "Истекает" ? "warn" : ""}>{document.status}</em><button onClick={() => version(document)}>+ версия</button></article>)}</div></section><aside><div className="workflow-section-head"><div><small>Сроки действия</small><h2>Обязательства</h2></div><span>{obligations.length}</span></div>{obligations.map((item) => <article key={item.id}><strong>{item.title}</strong><small>{item.documentId}</small><p>{formatDate(item.dueDate)} · {assignees.find((entity) => entity.id === item.ownerEntityId)?.displayName || item.ownerEntityId}</p><span>{item.status}</span></article>)}</aside></div>; }

function TaskPanel({ role, taskId, close, notify, changed, createSubtask }: { role: string; taskId: number; close: () => void; notify: (value: string) => void; changed: (message: string) => Promise<void>; createSubtask: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<"work" | "people" | "documents" | "history">("work");
  const [showResult, setShowResult] = useState(false);
  const load = useCallback(async () => { setState("loading"); try { const response = await fetch(`/api/work-items?id=${taskId}`, { cache: "no-store" }); if (!response.ok) throw new Error(); setDetail((await response.json()) as TaskDetail); setState("ready"); } catch { setState("error"); } }, [taskId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function action(payload: Record<string, unknown>, message: string) { try { const response = await fetch("/api/task-actions", { method: "POST", headers: { "content-type": "application/json", "x-arthello-test-role": roleCode(role) }, body: JSON.stringify({ ...payload, taskId }) }); const body = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(body.error || "Действие не выполнено"); await load(); await changed(message); } catch (error) { notify(error instanceof Error ? error.message : "Действие не выполнено"); } }
  async function transition(event?: FormEvent<HTMLFormElement>) { event?.preventDefault(); if (!detail) return; const next = nextStatus(detail.task.status); if (!next) return; const values = event ? Object.fromEntries(new FormData(event.currentTarget).entries()) : {}; try { const response = await fetch("/api/tasks", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: taskId, status: next, expectedUpdatedAt: detail.task.updatedAt, ...values }) }); const body = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(body.error || "Статус не изменён"); setShowResult(false); await load(); await changed(`Задача переведена в статус «${next}»`); } catch (error) { notify(error instanceof Error ? error.message : "Статус не изменён"); await load(); } }
  return <div className="workflow-drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть задачу" /><aside className="workflow-drawer">{state === "loading" ? <WorkflowState title="Открываем задачу" text="Собираем всю цепочку исполнения." /> : null}{state === "error" ? <WorkflowState title="Задача недоступна" text="Повторите загрузку." action="Повторить" onAction={() => void load()} /> : null}{state === "ready" && detail ? <><header className="workflow-drawer-head"><div><span>{detail.task.kind}</span><h2>{detail.task.title}</h2><p>TSK-{String(detail.task.id).padStart(4, "0")} · {detail.task.sourceType}:{detail.task.sourceId}</p></div><button onClick={close} aria-label="Закрыть">×</button></header><ProcessRail status={detail.task.status} /><nav className="workflow-tabs"><button className={tab === "work" ? "active" : ""} onClick={() => setTab("work")}>Работа</button><button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>Участники {detail.watchers.length + 1}</button><button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>Документы {detail.documents.length}</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>История {detail.history.length}</button></nav><div className="workflow-drawer-body">{tab === "work" ? <WorkTab detail={detail} action={action} createSubtask={createSubtask} /> : null}{tab === "people" ? <PeopleTab detail={detail} action={action} /> : null}{tab === "documents" ? <TaskDocuments detail={detail} /> : null}{tab === "history" ? <TaskHistory events={detail.history} /> : null}</div><footer className="workflow-drawer-footer"><div><span className={`priority-dot ${priorityClass(detail.task.priority)}`} /><p><strong>{detail.task.priority} приоритет</strong><small>{detail.task.dueDate ? `Срок ${formatDate(detail.task.dueDate)}` : "Срок не установлен"}</small></p></div>{nextStatus(detail.task.status) ? (nextStatus(detail.task.status) === "На проверке" ? <button onClick={() => setShowResult(true)}>Передать результат →</button> : <button onClick={() => void transition()}>{transitionLabel(detail.task.status)} →</button>) : <span className="done-label">Результат подтверждён</span>}</footer>{showResult ? <div className="result-layer"><form onSubmit={(event) => void transition(event)}><div><small>Подтверждение результата</small><h3>Что сделано</h3></div><label><span>Результат</span><textarea name="result" required minLength={8} defaultValue={detail.task.result} placeholder="Конкретный проверяемый результат" /></label><label><span>Основание / ссылка</span><input name="resultEvidence" defaultValue={detail.task.resultEvidence} placeholder="Документ, событие или запись" /></label><div><button type="button" onClick={() => setShowResult(false)}>Отмена</button><button type="submit">Передать на проверку</button></div></form></div> : null}</> : null}</aside></div>;
}

function ProcessRail({ status }: { status: string }) { const current = statuses.indexOf(status); return <div className="process-rail">{statuses.map((item, index) => <div key={item} className={index < current ? "done" : index === current ? "current" : ""}><span>{index < current ? "✓" : index + 1}</span><small>{item}</small></div>)}</div>; }

function WorkTab({ detail, action, createSubtask }: { detail: TaskDetail; action: (payload: Record<string, unknown>, message: string) => Promise<void>; createSubtask: () => void }) { return <><section className="task-summary"><p>{detail.task.description || "Описание не добавлено."}</p><dl><div><dt>Ответственный</dt><dd>{detail.task.owner}<small>{detail.task.assigneeEntityId || "без связи со справочником"}</small></dd></div><div><dt>Срок</dt><dd>{detail.task.dueDate ? formatDate(detail.task.dueDate) : "Без срока"}<small>{detail.task.recurrenceRule || "однократно"}</small></dd></div><div><dt>Источник</dt><dd>{detail.task.sourceType}<small>{detail.task.sourceId}</small></dd></div><div><dt>Результат</dt><dd>{detail.task.result || "Ещё не передан"}<small>{detail.task.resultEvidence || "нет основания"}</small></dd></div></dl></section><section className="task-block"><div className="workflow-section-head"><div><small>Контроль выполнения</small><h3>Чек-лист</h3></div><span>{detail.checklist.filter((item) => item.isDone).length}/{detail.checklist.length}</span></div><div className="checklist-list">{detail.checklist.map((item) => <label key={item.id}><input type="checkbox" checked={item.isDone} onChange={(event) => void action({ action: "checklist_toggle", checklistId: item.id, isDone: event.target.checked }, "Чек-лист обновлён")} /><span>{item.title}</span></label>)}</div><form className="inline-add" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const value = new FormData(form).get("title"); void action({ action: "checklist_add", title: value }, "Пункт добавлен").then(() => form.reset()); }}><input name="title" required minLength={3} placeholder="Добавить пункт" /><button>+</button></form></section><section className="task-block"><div className="workflow-section-head"><div><small>Декомпозиция</small><h3>Подзадачи</h3></div><button onClick={createSubtask}>+ Подзадача</button></div>{detail.subtasks.length ? <div data-ah-compact-card="true" className="subtask-list">{detail.subtasks.map((task) => <article key={task.id}><span className={`status-pill ${statusClass(task.status)}`}>{task.status}</span><div><strong>{task.title}</strong><small>{task.owner} · {task.dueDate ? formatDate(task.dueDate) : "без срока"}</small></div></article>)}</div> : <p data-ah-compact-card="true" className="empty-inline">Подзадач нет.</p>}</section></>; }

function PeopleTab({ detail, action }: { detail: TaskDetail; action: (payload: Record<string, unknown>, message: string) => Promise<void> }) {
  const approval = detail.approvals[0];
  return <>
    <section className="task-block">
      <div className="workflow-section-head"><div><small>Исполнитель</small><h3>Ответственный</h3></div></div>
      <article className="owner-card"><span>{initials(detail.task.owner)}</span><div><strong>{detail.task.owner}</strong><small>{detail.task.assigneeEntityId || "не связан с единой карточкой"}</small></div></article>
    </section>
    <section className="task-block">
      <div className="workflow-section-head"><div><small>Следят за результатом</small><h3>Наблюдатели</h3></div><span>{detail.watchers.length}</span></div>
      <div className="watcher-list">{detail.watchers.map((watcher) => <span key={watcher.id}>{watcher.entity?.displayName || watcher.entityId}</span>)}</div>
      <form className="inline-add" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; void action({ action: "watcher", entityId: new FormData(form).get("entityId") }, "Наблюдатель добавлен"); }}><select name="entityId" required defaultValue=""><option value="" disabled>Выберите сотрудника</option>{detail.assignees.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName}</option>)}</select><button>Добавить</button></form>
    </section>
    {approval ? <section className="approval-card">
      <div><small>Согласование</small><h3>{approval.stepName}</h3></div>
      <span className={approval.status === "Согласовано" ? "approved" : approval.status === "Отклонено" ? "rejected" : "waiting"}>{approval.status}</span>
      {approval.decidedBy ? <p>{approval.decidedBy} · {approval.updatedAt}<br />{approval.comment}</p> : detail.task.status !== "На проверке" ? <p>Решение откроется после передачи результата на проверку.</p> : <form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const comment = new FormData(form).get("comment"); void action({ action: "approval", status: "Согласовано", comment }, "Результат согласован"); }}><textarea name="comment" placeholder="Комментарий к решению" /><div><button type="button" onClick={(event) => { const form = event.currentTarget.closest("form")!; const comment = new FormData(form).get("comment"); void action({ action: "approval", status: "Отклонено", comment }, "Результат отклонён"); }}>Отклонить</button><button type="submit">Согласовать</button></div></form>}
    </section> : <section className="task-block"><p data-ah-compact-card="true" className="empty-inline">Согласование для этой задачи не требуется.</p></section>}
    <section className="task-block">
      <div className="workflow-section-head"><div><small>Обсуждение</small><h3>Комментарии</h3></div><span>{detail.comments.length}</span></div>
      <form className="comment-add" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const body = new FormData(form).get("body"); void action({ action: "comment", body }, "Комментарий добавлен").then(() => form.reset()); }}><textarea name="body" required minLength={2} placeholder="Комментарий без изменения исходных данных" /><button>Добавить</button></form>
      <div className="comment-list">{detail.comments.map((comment) => <article key={comment.id}><strong>{comment.createdBy}</strong><p>{comment.body}</p><small>{comment.createdAt}</small></article>)}</div>
    </section>
  </>;
}

function TaskDocuments({ detail }: { detail: TaskDetail }) { return <section className="task-block"><div className="workflow-section-head"><div><small>Основания и результат</small><h3>Связанные документы</h3></div><span>{detail.documents.length}</span></div>{detail.documents.length ? detail.documents.map((document) => <article className="linked-document" key={document.id}><header><span>DOC</span><div><strong>{document.title}</strong><small>{document.id} · {document.documentType}</small></div><b>v{document.currentVersion}</b></header><div>{document.versions.map((version) => <p key={version.id}><strong>v{version.version}</strong><span>{version.note || "Без комментария"}</span><small>{version.createdBy} · {version.createdAt}</small></p>)}</div></article>) : <p data-ah-compact-card="true" className="empty-inline">Документы не связаны.</p>}</section>; }

function TaskHistory({ events }: { events: TaskDetail["history"] }) { return <section className="task-block"><div className="workflow-section-head"><div><small>Append-only</small><h3>История процесса</h3></div><span>{events.length}</span></div><div className="workflow-history">{events.map((event) => <article key={event.id}><span /><div><strong>{eventTitle(event.action)}</strong><p>{describePayload(event.payload)}</p><small>{event.actor} · {event.createdAt}</small></div></article>)}</div></section>; }

function TaskCreateModal({ parentTaskId, assignees, close, done, notify }: { parentTaskId: number | null; assignees: Entity[]; close: () => void; done: () => Promise<void>; notify: (value: string) => void }) { const [saving, setSaving] = useState(false); async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); try { const values = Object.fromEntries(new FormData(event.currentTarget).entries()); const assignee = assignees.find((item) => item.id === values.assigneeEntityId); const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, owner: assignee?.displayName || values.owner, parentTaskId, requiresApproval: values.requiresApproval === "on" }) }); const body = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(body.error || "Задача не создана"); await done(); } catch (error) { notify(error instanceof Error ? error.message : "Задача не создана"); } finally { setSaving(false); } } return <div className="modal-layer workflow-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть форму" /><form className="task-modal workflow-modal" onSubmit={submit}><div className="drawer-head"><div><p>Рабочий процесс</p><h2>{parentTaskId ? "Новая подзадача" : "Новая задача"}</h2></div><button type="button" onClick={close}>×</button></div><label><span>Что нужно сделать</span><input name="title" required minLength={4} placeholder="Конкретный проверяемый результат" /></label><label><span>Описание и критерий результата</span><textarea name="description" placeholder="Контекст, ограничение и что считается выполненным" /></label><div className="form-row"><label><span>Ответственный из справочника</span><select name="assigneeEntityId" required defaultValue=""><option value="" disabled>Выберите сотрудника</option>{assignees.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName}</option>)}</select></label><label><span>Срок</span><input name="dueDate" type="date" /></label></div><div className="form-row"><label><span>Тип</span><select name="kind" defaultValue="Задача"><option>Задача</option><option>Поручение</option></select></label><label><span>Приоритет</span><select name="priority" defaultValue="Средний"><option>Высокий</option><option>Средний</option><option>Низкий</option></select></label></div><div className="form-row"><label><span>Повтор</span><select name="recurrenceRule" defaultValue=""><option value="">Не повторяется</option><option>Каждую неделю</option><option>Каждый месяц</option></select></label><label><span>Источник</span><select name="sourceType" defaultValue="Ручная задача"><option>Ручная задача</option><option>Сигнал качества</option><option>Документ</option><option>Финансы</option></select></label></div><input type="hidden" name="sourceId" value={parentTaskId ? `TASK:${parentTaskId}` : "MANUAL"} /><label className="checkbox-field"><input type="checkbox" name="requiresApproval" /><span>Результат должен согласовать руководитель</span></label><div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={saving}>{saving ? "Сохраняем…" : "Создать"}</button></div></form></div>; }

function DocumentModal({ action, assignees, close, done, notify }: { action: { mode: "create" | "version"; document?: WorkflowDocument }; assignees: Entity[]; close: () => void; done: (message: string) => Promise<void>; notify: (value: string) => void }) { async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { const values = Object.fromEntries(new FormData(event.currentTarget).entries()); const response = await fetch("/api/workflow-documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, action: action.mode, documentId: action.document?.id }) }); const body = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(body.error || "Документ не сохранён"); await done(action.mode === "version" ? "Версия документа добавлена" : "Документ и обязательство сохранены"); } catch (error) { notify(error instanceof Error ? error.message : "Документ не сохранён"); } } return <div className="modal-layer workflow-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть форму" /><form className="task-modal workflow-modal" onSubmit={submit}><div className="drawer-head"><div><p>Документы и обязательства</p><h2>{action.mode === "version" ? `Новая версия · ${action.document?.id}` : "Новый документ"}</h2></div><button type="button" onClick={close}>×</button></div>{action.mode === "version" ? <><label><span>Что изменилось</span><textarea name="note" required minLength={3} /></label><label><span>Ссылка / основание</span><input name="reference" placeholder="MANUAL:reference" /></label></> : <><div className="form-row"><label><span>Стабильный ID</span><input name="id" required pattern="[A-ZА-Я0-9-]{5,40}" placeholder="DOC-2026-001" /></label><label><span>Тип</span><input name="documentType" required placeholder="Договор, акт, приказ" /></label></div><label><span>Название</span><input name="title" required minLength={3} /></label><div className="form-row"><label><span>Действует до</span><input name="validUntil" type="date" /></label><label><span>Владелец</span><select name="ownerEntityId" defaultValue=""><option value="">Не назначен</option>{assignees.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName}</option>)}</select></label></div><label><span>Обязательство</span><input name="obligationTitle" placeholder="Например: продлить или закрыть" /></label></>}<div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button>{action.mode === "version" ? "Добавить версию" : "Создать документ"}</button></div></form></div>; }

function nextStatus(value: string) { return getNextTaskStatus(value); }
function transitionLabel(value: string) { return ({ "Входящие": "Запланировать", "Запланировано": "Начать работу", "На проверке": "Подтвердить результат" } as Record<string, string>)[value] || "Следующий статус"; }
function priorityClass(value: string) { return value === "Высокий" ? "high" : value === "Низкий" ? "low" : "medium"; }
function statusClass(value: string) { return ({ "Входящие": "incoming", "Запланировано": "planned", "В работе": "working", "На проверке": "review", "Выполнено": "completed" } as Record<string, string>)[value] || ""; }
function formatDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); }
function isOverdue(task: Task) { return Boolean(task.dueDate && task.status !== "Выполнено" && task.dueDate < new Date().toISOString().slice(0, 10)); }
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((item) => item[0]).join("").toUpperCase(); }
function eventTitle(action: string) { return ({ "task.created": "Задача создана", "task.auto_created": "Автозадача создана", "task.status_changed": "Статус изменён", "task.comment_added": "Добавлен комментарий", "task.watcher_added": "Добавлен наблюдатель", "task.checklist_added": "Добавлен пункт чек-листа", "task.checklist_changed": "Чек-лист обновлён", "task.approval_decided": "Решение согласования", "task.document_linked": "Связан документ", "task.recurrence_created": "Создан следующий повтор" } as Record<string, string>)[action] || action; }
function describePayload(value: string) { try { const payload = JSON.parse(value) as Record<string, unknown>; return Object.entries(payload).map(([key, item]) => `${key}: ${String(item)}`).join(" · "); } catch { return "Событие сохранено"; } }
function roleCode(role: string) { return ({ "Собственник": "OWNER", "Директор": "DIRECTOR", "Представитель Виталия": "REPRESENTATIVE", "Педагог": "TEACHER", "Финансы": "FINANCE" } as Record<string, string>)[role] || "UNKNOWN"; }
