#!/usr/bin/env bash

set -Eeuo pipefail

SCHOOL_HOST=${SCHOOL_HOST:-school-188-225-47-207.nip.io}
OLD_SCHOOL_HOST=${OLD_SCHOOL_HOST:-school-188-225-47-207.sslip.io}
SCHOOL_IP=${SCHOOL_IP:-188.225.47.207}
SCHOOL_ROOT=${SCHOOL_ROOT:-/srv/school-1-11}
SCHOOL_CONTAINER=${SCHOOL_CONTAINER:-school-1-11}
ARTHELLO_WEB_CONTAINER=${ARTHELLO_WEB_CONTAINER:-arthello-os-web-1}
ARTHELLO_PUBLIC_NETWORK=${ARTHELLO_PUBLIC_NETWORK:-arthello-os_public}
DEPLOYED_COMPOSE=${DEPLOYED_COMPOSE:-$SCHOOL_ROOT/current/deploy/compose.offline.yml}
ENV_FILE=${ENV_FILE:-$SCHOOL_ROOT/shared/.env}
CADDY_RUNTIME=${CADDY_RUNTIME:-/srv/arthello/shared/Caddyfile.school-runtime}

CADDY_BACKUP=$(mktemp /tmp/Caddyfile.school.backup.XXXXXX)
CADDY_CANDIDATE=$(mktemp /tmp/Caddyfile.school.candidate.XXXXXX)
CADDY_FINAL=$(mktemp /tmp/Caddyfile.school.final.XXXXXX)
ENV_BACKUP=$(mktemp /tmp/school-env.backup.XXXXXX)
TLS_ERROR=$(mktemp /tmp/school-tls-error.XXXXXX)
CADDY_CHANGED=0
ORIGIN_CHANGED=0

cleanup() {
  rm -f \
    "$CADDY_BACKUP" \
    "$CADDY_CANDIDATE" \
    "$CADDY_FINAL" \
    "$ENV_BACKUP" \
    "$TLS_ERROR"
}

compose_up() {
  (
    cd "$SCHOOL_ROOT/current/deploy"
    docker compose \
      --env-file "$ENV_FILE" \
      -p school-1-11 \
      -f docker-compose.yml \
      -f compose.offline.yml \
      up -d --force-recreate --no-build
  )
}

