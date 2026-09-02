import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const schedulePath = resolve(
  process.argv.find((item) => item.endsWith(".json")) ??
    "data/schedules/school-1-11-2026-2027.json",
);
const databasePath =
  process.env.DATABASE_PATH || resolve("data/school-1-11.sqlite");
const payload = JSON.parse(readFileSync(schedulePath, "utf8"));

if (payload.schemaVersion !== 1) throw new Error("Неподдерживаемая версия расписания");
if (!Array.isArray(payload.lessons) || !payload.lessons.length)
  throw new Error("В расписании нет уроков");
if (payload.lessons.length !== payload.summary?.lessonCount)
  throw new Error("Контрольное количество уроков не совпало");

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column))
    db.exec(`ALTER TABLE ${table} ADD ${column} ${definition}`);
}

ensureColumn("lessons", "display_label", "text");
ensureColumn("lessons", "group_name", "text");
ensureColumn("lessons", "shared_session_key", "text");
db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_imports (
    id text PRIMARY KEY NOT NULL,
    academic_year text NOT NULL,
    source_file_name text NOT NULL,
    source_sha256 text NOT NULL,
    lesson_count integer NOT NULL,
    imported_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS schedule_imports_source_unique
    ON schedule_imports (source_sha256);
  CREATE TABLE IF NOT EXISTS schedule_exceptions (
    id text PRIMARY KEY NOT NULL,
    academic_year text NOT NULL,
    source_class_name text NOT NULL,
    student_label text NOT NULL,
    student_id text,
    subject_id text NOT NULL,
    target_class_name text NOT NULL,
    instruction text NOT NULL,
    source_sheet text NOT NULL,
    source_cell text NOT NULL,
    status text DEFAULT 'pending_student_match' NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    FOREIGN KEY (subject_id) REFERENCES subjects(id)
  );
  CREATE INDEX IF NOT EXISTS schedule_exceptions_status_idx
    ON schedule_exceptions (status, source_class_name);
`);

const alreadyImported = db
  .prepare("SELECT id FROM schedule_imports WHERE source_sha256 = ?")
  .get(payload.source.sha256);
if (alreadyImported) {
  console.log("SCHOOL_SCHEDULE_IMPORT=ALREADY_APPLIED");
  console.log(`SCHOOL_SCHEDULE_LESSONS=${payload.lessons.length}`);
  process.exit(0);
}

const activeSubjects = new Set(
  db
    .prepare("SELECT id FROM subjects WHERE status = 'active'")
    .all()
    .map((item) => item.id),
);
const missingSubjects = [
  ...new Set(
    payload.lessons
      .map((lesson) => lesson.subjectId)
      .filter((subjectId) => !activeSubjects.has(subjectId)),
  ),
];
if (missingSubjects.length)
  throw new Error(`Нет действующих предметов: ${missingSubjects.join(", ")}`);

const users = new Map(
  db
    .prepare(
      `SELECT id, role, profile_status AS profileStatus
      FROM users WHERE role = 'teacher'`,
    )
    .all()
    .map((user) => [user.id, user]),
);
const assignments = db
  .prepare(
    `SELECT teacher_user_id AS teacherId, class_name AS className,
      subject_id AS subjectId, status
    FROM teacher_assignments`,
  )
  .all();
const rank = { confirmed: 1, needs_confirmation: 2, unconfirmed: 3, vacant: 9 };

const lessons = payload.lessons.map((lesson) => {
  const assignment = assignments
    .filter(
      (item) =>
        item.className === lesson.className &&
        item.subjectId === lesson.subjectId,
    )
    .sort((left, right) => (rank[left.status] ?? 8) - (rank[right.status] ?? 8))[0];
  const user = assignment ? users.get(assignment.teacherId) : null;
  const teacherId =
    user && !["vacant", "demo"].includes(user.profileStatus)
      ? assignment.teacherId
      : "";
  const assignmentNote =
    assignment?.status === "needs_confirmation"
      ? "ФИО преподавателя требует подтверждения"
      : assignment?.status === "unconfirmed"
        ? "Назначение преподавателя требует подтверждения"
        : "";
  return {
    ...lesson,
    teacherId,
    sharedSessionKey: "",
    note: [lesson.note, assignmentNote].filter(Boolean).join(". "),
  };
});

const jointBuckets = new Map();
for (const lesson of lessons) {
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

const conflicts = [];
for (let leftIndex = 0; leftIndex < lessons.length; leftIndex += 1) {
  const left = lessons[leftIndex];
  for (let rightIndex = leftIndex + 1; rightIndex < lessons.length; rightIndex += 1) {
    const right = lessons[rightIndex];
    if (left.weekday !== right.weekday) continue;
    if (left.startsAt >= right.endsAt || left.endsAt <= right.startsAt) continue;
    if (left.className === right.className) {
      const separatedGroups =
        left.groupName && right.groupName && left.groupName !== right.groupName;
      if (!separatedGroups)
        conflicts.push(`${left.className} класс: пересечение ${left.id} и ${right.id}`);
    }
    if (left.teacherId && left.teacherId === right.teacherId) {
      const sameJointSession =
        left.sharedSessionKey && left.sharedSessionKey === right.sharedSessionKey;
      if (!sameJointSession)
        conflicts.push(`Преподаватель: пересечение ${left.id} и ${right.id}`);
    }
  }
}
if (conflicts.length) throw new Error(conflicts.slice(0, 20).join("\n"));

const unexpectedLessons = db
  .prepare(
    `SELECT id FROM lessons
    WHERE class_name IN ('1','2','3','4','5','6')
      AND status NOT IN ('archived', 'cancelled')
      AND id NOT LIKE 'schedule-2026-2027-%'
    ORDER BY id`,
  )
  .all();
if (unexpectedLessons.length) {
  console.log(`SCHOOL_SCHEDULE_IMPORT_CONFLICTS=${unexpectedLessons.length}`);
  throw new Error(
    "В базе уже есть рабочее расписание с другим источником; автоматическая замена остановлена",
  );
}

const upsertLesson = db.prepare(
  `INSERT INTO lessons
    (id, class_name, weekday, starts_at, ends_at, subject_id, teacher_user_id,
      display_label, group_name, shared_session_key, room, status, note,
      created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
   ON CONFLICT(id) DO UPDATE SET
     class_name = excluded.class_name,
     weekday = excluded.weekday,
     starts_at = excluded.starts_at,
     ends_at = excluded.ends_at,
     subject_id = excluded.subject_id,
     teacher_user_id = excluded.teacher_user_id,
     display_label = excluded.display_label,
     group_name = excluded.group_name,
     shared_session_key = excluded.shared_session_key,
     room = excluded.room,
     status = 'scheduled',
     note = excluded.note,
     updated_at = CURRENT_TIMESTAMP`,
);
const upsertException = db.prepare(
  `INSERT INTO schedule_exceptions
    (id, academic_year, source_class_name, student_label, subject_id,
      target_class_name, instruction, source_sheet, source_cell, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     source_class_name = excluded.source_class_name,
     student_label = excluded.student_label,
     subject_id = excluded.subject_id,
     target_class_name = excluded.target_class_name,
     instruction = excluded.instruction,
     source_sheet = excluded.source_sheet,
     source_cell = excluded.source_cell,
     status = CASE
       WHEN schedule_exceptions.student_id IS NULL THEN excluded.status
       ELSE schedule_exceptions.status END,
     updated_at = CURRENT_TIMESTAMP`,
);

db.exec("BEGIN IMMEDIATE");
try {
  db.prepare(
    `UPDATE lessons SET status = 'archived', updated_at = CURRENT_TIMESTAMP
    WHERE id LIKE 'schedule-2026-2027-%'
      AND class_name IN ('1','2','3','4','5','6')`,
  ).run();
  for (const lesson of lessons) {
    upsertLesson.run(
      lesson.id,
      lesson.className,
      lesson.weekday,
      lesson.startsAt,
      lesson.endsAt,
      lesson.subjectId,
      lesson.teacherId || null,
      lesson.displayLabel || null,
      lesson.groupName || null,
      lesson.sharedSessionKey || null,
      lesson.room || "Уточняется",
      lesson.note || null,
    );
  }
  for (const exception of payload.specialArrangements ?? []) {
    upsertException.run(
      exception.id,
      payload.academicYear,
      exception.sourceClassName,
      exception.studentLabel,
      exception.subjectId,
      exception.targetClassName,
      exception.instruction,
      exception.sourceSheet,
      exception.sourceCell,
      exception.status,
    );
  }
  db.prepare(
    `INSERT INTO schedule_imports
      (id, academic_year, source_file_name, source_sha256, lesson_count)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    `schedule-import-${payload.source.sha256.slice(0, 20)}`,
    payload.academicYear,
    payload.source.fileName,
    payload.source.sha256,
    lessons.length,
  );
  const actor = db
    .prepare(
      `SELECT id FROM users
      WHERE role = 'director' AND status != 'archived'
      ORDER BY created_at LIMIT 1`,
    )
    .get();
  if (actor)
    db.prepare(
      `INSERT INTO audit_log
        (id, actor_user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'schedule.import', 'schedule', ?, ?)`,
    ).run(
      `schedule-audit-${payload.source.sha256.slice(0, 20)}`,
      actor.id,
      payload.academicYear,
      `${lessons.length} уроков из ${payload.source.fileName}`,
    );
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const groupedLessons = lessons.filter((lesson) => lesson.groupName).length;
const jointLessons = lessons.filter((lesson) => lesson.sharedSessionKey).length;
const unassignedLessons = lessons.filter((lesson) => !lesson.teacherId).length;
console.log("SCHOOL_SCHEDULE_IMPORT=SUCCESS");
console.log(`SCHOOL_SCHEDULE_LESSONS=${lessons.length}`);
console.log(`SCHOOL_SCHEDULE_GROUP_LESSONS=${groupedLessons}`);
console.log(`SCHOOL_SCHEDULE_JOINT_LESSONS=${jointLessons}`);
console.log(`SCHOOL_SCHEDULE_UNASSIGNED_LESSONS=${unassignedLessons}`);
console.log(
  `SCHOOL_SCHEDULE_EXCEPTIONS=${(payload.specialArrangements ?? []).length}`,
);

