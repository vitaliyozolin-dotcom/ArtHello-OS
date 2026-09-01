#!/usr/bin/env bash

set -Eeuo pipefail

SCHOOL_ROOT=${SCHOOL_ROOT:-/srv/school-1-11}
SCHOOL_HOST=${SCHOOL_HOST:-school-188-225-38-55.sslip.io}
TOKEN_FILE=${TOKEN_FILE:-/srv/arthello/shared/github-https/token}
DELIVERY_REF=${DELIVERY_REF:?DELIVERY_REF must be the immutable Git commit SHA}
SOURCE_DIR=${SOURCE_DIR:-}
VERIFY_PUBLIC=${VERIFY_PUBLIC:-1}
HOST_BACKUP_ROOT=${HOST_BACKUP_ROOT:-"$SCHOOL_ROOT/host-backups"}
RUNTIME_SHA256=9125b43319706f4bf3a9a45813b50a0495e61bef5b73f3305a1b97717406b349
RUNTIME_PART_GLOB=offline-runtime-v3.part-\*
DELTA_SHA256=a4ef97eb6795cb81c860ab62b0ae7510e693b1fec1e5f6129aea072ce2ca2c9f
DELTA_PART_GLOB=offline-runtime-v4-delta.part-\*
RELEASE_DELTA_SHA256=b451004c5d1584546233ba39d6ea37c0701a1653c1fd8f7b5ba2d21bd6b201d2
RELEASE_DELTA_PART_GLOB=offline-runtime-v5-delta.part-\*
WRITE_GATE_PATH=/data/.school-deploy-read-only
PUBLIC_NETWORK_NAME=${PUBLIC_NETWORK_NAME:-arthello-os_public}
DEPLOY_SHELL_PID=$BASHPID

ARCHIVE=$(mktemp /tmp/school-release.XXXXXX.tar.gz)
CURL_CONFIG=$(mktemp /tmp/school-release-curl.XXXXXX)
RELEASE="$SCHOOL_ROOT/releases/school-$(date -u +%Y%m%dT%H%M%SZ)-${DELIVERY_REF:0:12}"
PREVIOUS_RELEASE=""
SWITCHED=0
ROLLBACK_ARMED=0
PRE_ARM_RECOVERY=0
POST_COMMIT_GATE_RECOVERY=0
ENV_UPDATE_TMP=""
CURRENT_LINK_TMP=""
PUBLIC_LOGIN_FILE=""
PUBLIC_CSS_FILE=""
PUBLIC_WRITE_GATE_FILE=""
PUBLIC_WRITE_GATE_HEADERS=""
HOST_BACKUP_DIR=""
HOST_DATABASE_BACKUP=""
HOST_ENV_BACKUP=""
DATABASE_BACKUP_SHA256=""
ENV_BACKUP_SHA256=""
LIVE_DATABASE_PATH=""
DATA_VOLUME_NAME=""
DATABASE_UID=""
DATABASE_GID=""
DATABASE_MODE=""
ENV_UID=""
ENV_GID=""
ENV_MODE=""
HELPER_IMAGE_ID=""
PREVIOUS_IMAGE_ID=""
PREVIOUS_IMAGE_NAME=""
CANDIDATE_IMAGE_ID=""
OFFLINE_BACKUP_CONTAINER=""
WRITE_GATE_HELD=0

cleanup() {
  rm -f "$ARCHIVE" "$CURL_CONFIG"
  if [ -n "$ENV_UPDATE_TMP" ]; then
    rm -f "$ENV_UPDATE_TMP"
  fi
  if [ -n "$CURRENT_LINK_TMP" ]; then
    rm -f "$CURRENT_LINK_TMP"
  fi
  if [ -n "$PUBLIC_LOGIN_FILE" ]; then
    rm -f "$PUBLIC_LOGIN_FILE"
  fi
  if [ -n "$PUBLIC_CSS_FILE" ]; then
    rm -f "$PUBLIC_CSS_FILE"
  fi
  if [ -n "$PUBLIC_WRITE_GATE_FILE" ]; then
    rm -f "$PUBLIC_WRITE_GATE_FILE"
  fi
  if [ -n "$PUBLIC_WRITE_GATE_HEADERS" ]; then
    rm -f "$PUBLIC_WRITE_GATE_HEADERS"
  fi
  if [ -n "$OFFLINE_BACKUP_CONTAINER" ]; then
    docker rm -f "$OFFLINE_BACKUP_CONTAINER" >/dev/null 2>&1 || true
  fi
}

compose() {
  docker compose \
    --env-file "$SCHOOL_ROOT/shared/.env" \
    -p school-1-11 \
    -f docker-compose.yml \
    -f compose.offline.yml \
    "$@"
}

compose_private() {
  docker compose \
    --env-file "$SCHOOL_ROOT/shared/.env" \
    -p school-1-11 \
    -f docker-compose.yml \
    -f compose.candidate-private.yml \
    "$@"
}

wait_for_school_health() {
  local status=unknown
  local attempt
  for attempt in $(seq 1 90); do
    status=$(docker inspect \
      -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      school-1-11 2>/dev/null || true)
    [ "$status" = healthy ] && return 0
    [ "$status" = unhealthy ] && return 1
    sleep 2
  done
  return 1
}

atomic_switch_release() {
  local target=$1
  test -d "$target/deploy"
  CURRENT_LINK_TMP="$SCHOOL_ROOT/.current.${DELIVERY_REF:0:12}.$$"
  rm -f "$CURRENT_LINK_TMP"
  ln -s "$target" "$CURRENT_LINK_TMP"
  mv -Tf "$CURRENT_LINK_TMP" "$SCHOOL_ROOT/current"
  CURRENT_LINK_TMP=""
}

