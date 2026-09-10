#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

TARGET_SHA="${TARGET_SHA:-49b1545aa0993d4f082ade227287305835034522}"
REPOSITORY="${REPOSITORY:-vitaliyozolin-dotcom/ArtHello-OS}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-arthello-188-225-38-55.sslip.io}"
ORIGIN_HOST="${ORIGIN_HOST:-arthello-origin.internal}"
ROOT="${ARTHELLO_ROOT:-/srv/arthello}"
TOKEN_FILE="${GITHUB_TOKEN_FILE:-$ROOT/shared/github-release-token}"
DEPLOY_KEY="${GITHUB_DEPLOY_KEY:-/root/.ssh/arthello_repo_ed25519}"
SOURCE_TREE_DIGEST="c99a5f6ded03d5c8071a4f0601e4ae2504ffa7cd6af4ccc21a8aaf00e8adf020"
IMAGE="arthello-os-ui:$TARGET_SHA"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
WORK="$ROOT/gateway-cutovers/$TARGET_SHA-$RUN_ID"
SRC="$WORK/source"
BACKUP="$WORK/caddy-before.json"
ROUTE="$WORK/route.Caddyfile"
ROUTE_JSON="$WORK/route.json"
MERGED="$WORK/caddy-merged.json"
WEB_ID=""
SWITCHED=0

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'ARTHELLO_GATEWAY_ERROR=invalid_sha' >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo 'ARTHELLO_GATEWAY_ERROR=root_required' >&2; exit 2; }
install -d -m 0750 "$WORK" "$SRC"

rollback() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$SWITCHED" -eq 1 ] && [ -s "$BACKUP" ] && [ -n "$WEB_ID" ]; then
    docker cp "$BACKUP" "$WEB_ID:/tmp/arthello-gateway-rollback.json" >/dev/null 2>&1 || true
    docker exec "$WEB_ID" caddy reload --config /tmp/arthello-gateway-rollback.json >/dev/null 2>&1 || true
    echo 'ARTHELLO_GATEWAY_ROLLBACK=complete' >&2
  fi
  [ "$rc" -eq 0 ] || echo "ARTHELLO_GATEWAY_RESULT=failed:$rc" >&2
  exit "$rc"
}
trap rollback EXIT

echo '1/5 Получаем зафиксированную v44...'
if [ -s "$TOKEN_FILE" ]; then
  cfg="$WORK/curl.config"
  install -m 0600 /dev/null "$cfg"
  {
    printf 'header = "Authorization: Bearer %s"\n' "$(cat "$TOKEN_FILE")"
    printf 'header = "X-GitHub-Api-Version: 2022-11-28"\n'
    printf 'proto = "=https"\n'
    printf 'tlsv1.2\n'
    printf 'silent\nshow-error\nfail\n'
  } > "$cfg"
  curl --config "$cfg" --location --retry 5 --retry-all-errors --connect-timeout 25 --max-time 1800 \
    -o "$WORK/source.tar.gz" "https://api.github.com/repos/$REPOSITORY/tarball/$TARGET_SHA"
  tar -xzf "$WORK/source.tar.gz" --strip-components=1 -C "$SRC"
elif [ -s "$DEPLOY_KEY" ]; then
  export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
  git -C "$SRC" init -q
  git -C "$SRC" remote add origin "ssh://git@ssh.github.com:443/$REPOSITORY.git"
  git -C "$SRC" fetch --depth 1 --filter=blob:none origin "$TARGET_SHA"
  git -C "$SRC" checkout -q --detach FETCH_HEAD
  unset GIT_SSH_COMMAND
else
  echo 'ARTHELLO_GATEWAY_ERROR=github_credentials_missing' >&2
  exit 2
fi

test -f "$SRC/deploy/v44/Dockerfile"
actual_tree_digest="$(tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' -cf - -C "$SRC/deploy/v44/src" . | sha256sum | awk '{print $1}')"
[ "$actual_tree_digest" = "$SOURCE_TREE_DIGEST" ]

echo '2/5 Поднимаем новую оболочку...'
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build --label "org.opencontainers.image.revision=$TARGET_SHA" --tag "$IMAGE" \
    --file "$SRC/deploy/v44/Dockerfile" "$SRC"
fi

WEB_ID="$(docker ps --filter 'name=^/arthello-os-web-1$' --format '{{.ID}}' | head -n1)"
if [ -z "$WEB_ID" ]; then
  WEB_ID="$(docker ps \
    --filter 'label=com.docker.compose.project=arthello-os' \
    --filter 'label=com.docker.compose.service=web' \
    --format '{{.ID}}' | head -n1)"
fi
test -n "$WEB_ID"
network="$(docker inspect "$WEB_ID" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | head -n1)"
test -n "$network"

