#!/usr/bin/env bash
set -Eeuo pipefail

REPO_SSH="git@github.com:vitaliyozolin-dotcom/ArtHello-OS.git"
BRANCH="develop"
WORK_ROOT="/srv/arthello-staging-pull"
SRC_DIR="$WORK_ROOT/source"
STATE_DIR="$WORK_ROOT/state"
SSH_KEY="/root/.ssh/arthello_repo_ed25519"
CADDY_CONTAINER="stroios-caddy-1"
STAGING_HOST="test-arthello-188-225-38-55.sslip.io"
STAGING_URL="https://$STAGING_HOST"
LOCK_FILE="$WORK_ROOT/deploy.lock"

mkdir -p "$WORK_ROOT" "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

log(){ printf '[%s] %s\n' "$(date -Is)" "$*"; }
fail(){ log "ERROR: $*"; exit 1; }

command -v git >/dev/null || fail "git missing"
command -v curl >/dev/null || fail "curl missing"
command -v docker >/dev/null || fail "docker missing"
[ -r "$SSH_KEY" ] || fail "missing SSH deploy key: $SSH_KEY"
[ -S /var/run/docker.sock ] || fail "docker socket missing"
[ "$(docker inspect --format '{{.State.Running}}' "$CADDY_CONTAINER" 2>/dev/null || true)" = true ] || fail "Caddy container is not running"

GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
export GIT_SSH_COMMAND

if [ ! -d "$SRC_DIR/.git" ]; then
  rm -rf "$SRC_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_SSH" "$SRC_DIR"
else
  git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" checkout -B "$BRANCH" FETCH_HEAD
  git -C "$SRC_DIR" reset --hard FETCH_HEAD
  git -C "$SRC_DIR" clean -ffdx
fi

REMOTE_SHA="$(git -C "$SRC_DIR" rev-parse HEAD)"
CURRENT_SHA="$(cat "$STATE_DIR/deployed-sha" 2>/dev/null || true)"
if [ "$REMOTE_SHA" = "$CURRENT_SHA" ]; then exit 0; fi
log "new staging revision: $REMOTE_SHA"

IMAGE="arthello-staging:$REMOTE_SHA"
CANDIDATE="arthello-staging-${REMOTE_SHA:0:12}"
PREVIOUS_CONTAINER="$(cat "$STATE_DIR/container" 2>/dev/null || true)"
NETWORK="$(docker inspect "$CADDY_CONTAINER" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | head -n1)"
[ -n "$NETWORK" ] || fail "cannot detect Caddy network"
BOOTSTRAP_FILE="/home/github-runner/.config/arthello/bootstrap-password"
[ -s "$BOOTSTRAP_FILE" ] || BOOTSTRAP_FILE="/root/.config/arthello/bootstrap-password"
[ -s "$BOOTSTRAP_FILE" ] || fail "bootstrap password file missing"
BOOTSTRAP_PASSWORD="$(cat "$BOOTSTRAP_FILE")"

docker build --file "$SRC_DIR/deploy/v44/Dockerfile" \
  --label "org.opencontainers.image.revision=$REMOTE_SHA" \
  --tag "$IMAGE" "$SRC_DIR"

docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
docker volume create arthello-staging-v44-data >/dev/null
docker run -d \
  --name "$CANDIDATE" \
  --restart unless-stopped \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /app/node_modules/.mf:rw,uid=1000,gid=1000,mode=0700 \
  --network "$NETWORK" \
  -e NODE_ENV=production \
  -e PORT=8081 \
  -e ARTHELLO_D1_PATH=/data/d1 \
  -e ARTHELLO_BOOTSTRAP_LOGIN=owner \
  -e ARTHELLO_BOOTSTRAP_PASSWORD="$BOOTSTRAP_PASSWORD" \
  -v arthello-staging-v44-data:/data \
  "$IMAGE" >/dev/null

ready=0
for _ in $(seq 1 60); do
  state="$(docker inspect "$CANDIDATE" --format '{{.State.Status}}' 2>/dev/null || true)"
  if [ "$state" = running ] && docker exec "$CANDIDATE" node -e "fetch('http://127.0.0.1:8081/api/health').then(async r=>process.exit(r.ok&&(await r.text()).includes('\\\"status\\\":\\\"ok\\\"')?0:1)).catch(()=>process.exit(1))"; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  docker logs --tail 250 "$CANDIDATE" >&2 || true
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  fail "candidate failed health check"
fi

ROUTES="$WORK_ROOT/external-routes.current.caddy"
NEXT="$WORK_ROOT/external-routes.next.caddy"
docker cp "$CADDY_CONTAINER:/data/external-routes.caddy" "$ROUTES"
awk '
  BEGIN { skip=0 }
  /^test-arthello-188-225-38-55\.sslip\.io[[:space:]]*\{/ { skip=1; depth=1; next }
  skip {
    opens=gsub(/\{/,"{"); closes=gsub(/\}/,"}"); depth+=opens-closes;
    if(depth<=0) skip=0;
    next
  }
  { print }
' "$ROUTES" > "$NEXT"
cat >> "$NEXT" <<EOF

$STAGING_HOST {
  encode zstd gzip
  reverse_proxy $CANDIDATE:8081
  header {
    X-Robots-Tag "noindex, nofollow, noarchive"
    X-ArtHello-Environment "staging"
    -Server
  }
}
EOF

docker cp "$NEXT" "$CADDY_CONTAINER:/data/external-routes.caddy.new"
docker exec "$CADDY_CONTAINER" sh -lc "sed 's#/data/external-routes.caddy#/data/external-routes.caddy.new#' /etc/caddy/Caddyfile > /tmp/Caddyfile.staging-candidate"
docker exec "$CADDY_CONTAINER" caddy validate --config /tmp/Caddyfile.staging-candidate --adapter caddyfile >/dev/null
docker exec "$CADDY_CONTAINER" sh -lc 'mv /data/external-routes.caddy.new /data/external-routes.caddy'
docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

public_ok=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 20 "$STAGING_URL/api/health" | grep -F '"status":"ok"' >/dev/null \
    && curl -fsS --max-time 20 "$STAGING_URL/settings/access" | grep -F 'Пользователи и доступы' >/dev/null \
    && curl -fsSI --max-time 20 "$STAGING_URL/settings/access" | grep -qi '^x-arthello-environment: staging'; then
    public_ok=1
    break
  fi
  sleep 3
done

if [ "$public_ok" -ne 1 ]; then
  log "public verification failed; restoring previous route"
  docker cp "$ROUTES" "$CADDY_CONTAINER:/data/external-routes.caddy"
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || true
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  fail "staging public verification failed"
fi

printf '%s\n' "$REMOTE_SHA" > "$STATE_DIR/deployed-sha"
printf '%s\n' "$CANDIDATE" > "$STATE_DIR/container"

if [ -n "$PREVIOUS_CONTAINER" ] && [ "$PREVIOUS_CONTAINER" != "$CANDIDATE" ]; then
  docker rm -f "$PREVIOUS_CONTAINER" >/dev/null 2>&1 || true
fi
while IFS= read -r old; do
  [ -n "$old" ] || continue
  [ "$old" = "$CANDIDATE" ] && continue
  docker rm -f "$old" >/dev/null 2>&1 || true
done < <(docker ps -a --filter 'name=^/arthello-staging-' --format '{{.Names}}')

docker image prune -f >/dev/null 2>&1 || true
log "ARTHELLO_STAGING_OK $REMOTE_SHA $STAGING_URL/settings/access"
