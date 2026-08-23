#!/usr/bin/env bash

set -Eeuo pipefail

SCHOOL_ROOT=${SCHOOL_ROOT:-/srv/school-1-11}
SCHOOL_HOST=${SCHOOL_HOST:-school-188-225-47-207.nip.io}
TOKEN_FILE=${TOKEN_FILE:-/srv/arthello/shared/github-https/token}
DELIVERY_REF=${DELIVERY_REF:-2bd115b3ae0a538e45a1d4b4d87504fab2fea03a}
RUNTIME_SHA256=a226213f1e04588560939d3682cf39652c7b8318fd0f2e03e2b5f4396c052fd5
ARTHELLO_WEB_CONTAINER=${ARTHELLO_WEB_CONTAINER:-arthello-os-web-1}

ARCHIVE=$(mktemp /tmp/school-repair.XXXXXX.tar.gz)
CURL_CONFIG=$(mktemp /tmp/school-curl.XXXXXX)
RELEASE="$SCHOOL_ROOT/releases/repair-$(date +%Y%m%d%H%M%S)"
PART_FIX=$(mktemp /tmp/school-part-022.XXXXXX)

cleanup() {
  rm -f "$ARCHIVE" "$CURL_CONFIG" "$PART_FIX"
}

on_error() {
  local code=$?
  echo
  echo "SCHOOL_REPAIR_ERROR: строка ${BASH_LINENO[0]}, код $code"
  exit "$code"
}

trap cleanup EXIT
trap on_error ERR

test -s "$TOKEN_FILE"
test -s "$SCHOOL_ROOT/shared/.env"
docker inspect "$ARTHELLO_WEB_CONTAINER" >/dev/null

chmod 0600 "$CURL_CONFIG"
{
  printf 'header = "Authorization: Bearer %s"\n' "$(cat "$TOKEN_FILE")"
  printf 'header = "X-GitHub-Api-Version: 2022-11-28"\n'
  printf 'header = "Accept: application/vnd.github+json"\n'
  printf 'proto = "=https"\n'
  printf 'tlsv1.2\n'
  printf 'location\n'
  printf 'fail\n'
  printf 'show-error\n'
} > "$CURL_CONFIG"

PREVIOUS_RELEASE=$(find "$SCHOOL_ROOT/releases" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -name 'repair-*' \
  -print | sort | tail -1)

PREVIOUS_PARTS_COUNT=0
if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE/deploy" ]; then
  PREVIOUS_PARTS_COUNT=$(find "$PREVIOUS_RELEASE/deploy" \
    -maxdepth 1 \
    -name 'offline-runtime-v2.part-*' \
    -type f 2>/dev/null | wc -l)
fi

if [ "$PREVIOUS_PARTS_COUNT" -eq 68 ]; then
  RELEASE=$PREVIOUS_RELEASE
  echo "1/5 Загружаем только исправленный фрагмент runtime №22..."
  curl --config "$CURL_CONFIG" \
    --header "Accept: application/vnd.github.raw+json" \
    --progress-bar \
    --connect-timeout 20 \
    --max-time 180 \
    --retry 3 \
    --retry-all-errors \
    --output "$PART_FIX" \
    "https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS/contents/deploy/offline-runtime-v2.part-022?ref=$DELIVERY_REF"
  test "$(wc -c < "$PART_FIX")" -eq 716800
  mv -f "$PART_FIX" "$RELEASE/deploy/offline-runtime-v2.part-022"
else
  echo "1/5 Скачиваем исправленный пакет дневника (прогресс виден ниже)..."
  curl --config "$CURL_CONFIG" \
    --progress-bar \
    --connect-timeout 20 \
    --max-time 900 \
    --retry 3 \
    --retry-all-errors \
    --output "$ARCHIVE" \
    "https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS/tarball/$DELIVERY_REF"

  install -d -m 0755 "$RELEASE"
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$RELEASE"
fi

echo "2/5 Проверяем весь пакет..."

PARTS_COUNT=$(find "$RELEASE/deploy" \
  -maxdepth 1 \
  -name 'offline-runtime-v2.part-*' \
  -type f | wc -l)
test "$PARTS_COUNT" -eq 68

RUNTIME_SHA=$(cat "$RELEASE"/deploy/offline-runtime-v2.part-* | sha256sum | cut -d ' ' -f 1)
test "$RUNTIME_SHA" = "$RUNTIME_SHA256"

ln -sfn "$RELEASE" "$SCHOOL_ROOT/current"

echo "3/5 Пересоздаём только контейнер дневника..."
cd "$SCHOOL_ROOT/current/deploy"
docker compose \
  --env-file "$SCHOOL_ROOT/shared/.env" \
  -p school-1-11 \
  -f docker-compose.yml \
  -f compose.offline.yml \
  up -d --build --force-recreate

SCHOOL_STATUS=unknown
for _attempt in $(seq 1 60); do
  SCHOOL_STATUS=$(docker inspect \
    -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    school-1-11 2>/dev/null || true)

  [ "$SCHOOL_STATUS" = healthy ] && break
  [ "$SCHOOL_STATUS" = unhealthy ] && break
  sleep 2
done

if [ "$SCHOOL_STATUS" != healthy ]; then
  docker logs --tail 120 school-1-11
  exit 1
fi

docker exec school-1-11 node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

echo "4/5 Подключаем дневник к действующему Caddy..."
CADDY_FILE=/srv/arthello/shared/Caddyfile.school-runtime
docker cp "$ARTHELLO_WEB_CONTAINER:/etc/caddy/Caddyfile" "$CADDY_FILE"

if ! grep -q "^${SCHOOL_HOST} {" "$CADDY_FILE"; then
  cat >> "$CADDY_FILE" <<'CADDY'

school-188-225-47-207.nip.io {
  encode zstd gzip

  header {
    -Server
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    X-Frame-Options "DENY"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"
  }

  reverse_proxy school-1-11:3000
}
CADDY
fi

docker cp "$CADDY_FILE" "$ARTHELLO_WEB_CONTAINER:/tmp/Caddyfile.school"
docker exec "$ARTHELLO_WEB_CONTAINER" \
  caddy validate --config /tmp/Caddyfile.school
docker cp "$CADDY_FILE" "$ARTHELLO_WEB_CONTAINER:/etc/caddy/Caddyfile"
docker exec "$ARTHELLO_WEB_CONTAINER" \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

echo "5/5 Проверяем HTTPS..."
curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 180 \
  --retry 30 \
  --retry-all-errors \
  --retry-delay 3 \
  "https://${SCHOOL_HOST}/api/health"
echo

echo "ГОТОВО: https://${SCHOOL_HOST}"
docker ps --filter name=school-1-11 --filter name="$ARTHELLO_WEB_CONTAINER"
