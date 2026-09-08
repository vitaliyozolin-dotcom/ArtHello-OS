#!/usr/bin/env bash
# Run only on hosted Linux CI against the exact release image just built there.
# All data, volumes, marker nonces and scripts below are disposable test fixtures.
set -Eeuo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
: "${RUNNER_TEMP:?hosted runner temporary directory required}"
: "${GITHUB_RUN_ID:?hosted run required}"
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ ]]
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]
image="${1:?exact immutable ArtHello image ID required}"
test "$#" -eq 1
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
test "$(docker image inspect "$image" --format '{{.Id}}')" = "$image"
helper=scripts/test/arthello-backup-container-docker-check.py
test -s "$helper"
work="$(mktemp -d "$RUNNER_TEMP/arthello-backup-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.XXXXXXXX")"
key="$(basename "$work")"
label="io.arthello.backup-hosted-fixture=$key"
containers=()
volumes=()
cleanup() {
  local rc=$? name actual
  trap - EXIT INT TERM
  for name in "${containers[@]}"; do
    actual="$(docker inspect "$name" --format '{{index .Config.Labels "io.arthello.backup-hosted-fixture"}}' 2>/dev/null || true)"
    if test "$actual" = "$key"; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
  done
  for name in "${volumes[@]}"; do
    actual="$(docker volume inspect "$name" --format '{{index .Labels "io.arthello.backup-hosted-fixture"}}' 2>/dev/null || true)"
    if test "$actual" = "$key"; then docker volume rm "$name" >/dev/null 2>&1 || true; fi
  done
  rm -rf -- "$work"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp "$helper" "$work/check.py"
cat > "$work/transport.mjs" <<'JS'
import assert from 'node:assert/strict';
import { createBackupTransport } from '/app/production/backup-transport.mjs';
import { hasTochkaAutosyncActivation } from '/app/production/tochka-autosync-timer.mjs';
assert.equal(process.getuid(), 1000);
// Actual writer/reader interoperability under the app's RO activation mount.
// Do not invoke startTochkaAutosyncTimer or any bank transport.
assert.equal(await hasTochkaAutosyncActivation({releaseSha: 'a'.repeat(40), activationId: 'b'.repeat(64)}), true);
assert.equal(await hasTochkaAutosyncActivation({releaseSha: 'c'.repeat(40), activationId: 'b'.repeat(64)}), false);
assert.equal(await hasTochkaAutosyncActivation({releaseSha: 'a'.repeat(40), activationId: 'c'.repeat(64)}), false);
console.log('ARTHELLO_BACKUP_HOSTED_ACTUAL_ACTIVATION_READER=PASS');
const transport = createBackupTransport();
const read = async () => {
  const response = await transport(new Request('http://backup.internal/status'));
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.scope, 'arthello_database');
  assert.equal(value.storage, 'same_server');
  return value;
};
assert.equal((await transport(new Request('http://backup.internal/other'))).status, 403);
assert.equal((await transport(new Request('http://example.invalid/status'))).status, 403);
await new Promise(resolve => setTimeout(resolve, 5200));
const before = await read();
const previous = new Set(before.history.map(item => item.id));
const deadline = Date.now() + 90000;
let accepted = false;
while (Date.now() < deadline) {
  const response = await transport(new Request('http://backup.internal/create', {method: 'POST'}));
  if (response.status === 202) {
    assert.equal((await response.json()).state, 'running');
    accepted = true;
    break;
  }
  assert.equal(response.status, 409);
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.equal(accepted, true, 'Actual application transport never accepted a backup');
let completed = false;
while (Date.now() < deadline) {
  const value = await read();
  assert.notEqual(value.state, 'failed');
  if (value.state === 'idle' && value.history.some(item => !previous.has(item.id) && item.status === 'verified_at_creation')) {
    completed = true;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 200));
}
assert.equal(completed, true, 'Transport acceptance did not produce a verified manifest');
console.log('ARTHELLO_BACKUP_HOSTED_ACTUAL_NODE_TRANSPORT=PASS');
JS
chmod 0755 "$work"
chmod 0444 "$work/check.py" "$work/transport.mjs"
common=(--network none --read-only --cap-drop ALL --security-opt no-new-privileges:true
  --memory 256m --cpus 0.5 --pids-limit 64
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m,uid=1000,gid=1000,mode=0700
  --mount "type=bind,src=$work,dst=/fixtures,readonly" --label "$label"
  -e PYTHONDONTWRITEBYTECODE=1)
