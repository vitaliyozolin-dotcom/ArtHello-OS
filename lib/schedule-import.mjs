import ExcelJS from "exceljs";

const WEEKDAYS = new Map([
  ["пн", 1],
  ["вт", 2],
  ["ср", 3],
  ["чт", 4],
  ["пт", 5],
  ["сб", 6],
]);

const SUBJECTS = new Map([
  ["русский", "russian"],
  ["математика", "math"],
  ["английский", "english"],
  ["физра", "pe"],
  ["чтение", "reading"],
  ["литературное чтение", "literary-club"],
  ["информатика+it", "ai"],
  ["технология+изо", "creative"],
  ["театр", "musical-theatre"],
  ["музыка", "musical-theatre"],
  ["чистописание", "russian"],
  ["окр.мир", "world"],
  ["окружающий мир", "world"],
  ["история", "history"],
  ["бассейн", "swimming"],
]);

function plainText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value.richText))
      return value.richText.map((part) => part.text ?? "").join("");
    if (typeof value.text === "string") return value.text;
    if (value.result !== undefined) return plainText(value.result);
  }
  return String(value);
}

function clean(value) {
  return plainText(value).replace(/\s+/g, " ").trim();
}

function canonicalLabel(value) {
  return clean(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*\+\s*/g, "+")
    .replace(/[.!]+$/g, "")
    .trim();
}

function parseClassName(title) {
  const match = clean(title).match(/(?:расписание\s*[—–-]\s*)?(\d{1,2})\s*класс/i);
  return match?.[1] ?? "";
}

function parseTimeRange(value) {
  const normalized = clean(value).replace(/[—–]/g, "-").replace(/\./g, ":");
  const match = normalized.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const startsAt = `${match[1].padStart(2, "0")}:${match[2]}`;
  const endsAt = `${match[3].padStart(2, "0")}:${match[4]}`;
  if (startsAt >= endsAt) return null;
  return { startsAt, endsAt };
}

function subjectFor(label, className) {
  const normalized = canonicalLabel(label).replace("литератрута", "литература");
  if (normalized === "литература")
    return Number(className) <= 4 ? "reading" : "literature";
  if (normalized === "география/окр.мир")
    return Number(className) <= 4 ? "world" : "geography";
  const subjectId = SUBJECTS.get(normalized);
  if (!subjectId) throw new Error(`Неизвестный предмет «${clean(label)}»`);
  return subjectId;
}

function splitGroups(label, className) {
  const match = clean(label).match(
    /^гр\.?\s*1\s+английский\s*\/\s*гр\.?\s*2\s+математика$/i,
  );
  if (!match) return null;
  return [
    {
      subjectId: "english",
      displayLabel: "Английский",
      groupName: "Группа 1",
      note: "Параллельно: группа 2 — математика",
    },
    {
      subjectId: "math",
      displayLabel: "Математика",
      groupName: "Группа 2",
      note: "Параллельно: группа 1 — английский",
    },
  ].map((item) => ({ ...item, className }));
}

function normalizeLesson(label, className) {
  const groups = splitGroups(label, className);
  if (groups) return groups;
  return [
    {
      className,
      subjectId: subjectFor(label, className),
      displayLabel: clean(label).replace("Литератрута", "Литература"),
      groupName: "",
      note: "",
    },
  ];
}

export async function parseSchoolScheduleXlsx(input) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);
  const lessons = [];
  const errors = [];

  for (const sheet of workbook.worksheets) {
    const className = parseClassName(sheet.name) || parseClassName(sheet.getCell("A1").value);
    if (!className || Number(className) < 1 || Number(className) > 6) {
      errors.push(`${sheet.name}: не удалось определить класс 1–6`);
      continue;
    }

    let headerRow = 0;
    const weekdayColumns = new Map();
    for (let row = 1; row <= Math.min(sheet.rowCount, 20); row += 1) {
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const weekday = WEEKDAYS.get(canonicalLabel(sheet.getCell(row, column).value));
        if (weekday) {
          headerRow = row;
          weekdayColumns.set(column, weekday);
        }
      }
      if (weekdayColumns.size >= 5) break;
    }
    if (!headerRow || weekdayColumns.size < 5) {
      errors.push(`${sheet.name}: не найдены колонки Пн–Пт`);
      continue;
    }

    for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
      const time = parseTimeRange(sheet.getCell(row, 2).value);
      if (!time) continue;
      for (const [column, weekday] of weekdayColumns) {
        const sourceLabel = clean(sheet.getCell(row, column).value);
        if (!sourceLabel || /^обед\s*\+\s*прогулка$/i.test(sourceLabel)) continue;
        try {
          const normalized = normalizeLesson(sourceLabel, className);
          normalized.forEach((lesson, splitIndex) => {
            lessons.push({
              id: `schedule-2026-2027-${className}-${weekday}-${row}-${splitIndex + 1}`,
              className,
              weekday,
              ...time,
              ...lesson,
              room: "Уточняется",
              status: "scheduled",
              sourceSheet: sheet.name,
              sourceCell: sheet.getCell(row, column).address,
              sourceLabel,
            });
          });
        } catch (error) {
          errors.push(`${sheet.name}!${sheet.getCell(row, column).address}: ${error.message}`);
        }
      }
    }
  }

  if (errors.length) throw new Error(`Расписание не прошло проверку:\n${errors.join("\n")}`);
  return lessons.sort(
    (a, b) =>
      Number(a.className) - Number(b.className) ||
      a.weekday - b.weekday ||
      a.startsAt.localeCompare(b.startsAt) ||
      a.groupName.localeCompare(b.groupName, "ru"),
  );
}

