import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  allocateCurriculumRows,
  buildScheduleSlots,
} from "../lib/curriculum-allocation.mjs";

const curriculumPath = resolve(
  process.argv.find((item) => item.endsWith(".json")) ??
    "data/curricula/school-1-11-2-math-2026-2027.json",
);
const databasePath =
  process.env.DATABASE_PATH || resolve("data/school-1-11.sqlite");
const payload = JSON.parse(readFileSync(curriculumPath, "utf8"));

const fail = (message) => {
  throw new Error(message);
};

if (payload.schemaVersion !== 1) fail("Неподдерживаемая версия КТП");
if (!payload.academicYear?.id) fail("В КТП не указан учебный год");
if (!Array.isArray(payload.calendarPeriods) || !payload.calendarPeriods.length)
  fail("В КТП не указан учебный календарь");
const approvedVacationPeriods = payload.calendarPeriods.filter(
  (period) => period.kind === "vacation",
);
if (
  approvedVacationPeriods.length !== 4 ||
  new Set(approvedVacationPeriods.map((period) => period.id)).size !== 4
)
  fail("В контрольном календаре должны быть ровно четыре периода каникул");
if (!Array.isArray(payload.topics) || !payload.topics.length)
  fail("В КТП нет тем");
if (payload.topics.length !== payload.source?.rowCount)
  fail("Контрольное количество строк КТП не совпало");
if (
  payload.topics.reduce((sum, topic) => sum + Number(topic.hours || 0), 0) !==
  payload.source?.totalHours
)
  fail("Контрольная сумма часов КТП не совпала");

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

const requiredTables = [
  "academic_calendar_periods",
  "lessons",
  "programs",
  "program_imports",
  "program_topics",
  "program_topic_sessions",
  "subjects",
  "teacher_assignments",
  "users",
];
const tables = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name),
);
for (const table of requiredTables) {
  if (!tables.has(table)) fail(`В базе нет обязательной таблицы ${table}`);
}

const { academicYear, program, source } = payload;
const subject = db
  .prepare("SELECT id FROM subjects WHERE id = ? AND status = 'active'")
  .get(program.subjectId);
if (!subject) fail(`Предмет ${program.subjectId} не найден или архивирован`);
const teacher = db
  .prepare(
    "SELECT id FROM users WHERE id = ? AND role = 'teacher' AND profile_status NOT IN ('vacant', 'demo')",
  )
  .get(program.teacherUserId);
if (!teacher) fail(`Преподаватель ${program.teacherUserId} не найден`);
const assignment = db
  .prepare(
    `SELECT id FROM teacher_assignments
    WHERE teacher_user_id = ? AND class_name = ? AND subject_id = ?
      AND status = 'confirmed'`,
  )
  .get(program.teacherUserId, program.className, program.subjectId);
if (!assignment) fail("Преподаватель не назначен этому классу и предмету");

const templateLessons = db
  .prepare(
    `SELECT id, weekday, starts_at AS startsAt
    FROM lessons
    WHERE class_name = ? AND subject_id = ? AND teacher_user_id = ?
      AND status NOT IN ('cancelled', 'archived')
    ORDER BY weekday, starts_at`,
  )
  .all(program.className, program.subjectId, program.teacherUserId);
if (new Set(templateLessons.map((lesson) => lesson.weekday)).size !== 5)
  fail("Для математики 2 класса ожидается пять учебных дней в неделю");

const slots = buildScheduleSlots({
  startDate: academicYear.startsOn,
  endDate: academicYear.endsOn,
  lessons: templateLessons,
  periods: payload.calendarPeriods,
});
const allocation = allocateCurriculumRows(payload.topics, slots);
const reserveSlots = slots.slice(allocation.scheduledHours);
if (
  allocation.requiredHours !== 170 ||
  allocation.availableSlots !== 171 ||
  allocation.scheduledHours !== 170 ||
  allocation.unscheduledHours !== 0 ||
  allocation.unusedSlots !== 1 ||
  allocation.status !== "reserve" ||
  reserveSlots.length !== 1 ||
  reserveSlots[0]?.date !== "2027-05-31"
)
  fail(
    `КТП распределился неверно: ${JSON.stringify({
      requiredHours: allocation.requiredHours,
      availableSlots: allocation.availableSlots,
      scheduledHours: allocation.scheduledHours,
      unscheduledHours: allocation.unscheduledHours,
      unusedSlots: allocation.unusedSlots,
      status: allocation.status,
      reserveDates: reserveSlots.map((slot) => slot.date),
    })}`,
  );

