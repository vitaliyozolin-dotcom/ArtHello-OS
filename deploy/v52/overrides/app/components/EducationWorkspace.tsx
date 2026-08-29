"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EDUCATION_BRANCHES, educationBranchId, parseEducationCsv } from "../../lib/education";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./EducationWorkspace.css";
import "./EducationWorkspace.ds.css";

type Program = { id: string; title: string; version: number; status: string; authorEntityId: string; methodistEntityId: string; scope: string; materialRef: string; expectedResult: string };
type Group = { id: string; name: string; unitEntityId: string; programId: string; teacherEntityId: string; room: string; status: string };
type Student = { id: string; childEntityId: string; familyEntityId: string; groupId: string; cabinetStatus: string; status: string };
type Lesson = { id: string; groupId: string; programId: string; scheduledAt: string; topic: string; teacherEntityId: string; substituteEntityId: string; room: string; status: string; homework: string };
type Data = {
  scope: { kind: string; id: string }; programs: Program[]; groups: Group[]; students: Student[]; lessons: Lesson[];
  attendance: Array<{ id: string; lessonId: string; studentId: string; attendanceStatus: string; grade: string; result: string }>;
  progress: Array<{ id: string; studentId: string; programId: string; period: string; metric: string; score: number; trend: string; evidence: string; band: string }>;
  feedback: Array<{ id: string; studentId: string; familyEntityId: string; programId: string; rating: number; comment: string; recommendation: string; status: string; relatedTaskId: number | null }>;
  communications: Array<{ id: string; communicationType: string; audienceType: string; audienceId: string; title: string; body: string; eventAt: string; createdBy: string }>;
  entityNames: Record<string, string>; summary: { groups: number; students: number; lessonsToday: number; attendance: { total: number; present: number; percent: number }; openFeedback: number };
  chain: { programId: string; teacherId: string; groupId: string; lessonId: string; attendanceId: string; progressId: string; feedbackId: string }; privacy: string;
};

