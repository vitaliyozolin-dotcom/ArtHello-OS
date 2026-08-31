import ExcelJS from "exceljs";

const MAX_ROWS = 600;
const MAX_HOURS_PER_ROW = 20;

const normalize = (value) =>
  String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/№/g, " номер ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");

const isTopicHeader = (value) =>
  value === "тема" ||
  value.includes("тема урок") ||
  value.includes("наименование темы") ||
  value.includes("содержание урок");

const isHoursHeader = (value) =>
  value === "часы" ||
  value === "часов" ||
  value.includes("кол во часов") ||
  value.includes("количество часов") ||
  value.includes("число часов");

const isHomeworkHeader = (value) =>
  value === "дз" ||
  value.includes("домашнее задание") ||
  value.includes("задание на дом");

const isSequenceHeader = (value) =>
  value === "номер" ||
  value.includes("номер п п") ||
  value.includes("порядковый номер");

const isDateHeader = (value) =>
  value === "дата" ||
  value.includes("дата урока") ||
  value.includes("планируемая дата") ||
  value.includes("плановая дата");

const cellText = (cell) => {
  if (!cell) return "";
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  return String(cell.text ?? "").trim();
};

const parseHours = (value, sourceRow) => {
  const text = String(value ?? "").trim().replace(",", ".");
  const match = text.match(/\d+(?:\.\d+)?/);
  const hours = match ? Number(match[0]) : Number.NaN;
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS_PER_ROW) {
    throw new Error(
      `Строка ${sourceRow}: количество часов должно быть целым числом от 1 до ${MAX_HOURS_PER_ROW}`,
    );
  }
  return hours;
};

const isAggregateRow = (worksheet, row, topic) => {
  const values = [];
  for (
    let index = 1;
    index <= Math.max(worksheet.actualColumnCount, row.cellCount);
    index += 1
  ) {
    const value = normalize(cellText(row.getCell(index)));
    if (value) values.push(value);
  }
  return [normalize(topic), ...values].some(
    (value) => /^(итого|всего)(\s|$)/.test(value) || value.includes("всего часов"),
  );
};

const columnMapForRow = (worksheet, rowNumber) => {
  const row = worksheet.getRow(rowNumber);
  const columns = {};
  for (let index = 1; index <= Math.max(worksheet.actualColumnCount, row.cellCount); index += 1) {
    const header = normalize(cellText(row.getCell(index)));
    if (!header) continue;
    if (!columns.topic && isTopicHeader(header)) columns.topic = index;
    else if (!columns.hours && isHoursHeader(header)) columns.hours = index;
    else if (!columns.homework && isHomeworkHeader(header)) columns.homework = index;
    else if (!columns.sequence && isSequenceHeader(header)) columns.sequence = index;
    else if (!columns.date && isDateHeader(header)) columns.date = index;
  }
  return columns;
};

const findHeader = (worksheet) => {
  const limit = Math.min(25, worksheet.rowCount);
  let best = null;
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const columns = columnMapForRow(worksheet, rowNumber);
    const score =
      (columns.topic ? 5 : 0) +
      (columns.hours ? 4 : 0) +
      (columns.homework ? 1 : 0) +
      (columns.sequence ? 1 : 0) +
      (columns.date ? 1 : 0);
    if (!best || score > best.score) best = { rowNumber, columns, score };
  }
  if (!best?.columns.topic) {
    throw new Error('В XLSX не найдена колонка «Тема»');
  }
  if (!best.columns.hours) {
    throw new Error('В XLSX не найдена колонка «Количество часов»');
  }
  return best;
};

