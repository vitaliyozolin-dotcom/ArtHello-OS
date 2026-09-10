#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${RUN_ID:?RUN_ID is required}"
: "${RUN_ATTEMPT:?RUN_ATTEMPT is required}"
: "${WORKFLOW_SHA:?WORKFLOW_SHA is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${RELEASE_TREE:?RELEASE_TREE is required}"
: "${SOURCE_ARCHIVE:?SOURCE_ARCHIVE is required}"
: "${SOURCE_SHA256:?SOURCE_SHA256 is required}"
: "${VERIFY_SCRIPT:?VERIFY_SCRIPT is required}"
: "${VERIFY_SHA256:?VERIFY_SHA256 is required}"
: "${OFFLINE_BASE_REF:?OFFLINE_BASE_REF is required}"
: "${SCHOOL_ORIGIN:?SCHOOL_ORIGIN is required}"
: "${ARTHELLO_ORIGIN:?ARTHELLO_ORIGIN is required}"
: "${JOB_DIR:?JOB_DIR is required}"
: "${SCHOOL_CONTAINER:?SCHOOL_CONTAINER is required}"

[[ "$RUN_ID" =~ ^[0-9]+$ ]]
[[ "$RUN_ATTEMPT" =~ ^[0-9]+$ ]]
[[ "$WORKFLOW_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$RELEASE_TREE" =~ ^[a-f0-9]{40}$ ]]
[[ "$SOURCE_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$VERIFY_SHA256" =~ ^[a-f0-9]{64}$ ]]
test "$OFFLINE_BASE_REF" = node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
test "$JOB_DIR" = "/tmp/school-curriculum-deploy-jobs/${RELEASE_SHA}-${RUN_ID}-${RUN_ATTEMPT}"
test "$SOURCE_ARCHIVE" = "$JOB_DIR/school-release.tar.gz"
test "$VERIFY_SCRIPT" = "$JOB_DIR/verify-school-release.mjs"
test "$SCHOOL_ORIGIN" = https://school-188-225-38-55.sslip.io
test "$ARTHELLO_ORIGIN" = https://arthello-188-225-38-55.sslip.io
[[ "$SCHOOL_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]

lock_path=/var/lock/school-1-11-production.lock
exec 9>>"$lock_path"
flock -n 9 || {
  printf 'SCHOOL_STANDALONE_LOCK=BUSY\n' >&2
  exit 75
}

cancel_record="cancel:${RELEASE_SHA}:${RUN_ID}:${RUN_ATTEMPT}"
set +e
grep -Fx "$cancel_record" "$lock_path" >/dev/null 2>&1
cancel_record_rc=$?
set -e
case "$cancel_record_rc" in
  0)
    printf 'SCHOOL_STANDALONE_CANCEL=FENCED\n' >&2
    exit 143
    ;;
  1) ;;
  *)
    printf 'SCHOOL_STANDALONE_CANCEL_FENCE=UNREADABLE\n' >&2
    exit 75
    ;;
esac
if [ -e "$JOB_DIR/cancel-request" ]; then
  printf 'SCHOOL_STANDALONE_CANCEL=REQUESTED\n' >&2
  exit 143
fi

production="$SCHOOL_CONTAINER"
run_key="${RUN_ID}-${RUN_ATTEMPT}"
rollback="school-1-11-curriculum-rollback-$run_key"
preflight="school-1-11-curriculum-preflight-$run_key"
preflight_data="school-1-11_curriculum_preflight_${run_key}_data"
preflight_backups="school-1-11_curriculum_preflight_${run_key}_backups"
rollback_volume="school-1-11_curriculum_rollback_$run_key"
release_dir="$JOB_DIR/release"
work="$JOB_DIR/work"
env_file="$work/production.env"
label_file="$work/production.labels"
gate_path=/data/.school-deploy-read-only
image_ref="school-1-11-curriculum:${RELEASE_SHA:0:12}"

success=0
preflight_created=0
preflight_data_created=0
preflight_backups_created=0
restart_suppressed=0
rollback_named=0
candidate_created=0
rollback_snapshot_ready=0
rollback_allowed=1
gate_held=0
postcommit=0
recovery_failed=0
pending_signal=0

old_container_id=
old_image_id=
old_started_at=
base_image_id=
image_id=
data_volume=
backup_volume=
network_mode=
restart_name=
restart_max=
restart_spec=
runtime_uid=
runtime_gid=
database_uid=
database_gid=
database_mode=
final_backup_file=
final_backup_sha=
final_backup_bytes=
port_binding=
log_driver=
declare -a network_aliases=()
declare -a log_options=()

wait_container_health() {
  local name=$1
  local public_origin=${2:-}
  local health=
  for attempt in $(seq 1 120); do
    test "$(docker inspect "$name" --format '{{.State.Running}}' 2>/dev/null || true)" = true || return 1
    health="$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true)"
    if [ "$health" = healthy ]; then
      if [ -z "$public_origin" ] || curl -fsS --max-time 10 "$public_origin/api/health" | grep -F '"status":"ok"' >/dev/null; then
        return 0
      fi
    fi
    test "$health" != unhealthy || return 1
    sleep 2
  done
  return 1
}

running_volume_consumers() {
  local volume=$1
  local count=0
  local id
  local uses
  local ids
  ids="$(docker ps -q)" || return 1
  while IFS= read -r id; do
    test -n "$id" || continue
    uses="$(docker inspect "$id" | VOLUME="$volume" python3 -c '
import json, os, sys
item=json.load(sys.stdin)[0]
print(1 if any(m.get("Type")=="volume" and m.get("Name")==os.environ["VOLUME"] for m in item.get("Mounts") or []) else 0)
')" || return 1
    case "$uses" in
      1)
      count=$((count + 1))
        ;;
      0) ;;
      *) return 1 ;;
    esac
  done <<<"$ids"
  printf '%s\n' "$count"
}

create_gate() {
  local volume=$1
  docker run --rm     --network none     --read-only     --user 0:0     --security-opt no-new-privileges:true     --volume "$volume:/data"     --entrypoint /bin/sh     "$image_id" -c '
      set -eu
      target=/data/.school-deploy-read-only
      tmp="${target}.tmp.$$"
      rm -f "$tmp"
      umask 022
      printf "deployment read-only\n" > "$tmp"
      chmod 0444 "$tmp"
      mv -f "$tmp" "$target"
      test -f "$target"
      sync
    ' || return 1
  gate_held=1
}

clear_gate() {
  local volume=$1
  docker run --rm     --network none     --read-only     --user 0:0     --security-opt no-new-privileges:true     --volume "$volume:/data"     --entrypoint /bin/sh     "$image_id" -c '
      set -eu
      rm -f /data/.school-deploy-read-only
      test ! -e /data/.school-deploy-read-only
      sync
    ' || return 1
  gate_held=0
}

verify_internal_gate() {
  local name=$1
  docker exec -i "$name" node --input-type=module - <<'NODE'
const base = 'http://127.0.0.1:3000';
const response = await fetch(base + '/api/school', {
  method: 'POST',
  headers: { origin: base, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'deployment.write-gate.probe' }),
});
const payload = await response.json();
if (
  response.status !== 503 ||
  payload.code !== 'deployment_read_only' ||
  response.headers.get('retry-after') !== '30' ||
  response.headers.get('cache-control') !== 'no-store'
) throw new Error('Internal maintenance gate failed');
const health = await fetch(base + '/api/health');
const healthPayload = await health.json();
if (!health.ok || healthPayload.status !== 'ok' || healthPayload.maintenance !== true)
  throw new Error('Maintenance-aware health failed');
const login = await fetch(base + '/login');
if (!login.ok) throw new Error('Read-only login page failed');
console.log('SCHOOL_INTERNAL_WRITE_GATE=PASS');
NODE
}

verify_public_gate() {
  local max_attempts=${1:-30}
  local request_timeout=${2:-20}
  local body="$work/public-gate.json"
  local headers="$work/public-gate.headers"
  local status=
  local verified=0
  for attempt in $(seq 1 "$max_attempts"); do
    : > "$body"
    : > "$headers"
    status="$(curl -sS --max-time "$request_timeout" -o "$body" -D "$headers" -w '%{http_code}'       -X POST "$SCHOOL_ORIGIN/api/school"       -H "Origin: $SCHOOL_ORIGIN"       -H 'Content-Type: application/json'       --data '{"action":"deployment.public-gate.probe"}' || true)"
    if [ "$status" = 503 ]       && grep -Eq '"code"[[:space:]]*:[[:space:]]*"deployment_read_only"' "$body"       && grep -Eiq '^Retry-After:[[:space:]]*30' "$headers"       && grep -Eiq '^Cache-Control:[[:space:]]*no-store' "$headers"; then
      verified=1
      break
    fi
    sleep 2
  done
  test "$verified" -eq 1 || return 1
  health="$(curl -fsS --max-time "$request_timeout" "$SCHOOL_ORIGIN/api/health")" || return 1
  grep -F '"status":"ok"' <<<"$health" >/dev/null || return 1
  grep -F '"maintenance":true' <<<"$health" >/dev/null || return 1
  printf 'SCHOOL_PUBLIC_WRITE_GATE=PASS\n'
  return 0
}

