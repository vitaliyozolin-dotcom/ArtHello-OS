#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

TARGET_SHA="${TARGET_SHA:-49b1545aa0993d4f082ade227287305835034522}"
REPOSITORY="${REPOSITORY:-vitaliyozolin-dotcom/ArtHello-OS}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-arthello-188-225-38-55.sslip.io}"
ARTHELLO_ROOT="${ARTHELLO_ROOT:-/srv/arthello}"
TOKEN_FILE="${GITHUB_TOKEN_FILE:-$ARTHELLO_ROOT/shared/github-release-token}"
DEPLOY_KEY="${GITHUB_DEPLOY_KEY:-/root/.ssh/arthello_repo_ed25519}"
SOURCE_DIGEST="c72c6c7ced52f0d533be16ff8a8aa2d11fad8d0743b6f1229bde7f034a057062"
IMAGE="arthello-os-ui:$TARGET_SHA"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
WORK_ROOT="$ARTHELLO_ROOT/manual-cutovers/$TARGET_SHA-$RUN_ID"
SOURCE_ROOT="$WORK_ROOT/source"
ARCHIVE="$WORK_ROOT/source.tar.gz"
CURL_CONFIG="$WORK_ROOT/curl.config"
BACKUP_JSON="$WORK_ROOT/caddy-before.json"
ROUTE_CADDY="$WORK_ROOT/route.Caddyfile"
ROUTE_JSON="$WORK_ROOT/route.json"
MERGED_JSON="$WORK_ROOT/caddy-merged.json"
WEB_ID=""
SWITCHED=0