docker volume create arthello-os-ui-d1 >/dev/null
docker rm -f arthello-os-newui >/dev/null 2>&1 || true
docker run -d --name arthello-os-newui --restart unless-stopped --read-only --tmpfs /tmp \
  -e NODE_ENV=production -e PORT=8081 -e ARTHELLO_D1_PATH=/data/d1 \
  -v arthello-os-ui-d1:/data --network "$network" "$IMAGE" >/dev/null

ready=0
for attempt in $(seq 1 120); do
  if docker exec arthello-os-newui node -e "fetch('http://127.0.0.1:8081/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    ready=1; break
  fi
  sleep 3
done
[ "$ready" -eq 1 ]
[ "$(docker inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' arthello-os-newui)" = "$TARGET_SHA" ]
echo 'ARTHELLO_GATEWAY_NEWUI=healthy'

echo '3/5 Готовим правильный origin route...'
docker exec "$WEB_ID" sh -lc 'wget -qO- http://127.0.0.1:2019/config/' > "$BACKUP"
test -s "$BACKUP"
cat > "$ROUTE" <<EOF
https://$ORIGIN_HOST {
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
  handle @legacy_health { reverse_proxy api:8080 }
  @auth path /api/auth/*
  handle @auth { reverse_proxy api:8080 }
  @protected path /api/*
  handle @protected {
    forward_auth api:8080 { uri /api/auth/me }
    reverse_proxy arthello-os-newui:8081
  }
  handle { reverse_proxy arthello-os-newui:8081 }
}
EOF

docker cp "$ROUTE" "$WEB_ID:/tmp/arthello-origin-v44.Caddyfile" >/dev/null
docker exec "$WEB_ID" caddy adapt --config /tmp/arthello-origin-v44.Caddyfile --adapter caddyfile --pretty > "$ROUTE_JSON"
test -s "$ROUTE_JSON"

python3 - "$BACKUP" "$ROUTE_JSON" "$MERGED" "$ORIGIN_HOST" <<'PY'
import json, pathlib, sys
curp, fragp, outp, host = sys.argv[1:]
cur = json.loads(pathlib.Path(curp).read_text())
frag = json.loads(pathlib.Path(fragp).read_text())
source = next(iter(frag['apps']['http']['servers'].values())).get('routes', [])
if not source: raise SystemExit('empty route')
def targets(route):
    return any(host in m.get('host', []) for m in route.get('match', []))
servers = cur['apps']['http']['servers']
for server in servers.values():
    listens = server.get('listen', [])
    if any(x == ':443' or x.endswith(':443') for x in listens):
        server['routes'] = source + [r for r in server.get('routes', []) if not targets(r)]
pathlib.Path(outp).write_text(json.dumps(cur))
PY

docker cp "$MERGED" "$WEB_ID:/tmp/arthello-origin-v44.json" >/dev/null
docker exec "$WEB_ID" caddy validate --config /tmp/arthello-origin-v44.json >/dev/null

echo '4/5 Переключаем origin и проверяем через публичный шлюз...'
SWITCHED=1
docker exec "$WEB_ID" caddy reload --config /tmp/arthello-origin-v44.json >/dev/null

local_ok=0
for attempt in $(seq 1 30); do
  body="$(curl --silent --show-error --insecure --resolve "$ORIGIN_HOST:443:127.0.0.1" "https://$ORIGIN_HOST/?probe=$RUN_ID-$attempt" || true)"
  if grep -Eq 'Проверяем защищённую сессию|Закрытая операционная система образовательной группы|ArtHello' <<<"$body"; then
    local_ok=1; break
  fi
  sleep 2
done
[ "$local_ok" -eq 1 ]

public_ok=0
for attempt in $(seq 1 60); do
  body="$(curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' "https://$PUBLIC_DOMAIN/?probe=$RUN_ID-$attempt" || true)"
  health="$(curl --fail --silent --show-error --max-time 20 "https://$PUBLIC_DOMAIN/api/healthz?probe=$RUN_ID-$attempt" || true)"
  auth="$(curl --silent --show-error --max-time 20 -o /dev/null -w '%{http_code}' "https://$PUBLIC_DOMAIN/api/auth/me?probe=$RUN_ID-$attempt" || true)"
  if grep -Eq 'Проверяем защищённую сессию|Закрытая операционная система образовательной группы|ArtHello' <<<"$body" \
    && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"$health" \
    && [ "$auth" = 401 ]; then
    public_ok=1; break
  fi
  sleep 3
done
[ "$public_ok" -eq 1 ]
SWITCHED=0

echo '5/5 Финальная проверка дневника...'
curl --fail --silent --show-error --max-time 20 https://school-188-225-38-55.sslip.io/api/health | grep -F '"status":"ok"' >/dev/null

trap - EXIT
echo 'ARTHELLO_GATEWAY_RESULT=success'
echo "ARTHELLO_PUBLIC_URL=https://$PUBLIC_DOMAIN/"
echo 'SCHOOL_ROUTE_PRESERVED=ok'
echo "ARTHELLO_RELEASE_SHA=$TARGET_SHA"