root=/var/backups/arthello-v52
control=/var/lib/arthello-v52-backup-control
activation=/var/lib/arthello-v52-tochka-activation
new_volume() {
  local name="$1"
  if docker volume inspect "$name" >/dev/null 2>&1; then
    printf 'Refusing existing fixture volume\n' >&2; exit 1
  fi
  docker volume create --label "$label" "$name" >/dev/null
  volumes+=("$name")
}
new_container() {
  local name="$1"
  shift
  if docker inspect "$name" >/dev/null 2>&1; then
    printf 'Refusing existing fixture container\n' >&2; exit 1
  fi
  docker create --name "$name" "${common[@]}" "$@" >/dev/null
  containers+=("$name")
  test "$(docker inspect "$name" --format '{{.Image}}')" = "$image"
}
run_container() {
  local name="$1"
  shift
  new_container "$name" "$@"
  docker start -a "$name"
  test "$(docker inspect "$name" --format '{{.State.ExitCode}}')" = 0
}
wait_initial() {
  local name="$1" ready=0
  for ((attempt=0; attempt<90; attempt++)); do
    if docker exec "$name" python3 -I /opt/arthello-backup/probe.py --require-initial-verified >/dev/null 2>&1; then
      ready=1; break
    fi
    if test "$(docker inspect "$name" --format '{{.State.Running}}')" != true; then
      docker logs "$name" >&2
      break
    fi
    sleep 1
  done
  test "$ready" = 1
}
data="$key-data"
backups="$key-backups"
ctl="$key-control"
act="$key-activation"
for volume in "$data" "$backups" "$ctl" "$act"; do new_volume "$volume"; done
# Docker copy-up initializes image-owned paths. No runtime root/chown container.
run_container "$key-copyup" --user 1000:1000 \
  --mount "type=volume,src=$data,dst=/data" \
  --mount "type=volume,src=$backups,dst=$root" \
  --mount "type=volume,src=$ctl,dst=$control" \
  --mount "type=volume,src=$act,dst=$activation" \
  "$image" python3 -I /fixtures/check.py seed
source="$key-source"
new_container "$source" --user 1000:1000 \
  --mount "type=volume,src=$data,dst=/data,volume-nocopy" \
  "$image" python3 -I /fixtures/check.py source
docker start "$source" >/dev/null
ready=0
for ((attempt=0; attempt<30; attempt++)); do
  if docker logs "$source" 2>&1 | grep -q '^FIXTURE_LIVE_COMMITTED_WAL_READY$'; then ready=1; break; fi
  test "$(docker inspect "$source" --format '{{.State.Running}}')" = true
  sleep 1
done
test "$ready" = 1
worker="$key-worker"
new_container "$worker" --user 1000:1000 \
  --mount "type=volume,src=$data,dst=/data,readonly,volume-nocopy" \
  --mount "type=volume,src=$backups,dst=$root,volume-nocopy" \
  --mount "type=volume,src=$ctl,dst=$control,volume-nocopy" \
  -e ARTHELLO_BACKUP_SOURCE_RELATIVE=d1/fixture.sqlite \
  "$image" python3 -I /opt/arthello-backup/worker.py
