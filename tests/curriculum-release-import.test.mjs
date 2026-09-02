import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationFiles = [
  "0000_motionless_goblin_queen.sql",
  "0001_white_nighthawk.sql",
  "0002_mature_psylocke.sql",
  "0003_daffy_quentin_quire.sql",
  "0004_phone_auth.sql",
  "0005_central_staff_access.sql",
  "0006_identity_broker.sql",
  "0007_curriculum_import.sql",
  "0008_schedule_groups.sql",
];
const curriculumFile = "data/curricula/school-1-11-2-math-2026-2027.json";
const plainRows = (value) =>
  Array.isArray(value)
    ? value.map((row) => ({ ...row }))
    : value
      ? { ...value }
      : value;

function applyMigrations(db) {
  for (const filename of migrationFiles) {
    const sql = readFileSync(
      join(repositoryRoot, "drizzle", filename),
      "utf8",
    );
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean)) {
      db.exec(statement);
    }
  }
}

function seedCurriculumDependencies(db) {
  db.prepare(
    `INSERT INTO users
      (id, email, display_name, role, status, profile_status)
     VALUES (?, ?, ?, 'teacher', 'active', 'confirmed')`,
  ).run(
    "teacher-nasyrova",
    "nasyrova@example.test",
    "Насырова Надежда Юрьевна",
  );
  db.prepare(
    `INSERT INTO subjects
      (id, name, short_name, color, icon, stage, weekly_hours, status)
     VALUES ('math', 'Математика', 'Мат.', '#5f56ee', 'calculator', '1–4', 5, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO teacher_assignments
      (id, teacher_user_id, class_name, subject_id, status)
     VALUES ('assignment-2-math', 'teacher-nasyrova', '2', 'math', 'confirmed')`,
  ).run();

  const lessons = [
    ["schedule-2026-2027-2-1-4-1", 1, "09:00", "09:40"],
    ["schedule-2026-2027-2-2-4-1", 2, "09:00", "09:40"],
    ["schedule-2026-2027-2-3-7-1", 3, "11:40", "12:20"],
    ["schedule-2026-2027-2-4-6-1", 4, "10:50", "11:30"],
    ["schedule-2026-2027-2-5-5-1", 5, "10:00", "10:40"],
  ];
  const insertLesson = db.prepare(
    `INSERT INTO lessons
      (id, class_name, weekday, starts_at, ends_at, subject_id,
        teacher_user_id, room, status)
     VALUES (?, '2', ?, ?, ?, 'math', 'teacher-nasyrova', 'Уточняется', 'scheduled')`,
  );
  for (const lesson of lessons) insertLesson.run(...lesson);

  // Production can already contain an empty draft created through the UI.
  // The release importer must fill that same row instead of failing on its ID.
  db.prepare(
    `INSERT INTO programs
      (id, academic_year, class_name, subject_id, teacher_user_id, title,
        status, planned_lessons, completed_lessons, review_comment)
     VALUES (
       'existing-program-2-math', '2026/27', '2', 'math',
       'teacher-nasyrova', 'Черновик', 'draft', 0, 0, ''
     )`,
  ).run();
}

function runImporter(
  databasePath,
  {
    scriptPath = "scripts/import-school-curriculum.mjs",
    curriculumPath = curriculumFile,
    cwd = repositoryRoot,
  } = {},
) {
  return spawnSync(
    process.execPath,
    [scriptPath, curriculumPath],
    {
      cwd,
      env: { ...process.env, DATABASE_PATH: databasePath },
      encoding: "utf8",
    },
  );
}

function createSeededDatabase(t, prefix) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));
  const databasePath = join(temporaryDirectory, "school.sqlite");
  const db = new DatabaseSync(databasePath);
  applyMigrations(db);
  db.exec("PRAGMA foreign_keys = ON");
  seedCurriculumDependencies(db);
  return { databasePath, db };
}

