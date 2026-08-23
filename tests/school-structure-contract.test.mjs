import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  assert.match(apiSource, /teacher_user_id = \? AND class_name = \? AND subject_id = \? AND status = 'confirmed'/);
  assert.match(apiSource, /teacherOnlyAction && effectiveRole !== "teacher"/);
});

test("operating modules use persistent schema and audited actions", () => {
  for (const table of ["programs", "attendance", "notifications", "gradeRevisions", "menuRatings", "consents"]) {
    assert.match(schemaSource, new RegExp(`export const ${table}`));
  }
  for (const action of ["program.upsert", "attendance.mark", "thread.view", "notification.read", "menu.rate"]) {
    assert.equal(apiSource.includes(`action === "${action}"`), true);
  }
  assert.match(apiSource, /templateRecords: false/);
  assert.doesNotMatch(apiSource, /ensureSeedData/);
});

test("setup readiness is separated from daily workspaces", () => {
  assert.match(appSource, /function ManagementPage/);
  assert.match(appSource, /Данные и готовность/);
  assert.doesNotMatch(appSource, /Контур запуска|Готовность уровня 0/);
});