docker inspect "$worker" | jq -e --arg image "$image" --arg data "$data" --arg root "$root" --arg ctl "$control" '
  .[0] | .Image==$image and .Config.User=="1000:1000" and
  .HostConfig.NetworkMode=="none" and .HostConfig.ReadonlyRootfs==true and
  .HostConfig.CapDrop==["ALL"] and .HostConfig.Privileged==false and
  (.HostConfig.SecurityOpt | index("no-new-privileges:true") != null) and
  .HostConfig.Memory==268435456 and .HostConfig.NanoCpus==500000000 and .HostConfig.PidsLimit==64 and
  ([.Mounts[] | select(.Type=="volume")] | length)==3 and
  ([.Mounts[] | select(.Destination=="/data" and .Name==$data and .RW==false)] | length)==1 and
  ([.Mounts[] | select(.Destination==$root and .RW==true)] | length)==1 and
  ([.Mounts[] | select(.Destination==$ctl and .RW==true)] | length)==1
' >/dev/null
docker start "$worker" >/dev/null
wait_initial "$worker"
docker exec "$worker" python3 -I /opt/arthello-backup/probe.py --status
docker exec "$worker" python3 -I /fixtures/check.py isolation --kind worker
docker exec "$worker" python3 -I /fixtures/check.py manifests > "$work/initial-manifests.json"
cat "$work/initial-manifests.json"
# Independent invocation performs another complete restore verification.
backup_id="$(docker exec "$worker" python3 -I -c 'from pathlib import Path; p=sorted(Path("/var/backups/arthello-v52").glob("arthello-v52-*/manifest.json")); assert p; print(p[-1].parent.name)')"
[[ "$backup_id" =~ ^arthello-v52-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$ ]]
docker exec "$worker" python3 -I /opt/arthello-backup/backup.py --verify "$root/$backup_id"
printf 'ARTHELLO_BACKUP_HOSTED_LIVE_WAL_RESTORE=PASS\n'
# A competing real process must fail its singleton lock without touching socket.
competitor="$key-competing-worker"
new_container "$competitor" --user 1000:1000 \
  --mount "type=volume,src=$data,dst=/data,readonly,volume-nocopy" \
  --mount "type=volume,src=$backups,dst=$root,volume-nocopy" \
  --mount "type=volume,src=$ctl,dst=$control,volume-nocopy" \
  -e ARTHELLO_BACKUP_SOURCE_RELATIVE=d1/fixture.sqlite \
  "$image" python3 -I /opt/arthello-backup/worker.py
docker start "$competitor" >/dev/null
stopped=0
for ((attempt=0; attempt<15; attempt++)); do
  if test "$(docker inspect "$competitor" --format '{{.State.Running}}')" = false; then stopped=1; break; fi
  sleep 1
done
test "$stopped" = 1
test "$(docker inspect "$competitor" --format '{{.State.ExitCode}}')" != 0
docker logs "$competitor" 2>&1 | grep -q 'worker_already_running'
wait_initial "$worker"
printf 'ARTHELLO_BACKUP_HOSTED_SINGLETON_WORKER=PASS\n'
# Dedicated UID1002 is the only writer of the separate activation volume.
run_container "$key-activation-check" --user 1002:1000 \
  --mount "type=volume,src=$act,dst=$activation,volume-nocopy" \
  "$image" python3 -I /opt/arthello-backup/activation-volume.py check-empty --directory "$activation"
run_container "$key-activation-write" --user 1002:1000 \
  --mount "type=volume,src=$act,dst=$activation,volume-nocopy" \
  "$image" python3 -I /opt/arthello-backup/activation-volume.py write --directory "$activation" \
  --release-sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --nonce bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
wrong_writer="$key-wrong-uid-writer"
new_container "$wrong_writer" --user 1000:1000 \
  --mount "type=volume,src=$act,dst=$activation,volume-nocopy" \
  "$image" python3 -I /opt/arthello-backup/activation-volume.py write --directory "$activation" \
  --release-sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --nonce bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
docker start "$wrong_writer" >/dev/null
stopped=0
for ((attempt=0; attempt<15; attempt++)); do
  if test "$(docker inspect "$wrong_writer" --format '{{.State.Running}}')" = false; then stopped=1; break; fi
  sleep 1
