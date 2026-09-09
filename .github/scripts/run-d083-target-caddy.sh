#!/usr/bin/env bash
# Test the already installed gateway binary in a separate network:none fixture.
# No package installation, image pull, application mount or gateway reload.
set -Eeuo pipefail
umask 077
[[ "$VALIDATED_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
test "$CADDY_CONTAINER" = stroios-caddy-1
test -d "$RUNNER_TEMP" && test ! -L "$RUNNER_TEMP"
image="$VALIDATED_IMAGE_ID"
test "$(docker image inspect "$image" --format '{{.Config.User}}')" = node
gateway_id="$(docker inspect "$CADDY_CONTAINER" --format '{{.Id}}')"
[[ "$gateway_id" =~ ^[a-f0-9]{64}$ ]]
test "$(docker inspect "$gateway_id" --format '{{.State.Running}}')" = true
before_sha="$(docker exec "$gateway_id" sha256sum /usr/bin/caddy | cut -d ' ' -f 1)"
[[ "$before_sha" =~ ^[a-f0-9]{64}$ ]]
name="arthello-caddy-fixture-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
if docker inspect "$name" >/dev/null 2>&1; then echo 'ARTHELLO_TARGET_CADDY_FIXTURE=BLOCKED_EXISTING'; exit 2; fi
work="$(mktemp -d "$RUNNER_TEMP/d083-target-caddy.XXXXXXXX")"
cleanup() {
  if [[ "$(docker inspect "$name" --format '{{index .Config.Labels "arthello.caddy-fixture.invocation"}}' 2>/dev/null || true)" == "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" ]]; then
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
  case "$work" in "$RUNNER_TEMP"/d083-target-caddy.*) chmod 0700 "$work"; rm -rf -- "$work" ;; *) return 1 ;; esac
}
trap cleanup EXIT
# Copy bytes into a newly created file so no file capability or owner metadata
# from the gateway can affect the unprivileged cap-drop-ALL fixture process.
docker exec "$gateway_id" cat /usr/bin/caddy > "$work/caddy"
test -f "$work/caddy" && test ! -L "$work/caddy"
test "$(sha256sum "$work/caddy" | cut -d ' ' -f 1)" = "$before_sha"
chmod 0555 "$work/caddy"
cp .github/scripts/d083-maintenance-route.py .github/scripts/test-d083-maintenance-caddy.py "$work/"
chmod 0444 "$work/d083-maintenance-route.py" "$work/test-d083-maintenance-caddy.py"
mkdir "$work/test-fixtures"
cp .github/scripts/test-fixtures/d083-stroios-Caddyfile "$work/test-fixtures/"
chmod 0444 "$work/test-fixtures/d083-stroios-Caddyfile"
chmod 0555 "$work/test-fixtures"
# The directory contains only the copied executable and public reviewed fixtures.
chmod 0555 "$work"
timeout --signal=TERM --kill-after=10 110 docker run --rm --init --pull never \
  --name "$name" --label "arthello.caddy-fixture.invocation=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --user node --network none --read-only --log-driver none --cap-drop ALL \
  --security-opt no-new-privileges --memory 384m --memory-swap 384m --cpus 1 --pids-limit 128 \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=700 \
  --mount "type=bind,src=$work,dst=/opt/d083-caddy-fixture,readonly" \
  --env PATH=/opt/d083-caddy-fixture:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --entrypoint python3 "$image" -I /opt/d083-caddy-fixture/test-d083-maintenance-caddy.py
test "$(docker inspect "$CADDY_CONTAINER" --format '{{.Id}}')" = "$gateway_id"
test "$(docker exec "$gateway_id" sha256sum /usr/bin/caddy | cut -d ' ' -f 1)" = "$before_sha"
printf 'ARTHELLO_TARGET_CADDY_FIXTURE=VERIFIED\n'