const importId = `program-import-${source.sha256.slice(0, 24)}`;
const existingImport = db
  .prepare("SELECT id, program_id AS programId FROM program_imports WHERE id = ?")
  .get(importId);
const existingProgram = db
  .prepare(
    `SELECT id FROM programs
    WHERE academic_year = ? AND class_name = ? AND subject_id = ?
      AND teacher_user_id = ?`,
  )
  .get(
    academicYear.id,
    program.className,
    program.subjectId,
    program.teacherUserId,
  );
const targetProgramId = existingProgram?.id ?? program.id;

if (existingImport && existingImport.programId !== targetProgramId) {
  fail("Контрольный импорт КТП связан с другой программой");
}

if (!existingImport && existingProgram) {
  const existingContent = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM program_imports WHERE program_id = ?) AS imports,
        (SELECT COUNT(*) FROM program_topics WHERE program_id = ?) AS topics`,
    )
    .get(targetProgramId, targetProgramId);
  if (existingContent.imports || existingContent.topics) {
    console.log("SCHOOL_CURRICULUM_IMPORT_CONFLICT=1");
    fail("В базе уже есть другое КТП; автоматическая замена остановлена");
  }
}

const upsertCalendar = db.prepare(
  `INSERT INTO academic_calendar_periods
    (id, academic_year, kind, title, starts_on, ends_on)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     academic_year = excluded.academic_year,
     kind = excluded.kind,
     title = excluded.title,
     starts_on = excluded.starts_on,
     ends_on = excluded.ends_on,
     updated_at = CURRENT_TIMESTAMP`,
);

const verifyReleaseState = () => {
  const verification = db
    .prepare(
      `SELECT p.planned_lessons AS plannedLessons,
        (SELECT COUNT(*) FROM program_topics
          WHERE program_id = p.id) AS topics,
        (SELECT COALESCE(SUM(planned_hours), 0) FROM program_topics
          WHERE program_id = p.id) AS topicHours,
        (SELECT COUNT(*) FROM program_topic_sessions
          WHERE program_id = p.id) AS sessions,
        (SELECT COUNT(*) FROM program_topic_sessions
          WHERE program_id = p.id AND scheduled_date IS NULL) AS unscheduled,
        (SELECT MIN(scheduled_date) FROM program_topic_sessions
          WHERE program_id = p.id) AS firstDate,
        (SELECT MAX(scheduled_date) FROM program_topic_sessions
          WHERE program_id = p.id) AS lastDate
      FROM programs p
      WHERE p.id = ?`,
    )
    .get(targetProgramId);
  const importedSummary = db
    .prepare(
      `SELECT row_count AS rowCount, required_hours AS requiredHours,
        available_slots AS availableSlots, scheduled_hours AS scheduledHours,
        unscheduled_hours AS unscheduledHours, validation_status AS validationStatus
      FROM program_imports WHERE id = ?`,
    )
    .get(importId);
  const storedVacations = db
    .prepare(
      `SELECT id, kind, title, starts_on AS startsOn, ends_on AS endsOn
      FROM academic_calendar_periods
      WHERE academic_year = ? AND kind = 'vacation'
      ORDER BY id`,
    )
    .all(academicYear.id);
  const approvedVacationsById = new Map(
    approvedVacationPeriods.map((period) => [period.id, period]),
  );
  const calendarMatches =
    storedVacations.length === approvedVacationPeriods.length &&
    storedVacations.every((stored) => {
      const approved = approvedVacationsById.get(stored.id);
      return (
        approved?.kind === stored.kind &&
        approved.title === stored.title &&
        approved.startsOn === stored.startsOn &&
        approved.endsOn === stored.endsOn
      );
    });
  const vacationSessions = db
    .prepare(
      `SELECT COUNT(*) AS count
      FROM program_topic_sessions ps
      JOIN academic_calendar_periods ap
        ON ps.scheduled_date BETWEEN ap.starts_on AND ap.ends_on
      WHERE ps.program_id = ? AND ap.academic_year = ?
        AND ap.kind IN ('vacation', 'holiday', 'non_instruction')`,
    )
    .get(targetProgramId, academicYear.id).count;

  if (
    !verification ||
    verification.plannedLessons !== 170 ||
    verification.topics !== 170 ||
    verification.topicHours !== 170 ||
    verification.sessions !== 170 ||
    verification.unscheduled !== 0 ||
    verification.firstDate !== "2026-09-01" ||
    verification.lastDate !== "2027-05-28" ||
    !importedSummary ||
    importedSummary.rowCount !== 170 ||
    importedSummary.requiredHours !== 170 ||
    importedSummary.availableSlots !== 171 ||
    importedSummary.scheduledHours !== 170 ||
    importedSummary.unscheduledHours !== 0 ||
    importedSummary.validationStatus !== "reserve" ||
    !calendarMatches ||
    vacationSessions !== 0
  )
    fail(
      `Контроль КТП не пройден: ${JSON.stringify({
        ...verification,
        importedSummary,
        calendarCount: storedVacations.length,
        calendarMatches,
        vacationSessions,
      })}`,
    );
};

db.exec("BEGIN IMMEDIATE");
try {
  const approvedVacationIds = approvedVacationPeriods.map(
    (period) => period.id,
  );
  db.prepare(
    `DELETE FROM academic_calendar_periods
    WHERE academic_year = ? AND kind = 'vacation'
      AND id NOT IN (${approvedVacationIds.map(() => "?").join(", ")})`,
  ).run(academicYear.id, ...approvedVacationIds);
  for (const period of payload.calendarPeriods) {
    upsertCalendar.run(
      period.id,
      academicYear.id,
      period.kind,
      period.title,
      period.startsOn,
      period.endsOn,
    );
  }
  if (!existingImport) {
    db.prepare(
      `INSERT INTO programs
        (id, academic_year, class_name, subject_id, teacher_user_id, title,
          status, planned_lessons, completed_lessons, review_comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '')
       ON CONFLICT(id)
       DO UPDATE SET title = excluded.title, status = excluded.status,
         planned_lessons = excluded.planned_lessons,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(
      targetProgramId,
      academicYear.id,
      program.className,
      program.subjectId,
      program.teacherUserId,
      program.title,
      program.status,
      allocation.requiredHours,
    );
    db.prepare(
      `INSERT INTO program_imports
        (id, program_id, file_name, sheet_name, imported_by_user_id, row_count,
          required_hours, available_slots, scheduled_hours, unscheduled_hours,
          validation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      importId,
      targetProgramId,
      source.fileName,
      source.sheetName,
      program.teacherUserId,
      source.rowCount,
      allocation.requiredHours,
      allocation.availableSlots,
      allocation.scheduledHours,
      allocation.unscheduledHours,
      allocation.status,
    );
    for (const topic of allocation.topics) {
      const paddedOrder = String(topic.sortOrder).padStart(3, "0");
      const topicId = `${targetProgramId}-topic-${paddedOrder}`;
      db.prepare(
        `INSERT INTO program_topics
          (id, program_id, import_id, source_row, sequence, topic,
            planned_hours, homework, source_date, sort_order, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')`,
      ).run(
        topicId,
        targetProgramId,
        importId,
        topic.sourceRow,
        topic.sequence,
        topic.topic,
        topic.hours,
        topic.homework,
        topic.sourceDate,
        topic.sortOrder,
      );
      for (const session of topic.sessions) {
        db.prepare(
          `INSERT INTO program_topic_sessions
            (id, program_id, topic_id, session_index, scheduled_date,
              template_lesson_id, starts_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `${topicId}-session-${String(session.sessionIndex).padStart(2, "0")}`,
          targetProgramId,
          topicId,
          session.sessionIndex,
          session.scheduledDate,
          session.templateLessonId,
          session.startsAt,
          session.status,
        );
      }
    }
  }
  verifyReleaseState();
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(
  `SCHOOL_CALENDAR_IMPORT=${existingImport ? "ALREADY_APPLIED" : "SUCCESS"}`,
);
console.log("SCHOOL_CALENDAR_PERIODS=4");
console.log(
  `SCHOOL_CURRICULUM_IMPORT=${existingImport ? "ALREADY_APPLIED" : "SUCCESS"}`,
);
console.log("SCHOOL_CURRICULUM_REQUIRED_HOURS=170");
console.log("SCHOOL_CURRICULUM_AVAILABLE_SLOTS=171");
console.log("SCHOOL_CURRICULUM_SCHEDULED_HOURS=170");
console.log("SCHOOL_CURRICULUM_UNSCHEDULED_HOURS=0");
console.log("SCHOOL_CURRICULUM_UNUSED_SLOTS=1");
console.log("SCHOOL_CURRICULUM_FIRST_DATE=2026-09-01");
console.log("SCHOOL_CURRICULUM_LAST_DATE=2027-05-28");
console.log("SCHOOL_CURRICULUM_RESERVE_DATE=2027-05-31");