export async function parseCurriculumWorkbook(input) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);
  const populatedWorksheets = workbook.worksheets.filter(
    (sheet) => sheet.actualRowCount > 0,
  );
  if (!populatedWorksheets.length)
    throw new Error("В XLSX нет заполненных листов");

  let selected = null;
  let firstHeaderError = null;
  for (const worksheet of populatedWorksheets) {
    try {
      const header = findHeader(worksheet);
      if (!selected || header.score > selected.header.score) {
        selected = { worksheet, header };
      }
    } catch (error) {
      firstHeaderError ??= error;
    }
  }
  if (!selected) throw firstHeaderError ?? new Error("В XLSX не найдены темы уроков");

  const { worksheet, header } = selected;
  const { rowNumber: headerRow, columns } = header;
  const rows = [];
  for (let sourceRow = headerRow + 1; sourceRow <= worksheet.rowCount; sourceRow += 1) {
    const row = worksheet.getRow(sourceRow);
    const topic = cellText(row.getCell(columns.topic));
    const hoursText = cellText(row.getCell(columns.hours));
    const homework = columns.homework ? cellText(row.getCell(columns.homework)) : "";
    const sequence = columns.sequence ? cellText(row.getCell(columns.sequence)) : "";
    const sourceDate = columns.date ? cellText(row.getCell(columns.date)) : "";
    if (!topic && !hoursText && !homework && !sequence && !sourceDate) continue;
    if (isAggregateRow(worksheet, row, topic)) continue;
    const isSectionHeading =
      Boolean(topic) &&
      !hoursText &&
      !homework &&
      !sequence &&
      !sourceDate;
    if (isSectionHeading) continue;
    if (!topic) throw new Error(`Строка ${sourceRow}: тема урока не заполнена`);
    const hours = parseHours(hoursText, sourceRow);
    rows.push({
      sourceRow,
      sequence: sequence || String(rows.length + 1),
      topic,
      hours,
      homework,
      sourceDate: sourceDate || null,
    });
    if (rows.length > MAX_ROWS) {
      throw new Error(`В одном КТП допускается не более ${MAX_ROWS} строк`);
    }
  }
  if (!rows.length) throw new Error("После строки заголовков в XLSX нет тем уроков");

  return {
    sheetName: worksheet.name,
    headerRow,
    rows,
    totalHours: rows.reduce((sum, row) => sum + row.hours, 0),
    detectedColumns: {
      topic: columns.topic,
      hours: columns.hours,
      homework: columns.homework ?? null,
      sequence: columns.sequence ?? null,
      date: columns.date ?? null,
    },
  };
}

const isoDate = (date) => date.toISOString().slice(0, 10);

const parseIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Некорректная дата: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new Error(`Некорректная дата: ${value}`);
  }
  return date;
};

const inPeriod = (date, periods) =>
  periods.some((period) => date >= period.startsOn && date <= period.endsOn);

/**
 * @param {{
 *   startDate: string;
 *   endDate: string;
 *   lessons: Array<{ id: string; weekday: number; startsAt: string }>;
 *   periods?: Array<{ startsOn: string; endsOn: string }>;
 * }} input
 */
export function buildScheduleSlots({
  startDate,
  endDate,
  lessons,
  periods = [],
}) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (end < start) throw new Error("Конец учебного года раньше его начала");
  const normalizedPeriods = periods.map((period) => ({
    ...period,
    startsOn: parseIsoDate(period.startsOn),
    endsOn: parseIsoDate(period.endsOn),
  }));
  const byWeekday = new Map();
  for (const lesson of lessons) {
    if (!Number.isInteger(lesson.weekday) || lesson.weekday < 1 || lesson.weekday > 6) continue;
    const bucket = byWeekday.get(lesson.weekday) ?? [];
    bucket.push(lesson);
    bucket.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    byWeekday.set(lesson.weekday, bucket);
  }

  const slots = [];
  for (let date = start; date <= end; date = new Date(date.getTime() + 86_400_000)) {
    const weekday = date.getUTCDay();
    if (weekday === 0 || inPeriod(date, normalizedPeriods)) continue;
    for (const lesson of byWeekday.get(weekday) ?? []) {
      slots.push({
        date: isoDate(date),
        weekday,
        templateLessonId: lesson.id,
        startsAt: lesson.startsAt,
      });
    }
  }
  return slots;
}

/**
 * @param {Array<{ sourceRow: number; sequence: string; topic: string; hours: number; homework: string; sourceDate: string | null }>} rows
 * @param {Array<{ date: string; weekday: number; templateLessonId: string; startsAt: string }>} slots
 */
export function allocateCurriculumRows(rows, slots) {
  let slotIndex = 0;
  const topics = rows.map((row, topicIndex) => {
    const sessions = [];
    for (let sessionIndex = 0; sessionIndex < row.hours; sessionIndex += 1) {
      const slot = slots[slotIndex] ?? null;
      if (slot) slotIndex += 1;
      sessions.push({
        sessionIndex: sessionIndex + 1,
        scheduledDate: slot?.date ?? null,
        templateLessonId: slot?.templateLessonId ?? null,
        startsAt: slot?.startsAt ?? null,
        status: slot ? "scheduled" : "unscheduled",
      });
    }
    return { ...row, sortOrder: topicIndex + 1, sessions };
  });
  const requiredHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const scheduledHours = Math.min(requiredHours, slots.length);
  return {
    topics,
    requiredHours,
    availableSlots: slots.length,
    scheduledHours,
    unscheduledHours: Math.max(0, requiredHours - slots.length),
    unusedSlots: Math.max(0, slots.length - requiredHours),
    status:
      requiredHours === slots.length
        ? "balanced"
        : requiredHours > slots.length
          ? "deficit"
          : "reserve",
  };
}