verify_public_release() {
  local origin="https://$SCHOOL_HOST"
  local healthy=0
  local attempt
  local css_path
  local css_count=0

  for attempt in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 30 "$origin/api/health" \
      | grep -F '"status":"ok"' >/dev/null; then
      healthy=1
      break
    fi
    sleep 3
  done
  test "$healthy" -eq 1

  PUBLIC_LOGIN_FILE=$(mktemp /tmp/school-public-login.XXXXXX.html)
  PUBLIC_CSS_FILE=$(mktemp /tmp/school-public-css.XXXXXX.css)
  curl --fail --silent --show-error --max-time 60 \
    -H 'Cache-Control: no-cache' \
    "$origin/login?release=$DELIVERY_REF" > "$PUBLIC_LOGIN_FILE"
  : > "$PUBLIC_CSS_FILE"
  while IFS= read -r css_path; do
    [ -n "$css_path" ] || continue
    curl --fail --silent --show-error --max-time 60 \
      "$origin$css_path" >> "$PUBLIC_CSS_FILE"
    printf '\n' >> "$PUBLIC_CSS_FILE"
    css_count=$((css_count + 1))
  done < <(grep -oE '/_next/static/css/[^"?]+\.css' "$PUBLIC_LOGIN_FILE" | sort -u)
  test "$css_count" -gt 0
  grep -F '.l0-stage{width:100%;height:100svh;overflow:hidden' \
    "$PUBLIC_CSS_FILE" >/dev/null
  grep -F 'student-dashboard-hero-v1.webp' "$PUBLIC_CSS_FILE" >/dev/null
  printf 'SCHOOL_PUBLIC_HTTPS=OK\n'
  printf 'SCHOOL_FULLSCREEN_CSS=VERIFIED\n'
}

verify_public_write_gate() {
  local origin="https://$SCHOOL_HOST"
  local status
  local attempt
  local verified=0
  PUBLIC_WRITE_GATE_FILE=$(mktemp /tmp/school-public-write-gate.XXXXXX.json)
  PUBLIC_WRITE_GATE_HEADERS=$(mktemp /tmp/school-public-write-gate.XXXXXX.headers)
  for attempt in $(seq 1 20); do
    : > "$PUBLIC_WRITE_GATE_FILE"
    : > "$PUBLIC_WRITE_GATE_HEADERS"
    if status=$(curl --silent --show-error --max-time 30 \
      --output "$PUBLIC_WRITE_GATE_FILE" \
      --dump-header "$PUBLIC_WRITE_GATE_HEADERS" \
      --write-out '%{http_code}' \
      --request POST \
      --header "Origin: $origin" \
      --header 'Content-Type: application/json' \
      --data '{"action":"deployment.write-gate.probe"}' \
      "$origin/api/school"); then
      if [ "$status" = 503 ] \
        && grep -Eq '"code"[[:space:]]*:[[:space:]]*"deployment_read_only"' \
          "$PUBLIC_WRITE_GATE_FILE" \
        && grep -Eiq '^Retry-After:[[:space:]]*30[[:space:]]*$' \
          "$PUBLIC_WRITE_GATE_HEADERS" \
        && grep -Eiq '^Cache-Control:[[:space:]]*no-store[[:space:]]*$' \
          "$PUBLIC_WRITE_GATE_HEADERS"; then
        verified=1
        break
      fi
    fi
    sleep 2
  done
  test "$verified" -eq 1
  printf 'SCHOOL_PUBLIC_WRITE_GATE=VERIFIED\n'
}

verify_private_write_gate() {
  docker exec --env "SCHOOL_PROBE_ORIGIN=https://$SCHOOL_HOST" \
    -i school-1-11 node --input-type=module <<'VERIFY_PRIVATE_WRITE_GATE'
const origin = process.env.SCHOOL_PROBE_ORIGIN;
const response = await fetch('http://127.0.0.1:3000/api/school', {
  method: 'POST',
  headers: {
    Origin: origin,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action: 'deployment.write-gate.private-probe' }),
});
const body = await response.json();
if (
  response.status !== 503 ||
  body?.code !== 'deployment_read_only' ||
  response.headers.get('retry-after') !== '30' ||
  response.headers.get('cache-control') !== 'no-store'
) {
  console.error(JSON.stringify({
    status: response.status,
    body,
    retryAfter: response.headers.get('retry-after'),
    cacheControl: response.headers.get('cache-control'),
  }));
  process.exit(1);
}
VERIFY_PRIVATE_WRITE_GATE
  printf 'SCHOOL_PRIVATE_WRITE_GATE=VERIFIED\n'
}

public_network_state() {
  docker inspect \
    --format "{{if index .NetworkSettings.Networks \"$PUBLIC_NETWORK_NAME\"}}attached{{end}}" \
    school-1-11
}

attach_public_network() {
  docker network inspect "$PUBLIC_NETWORK_NAME" >/dev/null
  test -z "$(public_network_state)"
  docker network connect \
    --alias school-1-11 \
    "$PUBLIC_NETWORK_NAME" \
    school-1-11
  test "$(public_network_state)" = attached
  printf 'SCHOOL_PUBLIC_NETWORK=ATTACHED\n'
}

verify_public_write_gate_released() {
  local origin="https://$SCHOOL_HOST"
  local response
  response=$(curl --fail --silent --show-error --max-time 30 \
    -H 'Cache-Control: no-cache' \
    "$origin/api/health")
  printf '%s\n' "$response" | grep -F '"status":"ok"' >/dev/null
  printf '%s\n' "$response" | grep -F '"maintenance":false' >/dev/null
  printf 'SCHOOL_PUBLIC_WRITE_GATE=RELEASED\n'
}

create_write_gate() {
  test "$WRITE_GATE_PATH" = /data/.school-deploy-read-only
  docker run --rm \
    --network none \
    --read-only \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --volume "$DATA_VOLUME_NAME:/data" \
    --env WRITE_GATE_PATH="$WRITE_GATE_PATH" \
    --entrypoint /bin/sh \
    "$HELPER_IMAGE_ID" \
    -c '
      set -eu
      test "$WRITE_GATE_PATH" = /data/.school-deploy-read-only
      gate_tmp="${WRITE_GATE_PATH}.tmp.$$"
      rm -f "$gate_tmp"
      umask 022
      printf "deployment read-only\n" > "$gate_tmp"
      chmod 0444 "$gate_tmp"
      mv -f "$gate_tmp" "$WRITE_GATE_PATH"
      test -f "$WRITE_GATE_PATH"
      sync
    '
  WRITE_GATE_HELD=1
  printf 'SCHOOL_WRITE_GATE=ENABLED\n'
}

clear_write_gate() {
  test "$WRITE_GATE_PATH" = /data/.school-deploy-read-only
  docker run --rm \
    --network none \
    --read-only \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --volume "$DATA_VOLUME_NAME:/data" \
    --env WRITE_GATE_PATH="$WRITE_GATE_PATH" \
    --entrypoint /bin/sh \
    "$HELPER_IMAGE_ID" \
    -c '
      set -eu
      test "$WRITE_GATE_PATH" = /data/.school-deploy-read-only
      rm -f "$WRITE_GATE_PATH"
      test ! -e "$WRITE_GATE_PATH"
      sync
    '
  WRITE_GATE_HELD=0
  printf 'SCHOOL_WRITE_GATE=DISABLED\n'
}

