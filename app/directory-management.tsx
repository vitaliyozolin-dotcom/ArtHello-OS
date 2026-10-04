"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SchoolSnapshot } from "./level-zero-types";
import { roleLabels } from "./level-zero-types";
import "./directory-management.css";

type Subject = { id: string; name: string; shortName: string; stage: string; weeklyHours: number; status: string };
type Directory = { revision: string; subjects: Subject[] };
type Editor = { action: string; id?: string; name?: string; shortName?: string; stage?: string; weeklyHours?: number; teacherId?: string; className?: string; subjectId?: string; revision: string };
type Tab = "subjects" | "assignments" | "classes" | "access";
const tabs: { id: Tab; label: string }[] = [{ id: "subjects", label: "Предметы" }, { id: "assignments", label: "Назначения педагогов" }, { id: "classes", label: "Классы" }, { id: "access", label: "Доступы" }];
const statusLabel = (status: string) => ({ active: "Активен", setup: "Доступ не активирован", blocked: "Заблокирован", suspended: "Приостановлен", archived: "В архиве" }[status] ?? status);

export function DirectoryManagement({ snapshot, onSaved }: { snapshot: SchoolSnapshot; onSaved: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>("subjects");
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const matches = (...values: (string | undefined)[]) => values.join(" ").toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));

  async function reload() {
    const response = await fetch("/api/directory", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить справочники");
    setData(payload as Directory);
  }
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (tabs.some(item => item.id === requested)) setTab(requested as Tab);
    void reload().catch(error => setError(error.message));
  }, []);
  useEffect(() => { if (editor) formRef.current?.querySelector<HTMLElement>("input,select,button")?.focus(); }, [editor]);
  function open(values: Omit<Editor, "revision">) {
    if (!data) return;
    triggerRef.current = document.activeElement as HTMLElement;
    setEditor({ ...values, revision: data.revision }); setError(""); setNotice("");
  }
  function close() { setEditor(null); requestAnimationFrame(() => triggerRef.current?.focus()); }
  async function save(body: Record<string, unknown>) {
    if (!data || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/directory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: data.revision, ...body }) });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409) await reload();
        throw new Error(payload.error ?? "Не удалось сохранить");
      }
      setData(payload); close(); await onSaved(); setNotice("Изменения сохранены");
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить"); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    void save({ ...editor, ...Object.fromEntries(new FormData(event.currentTarget)) });
  }
  const teachers = snapshot.users.filter(user => user.role === "teacher" && user.profileStatus === "confirmed" && ["active", "setup"].includes(user.status));
  const assignments = snapshot.teacherAssignments.filter(item => item.status === "confirmed" && matches(item.teacherName, item.className, item.subjectName));
  const subjects = data?.subjects.filter(item => matches(item.name) && (status === "all" || item.status === status)) ?? [];
  const users = snapshot.users.filter(user => matches(user.displayName, user.email) && (role === "all" || user.role === role) && (status === "all" || user.status === status));

  return <section className="content-card directory-management" aria-label="Управление справочниками">
    <header className="directory-heading"><div><h2>Управление школой</h2><p>Предметы, классы, назначения и доступы</p></div></header>
    <nav className="directory-tabs" aria-label="Разделы управления">{tabs.map(item => <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} className={tab === item.id ? "primary-btn" : "secondary-btn"} onClick={() => { setTab(item.id); setQuery(""); setStatus("all"); setError(""); }}>{item.label}</button>)}</nav>
    {notice ? <p role="status">{notice}</p> : null}
    {error && !editor ? <div role="alert" className="directory-error">{error} <button type="button" className="secondary-btn" disabled={busy} onClick={() => { setError(""); void reload().catch(error => setError(error.message)); }}>Обновить список</button></div> : null}
    {!data ? <p role="status">{error ? "Справочники не загружены" : "Загружаем справочники…"}</p> : <>
      <div className="directory-toolbar">
        <label>Поиск<input value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === "subjects" ? "Название предмета" : "Имя, класс или предмет"} /></label>
        {tab === "subjects" || tab === "access" ? <label>Статус<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Все статусы</option><option value="active">Активные</option><option value="archived">Архив</option>{tab === "access" ? <><option value="setup">Не активирован</option><option value="blocked">Заблокирован</option><option value="suspended">Приостановлен</option></> : null}</select></label> : null}
        {tab === "access" ? <label>Роль<select value={role} onChange={event => setRole(event.target.value)}><option value="all">Все роли</option>{Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label> : null}
        {tab === "subjects" ? <button className="primary-btn" type="button" onClick={() => open({ action: "subject.save", weeklyHours: 0, stage: "1–6" })}>Добавить предмет</button> : null}
        {tab === "assignments" ? <button className="primary-btn" type="button" onClick={() => open({ action: "assignment.save" })} disabled={!teachers.length || !snapshot.classes.length || !snapshot.subjects.length}>Назначить педагога</button> : null}
      </div>
      {tab === "subjects" ? <div className="directory-list">{subjects.map(subject => <article key={subject.id}><div><strong>{subject.name}</strong><small>{subject.stage} классы · {subject.weeklyHours} ч. в неделю · {subject.status === "active" ? "Действующий" : "В архиве"}</small></div><div className="directory-actions"><button type="button" className="secondary-btn" onClick={() => open({ ...subject, action: "subject.save" })}>Изменить</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => { if (window.confirm(subject.status === "active" ? `Перенести «${subject.name}» в архив? История сохранится.` : `Восстановить «${subject.name}»?`)) void save({ action: subject.status === "active" ? "subject.archive" : "subject.restore", id: subject.id }); }}>{subject.status === "active" ? "В архив" : "Восстановить"}</button></div></article>)}{!subjects.length ? <p>Предметы не найдены. Измените поиск или добавьте предмет.</p> : null}</div> : null}
      {tab === "assignments" ? <><p>Назначение даёт учителю доступ к выбранному классу и предмету. Смена педагога в действующих уроках выполняется через расписание.</p><div className="directory-list">{assignments.map(item => <article key={item.id}><div><strong>{item.teacherName}</strong><small>{item.className} класс · {item.subjectName}</small></div><button type="button" className="secondary-btn" disabled={busy} onClick={() => { if (window.confirm(`Снять назначение: ${item.teacherName}, ${item.className} класс, ${item.subjectName}?`)) void save({ action: "assignment.archive", id: item.id }); }}>Снять назначение</button></article>)}{!assignments.length ? <p>Назначения не найдены.</p> : null}</div>{!teachers.length ? <p>Сначала подтвердите карточку педагога и его доступ в ArtHello OS.</p> : null}</> : null}
      {tab === "classes" ? <><p>Состав и названия классов управляются в общем разделе обучения. Здесь назначается классный руководитель.</p><a className="secondary-btn" href="/api/auth/return-to-arthello?section=education">Классы и состав в ArtHello OS</a><div className="directory-list">{snapshot.classes.filter(item => matches(item.name, item.homeroomTeacherName ?? "")).map(item => <article key={item.id}><div><strong>{item.name} класс</strong><small>{snapshot.students.filter(student => student.className === item.name).length} учеников · {item.homeroomTeacherName ?? "Классный руководитель не назначен"}</small></div><button type="button" className="secondary-btn" onClick={() => open({ action: "class.homeroom", id: item.id, teacherId: item.homeroomTeacherUserId ?? "" })}>Изменить руководителя</button></article>)}</div></> : null}
      {tab === "access" ? <><p>Выдача, изменение и блокировка доступа сохраняются в ArtHello OS и передаются в дневник.</p><div className="directory-actions"><a className="primary-btn" href="/api/auth/return-to-arthello?section=access">Управлять доступами</a><a className="secondary-btn" href="/api/auth/return-to-arthello?section=clients">Ученики и родители</a><a className="secondary-btn" href="/api/auth/return-to-arthello?section=hr">Сотрудники</a></div><div className="directory-list">{users.map(user => <article key={user.id}><div><strong>{user.displayName}</strong><small>{roleLabels[user.role]} · {statusLabel(user.status)}</small></div><span>{user.email.endsWith("@school.local") ? "Локальная карточка" : user.email}</span></article>)}{!users.length ? <p>Пользователи не найдены.</p> : null}</div></> : null}
    </>}
    {editor ? <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
      <form className="action-modal directory-editor" ref={formRef} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="directory-editor-title" onKeyDown={event => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); close(); }
        if (event.key === "Tab") { const controls = Array.from(formRef.current?.querySelectorAll<HTMLElement>('input,select,button:not(:disabled)') ?? []); if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); } }
      }}>
        <h2 id="directory-editor-title">{editor.action === "subject.save" ? editor.id ? "Изменить предмет" : "Добавить предмет" : editor.action === "class.homeroom" ? "Классный руководитель" : "Назначить педагога"}</h2>
        {editor.action === "subject.save" ? <><label>Название<input name="name" required maxLength={120} defaultValue={editor.name} /></label><label>Краткое название<input name="shortName" required maxLength={30} defaultValue={editor.shortName} /></label><label>Классы<input name="stage" required maxLength={40} defaultValue={editor.stage} /></label><label>Часов в неделю<input name="weeklyHours" type="number" required min={0} max={40} step={1} defaultValue={editor.weeklyHours} /></label></> : <>
          <label>Педагог<select name="teacherId" defaultValue={editor.teacherId ?? ""} required={editor.action !== "class.homeroom"}><option value="">{editor.action === "class.homeroom" ? "Не назначен" : "Выберите педагога"}</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}</select></label>
          {editor.action === "assignment.save" ? <><label>Класс<select name="className" required defaultValue=""><option value="" disabled>Выберите класс</option>{snapshot.classes.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label><label>Предмет<select name="subjectId" required defaultValue=""><option value="" disabled>Выберите предмет</option>{data?.subjects.filter(subject => subject.status === "active").map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label></> : null}
        </>}
        {error ? <p role="alert" className="directory-error">{error} {data && editor.revision !== data.revision ? "Закройте форму и откройте её заново по обновлённым данным." : ""}</p> : null}
        <footer className="directory-actions"><button type="button" className="secondary-btn" onClick={close} disabled={busy}>Отмена</button><button className="primary-btn" type="submit" disabled={busy || Boolean(data && editor.revision !== data.revision)}>{busy ? "Сохраняем…" : "Сохранить"}</button></footer>
      </form>
    </div> : null}
  </section>;
}
