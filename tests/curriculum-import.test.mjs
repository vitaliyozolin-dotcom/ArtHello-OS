import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  allocateCurriculumRows,
  buildScheduleSlots,
  parseCurriculumWorkbook,
} from "../lib/curriculum-import.mjs";

const makeWorkbook = async (rows) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("КТП");
  sheet.addRow(["Календарно-тематическое планирование"]);
  sheet.addRow([]);
  sheet.addRow(["№ п/п", "Тема урока", "Кол-во часов", "Домашнее задание"]);
  for (const row of rows) sheet.addRow(row);
  return workbook.xlsx.writeBuffer();
};

test("XLSX parser finds a shifted header and preserves topics, hours and homework", async () => {
  const buffer = await makeWorkbook([
    [1, "Сложение", 1, "№ 1–3"],
    [2, "Вычитание", "2 ч.", ""],
  ]);
  const result = await parseCurriculumWorkbook(buffer);
  assert.equal(result.sheetName, "КТП");
  assert.equal(result.headerRow, 3);
  assert.equal(result.totalHours, 3);
  assert.deepEqual(result.rows.map(({ topic, hours, homework }) => ({ topic, hours, homework })), [
    { topic: "Сложение", hours: 1, homework: "№ 1–3" },
    { topic: "Вычитание", hours: 2, homework: "" },
  ]);
});

test("XLSX parser rejects a workbook without required columns", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Лист1").addRow(["Название", "Комментарий"]);
  await assert.rejects(
    () => parseCurriculumWorkbook(workbook.xlsx.writeBuffer()),
    /колонка «Тема»/,
  );
});

test("XLSX parser skips a cover sheet and finds the curriculum sheet", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Титульный лист").addRow([
    "Рабочая программа по математике",
  ]);
  const curriculum = workbook.addWorksheet("КТП");
  curriculum.addRow(["№ п/п", "Тема урока", "Количество часов"]);
  curriculum.addRow([1, "Повторение", 1]);

  const result = await parseCurriculumWorkbook(
    await workbook.xlsx.writeBuffer(),
  );
  assert.equal(result.sheetName, "КТП");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].topic, "Повторение");
});

test("2026/27 calendar gives 136 math slots for Monday, Tuesday, Thursday and Friday", () => {
  const lessons = [
    { id: "math-mon", weekday: 1, startsAt: "08:30" },
    { id: "math-tue", weekday: 2, startsAt: "08:30" },
    { id: "math-thu", weekday: 4, startsAt: "08:30" },
    { id: "math-fri", weekday: 5, startsAt: "08:30" },
  ];
  const periods = [
    { startsOn: "2026-10-26", endsOn: "2026-11-03" },
    { startsOn: "2026-12-31", endsOn: "2027-01-10" },
    { startsOn: "2027-02-15", endsOn: "2027-02-21" },
    { startsOn: "2027-03-27", endsOn: "2027-04-04" },
  ];
  const slots = buildScheduleSlots({
    startDate: "2026-09-01",
    endDate: "2027-05-31",
    lessons,
    periods,
  });
  assert.equal(slots.length, 136);
  assert.equal(slots.some((slot) => slot.date === "2026-10-26"), false);
  assert.equal(slots.some((slot) => slot.date === "2027-02-19"), false);
});

test("170 imported hours are kept, with 136 dated and 34 explicitly unscheduled", () => {
  const rows = Array.from({ length: 170 }, (_, index) => ({
    sourceRow: index + 2,
    sequence: String(index + 1),
    topic: `Тема ${index + 1}`,
    hours: 1,
    homework: "",
    sourceDate: null,
  }));
  const slots = Array.from({ length: 136 }, (_, index) => ({
    date: `2026-09-${String(index % 30 + 1).padStart(2, "0")}`,
    weekday: 1,
    templateLessonId: "math",
    startsAt: "08:30",
  }));
  const result = allocateCurriculumRows(rows, slots);
  assert.equal(result.requiredHours, 170);
  assert.equal(result.scheduledHours, 136);
  assert.equal(result.unscheduledHours, 34);
  assert.equal(result.status, "deficit");
  assert.equal(result.topics.length, 170);
  assert.equal(result.topics[169].sessions[0].status, "unscheduled");
});
