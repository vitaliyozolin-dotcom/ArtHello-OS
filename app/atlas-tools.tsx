"use client";
import { useState, type FormEvent } from "react";
import type { ActionKind, AttendanceRecord, SchoolSnapshot } from "./level-zero-types";
import styles from "./atlas-tools.module.css";
type Props = { snapshot: SchoolSnapshot; submit: (kind: ActionKind, values: Record<string, unknown>) => Promise<void> };
const leaders = new Set(["director", "deputy"]);
const labels: Record<string, string> = {present:"Присутствует", absent:"Отсутствует", late:"Опоздал", excused:"Уважительная причина"};
const today = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Moscow"}).format(new Date());

export function AtlasSetup({snapshot, onCalendar}: {snapshot:SchoolSnapshot; onCalendar:()=>void}) {
  if (!leaders.has(snapshot.viewer.role) || (snapshot.school.academicYear && snapshot.classes.length && snapshot.subjects.length && snapshot.lessons.length)) return null;
  return <section className={`content-card ${styles.panel}`} aria-labelledby="atlas-setup"><span className="eyebrow">Первый запуск</span><h2 id="atlas-setup">Подготовим учебный год «Атласа»</h2><ol className={styles.steps}>
    <li>{snapshot.school.academicYear ? `Учебный год ${snapshot.school.academicYear} настроен` : "Укажите даты учебного года и каникул в календаре."}</li>
    <li>{snapshot.classes.length ? `Классов подключено: ${snapshot.classes.length}` : "Подключите в ArtHello классы, сотрудников и семьи школы «Атлас». После синхронизации они появятся здесь."}</li>
    <li>Добавьте предметы в управлении и назначьте педагогам классы и предметы в разделе «Люди».</li>
    <li>Составьте расписание. Затем загрузите КТП в разделе «Учебный процесс» и проверьте распределение тем.</li>
  </ol><button className="primary-btn" onClick={onCalendar}>Настроить календарь</button></section>;
}