verify_host_sqlite() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sqlite3
import sys

path = Path(sys.argv[1])
if not path.is_file() or path.stat().st_size <= 0:
    raise SystemExit("SQLite backup is missing or empty")
connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
try:
    connection.execute("PRAGMA temp_store=MEMORY")
    result = connection.execute("PRAGMA integrity_check").fetchone()
finally:
    connection.close()
if not result or result[0] != "ok":
    raise SystemExit(f"SQLite integrity_check failed: {result!r}")
PY
}

restore_env_backup() {
  local restore_tmp
  restore_tmp=$(mktemp "$SCHOOL_ROOT/shared/.env.restore.XXXXXX") || return 1
  if ! install -m 0600 "$HOST_ENV_BACKUP" "$restore_tmp"; then
    rm -f "$restore_tmp"
    return 1
  fi
  if [ "$(sha256sum "$restore_tmp" | cut -d ' ' -f 1)" != "$ENV_BACKUP_SHA256" ]; then
    rm -f "$restore_tmp"
    return 1
  fi
  if ! chown "$ENV_UID:$ENV_GID" "$restore_tmp"; then
    rm -f "$restore_tmp"
    return 1
  fi
  if ! chmod "$ENV_MODE" "$restore_tmp"; then
    rm -f "$restore_tmp"
    return 1
  fi
  if ! mv -f "$restore_tmp" "$SCHOOL_ROOT/shared/.env"; then
    rm -f "$restore_tmp"
    return 1
  fi
  chmod "$ENV_MODE" "$SCHOOL_ROOT/shared/.env" || return 1
  [ "$(sha256sum "$SCHOOL_ROOT/shared/.env" | cut -d ' ' -f 1)" = "$ENV_BACKUP_SHA256" ]
}

