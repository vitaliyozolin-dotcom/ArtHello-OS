"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./icons";
import {
  roleLabels,
  type ActionKind,
  type Role,
  type SchoolSnapshot,
} from "./level-zero-types";

type View =
  | "home"
  | "calendar"
  | "schedule"
  | "programs"
  | "journal"
  | "homework"
  | "people"
  | "school"
  | "messages"
  | "management"
  | "profile";
type ModalState = { kind: ActionKind; preset?: Record<string, string> } | null;
type AccessState = {
  code: string;
  message: string;
  email?: string;
  displayName?: string;
  invitation?: {
    targetRole: "parent" | "student";
    studentName: string | null;
    className: string | null;
    expiresAt: string;
  } | null;
};
type InviteResult = { inviteLink: string; expiresAt: string };

const cn = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");
const weekdays = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];
const weekdayShort = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const bellSlots = [
  ["08:30", "09:15"],
  ["09:25", "10:10"],
  ["10:30", "11:15"],
  ["11:35", "12:20"],
  ["12:30", "13:15"],
  ["13:25", "14:10"],
  ["14:20", "15:05"],
  ["15:15", "16:00"],
] as const;

const formatDate = (value: string, options?: Intl.DateTimeFormatOptions) => {
  const date = new Date(
    value.length === 10 ? `${value}T12:00:00+03:00` : value,
  );
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    ...(options ?? { day: "numeric", month: "long" }),
  }).format(date);
};

const formatDateTime = (value: string) =>
  formatDate(value, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const formatMoney = (value: number) =>
  new Intl.NumberFormat("ru-RU").format(value) + " ₽";
const todayWeekday = () => {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    weekday: "short",
  }).format(new Date());
  return (
    (
      { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<
        string,
        number
      >
    )[short] ?? 1
  );
};

function weightedAverage(grades: SchoolSnapshot["grades"]) {
  const weight = grades.reduce((sum, grade) => sum + grade.weight, 0);
  if (!weight) return "—";
  return (
    grades.reduce((sum, grade) => sum + grade.value * grade.weight, 0) / weight
  )
    .toFixed(1)
    .replace(".", ",");
}

function Avatar({
  name,
  color = "#e84412",
  size = "md",
}: {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
}) {
  const label = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("ru-RU");
  return (
    <span
      className={cn("l0-avatar", `l0-avatar-${size}`)}
      style={{ background: color }}
    >
      {label || "11"}
    </span>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger" | "blue";
}) {
  return (
    <span className={cn("status-pill", `status-${tone}`)}>{children}</span>
  );
}

