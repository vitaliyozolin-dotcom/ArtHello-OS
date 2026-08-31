import type { ActionKind, Role, SchoolSnapshot } from "../../level-zero-types";
import {
  assertSameOrigin,
  createCredentialToken,
  getSessionUser,
  normalizePhone,
} from "../../../server/auth";
import { ensureDatabaseReady, getDatabase } from "../../../server/database";
import {
  allocateCurriculumRows,
  buildScheduleSlots,
  parseCurriculumWorkbook,
} from "../../../lib/curriculum-import.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const validRoles = new Set<Role>([
  "director",
  "deputy",
  "admin",
  "teacher",
  "parent",
  "student",
  "tech_admin",
]);
const familyRoles = new Set<Role>(["parent", "student"]);
const leadershipRoles = new Set<Role>(["director", "deputy"]);
const operationalRoles = new Set<Role>(["director", "deputy", "admin"]);
const teacherActions = new Set<ActionKind>([
  "grade.create",
  "homework.create",
  "achievement.create",
  "comment.create",
  "attendance.mark",
  "program.upsert",
  "program.import",
  "program.reschedule",
]);
const adminActions = new Set<ActionKind>([
  "family.registration.approve",
  "user.invite",
  "student.create",
  "lesson.upsert",
  "lesson.delete",
  "lesson.copy-day",
  "event.create",
  "menu.update",
  "activity.create",
  "subscription.upsert",
]);
const publicRegistrationActions = new Set<ActionKind>([
  "family.registration.claim",
  "family.registration.request",
]);
const centralDirectoryActions = new Set<ActionKind>([
  "family.invite.create",
  "family.registration.claim",
  "family.registration.request",
  "family.registration.approve",
  "user.invite",
  "user.password.reset",
  "student.create",
]);
let structureReady = false;

type UserRow = {
  id: string;
  email: string;
  phone: string;
  displayName: string;
  role: Role;
  linkedStudentId: string | null;
  status: string;
};

type RequestBody = Record<string, unknown> & {
  action?: ActionKind;
};

type AuthenticatedIdentity = {
  userId: string;
  email: string;
  phone: string;
  displayName: string;
};

type InvitationRow = {
  id: string;
  targetRole: "parent" | "student";
  studentId: string | null;
  studentName: string | null;
  className: string | null;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  status: string;
};

const SCHOOL_CLASSES = [
  {
    id: "class-1",
    name: "1",
    grade: 1,
    homeroomTeacherUserId: "teacher-ivanova",
  },
  {
    id: "class-2",
    name: "2",
    grade: 2,
    homeroomTeacherUserId: "teacher-nasyrova",
  },
  {
    id: "class-3",
    name: "3",
    grade: 3,
    homeroomTeacherUserId: "teacher-chukovskaya",
  },
  {
    id: "class-4",
    name: "4",
    grade: 4,
    homeroomTeacherUserId: "teacher-sotkina",
  },
  { id: "class-5", name: "5", grade: 5, homeroomTeacherUserId: null },
  { id: "class-6", name: "6", grade: 6, homeroomTeacherUserId: null },
] as const;

const ACADEMIC_YEAR = {
  id: "2026/27",
  startsOn: "2026-09-01",
  endsOn: "2027-05-31",
} as const;

const ACADEMIC_CALENDAR_PERIODS = [
  { id: "vacation-autumn-2026", title: "Осенние каникулы", startsOn: "2026-10-26", endsOn: "2026-11-03" },
  { id: "vacation-winter-2026", title: "Зимние каникулы", startsOn: "2026-12-31", endsOn: "2027-01-10" },
  { id: "vacation-february-2027", title: "Дополнительные каникулы", startsOn: "2027-02-15", endsOn: "2027-02-21" },
  { id: "vacation-spring-2027", title: "Весенние каникулы", startsOn: "2027-03-27", endsOn: "2027-04-04" },
] as const;

const SCHOOL_SUBJECTS = [
  {
    id: "math",
    name: "Математика",
    shortName: "Математика",
    color: "#6e5bd7",
    icon: "∑",
    stage: "1–6",
  },
  {
    id: "russian",
    name: "Русский язык",
    shortName: "Русский",
    color: "#df5c73",
    icon: "А",
    stage: "1–6",
  },
  {
    id: "reading",
    name: "Литературное чтение",
    shortName: "Чтение",
    color: "#cf7b45",
    icon: "Ч",
    stage: "1–4",
  },
  {
    id: "world",
    name: "Окружающий мир",
    shortName: "Окр. мир",
    color: "#5a9b4c",
    icon: "◎",
    stage: "1–4",
  },
  {
    id: "creative",
    name: "Творческие технологии",
    shortName: "Технологии",
    color: "#c56aa2",
    icon: "Т",
    stage: "1–6",
  },
  {
    id: "geography",
    name: "География",
    shortName: "География",
    color: "#278f86",
    icon: "Г",
    stage: "5–6",
  },
  {
    id: "pe",
    name: "Физическая культура",
    shortName: "Физкультура",
    color: "#2d9b62",
    icon: "⚽",
    stage: "1–6",
  },
  {
    id: "ai",
    name: "AI-мышление",
    shortName: "AI-мышление",
    color: "#267fb0",
    icon: "AI",
    stage: "1–6",
  },
  {
    id: "literature",
    name: "Литература",
    shortName: "Литература",
    color: "#b66f3e",
    icon: "Л",
    stage: "5–6",
  },
  {
    id: "history",
    name: "История",
    shortName: "История",
    color: "#b9853d",
    icon: "И",
    stage: "5–6",
  },
  {
    id: "musical-theatre",
    name: "Музыкальный театр",
    shortName: "Муз. театр",
    color: "#a15dc7",
    icon: "М",
    stage: "1–6",
  },
  {
    id: "literary-club",
    name: "Литературный клуб",
    shortName: "Лит. клуб",
    color: "#8b6a49",
    icon: "К",
    stage: "1–6",
  },
  {
    id: "swimming",
    name: "Бассейн",
    shortName: "Бассейн",
    color: "#318fc2",
    icon: "≈",
    stage: "1–6",
  },
  {
    id: "english",
    name: "Английский язык",
    shortName: "English",
    color: "#4d74c9",
    icon: "En",
    stage: "1–6",
  },
] as const;

const STAFF_PROFILES = [
  {
    id: "teacher-ivanova",
    email: "staff.ivanova@school.local",
    displayName: "Иванова Анастасия Андреевна",
    profileStatus: "confirmed",
    notes: "Учитель 1 класса",
  },
  {
    id: "teacher-nasyrova",
    email: "staff.nasyrova@school.local",
    displayName: "Насырова Надежда Юрьевна",
    profileStatus: "confirmed",
    notes: "Учитель 2 класса; русский язык в 5–6 классах",
  },
  {
    id: "teacher-chukovskaya",
    email: "staff.chukovskaya@school.local",
    displayName: "Чуковская Анна Николаевна",
    profileStatus: "confirmed",
    notes: "Учитель 3 класса; география в 5–6 классах",
  },
  {
    id: "teacher-sotkina",
    email: "staff.sotkina@school.local",
    displayName: "Соткина Ксения Болеславовна",
    profileStatus: "confirmed",
    notes: "Учитель 4 класса; математика в 5–6 классах",
  },
  {
    id: "teacher-alexyunina",
    email: "staff.alexyunina@school.local",
    displayName: "Алексюнина Анастасия Витальевна",
    profileStatus: "unconfirmed",
    notes: "Кандидат пока не утверждён",
  },
  {
    id: "teacher-ozolina",
    email: "staff.ozolina@school.local",
    displayName: "Озолина Алина Владиславовна",
    profileStatus: "confirmed",
    notes: "Физическая культура, 1–6 классы",
  },
  {
    id: "teacher-rottsy",
    email: "staff.rottsy@school.local",
    displayName: "Ротцы Анна Максимовна",
    profileStatus: "confirmed",
    notes: "AI-мышление, 1–6 классы",
  },
  {
    id: "teacher-komova",
    email: "staff.komova@school.local",
    displayName: "Комова Наталья Юрьевна",
    profileStatus: "confirmed",
    notes: "Литература и история, 5–6 классы",
  },
  {
    id: "teacher-curator-2",
    email: "staff.curator-2@school.local",
    displayName: "Куратор №2",
    profileStatus: "vacant",
    notes: "ФИО не определено; музыкальный театр и литературный клуб",
  },
  {
    id: "teacher-fedorov",
    email: "staff.fedorov@school.local",
    displayName: "Федоров Павел Олегович",
    profileStatus: "confirmed",
    notes: "Бассейн, 1–6 классы",
  },
  {
    id: "teacher-english-primary",
    email: "staff.english-primary@school.local",
    displayName: "Педагог английского 1–4",
    profileStatus: "vacant",
    notes: "ФИО не определено",
  },
  {
    id: "teacher-english-secondary",
    email: "staff.english-secondary@school.local",
    displayName: "Дмитриевна Наталья Витальевна",
    profileStatus: "needs_confirmation",
    notes: "ФИО сохранено как передано; требуется уточнить фамилию",
  },
] as const;

type AssignmentGroup = {
  teacherUserId: string;
  classes: string[];
  subjects: string[];
  status?: string;
  notes?: string;
};

const ASSIGNMENT_GROUPS: AssignmentGroup[] = [
  {
    teacherUserId: "teacher-ivanova",
    classes: ["1"],
    subjects: ["math", "russian", "reading", "world", "creative"],
  },
  {
    teacherUserId: "teacher-nasyrova",
    classes: ["2"],
    subjects: ["math", "russian", "reading", "world"],
  },
  {
    teacherUserId: "teacher-nasyrova",
    classes: ["5", "6"],
    subjects: ["russian"],
  },
  {
    teacherUserId: "teacher-chukovskaya",
    classes: ["3"],
    subjects: ["math", "russian", "reading", "world"],
  },
  {
    teacherUserId: "teacher-chukovskaya",
    classes: ["5", "6"],
    subjects: ["geography"],
  },
  {
    teacherUserId: "teacher-sotkina",
    classes: ["4"],
    subjects: ["math", "russian", "reading", "world"],
  },
  { teacherUserId: "teacher-sotkina", classes: ["5", "6"], subjects: ["math"] },
  {
    teacherUserId: "teacher-alexyunina",
    classes: ["2", "3", "4", "5", "6"],
    subjects: ["creative"],
    status: "unconfirmed",
    notes: "Кандидат пока не утверждён",
  },
  {
    teacherUserId: "teacher-ozolina",
    classes: ["1", "2", "3", "4", "5", "6"],
    subjects: ["pe"],
  },
  {
    teacherUserId: "teacher-rottsy",
    classes: ["1", "2", "3", "4", "5", "6"],
    subjects: ["ai"],
  },
  {
    teacherUserId: "teacher-komova",
    classes: ["5", "6"],
    subjects: ["literature", "history"],
  },
  {
    teacherUserId: "teacher-curator-2",
    classes: ["1", "2", "3", "4", "5", "6"],
    subjects: ["musical-theatre", "literary-club"],
    status: "vacant",
    notes: "Педагог не назначен",
  },
  {
    teacherUserId: "teacher-fedorov",
    classes: ["1", "2", "3", "4", "5", "6"],
    subjects: ["swimming"],
  },
  {
    teacherUserId: "teacher-english-primary",
    classes: ["1", "2", "3", "4"],
    subjects: ["english"],
    status: "vacant",
    notes: "Педагог не назначен",
  },
  {
    teacherUserId: "teacher-english-secondary",
    classes: ["5", "6"],
    subjects: ["english"],
    status: "needs_confirmation",
    notes: "Требуется уточнить ФИО",
  },
];

const STAFF_ASSIGNMENTS = ASSIGNMENT_GROUPS.flatMap((group) =>
  group.classes.flatMap((className) =>
    group.subjects.map((subjectId) => ({
      id: `assignment-${group.teacherUserId}-${className}-${subjectId}`,
      teacherUserId: group.teacherUserId,
      className,
      subjectId,
      status: group.status ?? "confirmed",
      notes: group.notes ?? "",
    })),
  ),
);

function textValue(value: unknown, max = 500, required = true) {
  const result = typeof value === "string" ? value.trim().slice(0, max) : "";
  if (required && !result) throw new Error("Заполните обязательные поля");
  return result;
}