restore_database_backup() {
  verify_host_sqlite "$HOST_DATABASE_BACKUP" || return 1
  [ "$(sha256sum "$HOST_DATABASE_BACKUP" | cut -d ' ' -f 1)" = "$DATABASE_BACKUP_SHA256" ] \
    || return 1

  docker run --rm \
    --network none \
    --read-only \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --volume "$DATA_VOLUME_NAME:/data" \
    --volume "$HOST_BACKUP_DIR:/restore:ro" \
    --env RESTORE_FILE=/restore/school-1-11.sqlite \
    --env TARGET_FILE="$LIVE_DATABASE_PATH" \
    --env TARGET_UID="$DATABASE_UID" \
    --env TARGET_GID="$DATABASE_GID" \
    --env TARGET_MODE="$DATABASE_MODE" \
    --env EXPECTED_SHA256="$DATABASE_BACKUP_SHA256" \
    --entrypoint /bin/sh \
    "$HELPER_IMAGE_ID" \
    -c '
      set -eu
      test -s "$RESTORE_FILE"
      test "$(sha256sum "$RESTORE_FILE" | cut -d " " -f 1)" = "$EXPECTED_SHA256"
      case "$TARGET_FILE" in
        /data/*) ;;
        *) exit 1 ;;
      esac
      restore_tmp="${TARGET_FILE}.restore"
      rm -f \
        "$restore_tmp" \
        "${TARGET_FILE}-wal" \
        "${TARGET_FILE}-shm" \
        "${TARGET_FILE}-journal"
      cp "$RESTORE_FILE" "$restore_tmp"
      chown "$TARGET_UID:$TARGET_GID" "$restore_tmp"
      chmod "$TARGET_MODE" "$restore_tmp"
      mv -f "$restore_tmp" "$TARGET_FILE"
    ' || return 1

  local restored_sha
  restored_sha=$(docker run --rm \
    --network none \
    --read-only \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --volume "$DATA_VOLUME_NAME:/data:ro" \
    --entrypoint sha256sum \
    "$HELPER_IMAGE_ID" \
    "$LIVE_DATABASE_PATH" | cut -d ' ' -f 1) || return 1
  [ "$restored_sha" = "$DATABASE_BACKUP_SHA256" ] || return 1

  docker run --rm \
    --network none \
    --read-only \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --volume "$DATA_VOLUME_NAME:/data:ro" \
    --env DATABASE_PATH="$LIVE_DATABASE_PATH" \
    --entrypoint node \
    "$HELPER_IMAGE_ID" \
    --input-type=module -e "
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
      db.exec('PRAGMA temp_store=MEMORY');
      const result = db.prepare('PRAGMA integrity_check').get();
      db.close();
      if (result.integrity_check !== 'ok') process.exit(1);
    "
}

rollback() {
  local incoming_code=$?
  local code=${1:-$incoming_code}
  if [ "$BASHPID" -ne "$DEPLOY_SHELL_PID" ]; then
    return "$code"
  fi
  trap - ERR HUP INT TERM
  set +e
  local rollback_failed=0
  local restore_allowed=1
  if [ "$ROLLBACK_ARMED" -eq 1 ] || [ "$PRE_ARM_RECOVERY" -eq 1 ]; then
    printf 'SCHOOL_ROLLBACK=STARTED\n' >&2
    if docker inspect school-1-11 >/dev/null 2>&1; then
      if ! docker stop school-1-11 >/dev/null 2>&1; then
        restore_allowed=0
        rollback_failed=1
        printf 'SCHOOL_ROLLBACK_STOP=FAILED\n' >&2
      fi
    fi
    if [ -n "$OFFLINE_BACKUP_CONTAINER" ]; then
      if docker rm -f "$OFFLINE_BACKUP_CONTAINER" >/dev/null 2>&1; then
        OFFLINE_BACKUP_CONTAINER=""
      else
        restore_allowed=0
        rollback_failed=1
        printf 'SCHOOL_ROLLBACK_BACKUP_HELPER_STOP=FAILED\n' >&2
      fi
    fi

    if [ "$restore_allowed" -eq 1 ] && [ "$ROLLBACK_ARMED" -eq 1 ]; then
      if restore_env_backup; then
        printf 'SCHOOL_ROLLBACK_ENV=RESTORED\n' >&2
      else
        rollback_failed=1
        printf 'SCHOOL_ROLLBACK_ENV=FAILED\n' >&2
      fi
      if restore_database_backup; then
        printf 'SCHOOL_ROLLBACK_DATABASE=RESTORED\n' >&2
      else
        rollback_failed=1
        printf 'SCHOOL_ROLLBACK_DATABASE=FAILED\n' >&2
      fi
    elif [ "$restore_allowed" -eq 1 ]; then
      printf 'SCHOOL_ROLLBACK_DATABASE=UNCHANGED_PRE_BACKUP\n' >&2
    fi

    if [ "$rollback_failed" -eq 0 ] \
      && [ -n "$PREVIOUS_RELEASE" ] \
      && [ -d "$PREVIOUS_RELEASE/deploy" ]; then
      if ! docker image inspect "$PREVIOUS_IMAGE_ID" >/dev/null 2>&1; then
        rollback_failed=1
      elif ! docker image tag "$PREVIOUS_IMAGE_ID" "$PREVIOUS_IMAGE_NAME"; then
        rollback_failed=1
      elif ! atomic_switch_release "$PREVIOUS_RELEASE"; then
        rollback_failed=1
      elif ! cd "$PREVIOUS_RELEASE/deploy"; then
        rollback_failed=1
      elif ! compose up -d --no-build --force-recreate school >&2; then
        rollback_failed=1
      elif ! wait_for_school_health; then
        docker logs --tail 160 school-1-11 >&2 || true
        rollback_failed=1
      elif [ "$WRITE_GATE_HELD" -eq 1 ] && ! clear_write_gate >&2; then
        rollback_failed=1
        printf 'SCHOOL_ROLLBACK_WRITE_GATE=FAILED\n' >&2
      fi
    else
      rollback_failed=1
    fi

    if [ "$rollback_failed" -eq 0 ]; then
      ROLLBACK_ARMED=0
      PRE_ARM_RECOVERY=0
      printf 'SCHOOL_ROLLBACK=FINISHED\n' >&2
    else
      printf 'SCHOOL_ROLLBACK=FAILED_MANUAL_RECOVERY_REQUIRED\n' >&2
    fi
  elif [ "$POST_COMMIT_GATE_RECOVERY" -eq 1 ]; then
    printf 'SCHOOL_POST_COMMIT_GATE_RECOVERY=STARTED\n' >&2
    if clear_write_gate >&2 && verify_public_write_gate_released >&2; then
      POST_COMMIT_GATE_RECOVERY=0
      printf 'SCHOOL_POST_COMMIT_GATE_RECOVERY=FINISHED\n' >&2
    else
      printf 'SCHOOL_POST_COMMIT_GATE_RECOVERY=FAILED_MANUAL_RECOVERY_REQUIRED\n' >&2
    fi
  fi
  printf 'SCHOOL_DEPLOY_ERROR line=%s rc=%s\n' "${BASH_LINENO[0]}" "$code" >&2
  exit "$code"
}

trap cleanup EXIT
trap 'rollback $?' ERR
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM

test "$(printf %s "$DELIVERY_REF" | wc -c)" -eq 40
printf %s "$DELIVERY_REF" | grep -Eq '^[0-9a-f]{40}$'
printf '%s' "$VERIFY_PUBLIC" | grep -Eq '^[01]$'
test -s "$SCHOOL_ROOT/shared/.env"
docker image inspect arthello-os-api:local >/dev/null
HELPER_IMAGE_ID=$(docker image inspect arthello-os-api:local --format '{{.Id}}')
printf '%s' "$HELPER_IMAGE_ID" | grep -Eq '^sha256:[0-9a-f]{64}$'
DEPLOY_LOCK_FILE="$SCHOOL_ROOT/shared/deploy.lock"
exec 9>"$DEPLOY_LOCK_FILE"
chmod 0600 "$DEPLOY_LOCK_FILE"
if ! flock -n 9; then
  printf 'SCHOOL_DEPLOY_LOCK=BUSY\n' >&2
  exit 75
fi
printf 'SCHOOL_DEPLOY_LOCK=ACQUIRED\n'
install -d -m 0755 "$SCHOOL_ROOT/releases" "$RELEASE"

if [ -n "$SOURCE_DIR" ]; then
  test -d "$SOURCE_DIR/deploy"
  cp -a "$SOURCE_DIR/." "$RELEASE/"
else
  test -s "$TOKEN_FILE"
  chmod 0600 "$CURL_CONFIG"
  {
    printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")"
    printf 'header = "X-GitHub-Api-Version: 2022-11-28"\n'
    printf 'header = "Accept: application/vnd.github+json"\n'
    printf 'proto = "=https"\n'
    printf 'tlsv1.2\n'
    printf 'location\n'
    printf 'fail\n'
    printf 'show-error\n'
  } > "$CURL_CONFIG"

  printf 'SCHOOL_DOWNLOAD=STARTED\n'
  curl --config "$CURL_CONFIG" \
    --connect-timeout 20 \
    --max-time 1200 \
    --retry 4 \
    --retry-all-errors \
    --output "$ARCHIVE" \
    "https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS/tarball/$DELIVERY_REF"
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$RELEASE"
fi

PART_COUNT=$(find "$RELEASE/deploy" -maxdepth 1 -type f -name "$RUNTIME_PART_GLOB" | wc -l)
test "$PART_COUNT" -eq 66
RUNTIME_SHA=$(cat "$RELEASE"/deploy/$RUNTIME_PART_GLOB | sha256sum | cut -d ' ' -f 1)
test "$RUNTIME_SHA" = "$RUNTIME_SHA256"
grep -Fx "$RUNTIME_SHA256  offline-runtime-v3.tar.gz" \
  "$RELEASE/deploy/offline-runtime-v3.sha256" >/dev/null
DELTA_PART_COUNT=$(find "$RELEASE/deploy" -maxdepth 1 -type f -name "$DELTA_PART_GLOB" | wc -l)
test "$DELTA_PART_COUNT" -eq 2
DELTA_SHA=$(cat "$RELEASE"/deploy/$DELTA_PART_GLOB | sha256sum | cut -d ' ' -f 1)
test "$DELTA_SHA" = "$DELTA_SHA256"
grep -Fx "$DELTA_SHA256  offline-runtime-v4-delta.tar.gz" \
  "$RELEASE/deploy/offline-runtime-v4-delta.sha256" >/dev/null
RELEASE_DELTA_PART_COUNT=$(find "$RELEASE/deploy" -maxdepth 1 -type f -name "$RELEASE_DELTA_PART_GLOB" | wc -l)
test "$RELEASE_DELTA_PART_COUNT" -eq 6
RELEASE_DELTA_SHA=$(cat "$RELEASE"/deploy/$RELEASE_DELTA_PART_GLOB | sha256sum | cut -d ' ' -f 1)
test "$RELEASE_DELTA_SHA" = "$RELEASE_DELTA_SHA256"
grep -Fx "$RELEASE_DELTA_SHA256  offline-runtime-v5-delta.tar.gz" \
  "$RELEASE/deploy/offline-runtime-v5-delta.sha256" >/dev/null

test -L "$SCHOOL_ROOT/current"
PREVIOUS_RELEASE=$(readlink -f "$SCHOOL_ROOT/current" 2>/dev/null || true)
test -n "$PREVIOUS_RELEASE"
test -d "$PREVIOUS_RELEASE/deploy"
docker inspect school-1-11 >/dev/null
PREVIOUS_IMAGE_ID=$(docker inspect school-1-11 --format '{{.Image}}')
PREVIOUS_IMAGE_NAME=$(docker inspect school-1-11 --format '{{.Config.Image}}')
printf '%s' "$PREVIOUS_IMAGE_ID" | grep -Eq '^sha256:[0-9a-f]{64}$'
test -n "$PREVIOUS_IMAGE_NAME"
case "$PREVIOUS_IMAGE_NAME" in
  sha256:*) printf 'SCHOOL_ROLLBACK_IMAGE_NAME_INVALID=%s\n' "$PREVIOUS_IMAGE_NAME" >&2; false ;;
esac
docker image inspect "$PREVIOUS_IMAGE_ID" >/dev/null

LIVE_DATABASE_PATH=$(docker exec school-1-11 node -e \
  'process.stdout.write(process.env.DATABASE_PATH || "/data/school-1-11.sqlite")')
if [ "$LIVE_DATABASE_PATH" != /data/school-1-11.sqlite ]; then
  printf 'SCHOOL_BACKUP_INVALID_DATABASE_PATH=%s\n' "$LIVE_DATABASE_PATH" >&2
  false
fi
docker exec school-1-11 test -s "$LIVE_DATABASE_PATH"

DATA_VOLUME_NAME=$(docker inspect school-1-11 \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
BACKUPS_VOLUME_NAME=$(docker inspect school-1-11 \
  --format '{{range .Mounts}}{{if eq .Destination "/backups"}}{{.Name}}{{end}}{{end}}')
test -n "$DATA_VOLUME_NAME"
test -n "$BACKUPS_VOLUME_NAME"
docker volume inspect "$DATA_VOLUME_NAME" >/dev/null
docker volume inspect "$BACKUPS_VOLUME_NAME" >/dev/null

DATA_VOLUME_MOUNTPOINT=$(docker volume inspect "$DATA_VOLUME_NAME" --format '{{.Mountpoint}}')
BACKUPS_VOLUME_MOUNTPOINT=$(docker volume inspect "$BACKUPS_VOLUME_NAME" --format '{{.Mountpoint}}')
HOST_BACKUP_ROOT_REAL=$(realpath -m "$HOST_BACKUP_ROOT")
case "$HOST_BACKUP_ROOT_REAL/" in
  "$DATA_VOLUME_MOUNTPOINT/"*|"$BACKUPS_VOLUME_MOUNTPOINT/"*)
    printf 'SCHOOL_BACKUP_HOST_PATH_INSIDE_DOCKER_VOLUME=%s\n' "$HOST_BACKUP_ROOT_REAL" >&2
    false
    ;;
esac

DATABASE_META=$(docker exec school-1-11 stat -c '%u %g %a' "$LIVE_DATABASE_PATH")
read -r DATABASE_UID DATABASE_GID DATABASE_MODE <<<"$DATABASE_META"
printf '%s' "$DATABASE_UID" | grep -Eq '^[0-9]+$'
printf '%s' "$DATABASE_GID" | grep -Eq '^[0-9]+$'
printf '%s' "$DATABASE_MODE" | grep -Eq '^[0-7]{3,4}$'

BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)-${DELIVERY_REF:0:12}"
install -d -m 0700 "$HOST_BACKUP_ROOT_REAL"
HOST_BACKUP_DIR=$(mktemp -d "$HOST_BACKUP_ROOT_REAL/$BACKUP_ID.XXXXXX")
chmod 0700 "$HOST_BACKUP_DIR"
HOST_DATABASE_BACKUP="$HOST_BACKUP_DIR/school-1-11.sqlite"
HOST_ENV_BACKUP="$HOST_BACKUP_DIR/shared.env"

ENV_META=$(stat -c '%u %g %a' "$SCHOOL_ROOT/shared/.env")
read -r ENV_UID ENV_GID ENV_MODE <<<"$ENV_META"
printf '%s' "$ENV_UID" | grep -Eq '^[0-9]+$'
printf '%s' "$ENV_GID" | grep -Eq '^[0-9]+$'
printf '%s' "$ENV_MODE" | grep -Eq '^[0-7]{3,4}$'
install -m 0600 "$SCHOOL_ROOT/shared/.env" "$HOST_ENV_BACKUP"
ENV_BACKUP_SHA256=$(sha256sum "$HOST_ENV_BACKUP" | cut -d ' ' -f 1)
test -n "$ENV_BACKUP_SHA256"

cd "$RELEASE/deploy"
compose_private config >/dev/null
compose_private build school
CANDIDATE_IMAGE_ID=$(docker image inspect "$PREVIOUS_IMAGE_NAME" --format '{{.Id}}')
printf '%s' "$CANDIDATE_IMAGE_ID" | grep -Eq '^sha256:[0-9a-f]{64}$'
printf 'SCHOOL_CANDIDATE_BUILD=VERIFIED\n'

PRE_ARM_RECOVERY=1
docker stop --time 30 school-1-11 >/dev/null
test "$(docker inspect school-1-11 --format '{{.State.Running}}')" = false
printf 'SCHOOL_WRITES=QUIESCED\n'

WRITE_GATE_HELD=1
create_write_gate

OFFLINE_BACKUP_CONTAINER="school-offline-backup-${DELIVERY_REF:0:12}-$$"
BACKUP_OUTPUT=$(docker run \
  --name "$OFFLINE_BACKUP_CONTAINER" \
  --network none \
  --read-only \
  --user 0:0 \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --volume "$DATA_VOLUME_NAME:/data" \
  --volume "$HOST_BACKUP_DIR:/host-backup" \
  --env DATABASE_PATH="$LIVE_DATABASE_PATH" \
  --env BACKUP_DIR=/host-backup \
  --entrypoint node \
  "$CANDIDATE_IMAGE_ID" \
  scripts/backup-db.mjs)
printf '%s\n' "$BACKUP_OUTPUT"
CONTAINER_DATABASE_BACKUP=$(printf '%s\n' "$BACKUP_OUTPUT" \
  | sed -n '/^\/host-backup\/school-1-11-.*\.sqlite$/p' \
  | tail -n 1)
test -n "$CONTAINER_DATABASE_BACKUP"
docker rm "$OFFLINE_BACKUP_CONTAINER" >/dev/null
OFFLINE_BACKUP_CONTAINER=""
OFFLINE_BACKUP_BASENAME=${CONTAINER_DATABASE_BACKUP##*/}
OFFLINE_HOST_DATABASE_BACKUP="$HOST_BACKUP_DIR/$OFFLINE_BACKUP_BASENAME"
test -s "$OFFLINE_HOST_DATABASE_BACKUP"
mv "$OFFLINE_HOST_DATABASE_BACKUP" "$HOST_DATABASE_BACKUP.tmp"
chmod 0600 "$HOST_DATABASE_BACKUP.tmp"
mv "$HOST_DATABASE_BACKUP.tmp" "$HOST_DATABASE_BACKUP"
verify_host_sqlite "$HOST_DATABASE_BACKUP"
DATABASE_BACKUP_SHA256=$(sha256sum "$HOST_DATABASE_BACKUP" | cut -d ' ' -f 1)
test -n "$DATABASE_BACKUP_SHA256"
DATABASE_BACKUP_SIZE=$(stat -c '%s' "$HOST_DATABASE_BACKUP")
ENV_BACKUP_SIZE=$(stat -c '%s' "$HOST_ENV_BACKUP")
printf '%s' "$DATABASE_BACKUP_SIZE" | grep -Eq '^[1-9][0-9]*$'
printf '%s' "$ENV_BACKUP_SIZE" | grep -Eq '^[1-9][0-9]*$'

