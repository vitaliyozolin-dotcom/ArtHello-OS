#!/usr/bin/env bash

set -Eeuo pipefail

SCHOOL_HOST=${SCHOOL_HOST:-school-188-225-47-207.sslip.io}
SCHOOL_CONTAINER=${SCHOOL_CONTAINER:-school-1-11}
ARTHELLO_WEB_CONTAINER=${ARTHELLO_WEB_CONTAINER:-arthello-os-web-1}
CADDY_FILE=/srv/arthello/shared/Caddyfile.school-runtime

on_error() {
  local code=$?
  echo
  echo "SCHOOL_FINISH_ERROR: строка ${BASH_LINENO[0]}, код $code"
  echo "Последние строки дневника:"
  docker logs --tail 80 "$SCHOOL_CONTAINER" 2>/dev/null || true
  echo "Последние строки Caddy:"
  docker logs --tail 80 "$ARTHELLO_WEB_CONTAINER" 2>/dev/null || true
  exit "$code"
}

trap on_error ERR

echo "1/3 Проверяем уже запущенный дневник..."
test "$(docker inspect \
  -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
  "$SCHOOL_CONTAINER")" = healthy

docker exec "$SCHOOL_CONTAINER" node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

SCHOOL_NETWORKS=$(docker inspect \
  -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
  "$SCHOOL_CONTAINER" | sort)
WEB_NETWORKS=$(docker inspect \
  -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
  "$ARTHELLO_WEB_CONTAINER" | sort)
SHARED_NETWORK=$(comm -12 \
  <(printf '%s\n' "$SCHOOL_NETWORKS") \
  <(printf '%s\n' "$WEB_NETWORKS") | head -1)
test -n "$SHARED_NETWORK"

echo "2/3 Подключаем маршрут к действующему Caddy..."
docker cp "$ARTHELLO_WEB_CONTAINER:/etc/caddy/Caddyfile" "$CADDY_FILE"

if ! grep -q "^${SCHOOL_HOST} {" "$CADDY_FILE"; then
  cat >> "$CADDY_FILE" <<'CADDY'

school-188-225-47-207.sslip.io {
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

echo "3/3 Проверяем HTTPS..."
curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 180 \
  --retry 30 \
  --retry-all-errors \
  --retry-delay 3 \
  "https://${SCHOOL_HOST}/api/health"
echo

echo "ГОТОВО: https://${SCHOOL_HOST}"
docker ps --filter name="$SCHOOL_CONTAINER" --filter name="$ARTHELLO_WEB_CONTAINER"