verify_public_released_short() {
  local health=
  for attempt in $(seq 1 3); do
    health="$(curl -fsS --max-time 10 "$SCHOOL_ORIGIN/api/health" 2>/dev/null || true)"
    if grep -F '"status":"ok"' <<<"$health" >/dev/null \
      && grep -F '"maintenance":false' <<<"$health" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

verify_application_contracts() {
  local name=$1
  local request_origin=$2
  docker exec -i --env ARTHELLO_ORIGIN="$ARTHELLO_ORIGIN" --env PROBE_ORIGIN="$request_origin" "$name" node --input-type=module - <<'NODE'
const base='http://127.0.0.1:3000';
const login=await fetch(base+'/login');
const html=await login.text();
if(!login.ok) throw new Error('Login page failed');
for(const marker of ['staff-sso-safe-rollout','Вход для сотрудников','Вход для семьи и ученика','Пароль, выданный школой'])
  if(!html.includes(marker)) throw new Error('Missing login marker: '+marker);
if(html.includes('Получить код')) throw new Error('Parent OTP is exposed');
const paths=[...html.matchAll(/\/_next\/static\/css\/[^"?]+\.css/g)].map(m=>m[0]);
if(!paths.length) throw new Error('No CSS assets');
let css='';
for(const path of new Set(paths)){
  const response=await fetch(base+path);
  if(!response.ok) throw new Error('CSS fetch failed: '+path);
  css+=await response.text();
}
for(const marker of ['.l0-stage{width:100%;height:100svh;overflow:hidden','student-dashboard-hero-v1.webp'])
  if(!css.includes(marker)) throw new Error('Missing CSS marker: '+marker);
const start=await fetch(base+'/auth/central/start',{redirect:'manual'});
if(start.status!==303) throw new Error('SSO start failed: '+start.status);
const location=new URL(start.headers.get('location')||'');
if(location.origin!==process.env.ARTHELLO_ORIGIN || location.pathname!=='/api/school-sso/authorize')
  throw new Error('Unexpected SSO authority');
if((location.searchParams.get('state')||'').length<40 || (location.searchParams.get('code_challenge')||'').length<40)
  throw new Error('SSO challenge missing');
if(!start.headers.get('set-cookie')?.includes('school_sso_tx='))
  throw new Error('SSO cookie missing');
const family=await fetch(base+'/api/auth/login',{
  method:'POST',
  headers:{origin:process.env.PROBE_ORIGIN,'content-type':'application/json'},
  body:JSON.stringify({login:'nobody@example.invalid',password:'InvalidPassword1'}),
});
if(family.status!==401) throw new Error('Family compatibility failed: '+family.status);
console.log('SCHOOL_APPLICATION_CONTRACTS=PASS');
NODE
}

protected_schedule_digest() {
  local name=$1
  docker exec -i "$name" node --input-type=module - <<'NODE'
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const db=new DatabaseSync('/data/school-1-11.sqlite',{readOnly:true});
const lessons=db.prepare(`
  SELECT id, class_name AS className, weekday,
    starts_at AS startsAt, ends_at AS endsAt, subject_id AS subjectId,
    teacher_user_id AS teacherUserId, display_label AS displayLabel,
    group_name AS groupName, shared_session_key AS sharedSessionKey,
    room, status, note, created_at AS createdAt, updated_at AS updatedAt
  FROM lessons
  WHERE class_name NOT IN ('1','2','3','4','5','6')
  ORDER BY id
`).all();
const sessions=db.prepare(`
  SELECT ps.id, ps.program_id AS programId, ps.topic_id AS topicId,
    ps.session_index AS sessionIndex, ps.scheduled_date AS scheduledDate,
    ps.template_lesson_id AS templateLessonId, ps.starts_at AS startsAt,
    ps.status, ps.topic_override AS topicOverride,
    ps.homework_override AS homeworkOverride,
    ps.created_at AS createdAt, ps.updated_at AS updatedAt
  FROM program_topic_sessions ps
  JOIN lessons l ON l.id = ps.template_lesson_id
  WHERE l.class_name NOT IN ('1','2','3','4','5','6')
  ORDER BY ps.id
`).all();
const protectedExceptions=db.prepare(`
  SELECT id, academic_year AS academicYear,
    source_class_name AS sourceClassName, student_label AS studentLabel,
    student_id AS studentId, subject_id AS subjectId,
    target_class_name AS targetClassName, instruction,
    source_sheet AS sourceSheet, source_cell AS sourceCell, status,
    created_at AS createdAt, updated_at AS updatedAt
  FROM schedule_exceptions
  WHERE source_class_name NOT IN ('1','2','3','4','5','6')
  ORDER BY id
`).all();
const matchedManagedExceptions=db.prepare(`
  SELECT id, student_id AS studentId, status
  FROM schedule_exceptions
  WHERE source_class_name IN ('1','2','3','4','5','6')
    AND student_id IS NOT NULL
  ORDER BY id
`).all();
db.close();
const sha=createHash('sha256')
  .update(JSON.stringify({
    lessons,
    sessions,
    protectedExceptions,
    matchedManagedExceptions,
  }))
  .digest('hex');
console.log(`${lessons.length}:${sessions.length}:${protectedExceptions.length}:${matchedManagedExceptions.length}:${sha}`);
NODE
}

verify_public_release_contracts() {
  local healthy=0
  local health=
  local login_html="$work/public-release-login.html"
  local css_file="$work/public-release.css"
  local sso_headers="$work/public-release-sso.headers"
  local family_body="$work/public-release-family.json"
  local css_count=0
  local css_path=
  local sso_location=
  local family_status=
  for attempt in $(seq 1 60); do
    health="$(curl --fail --silent --show-error --max-time 30 "$SCHOOL_ORIGIN/api/health" || true)"
    if grep -F '"status":"ok"' <<<"$health" >/dev/null \
      && grep -F '"maintenance":false' <<<"$health" >/dev/null; then
      healthy=1
      break
    fi
    sleep 3
  done
  test "$healthy" -eq 1 || return 1
  curl --fail --silent --show-error --max-time 60 \
    -H 'Cache-Control: no-cache' \
    "$SCHOOL_ORIGIN/login?release=$RELEASE_SHA" > "$login_html" || return 1
  : > "$css_file"
  while IFS= read -r css_path; do
    test -n "$css_path" || continue
    curl --fail --silent --show-error --max-time 60 \
      "$SCHOOL_ORIGIN$css_path" >> "$css_file" || return 1
    printf '\n' >> "$css_file"
    css_count=$((css_count + 1))
  done < <(grep -oE '/_next/static/css/[^"?]+\.css' "$login_html" | sort -u)
  test "$css_count" -gt 0 || return 1
  grep -F '.l0-stage{width:100%;height:100svh;overflow:hidden' "$css_file" >/dev/null || return 1
  grep -F 'student-dashboard-hero-v1.webp' "$css_file" >/dev/null || return 1
  curl --silent --show-error --max-time 30 \
    --dump-header "$sso_headers" --output /dev/null \
    "$SCHOOL_ORIGIN/auth/central/start" || return 1
  test "$(awk 'NR==1 {print $2}' "$sso_headers")" = 303 || return 1
  sso_location="$(tr -d '\r' < "$sso_headers" | sed -n 's/^location: //Ip' | tail -n1)"
  python3 - "$sso_location" "$ARTHELLO_ORIGIN" <<'PY' || return 1
import sys
from urllib.parse import parse_qs, urlparse
location=urlparse(sys.argv[1])
authority=urlparse(sys.argv[2])
assert location.scheme == authority.scheme
assert location.netloc == authority.netloc
assert location.path == '/api/school-sso/authorize'
query=parse_qs(location.query)
assert len(query.get('state',[''])[0]) >= 40
assert len(query.get('code_challenge',[''])[0]) >= 40
PY
  grep -Eiq '^set-cookie:[[:space:]]*school_sso_tx=' "$sso_headers" || return 1
  family_status="$(curl --silent --show-error --max-time 30 \
    --output "$family_body" --write-out '%{http_code}' \
    --request POST "$SCHOOL_ORIGIN/api/auth/login" \
    --header "Origin: $SCHOOL_ORIGIN" \
    --header 'Content-Type: application/json' \
    --data '{"login":"nobody@example.invalid","password":"InvalidPassword1"}')" || return 1
  test "$family_status" = 401 || return 1
  printf 'SCHOOL_PUBLIC_HTTPS=OK\n'
  printf 'SCHOOL_FULLSCREEN_CSS=VERIFIED\n'
  printf 'SCHOOL_PUBLIC_SSO=VERIFIED\n'
  printf 'SCHOOL_PUBLIC_FAMILY_LOGIN=VERIFIED\n'
  printf 'SCHOOL_MAINTENANCE=RELEASED\n'
}

run_imports() {
  local name=$1
  local output
  output="$(docker exec "$name" node scripts/import-school-schedule.mjs     data/schedules/school-1-11-2026-2027.json 2>&1)"
  printf '%s\n' "$output"
  grep -Eq '^SCHOOL_SCHEDULE_IMPORT=(SUCCESS|ALREADY_APPLIED)$' <<<"$output"
  output="$(docker exec "$name" node scripts/import-school-curriculum.mjs     data/curricula/school-1-11-2-math-2026-2027.json 2>&1)"
  printf '%s\n' "$output"
  grep -Eq '^SCHOOL_CALENDAR_IMPORT=(SUCCESS|ALREADY_APPLIED)$' <<<"$output"
  grep -Eq '^SCHOOL_CURRICULUM_IMPORT=(SUCCESS|ALREADY_APPLIED)$' <<<"$output"
}

verify_release_data() {
  local name=$1
  docker exec -i "$name" node --input-type=module - < "$VERIFY_SCRIPT"
}

verify_backup() {
  local volume=$1
  local file=$2
  docker run --rm     --network none     --read-only     --user 0:0     --security-opt no-new-privileges:true     --tmpfs /tmp:rw,noexec,nosuid,size=16m     --volume "$volume:/verify:ro"     --env BACKUP_PATH="/verify/$file"     --entrypoint node     "$image_id" --input-type=module - <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const path=process.env.BACKUP_PATH;
const stat=statSync(path);
if(!stat.isFile() || stat.size<4096) throw new Error('Backup is empty');
const db=new DatabaseSync(path,{readOnly:true});
const integrity=db.prepare('PRAGMA integrity_check').all();
const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
db.close();
if(integrity.length!==1 || integrity[0].integrity_check!=='ok')
  throw new Error('Backup integrity failed');
if(foreignKeys.length!==0) throw new Error('Backup foreign keys failed');
console.log(`${stat.size}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
NODE
}

verify_data_volume() {
  docker run --rm     --network none     --read-only     --user 0:0     --security-opt no-new-privileges:true     --tmpfs /tmp:rw,noexec,nosuid,size=16m     --volume "$data_volume:/data:ro"     --entrypoint node     "$image_id" --input-type=module - <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const db=new DatabaseSync('/data/school-1-11.sqlite',{readOnly:true});
const integrity=db.prepare('PRAGMA integrity_check').all();
const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
db.close();
if(integrity.length!==1 || integrity[0].integrity_check!=='ok') process.exit(1);
if(foreignKeys.length!==0) process.exit(1);
console.log('SCHOOL_DATA_VOLUME_INTEGRITY=PASS');
NODE
}

connect_original_network() {
  local name=$1
  if [ "$(docker inspect "$name" --format "{{if index .NetworkSettings.Networks \"$network_mode\"}}attached{{end}}" 2>/dev/null)" = attached ]; then
    return 0
  fi
  local args=(docker network connect)
  local alias
  for alias in "${network_aliases[@]}"; do
    args+=(--alias "$alias")
  done
  args+=("$network_mode" "$name")
  "${args[@]}"
}

restore_restart_policy() {
  local name=$1
  docker update --restart "$restart_spec" "$name" >/dev/null || return 1
  test "$(docker inspect "$name" --format '{{.HostConfig.RestartPolicy.Name}}')" = "$restart_name" || return 1
  test "$(docker inspect "$name" --format '{{.HostConfig.RestartPolicy.MaximumRetryCount}}')" = "$restart_max" || return 1
}

record_precommit_recovery() {
  docker run --rm \
    --network none \
    --read-only \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --volume "$rollback_volume:/rollback" \
    --env RUN_ID="$RUN_ID" \
    --env RUN_ATTEMPT="$RUN_ATTEMPT" \
    --env RELEASE_SHA="$RELEASE_SHA" \
    --env RESTART_NAME="$restart_name" \
    --env RESTART_MAX="$restart_max" \
    --entrypoint /bin/sh "$image_id" -c '
      set -eu
      {
        printf "phase=PRECOMMIT_RECOVERED\n"
        printf "run_id=%s\n" "$RUN_ID"
        printf "run_attempt=%s\n" "$RUN_ATTEMPT"
        printf "release_sha=%s\n" "$RELEASE_SHA"
        printf "restart_name=%s\n" "$RESTART_NAME"
        printf "restart_max=%s\n" "$RESTART_MAX"
      } > /rollback/state.tmp
      chmod 0400 /rollback/state.tmp
      mv -f /rollback/state.tmp /rollback/state
      sync
    ' || return 1
}

restore_database_snapshot() {
  test "$rollback_snapshot_ready" -eq 1 || return 1
  local proof
  proof="$(verify_backup "$rollback_volume" "$final_backup_file")" || return 1
  test "$proof" = "$final_backup_bytes:$final_backup_sha" || return 1
  docker run --rm     --network none     --read-only     --user 0:0     --security-opt no-new-privileges:true     --volume "$data_volume:/data"     --volume "$rollback_volume:/rollback:ro"     --env SOURCE="/rollback/$final_backup_file"     --env TARGET=/data/school-1-11.sqlite     --env TARGET_UID="$database_uid"     --env TARGET_GID="$database_gid"     --env TARGET_MODE="$database_mode"     --env EXPECTED_SHA="$final_backup_sha"     --entrypoint /bin/sh     "$image_id" -c '
      set -eu
      test -s "$SOURCE"
      test "$(sha256sum "$SOURCE" | cut -d " " -f 1)" = "$EXPECTED_SHA"
      tmp="${TARGET}.restore.$$"
      rm -f "$tmp" "${TARGET}-wal" "${TARGET}-shm" "${TARGET}-journal"
      cp "$SOURCE" "$tmp"
      chown "$TARGET_UID:$TARGET_GID" "$tmp"
      chmod "$TARGET_MODE" "$tmp"
      mv -f "$tmp" "$TARGET"
      sync
    ' || return 1
  verify_data_volume || return 1
}

recover_precommit() {
  set +e
  printf 'SCHOOL_STANDALONE_ROLLBACK=STARTED\n' >&2
  if [ "$rollback_named" -eq 0 ] && docker inspect "$rollback" >/dev/null 2>&1; then
    rollback_named=1
  fi
  if [ "$candidate_created" -eq 0 ] &&
    [ "$rollback_named" -eq 1 ] &&
    docker inspect "$production" >/dev/null 2>&1 &&
    [ "$(docker inspect "$production" --format '{{.Image}}' 2>/dev/null)" = "$image_id" ]; then
    candidate_created=1
  fi
  if [ "$candidate_created" -eq 0 ] &&
    [ "$rollback_named" -eq 0 ] &&
    docker inspect "$production" >/dev/null 2>&1; then
    if ! docker update --restart no "$production" >/dev/null 2>&1 ||
      [ "$(docker inspect "$production" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null)" != no ]; then
      printf 'SCHOOL_STANDALONE_ROLLBACK=ORIGINAL_RESTART_SUPPRESSION_FAILED\n' >&2
      recovery_failed=1
      return 1
    fi

    timeout --signal=TERM --kill-after=5s 60s \
      docker stop --time 45 "$production" >/dev/null 2>&1 || true
    for attempt in $(seq 1 60); do
      [ "$(docker inspect "$production" --format '{{.State.Running}}' 2>/dev/null)" = false ] && break
      sleep 1
    done
    if [ "$(docker inspect "$production" --format '{{.State.Running}}' 2>/dev/null)" != false ]; then
      timeout --signal=TERM --kill-after=5s 30s \
        docker kill "$production" >/dev/null 2>&1 || true
      for attempt in $(seq 1 30); do
        [ "$(docker inspect "$production" --format '{{.State.Running}}' 2>/dev/null)" = false ] && break
        sleep 1
      done
    fi
    if [ "$(docker inspect "$production" --format '{{.State.Running}}' 2>/dev/null)" != false ]; then
      printf 'SCHOOL_STANDALONE_ROLLBACK=ORIGINAL_STOP_CONVERGENCE_FAILED\n' >&2
      recovery_failed=1
      return 1
    fi
    if [ "$(running_volume_consumers "$data_volume")" != 0 ]; then
      printf 'SCHOOL_STANDALONE_ROLLBACK=ORIGINAL_DATA_VOLUME_BUSY\n' >&2
      recovery_failed=1
      return 1
    fi

    clear_gate "$data_volume" || {
      recovery_failed=1
      return 1
    }
    docker start "$production" >/dev/null || {
      recovery_failed=1
      return 1
    }
    wait_container_health "$production" || {
      recovery_failed=1
      return 1
    }
    verify_public_released_short || {
      recovery_failed=1
      return 1
    }
    record_precommit_recovery || {
      recovery_failed=1
      return 1
    }
    restore_restart_policy "$production" || {
      recovery_failed=1
      return 1
    }
    restart_suppressed=0
    printf 'SCHOOL_STANDALONE_ROLLBACK=ORIGINAL_RESTARTED\n' >&2
    return 0
  fi
  if [ "$candidate_created" -eq 1 ] && docker inspect "$production" >/dev/null 2>&1; then
    if ! docker update --restart no "$production" >/dev/null 2>&1 ||
      [ "$(docker inspect "$production" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null)" != no ]; then
      printf 'SCHOOL_STANDALONE_ROLLBACK=CANDIDATE_RESTART_SUPPRESSION_FAILED_DB_UNTOUCHED\n' >&2
      recovery_failed=1
      return 1
    fi
    if [ "$(docker inspect "$production" --format '{{.State.Running}}' 2>/dev/null)" = true; then
      docker stop --time 45 "$production" >/dev/null 2>&1 || true
    fi
    if [ "$(docker inspect "$production" --format '{{.State.Running}}' 2>/dev/null)" != false ]; then
      printf 'SCHOOL_STANDALONE_ROLLBACK=CANDIDATE_STOP_FAILED_DB_UNTOUCHED\n' >&2
      recovery_failed=1
      return 1
    fi
    docker rm "$production" >/dev/null || {
      recovery_failed=1
      return 1
    }
    candidate_created=0
  fi

  if [ -n "$data_volume" ] && [ "$(running_volume_consumers "$data_volume")" != 0 ]; then
    printf 'SCHOOL_STANDALONE_ROLLBACK=DATA_VOLUME_BUSY_DB_UNTOUCHED\n' >&2
    recovery_failed=1
    return 1
  fi

  if [ "$rollback_snapshot_ready" -eq 1 ]; then
    restore_database_snapshot || {
      recovery_failed=1
      return 1
    }
    printf 'SCHOOL_STANDALONE_ROLLBACK_DATABASE=RESTORED\n' >&2
  fi

  if [ -n "$data_volume" ]; then
    clear_gate "$data_volume" || {
      recovery_failed=1
      return 1
    }
  fi

  if [ "$rollback_named" -eq 1 ]; then
    docker rename "$rollback" "$production" >/dev/null || {
      recovery_failed=1
      return 1
    }
    rollback_named=0
    connect_original_network "$production" >/dev/null || {
      recovery_failed=1
      return 1
    }
  fi

  if docker inspect "$production" >/dev/null 2>&1; then
    if [ "$(docker inspect "$production" --format '{{.State.Running}}')" != true ]; then
      docker start "$production" >/dev/null || {
        recovery_failed=1
        return 1
      }
    fi
    wait_container_health "$production" || {
      recovery_failed=1
      return 1
    }
    verify_public_released_short || {
      recovery_failed=1
      return 1
    }
    record_precommit_recovery || {
      recovery_failed=1
      return 1
    }
    restore_restart_policy "$production" || {
      recovery_failed=1
      return 1
    }
    restart_suppressed=0
  else
    recovery_failed=1
    return 1
  fi
  printf 'SCHOOL_STANDALONE_ROLLBACK=PASS\n' >&2
}

recover_postcommit() {
  set +e
  printf 'SCHOOL_STANDALONE_ROLL_FORWARD=REQUIRED\n' >&2
  local restart_disabled=0
  local gate_verified=0
  if docker inspect "$production" >/dev/null 2>&1 &&
    docker update --restart no "$production" >/dev/null 2>&1 &&
    [ "$(docker inspect "$production" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null)" = no ]; then
    restart_disabled=1
  fi
  if [ -n "$data_volume" ] &&
    docker inspect "$production" >/dev/null 2>&1 &&
    create_gate "$data_volume" >/dev/null 2>&1 &&
    docker exec "$production" test -f "$gate_path" &&
    verify_internal_gate "$production" >/dev/null 2>&1 &&
    verify_public_gate 5 10 >/dev/null 2>&1; then
    gate_verified=1
  fi
  if [ "$restart_disabled" -eq 1 ] && [ "$gate_verified" -eq 1 ]; then
    printf 'SCHOOL_STANDALONE_ROLL_FORWARD_GATE=PASS\n' >&2
  else
    printf 'SCHOOL_STANDALONE_ROLL_FORWARD_GATE=FAILED_MANUAL_RECOVERY_REQUIRED\n' >&2
  fi
}

cleanup() {
  local rc=$?
  trap - EXIT
  trap '' HUP INT TERM
  set +e
  if docker inspect "$preflight" >/dev/null 2>&1; then
    docker stop --time 30 "$preflight" >/dev/null 2>&1 || true
    docker rm "$preflight" >/dev/null 2>&1 || true
  fi
  if docker volume inspect "$preflight_data" >/dev/null 2>&1; then
    docker volume rm "$preflight_data" >/dev/null 2>&1 || true
  fi
  if docker volume inspect "$preflight_backups" >/dev/null 2>&1; then
    docker volume rm "$preflight_backups" >/dev/null 2>&1 || true
  fi
  rm -f -- "$env_file" "$label_file"
  if [ "$success" -ne 1 ]; then
    if [ "$rollback_allowed" -eq 1 ] && { [ "$restart_suppressed" -eq 1 ] || [ "$rollback_named" -eq 1 ] || [ "$candidate_created" -eq 1 ]; }; then
      if recover_precommit; then
        printf 'SCHOOL_STANDALONE_PRECOMMIT_RECOVERY=PROVEN\n' >&2
      fi
    elif [ "$postcommit" -eq 1 ]; then
      recover_postcommit
    fi
    printf 'SCHOOL_STANDALONE_CUTOVER=FAIL\n' >&2
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

install -d -m 0700 "$work"
test -f "$SOURCE_ARCHIVE"
test -f "$VERIFY_SCRIPT"
printf '%s  %s\n' "$SOURCE_SHA256" "$SOURCE_ARCHIVE" | sha256sum -c -
printf '%s  %s\n' "$VERIFY_SHA256" "$VERIFY_SCRIPT" | sha256sum -c -
test ! -e "$release_dir"
install -d -m 0750 "$release_dir"
tar -xzf "$SOURCE_ARCHIVE" -C "$release_dir"
test "$(cat "$release_dir/.school-source-sha")" = "$RELEASE_SHA"
test "$(cat "$release_dir/.school-source-tree")" = "$RELEASE_TREE"
test -f "$release_dir/deploy/Dockerfile.offline"
test "$(sha256sum "$release_dir/scripts/import-school-schedule.mjs" | cut -d ' ' -f 1)" = 5fb94f8550c24ceb6a642ea0ad5b0d107b1b52fc3f25df11c3ad1cdad1b8c5fc
test "$(sha256sum "$release_dir/deploy/Dockerfile.offline" | cut -d ' ' -f 1)" = 0a71ac38c94bbf66094ced04028da32397433cb19663c9dfb935a117933121a4

pinned_dockerfile="$release_dir/deploy/Dockerfile.offline.pinned"
test ! -e "$pinned_dockerfile"
python3 - "$release_dir/deploy/Dockerfile.offline" "$pinned_dockerfile" "$OFFLINE_BASE_REF" <<'PY'
import os
import sys

source, target, base_ref = sys.argv[1:]
data = open(source, "rb").read()
old = b"FROM arthello-os-api:local\n"
if not data.startswith(old) or data.count(old) != 1:
    raise SystemExit("unexpected offline Dockerfile base")
replacement = b"FROM " + base_ref.encode("ascii") + b"\n"
output = replacement + data[len(old):]
descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
with os.fdopen(descriptor, "wb") as stream:
    stream.write(output)
    stream.flush()
    os.fsync(stream.fileno())
PY
test "$(sha256sum "$pinned_dockerfile" | cut -d ' ' -f 1)" = 7b1bdbe53b8c40c43b76d0ffd7399bb9c1f52797c83b74679acef15e0bb5b817
test "$(head -n 1 "$pinned_dockerfile")" = "FROM $OFFLINE_BASE_REF"

for spec in   'offline-runtime-v3.part-*:66:9125b43319706f4bf3a9a45813b50a0495e61bef5b73f3305a1b97717406b349'   'offline-runtime-v4-delta.part-*:2:a4ef97eb6795cb81c860ab62b0ae7510e693b1fec1e5f6129aea072ce2ca2c9f'   'offline-runtime-v5-delta.part-*:6:b451004c5d1584546233ba39d6ea37c0701a1653c1fd8f7b5ba2d21bd6b201d2'; do
  IFS=: read -r pattern expected_count expected_sha <<<"$spec"
  test "$(find "$release_dir/deploy" -maxdepth 1 -type f -name "$pattern" | wc -l)" -eq "$expected_count"
  test "$(cat "$release_dir"/deploy/$pattern | sha256sum | cut -d ' ' -f 1)" = "$expected_sha"
done
printf 'SCHOOL_STANDALONE_SOURCE=VERIFIED\n'

if ! docker image inspect "$OFFLINE_BASE_REF" >/dev/null 2>&1; then
  timeout --signal=TERM --kill-after=30s 600s docker pull "$OFFLINE_BASE_REF" >/dev/null
fi
docker image inspect "$OFFLINE_BASE_REF" >/dev/null
docker image inspect "$OFFLINE_BASE_REF" | python3 -c '
import json, sys
item=json.load(sys.stdin)[0]
if item.get("Os") != "linux" or item.get("Architecture") != "amd64":
    raise SystemExit("unexpected offline base platform")
if (item.get("Config") or {}).get("OnBuild") not in (None, []):
    raise SystemExit("offline base has ONBUILD triggers")
layers=(item.get("RootFS") or {}).get("Layers") or []
if not layers:
    raise SystemExit("offline base has no rootfs layers")
'
base_node_version="$(docker run --rm --network none --entrypoint node "$OFFLINE_BASE_REF" --version)"
[[ "$base_node_version" =~ ^v24\. ]]
docker_root="$(docker info --format '{{.DockerRootDir}}')"
for capacity_path in "$JOB_DIR" "$(dirname "$docker_root")"; do
  available_kib="$(df -Pk "$capacity_path" | awk 'NR==2 {print $4}')"
  [[ "$available_kib" =~ ^[0-9]+$ ]]
  test "$available_kib" -ge 2097152
done
printf 'SCHOOL_STANDALONE_CAPACITY=VERIFIED\n'
base_image_id="$(docker image inspect "$OFFLINE_BASE_REF" --format '{{.Id}}')"
[[ "$base_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
docker build   --network none   --pull=false   --no-cache   --file "$pinned_dockerfile"   --label org.opencontainers.image.revision="$RELEASE_SHA"   --label org.opencontainers.image.source=https://github.com/vitaliyozolin-dotcom/ArtHello-OS   --label school.offline-base-ref="$OFFLINE_BASE_REF"   --label school.offline-base-image-id="$base_image_id"   --tag "$image_ref"   "$release_dir"
test "$(docker image inspect "$OFFLINE_BASE_REF" --format '{{.Id}}')" = "$base_image_id"
image_id="$(docker image inspect "$image_ref" --format '{{.Id}}')"
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
test "$(docker image inspect "$image_id" --format '{{index .Config.Labels "school.offline-base-ref"}}')" = "$OFFLINE_BASE_REF"
test "$(docker image inspect "$image_id" --format '{{index .Config.Labels "school.offline-base-image-id"}}')" = "$base_image_id"
docker image inspect "$OFFLINE_BASE_REF" "$image_id" | python3 -c '
import json, sys
base, candidate=json.load(sys.stdin)
base_layers=(base.get("RootFS") or {}).get("Layers") or []
candidate_layers=(candidate.get("RootFS") or {}).get("Layers") or []
if not base_layers or candidate_layers[:len(base_layers)] != base_layers:
    raise SystemExit("candidate does not inherit the accepted offline base")
'
printf 'SCHOOL_STANDALONE_OFFLINE_BASE=VERIFIED\n'
docker run --rm -i --network none --entrypoint node "$image_id" --check --input-type=module - < "$VERIFY_SCRIPT"

image_hashes="$(docker run --rm --network none --entrypoint sha256sum "$image_id"   /school/scripts/import-school-schedule.mjs   /school/scripts/import-school-curriculum.mjs   /school/lib/curriculum-allocation.mjs   /school/lib/maintenance-gate.mjs   /school/.next/server/middleware.js   /school/data/schedules/school-1-11-2026-2027.json   /school/data/curricula/school-1-11-2-math-2026-2027.json)"
grep -F '5fb94f8550c24ceb6a642ea0ad5b0d107b1b52fc3f25df11c3ad1cdad1b8c5fc  /school/scripts/import-school-schedule.mjs' <<<"$image_hashes" >/dev/null
grep -F 'dfb4cd2a7c58b4b70ec9257796d9f4308f7318daba1cde1073e0d05374383718  /school/scripts/import-school-curriculum.mjs' <<<"$image_hashes" >/dev/null
grep -F '695c437db8e6bc748983cd09cd17ea09f14c04773ff5b1d857210c13e90ef297  /school/lib/curriculum-allocation.mjs' <<<"$image_hashes" >/dev/null
grep -F '9b04bfeae74718311569fb19b2b843d0cf5fa503ffe83027e065c60d6ba7fd64  /school/lib/maintenance-gate.mjs' <<<"$image_hashes" >/dev/null
grep -F '575dc7f205b79be165f9256a8674f5925ec00afeeee329efcbe71c599f39823f  /school/.next/server/middleware.js' <<<"$image_hashes" >/dev/null
grep -F '550c630c4b182bc9b8f9e85424b3624329843af6870fe64d27f4919e176c8087  /school/data/schedules/school-1-11-2026-2027.json' <<<"$image_hashes" >/dev/null
grep -F 'ff8512dc599d69e8b41f29d7a18b9d37fbef38d6d2306f9ca347d4f56d70f15e  /school/data/curricula/school-1-11-2-math-2026-2027.json' <<<"$image_hashes" >/dev/null
printf 'SCHOOL_STANDALONE_IMAGE=VERIFIED id=%s\n' "$image_id"

test -z "$(docker ps -aq --filter "name=^/$rollback$")"
test -z "$(docker ps -aq --filter "name=^/$preflight$")"
! docker volume inspect "$preflight_data" >/dev/null 2>&1
! docker volume inspect "$preflight_backups" >/dev/null 2>&1
! docker volume inspect "$rollback_volume" >/dev/null 2>&1

test "$(docker inspect "$production" --format '{{.State.Running}}')" = true
test "$(docker inspect "$production" --format '{{.State.Health.Status}}')" = healthy
docker exec "$production" test ! -e "$gate_path"
curl -fsS --max-time 30 "$SCHOOL_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null
curl -fsS --max-time 30 "$ARTHELLO_ORIGIN/api/health" | grep -F '"status":"ok"' >/dev/null

docker inspect "$production" | python3 -c '
import json, sys
item=json.load(sys.stdin)[0]
host=item.get("HostConfig") or {}
config=item.get("Config") or {}
mounts=item.get("Mounts") or []
networks=((item.get("NetworkSettings") or {}).get("Networks") or {})
if host.get("Privileged"): raise SystemExit("privileged production")
if host.get("ReadonlyRootfs"): raise SystemExit("unexpected read-only root")
if host.get("CapAdd") or host.get("CapDrop"): raise SystemExit("unexpected capabilities")
if host.get("SecurityOpt") not in (None, [], ["no-new-privileges:true"]):
    raise SystemExit("unsupported SecurityOpt")
if host.get("PidMode") not in (None, ""): raise SystemExit("unsupported PidMode")
if host.get("UTSMode") not in (None, ""): raise SystemExit("unsupported UTSMode")
if host.get("IpcMode") not in (None, "", "private"): raise SystemExit("unsupported IpcMode")
if host.get("Memory") not in (None, 0) or host.get("NanoCpus") not in (None, 0):
    raise SystemExit("unsupported resource limit")
if host.get("PidsLimit") not in (None, 0): raise SystemExit("unsupported pids limit")
if host.get("AutoRemove") or host.get("PublishAllPorts"): raise SystemExit("unsupported host mode")
for key in ("ExtraHosts","GroupAdd","DeviceCgroupRules","DeviceRequests","Ulimits","Sysctls"):
    if host.get(key) not in (None, [], {}): raise SystemExit("unsupported "+key)
if host.get("Devices") not in (None, []): raise SystemExit("unsupported devices")
if host.get("Dns") not in (None, []) or host.get("DnsOptions") not in (None, []) or host.get("DnsSearch") not in (None, []):
    raise SystemExit("unsupported DNS override")
if host.get("OomKillDisable") not in (None, False) or host.get("Init") not in (None, False):
    raise SystemExit("unsupported lifecycle option")
if host.get("UsernsMode") not in (None, "") or host.get("CgroupnsMode") not in (None, "", "private"):
    raise SystemExit("unsupported namespace option")
if host.get("ShmSize") not in (None, 67108864):
    raise SystemExit("unsupported shared memory size")
if len(networks)!=1: raise SystemExit("expected one production network")
expected={("/data","volume"),("/backups","volume")}
actual={(m.get("Destination"),m.get("Type")) for m in mounts}
if actual!=expected: raise SystemExit("unsupported mounts")
if any(m.get("RW") is not True or m.get("Propagation") not in (None, "") for m in mounts):
    raise SystemExit("unsupported mount mode")
binds=host.get("Binds") or []
if binds:
    expected_binds={(m.get("Name"),m.get("Destination")) for m in mounts}
    actual_binds=set()
    for bind in binds:
        parts=str(bind).split(":")
        if len(parts) not in (2,3): raise SystemExit("unsupported bind syntax")
        source,destination=parts[:2]
        mode=parts[2] if len(parts)==3 else ""
        if mode not in ("","rw"): raise SystemExit("unsupported bind mode")
        actual_binds.add((source,destination))
    if actual_binds!=expected_binds: raise SystemExit("binds do not match named volumes")
if any((value or {}).get("DriverOpts") not in (None,{}) for value in networks.values()):
    raise SystemExit("unsupported network driver options")
print("SCHOOL_STANDALONE_TOPOLOGY=SUPPORTED")
'

old_container_id="$(docker inspect "$production" --format '{{.Id}}')"
old_image_id="$(docker inspect "$production" --format '{{.Image}}')"
old_started_at="$(docker inspect "$production" --format '{{.State.StartedAt}}')"
restart_name="$(docker inspect "$production" --format '{{.HostConfig.RestartPolicy.Name}}')"
restart_max="$(docker inspect "$production" --format '{{.HostConfig.RestartPolicy.MaximumRetryCount}}')"
network_mode="$(docker inspect "$production" --format '{{.HostConfig.NetworkMode}}')"
log_driver="$(docker inspect "$production" --format '{{.HostConfig.LogConfig.Type}}')"
runtime_uid="$(docker exec "$production" id -u)"
runtime_gid="$(docker exec "$production" id -g)"
case "$restart_name" in
  always|unless-stopped) restart_spec="$restart_name" ;;
  on-failure) restart_spec="on-failure:$restart_max" ;;
  *) printf 'Unsupported restart policy\n' >&2; exit 1 ;;
esac
[[ "$network_mode" =~ ^[A-Za-z0-9_.-]+$ ]]
test "$(docker network inspect "$network_mode" --format '{{.Driver}}')" = bridge
case "$log_driver" in json-file|local) ;; *) printf 'Unsupported log driver\n' >&2; exit 1 ;; esac
[[ "$runtime_uid" =~ ^[0-9]+$ ]]
[[ "$runtime_gid" =~ ^[0-9]+$ ]]

readarray -t mount_data < <(docker inspect "$production" | python3 -c '
import json, sys
item=json.load(sys.stdin)[0]
for destination in ("/data","/backups"):
    rows=[m for m in item.get("Mounts") or [] if m.get("Destination")==destination]
    if len(rows)!=1 or rows[0].get("Type")!="volume" or not rows[0].get("Name"):
        raise SystemExit("invalid mount")
    print(rows[0]["Name"])
')
data_volume="${mount_data[0]}"
backup_volume="${mount_data[1]}"
[[ "$data_volume" =~ ^[A-Za-z0-9_.-]+$ ]]
[[ "$backup_volume" =~ ^[A-Za-z0-9_.-]+$ ]]

port_binding="$(docker inspect "$production" | python3 -c '
import json, sys
item=json.load(sys.stdin)[0]
rows=((item.get("HostConfig") or {}).get("PortBindings") or {}).get("3000/tcp") or []
if len(rows)!=1: raise SystemExit("invalid port binding")
print((rows[0].get("HostIp") or "")+":"+(rows[0].get("HostPort") or ""))
')"
test "$port_binding" = 127.0.0.1:3111

readarray -t network_aliases < <(docker inspect "$production" | NETWORK="$network_mode" python3 -c '
import json, os, re, sys
item=json.load(sys.stdin)[0]
network=((item.get("NetworkSettings") or {}).get("Networks") or {}).get(os.environ["NETWORK"]) or {}
seen=set()
for value in network.get("Aliases") or []:
    value=str(value or "").strip()
    if value and value not in seen and len(value)<=63 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*",value):
        seen.add(value); print(value)
')
test "${#network_aliases[@]}" -gt 0
readarray -t log_options < <(docker inspect "$production" | python3 -c '
import json, sys
opts=((json.load(sys.stdin)[0].get("HostConfig") or {}).get("LogConfig") or {}).get("Config") or {}
for key,value in sorted(opts.items()):
    if "\n" in key or "\n" in str(value): raise SystemExit("invalid log option")
    print(f"{key}={value}")
')

database_meta="$(docker exec "$production" stat -c '%u %g %a' /data/school-1-11.sqlite)"
read -r database_uid database_gid database_mode <<<"$database_meta"
[[ "$database_uid" =~ ^[0-9]+$ ]]
[[ "$database_gid" =~ ^[0-9]+$ ]]
[[ "$database_mode" =~ ^[0-7]{3,4}$ ]]
test "$(running_volume_consumers "$data_volume")" = 1

docker inspect "$production" | SCHOOL_ORIGIN="$SCHOOL_ORIGIN" ARTHELLO_ORIGIN="$ARTHELLO_ORIGIN" python3 -c '
import json, os, sys
item=json.load(sys.stdin)[0]
values={}
for entry in (item.get("Config") or {}).get("Env") or []:
    key,sep,value=str(entry).partition("=")
    if not sep or not key or "\n" in key or "\n" in value: raise SystemExit("invalid env")
    if key=="HOSTNAME": continue
    values[key]=value
values.update({
  "NODE_ENV":"production",
  "PORT":"3000",
  "DATABASE_PATH":"/data/school-1-11.sqlite",
  "PUBLIC_APP_ORIGIN":os.environ["SCHOOL_ORIGIN"],
  "ARTHELLO_PUBLIC_ORIGIN":os.environ["ARTHELLO_ORIGIN"],
  "ENABLE_LEGACY_PASSWORD_LOGIN":"true",
})
for key in sorted(values): print(key+"="+values[key])
' > "$env_file"
chmod 0600 "$env_file"

docker inspect "$production" | RELEASE_SHA="$RELEASE_SHA" IMAGE_ID="$image_id" BASE_REF="$OFFLINE_BASE_REF" BASE_IMAGE_ID="$base_image_id" RUN_ID="$RUN_ID" RUN_ATTEMPT="$RUN_ATTEMPT" WORKFLOW_SHA="$WORKFLOW_SHA" ROLLBACK="$rollback" python3 -c '
import json, os, sys
item=json.load(sys.stdin)[0]
labels=dict((item.get("Config") or {}).get("Labels") or {})
labels.update({
  "school.system":"school-1-11",
  "school.environment":"production",
  "school.curriculum-release":os.environ["RELEASE_SHA"],
  "school.curriculum-image-id":os.environ["IMAGE_ID"],
  "school.offline-base-ref":os.environ["BASE_REF"],
  "school.offline-base-image-id":os.environ["BASE_IMAGE_ID"],
  "school.curriculum-run":os.environ["RUN_ID"],
  "school.curriculum-run-attempt":os.environ["RUN_ATTEMPT"],
  "school.curriculum-workflow-sha":os.environ["WORKFLOW_SHA"],
  "school.curriculum-rollback-container":os.environ["ROLLBACK"],
})
for key,value in sorted(labels.items()):
    value="" if value is None else str(value)
    if "\n" in key or "\n" in value: raise SystemExit("invalid label")
    print(key+"="+value)
' > "$label_file"
chmod 0600 "$label_file"
printf 'SCHOOL_STANDALONE_BASELINE=VERIFIED\n'

docker run --rm --network none --user "$runtime_uid:$runtime_gid" --env EXPECTED_UID="$runtime_uid" --entrypoint node "$image_id" -e 'if(process.getuid()!==Number(process.env.EXPECTED_UID))process.exit(1)'

preview_path="$(docker exec "$production" node scripts/backup-db.mjs | tail -n1)"
case "$preview_path" in /backups/school-1-11-*.sqlite) ;; *) printf 'Unexpected preview backup path\n' >&2; exit 1 ;; esac
preview_file="${preview_path#/backups/}"
preview_proof="$(verify_backup "$backup_volume" "$preview_file")"
[[ "$preview_proof" =~ ^[0-9]+:[a-f0-9]{64}$ ]]
printf 'SCHOOL_STANDALONE_PREVIEW_BACKUP=VERIFIED\n'

docker volume create --label school.environment=preflight "$preflight_data" >/dev/null
preflight_data_created=1
docker volume create --label school.environment=preflight "$preflight_backups" >/dev/null
preflight_backups_created=1
docker run --rm --network none --user 0:0   --volume "$backup_volume:/source:ro"   --volume "$preflight_data:/data"   --env SOURCE="/source/$preview_file"   --env TARGET_UID="$runtime_uid"   --env TARGET_GID="$runtime_gid"   --env TARGET_MODE="$database_mode"   --entrypoint /bin/sh "$image_id" -c '
    set -eu
    cp "$SOURCE" /data/school-1-11.sqlite
    chown "$TARGET_UID:$TARGET_GID" /data /data/school-1-11.sqlite
    chmod 0750 /data
    chmod "$TARGET_MODE" /data/school-1-11.sqlite
  '
docker run --rm --network none --user 0:0   --volume "$preflight_backups:/backups"   --env TARGET_UID="$runtime_uid"   --env TARGET_GID="$runtime_gid"   --entrypoint /bin/sh "$image_id" -c '
    set -eu
    chown "$TARGET_UID:$TARGET_GID" /backups
    chmod 0750 /backups
  '

docker run -d   --name "$preflight"   --restart no   --network none   --user "$runtime_uid:$runtime_gid"   --security-opt no-new-privileges:true   --health-cmd "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""   --health-interval 5s   --health-timeout 4s   --health-retries 20   --health-start-period 10s   --env-file "$env_file"   --env PUBLIC_APP_ORIGIN=http://127.0.0.1:3000   --volume "$preflight_data:/data"   --volume "$preflight_backups:/backups"   "$image_id" >/dev/null
preflight_created=1
wait_container_health "$preflight"
preflight_protected_before="$(protected_schedule_digest "$preflight")"
[[ "$preflight_protected_before" =~ ^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[a-f0-9]{64}$ ]]
run_imports "$preflight"
verify_release_data "$preflight"
preflight_protected_after="$(protected_schedule_digest "$preflight")"
test "$preflight_protected_after" = "$preflight_protected_before"
printf 'SCHOOL_STANDALONE_PROTECTED_SCHEDULE_PREFLIGHT=PASS\n'
create_gate "$preflight_data"
verify_internal_gate "$preflight"
clear_gate "$preflight_data"
verify_application_contracts "$preflight" http://127.0.0.1:3000
docker stop --time 30 "$preflight" >/dev/null
docker rm "$preflight" >/dev/null
preflight_created=0
docker volume rm "$preflight_data" >/dev/null
preflight_data_created=0
docker volume rm "$preflight_backups" >/dev/null
preflight_backups_created=0
printf 'SCHOOL_STANDALONE_PREFLIGHT=PASS\n'

test "$(docker inspect "$production" --format '{{.Id}}')" = "$old_container_id"
test "$(docker inspect "$production" --format '{{.Image}}')" = "$old_image_id"
test "$(docker inspect "$production" --format '{{.State.StartedAt}}')" = "$old_started_at"
test "$(docker inspect "$production" --format '{{.State.Health.Status}}')" = healthy
test "$(running_volume_consumers "$data_volume")" = 1

docker volume create \
  --label school.system=school-1-11 \
  --label school.environment=rollback \
  --label school.release="$RELEASE_SHA" \
  --label school.run="$RUN_ID" \
  --label school.run-attempt="$RUN_ATTEMPT" \
  "$rollback_volume" >/dev/null
docker run --rm --network none --read-only --user 0:0 \
  --volume "$rollback_volume:/rollback" \
  --env RUN_ID="$RUN_ID" \
  --env RUN_ATTEMPT="$RUN_ATTEMPT" \
  --env RELEASE_SHA="$RELEASE_SHA" \
  --entrypoint /bin/sh "$image_id" -c '
    set -eu
    {
      printf "phase=PRECOMMIT_STARTED\n"
      printf "run_id=%s\n" "$RUN_ID"
      printf "run_attempt=%s\n" "$RUN_ATTEMPT"
      printf "release_sha=%s\n" "$RELEASE_SHA"
    } > /rollback/state.tmp
    chmod 0400 /rollback/state.tmp
    mv -f /rollback/state.tmp /rollback/state
    sync
  '
test "$(docker volume inspect "$rollback_volume" --format '{{index .Labels "school.system"}}')" = school-1-11
test "$(docker volume inspect "$rollback_volume" --format '{{index .Labels "school.environment"}}')" = rollback
test "$(docker volume inspect "$rollback_volume" --format '{{index .Labels "school.release"}}')" = "$RELEASE_SHA"
test "$(docker volume inspect "$rollback_volume" --format '{{index .Labels "school.run"}}')" = "$RUN_ID"
test "$(docker volume inspect "$rollback_volume" --format '{{index .Labels "school.run-attempt"}}')" = "$RUN_ATTEMPT"
precommit_started="$(docker run --rm --network none --read-only --user 0:0 \
  --volume "$rollback_volume:/rollback:ro" \
  --entrypoint /bin/sh "$image_id" -c 'cat /rollback/state')"
expected_precommit_started="$(printf 'phase=PRECOMMIT_STARTED\nrun_id=%s\nrun_attempt=%s\nrelease_sha=%s' "$RUN_ID" "$RUN_ATTEMPT" "$RELEASE_SHA")"
test "$precommit_started" = "$expected_precommit_started"
printf 'SCHOOL_STANDALONE_PRECOMMIT=ARMED\n'

restart_suppressed=1
docker update --restart no "$production" >/dev/null
docker stop --time 45 "$production" >/dev/null
test "$(docker inspect "$production" --format '{{.State.Running}}')" = false
test "$(running_volume_consumers "$data_volume")" = 0
create_gate "$data_volume"
printf 'SCHOOL_STANDALONE_WRITES=QUIESCED\n'

final_backup_path="$(docker run --rm   --network none   --user 0:0   --security-opt no-new-privileges:true   --volume "$data_volume:/data"   --volume "$rollback_volume:/backups"   --env DATABASE_PATH=/data/school-1-11.sqlite   --env BACKUP_DIR=/backups   --entrypoint node "$image_id" scripts/backup-db.mjs | tail -n1)"
case "$final_backup_path" in /backups/school-1-11-*.sqlite) ;; *) printf 'Unexpected final backup path\n' >&2; exit 1 ;; esac
final_backup_file="${final_backup_path#/backups/}"
final_proof="$(verify_backup "$rollback_volume" "$final_backup_file")"
final_backup_bytes="${final_proof%%:*}"
final_backup_sha="${final_proof#*:}"
[[ "$final_backup_bytes" =~ ^[0-9]+$ ]]
[[ "$final_backup_sha" =~ ^[a-f0-9]{64}$ ]]
docker run --rm --network none --read-only --user 0:0   --volume "$rollback_volume:/rollback"   --env RUN_ID="$RUN_ID"   --env RUN_ATTEMPT="$RUN_ATTEMPT"   --env RELEASE_SHA="$RELEASE_SHA"   --env BACKUP_FILE="$final_backup_file"   --env BACKUP_SHA="$final_backup_sha"   --entrypoint /bin/sh "$image_id" -c '
    set -eu
    {
      printf "phase=ROLLBACK_READY\n"
      printf "run_id=%s\n" "$RUN_ID"
      printf "run_attempt=%s\n" "$RUN_ATTEMPT"
      printf "release_sha=%s\n" "$RELEASE_SHA"
      printf "backup_file=%s\n" "$BACKUP_FILE"
      printf "backup_sha256=%s\n" "$BACKUP_SHA"
    } > /rollback/state.tmp
    chmod 0400 /rollback/state.tmp
    mv /rollback/state.tmp /rollback/state
    sync
  '
rollback_snapshot_ready=1
printf 'SCHOOL_STANDALONE_FINAL_BACKUP=VERIFIED\n'
printf 'SCHOOL_STANDALONE_FINAL_BACKUP_SHA256=%s\n' "$final_backup_sha"
printf 'SCHOOL_STANDALONE_ROLLBACK_VOLUME=%s\n' "$rollback_volume"

docker rename "$production" "$rollback"
rollback_named=1
docker network disconnect --force "$network_mode" "$rollback"
test "$(docker inspect "$rollback" --format '{{.State.Running}}')" = false

run_args=(
  docker create
  --name "$production"
  --restart no
  --network "$network_mode"
  --user "$runtime_uid:$runtime_gid"
  --publish "$port_binding:3000"
  --security-opt no-new-privileges:true
  --health-cmd "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""
  --health-interval 30s
  --health-timeout 5s
  --health-retries 8
  --health-start-period 30s
  --env-file "$env_file"
  --label-file "$label_file"
  --log-driver "$log_driver"
  --volume "$data_volume:/data"
  --volume "$backup_volume:/backups"
)
for option in "${log_options[@]}"; do run_args+=(--log-opt "$option"); done
for alias in "${network_aliases[@]}"; do run_args+=(--network-alias "$alias"); done
run_args+=("$image_id")
"${run_args[@]}" >/dev/null
candidate_created=1

test "$(docker inspect "$production" --format '{{.Image}}')" = "$image_id"
test "$(docker inspect "$production" --format '{{index .Config.Labels "school.offline-base-ref"}}')" = "$OFFLINE_BASE_REF"
test "$(docker inspect "$production" --format '{{index .Config.Labels "school.offline-base-image-id"}}')" = "$base_image_id"
test "$(docker inspect "$production" --format '{{.Config.User}}')" = "$runtime_uid:$runtime_gid"
test "$(docker inspect "$production" --format '{{.HostConfig.RestartPolicy.Name}}')" = no
test "$(docker inspect "$production" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$data_volume"
test "$(docker inspect "$production" --format '{{range .Mounts}}{{if eq .Destination "/backups"}}{{.Name}}{{end}}{{end}}')" = "$backup_volume"
test "$(docker inspect "$production" --format '{{.HostConfig.NetworkMode}}')" = "$network_mode"
test "$(docker inspect "$production" | python3 -c 'import json,sys; rows=(json.load(sys.stdin)[0]["HostConfig"]["PortBindings"]["3000/tcp"]); print((rows[0].get("HostIp") or "")+":"+(rows[0].get("HostPort") or ""))')" = "$port_binding"

docker start "$production" >/dev/null
wait_container_health "$production"
docker exec "$production" test -f "$gate_path"
verify_internal_gate "$production"
verify_public_gate
live_protected_before="$(protected_schedule_digest "$production")"
[[ "$live_protected_before" =~ ^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[a-f0-9]{64}$ ]]
run_imports "$production"
verify_release_data "$production"
live_protected_after="$(protected_schedule_digest "$production")"
test "$live_protected_after" = "$live_protected_before"
printf 'SCHOOL_STANDALONE_PROTECTED_SCHEDULE_LIVE=PASS\n'
verify_internal_gate "$production"
verify_public_gate
final_proof_after="$(verify_backup "$rollback_volume" "$final_backup_file")"
test "$final_proof_after" = "$final_backup_bytes:$final_backup_sha"
test "$(running_volume_consumers "$data_volume")" = 1
printf 'SCHOOL_STANDALONE_LIVE_IMPORT=VERIFIED\n'

test "$(docker inspect "$production" --format '{{.HostConfig.RestartPolicy.Name}}')" = no
test "$(docker inspect "$rollback" --format '{{.State.Running}}')" = false
test "$(docker inspect "$rollback" --format '{{.HostConfig.RestartPolicy.Name}}')" = no
trap 'pending_signal=129' HUP
trap 'pending_signal=130' INT
trap 'pending_signal=143' TERM
postcommit=1
rollback_allowed=0
docker run --rm --network none --read-only --user 0:0   --volume "$rollback_volume:/rollback"   --env RUN_ID="$RUN_ID"   --env RUN_ATTEMPT="$RUN_ATTEMPT"   --env RELEASE_SHA="$RELEASE_SHA"   --env RESTART_NAME="$restart_name"   --env RESTART_MAX="$restart_max"   --entrypoint /bin/sh "$image_id" -c '
    set -eu
    {
      printf "phase=ROLLBACK_DISABLED\n"
      printf "run_id=%s\n" "$RUN_ID"
      printf "run_attempt=%s\n" "$RUN_ATTEMPT"
      printf "release_sha=%s\n" "$RELEASE_SHA"
      printf "restart_name=%s\n" "$RESTART_NAME"
      printf "restart_max=%s\n" "$RESTART_MAX"
    } > /rollback/state.tmp
    chmod 0400 /rollback/state.tmp
    mv -f /rollback/state.tmp /rollback/state
    sync
  '
test ! -e "$JOB_DIR/commit-state"
test ! -e "$JOB_DIR/commit-state.tmp"
printf 'committed:%s:%s:%s\n' "$RELEASE_SHA" "$RUN_ID" "$RUN_ATTEMPT" > "$JOB_DIR/commit-state.tmp"
chmod 0400 "$JOB_DIR/commit-state.tmp"
mv "$JOB_DIR/commit-state.tmp" "$JOB_DIR/commit-state"
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$pending_signal" -ne 0 ]; then
  exit "$pending_signal"
fi
if [ -e "$JOB_DIR/cancel-request" ]; then
  exit 143
fi
printf 'SCHOOL_STANDALONE_COMMIT=ROLLBACK_DISABLED\n'

if [ -e "$JOB_DIR/cancel-request" ]; then
  exit 143
fi
verify_internal_gate "$production"
verify_public_gate
printf 'SCHOOL_STANDALONE_EXTERNAL_VERIFICATION_GATE=HELD\n'
docker run --rm --network none --read-only --user 0:0   --volume "$rollback_volume:/rollback"   --env RUN_ID="$RUN_ID"   --env RUN_ATTEMPT="$RUN_ATTEMPT"   --env RELEASE_SHA="$RELEASE_SHA"   --env RESTART_NAME="$restart_name"   --env RESTART_MAX="$restart_max"   --entrypoint /bin/sh "$image_id" -c '
    set -eu
    {
      printf "phase=RELEASE_VERIFIED\n"
      printf "run_id=%s\n" "$RUN_ID"
      printf "run_attempt=%s\n" "$RUN_ATTEMPT"
      printf "release_sha=%s\n" "$RELEASE_SHA"
      printf "restart_name=%s\n" "$RESTART_NAME"
      printf "restart_max=%s\n" "$RESTART_MAX"
    } > /rollback/state.tmp
    chmod 0400 /rollback/state.tmp
    mv -f /rollback/state.tmp /rollback/state
    sync
  '
printf 'SCHOOL_STANDALONE_RELEASE=VERIFIED\n'
success=1
postcommit=0

printf 'SCHOOL_STANDALONE_CUTOVER=PASS\n'
printf 'SCHOOL_DELIVERY_REF=%s\n' "$RELEASE_SHA"
printf 'SCHOOL_RELEASE_SCHEDULE_ROWS=189\n'
printf 'SCHOOL_RELEASE_CALENDAR_PERIODS=4\n'
printf 'SCHOOL_RELEASE_CURRICULUM_TOPICS=170\n'
printf 'SCHOOL_RELEASE_CURRICULUM_SESSIONS=170\n'
printf 'SCHOOL_RELEASE_CURRICULUM_FIRST_DATE=2026-09-01\n'
printf 'SCHOOL_RELEASE_CURRICULUM_LAST_DATE=2027-05-28\n'
printf 'SCHOOL_RELEASE_CURRICULUM_RESERVE_DATE=2027-05-31\n'
printf 'SCHOOL_STANDALONE_BACKUP=VERIFIED\n'
printf 'SCHOOL_STANDALONE_DATA_VOLUME=PRESERVED\n'
printf 'SCHOOL_PUBLIC_URL=%s\n' "$SCHOOL_ORIGIN"
