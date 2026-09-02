#!/usr/bin/env bash

set -Eeuo pipefail

PRODUCTION=${PRODUCTION:-school-1-11}
SCHOOL_ROOT=${SCHOOL_ROOT:-/srv/school-1-11}
SCHOOL_HOST=${SCHOOL_HOST:-school-188-225-38-55.sslip.io}
ARTHELLO_ORIGIN=${ARTHELLO_ORIGIN:-https://arthello-188-225-38-55.sslip.io}
CANDIDATE_IMAGE=${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}
CANDIDATE_ARCHIVE=${CANDIDATE_ARCHIVE:?CANDIDATE_ARCHIVE is required}
CANDIDATE_SHA256=${CANDIDATE_SHA256:?CANDIDATE_SHA256 is required}
RELEASE_SHA=${RELEASE_SHA:?RELEASE_SHA is required}
RUN_STAMP=${RUN_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}
BACKUP_ROOT=${BACKUP_ROOT:-$SCHOOL_ROOT/host-backups}
BACKUP_DIR=$BACKUP_ROOT/sso-origin-$RUN_STAMP-${RELEASE_SHA:0:12}
WRITE_GATE=/data/.school-deploy-read-only
PUBLIC_ORIGIN=https://$SCHOOL_HOST

OLD_IMAGE_ID=
ROLLBACK_IMAGE=
DATA_VOLUME=
DATABASE_UID=
DATABASE_GID=
DATABASE_MODE=
HOST_DATABASE_BACKUP=
HOST_DATABASE_SHA256=
COMPOSE_WORKDIR=
COMPOSE_FILES=()
PREFLIGHT_CONTAINER=
PREFLIGHT_VOLUME=
GATE_HELD=0
BACKUP_READY=0
CUTOVER_STARTED=0
SUCCESS=0

log() {
  printf '%s\n' "$*"
}

wait_container_health() {
  local container=$1
  local attempt state
  for attempt in $(seq 1 120); do
    state=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    [ "$state" = healthy ] && return 0
    [ "$state" = unhealthy ] && return 1
    [ "$state" = exited ] && return 1
    sleep 2
  done
  return 1
}

verify_sqlite_file() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sqlite3
import sys

path = Path(sys.argv[1])
if not path.is_file() or path.stat().st_size <= 0:
    raise SystemExit("SQLite backup is missing or empty")
connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
try:
    value = connection.execute("PRAGMA integrity_check").fetchone()[0]
finally:
    connection.close()
if value != "ok":
    raise SystemExit(f"SQLite integrity_check failed: {value}")
PY
}

compose_with_override() {
  local override=$1
  shift
  local args=()
  local file
  for file in "${COMPOSE_FILES[@]}"; do
    args+=( -f "$file" )
  done
  docker compose \
    --env-file "$SCHOOL_ROOT/shared/.env" \
    --project-name school-1-11 \
    "${args[@]}" \
    -f "$override" \
    "$@"
}

write_image_override() {
  local path=$1
  local image=$2
  cat > "$path" <<EOF
services:
  school:
    image: $image
EOF
  chmod 0600 "$path"
}

create_write_gate() {
  docker exec --user 0:0 "$PRODUCTION" sh -lc '
    set -eu
    gate=/data/.school-deploy-read-only
    tmp="${gate}.tmp.$$"
    rm -f "$tmp"
    umask 022
    printf "deployment read-only\n" > "$tmp"
    chmod 0444 "$tmp"
    mv -f "$tmp" "$gate"
    test -f "$gate"
    sync
  '
  GATE_HELD=1
  log 'SCHOOL_SSO_WRITE_GATE=ENABLED'
}

clear_write_gate_with_image() {
  local image=$1
  docker run --rm \
    --network none \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --volume "$DATA_VOLUME:/data" \
    --entrypoint /bin/sh \
    "$image" \
    -c 'rm -f /data/.school-deploy-read-only && test ! -e /data/.school-deploy-read-only && sync'
  GATE_HELD=0
  log 'SCHOOL_SSO_WRITE_GATE=DISABLED'
}

