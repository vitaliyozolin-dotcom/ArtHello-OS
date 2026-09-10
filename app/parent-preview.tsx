"use client";

import { useEffect, useState } from "react";
import type { SchoolSnapshot, StudentRecord } from "./level-zero-types";

type Preview = {
  mode: "parent-academic-preview"; readOnly: true;
  student: Pick<StudentRecord, "id" | "firstName" | "fullName" | "className">;
  lessons: Array<Pick<SchoolSnapshot["lessons"][number], "id" | "weekday" | "startsAt" | "endsAt" | "subjectName" | "teacherName" | "room">>;
  homework: Array<Pick<SchoolSnapshot["homework"][number], "id" | "subjectName" | "title" | "description" | "dueAt">>;
  grades: Array<Pick<SchoolSnapshot["grades"][number], "id" | "subjectName" | "value" | "weight" | "title" | "gradeDate" | "comment">>;
  comments: Array<Pick<SchoolSnapshot["comments"][number], "id" | "teacherName" | "subjectName" | "body" | "commentDate">>;
  achievements: Array<Pick<SchoolSnapshot["achievements"][number], "id" | "title" | "description" | "achievementDate">>;
};
const days = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function ParentPreview({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/school?preview=parent&student=${encodeURIComponent(studentId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Не удалось открыть предпросмотр. Проверьте доступ к ребёнку.");
        const result = await response.json();
        if (result.mode !== "parent-academic-preview" || result.readOnly !== true) throw new Error("Некорректный ответ предпросмотра");
        if (!controller.signal.aborted) setData(result);
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось открыть предпросмотр"); });
    return () => controller.abort();
  }, [studentId, attempt]);
  return <div className="page-shell">
    <section className="content-card" aria-label="Предпросмотр кабинета родителя">
      <div className="section-title"><div><h1>Предпросмотр кабинета родителя</h1><p>Только учебные сведения. Переписка, платежи и личные уведомления не открываются.</p></div><button className="ghost-btn" onClick={onClose}>Вернуться в свой кабинет</button></div>
      <p>Вы остаётесь под своей учётной записью. Действия от имени родителя недоступны.</p>
    </section>
    {error ? <section className="content-card" role="alert"><p>{error}</p><button className="ghost-btn" onClick={() => { setData(null); setError(""); setAttempt(value => value + 1); }}>Повторить</button></section> : !data ? <p role="status">Загружаем учебные сведения…</p> : <>
      <div className="page-heading"><div><h2>{data.student.fullName}</h2><p>{data.student.className} класс · Учебная часть кабинета родителя</p></div></div>
      <section className="content-card"><h2>Расписание</h2>{data.lessons.length ? data.lessons.map(row => <p key={row.id}>{days[Number(row.weekday)]} · {row.startsAt}–{row.endsAt} · {row.subjectName} · {row.teacherName}</p>) : <p>Расписание пока не опубликовано.</p>}</section>
      <section className="content-card"><h2>Домашние задания</h2>{data.homework.length ? data.homework.map(row => <article key={row.id}><h3>{row.subjectName}: {row.title}</h3><p>{row.description}</p><p>Срок: {row.dueAt}</p></article>) : <p>Домашних заданий пока нет.</p>}</section>
      <section className="content-card"><h2>Оценки</h2>{data.grades.length ? data.grades.map(row => <p key={row.id}>{row.gradeDate} · {row.subjectName} · {row.value} · {row.title}{row.comment ? ` — ${row.comment}` : ""}</p>) : <p>Оценок пока нет.</p>}</section>
      <section className="content-card"><h2>Обратная связь педагогов</h2>{data.comments.length ? data.comments.map(row => <article key={row.id}><h3>{row.teacherName}</h3><p>{row.body}</p><small>{row.commentDate}</small></article>) : <p>Опубликованных комментариев пока нет.</p>}</section>
      <section className="content-card"><h2>Достижения</h2>{data.achievements.length ? data.achievements.map(row => <article key={row.id}><h3>{row.title}</h3><p>{row.description}</p></article>) : <p>Достижения пока не добавлены.</p>}</section>
    </>}
  </div>;
}
