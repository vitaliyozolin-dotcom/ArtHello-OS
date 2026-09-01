const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function programSessionHomeworkId(sessionId) {
  const normalizedSessionId = String(sessionId ?? "").trim();
  if (!normalizedSessionId) throw new Error("Урок программы не указан");
  return `program-session-homework:${normalizedSessionId}`;
}

function validLocalDateTime(value) {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match;
  const parts = [year, month, day, hour, minute].map(Number);
  const date = new Date(Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3],
    parts[4],
  ));
  return date.getUTCFullYear() === parts[0]
    && date.getUTCMonth() === parts[1] - 1
    && date.getUTCDate() === parts[2]
    && date.getUTCHours() === parts[3]
    && date.getUTCMinutes() === parts[4];
}

export function prepareProgramSessionHomework({
  sessionId,
  homework,
  dueAt,
  lessonStartsAt,
}) {
  const id = programSessionHomeworkId(sessionId);
  const description = String(homework ?? "").trim();
  if (!description) {
    return { id, description: "", dueAt: null, published: false };
  }
  const normalizedDueAt = String(dueAt ?? "").trim();
  if (!validLocalDateTime(normalizedDueAt)) {
    throw new Error("Укажите корректный срок домашнего задания");
  }
  const normalizedLessonStartsAt = String(lessonStartsAt ?? "").trim();
  if (!validLocalDateTime(normalizedLessonStartsAt)) {
    throw new Error("У урока не указаны дата и время начала");
  }
  if (normalizedDueAt <= normalizedLessonStartsAt) {
    throw new Error("Срок домашнего задания должен быть позже начала урока");
  }
  return {
    id,
    description,
    dueAt: normalizedDueAt,
    published: true,
  };
}
