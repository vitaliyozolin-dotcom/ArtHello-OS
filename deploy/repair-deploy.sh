#!/usr/bin/env bash

set -Eeuo pipefail

SCHOOL_ROOT=${SCHOOL_ROOT:-/srv/school-1-11}
SCHOOL_HOST=${SCHOOL_HOST:-school-188-225-38-55.sslip.io}
TOKEN_FILE=${TOKEN_FILE:-/srv/arthello/shared/github-https/token}
DELIVERY_REF=${DELIVERY_REF:?DELIVERY_REF must be the immutable Git commit SHA}
SOURCE_DIR=${SOURCE_DIR:-}
VERIFY_PUBLIC=${VERIFY_PUBLIC:-1}
RUNTIME_SHA256=9125b43319706f4bf3a9a45813b50a0495e61bef5b73f3305a1b97717406b349
RUNTIME_PART_GLOB=offline-runtime-v3.part-\*
DELTA_SHA256=84a453f982dd99cec14ec2ebc7a05c0cfd319d8b3ec9bf47a1da79bc6801554b
DELTA_PART_GLOB=offline-runtime-v4-delta.part-\*

ARCHIVE=$(mktemp /tmp/school-release.XXXXXX.tar.gz)
CURL_CONFIG=$(mktemp /tmp/school-release-curl.XXXXXX)
RELEASE="$SCHOOL_ROOT/releases/school-$(date -u +%Y%m%dT%H%M%SZ)-${DELIVERY_REF:0:12}"
PREVIOUS_RELEASE=""
SWITCHED=0

cleanup() {
  rm -f "$ARCHIVE" "$CURL_CONFIG"
}

compose() {
  docker compose \
    --env-file "$SCHOOL_ROOT/shared/.env" \
    -p school-1-11 \
    -f docker-compose.yml \
    -f compose.offline.yml \
    "$@"
}

rollback() {
  local code=$?
  trap - ERR
  if [ "$SWITCHED" -eq 1 ] && [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE/deploy" ]; then
    printf 'SCHOOL_ROLLBACK=STARTED\n' >&2
    ln -sfn "$PREVIOUS_RELEASE" "$SCHOOL_ROOT/current"
    cd "$PREVIOUS_RELEASE/deploy"
    compose build school >&2 || true
    compose up -d --no-build --force-recreate school >&2 || true
    printf 'SCHOOL_ROLLBACK=FINISHED\n' >&2
  fi
  printf 'SCHOOL_DEPLOY_ERROR line=%s rc=%s\n' "${BASH_LINENO[0]}" "$code" >&2
  exit "$code"
}

trap cleanup EXIT
trap rollback ERR

test "$(printf %s "$DELIVERY_REF" | wc -c)" -eq 40
printf %s "$DELIVERY_REF" | grep -Eq '^[0-9a-f]{40}$'
test -s "$SCHOOL_ROOT/shared/.env"
docker image inspect arthello-os-api:local >/dev/null
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

PREVIOUS_RELEASE=$(readlink -f "$SCHOOL_ROOT/current" 2>/dev/null || true)
if docker inspect school-1-11 >/dev/null 2>&1; then
  docker exec school-1-11 node scripts/backup-db.mjs
fi

python3 - "$SCHOOL_ROOT/shared/.env" "https://$SCHOOL_HOST" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
origin = sys.argv[2]
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
path.write_text("\n".join(result) + "\n", encoding="utf-8")
PY
chmod 0600 "$SCHOOL_ROOT/shared/.env"

ln -sfn "$RELEASE" "$SCHOOL_ROOT/current"
SWITCHED=1
cd "$SCHOOL_ROOT/current/deploy"
compose config >/dev/null
compose build school
compose up -d --no-build --force-recreate school

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

if [ "$VERIFY_PUBLIC" -eq 1 ]; then
  curl --fail --silent --show-error \
    --connect-timeout 10 \
    --max-time 180 \
    --retry 30 \
    --retry-all-errors \
    --retry-delay 3 \
    "https://$SCHOOL_HOST/api/health"
  printf '\n'
fi

SWITCHED=0
printf 'SCHOOL_DEPLOY=SUCCESS\n'
printf 'SCHOOL_DELIVERY_REF=%s\n' "$DELIVERY_REF"
printf 'SCHOOL_RUNTIME_SHA=%s\n' "$RUNTIME_SHA"
printf 'SCHOOL_DELTA_SHA=%s\n' "$DELTA_SHA"
printf 'SCHOOL_BACKUP=CREATED\n'
printf 'SCHOOL_DATA_VOLUME=PRESERVED\n'
printf 'SCHOOL_PUBLIC_URL=https://%s\n' "$SCHOOL_HOST"