function SectionTitle({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action && onAction ? (
        <button className="text-action" onClick={onAction}>
          {action}
          <Icon name="chevron" size={17} />
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({
  title,
  text,
  icon = "info",
}: {
  title: string;
  text: string;
  icon?: IconName;
}) {
  return (
    <div className="l0-empty">
      <span>
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function NavIcon({ view }: { view: View }) {
  const icons: Record<View, IconName> = {
    home: "home",
    calendar: "calendar",
    schedule: "clock",
    programs: "book",
    journal: "chart",
    homework: "clipboard",
    people: "users",
    school: "school",
    messages: "chat",
    management: "settings",
    profile: "user",
  };
  return <Icon name={icons[view]} size={21} />;
}

const navigationByRole: Record<Role, Array<{ id: View; label: string }>> = {
  director: [
    { id: "home", label: "Главная" },
    { id: "calendar", label: "Календарь" },
    { id: "programs", label: "Учебный процесс" },
    { id: "schedule", label: "Расписание" },
    { id: "people", label: "Люди" },
    { id: "journal", label: "Журнал" },
    { id: "homework", label: "Домашние задания" },
    { id: "school", label: "Школьная жизнь" },
    { id: "messages", label: "Сообщения" },
    { id: "management", label: "Управление" },
  ],
  deputy: [
    { id: "home", label: "Главная" },
    { id: "calendar", label: "Календарь" },
    { id: "programs", label: "Программы" },
    { id: "schedule", label: "Расписание" },
    { id: "people", label: "Классы и учителя" },
    { id: "journal", label: "Журнал" },
    { id: "homework", label: "Задания" },
    { id: "messages", label: "Сообщения" },
    { id: "management", label: "Управление" },
  ],
  admin: [
    { id: "home", label: "Главная" },
    { id: "calendar", label: "Календарь" },
    { id: "schedule", label: "Расписание" },
    { id: "people", label: "Ученики и семьи" },
    { id: "school", label: "Меню и события" },
    { id: "messages", label: "Сообщения" },
    { id: "management", label: "Управление" },
  ],
  teacher: [
    { id: "home", label: "Главная" },
    { id: "schedule", label: "Мои уроки" },
    { id: "programs", label: "Моя программа" },
    { id: "journal", label: "Журнал" },
    { id: "homework", label: "Домашние задания" },
    { id: "calendar", label: "Календарь" },
    { id: "people", label: "Мои классы" },
    { id: "messages", label: "Сообщения" },
    { id: "profile", label: "Профиль" },
  ],
  parent: [
    { id: "home", label: "Главная" },
    { id: "people", label: "Мои дети" },
    { id: "schedule", label: "Расписание" },
    { id: "journal", label: "Дневник" },
    { id: "homework", label: "Домашние задания" },
    { id: "calendar", label: "Календарь" },
    { id: "school", label: "Школа" },
    { id: "messages", label: "Сообщения" },
    { id: "profile", label: "Профиль" },
  ],
  student: [
    { id: "home", label: "Главная" },
    { id: "schedule", label: "Расписание" },
    { id: "journal", label: "Дневник" },
    { id: "homework", label: "Домашние задания" },
    { id: "calendar", label: "Календарь" },
    { id: "school", label: "Школа" },
    { id: "profile", label: "Профиль" },
  ],
  tech_admin: [
    { id: "home", label: "Состояние системы" },
    { id: "management", label: "Технический доступ" },
    { id: "profile", label: "Профиль" },
  ],
};

const viewPaths: Record<View, string> = {
  home: "/",
  calendar: "/calendar",
  schedule: "/schedule",
  programs: "/programs",
  journal: "/journal",
  homework: "/homework",
  people: "/people",
  school: "/school",
  messages: "/messages",
  management: "/management",
  profile: "/profile",
};

function viewFromPath(pathname: string): View {
  const entry = (Object.entries(viewPaths) as Array<[View, string]>).find(
    ([, path]) => path !== "/" && pathname.startsWith(path),
  );
  return entry?.[0] ?? "home";
}

function AppShell({
  snapshot,
  activeView,
  onView,
  onStudent,
  children,
}: {
  snapshot: SchoolSnapshot;
  activeView: View;
  onView: (view: View) => void;
  onStudent: (studentId: string) => void;
  children: ReactNode;
}) {
  const nav = navigationByRole[snapshot.viewer.role];
  const mobileNav = nav.length > 5 ? [...nav.slice(0, 4), nav.at(-1)!] : nav;
  const familyContext =
    snapshot.viewer.role === "parent" || snapshot.viewer.role === "student";

  return (
    <div className="l0-stage">
      <div className="l0-app">
        <aside className="l0-rail">
          <button
            className="l0-brand"
            onClick={() => onView("home")}
            aria-label="На главную"
          >
            <Image src="/school-logo.svg" alt="" width={44} height={44} />
            <span>
              <strong>Школа 1–11</strong>
              <small>электронный дневник</small>
            </span>
          </button>
          <nav className="l0-nav" aria-label="Основная навигация">
            {nav.map((item) => (
              <button
                key={item.id}
                className={cn(activeView === item.id && "active")}
                onClick={() => onView(item.id)}
              >
                <NavIcon view={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="rail-context">
            {familyContext && snapshot.selectedStudent ? (
              <>
                <Avatar
                  name={snapshot.selectedStudent.fullName}
                  color={snapshot.selectedStudent.avatarColor}
                  size="sm"
                />
                <span>
                  <strong>{snapshot.selectedStudent.firstName}</strong>
                  <small>{snapshot.selectedStudent.className} класс</small>
                </span>
              </>
            ) : (
              <>
                <Avatar name={snapshot.viewer.displayName} size="sm" />
                <span>
                  <strong>{snapshot.viewer.displayName}</strong>
                  <small>{roleLabels[snapshot.viewer.role]}</small>
                </span>
              </>
            )}
          </div>
        </aside>

        <section className="l0-workspace">
          <header className="l0-topbar">
            <div className="mobile-brand">
              <Image src="/school-logo.svg" alt="" width={36} height={36} />
              <strong>1–11</strong>
            </div>
            <div className="topbar-spacer" />
            {snapshot.students.length > 1 &&
            snapshot.viewer.role === "parent" ? (
              <label className="compact-select">
                <span>Ребёнок</span>
                <select
                  value={snapshot.selectedStudent?.id ?? ""}
                  onChange={(event) => onStudent(event.target.value)}
                >
                  {snapshot.students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} · {student.className}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              className="notification-button"
              onClick={() => onView("calendar")}
              aria-label="Открыть уведомления"
            >
              <Icon name="bell" size={19} />
              {snapshot.notifications.some((item) => !item.readAt) ? (
                <span />
              ) : null}
            </button>
            <StatusPill tone="blue">
              {roleLabels[snapshot.viewer.role]}
            </StatusPill>
            <button
              className="top-avatar"
              onClick={() => onView("profile")}
              aria-label="Открыть профиль"
            >
              <Avatar name={snapshot.viewer.displayName} size="sm" />
            </button>
          </header>
          <main className="l0-main">{children}</main>
        </section>

        <nav className="l0-bottom-nav" aria-label="Основная навигация">
          {mobileNav.map((item) => (
            <button
              key={item.id}
              className={cn(activeView === item.id && "active")}
              onClick={() => onView(item.id)}
            >
              <NavIcon view={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  caption,
  tone = "orange",
  icon,
  onClick,
}: {
  label: string;
  value: string;
  caption: string;
  tone?: string;
  icon: IconName;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={cn("metric-icon", `metric-${tone}`)}>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{caption}</p>
      </div>
    </>
  );
  return onClick ? (
    <button className="metric-card metric-button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <article className="metric-card">{content}</article>
  );
}

const staffStatusMeta: Record<
  string,
  { label: string; tone: "good" | "warn" | "danger" | "blue" | "neutral" }
> = {
  confirmed: { label: "Подтверждён", tone: "good" },
  unconfirmed: { label: "Не утверждён", tone: "warn" },
  vacant: { label: "Вакансия", tone: "danger" },
  needs_confirmation: { label: "Уточнить ФИО", tone: "warn" },
  demo: { label: "Служебный", tone: "neutral" },
};

function StaffDirectory({ snapshot }: { snapshot: SchoolSnapshot }) {
  const teachers = snapshot.users.filter(
    (user) => user.role === "teacher" && user.profileStatus !== "demo",
  );
  return (
    <div className="staff-directory">
      {teachers.map((teacher) => {
        const assignments = snapshot.teacherAssignments.filter(
          (item) => item.teacherUserId === teacher.id,
        );
        const classes = [
          ...new Set(assignments.map((item) => item.className)),
        ].sort((a, b) => Number(a) - Number(b));
        const subjects = [
          ...new Set(assignments.map((item) => item.subjectName)),
        ];
        const meta =
          staffStatusMeta[teacher.profileStatus] ?? staffStatusMeta.confirmed;
        return (
          <article key={teacher.id} className="staff-card">
            <div className="staff-card-head">
              <Avatar name={teacher.displayName} size="sm" />
              <div>
                <strong>{teacher.displayName}</strong>
                <small>{teacher.notes}</small>
              </div>
              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            </div>
            <div className="staff-tags">
              <span>
                {classes.length === 6
                  ? "1–6 классы"
                  : `${classes.join(", ")} классы`}
              </span>
              {subjects.map((subject) => (
                <span key={subject}>{subject}</span>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function LessonList({
  snapshot,
  day = todayWeekday(),
  compact = false,
  className,
  onEdit,
}: {
  snapshot: SchoolSnapshot;
  day?: number;
  compact?: boolean;
  className?: string;
  onEdit?: (lesson: SchoolSnapshot["lessons"][number]) => void;
}) {
  const lessons = snapshot.lessons.filter(
    (lesson) =>
      lesson.weekday === day && (!className || lesson.className === className),
  );
  if (!lessons.length)
    return (
      <EmptyState
        title="На этот день уроков нет"
        text="Изменения появятся здесь после публикации администратором."
        icon="calendar"
      />
    );
  return (
    <div className={cn("lesson-list", compact && "lesson-list-compact")}>
      {lessons.map((lesson, index) => (
        <article className="lesson-line" key={lesson.id}>
          <span className="lesson-order">{index + 1}</span>
          <span className="lesson-time">
            <strong>{lesson.startsAt}</strong>
            <small>{lesson.endsAt}</small>
          </span>
          <span
            className="subject-bar"
            style={{ background: lesson.subjectColor }}
          />
          <span className="lesson-copy">
            <strong>{lesson.subjectName}</strong>
            <small>
              {lesson.room} · {lesson.teacherName ?? "Учитель не назначен"}
            </small>
            {lesson.note ? <em>{lesson.note}</em> : null}
          </span>
          {lesson.status === "moved" ? (
            <StatusPill tone="warn">Изменение</StatusPill>
          ) : lesson.status === "completed" ? (
            <StatusPill tone="good">Проведён</StatusPill>
          ) : null}
          {onEdit ? (
            <button
              className="lesson-edit"
              onClick={() => onEdit(lesson)}
              aria-label={`Изменить урок ${lesson.subjectName}`}
            >
              <Icon name="settings" size={16} />
              Изменить
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function HomeworkList({
  snapshot,
  limit,
  onAdd,
}: {
  snapshot: SchoolSnapshot;
  limit?: number;
  onAdd?: () => void;
}) {
  const items =
    typeof limit === "number"
      ? snapshot.homework.slice(0, limit)
      : snapshot.homework;
  if (!items.length)
    return (
      <EmptyState
        title="Заданий пока нет"
        text="Учитель опубликует их после урока."
        icon="clipboard"
      />
    );
  return (
    <div className="card-list">
      {items.map((item) => (
        <article className="homework-item" key={item.id}>
          <span
            className="subject-badge"
            style={{
              background: `${item.subjectColor}1c`,
              color: item.subjectColor,
            }}
          >
            {item.subjectName.slice(0, 2).toLocaleUpperCase("ru-RU")}
          </span>
          <div>
            <span className="item-overline">
              {item.subjectName} · до {formatDateTime(item.dueAt)}
            </span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <small>{item.teacherName}</small>
          </div>
        </article>
      ))}
      {onAdd ? (
        <button className="inline-add" onClick={onAdd}>
          <Icon name="clipboard" size={18} />
          Опубликовать задание
        </button>
      ) : null}
    </div>
  );
}

function GradeList({
  snapshot,
  studentId,
  onGrade,
}: {
  snapshot: SchoolSnapshot;
  studentId?: string | null;
  onGrade?: (studentId: string) => void;
}) {
  const grades = studentId
    ? snapshot.grades.filter((grade) => grade.studentId === studentId)
    : snapshot.grades;
  if (!grades.length)
    return (
      <EmptyState
        title="Оценок пока нет"
        text="Первая сохранённая оценка появится здесь сразу."
        icon="chart"
      />
    );
  return (
    <div className="grade-list">
      {grades.map((grade) => (
        <article className="grade-item" key={grade.id}>
          <span className={cn("grade-value", `grade-${grade.value}`)}>
            {grade.value}
          </span>
          <div>
            <span className="item-overline">
              {grade.subjectName} · {formatDate(grade.gradeDate)}
            </span>
            <h3>{grade.title}</h3>
            <p>
              {grade.studentName}
              {grade.comment ? ` · ${grade.comment}` : ""}
            </p>
          </div>
          {grade.weight > 1 ? (
            <StatusPill tone="blue">вес {grade.weight}</StatusPill>
          ) : null}
        </article>
      ))}
      {onGrade && studentId ? (
        <button className="inline-add" onClick={() => onGrade(studentId)}>
          <Icon name="chart" size={18} />
          Поставить оценку
        </button>
      ) : null}
    </div>
  );
}

function ParentDashboard({
  snapshot,
  onView,
}: {
  snapshot: SchoolSnapshot;
  onView: (view: View) => void;
}) {
  const student = snapshot.selectedStudent;
  const ownGrades = snapshot.grades.filter(
    (grade) => grade.studentId === student?.id,
  );
  const latestAchievement = snapshot.achievements.find(
    (item) => item.studentId === student?.id,
  );
  const dayLessons = snapshot.lessons.filter(
    (lesson) => lesson.weekday === todayWeekday(),
  );
  return (
    <div className="page-shell">
      <section className="parent-hero">
        <div className="hero-copy">
          <span className="eyebrow">Сегодня в школе</span>
          <h1>
            {student
              ? `${student.firstName}, ${student.className} класс`
              : "Ваш ребёнок"}
          </h1>
          <p>
            {dayLessons.length} уроков · {snapshot.homework.length} активных
            заданий · всё важное в одном месте
          </p>
          <div className="hero-actions">
            <button className="primary-btn" onClick={() => onView("schedule")}>
              Открыть учебный день
            </button>
            <button className="ghost-btn" onClick={() => onView("messages")}>
              <Icon name="chat" size={18} />
              Написать учителю
            </button>
          </div>
        </div>
        <div className="hero-signal">
          <span>Последний успех</span>
          <strong>
            {latestAchievement?.title ?? "Спокойная учебная неделя"}
          </strong>
          <p>{latestAchievement?.description ?? "Новых замечаний нет"}</p>
        </div>
      </section>
      <section className="metric-grid">
        <MetricCard
          label="Средний балл"
          value={weightedAverage(ownGrades)}
          caption="по всем предметам"
          icon="chart"
          onClick={() => onView("journal")}
        />
        <MetricCard
          label="Домашние задания"
          value={String(snapshot.homework.length)}
          caption="ближайшие сроки"
          icon="clipboard"
          tone="amber"
          onClick={() => onView("homework")}
        />
        <MetricCard
          label="Успехи"
          value={String(
            snapshot.achievements.filter(
              (item) => item.studentId === student?.id,
            ).length,
          )}
          caption="зафиксировано учителями"
          icon="star"
          tone="green"
          onClick={() => onView("journal")}
        />
        <MetricCard
          label="Сообщения"
          value={String(
            snapshot.messages.filter(
              (message) =>
                !message.readAt && message.authorUserId !== snapshot.viewer.id,
            ).length,
          )}
          caption="в диалоге с учителем"
          icon="chat"
          tone="blue"
          onClick={() => onView("messages")}
        />
      </section>
      <section className="two-column-grid">
        <div className="content-card">
          <SectionTitle
            title="Расписание сегодня"
            subtitle={weekdays[todayWeekday()]}
            action="Вся неделя"
            onAction={() => onView("schedule")}
          />
          <LessonList snapshot={snapshot} compact />
        </div>
        <div className="content-card">
          <SectionTitle
            title="Ближайшие задания"
            subtitle="Сроки и комментарии учителей"
            action="Все задания"
            onAction={() => onView("homework")}
          />
          <HomeworkList snapshot={snapshot} limit={3} />
        </div>
      </section>
      <section className="three-column-grid">
        <button
          className="feature-card feature-menu"
          onClick={() => onView("school")}
        >
          <span>
            <Icon name="clipboard" />
          </span>
          <small>Меню сегодня</small>
          <strong>
            {snapshot.menu[0]?.lunch ?? "Меню ещё не опубликовано"}
          </strong>
          <em>
            Открыть питание <Icon name="chevron" size={15} />
          </em>
        </button>
        <button className="feature-card" onClick={() => onView("school")}>
          <span>
            <Icon name="calendar" />
          </span>
          <small>Ближайшее событие</small>
          <strong>{snapshot.events[0]?.title ?? "Событий пока нет"}</strong>
          <em>
            {snapshot.events[0]
              ? formatDateTime(snapshot.events[0].startsAt)
              : ""}
          </em>
        </button>
        <button className="feature-card" onClick={() => onView("profile")}>
          <span>
            <Icon name="qr" />
          </span>
          <small>Абонементы</small>
          <strong>
            {
              snapshot.subscriptions.filter((item) => item.status === "active")
                .length
            }{" "}
            активных
          </strong>
          <em>
            Баланс и занятия <Icon name="chevron" size={15} />
          </em>
        </button>
      </section>
    </div>
  );
}

function TeacherDashboard({
  snapshot,
  openAction,
  onView,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
  onView: (view: View) => void;
}) {
  const classStudents = snapshot.students;
  const todayLessons = snapshot.lessons.filter(
    (lesson) => lesson.weekday === todayWeekday(),
  );
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Кабинет учителя</span>
          <h1>Добрый день, {snapshot.viewer.displayName.split(" ")[0]}</h1>
          <p>
            {todayLessons.length} уроков сегодня · {snapshot.programs.length}{" "}
            учебных программ
          </p>
        </div>
        <button
          className="primary-btn"
          onClick={() => openAction("grade.create")}
        >
          <Icon name="chart" size={18} />
          Поставить оценку
        </button>
      </div>
      <section className="teacher-action-grid">
        <button onClick={() => openAction("grade.create")}>
          <span className="action-icon action-orange">
            <Icon name="chart" />
          </span>
          <strong>Оценка</strong>
          <small>С результатом и комментарием</small>
        </button>
        <button onClick={() => openAction("homework.create")}>
          <span className="action-icon action-violet">
            <Icon name="clipboard" />
          </span>
          <strong>Домашнее задание</strong>
          <small>Для класса и предмета</small>
        </button>
        <button onClick={() => openAction("achievement.create")}>
          <span className="action-icon action-green">
            <Icon name="star" />
          </span>
          <strong>Отметить успех</strong>
          <small>Сильное действие ученика</small>
        </button>
        <button onClick={() => openAction("comment.create")}>
          <span className="action-icon action-blue">
            <Icon name="message" />
          </span>
          <strong>Комментарий</strong>
          <small>Лично для родителя</small>
        </button>
      </section>
      <section className="two-column-grid teacher-grid">
        <div className="content-card">
          <SectionTitle
            title="Мои уроки сегодня"
            subtitle={`${todayLessons.length} занятий`}
            action="Расписание"
            onAction={() => onView("schedule")}
          />
          <LessonList snapshot={snapshot} compact />
        </div>
        <div className="content-card">
          <SectionTitle
            title="Мои ученики"
            subtitle={`${classStudents.length} учеников в назначенных классах`}
            action="Открыть журнал"
            onAction={() => onView("journal")}
          />
          <div className="student-mini-list">
            {classStudents.map((student) => {
              const studentGrades = snapshot.grades.filter(
                (grade) => grade.studentId === student.id,
              );
              return (
                <button
                  key={student.id}
                  onClick={() =>
                    openAction("grade.create", { studentId: student.id })
                  }
                >
                  <Avatar
                    name={student.fullName}
                    color={student.avatarColor}
                    size="sm"
                  />
                  <span>
                    <strong>{student.fullName}</strong>
                    <small>Средний балл {weightedAverage(studentGrades)}</small>
                  </span>
                  <Icon name="chevron" size={17} />
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <section className="content-card">
        <SectionTitle
          title="Опубликованные задания"
          subtitle="Что сейчас видят семьи"
          action="Добавить"
          onAction={() => openAction("homework.create")}
        />
        <HomeworkList snapshot={snapshot} limit={4} />
      </section>
    </div>
  );
}

function LeadershipDashboard({
  snapshot,
  onView,
}: {
  snapshot: SchoolSnapshot;
  onView: (view: View) => void;
}) {
  const staff = snapshot.users.filter(
    (user) => user.role === "teacher" && user.profileStatus !== "demo",
  );
  const unresolvedStaff = staff.filter(
    (user) => user.profileStatus !== "confirmed",
  );
  const todayLessons = snapshot.lessons.filter(
    (lesson) => lesson.weekday === todayWeekday(),
  );
  const unread = snapshot.messages.filter(
    (message) => !message.readAt && message.authorUserId !== snapshot.viewer.id,
  ).length;
  const unapprovedPrograms = snapshot.programs.filter(
    (program) => !["approved", "active"].includes(program.status),
  ).length;
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ArtHello OS · Обучение</span>
          <h1>Школа 1–11</h1>
          <p>Достоверная картина учебного дня и конкретные точки внимания</p>
        </div>
        <button className="primary-btn" onClick={() => onView("calendar")}>
          <Icon name="calendar" size={18} />
          Открыть календарь
        </button>
      </div>
      <section className="metric-grid">
        <MetricCard
          label="Ученики"
          value={String(snapshot.students.length)}
          caption="активные карточки"
          icon="users"
          onClick={() => onView("people")}
        />
        <MetricCard
          label="Средний балл"
          value={weightedAverage(snapshot.grades)}
          caption="по опубликованным оценкам"
          icon="chart"
          tone="blue"
          onClick={() => onView("journal")}
        />
        <MetricCard
          label="Уроки сегодня"
          value={String(todayLessons.length)}
          caption="по опубликованному расписанию"
          icon="clock"
          tone="violet"
          onClick={() => onView("schedule")}
        />
        <MetricCard
          label="Требуют решения"
          value={String(unresolvedStaff.length + unapprovedPrograms)}
          caption="кадры и программы"
          icon="info"
          tone="amber"
          onClick={() => onView(unapprovedPrograms ? "programs" : "people")}
        />
      </section>
      <section className="two-column-grid leadership-grid">
        <div className="content-card">
          <SectionTitle
            title="Ближайшие работы"
            subtitle="Задания и значимые учебные события"
            action="Все задания"
            onAction={() => onView("homework")}
          />
          <HomeworkList snapshot={snapshot} limit={4} />
        </div>
        <div className="content-card">
          <SectionTitle
            title="Работа школы"
            subtitle="Сигналы, которые требуют конкретного действия"
          />
          <div className="signal-list">
            <button onClick={() => onView("programs")}>
              <span className="signal-mark warn">
                <Icon name="book" size={17} />
              </span>
              <span>
                <strong>{unapprovedPrograms} программ не утверждены</strong>
                <small>Открыть конкретные программы и статусы</small>
              </span>
              <Icon name="chevron" size={17} />
            </button>
            <button onClick={() => onView("people")}>
              <span className="signal-mark danger">
                <Icon name="users" size={17} />
              </span>
              <span>
                <strong>{unresolvedStaff.length} кадровых вопросов</strong>
                <small>Вакансии, кандидаты и ФИО для уточнения</small>
              </span>
              <Icon name="chevron" size={17} />
            </button>
            <button onClick={() => onView("messages")}>
              <span className="signal-mark blue">
                <Icon name="chat" size={17} />
              </span>
              <span>
                <strong>{unread} непрочитанных сообщений</strong>
                <small>Официальная переписка с фиксацией просмотра</small>
              </span>
              <Icon name="chevron" size={17} />
            </button>
          </div>
        </div>
      </section>
      <section className="two-column-grid">
        <div className="content-card">
          <SectionTitle
            title="Расписание сегодня"
            subtitle={weekdays[todayWeekday()]}
            action="Редактор"
            onAction={() => onView("schedule")}
          />
          <LessonList snapshot={snapshot} compact />
        </div>
        <div className="content-card">
          <SectionTitle
            title="Последние изменения"
            subtitle="Автор и время сохранены"
            action="Полный журнал"
            onAction={() => onView("management")}
          />
          {snapshot.audit.length ? (
            <div className="audit-list">
              {snapshot.audit.slice(0, 7).map((item) => (
                <div key={item.id}>
                  <span>
                    <Icon name="check" size={15} />
                  </span>
                  <p>
                    <strong>{item.actorName}</strong>
                    <small>
                      {item.action} · {formatDateTime(item.createdAt)}
                    </small>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Изменений пока нет"
              text="Журнал начнёт заполняться после первого рабочего действия."
              icon="clipboard"
            />
          )}
        </div>
      </section>
    </div>
  );
}

function AdminDashboard({
  snapshot,
  openAction,
  onView,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
  onView: (view: View) => void;
}) {
  const todayLessons = snapshot.lessons.filter(
    (lesson) => lesson.weekday === todayWeekday(),
  );
  const missingTeacher = todayLessons.filter(
    (lesson) => !lesson.teacherUserId,
  ).length;
  const missingRoom = todayLessons.filter(
    (lesson) => !lesson.room || lesson.room === "Уточняется",
  ).length;
  const pendingReports = snapshot.events.filter(
    (event) => event.status === "awaiting_report",
  ).length;
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Ежедневная организация</span>
          <h1>Рабочий стол администратора</h1>
          <p>{weekdays[todayWeekday()]} · расписание, семьи, меню и события</p>
        </div>
        <button className="primary-btn" onClick={() => onView("schedule")}>
          <Icon name="calendar" size={18} />
          Расписание
        </button>
      </div>
      <section className="metric-grid">
        <MetricCard
          label="Уроки сегодня"
          value={String(todayLessons.length)}
          caption="опубликовано"
          icon="clock"
          onClick={() => onView("schedule")}
        />
        <MetricCard
          label="Проекции учеников"
          value={String(snapshot.students.length)}
          caption="из ArtHello OS"
          icon="users"
          tone="blue"
          onClick={() => onView("management")}
        />
        <MetricCard
          label="Без назначения"
          value={String(missingTeacher + missingRoom)}
          caption="учитель или кабинет"
          icon="info"
          tone="amber"
          onClick={() => onView("schedule")}
        />
        <MetricCard
          label="Отчёты событий"
          value={String(pendingReports)}
          caption="нужно опубликовать"
          icon="camera"
          tone="violet"
          onClick={() => onView("school")}
        />
      </section>
      <section className="admin-actions daily-actions">
        <button onClick={() => onView("people")}>
          <Icon name="user" />
          <span>
            <strong>Ученики и семьи</strong>
            <small>Карточки, связи и заявки</small>
          </span>
        </button>
        <button onClick={() => onView("schedule")}>
          <Icon name="calendar" />
          <span>
            <strong>Расписание и замены</strong>
            <small>Урок, время, кабинет, учитель</small>
          </span>
        </button>
        <button onClick={() => openAction("menu.update")}>
          <Icon name="clipboard" />
          <span>
            <strong>Опубликовать меню</strong>
            <small>Питание и аллергены</small>
          </span>
        </button>
        <button onClick={() => openAction("event.create")}>
          <Icon name="calendar" />
          <span>
            <strong>Создать событие</strong>
            <small>Автоматически попадёт в календарь</small>
          </span>
        </button>
        <button onClick={() => onView("school")}>
          <Icon name="camera" />
          <span>
            <strong>Фото и отчёты</strong>
            <small>Материалы прошедших событий</small>
          </span>
        </button>
        <button onClick={() => onView("management")}>
          <Icon name="settings" />
          <span>
            <strong>Пользователи и доступы</strong>
            <small>Только просмотр центральной проекции</small>
          </span>
        </button>
      </section>
      <section className="two-column-grid">
        <div className="content-card">
          <SectionTitle
            title="Расписание сегодня"
            action="Открыть редактор"
            onAction={() => onView("schedule")}
          />
          <LessonList snapshot={snapshot} compact />
        </div>
        <div className="content-card">
          <SectionTitle
            title="Ближайшие события"
            action="Все события"
            onAction={() => onView("school")}
          />
          {snapshot.events.length ? (
            <div className="event-compact-list">
              {snapshot.events.slice(0, 5).map((event) => (
                <button key={event.id} onClick={() => onView("calendar")}>
                  <span>
                    <strong>
                      {formatDate(event.startsAt, { day: "2-digit" })}
                    </strong>
                    <small>
                      {formatDate(event.startsAt, { month: "short" })}
                    </small>
                  </span>
                  <span>
                    <strong>{event.title}</strong>
                    <small>{event.location}</small>
                  </span>
                  <Icon name="chevron" size={17} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Событий пока нет"
              text="Созданное событие появится здесь и в общем календаре."
              icon="calendar"
            />
          )}
        </div>
      </section>
    </div>
  );
}

function StudentDashboard({
  snapshot,
  onView,
}: {
  snapshot: SchoolSnapshot;
  onView: (view: View) => void;
}) {
  const student = snapshot.selectedStudent;
  const ownGrades = snapshot.grades.filter(
    (grade) => grade.studentId === student?.id,
  );
  return (
    <div className="page-shell">
      <section className="student-hero">
        <div>
          <span className="eyebrow light">Мой школьный день</span>
          <h1>Привет, {student?.firstName ?? "ученик"}!</h1>
          <p>{weekdays[todayWeekday()]} · всё нужное на сегодня</p>
        </div>
        <div>
          <span>Средний балл</span>
          <strong>{weightedAverage(ownGrades)}</strong>
        </div>
      </section>
      <section className="two-column-grid">
        <div className="content-card">
          <SectionTitle
            title="Уроки сегодня"
            action="Вся неделя"
            onAction={() => onView("schedule")}
          />
          <LessonList snapshot={snapshot} compact />
        </div>
        <div className="content-card">
          <SectionTitle
            title="Что сделать"
            action="Все задания"
            onAction={() => onView("homework")}
          />
          <HomeworkList snapshot={snapshot} limit={3} />
        </div>
      </section>
      <section className="content-card">
        <SectionTitle title="Мои успехи" subtitle="Что заметили учителя" />
        {snapshot.achievements.length ? (
          <div className="achievement-grid">
            {snapshot.achievements.map((item) => (
              <article key={item.id}>
                <span>
                  <Icon name="star" />
                </span>
                <div>
                  <small>
                    {item.category} · {formatDate(item.achievementDate)}
                  </small>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Успехи появятся здесь"
            text="Учитель сможет отметить сильные действия, не только оценки."
            icon="star"
          />
        )}
      </section>
    </div>
  );
}

function Dashboard({
  snapshot,
  openAction,
  onView,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
  onView: (view: View) => void;
}) {
  if (snapshot.viewer.role === "director" || snapshot.viewer.role === "deputy")
    return <LeadershipDashboard snapshot={snapshot} onView={onView} />;
  if (snapshot.viewer.role === "teacher")
    return (
      <TeacherDashboard
        snapshot={snapshot}
        openAction={openAction}
        onView={onView}
      />
    );
  if (snapshot.viewer.role === "admin")
    return (
      <AdminDashboard
        snapshot={snapshot}
        openAction={openAction}
        onView={onView}
      />
    );
  if (snapshot.viewer.role === "student")
    return <StudentDashboard snapshot={snapshot} onView={onView} />;
  if (snapshot.viewer.role === "tech_admin")
    return <TechnicalAdminPage snapshot={snapshot} />;
  return <ParentDashboard snapshot={snapshot} onView={onView} />;
}

function StudyPage({
  snapshot,
  openAction,
  initialTab = "schedule",
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
  initialTab?: "grades" | "homework" | "schedule" | "success" | "comments";
}) {
  const academicMode =
    snapshot.viewer.role === "teacher" ||
    snapshot.viewer.role === "director" ||
    snapshot.viewer.role === "deputy";
  const teacherWriteMode = snapshot.viewer.role === "teacher";
  const scheduleEditor =
    snapshot.viewer.role === "director" ||
    snapshot.viewer.role === "deputy" ||
    snapshot.viewer.role === "admin";
  const [tab, setTab] = useState<
    "grades" | "homework" | "schedule" | "success" | "comments"
  >(initialTab);
  const [day, setDay] = useState(todayWeekday());
  const [scheduleClass, setScheduleClass] = useState(
    snapshot.selectedStudent?.className ?? snapshot.classes[0]?.name ?? "1",
  );
  const selectedStudentId = snapshot.selectedStudent?.id;
  const classLessons = snapshot.lessons.filter(
    (lesson) => lesson.className === scheduleClass && lesson.weekday === day,
  );
  const nextSlot =
    bellSlots.find(
      ([startsAt, endsAt]) =>
        !classLessons.some(
          (lesson) => lesson.startsAt < endsAt && lesson.endsAt > startsAt,
        ),
    ) ?? bellSlots[bellSlots.length - 1];
  const addLesson = () =>
    openAction("lesson.upsert", {
      className: scheduleClass,
      weekday: String(day),
      startsAt: nextSlot[0],
      endsAt: nextSlot[1],
    });
  const editLesson = (lesson: SchoolSnapshot["lessons"][number]) =>
    openAction("lesson.upsert", {
      lessonId: lesson.id,
      className: lesson.className,
      weekday: String(lesson.weekday),
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      subjectId: lesson.subjectId,
      teacherId: lesson.teacherUserId ?? "",
      room: lesson.room,
      status: lesson.status,
      note: lesson.note ?? "",
    });
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {academicMode || scheduleEditor
              ? "Учебный процесс"
              : snapshot.selectedStudent?.fullName}
          </span>
          <h1>
            {tab === "schedule"
              ? "Расписание"
              : tab === "homework"
                ? "Домашние задания"
                : tab === "grades"
                  ? "Журнал"
                  : "Учёба"}
          </h1>
          <p>
            {academicMode
              ? "Оценки, задания, успехи и комментарии — в одной системе"
              : "Расписание и результаты без поиска по чатам"}
          </p>
        </div>
        {teacherWriteMode && tab === "grades" ? (
          <button
            className="primary-btn"
            onClick={() => openAction("grade.create")}
          >
            <Icon name="chart" size={18} />
            Новая оценка
          </button>
        ) : null}
      </div>
      <div className="tab-row">
        {[
          ["schedule", "Расписание"],
          ["grades", "Оценки"],
          ["homework", "Задания"],
          ["success", "Успехи"],
          ["comments", "Комментарии"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={cn(tab === id && "active")}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "schedule" ? (
        <section className="content-card study-panel schedule-editor">
          {scheduleEditor ? (
            <div className="schedule-toolbar">
              <label>
                <span>Класс</span>
                <select
                  value={scheduleClass}
                  onChange={(event) => setScheduleClass(event.target.value)}
                >
                  {snapshot.classes.map((schoolClass) => (
                    <option value={schoolClass.name} key={schoolClass.id}>
                      {schoolClass.name} класс
                      {schoolClass.homeroomTeacherName
                        ? ` · ${schoolClass.homeroomTeacherName}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button
                  className="ghost-btn"
                  onClick={() =>
                    openAction("lesson.copy-day", {
                      className: scheduleClass,
                      sourceWeekday: String(day),
                    })
                  }
                >
                  <Icon name="clipboard" size={17} />
                  Скопировать день
                </button>
                <button className="primary-btn" onClick={addLesson}>
                  <Icon name="calendar" size={17} />
                  Добавить урок
                </button>
              </div>
            </div>
          ) : null}
          <div className="day-switch">
            {[1, 2, 3, 4, 5, 6].map((weekday) => (
              <button
                key={weekday}
                className={cn(day === weekday && "active")}
                onClick={() => setDay(weekday)}
              >
                <span>{weekdayShort[weekday]}</span>
                <small>
                  {
                    snapshot.lessons.filter(
                      (lesson) =>
                        lesson.weekday === weekday &&
                        (!scheduleEditor || lesson.className === scheduleClass),
                    ).length
                  }{" "}
                  уроков
                </small>
              </button>
            ))}
          </div>
          <SectionTitle
            title={weekdays[day]}
            subtitle={`${scheduleEditor ? scheduleClass : (snapshot.selectedStudent?.className ?? scheduleClass)} класс${scheduleEditor ? " · нажмите «Изменить» у нужного урока" : ""}`}
          />
          <LessonList
            snapshot={snapshot}
            day={day}
            className={scheduleEditor ? scheduleClass : undefined}
            onEdit={scheduleEditor ? editLesson : undefined}
          />
        </section>
      ) : null}
      {tab === "grades" ? (
        <section className="content-card study-panel">
          <SectionTitle
            title={
              academicMode
                ? "Журнал оценок"
                : `Средний балл ${weightedAverage(snapshot.grades.filter((grade) => grade.studentId === selectedStudentId))}`
            }
            subtitle={
              academicMode
                ? `${snapshot.students.length} учеников в разрешённом контуре`
                : "С учётом веса работ"
            }
            action={teacherWriteMode ? "Поставить оценку" : undefined}
            onAction={
              teacherWriteMode ? () => openAction("grade.create") : undefined
            }
          />
          {academicMode ? (
            <div className="journal-table">
              <div className="journal-head">
                <span>Ученик</span>
                <span>Средний</span>
                <span>Последние оценки</span>
                <span />
              </div>
              {snapshot.students.map((student) => {
                const grades = snapshot.grades.filter(
                  (grade) => grade.studentId === student.id,
                );
                return (
                  <div className="journal-row" key={student.id}>
                    <span>
                      <Avatar
                        name={student.fullName}
                        color={student.avatarColor}
                        size="sm"
                      />
                      <strong>{student.fullName}</strong>
                    </span>
                    <b>{weightedAverage(grades)}</b>
                    <span className="grade-dots">
                      {grades.slice(0, 4).map((grade) => (
                        <i key={grade.id} className={`grade-${grade.value}`}>
                          {grade.value}
                        </i>
                      ))}
                    </span>
                    {teacherWriteMode ? (
                      <button
                        onClick={() =>
                          openAction("grade.create", { studentId: student.id })
                        }
                      >
                        Оценка
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <GradeList snapshot={snapshot} studentId={selectedStudentId} />
          )}
        </section>
      ) : null}
      {tab === "homework" ? (
        <section className="content-card study-panel">
          <SectionTitle
            title="Домашние задания"
            subtitle="Опубликованные задания и сроки"
            action={teacherWriteMode ? "Добавить" : undefined}
            onAction={
              teacherWriteMode ? () => openAction("homework.create") : undefined
            }
          />
          <HomeworkList snapshot={snapshot} />
        </section>
      ) : null}
      {tab === "success" ? (
        <section className="content-card study-panel">
          <SectionTitle
            title="Успехи"
            subtitle="Позитивные наблюдения учителей"
            action={teacherWriteMode ? "Отметить успех" : undefined}
            onAction={
              teacherWriteMode
                ? () => openAction("achievement.create")
                : undefined
            }
          />
          {snapshot.achievements.length ? (
            <div className="achievement-grid">
              {snapshot.achievements.map((item) => (
                <article key={item.id}>
                  <span>
                    <Icon name="star" />
                  </span>
                  <div>
                    <small>
                      {item.studentName} · {item.category} ·{" "}
                      {formatDate(item.achievementDate)}
                    </small>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <em>{item.teacherName}</em>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Успехов пока нет"
              text="Учитель сможет зафиксировать сильное действие за несколько секунд."
              icon="star"
            />
          )}
        </section>
      ) : null}
      {tab === "comments" ? (
        <section className="content-card study-panel">
          <SectionTitle
            title="Комментарии учителей"
            subtitle="Личная обратная связь для семьи"
            action={teacherWriteMode ? "Оставить комментарий" : undefined}
            onAction={
              teacherWriteMode ? () => openAction("comment.create") : undefined
            }
          />
          {snapshot.comments.length ? (
            <div className="comment-list">
              {snapshot.comments.map((item) => (
                <article key={item.id}>
                  <Avatar name={item.teacherName} size="sm" />
                  <div>
                    <small>
                      {item.studentName} · {item.subjectName ?? "Общее"} ·{" "}
                      {formatDate(item.commentDate)}
                    </small>
                    <p>{item.body}</p>
                    <strong>{item.teacherName}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Комментариев нет"
              text="Здесь будет только содержательная личная обратная связь."
              icon="message"
            />
          )}
        </section>
      ) : null}
    </div>
  );
}

function CalendarPage({
  snapshot,
  openAction,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
}) {
  const [mode, setMode] = useState<"week" | "list">("week");
  const [scope, setScope] = useState<"relevant" | "school">("relevant");
  const canPublish =
    snapshot.viewer.role === "director" ||
    snapshot.viewer.role === "deputy" ||
    snapshot.viewer.role === "admin";
  const calendarItems = [
    ...snapshot.events.map((event) => ({
      id: event.id,
      type: "Событие",
      title: event.title,
      at: event.startsAt,
      meta: event.location,
      tone: "orange",
    })),
    ...snapshot.homework.map((item) => ({
      id: item.id,
      type: "Задание",
      title: item.title,
      at: item.dueAt,
      meta: `${item.className} класс · ${item.subjectName}`,
      tone: "violet",
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Общий календарь</span>
          <h1>Календарь школы</h1>
          <p>
            Учебные работы, изменения расписания, события и личные напоминания
          </p>
        </div>
        {canPublish ? (
          <button
            className="primary-btn"
            onClick={() => openAction("event.create")}
          >
            <Icon name="calendar" size={18} />
            Создать событие
          </button>
        ) : null}
      </div>
      <div className="calendar-toolbar">
        <div className="segmented">
          <button
            className={cn(mode === "week" && "active")}
            onClick={() => setMode("week")}
          >
            Неделя
          </button>
          <button
            className={cn(mode === "list" && "active")}
            onClick={() => setMode("list")}
          >
            Список
          </button>
        </div>
        <label>
          <span>Показывать</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="relevant">Мои события</option>
            <option value="school">Вся школа</option>
          </select>
        </label>
      </div>
      {mode === "week" ? (
        <section className="calendar-week">
          {[1, 2, 3, 4, 5, 6].map((day) => (
            <article key={day}>
              <header>
                <strong>{weekdayShort[day]}</strong>
                <span>
                  {
                    snapshot.lessons.filter((lesson) => lesson.weekday === day)
                      .length
                  }{" "}
                  уроков
                </span>
              </header>
              <div>
                {snapshot.lessons
                  .filter((lesson) => lesson.weekday === day)
                  .slice(0, 6)
                  .map((lesson) => (
                    <div
                      className="calendar-lesson"
                      key={lesson.id}
                      style={{ borderLeftColor: lesson.subjectColor }}
                    >
                      <small>{lesson.startsAt}</small>
                      <strong>{lesson.subjectName}</strong>
                      <span>{lesson.className} класс</span>
                    </div>
                  ))}
                {!snapshot.lessons.some((lesson) => lesson.weekday === day) ? (
                  <p>Нет уроков</p>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="content-card">
          <SectionTitle
            title="Все ближайшие события"
            subtitle={
              scope === "school"
                ? "Школьный контур"
                : "Только относящиеся к пользователю"
            }
          />
          {calendarItems.length ? (
            <div className="calendar-list">
              {calendarItems.map((item) => (
                <article key={`${item.type}-${item.id}`}>
                  <span className={`calendar-dot ${item.tone}`} />
                  <div>
                    <small>
                      {item.type} · {formatDateTime(item.at)}
                    </small>
                    <strong>{item.title}</strong>
                    <p>{item.meta}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Календарь пока пуст"
              text="После публикации расписания и событий они появятся здесь автоматически."
              icon="calendar"
            />
          )}
        </section>
      )}
      <section className="content-card notifications-card">
        <SectionTitle
          title="Уведомления"
          subtitle="Каждое ведёт на конкретный объект"
        />
        {snapshot.notifications.length ? (
          <div className="notification-list">
            {snapshot.notifications.map((item) => (
              <article key={item.id} className={cn(!item.readAt && "unread")}>
                <span>
                  <Icon name={item.critical ? "info" : "bell"} size={17} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <small>{formatDateTime(item.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Новых уведомлений нет"
            text="Критические изменения расписания появятся здесь и не потеряются."
            icon="bell"
          />
        )}
      </section>
    </div>
  );
}

function ProgramsPage({
  snapshot,
  openAction,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
}) {
  const canEdit =
    snapshot.viewer.role === "teacher" ||
    snapshot.viewer.role === "director" ||
    snapshot.viewer.role === "deputy";
  const statusMeta: Record<
    string,
    { label: string; tone: "good" | "warn" | "blue" | "neutral" }
  > = {
    draft: { label: "Черновик", tone: "neutral" },
    review: { label: "На проверке", tone: "blue" },
    changes_requested: { label: "Нужны правки", tone: "warn" },
    approved: { label: "Утверждена", tone: "good" },
    active: { label: "Используется", tone: "good" },
    archived: { label: "Архив", tone: "neutral" },
  };
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Учебный год → класс → предмет</span>
          <h1>
            {snapshot.viewer.role === "teacher"
              ? "Моя программа"
              : "Учебные программы"}
          </h1>
          <p>
            Годовой план, поурочные темы, факт проведения и отклонение от плана
          </p>
        </div>
        {canEdit ? (
          <button
            className="primary-btn"
            onClick={() => openAction("program.upsert")}
          >
            <Icon name="book" size={18} />
            Новая программа
          </button>
        ) : null}
      </div>
      <section className="metric-grid program-metrics">
        <MetricCard
          label="Программы"
          value={String(snapshot.programs.length)}
          caption="в системе"
          icon="book"
        />
        <MetricCard
          label="На проверке"
          value={String(
            snapshot.programs.filter((item) => item.status === "review").length,
          )}
          caption="ожидают завуча"
          icon="clock"
          tone="blue"
        />
        <MetricCard
          label="Утверждены"
          value={String(
            snapshot.programs.filter((item) =>
              ["approved", "active"].includes(item.status),
            ).length,
          )}
          caption="можно использовать"
          icon="check"
          tone="green"
        />
        <MetricCard
          label="Без программы"
          value={String(
            Math.max(
              0,
              snapshot.teacherAssignments.length - snapshot.programs.length,
            ),
          )}
          caption="назначений требуют плана"
          icon="info"
          tone="amber"
        />
      </section>
      {snapshot.programs.length ? (
        <section className="program-grid">
          {snapshot.programs.map((program) => {
            const meta = statusMeta[program.status] ?? statusMeta.draft;
            const progress = program.plannedLessons
              ? Math.min(
                  100,
                  Math.round(
                    (program.completedLessons / program.plannedLessons) * 100,
                  ),
                )
              : 0;
            return (
              <button
                key={program.id}
                disabled={!canEdit}
                onClick={() =>
                  openAction("program.upsert", {
                    programId: program.id,
                    className: program.className,
                    subjectId: program.subjectId,
                    teacherUserId: program.teacherUserId,
                    title: program.title,
                    plannedLessons: String(program.plannedLessons),
                    status: program.status,
                  })
                }
              >
                <header>
                  <span
                    style={{
                      background: `${snapshot.subjects.find((item) => item.id === program.subjectId)?.color ?? "#e84412"}20`,
                    }}
                  >
                    <Icon name="book" />
                  </span>
                  <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                </header>
                <small>
                  {program.className} класс · {program.subjectName}
                </small>
                <strong>{program.title}</strong>
                <p>{program.teacherName}</p>
                <div className="program-progress">
                  <span>
                    <i style={{ width: `${progress}%` }} />
                  </span>
                  <small>
                    {program.completedLessons} из {program.plannedLessons}{" "}
                    уроков
                  </small>
                </div>
              </button>
            );
          })}
        </section>
      ) : (
        <section className="content-card">
          <EmptyState
            title="Программы ещё не загружены"
            text="Учитель создаёт программу вручную или импортирует проверенный XLSX; PDF сам по себе программой не считается."
            icon="book"
          />
        </section>
      )}
    </div>
  );
}

function PeoplePage({
  snapshot,
  onView,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
  onView: (view: View) => void;
}) {
  const operational =
    snapshot.viewer.role === "director" ||
    snapshot.viewer.role === "deputy" ||
    snapshot.viewer.role === "admin";
  if (!operational) {
    return (
      <div className="page-shell">
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {snapshot.viewer.role === "teacher"
                ? "Назначенные классы"
                : "Семья"}
            </span>
            <h1>
              {snapshot.viewer.role === "teacher"
                ? "Мои классы и ученики"
                : "Мои дети"}
            </h1>
            <p>Только разрешённые карточки без доступа к чужим данным</p>
          </div>
        </div>
        <section className="student-directory">
          {snapshot.students.map((student) => (
            <button key={student.id} onClick={() => onView("journal")}>
              <Avatar
                name={student.fullName}
                color={student.avatarColor}
                size="lg"
              />
              <span>
                <strong>{student.fullName}</strong>
                <small>
                  {student.className} класс · средний балл{" "}
                  {weightedAverage(
                    snapshot.grades.filter(
                      (grade) => grade.studentId === student.id,
                    ),
                  )}
                </small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </section>
        {!snapshot.students.length ? (
          <EmptyState
            title="Нет доступных карточек"
            text="Связь с ребёнком или классом должен подтвердить администратор школы."
            icon="users"
          />
        ) : null}
      </div>
    );
  }
  const unresolved = snapshot.users.filter(
    (user) =>
      user.role === "teacher" &&
      user.profileStatus !== "confirmed" &&
      user.profileStatus !== "demo",
  );
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Единые карточки ArtHello OS</span>
          <h1>Люди, классы и семьи</h1>
          <p>
            Ученик, семья и сотрудник создаются один раз и используются во всех
            процессах
          </p>
        </div>
        <StatusPill tone="good">Проекция ArtHello OS</StatusPill>
      </div>
      <section className="metric-grid">
        <MetricCard
          label="Классы"
          value={String(snapshot.classes.length)}
          caption="1–6"
          icon="school"
        />
        <MetricCard
          label="Ученики"
          value={String(snapshot.students.length)}
          caption="активные карточки"
          icon="users"
          tone="blue"
        />
        <MetricCard
          label="Педагоги"
          value={String(
            snapshot.users.filter(
              (user) =>
                user.role === "teacher" && user.profileStatus !== "demo",
            ).length,
          )}
          caption="в матрице"
          icon="user"
          tone="violet"
        />
        <MetricCard
          label="Требуют решения"
          value={String(unresolved.length)}
          caption="вакансии и уточнения"
          icon="info"
          tone="amber"
        />
      </section>
      <section className="content-card">
        <SectionTitle
          title="Классы"
          subtitle="Классный руководитель и количество учеников"
        />
        <div className="class-grid">
          {snapshot.classes.map((schoolClass) => (
            <button key={schoolClass.id} onClick={() => onView("schedule")}>
              <span>{schoolClass.grade}</span>
              <div>
                <strong>{schoolClass.name} класс</strong>
                <small>
                  {schoolClass.homeroomTeacherName ??
                    "Классный руководитель не назначен"}
                </small>
              </div>
              <b>
                {
                  snapshot.students.filter(
                    (student) => student.className === schoolClass.name,
                  ).length
                }
              </b>
            </button>
          ))}
        </div>
      </section>
      <section className="content-card">
        <SectionTitle
          title="Педагогический состав"
          subtitle={`${unresolved.length} позиций требуют решения`}
        />
        <StaffDirectory snapshot={snapshot} />
      </section>
    </div>
  );
}

function ManagementPage({
  snapshot,
  openAction,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
}) {
  const done = snapshot.setup.checklist.filter((item) => item.done).length;
  if (snapshot.viewer.role === "tech_admin")
    return <TechnicalAdminPage snapshot={snapshot} />;
  return (
    <div className="management-page">
      <AdminManagement snapshot={snapshot} openAction={openAction} />
      <section className="page-shell readiness-page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Настройка системы</span>
            <h1>Данные и готовность</h1>
            <p>Этот экран вынесен из ежедневного рабочего стола</p>
          </div>
        </div>
        <section className="admin-readiness">
          <div>
            <span className="eyebrow light">Закрытый тестовый контур</span>
            <strong>
              {done} из {snapshot.setup.checklist.length}
            </strong>
            <p>
              Каждый пункт содержит ответственного и ведёт к конкретному
              действию. Родители не получат доступ до закрытия правового и
              авторизационного блокеров.
            </p>
            <div className="readiness-track">
              <span
                style={{
                  width: `${Math.round((done / snapshot.setup.checklist.length) * 100)}%`,
                }}
              />
            </div>
          </div>
          <ul>
            {snapshot.setup.checklist.map((item) => (
              <li key={item.id} className={cn(item.done && "done")}>
                <span>
                  {item.done ? <Icon name="check" size={15} /> : null}
                </span>
                {item.label}
              </li>
            ))}
          </ul>
        </section>
      </section>
    </div>
  );
}

function TechnicalAdminPage({ snapshot }: { snapshot: SchoolSnapshot }) {
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Ограниченный технический контур</span>
          <h1>Состояние системы</h1>
          <p>
            Техническая роль не получает автоматический доступ к оценкам,
            переписке и карточкам детей
          </p>
        </div>
      </div>
      <section className="metric-grid">
        <MetricCard
          label="Хранилище"
          value="D1"
          caption="постоянная база"
          icon="grid"
        />
        <MetricCard
          label="Аудит"
          value="Включён"
          caption="действия журналируются"
          icon="clipboard"
          tone="green"
        />
        <MetricCard
          label="Учебные данные"
          value="Закрыты"
          caption="нужен аварийный допуск"
          icon="lock"
          tone="amber"
        />
        <MetricCard
          label="Сессия"
          value={roleLabels[snapshot.viewer.role]}
          caption="текущие права"
          icon="user"
          tone="blue"
        />
      </section>
      <section className="privacy-card">
        <span>
          <Icon name="lock" />
        </span>
        <div>
          <strong>
            Аварийный доступ оформляется отдельно, ограничивается по времени и
            попадает в аудит
          </strong>
          <p>
            Через эту роль нельзя просматривать содержимое официальной переписки
            или изменять оценки.
          </p>
        </div>
      </section>
    </div>
  );
}

function AccessDeniedPage({ onHome }: { onHome: () => void }) {
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Права доступа</span>
          <h1>Этот раздел недоступен вашей роли</h1>
          <p>
            Система проверила маршрут на серверном и интерфейсном уровне. Данные
            не загружены.
          </p>
        </div>
        <button className="primary-btn" onClick={onHome}>
          <Icon name="home" size={18} />
          На главную
        </button>
      </div>
      <section className="privacy-card">
        <span>
          <Icon name="lock" />
        </span>
        <div>
          <strong>
            Если доступ нужен по работе, его назначает уполномоченный сотрудник
          </strong>
          <p>Техническое скрытие кнопки не является единственной защитой.</p>
        </div>
      </section>
    </div>
  );
}

function SchoolPage({
  snapshot,
  openAction,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
}) {
  const [tab, setTab] = useState<"menu" | "events" | "activities">("menu");
  const admin =
    snapshot.viewer.role === "admin" ||
    snapshot.viewer.role === "director" ||
    snapshot.viewer.role === "deputy";
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Школьная жизнь</span>
          <h1>Школа</h1>
          <p>Питание, мероприятия и дополнительные занятия</p>
        </div>
        {admin ? (
          <button
            className="primary-btn"
            onClick={() =>
              openAction(
                tab === "menu"
                  ? "menu.update"
                  : tab === "events"
                    ? "event.create"
                    : "activity.create",
              )
            }
          >
            <Icon name="calendar" size={18} />
            Добавить
          </button>
        ) : null}
      </div>
      <div className="tab-row compact-tabs">
        <button
          className={cn(tab === "menu" && "active")}
          onClick={() => setTab("menu")}
        >
          Меню
        </button>
        <button
          className={cn(tab === "events" && "active")}
          onClick={() => setTab("events")}
        >
          Мероприятия
        </button>
        <button
          className={cn(tab === "activities" && "active")}
          onClick={() => setTab("activities")}
        >
          Доп. занятия
        </button>
      </div>
      {tab === "menu" ? (
        <div className="menu-grid">
          {snapshot.menu.map((day, index) => (
            <article key={day.id} className={cn(index === 0 && "featured")}>
              <header>
                <span>
                  {formatDate(day.dayDate, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
                {index === 0 ? (
                  <StatusPill tone="good">Сегодня</StatusPill>
                ) : null}
              </header>
              <dl>
                <div>
                  <dt>Завтрак</dt>
                  <dd>{day.breakfast}</dd>
                </div>
                <div>
                  <dt>Обед</dt>
                  <dd>{day.lunch}</dd>
                </div>
                <div>
                  <dt>Полдник</dt>
                  <dd>{day.snack}</dd>
                </div>
              </dl>
              <footer>
                <Icon name="info" size={16} />
                Аллергены: {day.allergens || "не указаны"}
              </footer>
            </article>
          ))}
        </div>
      ) : null}
      {tab === "events" ? (
        <div className="event-grid">
          {snapshot.events.map((event) => (
            <article key={event.id}>
              <div className="event-date">
                <strong>
                  {formatDate(event.startsAt, { day: "2-digit" })}
                </strong>
                <span>{formatDate(event.startsAt, { month: "short" })}</span>
              </div>
              <div>
                <span className="item-overline">
                  {formatDateTime(event.startsAt)} · {event.location}
                </span>
                <h3>{event.title}</h3>
                <p>{event.description}</p>
                <footer>
                  <StatusPill tone="blue">
                    {event.audience === "all"
                      ? "Для всей школы"
                      : event.audience}
                  </StatusPill>
                  {event.capacity ? <small>{event.capacity} мест</small> : null}
                </footer>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {tab === "activities" ? (
        <div className="activity-grid">
          {snapshot.activities.map((activity) => (
            <article key={activity.id}>
              <span className="activity-icon">
                <Icon name="star" />
              </span>
              <div>
                <small>{activity.schedule}</small>
                <h3>{activity.title}</h3>
                <p>{activity.teacher}</p>
                <div className="capacity">
                  <span>
                    <i
                      style={{
                        width: `${Math.min(100, (activity.enrolled / Math.max(activity.capacity, 1)) * 100)}%`,
                      }}
                    />
                  </span>
                  <small>
                    {activity.enrolled} из {activity.capacity} мест
                  </small>
                </div>
              </div>
              <footer>
                <strong>
                  {activity.price ? formatMoney(activity.price) : "Включено"}
                </strong>
                <StatusPill
                  tone={activity.enrolled < activity.capacity ? "good" : "warn"}
                >
                  {activity.enrolled < activity.capacity
                    ? "Есть места"
                    : "Лист ожидания"}
                </StatusPill>
              </footer>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessagesPage({
  snapshot,
  send,
  viewThread,
}: {
  snapshot: SchoolSnapshot;
  send: (threadId: string, body: string) => Promise<void>;
  viewThread: (threadId: string) => Promise<void>;
}) {
  const [activeThread, setActiveThread] = useState(
    snapshot.threads[0]?.id ?? "",
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const thread =
    snapshot.threads.find((item) => item.id === activeThread) ??
    snapshot.threads[0];
  const messages = snapshot.messages.filter(
    (message) => message.threadId === thread?.id,
  );
  useEffect(() => {
    if (thread?.id) void viewThread(thread.id);
  }, [thread?.id, viewThread]);
  if (snapshot.viewer.role === "student")
    return (
      <div className="page-shell">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Связь со школой</span>
            <h1>Сообщения</h1>
          </div>
        </div>
        <EmptyState
          title="Диалог ведёт родитель"
          text="В уровне 0 личное общение идёт между родителем и учителем. Школьные объявления доступны в разделе «Школа»."
          icon="chat"
        />
      </div>
    );
  if (!thread)
    return (
      <div className="page-shell">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Прямой канал</span>
            <h1>Сообщения</h1>
          </div>
        </div>
        <EmptyState
          title="Диалогов пока нет"
          text="Администратор создаст связь между родителем, ребёнком и классным руководителем."
          icon="chat"
        />
      </div>
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setSending(true);
    try {
      await send(thread.id, value);
      setDraft("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="page-shell messages-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Родитель ↔ учитель</span>
          <h1>Сообщения</h1>
          <p>Официальный диалог по ребёнку, без общего школьного чата</p>
        </div>
      </div>
      <div className="official-channel">
        <Icon name="lock" size={17} />
        <p>
          Это официальный канал школы. Переписка доступна уполномоченному
          администратору, завучу и директору. Просмотр и действия журналируются.
        </p>
      </div>
      <div className="messenger">
        <aside>
          {snapshot.threads.map((item) => (
            <button
              key={item.id}
              className={cn(item.id === thread.id && "active")}
              onClick={() => setActiveThread(item.id)}
            >
              <Avatar
                name={
                  snapshot.viewer.role === "parent"
                    ? item.teacherName
                    : item.parentName
                }
                size="sm"
              />
              <span>
                <strong>
                  {snapshot.viewer.role === "parent"
                    ? item.teacherName
                    : item.parentName}
                </strong>
                <small>{item.studentName}</small>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
        </aside>
        <section>
          <header>
            <Avatar
              name={
                snapshot.viewer.role === "parent"
                  ? thread.teacherName
                  : thread.parentName
              }
              size="sm"
            />
            <span>
              <strong>
                {snapshot.viewer.role === "parent"
                  ? thread.teacherName
                  : thread.parentName}
              </strong>
              <small>{thread.title}</small>
            </span>
            <StatusPill tone="good">Официальный диалог</StatusPill>
          </header>
          <div className="message-stream">
            {messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  message.authorUserId === snapshot.viewer.id && "own",
                  snapshot.viewer.role === "admin" &&
                    message.authorRole === snapshot.viewer.role &&
                    "own",
                )}
              >
                <span>{message.body}</span>
                <small>
                  {message.authorName} · {formatDateTime(message.createdAt)}
                </small>
              </article>
            ))}
          </div>
          <form className="message-form" onSubmit={submit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Напишите сообщение…"
              maxLength={1500}
              rows={2}
            />
            <button
              className="primary-btn"
              disabled={sending || !draft.trim()}
              aria-label="Отправить"
            >
              <Icon name="send" size={18} />
              <span>Отправить</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function ProfilePage({ snapshot }: { snapshot: SchoolSnapshot }) {
  const student = snapshot.selectedStudent;
  return (
    <div className="page-shell">
      <div className="profile-head">
        <Avatar name={snapshot.viewer.displayName} size="lg" />
        <div>
          <span className="eyebrow">{roleLabels[snapshot.viewer.role]}</span>
          <h1>{snapshot.viewer.displayName}</h1>
          <p>{snapshot.viewer.phone}</p>
        </div>
        <Link className="ghost-btn" href="/api/auth/logout">
          <Icon name="logout" size={17} />
          Выйти
        </Link>
      </div>
      {student ? (
        <section className="content-card child-profile">
          <SectionTitle title="Карточка ребёнка" />
          <Avatar
            name={student.fullName}
            color={student.avatarColor}
            size="lg"
          />
          <div>
            <h2>{student.fullName}</h2>
            <p>{student.className} класс · 2026/27 учебный год</p>
            <span>
              <StatusPill tone="good">Профиль активен</StatusPill>
              <StatusPill tone="blue">Данные защищены</StatusPill>
            </span>
          </div>
        </section>
      ) : null}
      <section className="content-card">
        <SectionTitle
          title="Абонементы и расчёты"
          subtitle="Основная школа и дополнительные занятия"
        />
        {snapshot.subscriptions.length ? (
          <div className="subscription-grid">
            {snapshot.subscriptions.map((item) => (
              <article key={item.id}>
                <header>
                  <span className="subscription-icon">
                    <Icon name="qr" />
                  </span>
                  <StatusPill tone={item.status === "active" ? "good" : "warn"}>
                    {item.status === "active" ? "Активен" : item.status}
                  </StatusPill>
                </header>
                <h3>{item.name}</h3>
                <p>{item.period}</p>
                <dl>
                  <div>
                    <dt>Баланс</dt>
                    <dd>
                      {item.balance ? formatMoney(item.balance) : "Оплачено"}
                    </dd>
                  </div>
                  {item.lessonsLeft ? (
                    <div>
                      <dt>Осталось</dt>
                      <dd>{item.lessonsLeft} занятий</dd>
                    </div>
                  ) : null}
                  {item.renewalAt ? (
                    <div>
                      <dt>Продление</dt>
                      <dd>{formatDate(item.renewalAt)}</dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Абонементов нет"
            text="Активные услуги появятся после назначения администратором."
            icon="qr"
          />
        )}
      </section>
      <section className="privacy-card">
        <span>
          <Icon name="lock" />
        </span>
        <div>
          <strong>
            Данные ребёнка видны только семье и сотрудникам с назначенной ролью
          </strong>
          <p>
            Все изменения оценок, заданий и комментариев записываются в
            системный журнал.
          </p>
        </div>
      </section>
    </div>
  );
}

function AdminManagement({
  snapshot,
}: {
  snapshot: SchoolSnapshot;
  openAction: (kind: ActionKind, preset?: Record<string, string>) => void;
}) {
  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Администрирование</span>
          <h1>Пользователи и доступы</h1>
          <p>
            Read-only проекция центральных карточек; здесь остаются только
            учебные назначения
          </p>
        </div>
        <StatusPill tone="good">Источник: ArtHello OS</StatusPill>
      </div>
      <section className="content-card privacy-card">
        <span><Icon name="lock" /></span>
        <div>
          <strong>Сотрудники, семьи, родители, ученики и классы создаются один раз — в ArtHello OS</strong>
          <p>AlfaCRM передаёт исходные карточки по API. Роль, связи семьи, блокировка и сброс пароля приходят централизованно. В дневнике остаются расписание, назначения учителя, уроки, оценки, посещаемость и задания.</p>
        </div>
      </section>
      <section className="content-card registration-queue">
        <SectionTitle
          title="Выдача доступа перенесена в карточку семьи"
          subtitle="Телефон или email, одноразовая ссылка, блокировка и сброс — в ArtHello OS"
        />
        <EmptyState title="Локальная регистрация отключена" text="Откройте семью в ArtHello OS, выберите родителя или ученика и нажмите «Выдать и отправить». Дневник примет подписанную проекцию и подготовит ссылку для создания пароля." icon="check" />
      </section>
      <section className="content-card">
        <SectionTitle
          title="Пользователи"
          subtitle={`${snapshot.users.length} аккаунтов · управление доступом только в ArtHello OS`}
        />
        <div className="admin-table">
          <div className="admin-table-head">
            <span>Пользователь</span>
            <span>Роль</span>
            <span>Ребёнок</span>
            <span>Доступ</span>
          </div>
          {snapshot.users.map((user) => {
            const child = snapshot.students.find(
              (student) => student.id === user.linkedStudentId,
            );
            const passwordTone =
              user.passwordState === "active" ? "good" : "warn";
            const passwordLabel =
              user.passwordState === "active"
                ? "Активен"
                : user.passwordState === "reset_required"
                  ? "Нужен новый пароль"
                  : "Не активирован";
            return (
              <div className="admin-table-row" key={user.id}>
                <span>
                  <Avatar name={user.displayName} size="sm" />
                  <span>
                    <strong>{user.displayName}</strong>
                    <small>{user.phone ?? "Телефон не назначен"} · {user.identitySource === "arthello_os" ? "ArtHello OS" : "Дневник"}</small>
                  </span>
                </span>
                <span>{roleLabels[user.role]}</span>
                <span>{child?.fullName ?? "—"}</span>
                <span className="access-actions">
                  <StatusPill tone={passwordTone}>{passwordLabel}</StatusPill>
                  {user.identitySource !== "arthello_os" ? <small>Устаревшая локальная запись</small> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="two-column-grid">
        <div className="content-card">
          <SectionTitle title="Что редактируется в дневнике" />
          <ul className="security-list"><li><Icon name="check" size={16} />Классы и предметы учителя</li><li><Icon name="check" size={16} />Расписание, уроки и кабинеты</li><li><Icon name="check" size={16} />Оценки, посещаемость и задания</li><li><Icon name="check" size={16} />Комментарии и официальные сообщения</li></ul>
        </div>
        <div className="content-card">
          <SectionTitle title="Контроль безопасности" />
          <ul className="security-list">
            <li>
              <Icon name="check" size={16} />
              Одноразовые персональные ссылки
            </li>
            <li>
              <Icon name="check" size={16} />
              Старые сессии закрываются при сбросе
            </li>
            <li>
              <Icon name="check" size={16} />
              Сброс пароля любого пользователя — только через ArtHello OS
            </li>
            <li className="pending">
              <Icon name="info" size={16} />
              Правовые документы — до пилота
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

const modalTitles: Record<ActionKind, string> = {
  "grade.create": "Поставить оценку",
  "homework.create": "Опубликовать задание",
  "achievement.create": "Отметить успех",
  "comment.create": "Оставить комментарий",
  "message.send": "Новое сообщение",
  "family.invite.create": "Создать приглашение",
  "family.registration.claim": "Принять приглашение",
  "family.registration.request": "Заявка на регистрацию",
  "family.registration.approve": "Подтвердить семью",
  "user.invite": "Добавить пользователя",
  "user.password.reset": "Сбросить пароль",
  "student.create": "Добавить ученика",
  "lesson.upsert": "Добавить урок в расписание",
  "lesson.delete": "Удалить урок",
  "lesson.copy-day": "Скопировать учебный день",
  "event.create": "Создать мероприятие",
  "menu.update": "Опубликовать меню",
  "activity.create": "Добавить доп. занятие",
  "subscription.upsert": "Выдать абонемент",
  "program.upsert": "Учебная программа",
  "attendance.mark": "Отметить посещаемость",
  "notification.read": "Прочитать уведомление",
  "menu.rate": "Оценить блюдо",
  "thread.view": "Открыть диалог",
};

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ActionModal({
  state,
  snapshot,
  close,
  submit,
}: {
  state: Exclude<ModalState, null>;
  snapshot: SchoolSnapshot;
  close: () => void;
  submit: (kind: ActionKind, values: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const kind = state.kind;
  const preset = state.preset ?? {};
  const selectedStudent =
    preset.studentId ??
    snapshot.selectedStudent?.id ??
    snapshot.students[0]?.id ??
    "";
  const selectedSubject = preset.subjectId ?? snapshot.subjects[0]?.id ?? "";
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    try {
      await submit(kind, values);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header>
          <div>
            <span className="eyebrow">Школа 1–11</span>
            <h2 id="modal-title">
              {kind === "lesson.upsert" && preset.lessonId
                ? "Изменить урок"
                : modalTitles[kind]}
            </h2>
          </div>
          <button onClick={close} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </header>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            {kind === "family.invite.create" ? (
              preset.targetRole === "student" ? (
                <>
                  <input type="hidden" name="targetRole" value="student" />
                  <input
                    type="hidden"
                    name="studentId"
                    value={preset.studentId ?? selectedStudent}
                  />
                  <div className="form-explainer">
                    <Icon name="lock" />
                    <p>
                      <strong>Доступ ученика создаёт родитель.</strong>
                      <span>
                        Ребёнок получит отдельную одноразовую ссылку и увидит
                        только свой кабинет.
                      </span>
                    </p>
                  </div>
                  <Field label="Ссылка действует">
                    <select name="expiresDays" defaultValue="7">
                      <option value="1">1 день</option>
                      <option value="7">7 дней</option>
                      <option value="14">14 дней</option>
                    </select>
                  </Field>
                  <input type="hidden" name="maxUses" value="1" />
                </>
              ) : (
                <>
                  <input type="hidden" name="targetRole" value="parent" />
                  <Field
                    label="Персонально для ребёнка"
                    hint="Если ребёнка ещё нет в системе, оставьте пустым и укажите класс"
                  >
                    <select name="studentId" defaultValue="">
                      <option value="">Приглашение на класс</option>
                      {snapshot.students.map((student) => (
                        <option value={student.id} key={student.id}>
                          {student.fullName} · {student.className}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Класс">
                    <input
                      name="className"
                      placeholder="Например, 5А"
                      maxLength={20}
                    />
                  </Field>
                  <Field label="Срок действия">
                    <select name="expiresDays" defaultValue="7">
                      <option value="3">3 дня</option>
                      <option value="7">7 дней</option>
                      <option value="14">14 дней</option>
                      <option value="30">30 дней</option>
                    </select>
                  </Field>
                  <Field label="Сколько семей могут использовать">
                    <input
                      name="maxUses"
                      type="number"
                      min="1"
                      max="300"
                      defaultValue="30"
                    />
                  </Field>
                </>
              )
            ) : null}
            {kind === "family.registration.approve" ? (
              <>
                <input
                  type="hidden"
                  name="requestId"
                  value={preset.requestId ?? ""}
                />
                <div className="form-explainer">
                  <Icon name="check" />
                  <p>
                    <strong>Подтвердить связь родителя и ребёнка?</strong>
                    <span>
                      После подтверждения родитель сразу увидит дневник,
                      расписание и сообщения своего ребёнка.
                    </span>
                  </p>
                </div>
              </>
            ) : null}
            {[
              "grade.create",
              "achievement.create",
              "comment.create",
              "subscription.upsert",
            ].includes(kind) ? (
              <Field label="Ученик">
                <select
                  name="studentId"
                  defaultValue={selectedStudent}
                  required
                >
                  {snapshot.students.map((student) => (
                    <option value={student.id} key={student.id}>
                      {student.fullName} · {student.className}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {["grade.create", "homework.create", "comment.create"].includes(
              kind,
            ) ? (
              <Field label="Предмет">
                <select
                  name="subjectId"
                  defaultValue={selectedSubject}
                  required={kind !== "comment.create"}
                >
                  {kind === "comment.create" ? (
                    <option value="">Общий комментарий</option>
                  ) : null}
                  {snapshot.subjects.map((subject) => (
                    <option value={subject.id} key={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {kind === "grade.create" ? (
              <>
                <Field label="Оценка">
                  <select name="value" defaultValue="5">
                    <option value="5">5 — отлично</option>
                    <option value="4">4 — хорошо</option>
                    <option value="3">3 — требуется внимание</option>
                    <option value="2">2 — работа не зачтена</option>
                  </select>
                </Field>
                <Field label="Вес работы">
                  <select name="weight" defaultValue="1">
                    <option value="1">Обычная · ×1</option>
                    <option value="2">Самостоятельная · ×2</option>
                    <option value="3">Контрольная · ×3</option>
                  </select>
                </Field>
                <Field label="За что">
                  <input
                    name="title"
                    placeholder="Самостоятельная работа"
                    required
                    maxLength={120}
                  />
                </Field>
                <Field
                  label="Комментарий"
                  hint="Родитель увидит его рядом с оценкой"
                >
                  <textarea
                    name="comment"
                    placeholder="Что получилось и что повторить"
                    rows={3}
                    maxLength={500}
                  />
                </Field>
              </>
            ) : null}
            {kind === "homework.create" ? (
              <>
                <Field label="Класс">
                  <input
                    name="className"
                    defaultValue={
                      snapshot.selectedStudent?.className ??
                      snapshot.classes[0]?.name ??
                      "1"
                    }
                    required
                    maxLength={20}
                  />
                </Field>
                <Field label="Срок">
                  <input name="dueAt" type="datetime-local" required />
                </Field>
                <Field label="Название">
                  <input
                    name="title"
                    placeholder="№ 345–347"
                    required
                    maxLength={140}
                  />
                </Field>
                <Field label="Описание">
                  <textarea
                    name="description"
                    placeholder="Что сделать, в каком формате и что принести"
                    rows={5}
                    required
                    maxLength={1200}
                  />
                </Field>
              </>
            ) : null}
            {kind === "achievement.create" ? (
              <>
                <Field label="Категория">
                  <select name="category" defaultValue="Учёба">
                    <option>Учёба</option>
                    <option>Команда</option>
                    <option>Инициатива</option>
                    <option>Творчество</option>
                    <option>Спорт</option>
                  </select>
                </Field>
                <Field label="Название">
                  <input
                    name="title"
                    placeholder="Сильный ответ у доски"
                    required
                    maxLength={140}
                  />
                </Field>
                <Field label="Что именно получилось">
                  <textarea
                    name="description"
                    rows={4}
                    required
                    maxLength={800}
                  />
                </Field>
              </>
            ) : null}
            {kind === "comment.create" ? (
              <Field
                label="Комментарий для родителя"
                hint="Не заменяет оценку и не публикуется классу"
              >
                <textarea
                  name="body"
                  rows={6}
                  required
                  maxLength={1200}
                  placeholder="Конкретное наблюдение и следующий шаг"
                />
              </Field>
            ) : null}
            {kind === "program.upsert" ? (
              <>
                <input
                  type="hidden"
                  name="programId"
                  value={preset.programId ?? ""}
                />
                <Field label="Класс">
                  <select
                    name="className"
                    defaultValue={
                      preset.className ?? snapshot.classes[0]?.name ?? "1"
                    }
                  >
                    {snapshot.classes.map((schoolClass) => (
                      <option key={schoolClass.id} value={schoolClass.name}>
                        {schoolClass.name} класс
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Предмет">
                  <select
                    name="subjectId"
                    defaultValue={preset.subjectId ?? selectedSubject}
                  >
                    {snapshot.subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {snapshot.viewer.role !== "teacher" ? (
                  <Field label="Преподаватель">
                    <select
                      name="teacherUserId"
                      defaultValue={
                        preset.teacherUserId ??
                        snapshot.users.find(
                          (user) =>
                            user.role === "teacher" &&
                            user.profileStatus === "confirmed",
                        )?.id ??
                        ""
                      }
                    >
                      {snapshot.users
                        .filter(
                          (user) =>
                            user.role === "teacher" &&
                            !["vacant", "demo"].includes(user.profileStatus),
                        )
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.displayName}
                          </option>
                        ))}
                    </select>
                  </Field>
                ) : null}
                <Field label="Название программы">
                  <input
                    name="title"
                    defaultValue={
                      preset.title ?? "Рабочая программа на 2026/27 учебный год"
                    }
                    required
                    maxLength={180}
                  />
                </Field>
                <Field label="Плановое количество уроков">
                  <input
                    name="plannedLessons"
                    type="number"
                    min="0"
                    max="500"
                    defaultValue={preset.plannedLessons ?? "0"}
                  />
                </Field>
                <Field label="Статус">
                  <select name="status" defaultValue={preset.status ?? "draft"}>
                    <option value="draft">Черновик</option>
                    <option value="review">Готова к проверке</option>
                    {snapshot.viewer.role !== "teacher" ? (
                      <>
                        <option value="changes_requested">
                          Требует исправлений
                        </option>
                        <option value="approved">Утверждена</option>
                        <option value="active">Используется</option>
                        <option value="archived">Архивная</option>
                      </>
                    ) : null}
                  </select>
                </Field>
              </>
            ) : null}
            {kind === "user.invite" ? (
              <>
                <div className="form-explainer">
                  <Icon name="lock" />
                  <p>
                    <strong>Здесь создаются только родители и ученики.</strong>
                    <span>
                      Сотрудник сначала создаётся в ArtHello OS, а в дневнике
                      ему назначаются классы и предметы. Семья получит
                      одноразовую ссылку и создаст пароль сама.{" "}
                      {"Пользователь получит одноразовую ссылку только после проверки данных."}
                    </span>
                  </p>
                </div>
                <Field label="Имя">
                  <input
                    name="displayName"
                    required
                    maxLength={140}
                    placeholder="Анна Смирнова"
                  />
                </Field>
                <Field label="Телефон">
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    maxLength={24}
                    placeholder="+7 999 123-45-67"
                  />
                </Field>
                <Field label="Роль">
                  <select name="role" defaultValue="parent">
                    <option value="parent">Родитель</option>
                    <option value="student">Ученик</option>
                  </select>
                </Field>
                <Field label="Связать с ребёнком">
                  <select name="studentId" defaultValue="">
                    <option value="">Без привязки</option>
                    {snapshot.students.map((student) => (
                      <option value={student.id} key={student.id}>
                        {student.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Классный руководитель"
                  hint="Для личного диалога родителя с учителем"
                >
                  <select
                    name="teacherId"
                    defaultValue={
                      snapshot.users.find((user) => user.role === "teacher")
                        ?.id ?? ""
                    }
                  >
                    <option value="">Назначить позже</option>
                    {snapshot.users
                      .filter((user) => user.role === "teacher")
                      .map((user) => (
                        <option value={user.id} key={user.id}>
                          {user.displayName}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            ) : null}
            {kind === "user.password.reset" ? (
              <>
                <input
                  type="hidden"
                  name="userId"
                  value={preset.userId ?? ""}
                />
                <div className="form-explainer">
                  <Icon name="lock" />
                  <p>
                    <strong>
                      Сбросить доступ для {preset.displayName ?? "пользователя"}
                      ?
                    </strong>
                    <span>
                      Текущий пароль и все открытые сессии перестанут работать.
                      Будет создана новая одноразовая ссылка.
                    </span>
                  </p>
                </div>
              </>
            ) : null}
            {kind === "student.create" ? (
              <>
                <Field label="Имя">
                  <input name="firstName" required maxLength={80} />
                </Field>
                <Field label="Фамилия">
                  <input name="lastName" required maxLength={80} />
                </Field>
                <Field label="Класс">
                  <select
                    name="className"
                    defaultValue={snapshot.classes[0]?.name ?? "1"}
                    required
                  >
                    {snapshot.classes.map((schoolClass) => (
                      <option value={schoolClass.name} key={schoolClass.id}>
                        {schoolClass.name} класс
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}
            {kind === "lesson.upsert" ? (
              <>
                <input
                  type="hidden"
                  name="lessonId"
                  value={preset.lessonId ?? ""}
                />
                <Field label="Класс">
                  <select
                    name="className"
                    defaultValue={
                      preset.className ?? snapshot.classes[0]?.name ?? "1"
                    }
                    required
                  >
                    {snapshot.classes.map((schoolClass) => (
                      <option value={schoolClass.name} key={schoolClass.id}>
                        {schoolClass.name} класс
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="День">
                  <select name="weekday" defaultValue={preset.weekday ?? "1"}>
                    <option value="1">Понедельник</option>
                    <option value="2">Вторник</option>
                    <option value="3">Среда</option>
                    <option value="4">Четверг</option>
                    <option value="5">Пятница</option>
                    <option value="6">Суббота</option>
                  </select>
                </Field>
                <div className="form-pair">
                  <Field label="Начало">
                    <input
                      name="startsAt"
                      type="time"
                      defaultValue={preset.startsAt ?? "08:30"}
                      required
                    />
                  </Field>
                  <Field label="Окончание">
                    <input
                      name="endsAt"
                      type="time"
                      defaultValue={preset.endsAt ?? "09:15"}
                      required
                    />
                  </Field>
                </div>
                <Field label="Предмет">
                  <select name="subjectId" defaultValue={selectedSubject}>
                    {snapshot.subjects.map((subject) => (
                      <option value={subject.id} key={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Учитель" hint="Можно назначить позже">
                  <select
                    name="teacherId"
                    defaultValue={preset.teacherId ?? ""}
                  >
                    <option value="">Пока не назначен</option>
                    {snapshot.users
                      .filter(
                        (user) =>
                          user.role === "teacher" &&
                          !["vacant", "demo"].includes(user.profileStatus),
                      )
                      .map((user) => (
                        <option value={user.id} key={user.id}>
                          {user.displayName}
                          {user.profileStatus === "unconfirmed"
                            ? " · не утверждён"
                            : user.profileStatus === "needs_confirmation"
                              ? " · уточнить ФИО"
                              : ""}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  label="Кабинет"
                  hint="Если ещё не определён, оставьте пустым"
                >
                  <input
                    name="room"
                    defaultValue={preset.room ?? ""}
                    maxLength={80}
                    placeholder="Например, 210"
                  />
                </Field>
                <Field label="Примечание">
                  <input
                    name="note"
                    defaultValue={preset.note ?? ""}
                    maxLength={300}
                    placeholder="Замена, перенос или важная деталь"
                  />
                </Field>
                <Field label="Статус">
                  <select
                    name="status"
                    defaultValue={preset.status ?? "scheduled"}
                  >
                    <option value="scheduled">По расписанию</option>
                    <option value="moved">Изменение</option>
                    <option value="cancelled">Отменён</option>
                  </select>
                </Field>
              </>
            ) : null}
            {kind === "lesson.copy-day" ? (
              <>
                <div className="form-explainer">
                  <Icon name="clipboard" />
                  <p>
                    <strong>Скопируем все уроки вместе со временем.</strong>
                    <span>
                      Если учитель или кабинет заняты, система остановит
                      копирование и покажет конфликт.
                    </span>
                  </p>
                </div>
                <Field label="Класс">
                  <select
                    name="className"
                    defaultValue={
                      preset.className ?? snapshot.classes[0]?.name ?? "1"
                    }
                  >
                    {snapshot.classes.map((schoolClass) => (
                      <option value={schoolClass.name} key={schoolClass.id}>
                        {schoolClass.name} класс
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Откуда">
                  <select
                    name="sourceWeekday"
                    defaultValue={preset.sourceWeekday ?? "1"}
                  >
                    <option value="1">Понедельник</option>
                    <option value="2">Вторник</option>
                    <option value="3">Среда</option>
                    <option value="4">Четверг</option>
                    <option value="5">Пятница</option>
                    <option value="6">Суббота</option>
                  </select>
                </Field>
                <Field label="Куда">
                  <select
                    name="targetWeekday"
                    defaultValue={String(
                      (Number(preset.sourceWeekday ?? "1") % 6) + 1,
                    )}
                  >
                    <option value="1">Понедельник</option>
                    <option value="2">Вторник</option>
                    <option value="3">Среда</option>
                    <option value="4">Четверг</option>
                    <option value="5">Пятница</option>
                    <option value="6">Суббота</option>
                  </select>
                </Field>
              </>
            ) : null}
            {kind === "event.create" ? (
              <>
                <Field label="Название">
                  <input name="title" required maxLength={160} />
                </Field>
                <Field label="Дата и время">
                  <input name="startsAt" type="datetime-local" required />
                </Field>
                <Field label="Место">
                  <input name="location" required maxLength={160} />
                </Field>
                <Field label="Для кого">
                  <select name="audience" defaultValue="all">
                    <option value="all">Вся школа</option>
                    <option value="parent">Родители</option>
                    <option value="student">Ученики</option>
                    <option value="teacher">Сотрудники</option>
                  </select>
                </Field>
                <Field label="Описание">
                  <textarea
                    name="description"
                    rows={4}
                    required
                    maxLength={1000}
                  />
                </Field>
              </>
            ) : null}
            {kind === "menu.update" ? (
              <>
                <Field label="Дата">
                  <input name="dayDate" type="date" required />
                </Field>
                <Field label="Завтрак">
                  <textarea
                    name="breakfast"
                    rows={2}
                    required
                    maxLength={500}
                  />
                </Field>
                <Field label="Обед">
                  <textarea name="lunch" rows={3} required maxLength={500} />
                </Field>
                <Field label="Полдник">
                  <textarea name="snack" rows={2} required maxLength={500} />
                </Field>
                <Field label="Аллергены">
                  <input
                    name="allergens"
                    maxLength={500}
                    placeholder="Молоко, яйцо, глютен"
                  />
                </Field>
              </>
            ) : null}
            {kind === "activity.create" ? (
              <>
                <Field label="Название">
                  <input name="title" required maxLength={160} />
                </Field>
                <Field label="Расписание">
                  <input
                    name="schedule"
                    required
                    maxLength={160}
                    placeholder="Вт, Чт · 18:00"
                  />
                </Field>
                <Field label="Преподаватель">
                  <input name="teacher" required maxLength={140} />
                </Field>
                <Field label="Стоимость в месяц">
                  <input
                    name="price"
                    type="number"
                    min="0"
                    max="1000000"
                    defaultValue="0"
                  />
                </Field>
                <Field label="Количество мест">
                  <input
                    name="capacity"
                    type="number"
                    min="0"
                    max="1000"
                    defaultValue="12"
                  />
                </Field>
              </>
            ) : null}
            {kind === "subscription.upsert" ? (
              <>
                <Field label="Название">
                  <input
                    name="name"
                    required
                    maxLength={160}
                    placeholder="Футбол"
                  />
                </Field>
                <Field label="Период">
                  <input
                    name="period"
                    required
                    maxLength={80}
                    placeholder="8 занятий"
                  />
                </Field>
                <Field label="Баланс">
                  <input
                    name="balance"
                    type="number"
                    min="0"
                    defaultValue="0"
                  />
                </Field>
                <Field label="Осталось занятий">
                  <input
                    name="lessonsLeft"
                    type="number"
                    min="0"
                    defaultValue="0"
                  />
                </Field>
                <Field label="Продление">
                  <input name="renewalAt" type="date" />
                </Field>
              </>
            ) : null}
          </div>
          <footer>
            {kind === "lesson.upsert" && preset.lessonId ? (
              <button
                type="button"
                className="danger-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await submit("lesson.delete", {
                      lessonId: preset.lessonId,
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Удалить урок
              </button>
            ) : null}
            <span className="footer-spacer" />
            <button type="button" className="ghost-btn" onClick={close}>
              Отмена
            </button>
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy
                ? "Сохраняем…"
                : kind === "user.password.reset"
                  ? "Сбросить доступ"
                  : kind === "lesson.copy-day"
                    ? "Скопировать"
                    : kind === "lesson.upsert" && preset.lessonId
                      ? "Сохранить изменения"
                      : "Сохранить"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="gate-stage">
      <div className="loading-card">
        <Image src="/school-logo.svg" alt="" width={62} height={62} />
        <span className="loading-line" />
        <h1>Открываем школьный день</h1>
        <p>Собираем расписание, задания и сообщения.</p>
      </div>
    </div>
  );
}

function RegistrationGate({
  access,
  retry,
  activated,
}: {
  access: AccessState;
  retry: () => void;
  activated: () => void;
}) {
  const [mode, setMode] = useState<"invite" | "request">(
    access.invitation ? "invite" : "request",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signIn = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  if (access.code === "sign_in_required")
    return (
      <div className="gate-stage">
        <section className="access-card">
          <Image src="/school-logo.svg" alt="" width={68} height={68} />
          <span className="eyebrow">Школа 1–11</span>
          <h1>Войдите в дневник</h1>
          <p>
            Используйте номер телефона и пароль, созданный при первом входе.
          </p>
          <button className="primary-btn" onClick={signIn}>
            <Icon name="lock" size={18} />
            Войти безопасно
          </button>
          <small>
            Забытый пароль может безопасно сбросить владелец системы.
          </small>
        </section>
      </div>
    );
  if (access.code === "registration_pending")
    return (
      <div className="gate-stage">
        <section className="access-card pending-access">
          <span className="gate-icon">
            <Icon name="check" />
          </span>
          <span className="eyebrow">Заявка принята</span>
          <h1>Школа проверяет связь с ребёнком</h1>
          <p>{access.message}</p>
          <button className="primary-btn" onClick={retry}>
            Проверить статус
          </button>
          <small>
            После подтверждения кабинет откроется автоматически при следующем
            входе.
          </small>
        </section>
      </div>
    );
  if (access.code !== "registration_required")
    return (
      <div className="gate-stage">
        <section className="access-card">
          <Image src="/school-logo.svg" alt="" width={68} height={68} />
          <span className="eyebrow">Школа 1–11</span>
          <h1>Дневник временно недоступен</h1>
          <p>{access.message}</p>
          <button className="primary-btn" onClick={retry}>
            Попробовать снова
          </button>
        </section>
      </div>
    );

  const invitation = access.invitation;
  const claimInstantly = Boolean(invitation?.studentName);
  const submitRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    const inviteToken =
      new URLSearchParams(window.location.search).get("invite") ?? "";
    const action: ActionKind =
      mode === "invite"
        ? "family.registration.claim"
        : "family.registration.request";
    try {
      const registrationPreview =
        new URLSearchParams(window.location.search).get(
          "registration-preview",
        ) ?? "";
      const response = await fetch("/api/school", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          inviteToken,
          registrationPreview,
          ...values,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        status?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось отправить данные");
      if (payload.status === "active") activated();
      else retry();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось отправить данные",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate-stage registration-stage">
      <section className="registration-card">
        <aside>
          <Image src="/school-logo.svg" alt="" width={62} height={62} />
          <span className="eyebrow">Электронный дневник</span>
          <h1>Создайте кабинет семьи</h1>
          <p>
            Расписание, оценки, задания, меню, мероприятия и связь с учителем —
            только по вашему ребёнку.
          </p>
          <ul>
            <li>
              <Icon name="check" size={16} />
              Родитель добавляет ребёнка сам
            </li>
            <li>
              <Icon name="check" size={16} />
              Школа подтверждает спорные связи
            </li>
            <li>
              <Icon name="check" size={16} />
              Отдельный вход ребёнку создаёт родитель
            </li>
          </ul>
          <small>
            {access.email ? `Подтверждённый email: ${access.email}` : ""}
          </small>
        </aside>
        <div className="registration-form">
          <div className="registration-tabs">
            <button
              className={cn(mode === "invite" && "active")}
              onClick={() => setMode("invite")}
              type="button"
            >
              По приглашению
            </button>
            <button
              className={cn(mode === "request" && "active")}
              onClick={() => setMode("request")}
              type="button"
            >
              Без приглашения
            </button>
          </div>
          {mode === "invite" ? (
            invitation ? (
              <>
                <div className="invite-summary">
                  <Icon
                    name={
                      invitation.targetRole === "student" ? "user" : "users"
                    }
                  />
                  <div>
                    <strong>
                      {invitation.targetRole === "student"
                        ? "Личный вход ученика"
                        : claimInstantly
                          ? `Приглашение для семьи ${invitation.studentName}`
                          : `Приглашение в ${invitation.className} класс`}
                    </strong>
                    <span>
                      {claimInstantly
                        ? "Доступ откроется сразу после подтверждения"
                        : "Школа проверит данные ребёнка"}
                    </span>
                  </div>
                </div>
                <form onSubmit={submitRegistration}>
                  <input
                    type="hidden"
                    name="displayName"
                    value={access.displayName ?? "Родитель"}
                  />
                  {!claimInstantly ? (
                    <div className="registration-name-grid">
                      <Field label="Имя ребёнка">
                        <input
                          name="studentFirstName"
                          required
                          maxLength={80}
                        />
                      </Field>
                      <Field label="Фамилия ребёнка">
                        <input name="studentLastName" required maxLength={80} />
                      </Field>
                    </div>
                  ) : null}
                  {!claimInstantly ? (
                    <Field label="Класс">
                      <input
                        name="className"
                        required
                        defaultValue={invitation.className ?? ""}
                        maxLength={20}
                      />
                    </Field>
                  ) : null}
                  {invitation.targetRole === "parent" ? (
                    <Field label="Кем вы приходитесь ребёнку">
                      <select name="relation" defaultValue="mother">
                        <option value="mother">Мама</option>
                        <option value="father">Папа</option>
                        <option value="guardian">Опекун</option>
                        <option value="other">
                          Другой законный представитель
                        </option>
                      </select>
                    </Field>
                  ) : (
                    <input type="hidden" name="relation" value="self" />
                  )}
                  {error ? <p className="form-error">{error}</p> : null}
                  <button className="primary-btn" disabled={busy}>
                    {busy
                      ? "Проверяем…"
                      : claimInstantly
                        ? "Создать кабинет"
                        : "Отправить на проверку"}
                  </button>
                </form>
              </>
            ) : (
              <div className="missing-invite">
                <Icon name="info" />
                <h2>Приглашение не найдено</h2>
                <p>
                  Откройте персональную ссылку школы или выберите регистрацию
                  без приглашения.
                </p>
              </div>
            )
          ) : (
            <form onSubmit={submitRegistration}>
              <input
                type="hidden"
                name="displayName"
                value={access.displayName ?? "Родитель"}
              />
              <div className="registration-name-grid">
                <Field label="Имя ребёнка">
                  <input name="studentFirstName" required maxLength={80} />
                </Field>
                <Field label="Фамилия ребёнка">
                  <input name="studentLastName" required maxLength={80} />
                </Field>
              </div>
              <Field label="Класс">
                <input
                  name="className"
                  required
                  placeholder="Например, 5А"
                  maxLength={20}
                />
              </Field>
              <Field label="Кем вы приходитесь ребёнку">
                <select name="relation" defaultValue="mother">
                  <option value="mother">Мама</option>
                  <option value="father">Папа</option>
                  <option value="guardian">Опекун</option>
                  <option value="other">Другой законный представитель</option>
                </select>
              </Field>
              {error ? <p className="form-error">{error}</p> : null}
              <button className="primary-btn" disabled={busy}>
                {busy ? "Отправляем…" : "Отправить заявку"}
              </button>
              <small>
                До подтверждения школа не покажет оценки, сообщения или другие
                данные ребёнка.
              </small>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function InviteResultModal({
  result,
  close,
}: {
  result: InviteResult;
  close: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(result.inviteLink);
    setCopied(true);
  };
  return (
    <div className="modal-backdrop">
      <section
        className="action-modal invite-result"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <span className="eyebrow">Приглашение готово</span>
            <h2>Отправьте ссылку пользователю</h2>
          </div>
          <button onClick={close} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </header>
        <div className="invite-result-body">
          <span className="success-mark">
            <Icon name="check" />
          </span>
          <p>
            Ссылка одноразовая. По ней пользователь создаст новый пароль; после
            этого ссылка перестанет работать.
          </p>
          <label>
            <span>Одноразовая ссылка</span>
            <input value={result.inviteLink} readOnly />
          </label>
          <button className="primary-btn" onClick={() => void copy()}>
            <Icon name="clipboard" size={18} />
            {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
          </button>
          <small>Действует до {formatDateTime(result.expiresAt)}</small>
        </div>
      </section>
    </div>
  );
}

export default function SchoolApp() {
  const [snapshot, setSnapshot] = useState<SchoolSnapshot | null>(null);
  const [activeView, setActiveView] = useState<View>("home");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [generatedInvite, setGeneratedInvite] = useState<InviteResult | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(
    async (nextStudent = studentId) => {
      const requestId = ++requestSequence.current;
      const params = new URLSearchParams();
      if (nextStudent) params.set("student", nextStudent);
      const currentSearch =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const inviteToken = currentSearch?.get("invite") ?? null;
      if (inviteToken) params.set("invite", inviteToken);
      if (currentSearch?.get("registration-preview") === "1")
        params.set("registration-preview", "1");
      try {
        const response = await fetch(
          `/api/school${params.size ? `?${params}` : ""}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as SchoolSnapshot &
          AccessState & { error?: string };
        if (requestId !== requestSequence.current) return;
        if (!response.ok) {
          setAccess({
            code: payload.code ?? "error",
            message:
              payload.error ?? payload.message ?? "Не удалось открыть дневник",
            email: payload.email,
            displayName: payload.displayName,
            invitation: payload.invitation,
          });
          return;
        }
        setSnapshot(payload);
        setStudentId(payload.selectedStudent?.id ?? null);
        setAccess(null);
      } catch {
        if (requestId !== requestSequence.current) return;
        setAccess({
          code: "error",
          message:
            "Дневник временно недоступен. Проверьте соединение и попробуйте ещё раз.",
        });
      }
    },
    [studentId],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setActiveView(viewFromPath(window.location.pathname));
      void load(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handlePopState = () =>
      setActiveView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const navigate = useCallback((view: View) => {
    setActiveView(view);
    const path = viewPaths[view];
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
  }, []);
  const switchStudent = async (nextStudent: string) => {
    setStudentId(nextStudent);
    await load(nextStudent);
  };
  const submit = async (kind: ActionKind, values: Record<string, unknown>) => {
    const response = await fetch("/api/school", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: kind, ...values }),
    });
    const payload = (await response.json()) as {
      error?: string;
      inviteLink?: string;
      expiresAt?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить");
    setModal(null);
    if (payload.inviteLink && payload.expiresAt)
      setGeneratedInvite({
        inviteLink: payload.inviteLink,
        expiresAt: payload.expiresAt,
      });
    else
      setToast(
        kind === "family.registration.approve"
          ? "Семья подтверждена. Доступ уже активен."
          : "Сохранено. Изменение уже видно нужной роли.",
      );
    await load(studentId);
  };
  const send = async (threadId: string, body: string) => {
    try {
      await submit("message.send", { threadId, body });
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Не удалось отправить сообщение",
      );
      throw error;
    }
  };
  const viewThread = useCallback(async (threadId: string) => {
    await fetch("/api/school", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "thread.view", threadId }),
    });
  }, []);
  const openAction = (kind: ActionKind, preset?: Record<string, string>) =>
    setModal({ kind, preset });

  if (!snapshot && !access) return <LoadingScreen />;
  if (access)
    return (
      <RegistrationGate
        access={access}
        retry={() => void load()}
        activated={() => void load(null)}
      />
    );
  if (!snapshot) return null;
  const allowedViews = new Set<View>(
    navigationByRole[snapshot.viewer.role].map((item) => item.id),
  );
  const hasAccess = activeView === "profile" || allowedViews.has(activeView);
  const routedContent =
    activeView === "home" ? (
      <Dashboard
        snapshot={snapshot}
        openAction={openAction}
        onView={navigate}
      />
    ) : activeView === "calendar" ? (
      <CalendarPage snapshot={snapshot} openAction={openAction} />
    ) : activeView === "schedule" ? (
      <StudyPage
        key="schedule"
        snapshot={snapshot}
        openAction={openAction}
        initialTab="schedule"
      />
    ) : activeView === "journal" ? (
      <StudyPage
        key="journal"
        snapshot={snapshot}
        openAction={openAction}
        initialTab="grades"
      />
    ) : activeView === "homework" ? (
      <StudyPage
        key="homework"
        snapshot={snapshot}
        openAction={openAction}
        initialTab="homework"
      />
    ) : activeView === "programs" ? (
      <ProgramsPage snapshot={snapshot} openAction={openAction} />
    ) : activeView === "people" ? (
      <PeoplePage
        snapshot={snapshot}
        openAction={openAction}
        onView={navigate}
      />
    ) : activeView === "school" ? (
      <SchoolPage snapshot={snapshot} openAction={openAction} />
    ) : activeView === "messages" ? (
      <MessagesPage snapshot={snapshot} send={send} viewThread={viewThread} />
    ) : activeView === "management" ? (
      <ManagementPage snapshot={snapshot} openAction={openAction} />
    ) : (
      <ProfilePage snapshot={snapshot} />
    );
  const content = hasAccess ? (
    routedContent
  ) : (
    <AccessDeniedPage onHome={() => navigate("home")} />
  );

  return (
    <>
      <AppShell
        snapshot={snapshot}
        activeView={activeView}
        onView={navigate}
        onStudent={(nextStudent) => void switchStudent(nextStudent)}
      >
        {content}
      </AppShell>
      {modal ? (
        <ActionModal
          state={modal}
          snapshot={snapshot}
          close={() => setModal(null)}
          submit={async (kind, values) => {
            try {
              await submit(kind, values);
            } catch (error) {
              setToast(
                error instanceof Error ? error.message : "Не удалось сохранить",
              );
              throw error;
            }
          }}
        />
      ) : null}
      {generatedInvite ? (
        <InviteResultModal
          result={generatedInvite}
          close={() => setGeneratedInvite(null)}
        />
      ) : null}
      {toast ? (
        <div className="l0-toast">
          <Icon name="check" size={17} />
          {toast}
        </div>
      ) : null}
    </>
  );
}
