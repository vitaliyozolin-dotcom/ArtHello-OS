#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${ACTION:?ACTION is required}"
: "${RUN_ID:?RUN_ID is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}"
: "${SCHOOL_ORIGIN:?SCHOOL_ORIGIN is required}"
: "${STAGING_ORIGIN:?STAGING_ORIGIN is required}"
: "${AUDIT_PUBLIC_ORIGIN:?AUDIT_PUBLIC_ORIGIN is required}"
: "${AUDIT_BIND_ORIGIN:?AUDIT_BIND_ORIGIN is required}"

case "$RUN_ID" in
  ''|*[!0-9]*) printf 'Invalid RUN_ID\n' >&2; exit 1 ;;
esac
case "$AUDIT_PUBLIC_ORIGIN" in
  http://127.0.0.1:33212) ;;
  *) printf 'Invalid audit public origin\n' >&2; exit 1 ;;
esac
case "$AUDIT_BIND_ORIGIN" in
  http://127.0.0.1:3212) ;;
  *) printf 'Invalid audit bind origin\n' >&2; exit 1 ;;
esac

production=school-1-11
staging=school-1-11-staging
audit="school-1-11-authorized-visual-$RUN_ID"
audit_data="school-1-11_authorized_visual_${RUN_ID}_data"
audit_network="school-1-11-authorized-visual-$RUN_ID-net"
work="/tmp/school-authorized-visual-$RUN_ID"
production_state_file="$work/production-started-at"
staging_state_file="$work/staging-started-at"

case "$audit:$audit_data:$audit_network:$work" in
  school-1-11-authorized-visual-*:school-1-11_authorized_visual_*_data:school-1-11-authorized-visual-*-net:/tmp/school-authorized-visual-*) ;;
  *) printf 'Invalid audit resource names\n' >&2; exit 1 ;;
esac

assert_services() {
  test "$(docker inspect "$production" --format '{{.State.Running}}')" = true
  test "$(docker inspect "$production" --format '{{.State.Health.Status}}')" = healthy
  curl -fsS --max-time 30 "$SCHOOL_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null

  test "$(docker inspect "$staging" --format '{{.State.Running}}')" = true
  test "$(docker inspect "$staging" --format '{{.State.Health.Status}}')" = healthy
  test "$(docker inspect "$staging" --format '{{.Config.Image}}')" = "$CANDIDATE_IMAGE"
  test "$(docker inspect "$staging" --format '{{index .Config.Labels "school.candidate-sha"}}')" = "$CANDIDATE_SHA"
  curl -fsS --max-time 15 "$STAGING_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null
}

remove_resources() {
  if docker container inspect "$audit" >/dev/null 2>&1; then
    test "$(docker inspect "$audit" --format '{{index .Config.Labels "school.audit-run-id"}}')" = "$RUN_ID"
    docker rm -f "$audit" >/dev/null
  fi
  if docker network inspect "$audit_network" >/dev/null 2>&1; then
    test "$(docker network inspect "$audit_network" --format '{{index .Labels "school.audit-run-id"}}')" = "$RUN_ID"
    docker network rm "$audit_network" >/dev/null
  fi
  if docker volume inspect "$audit_data" >/dev/null 2>&1; then
    test "$(docker volume inspect "$audit_data" --format '{{index .Labels "school.audit-run-id"}}')" = "$RUN_ID"
    docker volume rm "$audit_data" >/dev/null
  fi
  if [ -d "$work" ]; then
    rm -rf -- "$work"
  fi
}