export function validateNormalizedSchedule(lessons) {
  const ids = new Set();
  const conflicts = [];
  for (const lesson of lessons) {
    if (ids.has(lesson.id)) conflicts.push(`Повторяется ID ${lesson.id}`);
    ids.add(lesson.id);
    for (const other of lessons) {
      if (lesson.id >= other.id) continue;
      if (lesson.weekday !== other.weekday) continue;
      if (lesson.startsAt >= other.endsAt || lesson.endsAt <= other.startsAt) continue;
      if (lesson.className !== other.className) continue;
      const separatedGroups =
        lesson.groupName && other.groupName && lesson.groupName !== other.groupName;
      if (!separatedGroups)
        conflicts.push(
          `${lesson.className} класс: ${lesson.startsAt}–${lesson.endsAt} пересекается с ${other.startsAt}–${other.endsAt}`,
        );
    }
  }
  if (conflicts.length) throw new Error(conflicts.join("\n"));
  return {
    lessonCount: lessons.length,
    classCounts: Object.fromEntries(
      [...new Set(lessons.map((lesson) => lesson.className))].map((className) => [
        className,
        lessons.filter((lesson) => lesson.className === className).length,
      ]),
    ),
  };
}

const ASSIGNMENT_RANK = {
  confirmed: 1,
  needs_confirmation: 2,
  unconfirmed: 3,
  vacant: 9,
};

export function attachScheduleTeachers(lessons, assignments, users) {
  const usableUsers = new Map(
    users
      .filter(
        (user) =>
          user.role === "teacher" &&
          !["vacant", "demo"].includes(user.profile_status ?? user.profileStatus),
      )
      .map((user) => [user.id, user]),
  );
  const enriched = lessons.map((lesson) => {
    const assignment = assignments
      .filter(
        (item) =>
          (item.class_name ?? item.className) === lesson.className &&
          (item.subject_id ?? item.subjectId) === lesson.subjectId,
      )
      .sort(
        (left, right) =>
          (ASSIGNMENT_RANK[left.status] ?? 8) -
          (ASSIGNMENT_RANK[right.status] ?? 8),
      )[0];
    const teacherId = assignment?.teacher_user_id ?? assignment?.teacherUserId ?? "";
    const teacher = usableUsers.get(teacherId);
    const assignmentNote =
      assignment?.status === "needs_confirmation"
        ? "ФИО преподавателя требует подтверждения"
        : assignment?.status === "unconfirmed"
          ? "Назначение преподавателя требует подтверждения"
          : "";
    return {
      ...lesson,
      teacherId: teacher ? teacherId : "",
      note: [lesson.note, assignmentNote].filter(Boolean).join(". "),
      sharedSessionKey: "",
    };
  });

  const jointBuckets = new Map();
  for (const lesson of enriched) {
    if (!lesson.teacherId) continue;
    const key = [
      lesson.teacherId,
      lesson.subjectId,
      lesson.weekday,
      lesson.startsAt,
      lesson.endsAt,
    ].join("|");
    const bucket = jointBuckets.get(key) ?? [];
    bucket.push(lesson);
    jointBuckets.set(key, bucket);
  }
  for (const [key, bucket] of jointBuckets) {
    if (new Set(bucket.map((lesson) => lesson.className)).size < 2) continue;
    const sharedSessionKey = `joint-${key.replace(/[^a-z0-9|:-]+/gi, "-")}`;
    const classList = bucket.map((lesson) => lesson.className).sort().join(", ");
    for (const lesson of bucket) {
      lesson.sharedSessionKey = sharedSessionKey;
      lesson.note = [lesson.note, `Совместно: ${classList} классы`]
        .filter(Boolean)
        .join(". ");
    }
  }
  return enriched;
}