test("release importer runs from an isolated runtime without ExcelJS", (t) => {
  const { databasePath, db } = createSeededDatabase(
    t,
    "school-curriculum-no-exceljs-",
  );
  db.close();

  const isolatedRoot = mkdtempSync(join(tmpdir(), "school-runtime-isolated-"));
  t.after(() => rmSync(isolatedRoot, { recursive: true, force: true }));
  mkdirSync(join(isolatedRoot, "scripts"), { recursive: true });
  mkdirSync(join(isolatedRoot, "lib"), { recursive: true });
  mkdirSync(join(isolatedRoot, "data", "curricula"), { recursive: true });
  copyFileSync(
    join(repositoryRoot, "scripts", "import-school-curriculum.mjs"),
    join(isolatedRoot, "scripts", "import-school-curriculum.mjs"),
  );
  copyFileSync(
    join(repositoryRoot, "lib", "curriculum-allocation.mjs"),
    join(isolatedRoot, "lib", "curriculum-allocation.mjs"),
  );
  const isolatedCurriculumPath = join(isolatedRoot, curriculumFile);
  copyFileSync(
    join(repositoryRoot, curriculumFile),
    isolatedCurriculumPath,
  );

  const isolatedOptions = {
    scriptPath: join(isolatedRoot, "scripts", "import-school-curriculum.mjs"),
    curriculumPath: isolatedCurriculumPath,
    cwd: isolatedRoot,
  };
  for (const runNumber of [1, 2]) {
    const result = runImporter(databasePath, isolatedOptions);
    assert.equal(
      result.status,
      0,
      `Изолированный импорт №${runNumber} завершился с ошибкой:\n${result.stdout}${result.stderr}`,
    );
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|exceljs/i);
    assert.match(
      result.stdout,
      runNumber === 1
        ? /SCHOOL_CURRICULUM_IMPORT=SUCCESS/
        : /SCHOOL_CURRICULUM_IMPORT=ALREADY_APPLIED/,
    );
    assert.match(result.stdout, /SCHOOL_CURRICULUM_AVAILABLE_SLOTS=171/);
    assert.match(result.stdout, /SCHOOL_CURRICULUM_UNUSED_SLOTS=1/);
  }

  const verificationDb = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(
    plainRows(
      verificationDb
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM programs) AS programs,
            (SELECT COUNT(*) FROM program_imports) AS imports,
            (SELECT COUNT(*) FROM program_topics) AS topics,
            (SELECT COUNT(*) FROM program_topic_sessions) AS sessions`,
        )
        .get(),
    ),
    { programs: 1, imports: 1, topics: 170, sessions: 170 },
  );
  verificationDb.close();
});

test("offline image overlays the ExcelJS-free release importer", () => {
  const dockerfile = readFileSync(
    join(repositoryRoot, "deploy", "Dockerfile.offline"),
    "utf8",
  );
  const archiveOverlay = dockerfile.indexOf(
    "tar -xzf /tmp/school-runtime-v5-delta.tar.gz -C /school",
  );
  const helperOverlay = dockerfile.indexOf(
    "COPY --chown=node:node lib/curriculum-allocation.mjs /school/lib/curriculum-allocation.mjs",
  );
  const importerOverlay = dockerfile.indexOf(
    "COPY --chown=node:node scripts/import-school-curriculum.mjs /school/scripts/import-school-curriculum.mjs",
  );
  const runtimeUser = dockerfile.indexOf("USER node");
  assert.ok(archiveOverlay >= 0);
  assert.ok(helperOverlay > archiveOverlay);
  assert.ok(importerOverlay > archiveOverlay);
  assert.ok(runtimeUser > helperOverlay);
  assert.ok(runtimeUser > importerOverlay);
});

test("approved 170-hour math KTP is imported once across the full 2026/27 calendar", (t) => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "school-curriculum-release-"),
  );
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));
  const databasePath = join(temporaryDirectory, "school.sqlite");

  const setupDb = new DatabaseSync(databasePath);
  applyMigrations(setupDb);
  setupDb.exec("PRAGMA foreign_keys = ON");
  seedCurriculumDependencies(setupDb);
  setupDb.close();

  const firstRun = runImporter(databasePath);
  assert.equal(
    firstRun.status,
    0,
    `Первый импорт завершился с ошибкой:\n${firstRun.stdout}${firstRun.stderr}`,
  );
  assert.match(firstRun.stdout, /SCHOOL_CALENDAR_IMPORT=SUCCESS/);
  assert.match(firstRun.stdout, /SCHOOL_CURRICULUM_IMPORT=SUCCESS/);
  assert.match(firstRun.stdout, /SCHOOL_CURRICULUM_AVAILABLE_SLOTS=171/);
  assert.match(firstRun.stdout, /SCHOOL_CURRICULUM_UNUSED_SLOTS=1/);
  assert.match(firstRun.stdout, /SCHOOL_CURRICULUM_RESERVE_DATE=2027-05-31/);

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  assert.deepEqual(
    plainRows(
      db.prepare(
        `SELECT id, title, starts_on AS startsOn, ends_on AS endsOn
         FROM academic_calendar_periods
         WHERE academic_year = '2026/27' AND kind = 'vacation'
         ORDER BY starts_on`,
      )
      .all(),
    ),
    [
      {
        id: "vacation-autumn-2026",
        title: "Осенние каникулы",
        startsOn: "2026-10-26",
        endsOn: "2026-11-03",
      },
      {
        id: "vacation-winter-2026",
        title: "Зимние каникулы",
        startsOn: "2026-12-31",
        endsOn: "2027-01-10",
      },
      {
        id: "vacation-february-2027",
        title: "Дополнительные каникулы",
        startsOn: "2027-02-15",
        endsOn: "2027-02-21",
      },
      {
        id: "vacation-spring-2027",
        title: "Весенние каникулы",
        startsOn: "2027-03-27",
        endsOn: "2027-04-04",
      },
    ],
  );

  assert.deepEqual(
    plainRows(
      db.prepare(
        `SELECT id, status, planned_lessons AS plannedLessons
         FROM programs
         WHERE academic_year = '2026/27' AND class_name = '2'
           AND subject_id = 'math' AND teacher_user_id = 'teacher-nasyrova'`,
      )
      .get(),
    ),
    {
      id: "existing-program-2-math",
      status: "active",
      plannedLessons: 170,
    },
  );
  assert.deepEqual(
    plainRows(
      db.prepare(
        `SELECT row_count AS rowCount, required_hours AS requiredHours,
          available_slots AS availableSlots, scheduled_hours AS scheduledHours,
          unscheduled_hours AS unscheduledHours,
          validation_status AS validationStatus
         FROM program_imports`,
      )
      .get(),
    ),
    {
      rowCount: 170,
      requiredHours: 170,
      availableSlots: 171,
      scheduledHours: 170,
      unscheduledHours: 0,
      validationStatus: "reserve",
    },
  );
  assert.deepEqual(
    plainRows(
      db.prepare(
        `SELECT COUNT(*) AS topics, SUM(planned_hours) AS hours,
          MIN(sort_order) AS firstOrder, MAX(sort_order) AS lastOrder
         FROM program_topics
         WHERE program_id = 'existing-program-2-math'`,
      )
      .get(),
    ),
    { topics: 170, hours: 170, firstOrder: 1, lastOrder: 170 },
  );
  assert.deepEqual(
    plainRows(
      db.prepare(
        `SELECT COUNT(*) AS sessions,
          SUM(CASE WHEN scheduled_date IS NULL THEN 1 ELSE 0 END) AS unscheduled,
          MIN(scheduled_date) AS firstDate, MAX(scheduled_date) AS lastDate,
          SUM(CASE WHEN scheduled_date = '2027-05-31' THEN 1 ELSE 0 END) AS reserveUsed
         FROM program_topic_sessions
         WHERE program_id = 'existing-program-2-math'`,
      )
      .get(),
    ),
    {
      sessions: 170,
      unscheduled: 0,
      firstDate: "2026-09-01",
      lastDate: "2027-05-28",
      reserveUsed: 0,
    },
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM program_topic_sessions ps
         JOIN academic_calendar_periods ap
           ON ps.scheduled_date BETWEEN ap.starts_on AND ap.ends_on
         WHERE ps.program_id = 'existing-program-2-math'
           AND ap.academic_year = '2026/27'
           AND ap.kind IN ('vacation', 'holiday', 'non_instruction')`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM program_topic_sessions ps
         JOIN lessons l ON l.id = ps.template_lesson_id
         WHERE ps.program_id = 'existing-program-2-math'
           AND CAST(strftime('%w', ps.scheduled_date) AS INTEGER) = l.weekday`,
      )
      .get().count,
    170,
  );
  assert.deepEqual(
    plainRows(
      db.prepare(
        `SELECT pt.sequence, pt.topic, ps.scheduled_date AS scheduledDate
         FROM program_topics pt
         JOIN program_topic_sessions ps ON ps.topic_id = pt.id
         WHERE pt.program_id = 'existing-program-2-math'
           AND pt.sort_order IN (1, 170)
         ORDER BY pt.sort_order`,
      )
      .all(),
    ),
    [
      {
        sequence: "1",
        topic: "Повторение. Цепочки.",
        scheduledDate: "2026-09-01",
      },
      {
        sequence: "170",
        topic: "Работа над ошибками. Обобщение знаний.",
        scheduledDate: "2027-05-28",
      },
    ],
  );
  db.close();

  const lifecycleDb = new DatabaseSync(databasePath);
  lifecycleDb
    .prepare(
      `UPDATE programs
       SET status = 'changes_requested', review_comment = 'Уточнить формулировку темы'`,
    )
    .run();
  lifecycleDb
    .prepare(
      `INSERT INTO program_imports
        (id, program_id, file_name, sheet_name, imported_by_user_id, row_count,
          required_hours, available_slots, scheduled_hours, unscheduled_hours,
          validation_status)
       VALUES
        ('program-import-teacher-revision', 'existing-program-2-math',
          'КТП уточнённое.xlsx', 'КТП', 'teacher-nasyrova', 170,
          170, 171, 170, 0, 'reserve')`,
    )
    .run();
  lifecycleDb.close();

  const secondRun = runImporter(databasePath);
  assert.equal(
    secondRun.status,
    0,
    `Повторный импорт завершился с ошибкой:\n${secondRun.stdout}${secondRun.stderr}`,
  );
  assert.match(secondRun.stdout, /SCHOOL_CALENDAR_IMPORT=ALREADY_APPLIED/);
  assert.match(secondRun.stdout, /SCHOOL_CURRICULUM_IMPORT=ALREADY_APPLIED/);

  const verificationDb = new DatabaseSync(databasePath);
  assert.deepEqual(
    plainRows(
      verificationDb.prepare(
        `SELECT
          (SELECT COUNT(*) FROM academic_calendar_periods) AS periods,
          (SELECT COUNT(*) FROM programs) AS programs,
          (SELECT COUNT(*) FROM program_imports) AS imports,
          (SELECT COUNT(*) FROM program_topics) AS topics,
          (SELECT COUNT(*) FROM program_topic_sessions) AS sessions,
          (SELECT status FROM programs LIMIT 1) AS status,
          (SELECT review_comment FROM programs LIMIT 1) AS reviewComment`,
      )
      .get(),
    ),
    {
      periods: 4,
      programs: 1,
      imports: 2,
      topics: 170,
      sessions: 170,
      status: "changes_requested",
      reviewComment: "Уточнить формулировку темы",
    },
  );
  verificationDb.close();
});

test("release import removes only extra 2026/27 vacations", (t) => {
  const { databasePath, db } = createSeededDatabase(
    t,
    "school-curriculum-extra-vacation-",
  );
  db.prepare(
    `INSERT INTO academic_calendar_periods
      (id, academic_year, kind, title, starts_on, ends_on)
     VALUES
      ('vacation-obsolete-2026', '2026/27', 'vacation', 'Устаревшие каникулы', '2026-09-14', '2026-09-18'),
      ('holiday-preserved-2026', '2026/27', 'holiday', 'Праздник', '2026-09-06', '2026-09-06'),
      ('vacation-other-year', '2025/26', 'vacation', 'Каникулы другого года', '2025-10-27', '2025-11-02')`,
  ).run();
  db.close();

  const result = runImporter(databasePath);
  assert.equal(
    result.status,
    0,
    `Импорт с устаревшими каникулами завершился с ошибкой:\n${result.stdout}${result.stderr}`,
  );

  const verificationDb = new DatabaseSync(databasePath);
  assert.deepEqual(
    verificationDb
      .prepare(
        `SELECT id FROM academic_calendar_periods
         WHERE academic_year = '2026/27' AND kind = 'vacation'
         ORDER BY id`,
      )
      .all()
      .map((row) => row.id),
    [
      "vacation-autumn-2026",
      "vacation-february-2027",
      "vacation-spring-2027",
      "vacation-winter-2026",
    ],
  );
  assert.deepEqual(
    plainRows(
      verificationDb
        .prepare(
          `SELECT id, academic_year AS academicYear, kind
           FROM academic_calendar_periods
           WHERE id IN ('holiday-preserved-2026', 'vacation-other-year')
           ORDER BY id`,
        )
        .all(),
    ),
    [
      {
        id: "holiday-preserved-2026",
        academicYear: "2026/27",
        kind: "holiday",
      },
      {
        id: "vacation-other-year",
        academicYear: "2025/26",
        kind: "vacation",
      },
    ],
  );
  verificationDb.close();
});

test("failed strict verification rolls back calendar and KTP mutations", (t) => {
  const { databasePath, db } = createSeededDatabase(
    t,
    "school-curriculum-rollback-",
  );
  db.prepare(
    `INSERT INTO academic_calendar_periods
      (id, academic_year, kind, title, starts_on, ends_on)
     VALUES
      ('vacation-autumn-2026', '2026/27', 'vacation', 'Старые осенние каникулы', '2026-10-25', '2026-11-02'),
      ('vacation-obsolete-2026', '2026/27', 'vacation', 'Устаревшие каникулы', '2026-09-14', '2026-09-18')`,
  ).run();
  db.exec(
    `CREATE TRIGGER force_curriculum_verify_failure
     AFTER INSERT ON program_topic_sessions
     WHEN NEW.id LIKE '%-topic-001-session-01'
     BEGIN
       UPDATE program_topic_sessions
       SET scheduled_date = '2026-10-26'
       WHERE id = NEW.id;
     END`,
  );
  db.close();

  const result = runImporter(databasePath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Контроль КТП не пройден/);

  const verificationDb = new DatabaseSync(databasePath);
  assert.deepEqual(
    plainRows(
      verificationDb
        .prepare(
          `SELECT id, title, starts_on AS startsOn, ends_on AS endsOn
           FROM academic_calendar_periods
           ORDER BY id`,
        )
        .all(),
    ),
    [
      {
        id: "vacation-autumn-2026",
        title: "Старые осенние каникулы",
        startsOn: "2026-10-25",
        endsOn: "2026-11-02",
      },
      {
        id: "vacation-obsolete-2026",
        title: "Устаревшие каникулы",
        startsOn: "2026-09-14",
        endsOn: "2026-09-18",
      },
    ],
  );
  assert.deepEqual(
    plainRows(
      verificationDb
        .prepare(
          `SELECT title, status, planned_lessons AS plannedLessons
           FROM programs WHERE id = 'existing-program-2-math'`,
        )
        .get(),
    ),
    { title: "Черновик", status: "draft", plannedLessons: 0 },
  );
  assert.deepEqual(
    plainRows(
      verificationDb
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM program_imports) AS imports,
            (SELECT COUNT(*) FROM program_topics) AS topics,
            (SELECT COUNT(*) FROM program_topic_sessions) AS sessions`,
        )
        .get(),
    ),
    { imports: 0, topics: 0, sessions: 0 },
  );
  verificationDb.close();
});