case "$ACTION" in
  prepare)
    : "${AUDIT_PASSWORD:?AUDIT_PASSWORD is required for prepare}"
    if [ "${#AUDIT_PASSWORD}" -lt 32 ] || [[ ! "$AUDIT_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]]; then
      printf 'Invalid audit password\n' >&2
      exit 1
    fi

    exec 9>/var/lock/school-1-11-authorized-visual.lock
    flock -n 9
    assert_services
    production_started_before="$(docker inspect "$production" --format '{{.State.StartedAt}}')"
    staging_started_before="$(docker inspect "$staging" --format '{{.State.StartedAt}}')"

    test -z "$(docker ps -aq --filter "name=^/$audit$")"
    if docker volume inspect "$audit_data" >/dev/null 2>&1; then
      printf 'Audit data volume already exists\n' >&2
      exit 1
    fi
    if docker network inspect "$audit_network" >/dev/null 2>&1; then
      printf 'Audit network already exists\n' >&2
      exit 1
    fi
    if [ -e "$work" ]; then
      printf 'Audit work directory already exists\n' >&2
      exit 1
    fi

    install -m 0700 -d "$work"
    printf '%s\n' "$production_started_before" > "$production_state_file"
    printf '%s\n' "$staging_started_before" > "$staging_state_file"

    prepare_finished=0
    prepare_cleanup() {
      rc=$?
      trap - EXIT
      set +e
      if [ "$prepare_finished" -ne 1 ]; then
        remove_resources >/dev/null 2>&1
        printf 'SCHOOL_AUTHORIZED_VISUAL_PREPARE_CLEANUP=ATTEMPTED_AFTER_FAILURE\n' >&2
      fi
      exit "$rc"
    }
    trap prepare_cleanup EXIT

    docker volume create \
      --label school.system=school-1-11 \
      --label school.environment=ephemeral-authorized-visual-audit \
      --label school.purpose=design-v1-authorized-audit \
      --label school.candidate-sha="$CANDIDATE_SHA" \
      --label school.audit-run-id="$RUN_ID" \
      "$audit_data" >/dev/null

    docker network create \
      --driver bridge \
      --opt com.docker.network.bridge.enable_ip_masquerade=false \
      --opt com.docker.network.bridge.enable_icc=false \
      --label school.system=school-1-11 \
      --label school.environment=ephemeral-authorized-visual-audit \
      --label school.candidate-sha="$CANDIDATE_SHA" \
      --label school.audit-run-id="$RUN_ID" \
      "$audit_network" >/dev/null

    docker run --rm -i --network none --user 0:0 \
      -e AUDIT_PASSWORD="$AUDIT_PASSWORD" \
      -e AUDIT_RUN_ID="$RUN_ID" \
      -v "$audit_data:/data" \
      --entrypoint node "$CANDIDATE_IMAGE" --input-type=module - <<'PREPARE_DATA'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { chmodSync, chownSync, readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const run = process.env.AUDIT_RUN_ID;
const password = process.env.AUDIT_PASSWORD;
if (!/^[0-9]+$/.test(run || '')) throw new Error('Invalid audit run id');
if (!/^[A-Za-z0-9_-]{32,}$/.test(password || '')) throw new Error('Invalid audit password');

const target = '/data/school-1-11.sqlite';
const db = new DatabaseSync(target);
db.exec('PRAGMA foreign_keys = OFF');
const migrationFiles = readdirSync('/app/drizzle')
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (migrationFiles.length < 6) throw new Error('Candidate migration inventory is incomplete');
for (const file of migrationFiles) {
  db.exec(readFileSync('/app/drizzle/' + file, 'utf8'));
}
db.exec('PRAGMA foreign_keys = ON');

const userTables = db
  .prepare(`SELECT name FROM sqlite_schema
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '__drizzle%'
      AND name NOT LIKE '_cf_%'
    ORDER BY name`)
  .all()
  .map((row) => row.name);
if (userTables.length < 20) throw new Error('Unexpected candidate table inventory');
const quoteIdentifier = (value) => '"' + String(value).replaceAll('"', '""') + '"';
for (const table of userTables) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM ' + quoteIdentifier(table)).get().count;
  if (count !== 0) throw new Error('Candidate migration schema is not empty: ' + table);
}

const className = '1А';
const subjects = [
  { id: 'audit-subject-math', name: 'Математика', short: 'Математика', color: '#6d5bd0', icon: 'calculator' },
  { id: 'audit-subject-russian', name: 'Русский язык', short: 'Русский', color: '#e04512', icon: 'book' },
  { id: 'audit-subject-world', name: 'Окружающий мир', short: 'Окр. мир', color: '#168455', icon: 'globe' },
];
const insertSubject = db.prepare(
  `INSERT INTO subjects
    (id, name, short_name, color, icon, stage, weekly_hours, status)
   VALUES (?, ?, ?, ?, ?, '1–4', 4, 'active')`,
);
for (const subject of subjects) {
  insertSubject.run(subject.id, subject.name, subject.short, subject.color, subject.icon);
}

const students = Array.from({ length: 6 }, (_, index) => ({
  id: 'audit-student-' + String(index + 1).padStart(2, '0'),
  firstName: 'Ученик',
  lastName: 'Тестовый ' + String(index + 1).padStart(2, '0'),
  color: ['#e04512', '#6d5bd0', '#168455', '#2563eb', '#c78012', '#0e7490'][index],
}));
const insertStudent = db.prepare(
  `INSERT INTO students
    (id, first_name, last_name, class_name, avatar_color, status)
   VALUES (?, ?, ?, ?, ?, 'active')`,
);
for (const student of students) {
  insertStudent.run(student.id, student.firstName, student.lastName, className, student.color);
}

const scrypt = promisify(scryptCallback);
const salt = randomBytes(16);
const derived = await scrypt(password, salt, 64, {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const passwordHash =
  'scrypt$32768$8$1$' +
  salt.toString('base64url') +
  '$' +
  Buffer.from(derived).toString('base64url');

const roles = new Map([
  ['director', 'Аудит Директор'],
  ['teacher', 'Аудит Учитель'],
  ['parent', 'Аудит Родитель'],
  ['student', 'Аудит Ученик'],
]);
const users = new Map();
for (const [role, displayName] of roles) {
  const id = 'authorized-visual-' + run + '-' + role;
  const email = 'authorized-visual-' + run + '-' + role + '@invalid.local';
  const linkedStudentId = role === 'parent' || role === 'student' ? students[0].id : null;
  db.prepare(
    `INSERT INTO users
      (id, email, display_name, role, linked_student_id, status, profile_status,
       notes, password_hash, password_state, auth_version, failed_login_count,
       locked_until, identity_source, central_access_version)
     VALUES (?, ?, ?, ?, ?, 'active', 'confirmed', '',
       ?, 'active', 1, 0, NULL, 'visual_audit', 0)`,
  ).run(id, email, displayName, role, linkedStudentId, passwordHash);
  users.set(role, { id, email });
}

db.prepare(
  `INSERT INTO school_classes
    (id, name, grade, homeroom_teacher_user_id, status)
   VALUES ('audit-class-1a', ?, 1, ?, 'active')`,
).run(className, users.get('teacher').id);

for (const role of ['parent', 'student']) {
  db.prepare(
    "INSERT INTO user_student_links (id, user_id, student_id, relation) VALUES (?, ?, ?, ?)",
  ).run(
    'authorized-visual-link-' + run + '-' + role,
    users.get(role).id,
    students[0].id,
    role === 'student' ? 'self' : 'guardian',
  );
}

db.prepare(
  `INSERT INTO teacher_assignments
    (id, teacher_user_id, class_name, subject_id, status, notes)
   VALUES (?, ?, ?, ?, 'confirmed', 'ephemeral visual audit')`,
).run(
  'authorized-visual-assignment-' + run,
  users.get('teacher').id,
  className,
  subjects[0].id,
);

const lessonIds = [];
const insertLesson = db.prepare(
  `INSERT INTO lessons
    (id, class_name, weekday, starts_at, ends_at, subject_id,
     teacher_user_id, room, status, note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', NULL)`,
);
for (let weekday = 1; weekday <= 5; weekday += 1) {
  const subject = subjects[(weekday - 1) % subjects.length];
  const id = 'audit-lesson-' + weekday;
  lessonIds.push(id);
  insertLesson.run(
    id,
    className,
    weekday,
    '0' + (7 + weekday) + ':30',
    '0' + (8 + weekday) + ':15',
    subject.id,
    users.get('teacher').id,
    'Кабинет ' + (10 + weekday),
  );
}

const today = new Date();
const addDays = (amount) => {
  const value = new Date(today);
  value.setUTCDate(value.getUTCDate() + amount);
  return value;
};
const dateOnly = (value) => value.toISOString().slice(0, 10);
const dateTime = (value, hour = 12) => {
  const copy = new Date(value);
  copy.setUTCHours(hour, 0, 0, 0);
  return copy.toISOString();
};

const insertGrade = db.prepare(
  `INSERT INTO grades
    (id, student_id, subject_id, teacher_user_id, value, weight,
     title, grade_date, comment)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
);
for (const [studentIndex, student] of students.entries()) {
  insertGrade.run(
    'audit-grade-' + studentIndex + '-math',
    student.id,
    subjects[0].id,
    users.get('teacher').id,
    4 + (studentIndex % 2),
    1,
    'Самостоятельная работа',
    dateOnly(addDays(-2)),
  );
  insertGrade.run(
    'audit-grade-' + studentIndex + '-russian',
    student.id,
    subjects[1].id,
    users.get('teacher').id,
    3 + (studentIndex % 3),
    2,
    'Контрольная работа',
    dateOnly(addDays(-1)),
  );
}

const insertHomework = db.prepare(
  `INSERT INTO homework
    (id, class_name, subject_id, teacher_user_id, title, description, due_at, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'published')`,
);
for (const [index, subject] of subjects.entries()) {
  insertHomework.run(
    'audit-homework-' + index,
    className,
    subject.id,
    users.get('teacher').id,
    ['Задачи 12–16', 'Упражнение 24', 'Наблюдение за погодой'][index],
    'Синтетическое учебное задание для проверки макета.',
    dateTime(addDays(index + 1), 15),
  );
}

db.prepare(
  `INSERT INTO achievements
    (id, student_id, teacher_user_id, title, description, category, achievement_date)
   VALUES ('audit-achievement-1', ?, ?, 'Отличная работа',
     'Синтетическое достижение для проверки карточки.', 'study', ?)`,
).run(students[0].id, users.get('teacher').id, dateOnly(addDays(-3)));

db.prepare(
  `INSERT INTO teacher_comments
    (id, student_id, teacher_user_id, subject_id, body, visibility, comment_date)
   VALUES ('audit-comment-1', ?, ?, ?,
     'Синтетический комментарий для визуального аудита.', 'parent', ?)`,
).run(
  students[0].id,
  users.get('teacher').id,
  subjects[0].id,
  dateOnly(addDays(-1)),
);

db.prepare(
  `INSERT INTO threads
    (id, student_id, parent_user_id, teacher_user_id, title)
   VALUES ('audit-thread-1', ?, ?, ?, 'Учебный диалог')`,
).run(students[0].id, users.get('parent').id, users.get('teacher').id);
db.prepare(
  `INSERT INTO messages
    (id, thread_id, author_user_id, body, read_at)
   VALUES ('audit-message-1', 'audit-thread-1', ?,
     'Синтетическое сообщение для проверки макета.', NULL)`,
).run(users.get('parent').id);

const insertMenu = db.prepare(
  `INSERT INTO menu_days
    (id, day_date, breakfast, lunch, snack, allergens)
   VALUES (?, ?, 'Каша и фрукты', 'Суп и горячее', 'Выпечка', '')`,
);
for (let index = 0; index < 3; index += 1) {
  insertMenu.run('audit-menu-' + index, dateOnly(addDays(index)));
}

const insertEvent = db.prepare(
  `INSERT INTO events
    (id, title, description, starts_at, location, audience, status, capacity)
   VALUES (?, ?, ?, ?, 'Школа', 'all', 'published', ?)`,
);
insertEvent.run(
  'audit-event-1',
  'Школьная встреча',
  'Синтетическое событие для проверки карточки.',
  dateTime(addDays(2), 16),
  60,
);
insertEvent.run(
  'audit-event-2',
  'Творческая мастерская',
  'Синтетическое событие для проверки длинного заголовка.',
  dateTime(addDays(5), 14),
  24,
);

const insertActivity = db.prepare(
  `INSERT INTO activities
    (id, title, schedule, teacher, price, capacity, enrolled, status)
   VALUES (?, ?, ?, 'Педагог', ?, ?, ?, 'open')`,
);
insertActivity.run('audit-activity-1', 'Робототехника', 'Среда · 16:00', 0, 16, 9);
insertActivity.run('audit-activity-2', 'Театральная студия', 'Пятница · 15:30', 1200, 20, 14);

db.prepare(
  `INSERT INTO subscriptions
    (id, student_id, name, period, status, balance, lessons_left, renewal_at)
   VALUES ('audit-subscription-1', ?, 'Школьное питание', 'month', 'active', 2400, 12, ?)`,
).run(students[0].id, dateOnly(addDays(30)));

db.prepare(
  `INSERT INTO programs
    (id, academic_year, class_name, subject_id, teacher_user_id, title,
     status, planned_lessons, completed_lessons, review_comment)
   VALUES ('audit-program-1', '2026/2027', ?, ?, ?,
     'Математика · 1 класс', 'approved', 132, 18, '')`,
).run(className, subjects[0].id, users.get('teacher').id);

const insertAttendance = db.prepare(
  `INSERT INTO attendance
    (id, lesson_id, student_id, status, note, marked_by_user_id)
   VALUES (?, ?, ?, ?, NULL, ?)`,
);
for (const [index, student] of students.entries()) {
  insertAttendance.run(
    'audit-attendance-' + index,
    lessonIds[0],
    student.id,
    index === 4 ? 'absent' : 'present',
    users.get('teacher').id,
  );
}

const insertNotification = db.prepare(
  `INSERT INTO notifications
    (id, user_id, category, title, body, entity_type, entity_id, critical, read_at)
   VALUES (?, ?, 'study', 'Учебное уведомление',
     'Синтетическое уведомление для визуального аудита.', 'lesson', ?, 0, NULL)`,
);
for (const [role, user] of users) {
  insertNotification.run('audit-notification-' + role, user.id, lessonIds[0]);
}

const invitationId = 'audit-invitation-1';
db.prepare(
  `INSERT INTO account_invitations
    (id, token_hash, target_role, student_id, class_name, created_by_user_id,
     expires_at, max_uses, used_count, status)
   VALUES (?, ?, 'parent', ?, ?, ?, ?, 1, 0, 'active')`,
).run(
  invitationId,
  randomBytes(32).toString('hex'),
  students[1].id,
  className,
  users.get('director').id,
  dateTime(addDays(7)),
);
db.prepare(
  `INSERT INTO registration_requests
    (id, email, display_name, requested_role, student_first_name,
     student_last_name, class_name, relation, invitation_id, student_id, status)
   VALUES ('audit-registration-1', 'request@invalid.local', 'Заявитель Тестовый',
     'parent', 'Ученик', 'Тестовый 02', ?, 'guardian', ?, ?, 'pending')`,
).run(className, invitationId, students[1].id);

db.prepare(
  `INSERT INTO audit_log
    (id, actor_user_id, action, entity_type, entity_id, details)
   VALUES ('audit-log-1', ?, 'visual.audit.seed', 'fixture', ?, '{}')`,
).run(users.get('director').id, 'authorized-visual-' + run);

const unsafeUsers = db.prepare(
  `SELECT COUNT(*) AS count FROM users
   WHERE email NOT LIKE '%@invalid.local'
      OR phone IS NOT NULL
      OR central_user_id IS NOT NULL`,
).get().count;
const unsafeRequests = db.prepare(
  `SELECT COUNT(*) AS count FROM registration_requests
   WHERE email NOT LIKE '%@invalid.local'`,
).get().count;
const credentialRows = db.prepare(
  `SELECT
    (SELECT COUNT(*) FROM auth_sessions) +
    (SELECT COUNT(*) FROM credential_tokens) AS count`,
).get().count;
if (unsafeUsers !== 0 || unsafeRequests !== 0 || credentialRows !== 0) {
  throw new Error('Synthetic fixture privacy invariant failed');
}

const integrityAfter = db.prepare('PRAGMA integrity_check').all();
if (integrityAfter.length !== 1 || integrityAfter[0].integrity_check !== 'ok') {
  throw new Error('Authorized visual output integrity failed');
}
const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
if (foreignKeyViolations.length) throw new Error('Authorized visual foreign key check failed');
db.close();
chownSync('/data', 1001, 1001);
chmodSync('/data', 0o750);
chownSync(target, 1001, 1001);
chmodSync(target, 0o640);
console.log('SCHOOL_AUTHORIZED_VISUAL_SOURCE=candidate-migrations-only');
console.log('SCHOOL_AUTHORIZED_VISUAL_DATA=SYNTHETIC');
console.log('SCHOOL_AUTHORIZED_VISUAL_ROLES=SEEDED');
PREPARE_DATA

    audit_secret="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
    test "${#audit_secret}" -eq 64

    docker run -d \
      --name "$audit" \
      --network "$audit_network" \
      --publish 127.0.0.1:3212:3000 \
      --security-opt no-new-privileges:true \
      --cap-drop ALL \
      --pids-limit 256 \
      --label school.system=school-1-11 \
      --label school.environment=ephemeral-authorized-visual-audit \
      --label school.candidate-sha="$CANDIDATE_SHA" \
      --label school.audit-run-id="$RUN_ID" \
      -e NODE_ENV=production \
      -e PORT=3000 \
      -e DATABASE_PATH=/data/school-1-11.sqlite \
      -e PUBLIC_APP_ORIGIN="$AUDIT_PUBLIC_ORIGIN" \
      -e CENTRAL_ACCESS_SECRET="$audit_secret" \
      -v "$audit_data:/data" \
      "$CANDIDATE_IMAGE" >/dev/null

    audit_healthy=0
    for attempt in $(seq 1 90); do
      if curl -fsS --max-time 3 "$AUDIT_BIND_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null 2>&1; then
        audit_healthy=1
        break
      fi
      if [ "$(docker inspect "$audit" --format '{{.State.Running}}' 2>/dev/null || true)" != true ]; then
        break
      fi
      sleep 2
    done
    if [ "$audit_healthy" -ne 1 ]; then
      docker logs "$audit" --tail 120 >&2 || true
      exit 1
    fi

    test "$(docker network inspect "$audit_network" --format '{{.Internal}}')" = false
    test "$(docker network inspect "$audit_network" --format '{{index .Options "com.docker.network.bridge.enable_ip_masquerade"}}')" = false
    test "$(docker network inspect "$audit_network" --format '{{index .Options "com.docker.network.bridge.enable_icc"}}')" = false
    docker exec -i "$audit" node --input-type=module - <<'VERIFY_EGRESS'
import { connect } from 'node:net';
const socket = connect({ host: '1.1.1.1', port: 443 });
let settled = false;
const finish = (blocked) => {
  if (settled) return;
  settled = true;
  socket.destroy();
  if (!blocked) throw new Error('Authorized visual fixture has external egress');
  console.log('SCHOOL_AUTHORIZED_VISUAL_EGRESS=blocked');
};
socket.setTimeout(2500, () => finish(true));
socket.once('error', () => finish(true));
    socket.once('connect', () => finish(false));
VERIFY_EGRESS
    binding="$(docker inspect "$audit" --format '{{json .HostConfig.PortBindings}}')"
    BINDING="$binding" python3 - <<'VERIFY_BINDING'
import json
import os

bindings = json.loads(os.environ['BINDING'])
target = bindings.get('3000/tcp')
if not isinstance(target, list) or len(target) != 1:
    raise RuntimeError('Unexpected audit port binding')
if target[0].get('HostIp') != '127.0.0.1' or target[0].get('HostPort') != '3212':
    raise RuntimeError('Audit port is not loopback-only')
print('SCHOOL_AUTHORIZED_VISUAL_BINDING=loopback-only')
VERIFY_BINDING

    test "$(docker inspect "$production" --format '{{.State.StartedAt}}')" = "$production_started_before"
    test "$(docker inspect "$staging" --format '{{.State.StartedAt}}')" = "$staging_started_before"
    assert_services
    prepare_finished=1
    printf 'SCHOOL_AUTHORIZED_VISUAL_FIXTURE=READY\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_PRODUCTION_RESTARTED=no\n'
    ;;

  cleanup)
    exec 9>/var/lock/school-1-11-authorized-visual.lock
    flock -n 9
    production_started_before=""
    staging_started_before=""
    if [ -f "$production_state_file" ]; then
      production_started_before="$(head -n1 "$production_state_file")"
    fi
    if [ -f "$staging_state_file" ]; then
      staging_started_before="$(head -n1 "$staging_state_file")"
    fi
    remove_resources
    test -z "$(docker ps -aq --filter "name=^/$audit$")"
    ! docker volume inspect "$audit_data" >/dev/null 2>&1
    ! docker network inspect "$audit_network" >/dev/null 2>&1
    test ! -e "$work"
    if [ -n "$production_started_before" ]; then
      test "$(docker inspect "$production" --format '{{.State.StartedAt}}')" = "$production_started_before"
    fi
    if [ -n "$staging_started_before" ]; then
      test "$(docker inspect "$staging" --format '{{.State.StartedAt}}')" = "$staging_started_before"
    fi
    assert_services
    printf 'SCHOOL_AUTHORIZED_VISUAL_CLEANUP=OK\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_STAGING_CHANGED=no\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_PRODUCTION_RESTARTED=no\n'
    ;;

  *)
    printf 'ACTION must be prepare or cleanup\n' >&2
    exit 1
    ;;
esac