verify_public_gate() {
  local body headers status attempt
  body=$(mktemp /tmp/school-sso-gate.XXXXXX.json)
  headers=$(mktemp /tmp/school-sso-gate.XXXXXX.headers)
  for attempt in $(seq 1 30); do
    : > "$body"
    : > "$headers"
    status=$(curl --silent --show-error --max-time 30 \
      --output "$body" \
      --dump-header "$headers" \
      --write-out '%{http_code}' \
      --request POST \
      --header "Origin: $PUBLIC_ORIGIN" \
      --header 'Content-Type: application/json' \
      --data '{"action":"deployment.sso-origin.write-gate"}' \
      "$PUBLIC_ORIGIN/api/school" || true)
    if [ "$status" = 503 ] \
      && grep -Eq '"code"[[:space:]]*:[[:space:]]*"deployment_read_only"' "$body" \
      && grep -Eiq '^Retry-After:[[:space:]]*30[[:space:]]*$' "$headers"; then
      rm -f "$body" "$headers"
      log 'SCHOOL_SSO_PUBLIC_WRITE_GATE=VERIFIED'
      return 0
    fi
    sleep 2
  done
  printf 'Unexpected write-gate response: status=%s\n' "$status" >&2
  sed -E 's/(password|token|secret|private_key)"?[[:space:]]*:[[:space:]]*"[^"]+"/\1":"[REDACTED]"/Ig' "$body" >&2 || true
  rm -f "$body" "$headers"
  return 1
}

verify_public_release() {
  local health login headers attempt status location
  health=$(mktemp /tmp/school-sso-health.XXXXXX.json)
  login=$(mktemp /tmp/school-sso-login.XXXXXX.html)
  headers=$(mktemp /tmp/school-sso-start.XXXXXX.headers)
  for attempt in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 30 \
      --header 'Cache-Control: no-cache' \
      "$PUBLIC_ORIGIN/api/health?release=$RELEASE_SHA" > "$health" \
      && grep -F '"status":"ok"' "$health" >/dev/null; then
      break
    fi
    sleep 3
  done
  grep -F '"status":"ok"' "$health" >/dev/null
  curl --fail --silent --show-error --max-time 60 \
    --header 'Cache-Control: no-cache' \
    "$PUBLIC_ORIGIN/login?release=$RELEASE_SHA" > "$login"
  grep -F 'Вход для сотрудников' "$login" >/dev/null
  grep -F 'Вход для семьи и ученика' "$login" >/dev/null
  status=$(curl --silent --show-error --max-time 30 \
    --output /dev/null \
    --dump-header "$headers" \
    --write-out '%{http_code}' \
    "$PUBLIC_ORIGIN/auth/central/start?return_to=%2F" || true)
  test "$status" = 303
  location=$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^[^:]+:[[:space:]]*/,""); sub(/\r$/,""); print; exit}' "$headers")
  case "$location" in
    "$ARTHELLO_ORIGIN"/api/school-sso/authorize*) ;;
    *)
      printf 'Unexpected SSO authority: %s\n' "$location" >&2
      return 1
      ;;
  esac
  rm -f "$health" "$login" "$headers"
  log 'SCHOOL_SSO_PUBLIC_HEALTH=OK'
  log 'SCHOOL_SSO_PUBLIC_LOGIN=OK'
  log 'SCHOOL_SSO_PUBLIC_START=OK'
}

restore_database() {
  test "$BACKUP_READY" -eq 1
  verify_sqlite_file "$HOST_DATABASE_BACKUP"
  test "$(sha256sum "$HOST_DATABASE_BACKUP" | awk '{print $1}')" = "$HOST_DATABASE_SHA256"
  docker run --rm \
    --network none \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --volume "$DATA_VOLUME:/data" \
    --volume "$BACKUP_DIR:/restore:ro" \
    --env TARGET_UID="$DATABASE_UID" \
    --env TARGET_GID="$DATABASE_GID" \
    --env TARGET_MODE="$DATABASE_MODE" \
    --entrypoint /bin/sh \
    "$ROLLBACK_IMAGE" \
    -c '
      set -eu
      source=/restore/school-1-11.sqlite
      target=/data/school-1-11.sqlite
      test -s "$source"
      rm -f "${target}-wal" "${target}-shm" "${target}-journal" "${target}.restore"
      cp "$source" "${target}.restore"
      chown "$TARGET_UID:$TARGET_GID" "${target}.restore"
      chmod "$TARGET_MODE" "${target}.restore"
      mv -f "${target}.restore" "$target"
      sync
    '
}

