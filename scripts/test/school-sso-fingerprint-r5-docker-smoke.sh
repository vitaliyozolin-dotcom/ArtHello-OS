#!/usr/bin/env bash
# Fresh hosted-only fixtures; no production endpoint, volume, identity or secret.
set -Eeuo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
: "${RUNNER_TEMP:?hosted temporary directory required}"
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]]
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]
key="school-r5-fingerprint-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
work="$(mktemp -d "$RUNNER_TEMP/$key.XXXXXX")"
school="$key-subject"
peer="$key-peer"
network="$key-network"
image=node:24-bookworm-slim
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  docker rm -f "$school" "$peer" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$work"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$work/first" "$work/second"
chmod 0755 "$work" "$work/first" "$work/second"
docker pull "$image" >/dev/null
docker network create --internal "$network" >/dev/null
docker run -d --name "$school" --network "$network" \
  --user 1001:1001 --cap-drop ALL --security-opt no-new-privileges:true --read-only \
  --mount "type=bind,src=$work/first,dst=/fixture-first,readonly" \
  --mount "type=bind,src=$work/second,dst=/fixture-second,readonly" \
  "$image" node -e 'setInterval(()=>{},3600000)' >/dev/null
docker container inspect "$school" > "$work/baseline.json"
python3 -I -B scripts/test/school-sso-fingerprint-r5-docker-check.py "$work/baseline.json" "$school" before-peer
docker run -d --name "$peer" --network "$network" \
  --user 1001:1001 --cap-drop ALL --security-opt no-new-privileges:true --read-only \
  "$image" node -e 'setInterval(()=>{},3600000)' >/dev/null
docker network inspect "$network" | jq -e '.[0].Containers | length == 2' >/dev/null
python3 -I -B scripts/test/school-sso-fingerprint-r5-docker-check.py "$work/baseline.json" "$school" after-peer
docker rm -f "$peer" >/dev/null
docker network inspect "$network" | jq -e '.[0].Containers | length == 1' >/dev/null
python3 -I -B scripts/test/school-sso-fingerprint-r5-docker-check.py "$work/baseline.json" "$school" after-peer-removal
printf 'SCHOOL_RELAY_R5_HOSTED_MOUNT_FINGERPRINT=VERIFIED\n'
