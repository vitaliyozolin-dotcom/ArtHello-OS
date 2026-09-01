import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  prepareProgramSessionHomework,
  programSessionHomeworkId,
} from "../lib/program-homework.mjs";

const apiSource = await readFile(new URL("../app/api/school/route.ts", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app/school-app.tsx", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

test("school structure contains classes 1 through 6 and the supplied staff", () => {
  for (const className of ["1", "2", "3", "4", "5", "6"]) {
    assert.match(apiSource, new RegExp(`name: "${className}"`));
  }
  for (const teacher of [
    "Иванова Анастасия Андреевна",
    "Насырова Надежда Юрьевна",
    "Чуковская Анна Николаевна",
    "Соткина Ксения Болеславовна",
    "Озолина Алина Владиславовна",
    "Ротцы Анна Максимовна",
    "Комова Наталья Юрьевна",
    "Федоров Павел Олегович",
  ]) assert.match(apiSource, new RegExp(teacher));
});

test("uncertain staff records remain explicitly uncertain", () => {
  assert.match(apiSource, /Алексюнина Анастасия Витальевна[\s\S]*?profileStatus: "unconfirmed"/);
  assert.match(apiSource, /Куратор №2[\s\S]*?profileStatus: "vacant"/);
  assert.match(apiSource, /Педагог английского 1–4[\s\S]*?profileStatus: "vacant"/);
  assert.match(apiSource, /Дмитриевна Наталья Витальевна[\s\S]*?profileStatus: "needs_confirmation"/);
});

test("manual scheduling supports edit, delete, copy and conflict checks", () => {
  assert.match(schemaSource, /schoolClasses/);
  assert.match(schemaSource, /teacherAssignments/);
  assert.match(apiSource, /assertNoScheduleConflict/);
  assert.match(apiSource, /action === "lesson\.delete"/);
  assert.match(apiSource, /action === "lesson\.copy-day"/);
  assert.match(appSource, /Скопировать день/);
  assert.match(appSource, /snapshot\.classes\.map/);
  assert.match(appSource, /Сохранить изменения/);
});

test("role access is fixed by the authenticated account and cannot be impersonated", () => {
  for (const role of [
    "director",
    "deputy",
    "methodist",
    "admin",
    "teacher",
    "parent",
    "student",
    "tech_admin",
  ]) {
    assert.match(schemaSource, new RegExp(`"${role}"`));
  }
  assert.match(apiSource, /availableRoles: \[viewer\.role\]/);
  assert.match(appSource, /navigationByRole/);
  assert.match(appSource, /const hasAccess = activeView === "profile" \|\| allowedViews\.has\(activeView\)/);
  assert.match(appSource, /onClick=\{\(\) => onView\("profile"\)\}/);
  assert.doesNotMatch(apiSource, /asRole/);
  assert.doesNotMatch(appSource, /Проверить роль|Демонстрационный режим|TemplateBanner/);
});

test("teacher writes are restricted to confirmed class and subject assignments", () => {
  assert.match(apiSource, /async function assertTeacherScope/);
  assert.match(apiSource, /async function assertTeacherClassScope/);
  assert.match(apiSource, /async function assertConfirmedTeacherAssignment/);
  assert.match(apiSource, /teacher_user_id = \? AND class_name = \? AND subject_id = \? AND status = 'confirmed'/);
  assert.match(apiSource, /teacherOnlyAction && effectiveRole !== "teacher"/);
});

test("operating modules use persistent schema and audited actions", () => {
  for (const table of ["programs", "programImports", "programTopics", "programTopicSessions", "academicCalendarPeriods", "attendance", "notifications", "gradeRevisions", "menuRatings", "consents"]) {
    assert.match(schemaSource, new RegExp(`export const ${table}`));
  }
  for (const action of ["program.upsert", "program.import", "program.topic.update", "attendance.mark", "thread.view", "notification.read", "menu.rate"]) {
    assert.equal(apiSource.includes(`action === "${action}"`), true);
  }
  assert.match(apiSource, /templateRecords: false/);
  assert.doesNotMatch(apiSource, /ensureSeedData/);
});

test("KTP import is role-scoped, calendar-aware and blocks false approval", () => {
  assert.match(apiSource, /parseCurriculumWorkbook/);
  assert.match(apiSource, /calculateCurriculumAllocation/);
  assert.match(
    apiSource,
    /async function calculateCurriculumAllocation\(\s*className: string,\s*subjectId: string,\s*teacherUserId: string,/,
  );
  assert.match(
    apiSource,
    /WHERE class_name = \? AND subject_id = \? AND teacher_user_id = \?[\s\S]*?\.bind\(className, subjectId, teacherUserId\)/,
  );
  assert.match(apiSource, /ACADEMIC_CALENDAR_PERIODS/);
  assert.match(apiSource, /Утверждённую программу возвращает в работу завуч или директор/);
  assert.match(apiSource, /Нельзя утвердить программу/);
  const topicSnapshotQuery = apiSource.slice(
    apiSource.indexOf("const programTopics ="),
    apiSource.indexOf("const academicCalendarPeriods ="),
  );
  assert.doesNotMatch(topicSnapshotQuery, /LIMIT\s+\d+/i);
  assert.match(appSource, /Импортировать XLSX/);
  assert.match(appSource, /Программа не помещается в расписание/);
  assert.match(appSource, /Даты не сдвигаются автоматически/);
  assert.match(appSource, /Изменить тему и домашнее задание/);
  assert.doesNotMatch(appSource, /Пересчитать даты/);
});

test("KTP status transitions follow review, approval and activation stages", () => {
  for (const source of [apiSource, appSource]) {
    assert.match(source, /draft: \["draft", "review"\]/);
    assert.match(source, /review: \["review", "changes_requested", "approved"\]/);
    assert.match(source, /changes_requested: \["changes_requested", "review"\]/);
    assert.match(source, /approved: \["approved", "active", "archived", "changes_requested"\]/);
    assert.match(source, /active: \["active", "archived", "changes_requested"\]/);
    assert.match(source, /archived: \["archived"\]/);
  }
  assert.match(apiSource, /if \(!currentStatus\) return \["draft"\]/);
  assert.match(apiSource, /requestedStatus === "changes_requested" && !requestedReviewComment/);
  assert.match(appSource, /programStatusOptions\.map\(\(status\) => <option/);
});

test("manual lesson homework is safely published once into the family diary", () => {
  assert.equal(
    programSessionHomeworkId("session-1"),
    "program-session-homework:session-1",
  );
  assert.deepEqual(
    prepareProgramSessionHomework({
      sessionId: "session-1",
      homework: "  № 1–3  ",
      dueAt: "2026-09-02T09:00",
      lessonStartsAt: "2026-09-01T09:00",
    }),
    {
      id: "program-session-homework:session-1",
      description: "№ 1–3",
      dueAt: "2026-09-02T09:00",
      published: true,
    },
  );
  assert.deepEqual(
    prepareProgramSessionHomework({
      sessionId: "session-1",
      homework: "",
      dueAt: "",
      lessonStartsAt: "",
    }),
    {
      id: "program-session-homework:session-1",
      description: "",
      dueAt: null,
      published: false,
    },
  );
  assert.throws(
    () => prepareProgramSessionHomework({
      sessionId: "session-1",
      homework: "№ 1–3",
      dueAt: "",
      lessonStartsAt: "2026-09-01T09:00",
    }),
    /Укажите корректный срок/,
  );
  assert.throws(
    () => prepareProgramSessionHomework({
      sessionId: "session-1",
      homework: "№ 1–3",
      dueAt: "2026-09-01T09:00",
      lessonStartsAt: "2026-09-01T09:00",
    }),
    /должен быть позже начала урока/,
  );

  const topicSnapshot = apiSource.slice(
    apiSource.indexOf("const programTopics ="),
    apiSource.indexOf("const academicCalendarPeriods ="),
  );
  assert.match(topicSnapshot, /COALESCE\(ps\.homework_override, ''\) AS homework/);
  assert.match(topicSnapshot, /AS homeworkDueAt/);
  assert.doesNotMatch(topicSnapshot, /pt\.homework\) AS homework/);

  const manualUpdate = apiSource.slice(
    apiSource.indexOf('action === "program.topic.update"'),
    apiSource.indexOf('action === "program.upsert"'),
  );
  assert.match(manualUpdate, /session\.teacherUserId !== actor\.id/);
  assert.match(manualUpdate, /assertCurriculumClassScope/);
  assert.match(manualUpdate, /actor\.role !== "teacher"/);
  assert.match(manualUpdate, /Домашнее задание и срок публикует только назначенный учитель/);
  assert.match(manualUpdate, /\["draft", "changes_requested", "active"\]/);
  assert.match(manualUpdate, /\["draft", "review", "changes_requested"\]/);
  assert.match(manualUpdate, /session\.programStatus !== "active"/);
  assert.match(manualUpdate, /!session\.scheduledDate \|\| !session\.startsAt/);
  assert.match(manualUpdate, /lessonStartsAt: session\.scheduledDate && session\.startsAt/);
  assert.match(manualUpdate, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(manualUpdate, /title = excluded\.title/);
  assert.match(manualUpdate, /await db\.batch\(\[/);
  assert.match(manualUpdate, /SET topic_override = \?, homework_override = \?/);
  assert.doesNotMatch(manualUpdate, /completed|провед[её]н/i);

  assert.match(apiSource, /Повторный импорт заблокирован:[\s\S]*?ручные темы или домашние задания/);
  assert.match(appSource, /name="homeworkDueAt" type="datetime-local"/);
  assert.match(appSource, /Сохранить и опубликовать/);
  assert.doesNotMatch(manualUpdate, /next_ps|следующ/i);
});

test("setup readiness is separated from daily workspaces", () => {
  assert.match(appSource, /function ManagementPage/);
  assert.match(appSource, /Данные и готовность/);
  assert.doesNotMatch(appSource, /Контур запуска|Готовность уровня 0/);
});
