export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateAcademicYear(input) {
  const id = String(input.id ?? "").trim();
  if (!/^\d{4}\/\d{2}$/.test(id)) throw new Error("Учебный год укажите в формате 2026/27");
  if (!validDate(input.startsOn) || !validDate(input.endsOn) || input.endsOn <= input.startsOn)
    throw new Error("Проверьте начало и окончание учебного года");
  const year = Number(id.slice(0, 4));
  if (Number(id.slice(-2)) !== (year + 1) % 100 || !input.startsOn.startsWith(String(year)) || !input.endsOn.startsWith(String(year + 1)))
    throw new Error("Даты должны соответствовать выбранному учебному году");
  if (!Array.isArray(input.periods) || input.periods.length > 40) throw new Error("Проверьте неучебные периоды");
  const periods = input.periods.map((p) => {
    const title = String(p.title ?? "").trim();
    if (!title || title.length > 120 || !validDate(p.startsOn) || !validDate(p.endsOn) || p.endsOn < p.startsOn || p.startsOn < input.startsOn || p.endsOn > input.endsOn)
      throw new Error("Проверьте название и даты неучебного периода");
    return { title, startsOn: p.startsOn, endsOn: p.endsOn };
  });
  periods.sort((a,b) => a.startsOn.localeCompare(b.startsOn));
  if (periods.some((p,i) => i > 0 && p.startsOn <= periods[i-1].endsOn)) throw new Error("Неучебные периоды пересекаются");
  return {id, startsOn: input.startsOn, endsOn: input.endsOn, periods};
}
export function assertLessonDate(lesson, student, date, year, periods) {
  if (!validDate(date) || !year || date < year.startsOn || date > year.endsOn)
    throw new Error("Дата занятия вне настроенного учебного года");
  if (lesson.className !== student.className) throw new Error("Ученик не относится к классу урока");
  if (new Date(date + "T00:00:00Z").getUTCDay() !== lesson.weekday)
    throw new Error("В выбранную дату этого урока нет в расписании");
  if (periods.some(p => date >= p.startsOn && date <= p.endsOn)) throw new Error("Выбранная дата относится к неучебному периоду");
}