done
test "$stopped" = 1
test "$(docker inspect "$wrong_writer" --format '{{.State.ExitCode}}')" != 0
printf 'ARTHELLO_BACKUP_HOSTED_ACTIVATION_WRONG_UID_WRITER_REFUSED=PASS\n'
app="$key-app"
new_container "$app" --user 1000:1000 \
  --mount "type=volume,src=$ctl,dst=$control,readonly,volume-nocopy" \
  --mount "type=volume,src=$act,dst=$activation,readonly,volume-nocopy" \
  "$image" python3 -I -c 'import time; time.sleep(900)'
docker start "$app" >/dev/null
docker inspect "$app" | jq -e --arg image "$image" --arg ctl "$control" --arg act "$activation" '
  .[0] | .Image==$image and .Config.User=="1000:1000" and
  ([.Mounts[] | select(.Type=="volume")] | length)==2 and
  ([.Mounts[] | select(.Destination==$ctl and .RW==false)] | length)==1 and
  ([.Mounts[] | select(.Destination==$act and .RW==false)] | length)==1
' >/dev/null
docker exec "$app" python3 -I /fixtures/check.py isolation --kind app
docker exec "$app" node /fixtures/transport.mjs
docker exec "$app" python3 -I /fixtures/check.py manual
docker exec "$worker" python3 -I /fixtures/check.py manifests
docker exec "$app" python3 -I /fixtures/check.py status > "$work/before-restart.json"
docker stop --time 15 "$worker" >/dev/null
test "$(docker inspect "$worker" --format '{{.State.Running}}')" = false
docker start "$worker" >/dev/null
wait_initial "$worker"
docker exec "$app" python3 -I /fixtures/check.py status > "$work/after-restart.json"
python3 -I -B - "$work/before-restart.json" "$work/after-restart.json" <<'PY'
import json, sys
before, after = [json.load(open(p)) for p in sys.argv[1:]]
assert before['history'] == after['history'], 'Restart duplicated a completed backup or lost history'
assert before['schedule']['lastTriggeredAt'] == after['schedule']['lastTriggeredAt']
assert after['schedule']['enabled'] is True and after['state'] == 'idle'
print('ARTHELLO_BACKUP_HOSTED_RESTART_DURABLE_HISTORY=PASS')
PY
# Advance only disposable persisted fixture state to represent a missed slot.
# The real worker clock, immutable executable and admission path stay unchanged.
docker stop --time 15 "$worker" >/dev/null
run_container "$key-missed-slot" --user 1000:1000 \
  --mount "type=volume,src=$backups,dst=$root,volume-nocopy" \
  "$image" python3 -I /fixtures/check.py overdue
