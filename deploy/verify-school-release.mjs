import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  allocateCurriculumRows,
  buildScheduleSlots,
} from "/school/lib/curriculum-allocation.mjs";

const schedulePath =
  process.env.SCHEDULE_JSON ??
  "/school/data/schedules/school-1-11-2026-2027.json";
const curriculumPath =
  process.env.CURRICULUM_JSON ??
  "/school/data/curricula/school-1-11-2-math-2026-2027.json";
const databasePath =
  process.env.DATABASE_PATH ?? "/data/school-1-11.sqlite";

const schedule = JSON.parse(readFileSync(schedulePath, "utf8"));
const curriculum = JSON.parse(readFileSync(curriculumPath, "utf8"));
const db = new DatabaseSync(databasePath, { readOnly: true });
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA temp_store = MEMORY");

const fail = (message, evidence) => {
  if (evidence !== undefined) console.error(JSON.stringify(evidence));
  throw new Error(message);
};
const stable = (value) => JSON.stringify(value);
const same = (actual, expected, message) => {
  if (stable(actual) !== stable(expected)) fail(message, { actual, expected });
};

try {
  const integrity = db.prepare("PRAGMA integrity_check").all();
  same(integrity, [{ integrity_check: "ok" }], "SQLite integrity_check failed");
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  same(foreignKeys, [], "SQLite foreign_key_check failed");

  if (schedule.schemaVersion !== 1 || schedule.lessons?.length !== 189)
    fail("Unexpected schedule source");
  same(
    schedule.summary?.classCounts,
    { "1": 41, "2": 28, "3": 29, "4": 29, "5": 31, "6": 31 },
    "Unexpected schedule class counts",
  );

  const users = new Map(
    db
      .prepare(
        `SELECT id, role, profile_status AS profileStatus
         FROM users WHERE role = 'teacher' AND status = 'active'`,
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

  const expectedLessons = schedule.lessons.map((source) => {
    const assignment = assignments
      .filter(
        (item) =>
          item.className === source.className &&
          item.subjectId === source.subjectId,
      )
      .sort(
        (left, right) =>
          (rank[left.status] ?? 8) - (rank[right.status] ?? 8),
      )[0];
    const user = assignment ? users.get(assignment.teacherId) : null;
    const teacherId =
      user && !["vacant", "demo"].includes(user.profileStatus)
        ? assignment.teacherId
        : null;
    const assignmentNote =
      assignment?.status === "needs_confirmation"
        ? "ФИО преподавателя требует подтверждения"
        : assignment?.status === "unconfirmed"
          ? "Назначение преподавателя требует подтверждения"
          : "";
    return {
      ...source,
      teacherId,
      sharedSessionKey: "",
      note: [source.note, assignmentNote].filter(Boolean).join(". "),
    };
  });

  const jointBuckets = new Map();
  for (const lesson of expectedLessons) {
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
    const classList = bucket
      .map((lesson) => lesson.className)
      .sort()
      .join(", ");
    for (const lesson of bucket) {
      lesson.sharedSessionKey = sharedSessionKey;
      lesson.note = [lesson.note, `Совместно: ${classList} классы`]
        .filter(Boolean)
        .join(". ");
    }
  }

  const expectedScheduleRows = expectedLessons
    .map((lesson) => ({
      id: lesson.id,
      className: lesson.className,
      weekday: lesson.weekday,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      subjectId: lesson.subjectId,
      teacherUserId: lesson.teacherId,
      displayLabel: lesson.displayLabel || null,
      groupName: lesson.groupName || null,
      sharedSessionKey: lesson.sharedSessionKey || null,
      room: lesson.room || "Уточняется",
      status: "scheduled",
      note: lesson.note || null,
    }))
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );

  const actualScheduleRows = db
    .prepare(
      `SELECT id, class_name AS className, weekday,
        starts_at AS startsAt, ends_at AS endsAt, subject_id AS subjectId,
        teacher_user_id AS teacherUserId, display_label AS displayLabel,
        group_name AS groupName, shared_session_key AS sharedSessionKey,
        room, status, note
       FROM lessons
       WHERE class_name IN ('1','2','3','4','5','6')
         AND status NOT IN ('archived','cancelled')
       ORDER BY id`,
    )
    .all();
  same(actualScheduleRows, expectedScheduleRows, "Stored schedule differs from source");

  const expectedScheduleImport = {
    id: `schedule-import-${schedule.source.sha256.slice(0, 20)}`,
    academicYear: schedule.academicYear,
    sourceFileName: schedule.source.fileName,
    sourceSha256: schedule.source.sha256,
    lessonCount: 189,
  };
  const actualScheduleImport = db
    .prepare(
      `SELECT id, academic_year AS academicYear,
        source_file_name AS sourceFileName, source_sha256 AS sourceSha256,
        lesson_count AS lessonCount
       FROM schedule_imports WHERE source_sha256 = ?`,
    )
    .get(schedule.source.sha256);
  same(
    actualScheduleImport,
    expectedScheduleImport,
    "Schedule import provenance differs from source",
  );

  const expectedArrangements = (schedule.specialArrangements ?? [])
    .map((item) => ({
      id: item.id,
      academicYear: schedule.academicYear,
      sourceClassName: item.sourceClassName,
      studentLabel: item.studentLabel,
      subjectId: item.subjectId,
      targetClassName: item.targetClassName,
      instruction: item.instruction,
      sourceSheet: item.sourceSheet,
      sourceCell: item.sourceCell,
      sourceStatus: item.status,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const actualArrangements = db
    .prepare(
      `SELECT id, academic_year AS academicYear,
        source_class_name AS sourceClassName, student_label AS studentLabel,
        student_id AS studentId, subject_id AS subjectId,
        target_class_name AS targetClassName, instruction,
        source_sheet AS sourceSheet, source_cell AS sourceCell, status
       FROM schedule_exceptions
       WHERE academic_year = ?
         AND source_class_name IN ('1','2','3','4','5','6')
       ORDER BY id`,
    )
    .all(schedule.academicYear);
  same(
    actualArrangements.map(({ studentId: _studentId, status: _status, ...item }) => item),
    expectedArrangements.map(({ sourceStatus: _sourceStatus, ...item }) => item),
    "Special schedule arrangement differs from source",
  );
  for (let index = 0; index < actualArrangements.length; index += 1) {
    const actual = actualArrangements[index];
    const expected = expectedArrangements[index];
    if (actual.studentId === null) {
      if (actual.status !== expected.sourceStatus)
        fail("Unmatched schedule arrangement status differs from source", actual);
      continue;
    }
    if (!db.prepare("SELECT 1 FROM students WHERE id = ?").get(actual.studentId))
      fail("Matched schedule arrangement references a missing student", actual);
    if (typeof actual.status !== "string" || actual.status.length === 0)
      fail("Matched schedule arrangement has an empty status", actual);
  }

  if (
    curriculum.schemaVersion !== 1 ||
    curriculum.source?.sha256 !==
      "1d6f9925b3d80060ad46323f77db559d8fafa4f8034364760e6fdd76bc3338ae" ||
    curriculum.topics?.length !== 170 ||
    curriculum.source?.totalHours !== 170
  )
    fail("Unexpected curriculum source");

  const expectedPeriods = [...curriculum.calendarPeriods]
    .map((period) => ({
      id: period.id,
      academicYear: curriculum.academicYear.id,
      kind: period.kind,
      title: period.title,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const actualPeriods = db
    .prepare(
      `SELECT id, academic_year AS academicYear, kind, title,
        starts_on AS startsOn, ends_on AS endsOn
       FROM academic_calendar_periods
       WHERE academic_year = ?
         AND kind IN ('vacation','holiday','non_instruction')
       ORDER BY id`,
    )
    .all(curriculum.academicYear.id);
  same(actualPeriods, expectedPeriods, "Academic vacations differ from source");

  const program = db
    .prepare(
      `SELECT id, academic_year AS academicYear, class_name AS className,
        subject_id AS subjectId, teacher_user_id AS teacherUserId, title,
        status, planned_lessons AS plannedLessons
       FROM programs
       WHERE academic_year = ? AND class_name = ? AND subject_id = ?
         AND teacher_user_id = ?`,
    )
    .get(
      curriculum.academicYear.id,
      curriculum.program.className,
      curriculum.program.subjectId,
      curriculum.program.teacherUserId,
    );
  if (!program) fail("Curriculum program is missing");
  same(
    {
      academicYear: program.academicYear,
      className: program.className,
      subjectId: program.subjectId,
      teacherUserId: program.teacherUserId,
      title: program.title,
      status: program.status,
      plannedLessons: program.plannedLessons,
    },
    {
      academicYear: curriculum.academicYear.id,
      className: curriculum.program.className,
      subjectId: curriculum.program.subjectId,
      teacherUserId: curriculum.program.teacherUserId,
      title: curriculum.program.title,
      status: curriculum.program.status,
      plannedLessons: 170,
    },
    "Curriculum program differs from source",
  );

  const templateLessons = db
    .prepare(
      `SELECT id, weekday, starts_at AS startsAt
       FROM lessons
       WHERE class_name = ? AND subject_id = ? AND teacher_user_id = ?
         AND status NOT IN ('cancelled','archived')
       ORDER BY weekday, starts_at`,
    )
    .all(
      curriculum.program.className,
      curriculum.program.subjectId,
      curriculum.program.teacherUserId,
    );
  if (
    templateLessons.length !== 5 ||
    new Set(templateLessons.map((lesson) => lesson.weekday)).size !== 5
  )
    fail("Grade 2 math is not scheduled five days per week", templateLessons);

  const slots = buildScheduleSlots({
    startDate: curriculum.academicYear.startsOn,
    endDate: curriculum.academicYear.endsOn,
    lessons: templateLessons,
    periods: curriculum.calendarPeriods,
  });
  const allocation = allocateCurriculumRows(curriculum.topics, slots);
  same(
    {
      requiredHours: allocation.requiredHours,
      availableSlots: allocation.availableSlots,
      scheduledHours: allocation.scheduledHours,
      unscheduledHours: allocation.unscheduledHours,
      unusedSlots: allocation.unusedSlots,
      status: allocation.status,
      reserveDate: slots.at(-1)?.date,
    },
    {
      requiredHours: 170,
      availableSlots: 171,
      scheduledHours: 170,
      unscheduledHours: 0,
      unusedSlots: 1,
      status: "reserve",
      reserveDate: "2027-05-31",
    },
    "Curriculum allocation differs from approved calendar",
  );

  const importId = `program-import-${curriculum.source.sha256.slice(0, 24)}`;
  const actualImport = db
    .prepare(
      `SELECT id, program_id AS programId, file_name AS fileName,
        sheet_name AS sheetName, imported_by_user_id AS importedByUserId,
        row_count AS rowCount, required_hours AS requiredHours,
        available_slots AS availableSlots, scheduled_hours AS scheduledHours,
        unscheduled_hours AS unscheduledHours,
        validation_status AS validationStatus
       FROM program_imports WHERE id = ?`,
    )
    .get(importId);
  same(
    actualImport,
    {
      id: importId,
      programId: program.id,
      fileName: curriculum.source.fileName,
      sheetName: curriculum.source.sheetName,
      importedByUserId: curriculum.program.teacherUserId,
      rowCount: 170,
      requiredHours: 170,
      availableSlots: 171,
      scheduledHours: 170,
      unscheduledHours: 0,
      validationStatus: "reserve",
    },
    "Curriculum import provenance differs from source",
  );

  const expectedTopics = allocation.topics.map((topic) => ({
    id: `${program.id}-topic-${String(topic.sortOrder).padStart(3, "0")}`,
    programId: program.id,
    importId,
    sourceRow: topic.sourceRow,
    sequence: topic.sequence,
    topic: topic.topic,
    plannedHours: topic.hours,
    homework: topic.homework,
    sourceDate: topic.sourceDate,
    sortOrder: topic.sortOrder,
    status: "planned",
  }));
  const actualTopics = db
    .prepare(
      `SELECT id, program_id AS programId, import_id AS importId,
        source_row AS sourceRow, sequence, topic,
        planned_hours AS plannedHours, homework, source_date AS sourceDate,
        sort_order AS sortOrder, status
       FROM program_topics WHERE program_id = ?
       ORDER BY sort_order`,
    )
    .all(program.id);
  same(actualTopics, expectedTopics, "Stored curriculum topics differ from source");

  const expectedSessions = allocation.topics.flatMap((topic) => {
    const topicId =
      `${program.id}-topic-${String(topic.sortOrder).padStart(3, "0")}`;
    return topic.sessions.map((session) => ({
      id:
        `${topicId}-session-` +
        String(session.sessionIndex).padStart(2, "0"),
      programId: program.id,
      topicId,
      sessionIndex: session.sessionIndex,
      scheduledDate: session.scheduledDate,
      templateLessonId: session.templateLessonId,
      startsAt: session.startsAt,
      status: session.status,
    }));
  });
  const actualSessions = db
    .prepare(
      `SELECT id, program_id AS programId, topic_id AS topicId,
        session_index AS sessionIndex, scheduled_date AS scheduledDate,
        template_lesson_id AS templateLessonId, starts_at AS startsAt, status
       FROM program_topic_sessions WHERE program_id = ?
       ORDER BY topic_id, session_index`,
    )
    .all(program.id);
  same(
    actualSessions,
    expectedSessions,
    "Stored curriculum sessions differ from approved allocation",
  );

  const excludedSessions = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM program_topic_sessions ps
       JOIN academic_calendar_periods ap
         ON ps.scheduled_date BETWEEN ap.starts_on AND ap.ends_on
       WHERE ps.program_id = ? AND ap.academic_year = ?
         AND ap.kind IN ('vacation','holiday','non_instruction')`,
    )
    .get(program.id, curriculum.academicYear.id).count;
  if (excludedSessions !== 0) fail("Curriculum contains sessions on excluded dates");
  if (actualSessions.at(0)?.scheduledDate !== "2026-09-01")
    fail("Unexpected first curriculum date");
  if (actualSessions.at(-1)?.scheduledDate !== "2027-05-28")
    fail("Unexpected last curriculum date");
  if (
    actualSessions.some((session) => session.scheduledDate === "2027-05-31")
  )
    fail("Reserve date was incorrectly consumed");

  console.log("SCHOOL_RELEASE_DATABASE_INTEGRITY=PASS");
  console.log("SCHOOL_RELEASE_SCHEDULE_ROWS=189");
  console.log("SCHOOL_RELEASE_SCHEDULE_CLASSES=1:41,2:28,3:29,4:29,5:31,6:31");
  console.log("SCHOOL_RELEASE_CALENDAR_PERIODS=4");
  console.log("SCHOOL_RELEASE_CURRICULUM_TOPICS=170");
  console.log("SCHOOL_RELEASE_CURRICULUM_SESSIONS=170");
  console.log("SCHOOL_RELEASE_CURRICULUM_FIRST_DATE=2026-09-01");
  console.log("SCHOOL_RELEASE_CURRICULUM_LAST_DATE=2027-05-28");
  console.log("SCHOOL_RELEASE_CURRICULUM_RESERVE_DATE=2027-05-31");
  console.log("SCHOOL_RELEASE_DATA=PASS");
} finally {
  db.close();
}