function numberValue(value: unknown, minimum: number, maximum: number) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error("Проверьте числовое значение");
  }
  return Math.round(result);
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("ru-RU"))
      .join("") || "11"
  );
}

async function database() {
  return getDatabase();
}

async function ensureRuntimeSchema() {
  await ensureDatabaseReady();
}

async function ensureSchoolStructure() {
  if (structureReady) return;
  await ensureRuntimeSchema();
  const db = await database();
  const statements = [
    ...SCHOOL_SUBJECTS.map((subject) =>
      db
        .prepare(
          `INSERT INTO subjects
      (id, name, short_name, color, icon, stage, weekly_hours, status)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'active')
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name,
        color = excluded.color, icon = excluded.icon, stage = excluded.stage,
        weekly_hours = excluded.weekly_hours, status = 'active', updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          subject.id,
          subject.name,
          subject.shortName,
          subject.color,
          subject.icon,
          subject.stage,
        ),
    ),
    ...STAFF_PROFILES.map((staff) =>
      db
        .prepare(
          `INSERT INTO users
      (id, email, display_name, role, linked_student_id, status, profile_status, notes)
      VALUES (?, ?, ?, 'teacher', NULL, 'setup', ?, ?)
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, role = 'teacher',
        profile_status = excluded.profile_status, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          staff.id,
          staff.email,
          staff.displayName,
          staff.profileStatus,
          staff.notes,
        ),
    ),
    ...SCHOOL_CLASSES.map((schoolClass) =>
      db
        .prepare(
          `INSERT INTO school_classes
      (id, name, grade, homeroom_teacher_user_id, status)
      VALUES (?, ?, ?, ?, 'active')
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, grade = excluded.grade,
        homeroom_teacher_user_id = excluded.homeroom_teacher_user_id,
        status = 'active', updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          schoolClass.id,
          schoolClass.name,
          schoolClass.grade,
          schoolClass.homeroomTeacherUserId,
        ),
    ),
    ...STAFF_ASSIGNMENTS.map((assignment) =>
      db
        .prepare(
          `INSERT INTO teacher_assignments
      (id, teacher_user_id, class_name, subject_id, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET teacher_user_id = excluded.teacher_user_id,
        class_name = excluded.class_name, subject_id = excluded.subject_id,
        status = excluded.status, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          assignment.id,
          assignment.teacherUserId,
          assignment.className,
          assignment.subjectId,
          assignment.status,
          assignment.notes,
        ),
    ),
    ...ACADEMIC_CALENDAR_PERIODS.map((period) =>
      db
        .prepare(
          `INSERT INTO academic_calendar_periods
      (id, academic_year, kind, title, starts_on, ends_on)
      VALUES (?, ?, 'vacation', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET academic_year = excluded.academic_year,
        kind = excluded.kind, title = excluded.title, starts_on = excluded.starts_on,
        ends_on = excluded.ends_on, updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(period.id, ACADEMIC_YEAR.id, period.title, period.startsOn, period.endsOn),
    ),
    db.prepare(
      "UPDATE subjects SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id IN ('algebra', 'geometry', 'social', 'physics', 'chemistry', 'biology')",
    ),
    db.prepare(
      "UPDATE users SET status = 'archived', profile_status = 'demo', notes = 'Архивная тестовая запись' WHERE id IN ('user-admin-demo', 'user-parent-demo', 'user-teacher-demo', 'user-student-demo')",
    ),
    db.prepare(
      "UPDATE students SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id IN ('student-alexander', 'student-polina', 'student-maxim', 'student-sofia')",
    ),
    db.prepare(
      "UPDATE lessons SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE class_name = '7Б'",
    ),
    db.prepare(
      "UPDATE homework SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE class_name = '7Б'",
    ),
    db.prepare(
      "DELETE FROM menu_days WHERE id IN ('menu-2026-08-11', 'menu-2026-08-12', 'menu-2026-08-13')",
    ),
    db.prepare(
      "DELETE FROM events WHERE id IN ('event-1', 'event-2', 'event-3')",
    ),
    db.prepare(
      "DELETE FROM activities WHERE id IN ('activity-1', 'activity-2', 'activity-3')",
    ),
  ];
  await db.batch(statements);
  structureReady = true;
}

async function authenticatedIdentity(
  request: Request,
): Promise<AuthenticatedIdentity | null> {
  const user = await getSessionUser(request);
  return user
    ? {
        userId: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
      }
    : null;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function invitationForToken(token: string) {
  if (!token || token.length < 16 || token.length > 180) return null;
  const db = await database();
  return db
    .prepare(
      `SELECT i.id, i.target_role AS targetRole, i.student_id AS studentId,
      CASE WHEN st.id IS NULL THEN NULL ELSE st.first_name || ' ' || st.last_name END AS studentName,
      COALESCE(i.class_name, st.class_name) AS className, i.expires_at AS expiresAt,
      i.max_uses AS maxUses, i.used_count AS usedCount, i.status
    FROM account_invitations i
    LEFT JOIN students st ON st.id = i.student_id
    WHERE i.token_hash = ?`,
    )
    .bind(await sha256(token))
    .first<InvitationRow>();
}

async function findActor(request: Request): Promise<UserRow | null> {
  return getSessionUser(request);
}

async function visibleStudentIds(viewer: UserRow) {
  const db = await database();
  if (operationalRoles.has(viewer.role)) {
    const rows = await db
      .prepare(
        "SELECT id FROM students WHERE status = 'active' ORDER BY class_name, last_name",
      )
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }
  if (viewer.role === "teacher") {
    const rows = await db
      .prepare(
        `SELECT DISTINCT st.id
      FROM students st JOIN teacher_assignments a ON a.class_name = st.class_name
      WHERE a.teacher_user_id = ? AND a.status = 'confirmed' AND st.status = 'active'
      ORDER BY st.class_name, st.last_name`,
      )
      .bind(viewer.id)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }
  const rows = await db
    .prepare(
      "SELECT student_id AS id FROM user_student_links WHERE user_id = ?",
    )
    .bind(viewer.id)
    .all<{ id: string }>();
  const ids = rows.results.map((row) => row.id);
  if (viewer.linkedStudentId && !ids.includes(viewer.linkedStudentId))
    ids.push(viewer.linkedStudentId);
  return ids;
}

async function rows<T>(query: string, bindings: unknown[] = []) {
  const db = await database();
  let statement = db.prepare(query);
  if (bindings.length) statement = statement.bind(...bindings);
  const result = await statement.all<T>();
  return result.results;
}

const RANKING_ANIMALS = [
  ["🦊", "Лиса"], ["🐼", "Панда"], ["🦉", "Сова"], ["🐯", "Тигр"],
  ["🐬", "Дельфин"], ["🦁", "Лев"], ["🐨", "Коала"], ["🐰", "Кролик"],
  ["🐢", "Черепаха"], ["🦝", "Енот"], ["🐧", "Пингвин"], ["🦋", "Бабочка"],
  ["🐙", "Осьминог"], ["🦄", "Единорог"], ["🐸", "Лягушка"], ["🐻", "Медведь"],
  ["🦦", "Выдра"], ["🐺", "Волк"], ["🦥", "Ленивец"], ["🦔", "Ёж"],
  ["🐘", "Слон"], ["🦒", "Жираф"], ["🦓", "Зебра"], ["🐆", "Леопард"],
  ["🐊", "Крокодил"], ["🐳", "Кит"], ["🐝", "Пчела"], ["🐞", "Божья коровка"],
  ["🦜", "Попугай"], ["🦩", "Фламинго"], ["🐿️", "Белка"], ["🦌", "Олень"],
] as const;

type RankingStudentRow = {
  id: string;
  fullName: string;
  className: string;
};

type RankingGradeRow = {
  studentId: string;
  subjectId: string;
  subjectName: string;
  value: number;
  weight: number;
};

type RankingScore = {
  studentId: string;
  fullName: string;
  score: number;
  gradeCount: number;
};

function rankScores(scores: RankingScore[]) {
  const sorted = [...scores].sort(
    (left, right) =>
      right.score - left.score || left.fullName.localeCompare(right.fullName, "ru"),
  );
  let previousScore: number | null = null;
  let previousPosition = 0;
  return sorted.map((score, index) => {
    const position =
      previousScore !== null && Math.abs(score.score - previousScore) < 0.0001
        ? previousPosition
        : index + 1;
    previousScore = score.score;
    previousPosition = position;
    return { ...score, position };
  });
}

async function loadRankings(
  viewer: UserRow,
  selectedStudent: SchoolSnapshot["selectedStudent"],
): Promise<SchoolSnapshot["rankings"]> {
  const namedMode = leadershipRoles.has(viewer.role) || viewer.role === "teacher";
  const anonymousMode = viewer.role === "parent" && Boolean(selectedStudent);
  if (!namedMode && !anonymousMode) {
    return {
      mode: "none",
      classes: [],
      privacyNote: "Рейтинг недоступен этой роли.",
    };
  }

  let classNames: string[] = [];
  if (leadershipRoles.has(viewer.role)) {
    classNames = (
      await rows<{ name: string }>(
        "SELECT name FROM school_classes WHERE status = 'active' ORDER BY grade, name",
      )
    ).map((item) => item.name);
  } else if (viewer.role === "teacher") {
    classNames = (
      await rows<{ className: string }>(
        "SELECT DISTINCT class_name AS className FROM teacher_assignments WHERE teacher_user_id = ? AND status = 'confirmed' ORDER BY class_name",
        [viewer.id],
      )
    ).map((item) => item.className);
  } else if (selectedStudent) {
    classNames = [selectedStudent.className];
  }
  if (!classNames.length) {
    return {
      mode: namedMode ? "named" : "anonymous",
      classes: [],
      privacyNote: "Для рейтинга пока нет доступных классов.",
    };
  }

  const placeholders = classNames.map(() => "?").join(",");
  const rankingStudents = await rows<RankingStudentRow>(
    `SELECT id, first_name || ' ' || last_name AS fullName, class_name AS className
    FROM students WHERE status = 'active' AND class_name IN (${placeholders}) ORDER BY class_name, last_name, first_name`,
    classNames,
  );
  const studentIds = rankingStudents.map((student) => student.id);
  const studentPlaceholders = studentIds.map(() => "?").join(",") || "''";
  const rankingGrades = studentIds.length
    ? await rows<RankingGradeRow>(
        `SELECT g.student_id AS studentId, g.subject_id AS subjectId,
        s.name AS subjectName, g.value, g.weight
        FROM grades g JOIN subjects s ON s.id = g.subject_id
        WHERE g.student_id IN (${studentPlaceholders}) ORDER BY s.name`,
        studentIds,
      )
    : [];

  const classes: SchoolSnapshot["rankings"]["classes"] = [];
  for (const className of classNames) {
    const classStudents = rankingStudents.filter(
      (student) => student.className === className,
    );
    const classStudentIds = new Set(classStudents.map((student) => student.id));
    const classGrades = rankingGrades.filter((grade) =>
      classStudentIds.has(grade.studentId),
    );
    const subjectIndex = new Map<string, string>();
    classGrades.forEach((grade) =>
      subjectIndex.set(grade.subjectId, grade.subjectName),
    );

    const animalOrder = await Promise.all(
      classStudents.map(async (student) => ({
        studentId: student.id,
        key: await sha256(`${viewer.id}|${className}|${student.id}|2026/27`),
      })),
    );
    animalOrder.sort((left, right) => left.key.localeCompare(right.key));
    const animals = new Map(
      animalOrder.map((item, index) => [
        item.studentId,
        RANKING_ANIMALS[index % RANKING_ANIMALS.length],
      ]),
    );

    const scoreForSubject = (
      student: RankingStudentRow,
      subjectId: string | null,
    ): RankingScore | null => {
      if (subjectId) {
        const grades = classGrades.filter(
          (grade) =>
            grade.studentId === student.id && grade.subjectId === subjectId,
        );
        if (grades.length < 2) return null;
        const totalWeight = grades.reduce((sum, grade) => sum + grade.weight, 0);
        return {
          studentId: student.id,
          fullName: student.fullName,
          score:
            grades.reduce((sum, grade) => sum + grade.value * grade.weight, 0) /
            totalWeight,
          gradeCount: grades.length,
        };
      }
      const subjectScores = [...subjectIndex.keys()]
        .map((id) => scoreForSubject(student, id))
        .filter((score): score is RankingScore => Boolean(score));
      const gradeCount = subjectScores.reduce(
        (sum, score) => sum + score.gradeCount,
        0,
      );
      if (subjectScores.length < 2 || gradeCount < 5) return null;
      return {
        studentId: student.id,
        fullName: student.fullName,
        score:
          subjectScores.reduce((sum, score) => sum + score.score, 0) /
          subjectScores.length,
        gradeCount,
      };
    };

    const buildTable = (
      subjectId: string | null,
      label: string,
    ): SchoolSnapshot["rankings"]["classes"][number]["overall"] => {
      const ranked = rankScores(
        classStudents
          .map((student) => scoreForSubject(student, subjectId))
          .filter((score): score is RankingScore => Boolean(score)),
      );
      const own =
        ranked.find((entry) => entry.studentId === selectedStudent?.id) ?? null;
      return {
        id: subjectId ?? "overall",
        subjectId,
        label,
        minimumEvidence: subjectId
          ? "Не менее 2 оценок по предмету"
          : "Не менее 5 оценок по двум предметам",
        totalStudents: classStudents.length,
        eligibleStudents: ranked.length,
        ownPosition: own?.position ?? null,
        ownScore: own ? Number(own.score.toFixed(2)) : null,
        entries: ranked.map((entry) => {
          const isOwn = entry.studentId === selectedStudent?.id;
          const animal = animals.get(entry.studentId) ?? RANKING_ANIMALS[0];
          return {
            position: entry.position,
            studentId: namedMode ? entry.studentId : null,
            displayName: namedMode
              ? entry.fullName
              : isOwn
                ? "Ваш ребёнок"
                : null,
            animal: namedMode ? null : animal[0],
            animalLabel: namedMode ? null : animal[1],
            isOwn,
            score: Number(entry.score.toFixed(2)),
            gradeCount: namedMode || isOwn ? entry.gradeCount : null,
          };
        }),
      };
    };

    classes.push({
      className,
      overall: buildTable(null, "В среднем по всем предметам"),
      subjects: [...subjectIndex.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], "ru"))
        .map(([subjectId, label]) => buildTable(subjectId, label)),
    });
  }

  return {
    mode: namedMode ? "named" : "anonymous",
    classes,
    privacyNote: namedMode
      ? "Поимённый рейтинг доступен только директору, завучу и назначенному учителю в его классах."
      : "Имена и идентификаторы других детей удалены на сервере. Точные средние баллы открыты обезличенно, а образы животных различаются для каждой семьи.",
  };
}

async function loadSnapshot(
  actor: UserRow,
  request: Request,
): Promise<SchoolSnapshot> {
  const db = await database();
  const url = new URL(request.url);
  const viewer = actor;
  const allowedStudentIds = await visibleStudentIds(viewer);
  const requestedStudent = url.searchParams.get("student");
  const selectedStudentId =
    requestedStudent && allowedStudentIds.includes(requestedStudent)
      ? requestedStudent
      : viewer.linkedStudentId &&
          allowedStudentIds.includes(viewer.linkedStudentId)
        ? viewer.linkedStudentId
        : (allowedStudentIds[0] ?? null);
  const placeholders = allowedStudentIds.map(() => "?").join(",") || "''";
  const studentBindings = allowedStudentIds.length ? allowedStudentIds : [];

  const [students, classes] = await Promise.all([
    rows<SchoolSnapshot["students"][number]>(
      `SELECT id, first_name AS firstName, last_name AS lastName, first_name || ' ' || last_name AS fullName, class_name AS className, birth_year AS birthYear, avatar_color AS avatarColor FROM students WHERE id IN (${placeholders}) ORDER BY class_name, last_name`,
      studentBindings,
    ),
    rows<SchoolSnapshot["classes"][number]>(`SELECT c.id, c.name, c.grade,
      c.homeroom_teacher_user_id AS homeroomTeacherUserId,
      u.display_name AS homeroomTeacherName, c.status
      FROM school_classes c LEFT JOIN users u ON u.id = c.homeroom_teacher_user_id
      WHERE c.status = 'active' ORDER BY c.grade, c.name`),
  ]);
  const selectedStudent =
    students.find((student) => student.id === selectedStudentId) ?? null;
  const rankingsPromise = loadRankings(viewer, selectedStudent);
  const requestedClass = url.searchParams.get("class");
  const selectedClass =
    requestedClass && classes.some((item) => item.name === requestedClass)
      ? requestedClass
      : (selectedStudent?.className ??
        students[0]?.className ??
        classes[0]?.name ??
        "1");

  const lessonSelect = `SELECT l.id, l.class_name AS className, l.weekday,
    l.starts_at AS startsAt, l.ends_at AS endsAt, l.subject_id AS subjectId,
    s.name AS subjectName, s.color AS subjectColor, l.teacher_user_id AS teacherUserId,
    u.display_name AS teacherName, l.room, l.status, l.note
    FROM lessons l JOIN subjects s ON s.id = l.subject_id
    LEFT JOIN users u ON u.id = l.teacher_user_id`;
  const lessonQuery = operationalRoles.has(viewer.role)
    ? ([
        `${lessonSelect} WHERE l.status != 'archived' ORDER BY l.class_name, l.weekday, l.starts_at`,
        [],
      ] as const)
    : viewer.role === "teacher"
      ? ([
          `${lessonSelect} WHERE l.teacher_user_id = ? AND l.status != 'archived' ORDER BY l.weekday, l.starts_at`,
          [viewer.id],
        ] as const)
      : ([
          `${lessonSelect} WHERE l.class_name = ? AND l.status != 'archived' ORDER BY l.weekday, l.starts_at`,
          [selectedClass],
        ] as const);

  const [subjects, lessons, menu, events, activities] = await Promise.all([
    rows<SchoolSnapshot["subjects"][number]>(
      "SELECT id, name, short_name AS shortName, color, icon, stage, weekly_hours AS weeklyHours FROM subjects WHERE status = 'active' ORDER BY name",
    ),
    rows<SchoolSnapshot["lessons"][number]>(lessonQuery[0], [
      ...lessonQuery[1],
    ]),
    rows<SchoolSnapshot["menu"][number]>(
      "SELECT id, day_date AS dayDate, breakfast, lunch, snack, allergens FROM menu_days ORDER BY day_date LIMIT 14",
    ),
    rows<SchoolSnapshot["events"][number]>(
      "SELECT id, title, description, starts_at AS startsAt, location, audience, status, capacity FROM events WHERE status != 'archived' ORDER BY starts_at LIMIT 20",
    ),
    rows<SchoolSnapshot["activities"][number]>(
      "SELECT id, title, schedule, teacher, price, capacity, enrolled, status FROM activities WHERE status != 'archived' ORDER BY title",
    ),
  ]);

  const recordWhere = allowedStudentIds.length
    ? `IN (${placeholders})`
    : "IN ('')";
  const homeworkQuery = operationalRoles.has(viewer.role)
    ? ([
        "SELECT h.id, h.class_name AS className, h.subject_id AS subjectId, s.name AS subjectName, s.color AS subjectColor, h.teacher_user_id AS teacherUserId, u.display_name AS teacherName, h.title, h.description, h.due_at AS dueAt, h.status FROM homework h JOIN subjects s ON s.id = h.subject_id JOIN users u ON u.id = h.teacher_user_id WHERE h.status != 'archived' ORDER BY h.due_at",
        [],
      ] as const)
    : viewer.role === "teacher"
      ? ([
          "SELECT h.id, h.class_name AS className, h.subject_id AS subjectId, s.name AS subjectName, s.color AS subjectColor, h.teacher_user_id AS teacherUserId, u.display_name AS teacherName, h.title, h.description, h.due_at AS dueAt, h.status FROM homework h JOIN subjects s ON s.id = h.subject_id JOIN users u ON u.id = h.teacher_user_id WHERE h.teacher_user_id = ? AND h.status != 'archived' ORDER BY h.due_at",
          [viewer.id],
        ] as const)
      : ([
          "SELECT h.id, h.class_name AS className, h.subject_id AS subjectId, s.name AS subjectName, s.color AS subjectColor, h.teacher_user_id AS teacherUserId, u.display_name AS teacherName, h.title, h.description, h.due_at AS dueAt, h.status FROM homework h JOIN subjects s ON s.id = h.subject_id JOIN users u ON u.id = h.teacher_user_id WHERE h.class_name = ? AND h.status != 'archived' ORDER BY h.due_at",
          [selectedClass],
        ] as const);
  const [grades, homework, achievements, comments, subscriptions] =
    await Promise.all([
      rows<SchoolSnapshot["grades"][number]>(
        `SELECT g.id, g.student_id AS studentId, st.first_name || ' ' || st.last_name AS studentName, g.subject_id AS subjectId, s.name AS subjectName, s.color AS subjectColor, g.teacher_user_id AS teacherUserId, u.display_name AS teacherName, g.value, g.weight, g.title, g.grade_date AS gradeDate, g.comment FROM grades g JOIN students st ON st.id = g.student_id JOIN subjects s ON s.id = g.subject_id JOIN users u ON u.id = g.teacher_user_id WHERE g.student_id ${recordWhere} ORDER BY g.grade_date DESC, g.created_at DESC`,
        studentBindings,
      ),
      rows<SchoolSnapshot["homework"][number]>(homeworkQuery[0], [
        ...homeworkQuery[1],
      ]),
      rows<SchoolSnapshot["achievements"][number]>(
        `SELECT a.id, a.student_id AS studentId, st.first_name || ' ' || st.last_name AS studentName, a.teacher_user_id AS teacherUserId, u.display_name AS teacherName, a.title, a.description, a.category, a.achievement_date AS achievementDate FROM achievements a JOIN students st ON st.id = a.student_id JOIN users u ON u.id = a.teacher_user_id WHERE a.student_id ${recordWhere} ORDER BY a.achievement_date DESC`,
        studentBindings,
      ),
      rows<SchoolSnapshot["comments"][number]>(
        `SELECT c.id, c.student_id AS studentId, st.first_name || ' ' || st.last_name AS studentName, c.teacher_user_id AS teacherUserId, u.display_name AS teacherName, c.subject_id AS subjectId, s.name AS subjectName, c.body, c.visibility, c.comment_date AS commentDate FROM teacher_comments c JOIN students st ON st.id = c.student_id JOIN users u ON u.id = c.teacher_user_id LEFT JOIN subjects s ON s.id = c.subject_id WHERE c.student_id ${recordWhere} ORDER BY c.comment_date DESC, c.created_at DESC`,
        studentBindings,
      ),
      rows<SchoolSnapshot["subscriptions"][number]>(
        `SELECT id, student_id AS studentId, name, period, status, balance, lessons_left AS lessonsLeft, renewal_at AS renewalAt FROM subscriptions WHERE student_id ${recordWhere} ORDER BY status, name`,
        studentBindings,
      ),
    ]);

  let threadQuery =
    "SELECT t.id, t.student_id AS studentId, st.first_name || ' ' || st.last_name AS studentName, t.parent_user_id AS parentUserId, p.display_name AS parentName, t.teacher_user_id AS teacherUserId, te.display_name AS teacherName, t.title, t.updated_at AS updatedAt FROM threads t JOIN students st ON st.id = t.student_id JOIN users p ON p.id = t.parent_user_id JOIN users te ON te.id = t.teacher_user_id WHERE st.status = 'active'";
  const threadBindings: unknown[] = [];
  if (viewer.role === "parent") {
    threadQuery += " AND t.parent_user_id = ?";
    threadBindings.push(viewer.id);
  }
  if (viewer.role === "teacher") {
    threadQuery += " AND t.teacher_user_id = ?";
    threadBindings.push(viewer.id);
  }
  if (viewer.role === "student") {
    threadQuery += " AND t.student_id = ?";
    threadBindings.push(selectedStudentId);
  }
  threadQuery += " ORDER BY t.updated_at DESC";
  const threads = await rows<SchoolSnapshot["threads"][number]>(
    threadQuery,
    threadBindings,
  );
  const threadIds = threads.map((thread) => thread.id);
  const messagePlaceholders = threadIds.map(() => "?").join(",") || "''";
  const messages = await rows<SchoolSnapshot["messages"][number]>(
    `SELECT m.id, m.thread_id AS threadId, m.author_user_id AS authorUserId, u.display_name AS authorName, u.role AS authorRole, m.body, m.read_at AS readAt, m.created_at AS createdAt FROM messages m JOIN users u ON u.id = m.author_user_id WHERE m.thread_id IN (${messagePlaceholders}) ORDER BY m.created_at`,
    threadIds,
  );

  const users = operationalRoles.has(viewer.role)
    ? await rows<SchoolSnapshot["users"][number]>(
        "SELECT id, email, phone, display_name AS displayName, role, linked_student_id AS linkedStudentId, status, profile_status AS profileStatus, notes, password_state AS passwordState, central_user_id AS centralUserId, identity_source AS identitySource FROM users ORDER BY role, display_name",
      )
    : [];
  const canViewAssignments = operationalRoles.has(viewer.role) || viewer.role === "teacher";
  const teacherAssignments = canViewAssignments
    ? await rows<SchoolSnapshot["teacherAssignments"][number]>(`SELECT a.id,
        a.teacher_user_id AS teacherUserId, u.display_name AS teacherName,
        u.profile_status AS teacherProfileStatus, a.class_name AS className,
        a.subject_id AS subjectId, s.name AS subjectName, s.color AS subjectColor,
        a.status, a.notes
      FROM teacher_assignments a JOIN users u ON u.id = a.teacher_user_id
      JOIN subjects s ON s.id = a.subject_id
      ${viewer.role === "teacher" ? "WHERE a.teacher_user_id = ?" : ""}
      ORDER BY u.display_name, CAST(a.class_name AS INTEGER), s.name`,
      viewer.role === "teacher" ? [viewer.id] : [])
    : [];
  const audit = operationalRoles.has(viewer.role)
    ? await rows<SchoolSnapshot["audit"][number]>(
        "SELECT a.id, u.display_name AS actorName, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.details, a.created_at AS createdAt FROM audit_log a JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 30",
      )
    : [];
  const registrationRequests = operationalRoles.has(viewer.role)
    ? await rows<SchoolSnapshot["registrationRequests"][number]>(
        "SELECT id, email, display_name AS displayName, requested_role AS requestedRole, student_first_name AS studentFirstName, student_last_name AS studentLastName, class_name AS className, relation, student_id AS studentId, status, created_at AS createdAt FROM registration_requests WHERE status = 'pending' ORDER BY created_at",
      )
    : [];
  const invitations = operationalRoles.has(viewer.role)
    ? await rows<SchoolSnapshot["invitations"][number]>(
        "SELECT i.id, i.target_role AS targetRole, i.student_id AS studentId, CASE WHEN st.id IS NULL THEN NULL ELSE st.first_name || ' ' || st.last_name END AS studentName, COALESCE(i.class_name, st.class_name) AS className, i.expires_at AS expiresAt, i.max_uses AS maxUses, i.used_count AS usedCount, i.status, i.created_at AS createdAt FROM account_invitations i LEFT JOIN students st ON st.id = i.student_id ORDER BY i.created_at DESC LIMIT 50",
      )
    : [];
  const canViewPrograms =
    viewer.role === "teacher" || leadershipRoles.has(viewer.role);
  const programWhere =
    viewer.role === "teacher" ? "WHERE p.teacher_user_id = ?" : "";
  const programBindings = viewer.role === "teacher" ? [viewer.id] : [];
  const programs = canViewPrograms
    ? await rows<SchoolSnapshot["programs"][number]>(
        `SELECT p.id, p.academic_year AS academicYear,
          p.class_name AS className, p.subject_id AS subjectId, s.name AS subjectName,
          p.teacher_user_id AS teacherUserId, u.display_name AS teacherName, p.title, p.status,
          p.planned_lessons AS plannedLessons, p.completed_lessons AS completedLessons,
          COALESCE(pi.row_count, 0) AS importedRows,
          COALESCE(pi.available_slots, 0) AS availableSlots,
          COALESCE(pi.scheduled_hours, 0) AS scheduledLessons,
          COALESCE(pi.unscheduled_hours, 0) AS unscheduledLessons,
          COALESCE(pi.validation_status, 'manual') AS validationStatus,
          pi.file_name AS sourceFileName, p.updated_at AS updatedAt
        FROM programs p
        JOIN subjects s ON s.id = p.subject_id
        JOIN users u ON u.id = p.teacher_user_id
        LEFT JOIN program_imports pi ON pi.id = (
          SELECT latest.id FROM program_imports latest
          WHERE latest.program_id = p.id
          ORDER BY latest.created_at DESC, latest.rowid DESC LIMIT 1
        )
        ${programWhere} ORDER BY p.class_name, s.name`,
        programBindings,
      )
    : [];
  const programTopics = canViewPrograms
    ? await rows<SchoolSnapshot["programTopics"][number]>(
        `SELECT ps.id, pt.program_id AS programId, pt.source_row AS sourceRow,
          pt.sequence, pt.topic, pt.planned_hours AS plannedHours, pt.homework,
          pt.sort_order AS sortOrder, ps.session_index AS sessionIndex,
          ps.scheduled_date AS scheduledDate, ps.starts_at AS startsAt, ps.status
        FROM program_topics pt
        JOIN program_topic_sessions ps ON ps.topic_id = pt.id
        JOIN programs p ON p.id = pt.program_id
        WHERE 1 = 1 ${viewer.role === "teacher" ? "AND p.teacher_user_id = ?" : ""}
        ORDER BY p.class_name, p.subject_id, pt.sort_order, ps.session_index
        LIMIT 1500`,
        programBindings,
      )
    : [];
  const academicCalendarPeriods = canViewPrograms
    ? await rows<SchoolSnapshot["academicCalendarPeriods"][number]>(
        `SELECT id, academic_year AS academicYear, kind, title,
          starts_on AS startsOn, ends_on AS endsOn
        FROM academic_calendar_periods
        WHERE academic_year = ? ORDER BY starts_on`,
        [ACADEMIC_YEAR.id],
      )
    : [];
  const attendance = await rows<SchoolSnapshot["attendance"][number]>(
    `SELECT a.id, a.lesson_id AS lessonId,
      a.student_id AS studentId, a.status, a.note, a.marked_at AS markedAt
    FROM attendance a WHERE a.student_id ${recordWhere} ORDER BY a.marked_at DESC LIMIT 200`,
    studentBindings,
  );
  const notifications = await rows<SchoolSnapshot["notifications"][number]>(
    `SELECT id, category, title, body,
      entity_type AS entityType, entity_id AS entityId, critical, read_at AS readAt, created_at AS createdAt
    FROM notifications WHERE user_id = ? ORDER BY critical DESC, created_at DESC LIMIT 100`,
    [viewer.id],
  );
  const liveUser = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM users WHERE phone IS NOT NULL AND password_state = 'active' AND status = 'active'",
    )
    .first<{ count: number }>();
  const liveUserCount = liveUser?.count ?? 0;
  const rankings = await rankingsPromise;

  return {
    school: {
      name: "Школа 1–11",
      academicYear: "2026/27",
      timezone: "Europe/Moscow",
      dataMode: liveUserCount >= 4 ? "live" : "template",
    },
    viewer: {
      id: viewer.id,
      email: viewer.email,
      phone: viewer.phone,
      displayName: viewer.displayName,
      role: viewer.role,
      initials: initials(viewer.displayName),
      availableRoles: [viewer.role],
    },
    selectedStudent,
    students,
    users,
    classes,
    subjects,
    teacherAssignments,
    lessons,
    grades,
    homework,
    achievements,
    comments,
    menu,
    events,
    activities,
    subscriptions,
    threads,
    messages,
    audit,
    registrationRequests,
    invitations,
    programs,
    programTopics,
    academicCalendarPeriods,
    attendance,
    notifications,
    rankings,
    setup: {
      liveUserCount,
      templateRecords: false,
      checklist: [
        { id: "roles", label: "Роли и права доступа", done: true },
        { id: "storage", label: "Постоянная база данных", done: true },
        {
          id: "users",
          label: "Реальные пользователи",
          done: liveUserCount >= 4,
        },
        {
          id: "registration",
          label: "Самостоятельная регистрация семей",
          done: true,
        },
        {
          id: "structure",
          label: "1–6 классы и педагогическая матрица",
          done: classes.length === 6 && teacherAssignments.length > 0,
        },
        {
          id: "data",
          label: "Рабочее расписание",
          done: lessons.some((lesson) => lesson.status !== "cancelled"),
        },
        {
          id: "legal",
          label: "Правовой контур персональных данных",
          done: false,
        },
      ],
    },
  };
}

async function audit(
  actor: UserRow,
  action: string,
  entityType: string,
  entityId: string,
  details = "",
) {
  const db = await database();
  await db
    .prepare(
      "INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      `audit-${crypto.randomUUID()}`,
      actor.id,
      action,
      entityType,
      entityId,
      details.slice(0, 500),
    )
    .run();
}

async function assertTeacherScope(
  viewer: UserRow,
  studentId: string,
  subjectId?: string,
) {
  if (leadershipRoles.has(viewer.role)) return;
  if (viewer.role !== "teacher")
    throw new Error("Нет доступа к учебным данным");
  const db = await database();
  const student = await db
    .prepare(
      "SELECT class_name AS className FROM students WHERE id = ? AND status = 'active'",
    )
    .bind(studentId)
    .first<{ className: string }>();
  if (!student) throw new Error("Ученик не найден");
  const query = subjectId
    ? "SELECT id FROM teacher_assignments WHERE teacher_user_id = ? AND class_name = ? AND subject_id = ? AND status = 'confirmed' LIMIT 1"
    : "SELECT id FROM teacher_assignments WHERE teacher_user_id = ? AND class_name = ? AND status = 'confirmed' LIMIT 1";
  const bindings = subjectId
    ? [viewer.id, student.className, subjectId]
    : [viewer.id, student.className];
  const assignment = await db
    .prepare(query)
    .bind(...bindings)
    .first<{ id: string }>();
  if (!assignment)
    throw new Error("Учитель не назначен этому классу или предмету");
}

async function assertTeacherClassScope(
  viewer: UserRow,
  className: string,
  subjectId: string,
) {
  if (leadershipRoles.has(viewer.role)) return;
  if (viewer.role !== "teacher")
    throw new Error("Нет доступа к учебным данным");
  await assertConfirmedTeacherAssignment(viewer.id, className, subjectId);
}

async function assertConfirmedTeacherAssignment(
  teacherUserId: string,
  className: string,
  subjectId: string,
) {
  const db = await database();
  const assignment = await db
    .prepare(
      "SELECT id FROM teacher_assignments WHERE teacher_user_id = ? AND class_name = ? AND subject_id = ? AND status = 'confirmed' LIMIT 1",
    )
    .bind(teacherUserId, className, subjectId)
    .first<{ id: string }>();
  if (!assignment)
    throw new Error("Учитель не назначен этому классу или предмету");
}

type CurriculumRowInput = {
  sourceRow: number;
  sequence: string;
  topic: string;
  hours: number;
  homework: string;
  sourceDate: string | null;
};

async function calculateCurriculumAllocation(
  className: string,
  subjectId: string,
  topicRows: CurriculumRowInput[],
) {
  const db = await database();
  const lessonResult = await db
    .prepare(
      `SELECT id, weekday, starts_at AS startsAt
      FROM lessons
      WHERE class_name = ? AND subject_id = ? AND status NOT IN ('cancelled', 'archived')
      ORDER BY weekday, starts_at`,
    )
    .bind(className, subjectId)
    .all<{ id: string; weekday: number; startsAt: string }>();
  const periodResult = await db
    .prepare(
      `SELECT starts_on AS startsOn, ends_on AS endsOn
      FROM academic_calendar_periods
      WHERE academic_year = ? AND kind IN ('vacation', 'holiday', 'non_instruction')
      ORDER BY starts_on`,
    )
    .bind(ACADEMIC_YEAR.id)
    .all<{ startsOn: string; endsOn: string }>();
  const slots = buildScheduleSlots({
    startDate: ACADEMIC_YEAR.startsOn,
    endDate: ACADEMIC_YEAR.endsOn,
    lessons: lessonResult.results,
    periods: periodResult.results,
  });
  return allocateCurriculumRows(topicRows, slots);
}

type ScheduleConflictInput = {
  lessonId?: string;
  className: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  teacherId: string;
  room: string;
};

async function assertNoScheduleConflict(input: ScheduleConflictInput) {
  const db = await database();
  const excludedId = input.lessonId || "";
  const overlapSql =
    "weekday = ? AND starts_at < ? AND ends_at > ? AND status NOT IN ('cancelled', 'archived') AND id != ?";
  const classConflict = await db
    .prepare(
      `SELECT id, starts_at AS startsAt, ends_at AS endsAt FROM lessons WHERE ${overlapSql} AND class_name = ? LIMIT 1`,
    )
    .bind(
      input.weekday,
      input.endsAt,
      input.startsAt,
      excludedId,
      input.className,
    )
    .first<{ id: string; startsAt: string; endsAt: string }>();
  if (classConflict)
    throw new Error(
      `У ${input.className} класса уже есть урок ${classConflict.startsAt}–${classConflict.endsAt}`,
    );

  if (input.teacherId) {
    const teacherConflict = await db
      .prepare(
        `SELECT l.id, l.class_name AS className,
        l.starts_at AS startsAt, l.ends_at AS endsAt,
        (SELECT display_name FROM users WHERE id = l.teacher_user_id) AS teacherName
      FROM lessons l WHERE l.weekday = ? AND l.starts_at < ? AND l.ends_at > ?
        AND l.status NOT IN ('cancelled', 'archived') AND l.id != ?
        AND l.teacher_user_id = ? LIMIT 1`,
      )
      .bind(
        input.weekday,
        input.endsAt,
        input.startsAt,
        excludedId,
        input.teacherId,
      )
      .first<{
        id: string;
        className: string;
        startsAt: string;
        endsAt: string;
        teacherName: string | null;
      }>();
    if (teacherConflict)
      throw new Error(
        `${teacherConflict.teacherName ?? "Учитель"} уже занят(а) у ${teacherConflict.className} класса ${teacherConflict.startsAt}–${teacherConflict.endsAt}`,
      );
  }

  if (input.room && input.room.toLocaleLowerCase("ru-RU") !== "уточняется") {
    const roomConflict = await db
      .prepare(
        `SELECT id, class_name AS className, starts_at AS startsAt, ends_at AS endsAt FROM lessons WHERE ${overlapSql} AND lower(room) = lower(?) LIMIT 1`,
      )
      .bind(input.weekday, input.endsAt, input.startsAt, excludedId, input.room)
      .first<{
        id: string;
        className: string;
        startsAt: string;
        endsAt: string;
      }>();
    if (roomConflict)
      throw new Error(
        `Кабинет «${input.room}» уже занят ${roomConflict.className} классом ${roomConflict.startsAt}–${roomConflict.endsAt}`,
      );
  }
}

async function actionUser(actor: UserRow, body: RequestBody) {
  void body;
  return actor;
}

function invitationIsUsable(
  invitation: InvitationRow | null,
): invitation is InvitationRow {
  if (!invitation || invitation.status !== "active") return false;
  if (invitation.usedCount >= invitation.maxUses) return false;
  const expiresAt = new Date(invitation.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

async function saveRegistrationRequest(
  identity: AuthenticatedIdentity,
  body: RequestBody,
  invitation: InvitationRow | null,
) {
  const db = await database();
  const studentFirstName = textValue(body.studentFirstName, 80);
  const studentLastName = textValue(body.studentLastName, 80);
  const className = textValue(body.className, 20);
  const relation = textValue(body.relation, 40);
  const displayName = textValue(body.displayName || identity.displayName, 140);
  if (
    invitation?.className &&
    invitation.className.toLocaleLowerCase("ru-RU") !==
      className.toLocaleLowerCase("ru-RU")
  ) {
    throw new Error(`Приглашение выдано для класса ${invitation.className}`);
  }

  const existing = await db
    .prepare(
      "SELECT id FROM registration_requests WHERE lower(email) = ? AND lower(student_first_name) = ? AND lower(student_last_name) = ? AND class_name = ? AND status = 'pending'",
    )
    .bind(
      identity.email,
      studentFirstName.toLocaleLowerCase("ru-RU"),
      studentLastName.toLocaleLowerCase("ru-RU"),
      className,
    )
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = `registration-${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO registration_requests (id, email, display_name, requested_role, student_first_name, student_last_name, class_name, relation, invitation_id, student_id) VALUES (?, ?, ?, 'parent', ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      identity.email,
      displayName,
      studentFirstName,
      studentLastName,
      className,
      relation,
      invitation?.id ?? null,
      invitation?.studentId ?? null,
    )
    .run();
  return id;
}

async function handlePublicRegistration(
  request: Request,
  body: RequestBody,
  action: ActionKind,
) {
  const identity = await authenticatedIdentity(request);
  if (!identity) {
    return Response.json(
      {
        error: "Сначала войдите в подтверждённый аккаунт",
        code: "sign_in_required",
      },
      { status: 401 },
    );
  }

  if (action === "family.registration.request") {
    const id = await saveRegistrationRequest(identity, body, null);
    return Response.json(
      {
        ok: true,
        id,
        status: "pending",
        message: "Заявка отправлена администратору школы",
      },
      { status: 202 },
    );
  }

  const token = textValue(body.inviteToken, 180);
  const invitation = await invitationForToken(token);
  if (!invitationIsUsable(invitation))
    throw new Error(
      "Приглашение недействительно, уже использовано или истекло",
    );

  if (!invitation.studentId) {
    const id = await saveRegistrationRequest(identity, body, invitation);
    return Response.json(
      {
        ok: true,
        id,
        status: "pending",
        message: "Данные семьи отправлены на подтверждение",
      },
      { status: 202 },
    );
  }

  const db = await database();
  const existing = await db
    .prepare("SELECT id, role, status FROM users WHERE lower(email) = ?")
    .bind(identity.email)
    .first<{ id: string; role: Role; status: string }>();
  if (existing && existing.role !== invitation.targetRole)
    throw new Error(
      "Этот email уже используется для другой роли. Администратор может добавить вторую роль вручную",
    );
  const userId = existing?.id ?? `user-${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO users (id, email, display_name, role, linked_student_id, status) VALUES (?, ?, ?, ?, ?, 'active') ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, linked_student_id = excluded.linked_student_id, status = 'active', updated_at = CURRENT_TIMESTAMP",
    )
    .bind(
      userId,
      identity.email,
      identity.displayName,
      invitation.targetRole,
      invitation.studentId,
    )
    .run();
  const savedUser = await db
    .prepare("SELECT id FROM users WHERE lower(email) = ?")
    .bind(identity.email)
    .first<{ id: string }>();
  if (!savedUser) throw new Error("Не удалось создать доступ");
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO user_student_links (id, user_id, student_id, relation) VALUES (?, ?, ?, ?)",
      )
      .bind(
        `link-${savedUser.id}-${invitation.studentId}`,
        savedUser.id,
        invitation.studentId,
        invitation.targetRole === "student"
          ? "self"
          : textValue(body.relation, 40, false) || "guardian",
      ),
    db
      .prepare(
        "UPDATE account_invitations SET used_count = used_count + 1, status = CASE WHEN used_count + 1 >= max_uses THEN 'used' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(invitation.id),
  ]);
  return Response.json({
    ok: true,
    status: "active",
    message:
      invitation.targetRole === "parent"
        ? "Семья подключена"
        : "Доступ ученика создан",
  });
}

export async function GET(request: Request) {
  try {
    await ensureSchoolStructure();
    const actor = await findActor(request);
    if (!actor) {
      const identity = await authenticatedIdentity(request);
      if (!identity)
        return Response.json(
          { error: "Войдите, чтобы открыть дневник", code: "sign_in_required" },
          { status: 401 },
        );
      const db = await database();
      const pending = await db
        .prepare(
          "SELECT id FROM registration_requests WHERE lower(email) = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(identity.email)
        .first<{ id: string }>();
      if (pending)
        return Response.json(
          {
            error:
              "Заявка получена. Администратор школы должен подтвердить связь с ребёнком",
            code: "registration_pending",
            email: identity.email,
            displayName: identity.displayName,
          },
          { status: 403 },
        );
      const token = new URL(request.url).searchParams.get("invite") ?? "";
      const invitation = await invitationForToken(token);
      return Response.json(
        {
          error:
            "Создайте кабинет родителя по приглашению или отправьте заявку самостоятельно",
          code: "registration_required",
          email: identity.email,
          displayName: identity.displayName,
          invitation: invitationIsUsable(invitation) ? invitation : null,
        },
        { status: 403 },
      );
    }
    return Response.json(await loadSnapshot(actor, request));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось открыть дневник";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchoolStructure();
    assertSameOrigin(request);
    const isMultipart = request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("multipart/form-data");
    const body = (isMultipart
      ? Object.fromEntries((await request.formData()).entries())
      : await request.json()) as RequestBody;
    const action = typeof body.action === "string" ? body.action : undefined;
    if (!action)
      return Response.json({ error: "Не указано действие" }, { status: 400 });
    if (centralDirectoryActions.has(action))
      return Response.json({ error: "Семьи, родители, ученики, классы и их доступы управляются только в ArtHello OS. Дневник принимает подписанную проекцию и не создаёт параллельные карточки." }, { status: 409 });
    if (publicRegistrationActions.has(action))
      return await handlePublicRegistration(request, body, action);
    const actor = await findActor(request);
    if (!actor) return Response.json({ error: "Нет доступа" }, { status: 403 });
    const effectiveUser = await actionUser(actor, body);
    const effectiveRole = effectiveUser.role;
    const teacherOnlyAction = [
      "grade.create",
      "homework.create",
      "achievement.create",
      "comment.create",
    ].includes(action);
    if (teacherOnlyAction && effectiveRole !== "teacher")
      throw new Error("Это действие доступно назначенному учителю");
    if (
      teacherActions.has(action) &&
      !teacherOnlyAction &&
      effectiveRole !== "teacher" &&
      !leadershipRoles.has(effectiveRole)
    )
      throw new Error("Это действие доступно учителю, завучу или директору");
    if (adminActions.has(action) && !operationalRoles.has(actor.role))
      throw new Error("Это действие доступно уполномоченному сотруднику школы");
    if (action === "user.password.reset" && actor.role !== "director")
      throw new Error("Сброс пароля доступен только владельцу системы");
    if (
      action === "family.invite.create" &&
      actor.role !== "parent" &&
      !operationalRoles.has(actor.role)
    )
      throw new Error(
        "Приглашение создаёт родитель или уполномоченный сотрудник школы",
      );

    const db = await database();
    const id = `${action.replace(".", "-")}-${crypto.randomUUID()}`;
    let responsePayload: Record<string, unknown> = {};
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
    }).format(new Date());

    if (action === "grade.create") {
      const studentId = textValue(body.studentId, 80);
      const subjectId = textValue(body.subjectId, 80);
      await assertTeacherScope(effectiveUser, studentId, subjectId);
      const value = numberValue(body.value, 2, 5);
      const weight = numberValue(body.weight ?? 1, 1, 3);
      const title = textValue(body.title, 120);
      const comment = textValue(body.comment, 500, false);
      await db
        .prepare(
          "INSERT INTO grades (id, student_id, subject_id, teacher_user_id, value, weight, title, grade_date, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          studentId,
          subjectId,
          effectiveUser.id,
          value,
          weight,
          title,
          today,
          comment || null,
        )
        .run();
      await audit(actor, action, "grade", id, `${studentId}: ${value}`);
    } else if (action === "homework.create") {
      const className = textValue(body.className, 20);
      const subjectId = textValue(body.subjectId, 80);
      await assertTeacherClassScope(effectiveUser, className, subjectId);
      const title = textValue(body.title, 140);
      const description = textValue(body.description, 1200);
      const dueAt = textValue(body.dueAt, 80);
      await db
        .prepare(
          "INSERT INTO homework (id, class_name, subject_id, teacher_user_id, title, description, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          className,
          subjectId,
          effectiveUser.id,
          title,
          description,
          dueAt,
        )
        .run();
      await audit(actor, action, "homework", id, `${className}: ${title}`);
    } else if (action === "achievement.create") {
      const studentId = textValue(body.studentId, 80);
      await assertTeacherScope(effectiveUser, studentId);
      const title = textValue(body.title, 140);
      const description = textValue(body.description, 800);
      const category = textValue(body.category, 80);
      await db
        .prepare(
          "INSERT INTO achievements (id, student_id, teacher_user_id, title, description, category, achievement_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          studentId,
          effectiveUser.id,
          title,
          description,
          category,
          today,
        )
        .run();
      await audit(actor, action, "achievement", id, `${studentId}: ${title}`);
    } else if (action === "comment.create") {
      const studentId = textValue(body.studentId, 80);
      const subjectId = textValue(body.subjectId, 80, false);
      await assertTeacherScope(
        effectiveUser,
        studentId,
        subjectId || undefined,
      );
      const commentBody = textValue(body.body, 1200);
      await db
        .prepare(
          "INSERT INTO teacher_comments (id, student_id, teacher_user_id, subject_id, body, visibility, comment_date) VALUES (?, ?, ?, ?, ?, 'parent', ?)",
        )
        .bind(
          id,
          studentId,
          effectiveUser.id,
          subjectId || null,
          commentBody,
          today,
        )
        .run();
      await audit(actor, action, "teacher_comment", id, studentId);
    } else if (action === "message.send") {
      if (
        !["parent", "teacher", "director", "deputy", "admin"].includes(
          effectiveRole,
        )
      )
        throw new Error("Диалог доступен семье и уполномоченным сотрудникам");
      const threadId = textValue(body.threadId, 80);
      const message = textValue(body.body, 1500);
      const thread = await db
        .prepare(
          "SELECT parent_user_id AS parentUserId, teacher_user_id AS teacherUserId FROM threads WHERE id = ?",
        )
        .bind(threadId)
        .first<{ parentUserId: string; teacherUserId: string }>();
      if (!thread) throw new Error("Диалог не найден");
      if (
        !operationalRoles.has(actor.role) &&
        effectiveUser.id !== thread.parentUserId &&
        effectiveUser.id !== thread.teacherUserId
      )
        throw new Error("Нет доступа к диалогу");
      await db.batch([
        db
          .prepare(
            "INSERT INTO messages (id, thread_id, author_user_id, body) VALUES (?, ?, ?, ?)",
          )
          .bind(id, threadId, effectiveUser.id, message),
        db
          .prepare(
            "UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(threadId),
      ]);
      await audit(actor, action, "message", id, threadId);
    } else if (action === "thread.view") {
      const threadId = textValue(body.threadId, 80);
      const thread = await db
        .prepare(
          "SELECT parent_user_id AS parentUserId, teacher_user_id AS teacherUserId FROM threads WHERE id = ?",
        )
        .bind(threadId)
        .first<{ parentUserId: string; teacherUserId: string }>();
      if (!thread) throw new Error("Диалог не найден");
      if (
        !operationalRoles.has(actor.role) &&
        actor.id !== thread.parentUserId &&
        actor.id !== thread.teacherUserId
      )
        throw new Error("Нет доступа к диалогу");
      await audit(
        actor,
        action,
        "thread",
        threadId,
        operationalRoles.has(actor.role)
          ? "Контрольный просмотр официальной переписки"
          : "Просмотр участником",
      );
    } else if (action === "family.invite.create") {
      const targetRole = textValue(body.targetRole || "parent", 20) as
        | "parent"
        | "student";
      const studentId = textValue(body.studentId, 80, false);
      const className = textValue(body.className, 20, false);
      const expiresDays = numberValue(body.expiresDays ?? 7, 1, 90);
      const requestedMaxUses = numberValue(
        body.maxUses ?? (studentId ? 2 : 30),
        1,
        300,
      );
      const maxUses = studentId
        ? Math.min(requestedMaxUses, targetRole === "student" ? 1 : 2)
        : requestedMaxUses;
      if (!(["parent", "student"] as string[]).includes(targetRole))
        throw new Error("Проверьте тип приглашения");
      if (!studentId && !className)
        throw new Error("Выберите ребёнка или укажите класс");
      if (targetRole === "student" && !studentId)
        throw new Error(
          "Доступ ученика создаётся только для конкретного ребёнка",
        );
      if (actor.role === "parent") {
        if (targetRole !== "student" || !studentId)
          throw new Error(
            "Родитель может создать только доступ своего ребёнка",
          );
        const allowed = await visibleStudentIds(actor);
        if (!allowed.includes(studentId))
          throw new Error("Нет доступа к карточке ребёнка");
      }
      const randomBytes = crypto.getRandomValues(new Uint8Array(18));
      const token = Array.from(randomBytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const tokenHash = await sha256(token);
      const expiresAt = new Date(
        Date.now() + expiresDays * 86_400_000,
      ).toISOString();
      await db
        .prepare(
          "INSERT INTO account_invitations (id, token_hash, target_role, student_id, class_name, created_by_user_id, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          tokenHash,
          targetRole,
          studentId || null,
          className || null,
          actor.id,
          expiresAt,
          maxUses,
        )
        .run();
      await audit(
        actor,
        action,
        "account_invitation",
        id,
        `${targetRole}: ${studentId || className}`,
      );
      const inviteLink = `${new URL(request.url).origin}/?invite=${encodeURIComponent(token)}`;
      return Response.json({
        ok: true,
        id,
        inviteLink,
        inviteCode: token,
        expiresAt,
      });
    } else if (action === "family.registration.approve") {
      const requestId = textValue(body.requestId, 100);
      const pending = await db
        .prepare(
          "SELECT id, email, display_name AS displayName, requested_role AS requestedRole, student_first_name AS studentFirstName, student_last_name AS studentLastName, class_name AS className, relation, invitation_id AS invitationId, student_id AS studentId, status FROM registration_requests WHERE id = ?",
        )
        .bind(requestId)
        .first<{
          id: string;
          email: string;
          displayName: string;
          requestedRole: "parent" | "student";
          studentFirstName: string;
          studentLastName: string;
          className: string;
          relation: string;
          invitationId: string | null;
          studentId: string | null;
          status: string;
        }>();
      if (!pending || pending.status !== "pending")
        throw new Error("Заявка уже обработана или не найдена");
      let approvedStudentId = pending.studentId;
      if (!approvedStudentId) {
        const matchedStudent = await db
          .prepare(
            "SELECT id FROM students WHERE lower(first_name) = ? AND lower(last_name) = ? AND class_name = ? AND status = 'active' LIMIT 1",
          )
          .bind(
            pending.studentFirstName.toLocaleLowerCase("ru-RU"),
            pending.studentLastName.toLocaleLowerCase("ru-RU"),
            pending.className,
          )
          .first<{ id: string }>();
        approvedStudentId =
          matchedStudent?.id ?? `student-${crypto.randomUUID()}`;
        if (!matchedStudent)
          await db
            .prepare(
              "INSERT INTO students (id, first_name, last_name, class_name, avatar_color) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(
              approvedStudentId,
              pending.studentFirstName,
              pending.studentLastName,
              pending.className,
              "#e84412",
            )
            .run();
      }
      const existingUser = await db
        .prepare("SELECT id, role FROM users WHERE lower(email) = ?")
        .bind(pending.email)
        .first<{ id: string; role: Role }>();
      if (existingUser && existingUser.role !== pending.requestedRole)
        throw new Error(
          "Email уже назначен другой роли; требуется ручная проверка",
        );
      const approvedUserId = existingUser?.id ?? `user-${crypto.randomUUID()}`;
      await db.batch([
        db
          .prepare(
            "INSERT INTO users (id, email, display_name, role, linked_student_id, status) VALUES (?, ?, ?, ?, ?, 'active') ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, linked_student_id = excluded.linked_student_id, status = 'active', updated_at = CURRENT_TIMESTAMP",
          )
          .bind(
            approvedUserId,
            pending.email,
            pending.displayName,
            pending.requestedRole,
            approvedStudentId,
          ),
        db
          .prepare(
            "INSERT OR IGNORE INTO user_student_links (id, user_id, student_id, relation) VALUES (?, ?, ?, ?)",
          )
          .bind(
            `link-${approvedUserId}-${approvedStudentId}`,
            approvedUserId,
            approvedStudentId,
            pending.relation,
          ),
        db
          .prepare(
            "UPDATE registration_requests SET student_id = ?, status = 'approved', reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(approvedStudentId, actor.id, requestId),
      ]);
      if (pending.invitationId)
        await db
          .prepare(
            "UPDATE account_invitations SET used_count = used_count + 1, status = CASE WHEN used_count + 1 >= max_uses THEN 'used' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(pending.invitationId)
          .run();
      await audit(
        actor,
        action,
        "registration_request",
        requestId,
        `${pending.email}: ${pending.studentFirstName} ${pending.studentLastName}`,
      );
    } else if (action === "user.invite") {
      const phone = normalizePhone(body.phone);
      const displayName = textValue(body.displayName, 140);
      const role = textValue(body.role, 20) as Role;
      const linkedStudentId = textValue(body.studentId, 80, false);
      const teacherId = textValue(body.teacherId, 80, false);
      if (!validRoles.has(role)) throw new Error("Проверьте роль");
      if (!familyRoles.has(role)) throw new Error("Сотрудники создаются и блокируются централизованно в ArtHello OS. В дневнике можно добавить только родителя или ученика");
      const existingUser = await db
        .prepare("SELECT id FROM users WHERE phone = ?")
        .bind(phone)
        .first<{ id: string }>();
      const savedUserId = existingUser?.id ?? id;
      if (existingUser) {
        await db
          .prepare(
            "UPDATE users SET display_name = ?, role = ?, linked_student_id = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(displayName, role, linkedStudentId || null, savedUserId)
          .run();
      } else {
        const syntheticEmail = `phone_${phone.replace(/\D/g, "")}@school.local`;
        await db
          .prepare(
            "INSERT INTO users (id, email, phone, display_name, role, linked_student_id, status, password_state) VALUES (?, ?, ?, ?, ?, ?, 'active', 'pending')",
          )
          .bind(
            savedUserId,
            syntheticEmail,
            phone,
            displayName,
            role,
            linkedStudentId || null,
          )
          .run();
      }
      const savedUser = { id: savedUserId };
      if (linkedStudentId && savedUser)
        await db
          .prepare(
            "INSERT OR IGNORE INTO user_student_links (id, user_id, student_id, relation) VALUES (?, ?, ?, ?)",
          )
          .bind(
            `link-${savedUser.id}-${linkedStudentId}`,
            savedUser.id,
            linkedStudentId,
            role === "student" ? "self" : "guardian",
          )
          .run();
      if (role === "parent" && linkedStudentId && teacherId && savedUser) {
        const student = await db
          .prepare("SELECT first_name AS firstName FROM students WHERE id = ?")
          .bind(linkedStudentId)
          .first<{ firstName: string }>();
        await db
          .prepare(
            "INSERT OR IGNORE INTO threads (id, student_id, parent_user_id, teacher_user_id, title) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(
            `thread-${savedUser.id}-${linkedStudentId}-${teacherId}`,
            linkedStudentId,
            savedUser.id,
            teacherId,
            `${student?.firstName ?? "Ученик"} · классный руководитель`,
          )
          .run();
      }
      const credential = await createCredentialToken(
        savedUser.id,
        actor.id,
        "activate",
        new URL(request.url).origin,
      );
      await audit(
        actor,
        action,
        "user",
        savedUser.id,
        `${role}: телефон ••••${phone.slice(-4)}`,
      );
      return Response.json({
        ok: true,
        id: savedUser.id,
        inviteLink: credential.activationLink,
        expiresAt: credential.expiresAt,
      });
    } else if (action === "user.password.reset") {
      const userId = textValue(body.userId, 100);
      const target = await db
        .prepare(
          "SELECT id, phone, role, identity_source AS identitySource FROM users WHERE id = ? AND status = 'active'",
        )
        .bind(userId)
        .first<{ id: string; phone: string | null; role: Role; identitySource: string }>();
      if (!target?.phone)
        throw new Error("Сначала укажите пользователю номер телефона");
      if (!familyRoles.has(target.role) || target.identitySource === "arthello_os")
        throw new Error("Пароль сотрудника сбрасывается централизованно в ArtHello OS");
      await db.batch([
        db
          .prepare(
            "UPDATE users SET password_hash = NULL, password_state = 'reset_required', auth_version = auth_version + 1, failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(userId),
        db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId),
      ]);
      const credential = await createCredentialToken(
        userId,
        actor.id,
        "reset",
        new URL(request.url).origin,
      );
      await audit(
        actor,
        action,
        "user",
        userId,
        `Сброс доступа для телефона ••••${target.phone.slice(-4)}`,
      );
      return Response.json({
        ok: true,
        id: userId,
        inviteLink: credential.activationLink,
        expiresAt: credential.expiresAt,
      });
    } else if (action === "student.create") {
      const firstName = textValue(body.firstName, 80);
      const lastName = textValue(body.lastName, 80);
      const className = textValue(body.className, 20);
      await db
        .prepare(
          "INSERT INTO students (id, first_name, last_name, class_name, avatar_color) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id, firstName, lastName, className, "#e84412")
        .run();
      await audit(
        actor,
        action,
        "student",
        id,
        `${firstName} ${lastName}, ${className}`,
      );
    } else if (action === "lesson.upsert") {
      const lessonId = textValue(body.lessonId, 120, false);
      const className = textValue(body.className, 20);
      const weekday = numberValue(body.weekday, 1, 6);
      const startsAt = textValue(body.startsAt, 10);
      const endsAt = textValue(body.endsAt, 10);
      const subjectId = textValue(body.subjectId, 80);
      const teacherId = textValue(body.teacherId, 80, false);
      const room = textValue(body.room, 80, false) || "Уточняется";
      const status = textValue(body.status, 30);
      const note = textValue(body.note, 300, false);
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(endsAt) ||
        startsAt >= endsAt
      ) {
        throw new Error("Проверьте время начала и окончания урока");
      }
      if (!["scheduled", "moved", "cancelled"].includes(status))
        throw new Error("Проверьте статус урока");
      const schoolClass = await db
        .prepare(
          "SELECT id FROM school_classes WHERE name = ? AND status = 'active'",
        )
        .bind(className)
        .first<{ id: string }>();
      if (!schoolClass) throw new Error("Выберите класс из списка 1–6");
      const subject = await db
        .prepare("SELECT id FROM subjects WHERE id = ? AND status = 'active'")
        .bind(subjectId)
        .first<{ id: string }>();
      if (!subject) throw new Error("Выберите действующий предмет");
      if (teacherId) {
        const teacher = await db
          .prepare(
            "SELECT id, role, profile_status AS profileStatus FROM users WHERE id = ?",
          )
          .bind(teacherId)
          .first<{ id: string; role: Role; profileStatus: string }>();
        if (
          !teacher ||
          teacher.role !== "teacher" ||
          teacher.profileStatus === "vacant"
        )
          throw new Error(
            "Выберите назначенного педагога или оставьте поле пустым",
          );
      }
      await assertNoScheduleConflict({
        lessonId,
        className,
        weekday,
        startsAt,
        endsAt,
        teacherId,
        room,
      });
      const savedLessonId = lessonId || id;
      if (lessonId) {
        const existingLesson = await db
          .prepare("SELECT id FROM lessons WHERE id = ?")
          .bind(lessonId)
          .first<{ id: string }>();
        if (!existingLesson) throw new Error("Урок не найден");
        await db
          .prepare(
            `UPDATE lessons SET class_name = ?, weekday = ?, starts_at = ?, ends_at = ?,
          subject_id = ?, teacher_user_id = ?, room = ?, status = ?, note = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          )
          .bind(
            className,
            weekday,
            startsAt,
            endsAt,
            subjectId,
            teacherId || null,
            room,
            status,
            note || null,
            lessonId,
          )
          .run();
      } else {
        await db
          .prepare(
            "INSERT INTO lessons (id, class_name, weekday, starts_at, ends_at, subject_id, teacher_user_id, room, status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            savedLessonId,
            className,
            weekday,
            startsAt,
            endsAt,
            subjectId,
            teacherId || null,
            room,
            status,
            note || null,
          )
          .run();
      }
      await audit(
        actor,
        action,
        "lesson",
        savedLessonId,
        `${className}: ${weekday}, ${startsAt}`,
      );
    } else if (action === "lesson.delete") {
      const lessonId = textValue(body.lessonId, 120);
      const existingLesson = await db
        .prepare(
          "SELECT class_name AS className, weekday, starts_at AS startsAt FROM lessons WHERE id = ? AND status != 'archived'",
        )
        .bind(lessonId)
        .first<{ className: string; weekday: number; startsAt: string }>();
      if (!existingLesson) throw new Error("Урок уже удалён или не найден");
      await db
        .prepare(
          "UPDATE lessons SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(lessonId)
        .run();
      await audit(
        actor,
        action,
        "lesson",
        lessonId,
        `${existingLesson.className}: ${existingLesson.weekday}, ${existingLesson.startsAt}`,
      );
    } else if (action === "lesson.copy-day") {
      const className = textValue(body.className, 20);
      const sourceWeekday = numberValue(body.sourceWeekday, 1, 6);
      const targetWeekday = numberValue(body.targetWeekday, 1, 6);
      if (sourceWeekday === targetWeekday)
        throw new Error("Выберите другой день для копирования");
      const schoolClass = await db
        .prepare(
          "SELECT id FROM school_classes WHERE name = ? AND status = 'active'",
        )
        .bind(className)
        .first<{ id: string }>();
      if (!schoolClass) throw new Error("Выберите класс из списка 1–6");
      const sourceLessons = await db
        .prepare(
          `SELECT id, starts_at AS startsAt, ends_at AS endsAt,
        subject_id AS subjectId, teacher_user_id AS teacherId, room, status, note
        FROM lessons WHERE class_name = ? AND weekday = ? AND status NOT IN ('cancelled', 'archived') ORDER BY starts_at`,
        )
        .bind(className, sourceWeekday)
        .all<{
          id: string;
          startsAt: string;
          endsAt: string;
          subjectId: string;
          teacherId: string | null;
          room: string;
          status: string;
          note: string | null;
        }>();
      if (!sourceLessons.results.length)
        throw new Error("В исходном дне пока нет уроков");
      const targetCount = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM lessons WHERE class_name = ? AND weekday = ? AND status NOT IN ('cancelled', 'archived')",
        )
        .bind(className, targetWeekday)
        .first<{ count: number }>();
      if ((targetCount?.count ?? 0) > 0)
        throw new Error(
          "В выбранном дне уже есть уроки. Очистите день или добавьте уроки вручную",
        );
      for (const lesson of sourceLessons.results) {
        await assertNoScheduleConflict({
          className,
          weekday: targetWeekday,
          startsAt: lesson.startsAt,
          endsAt: lesson.endsAt,
          teacherId: lesson.teacherId ?? "",
          room: lesson.room,
        });
      }
      const copied = sourceLessons.results.map((lesson) => {
        const copiedId = `lesson-copy-${crypto.randomUUID()}`;
        return db
          .prepare(
            "INSERT INTO lessons (id, class_name, weekday, starts_at, ends_at, subject_id, teacher_user_id, room, status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            copiedId,
            className,
            targetWeekday,
            lesson.startsAt,
            lesson.endsAt,
            lesson.subjectId,
            lesson.teacherId,
            lesson.room,
            "scheduled",
            lesson.note,
          );
      });
      await db.batch(copied);
      await audit(
        actor,
        action,
        "schedule_day",
        `${className}-${targetWeekday}`,
        `${sourceWeekday} → ${targetWeekday}; ${copied.length} уроков`,
      );
    } else if (action === "program.import") {
      const file = body.file;
      if (!(file instanceof File)) throw new Error("Выберите файл XLSX");
      if (!file.name.toLowerCase().endsWith(".xlsx"))
        throw new Error("Поддерживается только формат XLSX");
      if (file.size <= 0) throw new Error("Выбранный XLSX пуст");
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Размер XLSX не должен превышать 5 МБ");
      const className = textValue(body.className, 20);
      const subjectId = textValue(body.subjectId, 80);
      const teacherUserId = leadershipRoles.has(actor.role)
        ? textValue(body.teacherUserId, 100)
        : actor.id;
      if (leadershipRoles.has(actor.role)) {
        const teacher = await db
          .prepare(
            "SELECT id FROM users WHERE id = ? AND role = 'teacher' AND profile_status NOT IN ('vacant', 'demo')",
          )
          .bind(teacherUserId)
          .first<{ id: string }>();
        if (!teacher) throw new Error("Выберите действующего преподавателя");
        await assertConfirmedTeacherAssignment(
          teacherUserId,
          className,
          subjectId,
        );
      }
      if (!leadershipRoles.has(actor.role))
        await assertTeacherClassScope(actor, className, subjectId);

      const existingProgram = await db
        .prepare(
          `SELECT id, status FROM programs
          WHERE academic_year = ? AND class_name = ? AND subject_id = ? AND teacher_user_id = ?`,
        )
        .bind(ACADEMIC_YEAR.id, className, subjectId, teacherUserId)
        .first<{ id: string; status: string }>();
      if (
        actor.role === "teacher" &&
        existingProgram &&
        ["approved", "active"].includes(existingProgram.status)
      ) {
        throw new Error(
          "Утверждённую программу возвращает в работу завуч или директор",
        );
      }

      let parsed;
      try {
        parsed = await parseCurriculumWorkbook(await file.arrayBuffer());
      } catch (parseError) {
        const parseMessage =
          parseError instanceof Error ? parseError.message : "файл повреждён";
        throw new Error(`Не удалось прочитать XLSX: ${parseMessage}`);
      }
      const allocation = await calculateCurriculumAllocation(
        className,
        subjectId,
        parsed.rows,
      );
      const programId =
        existingProgram?.id ?? `program-${crypto.randomUUID()}`;
      const importId = `program-import-${crypto.randomUUID()}`;
      const defaultTitle = file.name.replace(/\.xlsx$/i, "").trim();
      const title =
        textValue(body.title, 180, false) ||
        defaultTitle ||
        `Рабочая программа ${ACADEMIC_YEAR.id}`;
      const statements = [
        db
          .prepare(
            `INSERT INTO programs
            (id, academic_year, class_name, subject_id, teacher_user_id, title, status, planned_lessons)
            VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)
            ON CONFLICT(academic_year, class_name, subject_id, teacher_user_id)
            DO UPDATE SET title = excluded.title, status = 'draft',
              planned_lessons = excluded.planned_lessons, updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            programId,
            ACADEMIC_YEAR.id,
            className,
            subjectId,
            teacherUserId,
            title,
            parsed.totalHours,
          ),
        db
          .prepare("DELETE FROM program_topics WHERE program_id = ?")
          .bind(programId),
        db
          .prepare(
            `INSERT INTO program_imports
            (id, program_id, file_name, sheet_name, imported_by_user_id, row_count,
              required_hours, available_slots, scheduled_hours, unscheduled_hours, validation_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            importId,
            programId,
            file.name.slice(0, 180),
            parsed.sheetName.slice(0, 120),
            actor.id,
            parsed.rows.length,
            allocation.requiredHours,
            allocation.availableSlots,
            allocation.scheduledHours,
            allocation.unscheduledHours,
            allocation.status,
          ),
      ];
      for (const topic of allocation.topics) {
        const topicId = `program-topic-${crypto.randomUUID()}`;
        statements.push(
          db
            .prepare(
              `INSERT INTO program_topics
              (id, program_id, import_id, source_row, sequence, topic, planned_hours,
                homework, source_date, sort_order, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')`,
            )
            .bind(
              topicId,
              programId,
              importId,
              topic.sourceRow,
              topic.sequence,
              topic.topic,
              topic.hours,
              topic.homework,
              topic.sourceDate,
              topic.sortOrder,
            ),
        );
        for (const session of topic.sessions) {
          statements.push(
            db
              .prepare(
                `INSERT INTO program_topic_sessions
                (id, program_id, topic_id, session_index, scheduled_date,
                  template_lesson_id, starts_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                `program-session-${crypto.randomUUID()}`,
                programId,
                topicId,
                session.sessionIndex,
                session.scheduledDate,
                session.templateLessonId,
                session.startsAt,
                session.status,
              ),
          );
        }
      }
      await db.batch(statements);
      responsePayload = {
        importSummary: {
          programId,
          rows: parsed.rows.length,
          requiredHours: allocation.requiredHours,
          availableSlots: allocation.availableSlots,
          scheduledHours: allocation.scheduledHours,
          unscheduledHours: allocation.unscheduledHours,
          unusedSlots: allocation.unusedSlots,
          status: allocation.status,
        },
      };
      await audit(
        actor,
        action,
        "program",
        programId,
        `${file.name}; ${allocation.requiredHours} ч.; ${allocation.availableSlots} слотов; ${allocation.unscheduledHours} без даты`,
      );
    } else if (action === "program.reschedule") {
      const programId = textValue(body.programId, 120);
      const program = await db
        .prepare(
          `SELECT id, class_name AS className, subject_id AS subjectId,
            teacher_user_id AS teacherUserId, status
          FROM programs WHERE id = ?`,
        )
        .bind(programId)
        .first<{
          id: string;
          className: string;
          subjectId: string;
          teacherUserId: string;
          status: string;
        }>();
      if (!program) throw new Error("Программа не найдена");
      if (actor.role === "teacher" && program.teacherUserId !== actor.id)
        throw new Error("Нет доступа к этой программе");
      await assertTeacherClassScope(
        effectiveUser,
        program.className,
        program.subjectId,
      );
      const topicResult = await db
        .prepare(
          `SELECT source_row AS sourceRow, sequence, topic,
            planned_hours AS hours, homework, source_date AS sourceDate
          FROM program_topics WHERE program_id = ? ORDER BY sort_order`,
        )
        .bind(programId)
        .all<CurriculumRowInput>();
      if (!topicResult.results.length)
        throw new Error("Сначала импортируйте темы из XLSX");
      const allocation = await calculateCurriculumAllocation(
        program.className,
        program.subjectId,
        topicResult.results,
      );
      const latestImport = await db
        .prepare(
          `SELECT id FROM program_imports
          WHERE program_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        )
        .bind(programId)
        .first<{ id: string }>();
      if (!latestImport) throw new Error("История импорта не найдена");
      const topicsByOrder = await db
        .prepare(
          "SELECT id, sort_order AS sortOrder FROM program_topics WHERE program_id = ? ORDER BY sort_order",
        )
        .bind(programId)
        .all<{ id: string; sortOrder: number }>();
      const topicIds = new Map(
        topicsByOrder.results.map((topic) => [topic.sortOrder, topic.id]),
      );
      const statements = [
        db
          .prepare("DELETE FROM program_topic_sessions WHERE program_id = ?")
          .bind(programId),
      ];
      for (const topic of allocation.topics) {
        const topicId = topicIds.get(topic.sortOrder);
        if (!topicId) throw new Error("Структура программы повреждена");
        for (const session of topic.sessions) {
          statements.push(
            db
              .prepare(
                `INSERT INTO program_topic_sessions
                (id, program_id, topic_id, session_index, scheduled_date,
                  template_lesson_id, starts_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                `program-session-${crypto.randomUUID()}`,
                programId,
                topicId,
                session.sessionIndex,
                session.scheduledDate,
                session.templateLessonId,
                session.startsAt,
                session.status,
              ),
          );
        }
      }
      statements.push(
        db
          .prepare(
            `UPDATE program_imports
            SET available_slots = ?, scheduled_hours = ?, unscheduled_hours = ?,
              validation_status = ?
            WHERE id = ?`,
          )
          .bind(
            allocation.availableSlots,
            allocation.scheduledHours,
            allocation.unscheduledHours,
            allocation.status,
            latestImport.id,
          ),
        db
          .prepare(
            `UPDATE programs
            SET status = CASE
              WHEN status IN ('approved', 'active') AND ? > 0 THEN 'changes_requested'
              ELSE status END,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          )
          .bind(allocation.unscheduledHours, programId),
      );
      await db.batch(statements);
      responsePayload = {
        importSummary: {
          programId,
          rows: topicResult.results.length,
          requiredHours: allocation.requiredHours,
          availableSlots: allocation.availableSlots,
          scheduledHours: allocation.scheduledHours,
          unscheduledHours: allocation.unscheduledHours,
          unusedSlots: allocation.unusedSlots,
          status: allocation.status,
        },
      };
      await audit(
        actor,
        action,
        "program",
        programId,
        `Перерасчёт: ${allocation.requiredHours} ч.; ${allocation.availableSlots} слотов; ${allocation.unscheduledHours} без даты`,
      );
    } else if (action === "program.upsert") {
      const className = textValue(body.className, 20);
      const subjectId = textValue(body.subjectId, 80);
      const title = textValue(body.title, 180);
      const plannedLessons = numberValue(body.plannedLessons ?? 0, 0, 500);
      const requestedStatus = textValue(body.status ?? "draft", 30);
      const teacherUserId = leadershipRoles.has(actor.role)
        ? textValue(body.teacherUserId, 100)
        : actor.id;
      if (leadershipRoles.has(actor.role)) {
        const teacher = await db
          .prepare(
            "SELECT id FROM users WHERE id = ? AND role = 'teacher' AND profile_status NOT IN ('vacant', 'demo')",
          )
          .bind(teacherUserId)
          .first<{ id: string }>();
        if (!teacher) throw new Error("Выберите действующего преподавателя");
        await assertConfirmedTeacherAssignment(
          teacherUserId,
          className,
          subjectId,
        );
      }
      if (!leadershipRoles.has(actor.role))
        await assertTeacherClassScope(actor, className, subjectId);
      const allowedStatuses = leadershipRoles.has(actor.role)
        ? [
            "draft",
            "review",
            "changes_requested",
            "approved",
            "active",
            "archived",
          ]
        : ["draft", "review"];
      if (!allowedStatuses.includes(requestedStatus))
        throw new Error("Выберите допустимый статус программы");
      const importedValidation = await db
        .prepare(
          `SELECT pi.required_hours AS requiredHours,
            pi.unscheduled_hours AS unscheduledHours
          FROM program_imports pi
          JOIN programs p ON p.id = pi.program_id
          WHERE p.academic_year = ? AND p.class_name = ? AND p.subject_id = ?
            AND p.teacher_user_id = ?
          ORDER BY pi.created_at DESC, pi.rowid DESC LIMIT 1`,
        )
        .bind(ACADEMIC_YEAR.id, className, subjectId, teacherUserId)
        .first<{ requiredHours: number; unscheduledHours: number }>();
      if (
        importedValidation &&
        plannedLessons !== importedValidation.requiredHours
      ) {
        throw new Error(
          "Количество часов импортированной программы изменяется только через новый XLSX",
        );
      }
      if (
        importedValidation?.unscheduledHours &&
        ["approved", "active"].includes(requestedStatus)
      ) {
        throw new Error(
          `Нельзя утвердить программу: ${importedValidation.unscheduledHours} ч. не помещаются в расписание`,
        );
      }
      const programId = textValue(body.programId, 120, false) || id;
      await db
        .prepare(
          `INSERT INTO programs
        (id, academic_year, class_name, subject_id, teacher_user_id, title, status, planned_lessons)
        VALUES (?, '2026/27', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(academic_year, class_name, subject_id, teacher_user_id)
        DO UPDATE SET title = excluded.title, status = excluded.status,
          planned_lessons = excluded.planned_lessons, updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          programId,
          className,
          subjectId,
          teacherUserId,
          title,
          requestedStatus,
          plannedLessons,
        )
        .run();
      await audit(
        actor,
        action,
        "program",
        programId,
        `${className}: ${subjectId}, ${requestedStatus}`,
      );
    } else if (action === "attendance.mark") {
      const lessonId = textValue(body.lessonId, 120);
      const studentId = textValue(body.studentId, 100);
      const status = textValue(body.status, 30);
      const note = textValue(body.note, 300, false);
      if (!["present", "absent", "late", "excused"].includes(status))
        throw new Error("Проверьте отметку посещаемости");
      const lesson = await db
        .prepare(
          "SELECT class_name AS className, subject_id AS subjectId FROM lessons WHERE id = ? AND status != 'archived'",
        )
        .bind(lessonId)
        .first<{ className: string; subjectId: string }>();
      if (!lesson) throw new Error("Урок не найден");
      await assertTeacherScope(effectiveUser, studentId, lesson.subjectId);
      await db
        .prepare(
          `INSERT INTO attendance (id, lesson_id, student_id, status, note, marked_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(lesson_id, student_id) DO UPDATE SET status = excluded.status,
          note = excluded.note, marked_by_user_id = excluded.marked_by_user_id,
          marked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(id, lessonId, studentId, status, note || null, actor.id)
        .run();
      await audit(
        actor,
        action,
        "attendance",
        `${lessonId}-${studentId}`,
        status,
      );
    } else if (action === "notification.read") {
      const notificationId = textValue(body.notificationId, 120);
      const result = await db
        .prepare(
          "UPDATE notifications SET read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        )
        .bind(notificationId, actor.id)
        .run();
      if (!result.meta.changes) throw new Error("Уведомление не найдено");
      await audit(actor, action, "notification", notificationId, "Прочитано");
    } else if (action === "menu.rate") {
      if (actor.role !== "student")
        throw new Error("Оценить блюдо может только ученик");
      const menuDayId = textValue(body.menuDayId, 120);
      const studentId = textValue(body.studentId, 100);
      const meal = textValue(body.meal, 30);
      const value = numberValue(body.value, 1, 5);
      const reason = textValue(body.reason, 120, false);
      const allowed = await visibleStudentIds(actor);
      if (!allowed.includes(studentId))
        throw new Error("Нет доступа к карточке ученика");
      if (!["breakfast", "lunch", "snack"].includes(meal))
        throw new Error("Проверьте приём пищи");
      try {
        await db
          .prepare(
            "INSERT INTO menu_ratings (id, menu_day_id, student_id, meal, value, reason) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(id, menuDayId, studentId, meal, value, reason)
          .run();
      } catch {
        throw new Error("Это блюдо уже оценено");
      }
      await audit(actor, action, "menu_rating", id, `${menuDayId}: ${meal}`);
    } else if (action === "event.create") {
      const title = textValue(body.title, 160);
      const description = textValue(body.description, 1000);
      const startsAt = textValue(body.startsAt, 80);
      const location = textValue(body.location, 160);
      const audience = textValue(body.audience, 80);
      await db
        .prepare(
          "INSERT INTO events (id, title, description, starts_at, location, audience) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, title, description, startsAt, location, audience)
        .run();
      await audit(actor, action, "event", id, title);
    } else if (action === "menu.update") {
      const dayDate = textValue(body.dayDate, 20);
      const breakfast = textValue(body.breakfast, 500);
      const lunch = textValue(body.lunch, 500);
      const snack = textValue(body.snack, 500);
      const allergens = textValue(body.allergens, 500, false);
      await db
        .prepare(
          "INSERT INTO menu_days (id, day_date, breakfast, lunch, snack, allergens) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(day_date) DO UPDATE SET breakfast = excluded.breakfast, lunch = excluded.lunch, snack = excluded.snack, allergens = excluded.allergens, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id, dayDate, breakfast, lunch, snack, allergens)
        .run();
      await audit(actor, action, "menu", dayDate, dayDate);
    } else if (action === "activity.create") {
      const title = textValue(body.title, 160);
      const schedule = textValue(body.schedule, 160);
      const teacher = textValue(body.teacher, 140);
      const price = numberValue(body.price ?? 0, 0, 1_000_000);
      const capacity = numberValue(body.capacity ?? 0, 0, 1000);
      await db
        .prepare(
          "INSERT INTO activities (id, title, schedule, teacher, price, capacity) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, title, schedule, teacher, price, capacity)
        .run();
      await audit(actor, action, "activity", id, title);
    } else if (action === "subscription.upsert") {
      const studentId = textValue(body.studentId, 80);
      const name = textValue(body.name, 160);
      const period = textValue(body.period, 80);
      const balance = numberValue(body.balance ?? 0, 0, 10_000_000);
      const lessonsLeft = numberValue(body.lessonsLeft ?? 0, 0, 1000);
      const renewalAt = textValue(body.renewalAt, 30, false);
      await db
        .prepare(
          "INSERT INTO subscriptions (id, student_id, name, period, status, balance, lessons_left, renewal_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
        )
        .bind(
          id,
          studentId,
          name,
          period,
          balance,
          lessonsLeft,
          renewalAt || null,
        )
        .run();
      await audit(actor, action, "subscription", id, `${studentId}: ${name}`);
    } else {
      return Response.json({ error: "Неизвестное действие" }, { status: 400 });
    }

    return Response.json({ ok: true, id, ...responsePayload });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось сохранить действие";
    return Response.json({ error: message }, { status: 400 });
  }
}