{
  printf 'delivery_ref=%s\n' "$DELIVERY_REF"
  printf 'previous_release=%s\n' "$PREVIOUS_RELEASE"
  printf 'database_path=%s\n' "$LIVE_DATABASE_PATH"
  printf 'data_volume=%s\n' "$DATA_VOLUME_NAME"
  printf 'container_backup=%s\n' "$CONTAINER_DATABASE_BACKUP"
  printf 'database_sha256=%s\n' "$DATABASE_BACKUP_SHA256"
  printf 'database_size=%s\n' "$DATABASE_BACKUP_SIZE"
  printf 'database_uid=%s\n' "$DATABASE_UID"
  printf 'database_gid=%s\n' "$DATABASE_GID"
  printf 'database_mode=%s\n' "$DATABASE_MODE"
  printf 'env_sha256=%s\n' "$ENV_BACKUP_SHA256"
  printf 'env_size=%s\n' "$ENV_BACKUP_SIZE"
  printf 'env_uid=%s\n' "$ENV_UID"
  printf 'env_gid=%s\n' "$ENV_GID"
  printf 'env_mode=%s\n' "$ENV_MODE"
  printf 'helper_image_id=%s\n' "$HELPER_IMAGE_ID"
  printf 'previous_image_id=%s\n' "$PREVIOUS_IMAGE_ID"
  printf 'previous_image_name=%s\n' "$PREVIOUS_IMAGE_NAME"
  printf 'candidate_image_id=%s\n' "$CANDIDATE_IMAGE_ID"
  printf 'write_gate_path=%s\n' "$WRITE_GATE_PATH"
} > "$HOST_BACKUP_DIR/manifest.tmp"
chmod 0600 "$HOST_BACKUP_DIR/manifest.tmp"
mv "$HOST_BACKUP_DIR/manifest.tmp" "$HOST_BACKUP_DIR/manifest"
sync -f "$HOST_DATABASE_BACKUP"
sync -f "$HOST_ENV_BACKUP"
sync -f "$HOST_BACKUP_DIR/manifest"
sync -f "$HOST_BACKUP_DIR"