rollback() {
  local original_rc=$1
  set +e
  log 'SCHOOL_SSO_ROLLBACK=START'
  if [ "$BACKUP_READY" -ne 1 ]; then
    log 'SCHOOL_SSO_ROLLBACK=NOT_ARMED'
    return "$original_rc"
  fi

  if [ "$CUTOVER_STARTED" -eq 0 ]; then
    if [ "$GATE_HELD" -eq 1 ]; then
      clear_write_gate_with_image "$ROLLBACK_IMAGE" || return 91
    fi
    log 'SCHOOL_SSO_ROLLBACK=OLD_RELEASE_UNCHANGED'
    return "$original_rc"
  fi

  docker rm -f "$PRODUCTION" >/dev/null 2>&1 || true
  restore_database || return 92
  rollback_override=$BACKUP_DIR/rollback.override.yml
  write_image_override "$rollback_override" "$ROLLBACK_IMAGE" || return 93
  (
    cd "$COMPOSE_WORKDIR" || exit 1
    compose_with_override "$rollback_override" up -d --no-build --force-recreate school
  ) || return 94
  wait_container_health "$PRODUCTION" || {
    docker logs "$PRODUCTION" --tail 200 >&2 || true
    return 95
  }
  clear_write_gate_with_image "$ROLLBACK_IMAGE" || return 96
  verify_public_release || return 97
  docker exec "$PRODUCTION" node --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db=new DatabaseSync(process.env.DATABASE_PATH,{readOnly:true});
    const value=db.prepare("PRAGMA integrity_check").get().integrity_check;
    db.close();
    if(value!=="ok") process.exit(1);
  ' || return 98
  log 'SCHOOL_SSO_ROLLBACK=COMPLETE'
  return "$original_rc"
}

