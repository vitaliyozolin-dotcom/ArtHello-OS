#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/var/lock/school-1-11-four-role-regression.lock
flock -n 9

production=school-1-11
staging=school-1-11-staging
regression="school-1-11-role-regression-$RUN_ID"
regression_data="school-1-11_role_regression_${RUN_ID}_data"
container_created=0
volume_created=0
success=0
work=""
container_backup_path=""

case "$regression:$regression_data" in
  school-1-11-role-regression-*:school-1-11_role_regression_*_data) ;;
  *) printf 'Invalid regression resource names\n' >&2; exit 1 ;;
esac

cleanup() {
  rc=$?
  trap - EXIT
  set +e
  if [ "$container_created" -eq 1 ]; then
    docker rm -f "$regression" >/dev/null 2>&1
  fi
  if [ "$volume_created" -eq 1 ]; then
    docker volume rm "$regression_data" >/dev/null 2>&1
  fi
  case "$container_backup_path" in
    /tmp/school-1-11-*.sqlite)
      docker exec "$staging" rm -f -- "$container_backup_path" >/dev/null 2>&1
      ;;
  esac
  case "$work" in
    /tmp/school-four-role.*) rm -rf -- "$work" ;;
  esac
  if [ "$success" -ne 1 ]; then
    printf 'SCHOOL_FOUR_ROLE_CLEANUP=ATTEMPTED_AFTER_FAILURE\n' >&2
  fi
  exit "$rc"
}
trap cleanup EXIT

test "$(docker inspect "$production" --format '{{.State.Running}}')" = true
test "$(docker inspect "$production" --format '{{.State.Health.Status}}')" = healthy
production_started_before="$(docker inspect "$production" --format '{{.State.StartedAt}}')"
curl -fsS --max-time 30 "$SCHOOL_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null

test "$(docker inspect "$staging" --format '{{.State.Running}}')" = true
test "$(docker inspect "$staging" --format '{{.Config.Image}}')" = "$CANDIDATE_IMAGE"
test "$(docker inspect "$staging" --format '{{index .Config.Labels "school.candidate-sha"}}')" = "$CANDIDATE_SHA"
curl -fsS --max-time 15 "$STAGING_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null
test -z "$(docker ps -aq --filter "name=^/$regression$")"
if docker volume inspect "$regression_data" >/dev/null 2>&1; then
  printf 'Regression data volume already exists\n' >&2
  exit 1
fi

work="$(mktemp -d /tmp/school-four-role.XXXXXX)"
chmod 0700 "$work"
container_backup_path="$(docker exec -e BACKUP_DIR=/tmp "$staging" node scripts/backup-db.mjs | tail -n1)"
case "$container_backup_path" in
  /tmp/school-1-11-*.sqlite) ;;
  *) printf 'Unexpected staging backup path\n' >&2; exit 1 ;;
esac

docker exec -i -e BACKUP_PATH="$container_backup_path" "$staging" node --input-type=module - <<'VERIFY_BACKUP'
import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
const path = process.env.BACKUP_PATH;
const stat = statSync(path);
if (!stat.isFile() || stat.size < 4096) throw new Error('Regression backup is empty');
const db = new DatabaseSync(path, { readOnly: true });
const rows = db.prepare('PRAGMA integrity_check').all();
if (rows.length !== 1 || rows[0].integrity_check !== 'ok')
  throw new Error('Regression backup integrity failed');
db.close();
console.log('SCHOOL_FOUR_ROLE_BACKUP=OK bytes=' + stat.size);
VERIFY_BACKUP

docker cp "$staging:$container_backup_path" "$work/database.sqlite"
chmod 0600 "$work/database.sqlite"
test -s "$work/database.sqlite"
docker exec "$staging" rm -f -- "$container_backup_path"
container_backup_path=""
backup_file=database.sqlite
docker volume create \
  --label school.system=school-1-11 \
  --label school.environment=ephemeral-regression \
  --label school.purpose=four-role-regression \
  --label school.candidate-sha="$CANDIDATE_SHA" \
  "$regression_data" >/dev/null
volume_created=1

docker run --rm -i --network none --user 0:0 \
  -e BACKUP_FILE="$backup_file" \
  -v "$work:/backup:ro" \
  -v "$regression_data:/data" \
  --entrypoint node "$CANDIDATE_IMAGE" --input-type=module - <<'PREPARE_DATA'
