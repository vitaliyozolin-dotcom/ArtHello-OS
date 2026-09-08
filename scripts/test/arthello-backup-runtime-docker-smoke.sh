#!/usr/bin/env bash
# Exercise the exact production resource controller only on an ephemeral hosted
# Docker engine. The canonical source volume below is a newly created CI fixture.
set -Eeuo pipefail
umask 077
test "$GITHUB_ACTIONS" = true
test "$RUNNER_ENVIRONMENT" = github-hosted
test -n "$RUNNER_TEMP"
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ ]]
[[ "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
test "$#" -eq 1
image="$1"
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
test "$(docker image inspect "$image" --format '{{.Id}}')" = "$image"
source_volume=arthello-direct-v44-data
source_relative=d1/miniflare-D1DatabaseObject/5a499c55f63d6b9f725547d510cf454e288954b6f3c2d5024eb1443f29c97730.sqlite
work="$(mktemp -d "$RUNNER_TEMP/arthello-runtime-controller-$GITHUB_RUN_ID.XXXXXXXX")"
key="$(basename "$work")"
source_name="$key-source"
source_id=
source_created=
source_owned=0
sha="$(git rev-parse HEAD)"
tree="$(git rev-parse HEAD^{tree})"
state="$work/state/backup-runtime-state.json"
install -d -m 0700 "$work/state"
controller() {
  python3 -I -B .github/scripts/r7-backup-runtime.py "$@" \
    --image-id "$image" --release-sha "$sha" --tree-sha "$tree" \
    --run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT" \
    --source-relative "$source_relative" --state-file "$state"
}
cleanup() {
  local rc=$? cleanup_failed=0 current
  trap - EXIT INT TERM
  set +e
  if test -f "$state"; then
    controller cleanup > "$work/cleanup.json"
    if test "$?" -ne 0; then cleanup_failed=1; fi
  fi
  if test -n "$source_id"; then
    current="$(docker container inspect "$source_id" --format '{{index .Config.Labels "io.arthello.controller-fixture"}}' 2>/dev/null)"
    if test "$current" = "$key"; then
      docker container stop --time 10 "$source_id" >/dev/null
      docker container rm "$source_id" >/dev/null
      if test "$?" -ne 0; then cleanup_failed=1; fi
    else
      cleanup_failed=1
    fi
  fi
  if test "$source_owned" = 1; then
    current="$(docker volume inspect "$source_volume" --format '{{index .Labels "io.arthello.controller-fixture"}} {{.CreatedAt}}' 2>/dev/null)"
    if test "$current" = "$key $source_created"; then
      docker volume rm "$source_volume" >/dev/null
      if test "$?" -ne 0; then cleanup_failed=1; fi
    else
      cleanup_failed=1
    fi
  fi
  rm -rf -- "$work"
  if test "$rc" = 0 && test "$cleanup_failed" != 0; then rc=1; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Error/permission failure is not accepted as evidence of absence.
docker volume ls --format '{{.Name}}' > "$work/volumes.txt"
if grep -Fx "$source_volume" "$work/volumes.txt" >/dev/null; then
  echo 'Canonical volume already exists on this CI engine; refusing fixture' >&2
  exit 1
fi
test "$(docker volume create --driver local --label "io.arthello.controller-fixture=$key" "$source_volume")" = "$source_volume"
test "$(docker volume inspect "$source_volume" --format '{{index .Labels "io.arthello.controller-fixture"}}')" = "$key"
source_created="$(docker volume inspect "$source_volume" --format '{{.CreatedAt}}')"
test -n "$source_created"
source_owned=1
cat > "$work/source.py" <<'PY'
import os, pathlib, signal, sqlite3, threading
assert os.geteuid() == os.getegid() == 1000
os.umask(0o077)
path = pathlib.Path('/data/d1/miniflare-D1DatabaseObject/5a499c55f63d6b9f725547d510cf454e288954b6f3c2d5024eb1443f29c97730.sqlite')
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
db = sqlite3.connect(path)
db.executescript('CREATE TABLE app_users(id INTEGER PRIMARY KEY);'
                 'CREATE TABLE entities(id INTEGER PRIMARY KEY, value TEXT);'
                 'CREATE TABLE system_runtime_state(id INTEGER PRIMARY KEY);')
db.commit()
assert db.execute('PRAGMA journal_mode=WAL').fetchone()[0] == 'wal'
db.execute('PRAGMA wal_autocheckpoint=0')
db.execute('INSERT INTO entities VALUES(1, ?)', ('canonical-controller-fixture',))
db.commit()
assert pathlib.Path(str(path) + '-wal').stat().st_size > 32
print('ARTHELLO_CANONICAL_CONTROLLER_SOURCE_READY', flush=True)
stopped = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: stopped.set())
signal.signal(signal.SIGINT, lambda *_: stopped.set())
while not stopped.wait(1):
    pass
db.close()
PY
chmod 0755 "$work"
chmod 0444 "$work/source.py"
source_id="$(docker container create --name "$source_name" --user 1000:1000 \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 128m --cpus 0.25 --pids-limit 32 \
  --label "io.arthello.controller-fixture=$key" \
  --mount "type=volume,source=$source_volume,target=/data" \
  --mount "type=bind,source=$work/source.py,target=/fixtures/source.py,readonly" \
  --entrypoint python3 "$image" -I -B /fixtures/source.py)"
[[ "$source_id" =~ ^[a-f0-9]{64}$ ]]
docker container start "$source_id" >/dev/null
ready=0
for ((attempt=0; attempt<30; attempt++)); do
  if docker container logs "$source_id" 2>&1 | grep -Fq 'ARTHELLO_CANONICAL_CONTROLLER_SOURCE_READY'; then
    ready=1; break
  fi
  test "$(docker container inspect "$source_id" --format '{{.State.Running}}')" = true
  sleep 1
done
test "$ready" = 1
python3 -I - "$work/source-prerequisite.cjs" <<'PY'
from pathlib import Path
import sys, textwrap
text = Path('.github/workflows/deploy-arthello-recovery-r7-20260908.yml').read_text()
start, end = "<<'D069_SOURCE_READONLY'\n", '\n        D069_SOURCE_READONLY'
assert text.count(start) == 1
body = text.split(start, 1)[1].split(end, 1)[0]
assert body and end in text
Path(sys.argv[1]).write_text(textwrap.dedent(body) + '\n')
PY
docker container exec --user 1000:1000 -i "$source_id" node < "$work/source-prerequisite.cjs" > "$work/source-prerequisite.json"
python3 -I - "$work/source-prerequisite.json" <<'PY'
import json, sys
proof = json.load(open(sys.argv[1]))
assert proof['schemaVersion'] == 1 and proof['sourceReadable'] is True and proof['sourceOwnershipVerified'] is True
assert proof['sourceUid'] == proof['sourceGid'] == 1000
assert proof['sourceMode'] == '0600'
print('ARTHELLO_R7_EXACT_READONLY_SOURCE_PREREQUISITE_ACTUAL_NODE=VERIFIED')
PY
# State is private to the ordinary hosted runner, not the fixture's UID1000.
test "$(stat -c %a "$work/state")" = 700
controller prepare > "$work/receipt.json"
python3 -I - "$work/receipt.json" "$sha" "$tree" "$image" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" <<'PY'
import json, sys
receipt = json.load(open(sys.argv[1]))
assert receipt['schemaVersion'] == 1 and receipt['state'] == 'verified'
assert [receipt[k] for k in ('releaseSha', 'treeSha', 'imageId', 'runId', 'attempt')] == sys.argv[2:]
assert receipt['sourceVolume'] == 'arthello-direct-v44-data'
assert set(receipt['volumes']) == {'backups', 'control', 'activation'}
assert receipt['backup']['historyCount'] >= 1
print('ARTHELLO_R7_EXACT_CONTROLLER_PREPARE_ACTUAL_DOCKER=VERIFIED')
PY
controller cleanup > "$work/cleanup.json"
python3 -I - "$work/cleanup.json" "$work/receipt.json" <<'PY'
import json, subprocess, sys
result, receipt = [json.load(open(p)) for p in sys.argv[1:]]
assert result['state'] == 'cleaned' and result['removed'] == 4
containers = set(subprocess.check_output(['docker', 'container', 'ls', '--all', '--quiet', '--no-trunc'], text=True).splitlines())
assert receipt['worker']['id'] not in containers
names = set(subprocess.check_output(['docker', 'volume', 'ls', '--format', '{{.Name}}'], text=True).splitlines())
assert all(item['name'] not in names for item in receipt['volumes'].values())
print('ARTHELLO_R7_EXACT_CONTROLLER_CLEANUP_ACTUAL_DOCKER=VERIFIED')
PY
test "$(docker container inspect "$source_id" --format '{{.State.Running}}')" = true
test "$(docker volume inspect "$source_volume" --format '{{index .Labels "io.arthello.controller-fixture"}}')" = "$key"
echo 'ARTHELLO_R7_EXACT_CONTROLLER_PRESERVES_SOURCE=VERIFIED'