const codes: Record<string, string> = { "Собственник": "OWNER", "Директор": "DIRECTOR", "Представитель Виталия": "REPRESENTATIVE", "Педагог": "TEACHER", "Родитель": "PARENT", "Методист": "METHODIST", "Финансы": "FINANCE", "Продажи": "SALES", "Маркетинг": "MARKETING" };
const tabs = ["Структура", "Сегодня", "Журнал", "Прогресс", "Программы", "Семья и коммуникации"] as const;
type Tab = typeof tabs[number];
type EditorKind = "program" | "group" | "lesson" | "student";
const fmt = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function EducationWorkspace({ workspace, role, notify, onTasksChanged, onOpenIntegrations, focusId }: {
  workspace: "education" | "methods"; role: string; notify: (value: string) => void; onTasksChanged: () => void; onOpenIntegrations: () => void; focusId?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(() => workspace === "methods" ? "Программы" : "Структура");
  const [branchId, setBranchId] = useState("all");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [editor, setEditor] = useState<EditorKind | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/education", { cache: "no-store", headers: { "x-arthello-role": codes[role] ?? "" } });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload); setError("");
    } catch (cause) { setData(null); setError(cause instanceof Error ? cause.message : "Нет доступа"); }
    finally { setLoading(false); }
  }, [role]);

  useEffect(() => { const handle = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(handle); }, [load]);
  useEffect(() => { if (!focusId) return; const handle = window.setTimeout(() => { setSelectedGroupId(focusId); setTab("Сегодня"); }, 0); return () => window.clearTimeout(handle); }, [focusId]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/education-actions", { method: "POST", headers: { "content-type": "application/json", "x-arthello-role": codes[role] ?? "" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; reused?: boolean; imported?: number; reviewRequired?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.imported ? `Импортировано ${payload.imported} строк на проверку` : payload.reviewRequired ? "Сохранено со статусом «На проверке»" : payload.reused ? "Задача уже существует" : "Действие сохранено");
      setEditor(null); setImportOpen(false); await load(); onTasksChanged();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Ошибка"); }
    finally { setBusy(""); }
  }

  const canManage = ["Собственник", "Директор", "Представитель Виталия", "Методист"].includes(role);
  const branchCounts = useMemo(() => Object.fromEntries(EDUCATION_BRANCHES.map((branch) => [branch.id, data?.groups.filter((group) => educationBranchId(group.unitEntityId) === branch.id).length ?? 0])), [data]);

  if (loading) return <PageContainer className="ahEducationPage"><EmptyState className="ahEducationEmpty" density="compact" title="Загружаем учебный контур" description="Проверяем программы, группы, занятия и журнал." /></PageContainer>;
  if (error || !data) return <PageContainer className="ahEducationPage"><EmptyState className="ahEducationEmpty" density="compact" title={error || "Учебный контур недоступен"} description="Роль не получает скрытые образовательные или медицинские данные." action={<Button variant="secondary" onClick={() => void load()}>Повторить</Button>} /></PageContainer>;

  const focusedStudent = data.students.find((student) => student.id === focusId || student.childEntityId === focusId);
  const requestedGroupId = selectedGroupId || focusedStudent?.groupId || focusId || "";
  const focusedGroup = data.groups.find((group) => group.id === requestedGroupId);
  const branchGroups = data.groups.filter((group) => branchId === "all" || educationBranchId(group.unitEntityId) === branchId);
  const visibleGroups = focusedGroup ? [focusedGroup] : branchGroups;
  const groupIds = new Set(visibleGroups.map((group) => group.id));
  const visibleStudents = data.students.filter((student) => groupIds.has(student.groupId));
  const visibleLessons = data.lessons.filter((item) => groupIds.has(item.groupId));
  const lessonIds = new Set(visibleLessons.map((item) => item.id));
  const studentIds = new Set(visibleStudents.map((student) => student.id));
  const visibleAttendance = data.attendance.filter((row) => lessonIds.has(row.lessonId) && studentIds.has(row.studentId));
  const visibleProgress = data.progress.filter((row) => studentIds.has(row.studentId));
  const lesson = visibleLessons[0];
  const activeProgram = data.programs.find((program) => program.id === focusedGroup?.programId);
  const chainAttendance = visibleAttendance[0];
  const chainProgress = visibleProgress[0];
  const chainFeedback = data.feedback.find((row) => studentIds.has(row.studentId));
  const attendancePercent = visibleAttendance.length ? Math.round(visibleAttendance.filter((row) => row.attendanceStatus === "Присутствовал").length / visibleAttendance.length * 100) : 0;
  const workspaceTitle = workspace === "methods" ? "Методики" : "Обучение";
  const hasEducationData = Boolean(data.programs.length || data.groups.length || data.students.length || data.lessons.length || data.attendance.length || data.progress.length || data.feedback.length || data.communications.length);

  return <PageContainer className="ahEducationPage">
    <PageHeader
      eyebrow={workspace === "methods" ? "ВЕРСИИ ПРОГРАММ · РЕЗУЛЬТАТЫ · УЛУЧШЕНИЯ" : "СТРУКТУРА · РАСПИСАНИЕ · ЖУРНАЛ"}
      title={workspaceTitle}
      description={workspace === "methods" ? "Программы, материалы, версии и результаты образуют проверяемую цепочку улучшения." : "Филиал → класс или группа → ученики → занятия → журнал. Новые данные создаются вручную или приходят контролируемым импортом."}
      actions={canManage ? <div className="ahEducationHeaderActions"><Button variant="secondary" onClick={() => setImportOpen(true)}>Импортировать</Button><Button variant="primary" onClick={() => setEditor(data.programs.length ? "group" : "program")}>{data.programs.length ? "Добавить" : "Создать программу"}</Button></div> : undefined}
    />

    <Card className="ahEducationRule"><strong>ЕДИНЫЙ ИСТОЧНИК</strong><span>Семьи и дети создаются в «Клиентах». Здесь они только назначаются в класс или группу. Импорт не выдаёт доступ и всегда сохраняется со статусом «На проверке».</span></Card>

    <div className="ahEducationBranches"><Tabs value={branchId} onChange={(value) => { setBranchId(value); setSelectedGroupId(""); }} ariaLabel="Филиалы обучения" items={[
      { id: "all", label: <>Все филиалы <b>{data.groups.length}</b></> },
      ...EDUCATION_BRANCHES.map((branch) => ({ id: branch.id, label: <>{branch.label} <b>{branchCounts[branch.id]}</b></> })),
    ]} /></div>

    {focusedGroup ? <Card className="ahEducationFocus"><div><small>Открыт класс / группа</small><strong>{focusedGroup.name}</strong><span>{EDUCATION_BRANCHES.find((branch) => branch.id === educationBranchId(focusedGroup.unitEntityId))?.label} · {visibleStudents.length} учеников · {focusedGroup.room || "кабинет не указан"}</span></div><Button variant="ghost" onClick={() => { setSelectedGroupId(""); setTab("Структура"); }}>Все группы филиала</Button></Card> : null}

    <div className="ahEducationKpis">
      <KpiCard label="Классы и группы" value={String(visibleGroups.length)} note={branchId === "all" ? "во всех филиалах" : "в выбранном филиале"} onClick={() => setTab("Структура")} />
      <KpiCard label="Занятия" value={String(visibleLessons.length)} note="в текущем фильтре" onClick={() => setTab("Сегодня")} />
      <KpiCard label="Посещаемость" value={`${attendancePercent}%`} note={`${visibleAttendance.filter((row) => row.attendanceStatus === "Присутствовал").length} из ${visibleAttendance.length}`} onClick={() => setTab("Журнал")} />
      <KpiCard label="Ученики" value={String(visibleStudents.length)} note={`${visibleStudents.filter((student) => student.status === "На проверке").length} на проверке`} onClick={() => setTab("Прогресс")} />
    </div>

    <div className="ahEducationTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы обучения" /></div>

    {hasEducationData ? <>

    {tab === "Структура" ? <div className="edu-structure">
      <article className="edu-panel edu-groups-panel"><Head p="Структура филиала" h="Классы и группы" s={`${visibleGroups.length} записей`} /><div className="edu-group-grid">{visibleGroups.map((group) => {
        const students = data.students.filter((student) => student.groupId === group.id);
        const lessons = data.lessons.filter((item) => item.groupId === group.id);
        const program = data.programs.find((item) => item.id === group.programId);
        return <button key={group.id} onClick={() => { setSelectedGroupId(group.id); setTab("Сегодня"); }}><header><span>{EDUCATION_BRANCHES.find((branch) => branch.id === educationBranchId(group.unitEntityId))?.label}</span><em>{group.status}</em></header><h3>{group.name}</h3><p>{program?.title ?? group.programId}</p><dl><div><dt>Ученики</dt><dd>{students.length}</dd></div><div><dt>Педагог</dt><dd>{data.entityNames[group.teacherEntityId] ?? group.teacherEntityId}</dd></div><div><dt>Занятия</dt><dd>{lessons.length}</dd></div><div><dt>Кабинет</dt><dd>{group.room || "—"}</dd></div></dl><footer>Открыть группу →</footer></button>;
      })}</div></article>
      <aside className="edu-panel edu-entry-map"><Head p="Как наполнять" h="Три контролируемых входа" s="без автодоступа" /><ol data-ah-compact-card="true"><li><span>1</span><div><strong>AlfaCRM</strong><small>Семьи и дети приходят в «Клиенты», затем назначаются сюда в группу.</small><button onClick={onOpenIntegrations}>Настроить AlfaCRM →</button></div></li><li><span>2</span><div><strong>CSV после проверки</strong><small>Группы, занятия и назначения учеников загружаются пакетом со статусом «На проверке».</small><button onClick={() => setImportOpen(true)}>Открыть импорт →</button></div></li><li><span>3</span><div><strong>Ручное добавление</strong><small>{data.programs.length ? "Класс, занятие или назначение существующего ребёнка." : "Сначала создайте первую учебную программу, затем класс или группу."}</small><button onClick={() => setEditor(data.programs.length ? "group" : "program")}>{data.programs.length ? "Добавить вручную →" : "Создать программу →"}</button></div></li></ol></aside>
    </div> : null}

    {tab === "Сегодня" ? <div className="edu-layout">
      <article className="edu-panel"><Head p="Расписание" h={focusedGroup ? focusedGroup.name : "Учебный день"} s={`${visibleLessons.length} занятий`} /><div data-ah-compact-card="true" className="lesson-list">{visibleLessons.map((item) => <article key={item.id}><time>{fmt(item.scheduledAt)}</time><div><strong>{item.topic}</strong><small>{data.groups.find((group) => group.id === item.groupId)?.name} · {item.room}</small></div><span>{data.entityNames[item.substituteEntityId || item.teacherEntityId] ?? item.teacherEntityId}{item.substituteEntityId ? " · замена" : ""}</span><em>{item.status}</em></article>)}</div>{canManage ? <button className="edu-inline-add" onClick={() => setEditor("lesson")}>+ Добавить занятие</button> : null}</article>
      {focusedGroup || lesson || activeProgram ? <article className="edu-panel edu-chain"><Head p="Приёмочный маршрут" h="От программы до улучшения" s="связи сохранены" /><div data-ah-compact-card="true">{[
        ["Программа", activeProgram?.id, activeProgram ? `v${activeProgram.version}` : "не назначена"],
        ["Педагог", focusedGroup?.teacherEntityId, focusedGroup ? data.entityNames[focusedGroup.teacherEntityId] : "не назначен"],
        ["Группа", focusedGroup?.id, `${visibleStudents.length} учеников`],
        ["Занятие", lesson?.id, lesson?.topic],
        ["Посещаемость", chainAttendance?.id, `${attendancePercent}%`],
        ["Результат", chainProgress?.id, chainProgress?.trend],
        ["Отзыв", chainFeedback?.id, chainFeedback ? "семья" : "не добавлен"],
      ].map(([a, b, c], index) => <article key={String(a)}><span>{index + 1}</span><div><small>{a}</small><strong>{b || "—"}</strong><em>{c || "—"}</em></div></article>)}</div></article> : <article className="edu-panel"><Head p="Приёмочный маршрут" h="Связей пока нет" s="данных пока нет" /><p className="empty-inline">Добавьте группу и назначьте программу, педагога и занятие. Связи появятся из сохранённых записей.</p></article>}
    </div> : null}

    {tab === "Журнал" ? <article className="edu-panel"><Head p="Электронный журнал" h="Посещаемость, оценка и результат" s={`${visibleAttendance.length} записей`} /><div className="ahEducationTable"><table><thead><tr><th>Ученик</th><th>Занятие</th><th>Статус</th><th>Оценка</th><th>Наблюдаемый результат</th><th>Действие</th></tr></thead><tbody>{visibleAttendance.map((row) => <tr key={row.id}><td>{data.entityNames[data.students.find((student) => student.id === row.studentId)?.childEntityId ?? ""] ?? row.studentId}</td><td>{row.lessonId}</td><td>{row.attendanceStatus}</td><td>{row.grade || "—"}</td><td>{row.result}</td><td><button disabled={busy === row.id} onClick={() => void action({ action: "recordAttendance", id: row.id, attendanceStatus: row.attendanceStatus === "Присутствовал" ? "Опоздал" : "Присутствовал", result: "Статус уточнён педагогом на занятии" }, row.id)}>Уточнить</button></td></tr>)}</tbody></table></div><footer>Домашнее задание: {lesson?.homework || "не задано"}</footer></article> : null}

    {tab === "Прогресс" ? <div className="progress-grid">{visibleProgress.map((row) => <article key={row.id}><header><span>{row.score}</span><div><strong>{data.entityNames[data.students.find((student) => student.id === row.studentId)?.childEntityId ?? ""]}</strong><small>{row.period} · {row.trend}</small></div><em>{row.band}</em></header><h2>{row.metric}</h2><p>{row.evidence}</p><footer>Сигнал для педагога и семьи, не автоматическое решение</footer></article>)}</div> : null}

    {tab === "Программы" ? data.programs.length ? <div className="program-grid">{data.programs.filter((item) => visibleGroups.some((group) => group.programId === item.id) || branchId === "all").map((item) => <article key={item.id}><header><span>{item.id}</span><em>{item.status}</em></header><h2>{item.title} · v{item.version}</h2><p>{item.expectedResult}</p><dl><div><dt>Автор</dt><dd>{data.entityNames[item.authorEntityId] ?? item.authorEntityId}</dd></div><div><dt>Методист</dt><dd>{data.entityNames[item.methodistEntityId] ?? item.methodistEntityId}</dd></div><div><dt>Материал</dt><dd>{item.materialRef || "Не указан"}</dd></div><div><dt>Область</dt><dd>{item.scope}</dd></div></dl><button disabled={busy === item.id} onClick={() => void action({ action: "createProgramVersion", programId: item.id, note: "Обновление по результату занятия и обратной связи семьи" }, item.id)}>+ Версия с основанием</button></article>)}</div> : <div data-ah-compact-card="true" className="manual-module-empty"><span>＋</span><h2>Учебных программ пока нет</h2><p>Создайте первую рабочую программу. После сохранения её можно будет выбрать при создании класса или группы.</p>{canManage ? <button className="primary-action" onClick={() => setEditor("program")}>Создать программу</button> : null}</div> : null}

    {tab === "Семья и коммуникации" ? <div className="edu-layout"><article className="edu-panel"><Head p="Обратная связь" h="Отзывы и рекомендации" s={`${data.feedback.length} записей`} /><div className="feedback-list">{data.feedback.map((row) => <article key={row.id}><header><strong>{data.entityNames[row.familyEntityId]}</strong><span>{"★".repeat(row.rating)}</span><em>{row.status}</em></header><p>{row.comment}</p><div>{row.recommendation}</div><footer>{row.relatedTaskId ? <span>Задача TSK-{String(row.relatedTaskId).padStart(4, "0")}</span> : <button disabled={busy === row.id} onClick={() => void action({ action: "createFeedbackTask", feedbackId: row.id }, row.id)}>+ Методическая задача</button>}</footer></article>)}</div></article><article className="edu-panel"><Head p="Личный кабинет" h="Новости, события и чат" s="по области доступа" /><div className="comm-list">{data.communications.map((row) => <article key={row.id}><span>{row.communicationType.slice(0, 1)}</span><div><strong>{row.title}</strong><p>{row.body}</p><small>{row.audienceType} · {row.audienceId}{row.eventAt ? ` · ${fmt(row.eventAt)}` : ""}</small></div></article>)}</div></article></div> : null}
    </> : <EmptyState className="ahEducationEmpty" density="compact" title="Учебных данных пока нет" description="Создайте первую программу или импортируйте проверенный набор. Доступы ученикам и родителям автоматически не выдаются." action={canManage ? <Button variant="primary" onClick={() => setEditor("program")}>Создать программу</Button> : undefined} />}

    {editor ? <EducationEditor kind={editor} data={data} defaultGroupId={focusedGroup?.id ?? ""} busy={busy} close={() => setEditor(null)} submit={(body) => void action(body, `create:${editor}`)} setKind={(kind) => setEditor(kind)} /> : null}
    {importOpen ? <EducationImport busy={busy} close={() => setImportOpen(false)} openIntegrations={onOpenIntegrations} submit={(rows) => void action({ action: "importEducationRows", rows }, "import")} /> : null}
  </PageContainer>;
}