docker start "$worker" >/dev/null
wait_initial "$worker"
docker exec "$app" python3 -I /fixtures/check.py status > "$work/after-catchup.json"
python3 -I -B - "$work/after-restart.json" "$work/after-catchup.json" <<'PY'
import json, sys
before, after = [json.load(open(p)) for p in sys.argv[1:]]
old = {record['id'] for record in before['history']}
new = {record['id'] for record in after['history']}
assert old.issubset(new) and len(new - old) == 1, 'Missed slot did not produce exactly one verified copy'
assert after['schedule']['enabled'] is True and after['schedule']['lastTriggeredAt']
assert after['schedule']['lastTriggeredAt'] != before['schedule']['lastTriggeredAt']
assert after['state'] == 'idle'
print('ARTHELLO_BACKUP_HOSTED_MISSED_SLOT_CATCHUP=PASS')
PY
docker stop --time 15 "$worker" >/dev/null
docker start "$worker" >/dev/null
wait_initial "$worker"
docker exec "$app" python3 -I /fixtures/check.py status > "$work/after-catchup-restart.json"
python3 -I -B - "$work/after-catchup.json" "$work/after-catchup-restart.json" <<'PY'
import json, sys
before, after = [json.load(open(p)) for p in sys.argv[1:]]
assert before['history'] == after['history']
assert before['schedule'] == after['schedule']
assert after['state'] == 'idle'
print('ARTHELLO_BACKUP_HOSTED_CATCHUP_NO_DUPLICATE_AFTER_RESTART=PASS')
PY
docker exec "$worker" python3 -I /fixtures/check.py manifests > "$work/final-manifests.json"
python3 -I -B - "$work/initial-manifests.json" "$work/final-manifests.json" <<'PY'
import json, sys
before, after = [json.load(open(p)) for p in sys.argv[1:]]
assert after['maximumCommittedCounter'] > before['maximumCommittedCounter'], 'Source writer did not continue through manual/catch-up backups'
assert after['verifiedManifests'] > before['verifiedManifests']
print('ARTHELLO_BACKUP_HOSTED_ONGOING_WRITES_CONSISTENT_SNAPSHOTS=PASS')
PY
test "$(docker inspect "$source" --format '{{.State.Running}}')" = true
docker exec "$source" python3 -I /fixtures/check.py unchanged-source
# Deliberately invalid fixture sources must fail before a backup/schedule starts.
# Foreign ownership is obtained by creation under UID1002, never runtime chown.
for kind in mode foreign; do
  bad_data="$key-$kind-data"; bad_backups="$key-$kind-backups"; bad_ctl="$key-$kind-control"
  for volume in "$bad_data" "$bad_backups" "$bad_ctl"; do new_volume "$volume"; done
  if test "$kind" = foreign; then
    run_container "$key-$kind-source" --user 1002:1000 \
      --mount "type=volume,src=$bad_data,dst=$activation" \
      "$image" python3 -I /fixtures/check.py source --kind foreign --directory "$activation/d1"
  else
    run_container "$key-$kind-source" --user 1000:1000 \
      --mount "type=volume,src=$bad_data,dst=/data" \
      "$image" python3 -I /fixtures/check.py source --kind mode
  fi
  bad_worker="$key-$kind-worker"
  new_container "$bad_worker" --user 1000:1000 \
    --mount "type=volume,src=$bad_data,dst=/data,readonly,volume-nocopy" \
    --mount "type=volume,src=$bad_backups,dst=$root" \
    --mount "type=volume,src=$bad_ctl,dst=$control" \
    -e ARTHELLO_BACKUP_SOURCE_RELATIVE=d1/fixture.sqlite \
    "$image" python3 -I /opt/arthello-backup/worker.py
  docker start "$bad_worker" >/dev/null
  stopped=0
  for ((attempt=0; attempt<20; attempt++)); do
    if test "$(docker inspect "$bad_worker" --format '{{.State.Running}}')" = false; then stopped=1; break; fi
    sleep 1
  done
  test "$stopped" = 1
  test "$(docker inspect "$bad_worker" --format '{{.State.ExitCode}}')" != 0
  run_container "$key-$kind-inspect" --user 1000:1000 \
    --mount "type=volume,src=$bad_data,dst=/data,readonly,volume-nocopy" \
    --mount "type=volume,src=$bad_backups,dst=$root,readonly,volume-nocopy" \
    "$image" python3 -I -c 'import os,stat,sys; from pathlib import Path; p=Path("/data/d1/fixture.sqlite"); k=sys.argv[1]; assert not list(Path("/var/backups/arthello-v52").glob("arthello-v52-*")); s=p.stat() if k=="mode" else Path("/data").stat(); assert (s.st_uid,stat.S_IMODE(s.st_mode)) == ((1000,0o666) if k=="mode" else (1002,0o750)); print("ARTHELLO_BACKUP_HOSTED_INVALID_SOURCE_REFUSED_WITHOUT_CHOWN="+k)' "$kind"
done
printf 'ARTHELLO_BACKUP_R7_HOSTED_DOCKER_RO_WAL_SOCKET_RESTART_ISOLATION=VERIFIED\n'