test("release schedule import preserves lessons outside source classes", (t) => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "school-schedule-scope-"),
  );
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));
  const databasePath = join(temporaryDirectory, "school.sqlite");
  const schedulePath = join(
    repositoryRoot,
    "data/schedules/school-1-11-2026-2027.json",
  );
  const payload = JSON.parse(readFileSync(schedulePath, "utf8"));
  const db = new DatabaseSync(databasePath);
  applyMigrations(db);
  db.exec("PRAGMA foreign_keys = ON");
  const insertSubject = db.prepare(
    `INSERT INTO subjects
      (id, name, short_name, color, icon, stage, weekly_hours, status)
     VALUES (?, ?, ?, '#5f56ee', 'book', '1–11', 1, 'active')`,
  );
  const subjectIds = new Set([
    ...payload.lessons.map((lesson) => lesson.subjectId),
    ...(payload.specialArrangements ?? []).map((item) => item.subjectId),
  ]);
  for (const subjectId of subjectIds)
    insertSubject.run(subjectId, subjectId, subjectId);
  db.prepare(
    `INSERT INTO users
      (id, email, display_name, role, status, profile_status)
     VALUES (
       'teacher-archived-sentinel', 'archived@example.test',
       'Архивный преподаватель', 'teacher', 'archived', 'confirmed'
     )`,
  ).run();
  db.prepare(
    `INSERT INTO teacher_assignments
      (id, teacher_user_id, class_name, subject_id, status)
     VALUES (
       'assignment-archived-sentinel', 'teacher-archived-sentinel', ?, ?,
       'confirmed'
     )`,
  ).run(payload.lessons[0].className, payload.lessons[0].subjectId);
  db.prepare(
    `INSERT INTO lessons
      (id, class_name, weekday, starts_at, ends_at, subject_id,
        teacher_user_id, room, status, note)
     VALUES (
       'schedule-2026-2027-7-1-1-1', '7', 1, '08:00', '08:40',
       ?, NULL, '207', 'scheduled', 'Существующее расписание 7 класса'
     )`,
  ).run(payload.lessons[0].subjectId);
  const before = plainRows(
    db.prepare(
      `SELECT id, class_name AS className, weekday, starts_at AS startsAt,
        ends_at AS endsAt, subject_id AS subjectId,
        teacher_user_id AS teacherUserId, room, status, note,
        created_at AS createdAt, updated_at AS updatedAt
       FROM lessons WHERE id = 'schedule-2026-2027-7-1-1-1'`,
    ).get(),
  );
  db.close();

  const result = spawnSync(
    process.execPath,
    ["scripts/import-school-schedule.mjs", schedulePath],
    {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_PATH: databasePath },
      encoding: "utf8",
    },
  );
  assert.equal(
    result.status,
    0,
    `Импорт расписания завершился с ошибкой:\n${result.stdout}${result.stderr}`,
  );
  assert.match(result.stdout, /SCHOOL_SCHEDULE_IMPORT=SUCCESS/);

  const verificationDb = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    verificationDb.prepare(
      `SELECT teacher_user_id AS teacherUserId
       FROM lessons WHERE id = ?`,
    ).get(payload.lessons[0].id).teacherUserId,
    null,
  );
  const after = plainRows(
    verificationDb.prepare(
      `SELECT id, class_name AS className, weekday, starts_at AS startsAt,
        ends_at AS endsAt, subject_id AS subjectId,
        teacher_user_id AS teacherUserId, room, status, note,
        created_at AS createdAt, updated_at AS updatedAt
       FROM lessons WHERE id = 'schedule-2026-2027-7-1-1-1'`,
    ).get(),
  );
  assert.deepEqual(after, before);
  assert.equal(
    verificationDb.prepare(
      `SELECT COUNT(*) AS count FROM lessons
       WHERE class_name IN ('1','2','3','4','5','6')
         AND status = 'scheduled'`,
    ).get().count,
    189,
  );
  verificationDb.close();
});