import { chmodSync, chownSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const file = process.env.BACKUP_FILE;
if (file !== 'database.sqlite')
  throw new Error('Invalid regression backup file');
const target = '/data/school-1-11.sqlite';
copyFileSync('/backup/' + file, target);
chownSync('/data', 1001, 1001);
chmodSync('/data', 0o750);
chownSync(target, 1001, 1001);
chmodSync(target, 0o640);
const db = new DatabaseSync(target, { readOnly: true });
const rows = db.prepare('PRAGMA integrity_check').all();
if (rows.length !== 1 || rows[0].integrity_check !== 'ok')
  throw new Error('Prepared regression data integrity failed');
db.close();
console.log('SCHOOL_FOUR_ROLE_DATA=OK');
PREPARE_DATA

regression_secret="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
test "${#regression_secret}" -eq 64
docker run -d \
  --name "$regression" \
  --network none \
  --security-opt no-new-privileges:true \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_PATH=/data/school-1-11.sqlite \
  -e PUBLIC_APP_ORIGIN=http://127.0.0.1:3000 \
  -e CENTRAL_ACCESS_SECRET="$regression_secret" \
  -e REGRESSION_RUN_ID="$RUN_ID" \
  -v "$regression_data:/data" \
  "$CANDIDATE_IMAGE" >/dev/null
container_created=1

regression_healthy=0
for attempt in $(seq 1 90); do
  if docker exec "$regression" node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    regression_healthy=1
    break
  fi
  if [ "$(docker inspect "$regression" --format '{{.State.Running}}' 2>/dev/null || true)" != true ]; then
    break
  fi
  sleep 2
done
if [ "$regression_healthy" -ne 1 ]; then
  docker logs "$regression" --tail 120 >&2 || true
  exit 1
fi

docker exec -i "$regression" node --input-type=module - <<'VERIFY_ROLES'
import {
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const scrypt = promisify(scryptCallback);
const db = new DatabaseSync('/data/school-1-11.sqlite');
db.exec('PRAGMA foreign_keys = ON');
const integrityBefore = db.prepare('PRAGMA integrity_check').all();
if (integrityBefore.length !== 1 || integrityBefore[0].integrity_check !== 'ok')
  throw new Error('Role regression input integrity failed');

const student = db
  .prepare("SELECT id, class_name AS className FROM students WHERE status = 'active' ORDER BY class_name, id LIMIT 1")
  .get();
const subject = db
  .prepare("SELECT id FROM subjects WHERE status = 'active' ORDER BY id LIMIT 1")
  .get();
if (!student || !subject) throw new Error('Role regression requires active school data');

const password = 'RoleRegression-' + randomBytes(18).toString('base64url') + '7a';
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

const run = process.env.REGRESSION_RUN_ID;
if (!/^[0-9]+$/.test(run || '')) throw new Error('Invalid regression run id');
const roles = ['director', 'teacher', 'parent', 'student'];
const users = new Map();

for (const role of roles) {
  const id = 'regression-' + run + '-' + role;
  const email = id + '@invalid.local';
  const linkedStudentId =
    role === 'parent' || role === 'student' ? student.id : null;
  db.prepare(
    `INSERT INTO users
      (id, email, display_name, role, linked_student_id, status, profile_status,
       notes, password_hash, password_state, auth_version, failed_login_count,
       locked_until, identity_source, central_access_version)
     VALUES (?, ?, ?, ?, ?, 'active', 'demo', 'ephemeral regression',
       ?, 'active', 1, 0, NULL, 'regression', 0)`,
  ).run(
    id,
    email,
    'Regression ' + role,
    role,
    linkedStudentId,
    passwordHash,
  );
  users.set(role, { id, email });
}

for (const role of ['parent', 'student']) {
  const user = users.get(role);
  db.prepare(
    "INSERT INTO user_student_links (id, user_id, student_id, relation) VALUES (?, ?, ?, ?)",
  ).run(
    'regression-link-' + run + '-' + role,
    user.id,
    student.id,
    role === 'student' ? 'self' : 'guardian',
  );
}

db.prepare(
  `INSERT INTO teacher_assignments
    (id, teacher_user_id, class_name, subject_id, status, notes)
   VALUES (?, ?, ?, ?, 'confirmed', 'ephemeral regression')`,
).run(
  'regression-assignment-' + run,
  users.get('teacher').id,
  student.className,
  subject.id,
);

const base = 'http://127.0.0.1:3000';
const expectedOrigin = 'http://127.0.0.1:3000';
const routeByRole = new Map([
  ['director', '/management'],
  ['teacher', '/journal'],
  ['parent', '/homework'],
  ['student', '/schedule'],
]);
const permissionProbeByRole = new Map([
  [
    'director',
    {
      action: 'grade.create',
      error: 'Это действие доступно назначенному учителю',
    },
  ],
  [
    'teacher',
    {
      action: 'event.create',
      error: 'Это действие доступно уполномоченному сотруднику школы',
    },
  ],
  [
    'parent',
    {
      action: 'grade.create',
      error: 'Это действие доступно назначенному учителю',
    },
  ],
  [
    'student',
    {
      action: 'message.send',
      error: 'Диалог доступен семье и уполномоченным сотрудникам',
    },
  ],
]);

for (const role of roles) {
  const user = users.get(role);
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: {
      origin: expectedOrigin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ login: user.email, password }),
  });
  const loginPayload = await login.json();
  if (!login.ok || loginPayload.ok !== true)
    throw new Error('Login failed for role ' + role);
  const setCookie = login.headers.get('set-cookie') || '';
  if (
    !setCookie.includes('school_session=') ||
    !setCookie.includes('HttpOnly') ||
    !setCookie.includes('SameSite=Lax')
  )
    throw new Error('Session cookie contract failed for role ' + role);
  const cookie = setCookie.split(';', 1)[0];

  const snapshotResponse = await fetch(base + '/api/school', {
    headers: { cookie },
  });
  const snapshot = await snapshotResponse.json();
  if (!snapshotResponse.ok || snapshot.viewer?.role !== role)
    throw new Error('Snapshot role mismatch for ' + role);
  if (!Array.isArray(snapshot.students) || !Array.isArray(snapshot.lessons))
    throw new Error('Snapshot shape failed for ' + role);

  if (role === 'director') {
    if (snapshot.students.length < 1 || snapshot.rankings?.mode !== 'named')
      throw new Error('Director visibility contract failed');
  } else if (role === 'teacher') {
    if (
      snapshot.students.length < 1 ||
      snapshot.rankings?.mode !== 'named'
    )
      throw new Error('Teacher scope contract failed');
  } else if (role === 'parent') {
    if (
      snapshot.students.length !== 1 ||
      snapshot.selectedStudent?.id !== student.id ||
      snapshot.rankings?.mode !== 'anonymous'
    )
      throw new Error('Parent scope contract failed');
  } else if (role === 'student') {
    if (
      snapshot.students.length !== 1 ||
      snapshot.selectedStudent?.id !== student.id ||
      snapshot.rankings?.mode !== 'none'
    )
      throw new Error('Student scope contract failed');
  }

  const route = await fetch(base + routeByRole.get(role), {
    headers: { cookie },
  });
  const html = await route.text();
  if (!route.ok || html.length < 1000 || !html.includes('<html'))
    throw new Error('UI route failed for role ' + role);

  const probe = permissionProbeByRole.get(role);
  const permissionResponse = await fetch(base + '/api/school', {
    method: 'POST',
    headers: {
      origin: expectedOrigin,
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: probe.action }),
  });
  const permissionPayload = await permissionResponse.json();
  if (
    permissionResponse.status !== 400 ||
    permissionPayload.error !== probe.error
  )
    throw new Error('Permission boundary failed for role ' + role);

  const logout = await fetch(base + '/api/auth/logout', {
    headers: { cookie },
    redirect: 'manual',
  });
  if (
    logout.status !== 303 ||
    logout.headers.get('location') !== '/login' ||
    !(logout.headers.get('set-cookie') || '').includes('Max-Age=0')
  )
    throw new Error('Logout contract failed for role ' + role);
  const afterLogout = await fetch(base + '/api/school', {
    headers: { cookie },
  });
  if (afterLogout.status !== 401)
    throw new Error('Session invalidation failed for role ' + role);

  console.log('SCHOOL_ROLE_' + role.toUpperCase() + '=OK');
}