cleanup() {
  local rc=$?
  set +e
  if [ -n "$PREFLIGHT_CONTAINER" ]; then
    docker rm -f "$PREFLIGHT_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [ -n "$PREFLIGHT_VOLUME" ]; then
    docker volume rm "$PREFLIGHT_VOLUME" >/dev/null 2>&1 || true
  fi
  if [ "$SUCCESS" -ne 1 ]; then
    rollback "$rc"
    rollback_rc=$?
    if [ "$rollback_rc" -ne "$rc" ]; then
      log "SCHOOL_SSO_ROLLBACK=FAILED_CODE_$rollback_rc"
      exit "$rollback_rc"
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT

# Preflight live topology and immutable candidate archive.
test "$(docker inspect "$PRODUCTION" --format '{{.State.Running}}')" = true
test "$(docker inspect "$PRODUCTION" --format '{{.State.Health.Status}}')" = healthy
test -s "$CANDIDATE_ARCHIVE"
test "$(sha256sum "$CANDIDATE_ARCHIVE" | awk '{print $1}')" = "$CANDIDATE_SHA256"
test -s "$SCHOOL_ROOT/shared/.env"

OLD_IMAGE_ID=$(docker inspect "$PRODUCTION" --format '{{.Image}}')
old_user=$(docker inspect "$PRODUCTION" --format '{{.Config.User}}')
old_workdir=$(docker inspect "$PRODUCTION" --format '{{.Config.WorkingDir}}')
test "$old_user" = node
test "$old_workdir" = /school
ROLLBACK_IMAGE=school-sso-rollback:${RUN_STAMP}-${RELEASE_SHA:0:12}
docker tag "$OLD_IMAGE_ID" "$ROLLBACK_IMAGE"

DATA_VOLUME=$(docker inspect "$PRODUCTION" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
test -n "$DATA_VOLUME"
database_meta=$(docker exec "$PRODUCTION" stat -c '%u:%g:%a' /data/school-1-11.sqlite)
IFS=: read -r DATABASE_UID DATABASE_GID DATABASE_MODE <<<"$database_meta"
[[ "$DATABASE_UID" =~ ^[0-9]+$ ]]
[[ "$DATABASE_GID" =~ ^[0-9]+$ ]]
[[ "$DATABASE_MODE" =~ ^[0-7]{3,4}$ ]]

COMPOSE_WORKDIR=$(docker inspect "$PRODUCTION" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
config_csv=$(docker inspect "$PRODUCTION" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
if [ -z "$COMPOSE_WORKDIR" ] || [ -z "$config_csv" ]; then
  COMPOSE_WORKDIR=$SCHOOL_ROOT/current/deploy
  COMPOSE_FILES=(
    "$COMPOSE_WORKDIR/docker-compose.yml"
    "$COMPOSE_WORKDIR/compose.offline.yml"
  )
else
  IFS=, read -r -a COMPOSE_FILES <<<"$config_csv"
fi
test -d "$COMPOSE_WORKDIR"
for compose_file in "${COMPOSE_FILES[@]}"; do
  test -s "$compose_file"
done

install -m 0700 -d "$BACKUP_DIR"
cp "$SCHOOL_ROOT/shared/.env" "$BACKUP_DIR/school.env"
chmod 0600 "$BACKUP_DIR/school.env"
printf '%s\n' "$OLD_IMAGE_ID" > "$BACKUP_DIR/old-image-id.txt"
printf '%s\n' "$ROLLBACK_IMAGE" > "$BACKUP_DIR/rollback-image.txt"
printf '%s\n' "$CANDIDATE_IMAGE" > "$BACKUP_DIR/candidate-image.txt"
printf '%s\n' "$RELEASE_SHA" > "$BACKUP_DIR/release-sha.txt"
chmod 0600 "$BACKUP_DIR"/*.txt

# Load and validate the exact candidate before touching live data.
docker load --input "$CANDIDATE_ARCHIVE" >/dev/null
candidate_image_id=$(docker image inspect "$CANDIDATE_IMAGE" --format '{{.Id}}')
test -n "$candidate_image_id"
test "$(docker image inspect "$CANDIDATE_IMAGE" --format '{{index .Config.Labels "school.release.sha"}}')" = "$RELEASE_SHA"
test "$(docker image inspect "$CANDIDATE_IMAGE" --format '{{.Config.User}}')" = node
test "$(docker image inspect "$CANDIDATE_IMAGE" --format '{{.Config.WorkingDir}}')" = /school
test "$(docker run --rm --network none --entrypoint id "$CANDIDATE_IMAGE" -u)" = "$(docker exec "$PRODUCTION" id -u)"
log 'SCHOOL_SSO_CANDIDATE_ARCHIVE=VERIFIED'

# Freeze writes, verify the public maintenance boundary, and take a consistent
# final backup. This is the authoritative rollback point.
create_write_gate
verify_public_gate
container_backup=/backups/sso-origin-$RUN_STAMP.sqlite
docker exec --user 0:0 \
  --env CONTAINER_BACKUP="$container_backup" \
  "$PRODUCTION" node --input-type=module - <<'NODE'
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const source=process.env.DATABASE_PATH || '/data/school-1-11.sqlite';
const target=process.env.CONTAINER_BACKUP;
rmSync(target,{force:true});
const db=new DatabaseSync(source);
db.exec('PRAGMA wal_checkpoint(FULL)');
const escaped=target.replaceAll("'","''");
db.exec(`VACUUM INTO '${escaped}'`);
const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
db.close();
if(integrity!=='ok') process.exit(1);
NODE
docker cp "$PRODUCTION:$container_backup" "$BACKUP_DIR/school-1-11.sqlite"
docker exec --user 0:0 "$PRODUCTION" rm -f "$container_backup"
HOST_DATABASE_BACKUP=$BACKUP_DIR/school-1-11.sqlite
chmod 0600 "$HOST_DATABASE_BACKUP"
verify_sqlite_file "$HOST_DATABASE_BACKUP"
HOST_DATABASE_SHA256=$(sha256sum "$HOST_DATABASE_BACKUP" | awk '{print $1}')
printf '%s  school-1-11.sqlite\n' "$HOST_DATABASE_SHA256" > "$BACKUP_DIR/SHA256SUMS"
chmod 0600 "$BACKUP_DIR/SHA256SUMS"
BACKUP_READY=1
log 'SCHOOL_SSO_DATABASE_BACKUP=VERIFIED'

# Validate the candidate against a cloned database, never the live volume.
PREFLIGHT_VOLUME=school_sso_preflight_${RUN_STAMP}_${RELEASE_SHA:0:8}
PREFLIGHT_CONTAINER=school-sso-preflight-${RELEASE_SHA:0:12}
docker volume create "$PREFLIGHT_VOLUME" >/dev/null
docker run --rm \
  --network none \
  --user 0:0 \
  --security-opt no-new-privileges:true \
  --volume "$PREFLIGHT_VOLUME:/data" \
  --volume "$BACKUP_DIR:/restore:ro" \
  --env TARGET_UID="$DATABASE_UID" \
  --env TARGET_GID="$DATABASE_GID" \
  --env TARGET_MODE="$DATABASE_MODE" \
  --entrypoint /bin/sh \
  "$CANDIDATE_IMAGE" \
  -c 'cp /restore/school-1-11.sqlite /data/school-1-11.sqlite && chown "$TARGET_UID:$TARGET_GID" /data/school-1-11.sqlite && chmod "$TARGET_MODE" /data/school-1-11.sqlite'
docker run -d \
  --name "$PREFLIGHT_CONTAINER" \
  --network none \
  --security-opt no-new-privileges:true \
  --env-file "$SCHOOL_ROOT/shared/.env" \
  --env NODE_ENV=production \
  --env PORT=3000 \
  --env DATABASE_PATH=/data/school-1-11.sqlite \
  --env PUBLIC_APP_ORIGIN=http://127.0.0.1:3000 \
  --env ARTHELLO_PUBLIC_ORIGIN="$ARTHELLO_ORIGIN" \
  --volume "$PREFLIGHT_VOLUME:/data" \
  "$CANDIDATE_IMAGE" >/dev/null
wait_container_health "$PREFLIGHT_CONTAINER" || {
  docker logs "$PREFLIGHT_CONTAINER" --tail 200 >&2 || true
  exit 1
}
docker exec -i "$PREFLIGHT_CONTAINER" node --input-type=module <<'VERIFY'
import { DatabaseSync } from 'node:sqlite';
const base='http://127.0.0.1:3000';
const health=await fetch(base+'/api/health');
if(!health.ok || !(await health.text()).includes('"status":"ok"')) throw new Error('health failed');
const login=await fetch(base+'/login');
const html=await login.text();
if(!login.ok || !html.includes('Вход для сотрудников')) throw new Error('staff login marker missing');
const start=await fetch(base+'/auth/central/start',{redirect:'manual'});
const location=start.headers.get('location')||'';
if(start.status!==303 || !location.startsWith('https://arthello-188-225-38-55.sslip.io/api/school-sso/authorize')) throw new Error('SSO start failed');
const db=new DatabaseSync(process.env.DATABASE_PATH,{readOnly:true});
const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
db.close();
if(integrity!=='ok') throw new Error('database integrity failed');
console.log('SCHOOL_SSO_CLONE_PREFLIGHT=PASS');
VERIFY
docker rm -f "$PREFLIGHT_CONTAINER" >/dev/null
PREFLIGHT_CONTAINER=
docker volume rm "$PREFLIGHT_VOLUME" >/dev/null
PREFLIGHT_VOLUME=
log 'SCHOOL_SSO_CLONE_PREFLIGHT=PASS'

# Atomic compose recreation on the existing data volume. The write gate stays
# active until every private and public acceptance check has passed.
candidate_override=$BACKUP_DIR/candidate.override.yml
write_image_override "$candidate_override" "$CANDIDATE_IMAGE"
CUTOVER_STARTED=1
(
  cd "$COMPOSE_WORKDIR"
  compose_with_override "$candidate_override" up -d --no-build --force-recreate school
)
wait_container_health "$PRODUCTION" || {
  docker logs "$PRODUCTION" --tail 240 >&2 || true
  exit 1
}
test "$(docker inspect "$PRODUCTION" --format '{{.Image}}')" = "$candidate_image_id"
test "$(docker inspect "$PRODUCTION" --format '{{index .Config.Labels "school.release.sha"}}')" = "$RELEASE_SHA"
docker exec "$PRODUCTION" node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const db=new DatabaseSync(process.env.DATABASE_PATH,{readOnly:true});
  const value=db.prepare("PRAGMA integrity_check").get().integrity_check;
  db.close();
  if(value!=="ok") process.exit(1);
'
verify_public_gate
verify_public_release
clear_write_gate_with_image "$CANDIDATE_IMAGE"

health_after=$(curl --fail --silent --show-error --max-time 30 \
  --header 'Cache-Control: no-cache' \
  "$PUBLIC_ORIGIN/api/health?release=$RELEASE_SHA")
grep -F '"status":"ok"' <<<"$health_after" >/dev/null
grep -F '"maintenance":false' <<<"$health_after" >/dev/null
verify_public_release

SUCCESS=1
log "SCHOOL_SSO_RELEASE_SHA=$RELEASE_SHA"
log "SCHOOL_SSO_CANDIDATE_IMAGE_ID=$candidate_image_id"
log "SCHOOL_SSO_BACKUP_DIR=$BACKUP_DIR"
log "SCHOOL_SSO_ROLLBACK_IMAGE=$ROLLBACK_IMAGE"
log 'SCHOOL_SSO_PRODUCTION_CUTOVER=PASS'
