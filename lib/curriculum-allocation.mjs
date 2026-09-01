const isoDate = (date) => date.toISOString().slice(0, 10);

const parseIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Некорректная дата: ${value}`);
  }
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
    if (
      !Number.isInteger(lesson.weekday) ||
      lesson.weekday < 1 ||
      lesson.weekday > 6
    ) {
      continue;
    }
    const bucket = byWeekday.get(lesson.weekday) ?? [];
    bucket.push(lesson);
    bucket.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    byWeekday.set(lesson.weekday, bucket);
  }

  const slots = [];
  for (
    let date = start;
    date <= end;
    date = new Date(date.getTime() + 86_400_000)
  ) {
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