const integrityAfter = db.prepare('PRAGMA integrity_check').all();
if (integrityAfter.length !== 1 || integrityAfter[0].integrity_check !== 'ok')
  throw new Error('Role regression output integrity failed');
db.close();
console.log('SCHOOL_FOUR_ROLE_AUTH=OK');
console.log('SCHOOL_FOUR_ROLE_SCOPE=OK');
console.log('SCHOOL_FOUR_ROLE_PERMISSIONS=OK');
console.log('SCHOOL_FOUR_ROLE_LOGOUT=OK');
VERIFY_ROLES

test "$(docker inspect "$regression" --format '{{.HostConfig.NetworkMode}}')" = none
printf 'SCHOOL_FOUR_ROLE_NETWORK=isolated\n'

docker rm -f "$regression" >/dev/null
container_created=0
docker volume rm "$regression_data" >/dev/null
volume_created=0
rm -rf -- "$work"
work=""
test -z "$(docker ps -aq --filter "name=^/$regression$")"
if docker volume inspect "$regression_data" >/dev/null 2>&1; then
  printf 'Regression data volume was not removed\n' >&2
  exit 1
fi
printf 'SCHOOL_FOUR_ROLE_CLEANUP=OK\n'

test "$(docker inspect "$production" --format '{{.State.StartedAt}}')" = "$production_started_before"
test "$(docker inspect "$production" --format '{{.State.Health.Status}}')" = healthy
curl -fsS --max-time 30 "$SCHOOL_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null
test "$(docker inspect "$staging" --format '{{.State.Running}}')" = true
test "$(docker inspect "$staging" --format '{{.Config.Image}}')" = "$CANDIDATE_IMAGE"
curl -fsS --max-time 15 "$STAGING_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null

success=1
printf 'SCHOOL_FOUR_ROLE_REGRESSION=OK\n'
printf 'SCHOOL_FOUR_ROLE_STAGING_CHANGED=no\n'
printf 'SCHOOL_FOUR_ROLE_PRODUCTION_RESTARTED=no\n'
printf 'SCHOOL_FOUR_ROLE_PRODUCTION_HEALTH=OK\n'
