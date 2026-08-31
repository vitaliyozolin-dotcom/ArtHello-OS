import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import {
  attachScheduleTeachers,
  parseSchoolScheduleXlsx,
  validateNormalizedSchedule,
} from "../lib/schedule-import.mjs";

function addScheduleSheet(workbook, className, rows) {
  const sheet = workbook.addWorksheet(`${className} класс`);
  sheet.addRow([`Расписание — ${className} класс`]);
  sheet.addRow([]);
  sheet.addRow(["Урок", "Время", "Пн", "Вт", "Ср", "Чт", "Пт"]);
  for (const row of rows) sheet.addRow(row);
  return sheet;
}

test("schedule parser keeps five weekly math lessons and ignores lunch", async () => {
  const workbook = new ExcelJS.Workbook();
  addScheduleSheet(workbook, "2", [
    [1, "09:00–09:40", "Математика", "Математика", "Математика", "Математика", "Математика"],
    ["", "12.30-13.10", "Обед+прогулка", "Обед+прогулка", "Обед+прогулка", "Обед+прогулка", "Обед+прогулка"],
  ]);
  const lessons = await parseSchoolScheduleXlsx(await workbook.xlsx.writeBuffer());
  assert.equal(lessons.length, 5);
  assert.deepEqual(lessons.map((lesson) => lesson.weekday), [1, 2, 3, 4, 5]);
  assert.ok(lessons.every((lesson) => lesson.subjectId === "math"));
});

test("parallel English and math groups remain separate lessons", async () => {
  const workbook = new ExcelJS.Workbook();
  addScheduleSheet(workbook, "1", [
    [1, "09:00–09:40", "Гр.1 Английский /Гр.2 Математика", "", "", "", ""],
  ]);
  const lessons = await parseSchoolScheduleXlsx(await workbook.xlsx.writeBuffer());
  const summary = validateNormalizedSchedule(lessons);
  assert.equal(summary.lessonCount, 2);
  assert.deepEqual(lessons.map((lesson) => lesson.groupName), ["Группа 1", "Группа 2"]);
  assert.deepEqual(lessons.map((lesson) => lesson.subjectId), ["english", "math"]);
});

test("joint lessons across classes share one teacher session", () => {
  const lessons = [
    { id: "2-pe", className: "2", subjectId: "pe", weekday: 3, startsAt: "10:50", endsAt: "11:30", note: "" },
    { id: "3-pe", className: "3", subjectId: "pe", weekday: 3, startsAt: "10:50", endsAt: "11:30", note: "" },
  ];
  const assignments = [
    { teacher_user_id: "teacher-pe", class_name: "2", subject_id: "pe", status: "confirmed" },
    { teacher_user_id: "teacher-pe", class_name: "3", subject_id: "pe", status: "confirmed" },
  ];
  const users = [
    { id: "teacher-pe", role: "teacher", profile_status: "confirmed" },
  ];
  const result = attachScheduleTeachers(lessons, assignments, users);
  assert.ok(result[0].sharedSessionKey);
  assert.equal(result[0].sharedSessionKey, result[1].sharedSessionKey);
  assert.match(result[0].note, /Совместно: 2, 3 классы/);
});

test("unknown schedule labels stop import instead of guessing", async () => {
  const workbook = new ExcelJS.Workbook();
  addScheduleSheet(workbook, "4", [
    [1, "09:00–09:40", "Неизвестный предмет", "", "", "", ""],
  ]);
  await assert.rejects(
    () => parseSchoolScheduleXlsx(workbook.xlsx.writeBuffer()),
    /Неизвестный предмет/,
  );
});

test("approved 2026/27 source contains all classes and five second-grade math slots", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../data/schedules/school-1-11-2026-2027.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(source.summary.lessonCount, 189);
  assert.deepEqual(source.summary.classCounts, {
    1: 41,
    2: 28,
    3: 29,
    4: 29,
    5: 31,
    6: 31,
  });
  assert.deepEqual(
    source.lessons
      .filter((lesson) => lesson.className === "2" && lesson.subjectId === "math")
      .map((lesson) => lesson.weekday),
    [1, 2, 3, 4, 5],
  );
  assert.equal(source.specialArrangements[0].studentLabel, "Расим");
  assert.equal(source.specialArrangements[0].status, "pending_student_match");
});

