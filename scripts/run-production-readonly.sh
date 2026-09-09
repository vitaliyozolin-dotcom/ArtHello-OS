#!/usr/bin/env bash
# D-075: existing Docker service authority; no root, secrets or source copy.
set -Eeuo pipefail
volume=arthello-direct-v44-data
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
[[ "${EXPECTED_LIVE_SOURCE_SHA:-}" =~ ^[a-f0-9]{40}$ ]]
probe="arthello-readonly-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
label="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
cleanup() {
  # Only this invocation's temporary helper, never the application or a volume.
  if [[ "$(docker inspect "$probe" --format '{{index .Config.Labels "arthello.readonly.probe"}}' 2>/dev/null || true)" = "$label" ]]; then
    docker rm -f "$probe" >/dev/null 2>&1 || true
  fi
}
if docker inspect "$probe" >/dev/null 2>&1; then echo 'READONLY_BLOCKED=helper_already_exists'; exit 2; fi
trap cleanup EXIT INT TERM HUP
observe_consumers() {
  timeout 60 python3 -I scripts/production-data-consumers.py \
    --expected-release "$EXPECTED_LIVE_SOURCE_SHA" \
    --release-state-dir "$HOME/.config/arthello/release-state"
}
# Accepted release identity is pinned separately from this diagnostic's source.
# Only its exact R7 backup worker may share /data; every other consumer blocks.
selection="$(observe_consumers)"
live="$(jq -er '.liveId' <<<"$selection")"
image="$(jq -er '.imageId' <<<"$selection")"
source="$(jq -er '.sourceSha' <<<"$selection")"
[[ "$live" =~ ^[a-f0-9]{64}$ ]]
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ && "$source" =~ ^[a-f0-9]{40}$ ]]
test "$source" = "$EXPECTED_LIVE_SOURCE_SHA"
relative="$("$PRECHECK_NODE" --input-type=module -e 'import {activeRelativePath} from "./scripts/production-readonly.mjs"; console.log(activeRelativePath())')"
[[ "$relative" =~ ^d1/miniflare-D1DatabaseObject/[a-f0-9]{64}\.sqlite$ ]]
# One bounded non-root process; fixed counters/reasons only, never FD targets.
set +e
timeout 15 docker exec -i -e EXPECTED_FILE="/data/$relative" "$live" \
  node --input-type=module - --live-d1-scan < scripts/live-d1-identity.mjs 2>/dev/null
scan_status=$?
set -e
if [[ "$scan_status" -eq 124 ]]; then echo 'READONLY_BLOCKED=identity_scan_timeout'; exit 2; fi
if [[ "$scan_status" -ne 0 ]]; then echo 'READONLY_BLOCKED=live_file_identity'; exit 2; fi
printf 'READONLY_LIVE_SOURCE=%s\nREADONLY_IMAGE=%s\n' "$source" "$image"
echo 'READONLY_BACKUP=exact_readonly_consumer_history_not_verified'
# No pull/build, inherited production env, secrets, network, Docker socket or RW mount.
# The external deadline also bounds synchronous SQLite queries. Cleanup owns only probe.
if ! timeout 60 docker run --name "$probe" --pull never --rm -i \
  --label "arthello.readonly.probe=$label" --user 1000:1000 \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 32 --memory 192m --cpus 0.25 \
  --mount "type=volume,src=$volume,dst=/data,readonly,volume-nocopy" \
  --entrypoint node "$image" --input-type=module - --production-readonly \
  < scripts/production-readonly.mjs 2>/dev/null; then
  echo 'READONLY_BLOCKED=probe_failed_or_timed_out'; exit 2
fi
test "$(observe_consumers)" = "$selection"
echo 'READONLY_FINISHED=aggregate_observation_not_live_acceptance'