printf 'SCHOOL_BACKUP=VERIFIED\n'
printf 'SCHOOL_BACKUP_DATABASE_SHA256=%s\n' "$DATABASE_BACKUP_SHA256"
printf 'SCHOOL_BACKUP_ENV_SHA256=%s\n' "$ENV_BACKUP_SHA256"
printf 'SCHOOL_BACKUP_HOST_DIR=%s\n' "$HOST_BACKUP_DIR"

ROLLBACK_ARMED=1
PRE_ARM_RECOVERY=0
ENV_UPDATE_TMP=$(mktemp "$SCHOOL_ROOT/shared/.env.next.XXXXXX")
python3 - "$SCHOOL_ROOT/shared/.env" "$ENV_UPDATE_TMP" "https://$SCHOOL_HOST" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
output = Path(sys.argv[2])
origin = sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines()
result = []
found = False
for line in lines:
    if line.startswith("PUBLIC_APP_ORIGIN="):
        result.append(f"PUBLIC_APP_ORIGIN={origin}")
        found = True
    else:
        result.append(line)
if not found:
    result.append(f"PUBLIC_APP_ORIGIN={origin}")
output.write_text("\n".join(result) + "\n", encoding="utf-8")
PY
chown "$ENV_UID:$ENV_GID" "$ENV_UPDATE_TMP"
chmod "$ENV_MODE" "$ENV_UPDATE_TMP"
mv -f "$ENV_UPDATE_TMP" "$SCHOOL_ROOT/shared/.env"
ENV_UPDATE_TMP=""

atomic_switch_release "$RELEASE"
SWITCHED=1
cd "$SCHOOL_ROOT/current/deploy"
compose_private config >/dev/null
compose_private up -d --no-build --force-recreate school

test -z "$(public_network_state)"
printf 'SCHOOL_CANDIDATE_ROUTING=PRIVATE\n'

SCHOOL_STATUS=unknown
for attempt in $(seq 1 90); do
  SCHOOL_STATUS=$(docker inspect \
    -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    school-1-11 2>/dev/null || true)
  [ "$SCHOOL_STATUS" = healthy ] && break
  [ "$SCHOOL_STATUS" = unhealthy ] && break
  sleep 2
done

if [ "$SCHOOL_STATUS" != healthy ]; then
  docker logs --tail 160 school-1-11 >&2
  false
fi

docker exec school-1-11 node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

docker exec school-1-11 test -f "$WRITE_GATE_PATH"
verify_private_write_gate
attach_public_network
verify_public_write_gate