if [[ ! "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'ARTHELLO_MANUAL_ERROR=invalid_target_sha\n' >&2
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  printf 'ARTHELLO_MANUAL_ERROR=root_required\n' >&2
  exit 2
fi

rollback() {
  rc=$?
  rm -f -- "$CURL_CONFIG"
  if [ "$rc" -ne 0 ] && [ "$SWITCHED" -eq 1 ] && [ -s "$BACKUP_JSON" ] && [ -n "$WEB_ID" ]; then
    docker cp "$BACKUP_JSON" "$WEB_ID:/tmp/arthello-caddy-rollback.json" >/dev/null 2>&1 || true
    docker exec "$WEB_ID" caddy reload --config /tmp/arthello-caddy-rollback.json --adapter json >/dev/null 2>&1 || true
    printf 'ARTHELLO_MANUAL_ROLLBACK=complete\n' >&2
  fi
  if [ "$rc" -ne 0 ]; then
    printf 'ARTHELLO_MANUAL_RESULT=failed:%s\n' "$rc" >&2
  fi
  exit "$rc"
}
trap rollback EXIT

install -d -m 0750 "$WORK_ROOT" "$SOURCE_ROOT"

printf '1/5 Скачиваем зафиксированную новую версию...\n'
if [ -s "$TOKEN_FILE" ]; then
  install -m 0600 /dev/null "$CURL_CONFIG"
  {
    printf 'header = "Authorization: Bearer %s"\n' "$(cat "$TOKEN_FILE")"
    printf 'header = "X-GitHub-Api-Version: 2022-11-28"\n'
    printf 'proto = "=https"\n'
    printf 'tlsv1.2\n'
    printf 'silent\nshow-error\nfail\n'
  } > "$CURL_CONFIG"
  curl --config "$CURL_CONFIG" --location --retry 5 --retry-all-errors \
    --connect-timeout 25 --max-time 1800 \
    --output "$ARCHIVE" \
    "https://api.github.com/repos/$REPOSITORY/tarball/$TARGET_SHA"
  test -s "$ARCHIVE"
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$SOURCE_ROOT"
elif [ -s "$DEPLOY_KEY" ]; then
  command -v git >/dev/null
  export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
  git -C "$SOURCE_ROOT" init -q
  git -C "$SOURCE_ROOT" remote add origin "ssh://git@ssh.github.com:443/$REPOSITORY.git"
  git -C "$SOURCE_ROOT" fetch --depth 1 --filter=blob:none origin "$TARGET_SHA"
  git -C "$SOURCE_ROOT" checkout -q --detach FETCH_HEAD
  unset GIT_SSH_COMMAND
else
  printf 'ARTHELLO_MANUAL_ERROR=github_credentials_missing\n' >&2
  exit 2
fi
test -f "$SOURCE_ROOT/deploy/v44/Dockerfile"
test -f "$SOURCE_ROOT/deploy/v44/compose.ui.yml"
actual_digest="$(cat "$SOURCE_ROOT"/deploy/v44/arthello-sites-v44-source.tar.gz.part-* | sha256sum | awk '{print $1}')"
test "$actual_digest" = "$SOURCE_DIGEST"

printf '2/5 Собираем и запускаем новый контейнер рядом со старым...\n'
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  printf 'ARTHELLO_MANUAL_IMAGE=cached\n'
else
  docker build \
    --label "org.opencontainers.image.revision=$TARGET_SHA" \
    --tag "$IMAGE" \
    --file "$SOURCE_ROOT/deploy/v44/Dockerfile" "$SOURCE_ROOT"
fi

cd "$SOURCE_ROOT"
export ARTHELLO_UI_IMAGE="$IMAGE"
docker compose -p arthello-os -f deploy/v44/compose.ui.yml config >/dev/null
docker compose -p arthello-os -f deploy/v44/compose.ui.yml up -d --no-deps newui

ready=0
for attempt in $(seq 1 120); do
  if docker exec arthello-os-newui node -e \
    "fetch('http://127.0.0.1:8081/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    ready=1
    break
  fi
  sleep 5
done
test "$ready" -eq 1
test "$(docker inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' arthello-os-newui)" = "$TARGET_SHA"
printf 'ARTHELLO_MANUAL_NEWUI=healthy\n'

printf '3/5 Сохраняем текущий Caddy и готовим новый маршрут...\n'
WEB_ID="$(docker ps --filter 'name=^/arthello-os-web-1$' --format '{{.ID}}' | head -n 1)"
if [ -z "$WEB_ID" ]; then
  WEB_ID="$(docker ps --filter 'label=com.docker.compose.service=web' --format '{{.ID}}' | head -n 1)"
fi
test -n "$WEB_ID"
docker exec "$WEB_ID" sh -lc 'wget -qO- http://127.0.0.1:2019/config/' > "$BACKUP_JSON"
test -s "$BACKUP_JSON"

cat > "$ROUTE_CADDY" <<EOF
http://$PUBLIC_DOMAIN {
  encode zstd gzip

  header {
    -Server
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    X-Frame-Options "DENY"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"
  }

  @legacy_health path /api/healthz
  handle @legacy_health {
    reverse_proxy api:8080
  }

  @auth path /api/auth/*
  handle @auth {
    reverse_proxy api:8080
  }

  @protected_api path /api/*
  handle @protected_api {
    forward_auth api:8080 {
      uri /api/auth/me
    }
    reverse_proxy arthello-os-newui:8081
  }

  handle {
    reverse_proxy arthello-os-newui:8081
  }
}
EOF

docker cp "$ROUTE_CADDY" "$WEB_ID:/tmp/arthello-live-route.Caddyfile" >/dev/null
docker exec "$WEB_ID" caddy adapt --config /tmp/arthello-live-route.Caddyfile --adapter caddyfile --pretty > "$ROUTE_JSON"
test -s "$ROUTE_JSON"

python3 - "$BACKUP_JSON" "$ROUTE_JSON" "$MERGED_JSON" "$PUBLIC_DOMAIN" <<'PY'
import json
import pathlib
import sys

current_path, route_path, output_path, domain = sys.argv[1:]
current = json.loads(pathlib.Path(current_path).read_text(encoding="utf-8"))
fragment = json.loads(pathlib.Path(route_path).read_text(encoding="utf-8"))
current_servers = current["apps"]["http"]["servers"]
source_server = next(iter(fragment["apps"]["http"]["servers"].values()))
source_routes = source_server.get("routes", [])
if not source_routes:
    raise SystemExit("adapted route is empty")

def targets_domain(route):
    for matcher_set in route.get("match", []):
        if domain in matcher_set.get("host", []):
            return True
    return False

destinations = []
for server in current_servers.values():
    listens = server.get("listen", [])
    if any(value.endswith(":80") or value == ":80" or value.endswith(":443") or value == ":443" for value in listens):
        destinations.append(server)
if not destinations:
    destinations = list(current_servers.values())
for destination in destinations:
    existing = [route for route in destination.get("routes", []) if not targets_domain(route)]
    destination["routes"] = source_routes + existing
pathlib.Path(output_path).write_text(json.dumps(current), encoding="utf-8")
PY

docker cp "$MERGED_JSON" "$WEB_ID:/tmp/arthello-caddy-merged.json" >/dev/null
docker exec "$WEB_ID" caddy validate --config /tmp/arthello-caddy-merged.json --adapter json >/dev/null

printf '4/5 Переключаем домен на новую систему...\n'
SWITCHED=1
docker exec "$WEB_ID" caddy reload --config /tmp/arthello-caddy-merged.json --adapter json >/dev/null

public_ready=0
for attempt in $(seq 1 60); do
  nonce="$RUN_ID-$attempt"
  root_html="$(curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' "https://$PUBLIC_DOMAIN/?probe=$nonce" || true)"
  health_body="$(curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' "https://$PUBLIC_DOMAIN/api/healthz?probe=$nonce" || true)"
  auth_code="$(curl --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' -H 'Cache-Control: no-cache' "https://$PUBLIC_DOMAIN/api/auth/me?probe=$nonce" || true)"
  protected_code="$(curl --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' -H 'Cache-Control: no-cache' "https://$PUBLIC_DOMAIN/api/settings?probe=$nonce" || true)"
  if grep -Eq 'Проверяем защищённую сессию|Закрытая операционная система образовательной группы' <<<"$root_html" \
    && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"$health_body" \
    && [ "$auth_code" = 401 ] \
    && [ "$protected_code" = 401 ]; then
    public_ready=1
    break
  fi
  sleep 5
done
test "$public_ready" -eq 1
SWITCHED=0

printf '5/5 Удаляем неиспользуемые старые UI-образы...\n'
while IFS= read -r old_image; do
  [ -n "$old_image" ] || continue
  [ "$old_image" = "$IMAGE" ] && continue
  docker image rm "$old_image" >/dev/null 2>&1 || true
done < <(docker image ls 'arthello-os-ui' --format '{{.Repository}}:{{.Tag}}')

rm -f -- "$CURL_CONFIG"
trap - EXIT
printf 'ARTHELLO_MANUAL_RESULT=success\n'
printf 'ARTHELLO_PUBLIC_URL=https://%s/\n' "$PUBLIC_DOMAIN"
printf 'ARTHELLO_RELEASE_SHA=%s\n' "$TARGET_SHA"
