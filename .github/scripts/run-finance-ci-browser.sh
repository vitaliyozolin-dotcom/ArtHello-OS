#!/usr/bin/env bash
# Hosted-only, disposable containers. No production environment or credentials.
set -Eeuo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test -z "${DOCKER_HOST:-}"
test "$(git rev-parse HEAD)" = "$CHECKED_SOURCE_SHA"
[[ "$IMMUTABLE_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+-[0-9]+$ ]]
scope="arthello-finance-ci-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
fixture_dir="$(mktemp -d "$RUNNER_TEMP/finance-ci.XXXXXXXX")"
cleanup() {
  rc=$?;trap - EXIT INT TERM HUP
  docker rm -f "$scope-browser" "$scope-app" >/dev/null 2>&1 || true
  docker volume rm "$scope-data" >/dev/null 2>&1 || true
  docker network rm "$scope-net" >/dev/null 2>&1 || true
  rm -rf -- "$fixture_dir"
  exit "$rc"
}
test -z "$(docker ps -aq --filter "name=^/$scope-")"
test -z "$(docker volume ls -q --filter "name=^$scope-data$")"
test -z "$(docker network ls -q --filter "name=^$scope-net$")"
# Cleanup becomes authorized only after this namespace is proven unused.
trap cleanup EXIT INT TERM HUP
mkdir -p "$RUNNER_TEMP/finance-browser-evidence"
chmod 0777 "$RUNNER_TEMP/finance-browser-evidence"
python3 -I - "$fixture_dir" <<'PY'
from pathlib import Path
import secrets,sys
for name in ('fixture-password','integration-key'):
    value=secrets.token_urlsafe(48)
    print('::add-mask::'+value)
    path=Path(sys.argv[1])/name;path.write_text(value);path.chmod(0o444)
PY
chmod 0755 "$fixture_dir"
docker volume create --label arthello.scope=finance-ci "$scope-data" >/dev/null
docker network create --internal --label arthello.scope=finance-ci "$scope-net" >/dev/null
docker run -d --pull never --name "$scope-app" --restart no --read-only \
  --label arthello.scope=finance-ci --network "$scope-net" \
  --tmpfs /tmp --tmpfs /app/node_modules/.mf:rw,uid=1000,gid=1000,mode=0700 \
  -e NODE_ENV=production -e PORT=8081 -e RELEASE_SHA="$CHECKED_SOURCE_SHA" \
  -e ARTHELLO_D1_PATH=/data/d1 -e ARTHELLO_PUBLIC_ORIGIN=https://finance.ci.invalid \
  -e ARTHELLO_FINANCE_CI=disposable-hosted-fixture -e ARTHELLO_BOOTSTRAP_LOGIN=owner \
  -e ARTHELLO_BOOTSTRAP_PASSWORD_FILE=/run/secrets/fixture-password \
  -e INTEGRATION_CREDENTIALS_KEY_FILE=/run/secrets/integration-key \
  --mount "type=bind,src=$fixture_dir/fixture-password,dst=/run/secrets/fixture-password,readonly" \
  --mount "type=bind,src=$fixture_dir/integration-key,dst=/run/secrets/integration-key,readonly" \
  --mount "type=bind,src=$PWD/.github/scripts/finance-ci-seed.mjs,dst=/tmp/finance-ci-seed.mjs,readonly" \
  --mount "type=volume,src=$scope-data,dst=/data" "$IMMUTABLE_IMAGE_ID" >/dev/null
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$scope-app" node --input-type=module -e "const h=await fetch('http://127.0.0.1:8081/api/health'); if(!h.ok)process.exit(1);const a=await fetch('http://127.0.0.1:8081/api/auth/me');if(a.status!==401)process.exit(1)" >/dev/null 2>&1; then ready=1;break;fi
  sleep 1
done
test "$ready" -eq 1
docker exec "$scope-app" node /tmp/finance-ci-seed.mjs seed
corepack enable
corepack pnpm@11.7.0 --dir deploy/browser install --ignore-workspace --frozen-lockfile
browser_tag="$scope-browser-image"
docker build --platform linux/amd64 --build-arg "SOURCE_SHA=$CHECKED_SOURCE_SHA" -t "$browser_tag" deploy/browser
browser_image="$(docker image inspect "$browser_tag" --format '{{.Id}}')"
timeout --signal=TERM --kill-after=10 180 docker run --rm --init --pull never --name "$scope-browser" \
  --user 1000:1000 --network "container:$scope-app" --read-only --cap-drop ALL \
  --security-opt no-new-privileges --security-opt "seccomp=$PWD/deploy/browser/seccomp.json" \
  --memory 1g --memory-swap 1g --cpus 1 --pids-limit 256 --shm-size 128m \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=700 \
  -e ARTHELLO_FINANCE_CI=disposable-hosted-fixture -e CHECKED_SOURCE_SHA="$CHECKED_SOURCE_SHA" \
  --mount "type=bind,src=$fixture_dir/fixture-password,dst=/run/secrets/fixture-password,readonly" \
  --mount "type=bind,src=$PWD/.github/scripts/finance-ci-browser.mjs,dst=/opt/arthello-e2e/finance-ci-browser.mjs,readonly" \
  --mount "type=bind,src=$RUNNER_TEMP/finance-browser-evidence,dst=/evidence" \
  --entrypoint node "$browser_image" /opt/arthello-e2e/finance-ci-browser.mjs
docker exec "$scope-app" node /tmp/finance-ci-seed.mjs verify
test "$(git rev-parse HEAD)" = "$CHECKED_SOURCE_SHA"
printf 'FINANCE_ISOLATED_BROWSER=PASS\n'