function EducationEditor({ kind, data, defaultGroupId, busy, close, submit, setKind }: { kind: EditorKind; data: Data; defaultGroupId: string; busy: string; close: () => void; submit: (body: Record<string, unknown>) => void; setKind: (kind: EditorKind) => void }) {
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); submit({ action: kind === "program" ? "createProgram" : kind === "group" ? "createGroup" : kind === "lesson" ? "createLesson" : "enrollStudent", ...Object.fromEntries(new FormData(event.currentTarget).entries()) }); }
  return <div className="modal-layer edu-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть" /><form className="task-modal edu-editor" onSubmit={save}><header className="drawer-head"><div><p>Обучение · ручное добавление</p><h2>{kind === "program" ? "Учебная программа" : kind === "group" ? "Класс или группа" : kind === "lesson" ? "Занятие" : "Назначение ученика"}</h2></div><button type="button" onClick={close}>×</button></header><nav>{(["program", "group", "lesson", "student"] as EditorKind[]).map((item) => <button type="button" key={item} disabled={item !== "program" && !data.programs.length} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item === "program" ? "Программа" : item === "group" ? "Группа" : item === "lesson" ? "Занятие" : "Ученик"}</button>)}</nav><div className="edu-editor-body">
    {kind === "program" ? <><label className="wide"><span>Название программы</span><input name="title" required placeholder="Название рабочей программы" /></label><label><span>Область</span><input name="scope" required placeholder="Возраст, предмет или направление" /></label><label><span>ID методиста</span><input name="methodistEntityId" placeholder="Можно оставить пустым" /></label><label className="wide"><span>Ожидаемый результат</span><textarea name="expectedResult" required placeholder="Какой проверяемый результат должна дать программа" /></label><label className="wide"><span>Материал или документ</span><input name="materialRef" placeholder="Ссылка или номер документа — необязательно" /></label></> : null}
    {kind === "group" ? <><label><span>Название</span><input name="name" required placeholder="3А / Старшая группа" /></label><label><span>Филиал</span><select name="branchId" required>{EDUCATION_BRANCHES.map((branch) => <option key={branch.id} value={branch.id}>{branch.label}</option>)}</select></label><label><span>Программа</span><select name="programId" required>{data.programs.map((program) => <option key={program.id} value={program.id}>{program.title} · v{program.version}</option>)}</select></label><label><span>ID педагога</span><input name="teacherId" required placeholder="EMP-… из раздела Команда" /></label><label><span>Кабинет</span><input name="room" placeholder="Кабинет 12" /></label></> : null}
    {kind === "lesson" ? <><label><span>Класс / группа</span><select name="groupId" required defaultValue={defaultGroupId}>{!defaultGroupId ? <option value="">Выберите группу</option> : null}{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label><span>Дата и время</span><input type="datetime-local" name="scheduledAt" required /></label><label className="wide"><span>Тема занятия</span><input name="topic" required /></label><label><span>ID педагога</span><input name="teacherId" required placeholder="EMP-…" /></label><label><span>Кабинет</span><input name="room" /></label><label className="wide"><span>Домашнее задание</span><textarea name="homework" /></label></> : null}
    {kind === "student" ? <><div className="edu-editor-note wide"><strong>Ребёнок здесь не создаётся</strong><span>Сначала создайте или импортируйте семью в «Клиентах», затем укажите её стабильные ID.</span></div><label><span>ID ребёнка</span><input name="childId" required placeholder="CHD-…" /></label><label><span>ID семьи</span><input name="familyId" required placeholder="FAM-…" /></label><label className="wide"><span>Класс / группа</span><select name="groupId" required defaultValue={defaultGroupId}>{!defaultGroupId ? <option value="">Выберите группу</option> : null}{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></> : null}
  </div><footer className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={Boolean(busy)}>{busy ? "Сохраняем…" : "Сохранить на проверку"}</button></footer></form></div>;
}

function EducationImport({ busy, close, openIntegrations, submit }: { busy: string; close: () => void; openIntegrations: () => void; submit: (rows: Array<Record<string, string>>) => void }) {
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [fileName, setFileName] = useState("");
  async function readFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setRows(parseEducationCsv(await file.text())); }
  function template() { const content = "type;name;branchId;programId;teacherId;room;childId;familyId;groupId;scheduledAt;topic;homework\n;;;;;;;;;;;"; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })); link.download = "arthello-education-import.csv"; link.click(); URL.revokeObjectURL(link.href); }
  return <div className="modal-layer edu-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть" /><section className="task-modal edu-import"><header className="drawer-head"><div><p>Обучение · контролируемый импорт</p><h2>Загрузка данных</h2></div><button onClick={close}>×</button></header><div data-ah-compact-card="true" className="edu-import-body"><article><span>01</span><div><strong>Семьи и дети из AlfaCRM</strong><p>Сначала попадают в «Клиенты» на проверку. После проверки ребёнок назначается в нужную группу.</p><button onClick={openIntegrations}>Настроить AlfaCRM →</button></div></article><article><span>02</span><div><strong>Группы, занятия и назначения из CSV</strong><p>Поддерживаются строки group/группа, lesson/занятие и student/ученик. Ни одна строка не становится активной автоматически.</p><div className="edu-file-row"><label><input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event)} /><span>{fileName || "Выбрать CSV"}</span></label><button onClick={template}>Скачать шаблон</button></div>{fileName ? <div className="edu-import-preview"><strong>{rows.length} строк распознано</strong><span>{rows.length ? "После подтверждения они получат статус «На проверке»." : "Проверьте заголовки и разделитель файла."}</span></div> : null}</div></article><article><span>03</span><div><strong>Контроль перед записью</strong><p>При ошибке хотя бы в одной строке пакет останавливается целиком. Доступы ученикам и родителям не выдаются.</p></div></article></div><footer className="modal-actions"><button onClick={close}>Отмена</button><button disabled={!rows.length || busy === "import"} onClick={() => submit(rows)}>{busy === "import" ? "Импортируем…" : `Импортировать ${rows.length || ""} на проверку`}</button></footer></section></div>;
}

function Head({ p, h, s }: { p: string; h: string; s: string }) { return <header className="edu-panel-head"><div><p>{p}</p><h2>{h}</h2></div><span>{s}</span></header>; }
