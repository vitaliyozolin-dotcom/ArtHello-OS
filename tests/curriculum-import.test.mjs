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

test("XLSX parser skips section headings and aggregate footers inside the lesson table", async () => {
  const buffer = await makeWorkbook([
    ["", "Раздел 1. Числа", "", ""],
    [1, "Сложение", 1, "№ 1–3"],
    [2, "Вычитание", 2, "№ 4–6"],
    ["", "Итого за раздел", 3, ""],
    ["", "Всего часов", 170, ""],
  ]);
  const result = await parseCurriculumWorkbook(buffer);
  assert.equal(result.totalHours, 3);
  assert.deepEqual(
    result.rows.map(({ topic, hours }) => ({ topic, hours })),
    [
      { topic: "Сложение", hours: 1 },
      { topic: "Вычитание", hours: 2 },
    ],
  );
});

test("XLSX parser still rejects a numbered lesson without hours", async () => {
  const buffer = await makeWorkbook([[1, "Сложение", "", ""]]);
  await assert.rejects(
    () => parseCurriculumWorkbook(buffer),
    /количество часов должно быть целым числом/,
  );
});

test("XLSX parser rejects an ambiguous topic-only row when optional columns are absent", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("КТП");
  sheet.addRow(["Тема урока", "Количество часов"]);
  sheet.addRow(["Сложение", ""]);
  await assert.rejects(
    () => parseCurriculumWorkbook(workbook.xlsx.writeBuffer()),
    /количество часов должно быть целым числом/,
  );
});

test("XLSX parser accepts explicit sections without optional columns", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("КТП");
  sheet.addRow(["Тема урока", "Количество часов"]);
  sheet.addRow(["Раздел 1. Числа", ""]);
  sheet.addRow(["Сложение", 1]);
  sheet.addRow(["Итого", 1]);
  const result = await parseCurriculumWorkbook(
    await workbook.xlsx.writeBuffer(),
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].topic, "Сложение");
});

test("XLSX parser rejects signed and arbitrary hour values", async () => {
  for (const hours of ["-1", "+1", "1-2", "часов: 2"]) {
    const buffer = await makeWorkbook([[1, "Сложение", hours, ""]]);
    await assert.rejects(
      () => parseCurriculumWorkbook(buffer),
      /количество часов должно быть целым числом/,
    );
  }
});

test("a four-day timetable gives 136 math slots after the 2026/27 vacations", () => {
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

test("the received five-day timetable gives 171 second-grade math slots", () => {
  const lessons = [1, 2, 3, 4, 5].map((weekday) => ({
    id: `math-${weekday}`,
    weekday,
    startsAt: "08:30",
  }));
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
  assert.equal(slots.length, 171);

  const rows = Array.from({ length: 170 }, (_, index) => ({
    sourceRow: index + 2,
    sequence: String(index + 1),
    topic: `Тема ${index + 1}`,
    hours: 1,
    homework: "",
    sourceDate: null,
  }));
  const result = allocateCurriculumRows(rows, slots);
  assert.equal(result.scheduledHours, 170);
  assert.equal(result.unscheduledHours, 0);
  assert.equal(result.status, "reserve");
  assert.equal(slots.length - result.scheduledHours, 1);
});

test("a 170-hour program remains complete and explicit when only 136 slots exist", () => {
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
