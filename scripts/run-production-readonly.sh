#!/usr/bin/env bash
# D-075: existing Docker service authority; no root, secrets or source copy.
set -Eeuo pipefail
volume=arthello-direct-v44-data
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
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
mapfile -t live_ids < <(docker ps -q --filter "volume=$volume")
if [[ ${#live_ids[@]} -ne 1 ]]; then echo 'READONLY_BLOCKED=ambiguous_data_consumers'; exit 2; fi
live="${live_ids[0]}"
[[ "$live" =~ ^[a-f0-9]{12,64}$ ]]
test "$(docker inspect "$live" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$volume"
image="$(docker inspect "$live" --format '{{.Image}}')"
source="$(docker inspect "$live" --format '{{index .Config.Labels "arthello.release.sha"}}')"
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ && "$source" =~ ^[a-f0-9]{40}$ ]]
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
backup_mount="$(docker inspect "$live" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/arthello-v52-backup-control"}}present{{end}}{{end}}')"
if [[ "$backup_mount" = present ]]; then
  echo 'READONLY_BACKUP=control_mount_present_history_not_verified'
else
  echo 'READONLY_BACKUP=r7_control_mount_absent_other_backups_not_verified'
fi
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
test "$(docker inspect "$live" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live" --format '{{.Image}}')" = "$image"
echo 'READONLY_FINISHED=aggregate_observation_not_live_acceptance'