SCHEDULE_IMPORT_OUTPUT=$(docker exec school-1-11 \
  node scripts/import-school-schedule.mjs \
  data/schedules/school-1-11-2026-2027.json 2>&1)
printf '%s\n' "$SCHEDULE_IMPORT_OUTPUT"
printf '%s\n' "$SCHEDULE_IMPORT_OUTPUT" \
  | grep -Eq '^SCHOOL_SCHEDULE_IMPORT=(SUCCESS|ALREADY_APPLIED)$'

docker exec school-1-11 node --input-type=module -e "
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync(process.env.DATABASE_PATH);
  const rows = db.prepare(\`
    SELECT class_name AS className, COUNT(*) AS lessonCount
    FROM lessons
    WHERE id LIKE 'schedule-2026-2027-%'
      AND status NOT IN ('archived', 'cancelled')
    GROUP BY class_name ORDER BY CAST(class_name AS INTEGER)
  \`).all();
  const expected = JSON.stringify([
    { className: '1', lessonCount: 41 },
    { className: '2', lessonCount: 28 },
    { className: '3', lessonCount: 29 },
    { className: '4', lessonCount: 29 },
    { className: '5', lessonCount: 31 },
    { className: '6', lessonCount: 31 },
  ]);
  if (JSON.stringify(rows) !== expected) {
    console.error('SCHOOL_SCHEDULE_VERIFY=FAILED');
    console.error(JSON.stringify(rows));
    process.exit(1);
  }
  const mathDays = db.prepare(\`
    SELECT COUNT(DISTINCT weekday) AS count
    FROM lessons
    WHERE class_name = '2' AND subject_id = 'math'
      AND id LIKE 'schedule-2026-2027-%'
      AND status NOT IN ('archived', 'cancelled')
  \`).get().count;
  if (mathDays !== 5) process.exit(1);
  console.log('SCHOOL_SCHEDULE_VERIFY=SUCCESS');
  console.log('SCHOOL_SCHEDULE_CLASS_COUNTS=1:41,2:28,3:29,4:29,5:31,6:31');
  console.log('SCHOOL_SCHEDULE_MATH_2_WEEKDAYS=5');
"

CURRICULUM_IMPORT_OUTPUT=$(docker exec school-1-11 \
  node scripts/import-school-curriculum.mjs \
  data/curricula/school-1-11-2-math-2026-2027.json 2>&1)
printf '%s\n' "$CURRICULUM_IMPORT_OUTPUT"
printf '%s\n' "$CURRICULUM_IMPORT_OUTPUT" \
  | grep -Eq '^SCHOOL_CALENDAR_IMPORT=(SUCCESS|ALREADY_APPLIED)$'
printf '%s\n' "$CURRICULUM_IMPORT_OUTPUT" \
  | grep -Eq '^SCHOOL_CURRICULUM_IMPORT=(SUCCESS|ALREADY_APPLIED)$'

docker exec school-1-11 node --input-type=module -e "
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
  const expectedTeacherId = 'teacher-nasyrova';
  const expectedCalendar = [
    {
      id: 'vacation-autumn-2026',
      kind: 'vacation',
      title: 'Осенние каникулы',
      startsOn: '2026-10-26',
      endsOn: '2026-11-03',
    },
    {
      id: 'vacation-february-2027',
      kind: 'vacation',
      title: 'Дополнительные каникулы',
      startsOn: '2027-02-15',
      endsOn: '2027-02-21',
    },
    {
      id: 'vacation-spring-2027',
      kind: 'vacation',
      title: 'Весенние каникулы',
      startsOn: '2027-03-27',
      endsOn: '2027-04-04',
    },
    {
      id: 'vacation-winter-2026',
      kind: 'vacation',
      title: 'Зимние каникулы',
      startsOn: '2026-12-31',
      endsOn: '2027-01-10',
    },
  ];
  const calendar = db.prepare(\`
    SELECT id, kind, title, starts_on AS startsOn, ends_on AS endsOn
    FROM academic_calendar_periods
    WHERE academic_year = '2026/27' AND kind = 'vacation'
    ORDER BY id
  \`).all();
  if (JSON.stringify(calendar) !== JSON.stringify(expectedCalendar)) {
    console.error('SCHOOL_CALENDAR_VERIFY=FAILED');
    console.error(JSON.stringify(calendar));
    process.exit(1);
  }

  const program = db.prepare(\`
    SELECT id, academic_year AS academicYear, class_name AS className,
      subject_id AS subjectId, teacher_user_id AS teacherUserId,
      status, planned_lessons AS plannedLessons
    FROM programs
    WHERE academic_year = '2026/27' AND class_name = '2'
      AND subject_id = 'math' AND teacher_user_id = ?
  \`).get(expectedTeacherId);
  const validProgramStatuses = new Set([
    'draft',
    'review',
    'changes_requested',
    'approved',
    'active',
    'archived',
  ]);
  const expectedProgram = {
    id: program?.id,
    academicYear: '2026/27',
    className: '2',
    subjectId: 'math',
    teacherUserId: expectedTeacherId,
    plannedLessons: 170,
  };
  const immutableProgram = program && {
    id: program.id,
    academicYear: program.academicYear,
    className: program.className,
    subjectId: program.subjectId,
    teacherUserId: program.teacherUserId,
    plannedLessons: program.plannedLessons,
  };
  if (
    !program ||
    !validProgramStatuses.has(program.status) ||
    JSON.stringify(immutableProgram) !== JSON.stringify(expectedProgram)
  ) {
    console.error('SCHOOL_CURRICULUM_PROGRAM_VERIFY=FAILED');
    console.error(JSON.stringify(program));
    process.exit(1);
  }

  const assignment = db.prepare(\`
    SELECT COUNT(*) AS count
    FROM teacher_assignments
    WHERE teacher_user_id = ? AND class_name = '2' AND subject_id = 'math'
      AND status = 'confirmed'
  \`).get(expectedTeacherId).count;
  const mathTemplates = db.prepare(\`
    SELECT COUNT(*) AS lessons, COUNT(DISTINCT weekday) AS weekdays,
      COUNT(DISTINCT teacher_user_id) AS teachers,
      MIN(teacher_user_id) AS teacherId, MAX(teacher_user_id) AS lastTeacherId
    FROM lessons
    WHERE class_name = '2' AND subject_id = 'math'
      AND id LIKE 'schedule-2026-2027-%'
      AND status NOT IN ('archived', 'cancelled')
  \`).get();
  if (
    assignment !== 1 ||
    mathTemplates.lessons !== 5 ||
    mathTemplates.weekdays !== 5 ||
    mathTemplates.teachers !== 1 ||
    mathTemplates.teacherId !== expectedTeacherId ||
    mathTemplates.lastTeacherId !== expectedTeacherId
  ) {
    console.error('SCHOOL_CURRICULUM_TEACHER_VERIFY=FAILED');
    console.error(JSON.stringify({ assignment, mathTemplates }));
    process.exit(1);
  }

  const expectedReleaseImportId = 'program-import-1d6f9925b3d80060ad46323f';
  const imported = db.prepare(\`
    SELECT id AS importId, imported_by_user_id AS importedBy,
      row_count AS rows, required_hours AS requiredHours,
      available_slots AS availableSlots,
      scheduled_hours AS scheduledHours,
      unscheduled_hours AS unscheduledHours,
      validation_status AS validationStatus
    FROM program_imports
    WHERE id = ? AND program_id = ?
  \`).get(expectedReleaseImportId, program.id);
  const curriculum = db.prepare(\`
    SELECT COUNT(DISTINCT pt.id) AS topics,
      COALESCE(SUM(pt.planned_hours), 0) AS hours,
      MIN(pt.sort_order) AS firstTopic, MAX(pt.sort_order) AS lastTopic,
      COUNT(ps.id) AS sessions,
      COUNT(DISTINCT ps.scheduled_date) AS distinctDates,
      SUM(CASE WHEN ps.scheduled_date IS NULL THEN 1 ELSE 0 END) AS unscheduled,
      MIN(ps.scheduled_date) AS firstDate,
      MAX(ps.scheduled_date) AS lastDate
    FROM program_topics pt
    LEFT JOIN program_topic_sessions ps ON ps.topic_id = pt.id
    WHERE pt.program_id = ?
  \`).get(program.id);
  const vacationSessions = db.prepare(\`
    SELECT COUNT(*) AS count
    FROM program_topic_sessions ps
    JOIN academic_calendar_periods ap
      ON ps.scheduled_date BETWEEN ap.starts_on AND ap.ends_on
    WHERE ps.program_id = ?
      AND ap.academic_year = '2026/27'
      AND ap.kind IN ('vacation', 'holiday', 'non_instruction')
  \`).get(program.id).count;
  const reserveSessions = db.prepare(\`
    SELECT COUNT(*) AS count FROM program_topic_sessions
    WHERE program_id = ?
      AND scheduled_date = '2027-05-31'
  \`).get(program.id).count;
  const expectedImport = {
    importId: expectedReleaseImportId,
    importedBy: expectedTeacherId,
    rows: 170,
    requiredHours: 170,
    availableSlots: 171,
    scheduledHours: 170,
    unscheduledHours: 0,
    validationStatus: 'reserve',
  };
  const expectedCurriculum = {
    topics: 170,
    hours: 170,
    firstTopic: 1,
    lastTopic: 170,
    sessions: 170,
    distinctDates: 170,
    unscheduled: 0,
    firstDate: '2026-09-01',
    lastDate: '2027-05-28',
  };
  if (
    JSON.stringify(imported) !== JSON.stringify(expectedImport) ||
    JSON.stringify(curriculum) !== JSON.stringify(expectedCurriculum) ||
    vacationSessions !== 0 ||
    reserveSessions !== 0
  ) {
    console.error('SCHOOL_CURRICULUM_VERIFY=FAILED');
    console.error(JSON.stringify({ imported, curriculum, vacationSessions, reserveSessions }));
    process.exit(1);
  }
  db.close();
  console.log('SCHOOL_CALENDAR_VERIFY=SUCCESS');
  console.log('SCHOOL_CALENDAR_PERIODS=4');
  console.log('SCHOOL_CURRICULUM_VERIFY=SUCCESS');
  console.log('SCHOOL_CURRICULUM_TEACHER_USER_ID=' + expectedTeacherId);
  console.log('SCHOOL_CURRICULUM_STATUS=' + program.status);
  console.log('SCHOOL_CURRICULUM_TOPICS=170');
  console.log('SCHOOL_CURRICULUM_HOURS=170');
  console.log('SCHOOL_CURRICULUM_SESSIONS=170');
  console.log('SCHOOL_CURRICULUM_FIRST_DATE=2026-09-01');
  console.log('SCHOOL_CURRICULUM_LAST_DATE=2027-05-28');
  console.log('SCHOOL_CURRICULUM_RESERVE_DATE=2027-05-31');
"

if [ "$VERIFY_PUBLIC" -eq 0 ]; then
  printf 'SCHOOL_PUBLIC_VERIFY=ENFORCED_FOR_ROLLBACK\n'
fi
verify_public_release

verify_host_sqlite "$HOST_DATABASE_BACKUP"
test "$(sha256sum "$HOST_DATABASE_BACKUP" | cut -d ' ' -f 1)" = "$DATABASE_BACKUP_SHA256"
test "$(sha256sum "$HOST_ENV_BACKUP" | cut -d ' ' -f 1)" = "$ENV_BACKUP_SHA256"

POST_COMMIT_GATE_RECOVERY=1
ROLLBACK_ARMED=0
printf 'SCHOOL_DEPLOY_COMMIT=DATABASE_ROLLBACK_DISARMED\n'
clear_write_gate
verify_public_write_gate_released
POST_COMMIT_GATE_RECOVERY=0
SWITCHED=0
printf 'SCHOOL_DEPLOY=SUCCESS\n'
printf 'SCHOOL_DELIVERY_REF=%s\n' "$DELIVERY_REF"
printf 'SCHOOL_RUNTIME_SHA=%s\n' "$RUNTIME_SHA"
printf 'SCHOOL_DELTA_SHA=%s\n' "$DELTA_SHA"
printf 'SCHOOL_RELEASE_DELTA_SHA=%s\n' "$RELEASE_DELTA_SHA"
printf 'SCHOOL_BACKUP=VERIFIED\n'
printf 'SCHOOL_BACKUP_DATABASE_SHA256=%s\n' "$DATABASE_BACKUP_SHA256"
printf 'SCHOOL_BACKUP_ENV_SHA256=%s\n' "$ENV_BACKUP_SHA256"
printf 'SCHOOL_BACKUP_HOST_DIR=%s\n' "$HOST_BACKUP_DIR"
printf 'SCHOOL_DATA_VOLUME=PRESERVED\n'
printf 'SCHOOL_PUBLIC_URL=https://%s\n' "$SCHOOL_HOST"