export function AcademicSettings({snapshot, submit}:Props) {
  const [id,setId] = useState(snapshot.school.academicYear);
  const [startsOn,setStart] = useState(snapshot.school.startsOn ?? "");
  const [endsOn,setEnd] = useState(snapshot.school.endsOn ?? "");
  const [periods,setPeriods] = useState(snapshot.academicCalendarPeriods.map(p=>({title:p.title, startsOn:p.startsOn, endsOn:p.endsOn})));
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  if (!leaders.has(snapshot.viewer.role)) return null;
  async function save(e:FormEvent) {e.preventDefault();setError("");setBusy(true);try {await submit("calendar.configure",{id,startsOn,endsOn,periods});}catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить");}finally{setBusy(false);}}
  function update(index:number, field:string, value:string){setPeriods(periods.map((p,i)=>i===index?{...p,[field]:value}:p));}
  return <section className={`content-card ${styles.panel}`}><h2>Учебный год и каникулы</h2><p>Распределение КТП учитывает эти даты и расписание. После загрузки программы календарь этого года блокируется: уже назначенные даты требуют отдельного пересмотра.</p><form onSubmit={save} className={styles.form}>
    <div className={styles.fields}><label>Учебный год<input required pattern="[0-9]{4}/[0-9]{2}" placeholder="2026/27" value={id} onChange={e=>setId(e.target.value)}/></label><label>Первый учебный день<input required type="date" value={startsOn} onChange={e=>setStart(e.target.value)}/></label><label>Последний учебный день<input required type="date" value={endsOn} onChange={e=>setEnd(e.target.value)}/></label></div>
    <h3>Каникулы и неучебные дни</h3><p>Добавьте все периоды, когда занятия не проводятся. Для одного праздничного дня укажите одинаковые даты.</p>
    {periods.map((p,i)=><div key={i} className={styles.fields}><label>Название<input required maxLength={120} value={p.title} onChange={e=>update(i,"title",e.target.value)}/></label><label>Начало<input required type="date" value={p.startsOn} onChange={e=>update(i,"startsOn",e.target.value)}/></label><label>Окончание<input required type="date" value={p.endsOn} onChange={e=>update(i,"endsOn",e.target.value)}/></label><button type="button" className="ghost-btn" aria-label={`Удалить период ${p.title || i+1}`} onClick={()=>setPeriods(periods.filter((_,n)=>n!==i))}>Удалить</button></div>)}
    <div className={styles.actions}><button type="button" className="ghost-btn" disabled={busy || periods.length>=40} onClick={()=>setPeriods([...periods,{title:"",startsOn:"",endsOn:""}])}>Добавить период</button><button className="primary-btn" disabled={busy}>{busy?"Сохраняем…":"Сохранить учебный календарь"}</button></div>{error?<p role="alert" className={styles.error}>{error}</p>:null}
  </form></section>;
}

export function SubjectSettings({snapshot,submit}:Props){
  const [name,setName]=useState(""); const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  if(!leaders.has(snapshot.viewer.role))return null;
  async function save(e:FormEvent){e.preventDefault();setError("");setBusy(true);try{await submit("subject.upsert",{name});setName("");}catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить");}finally{setBusy(false);}}
  return <section className={`content-card ${styles.panel}`}><h2>Предметы школы «Атлас»</h2>{snapshot.subjects.length?<p>{snapshot.subjects.map(s=>s.name).join(" · ")}</p>:<p>Добавьте предметы перед назначением учителей и составлением расписания.</p>}<form className={styles.fields} onSubmit={save}><label>Название предмета<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} required/></label><button className="primary-btn" disabled={busy}>{busy?"Сохраняем…":"Добавить предмет"}</button></form>{error?<p role="alert" className={styles.error}>{error}</p>:null}</section>;
}

function AttendanceRow({name,record,onSave}: {name:string;record?:AttendanceRecord;onSave:(status:string,note:string)=>Promise<void>}){
  const [status,setStatus]=useState(record?.status??"");const [note,setNote]=useState(record?.note??"");const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");try{await onSave(status,note);}catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить");}finally{setBusy(false);}}
  return <form onSubmit={save} className={styles.attendanceRow}><strong>{name}</strong><label><span className={styles.srOnly}>Отметка: {name}</span><select value={status} onChange={e=>setStatus(e.target.value)} required><option value="">Не отмечено</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label><span className={styles.srOnly}>Примечание: {name}</span><input placeholder="Примечание" value={note} maxLength={300} onChange={e=>setNote(e.target.value)}/></label><button className="ghost-btn" disabled={busy || !status}>{busy?"Сохраняем…":"Сохранить"}</button>{error?<p role="alert" className={styles.error}>{error}</p>:null}</form>;
}
export function AttendancePanel({snapshot,submit}:Props){
  const[date,setDate]=useState(today);const[lessonId,setLesson]=useState("");
  const canMark=leaders.has(snapshot.viewer.role)||snapshot.viewer.role==="teacher";
  const weekday = date ? new Date(date+"T00:00:00Z").getUTCDay() : -1;
  const lessons=snapshot.lessons.filter(l=>l.weekday===weekday&&!['archived','cancelled'].includes(l.status));
  const lesson=lessons.find(l=>l.id===lessonId)??lessons[0];
  const records=snapshot.attendance.filter(a=>a.lessonDate===date);
  const students=lesson?snapshot.students.filter(s=>s.className===lesson.className):[];
  return <section className={`content-card ${styles.panel}`}><h2>Посещаемость</h2><p>Отметки сохраняются отдельно для каждого урока и даты.</p><div className={styles.fields}><label>Дата занятия<input type="date" value={date} min={snapshot.school.startsOn} max={today()} onChange={e=>setDate(e.target.value)}/></label>{canMark?<label>Урок<select value={lesson?.id??""} onChange={e=>setLesson(e.target.value)}><option value="" disabled>Выберите урок</option>{lessons.map(l=><option key={l.id} value={l.id}>{l.className} · {l.startsAt} · {l.subjectName}{l.groupName?` · ${l.groupName}`:""}</option>)}</select></label>:null}</div>
    {!snapshot.school.academicYear?<p>Завучу нужно настроить учебный год в календаре.</p>:canMark?students.length?students.map(s=>{const record=records.find(a=>a.studentId===s.id&&a.lessonId===lesson!.id);return <AttendanceRow key={`${date}:${lesson!.id}:${s.id}:${record?.version??0}`} name={s.fullName} record={record} onSave={(status,note)=>submit("attendance.mark",{studentId:s.id,lessonId:lesson!.id,lessonDate:date,status,note,version:record?.version??0})}/>;}):<p>На эту дату нет доступного урока с учениками.</p>:records.length?<ul className={styles.steps}>{records.filter(a=>a.studentId===snapshot.selectedStudent?.id).map(a=><li key={a.id}>{snapshot.lessons.find(l=>l.id===a.lessonId)?.subjectName??"Урок"} — {labels[a.status]??a.status}{a.note?` · ${a.note}`:""}</li>)}</ul>:<p>На эту дату отметок пока нет.</p>}
  </section>;
}