wait_for_school() {
  local status=unknown

  for _attempt in $(seq 1 60); do
    status=$(docker inspect \
      -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$SCHOOL_CONTAINER" 2>/dev/null || true)

    [ "$status" = healthy ] && return 0
    [ "$status" = unhealthy ] && return 1
    sleep 2
  done

  return 1
}

remove_site_block() {
  local source_file=$1
  local destination_file=$2
  local host=$3

  awk -v target="$host {" '
    function occurrences(text, character, count, rest, position) {
      count = 0
      rest = text
      while ((position = index(rest, character)) > 0) {
        count++
        rest = substr(rest, position + 1)
      }
      return count
    }

    $0 == target {
      skip = 1
      depth = occurrences($0, "{") - occurrences($0, "}")
      next
    }

    skip {
      depth += occurrences($0, "{") - occurrences($0, "}")
      if (depth <= 0) {
        skip = 0
      }
      next
    }

    { print }
  ' "$source_file" > "$destination_file"
}

install_caddy_config() {
  local source_file=$1

  docker cp "$source_file" "$ARTHELLO_WEB_CONTAINER:/tmp/Caddyfile.school"
  docker exec "$ARTHELLO_WEB_CONTAINER" \
    caddy fmt --overwrite /tmp/Caddyfile.school >/dev/null
  docker exec "$ARTHELLO_WEB_CONTAINER" \
    caddy validate --config /tmp/Caddyfile.school >/dev/null
  docker cp "$ARTHELLO_WEB_CONTAINER:/tmp/Caddyfile.school" "$source_file"
  docker cp "$source_file" "$ARTHELLO_WEB_CONTAINER:/etc/caddy/Caddyfile"
  docker exec "$ARTHELLO_WEB_CONTAINER" \
    caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

on_error() {
  local code=$?
  local line=${BASH_LINENO[0]}

  trap - ERR
  set +e

  if [ "$ORIGIN_CHANGED" -eq 1 ] && [ -s "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    compose_up >/dev/null 2>&1
  fi

  if [ "$CADDY_CHANGED" -eq 1 ] && [ -s "$CADDY_BACKUP" ]; then
    install_caddy_config "$CADDY_BACKUP" >/dev/null 2>&1
  fi

  echo
  echo "SCHOOL_SWITCH_ERROR: строка $line, код $code"
  if [ -s "$TLS_ERROR" ]; then
    echo "TLS: $(tail -1 "$TLS_ERROR")"
  fi
  echo "Изменения автоматически отменены; работающий контейнер дневника не удалён."
  exit "$code"
}

trap cleanup EXIT
trap on_error ERR

echo "1/5 Проверяем дневник, сеть и DNS..."
test -s "$ENV_FILE"
test "$(docker inspect \
  -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
  "$SCHOOL_CONTAINER")" = healthy

docker exec "$SCHOOL_CONTAINER" node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(e=>{console.error(e);process.exit(1)})"

docker network inspect "$ARTHELLO_PUBLIC_NETWORK" >/dev/null
test "$(docker inspect \
  -f '{{if index .NetworkSettings.Networks "arthello-os_public"}}yes{{end}}' \
  "$ARTHELLO_WEB_CONTAINER")" = yes

SCHOOL_ON_PUBLIC=$(docker inspect \
  -f '{{if index .NetworkSettings.Networks "arthello-os_public"}}yes{{end}}' \
  "$SCHOOL_CONTAINER")
if [ "$SCHOOL_ON_PUBLIC" != yes ]; then
  docker network connect \
    --alias "$SCHOOL_CONTAINER" \
    "$ARTHELLO_PUBLIC_NETWORK" \
    "$SCHOOL_CONTAINER"
fi

if [ -f "$DEPLOYED_COMPOSE" ] && grep -q 'arthello-os_backend' "$DEPLOYED_COMPOSE"; then
  sed -i \
    -e 's/arthello_backend/arthello_public/g' \
    -e 's/arthello-os_backend/arthello-os_public/g' \
    "$DEPLOYED_COMPOSE"
fi

RESOLVED_IP=$(getent ahostsv4 "$SCHOOL_HOST" | awk 'NR == 1 { print $1 }')
test "$RESOLVED_IP" = "$SCHOOL_IP"
echo "DNS: $SCHOOL_HOST → $RESOLVED_IP"

echo "2/5 Добавляем новый HTTPS-маршрут с возможностью отката..."
docker cp "$ARTHELLO_WEB_CONTAINER:/etc/caddy/Caddyfile" "$CADDY_BACKUP"
remove_site_block "$CADDY_BACKUP" "$CADDY_CANDIDATE" "$SCHOOL_HOST"

cat >> "$CADDY_CANDIDATE" <<CADDY

$SCHOOL_HOST {
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

  reverse_proxy $SCHOOL_CONTAINER:3000
}
CADDY

CADDY_CHANGED=1
install_caddy_config "$CADDY_CANDIDATE"

echo "3/5 Ждём доверенный сертификат нового имени..."
HTTPS_OK=0
HEALTH_RESPONSE=
for _attempt in $(seq 1 40); do
  if HEALTH_RESPONSE=$(curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time 10 \
    "https://$SCHOOL_HOST/api/health" 2>"$TLS_ERROR"); then
    if [ "$HEALTH_RESPONSE" = '{"status":"ok"}' ]; then
      HTTPS_OK=1
      break
    fi
  fi
  sleep 3
done
test "$HTTPS_OK" -eq 1
echo "$HEALTH_RESPONSE"

echo "4/5 Переключаем публичный адрес дневника..."
cp "$ENV_FILE" "$ENV_BACKUP"
if grep -q '^PUBLIC_APP_ORIGIN=' "$ENV_FILE"; then
  sed -i "s|^PUBLIC_APP_ORIGIN=.*|PUBLIC_APP_ORIGIN=https://$SCHOOL_HOST|" "$ENV_FILE"
else
  printf '\nPUBLIC_APP_ORIGIN=https://%s\n' "$SCHOOL_HOST" >> "$ENV_FILE"
fi
ORIGIN_CHANGED=1

compose_up
wait_for_school

docker exec "$SCHOOL_CONTAINER" node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(e=>{console.error(e);process.exit(1)})"

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 5 \
  --max-time 15 \
  "https://$SCHOOL_HOST/api/health"
echo

echo "5/5 Удаляем нерабочий маршрут sslip.io..."
remove_site_block "$CADDY_CANDIDATE" "$CADDY_FINAL" "$OLD_SCHOOL_HOST"
install_caddy_config "$CADDY_FINAL"
install -m 0644 "$CADDY_FINAL" "$CADDY_RUNTIME"

CADDY_CHANGED=0
ORIGIN_CHANGED=0

echo
echo "ГОТОВО: https://$SCHOOL_HOST"
docker ps --filter name="$SCHOOL_CONTAINER" --filter name="$ARTHELLO_WEB_CONTAINER"
