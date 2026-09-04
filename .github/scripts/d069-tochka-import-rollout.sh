#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${DATA_VOLUME:?DATA_VOLUME is required}"
: "${PUBLIC_URL:?PUBLIC_URL is required}"
: "${EXPECTED_RELEASE_SHA:?EXPECTED_RELEASE_SHA is required}"
: "${TOCHKA_START_DATE:?TOCHKA_START_DATE is required}"
: "${TOCHKA_END_DATE:?TOCHKA_END_DATE is required}"

[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
case "$RUNNER_TEMP" in
  /*) ;;
  *) printf '::error::RUNNER_TEMP must be absolute\n'; exit 2 ;;
esac
test "$RUNNER_TEMP" != / && test "$RUNNER_TEMP" != /workspace

TOCHKA_IMPORT_CLIENT="${TOCHKA_IMPORT_CLIENT:-.github/scripts/d069-tochka-import.mjs}"
TOCHKA_RECONCILE_CHECKER="${TOCHKA_RECONCILE_CHECKER:-.github/scripts/reconcile-tochka-snapshot.py}"
PRODUCTION_DATA_INVENTORY="${PRODUCTION_DATA_INVENTORY:-deploy/v52/maintenance/production-data-inventory.py}"
TOCHKA_EXPECTED_ACCOUNTS="${TOCHKA_EXPECTED_ACCOUNTS:-4}"
TOCHKA_IMPORT_MAX_ATTEMPTS="${TOCHKA_IMPORT_MAX_ATTEMPTS:-12}"
TOCHKA_IMPORT_RETRY_DELAY_MS="${TOCHKA_IMPORT_RETRY_DELAY_MS:-15000}"
PRODUCTION_LOCK_FILE=/tmp/arthello-direct-v44-data.production.lock

work="$RUNNER_TEMP/arthello-d069-tochka-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
before_live_snapshot="$work/before-live"
before_backup_snapshot="$work/before-backup"
after_snapshot="$work/after-import"
rollback_volume="arthello-d069-tochka-rollback-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
live_id=""
live_name=""
hidden_name=""
network_name=""
import_network="arthello-d069-tochka-egress-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
import_network_created=0
live_image_id=""
old_restart_name=""
old_restart_max=0
relative_db=""
before_digest=""
after_digest=""
backup_verified=0
mutation_started=0
production_touched=0
public_exposed=0
container_paused=0
client_container_path="/tmp/arthello-d069-tochka-import-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.mjs"

if [ -e "$work" ] || [ -L "$work" ]; then
  printf '::error::temporary work directory already exists\n'
  exit 2
fi
mkdir -p "$work" "$before_live_snapshot" "$before_backup_snapshot" "$after_snapshot"
chmod 0700 "$work" "$before_live_snapshot" "$before_backup_snapshot" "$after_snapshot"

validate_inputs() {
  [[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
  [[ "$EXPECTED_RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]
  [[ "$DATA_VOLUME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$ ]]
  test "$DATA_VOLUME" = arthello-direct-v44-data
  test "$TOCHKA_START_DATE" = 2026-09-01
  test "$TOCHKA_EXPECTED_ACCOUNTS" = 4
  [[ "$TOCHKA_IMPORT_MAX_ATTEMPTS" =~ ^[0-9]+$ ]]
  [[ "$TOCHKA_IMPORT_RETRY_DELAY_MS" =~ ^[0-9]+$ ]]
  test "$TOCHKA_IMPORT_MAX_ATTEMPTS" -ge 1
  test "$TOCHKA_IMPORT_MAX_ATTEMPTS" -le 30
  test "$TOCHKA_IMPORT_RETRY_DELAY_MS" -ge 1
  test "$TOCHKA_IMPORT_RETRY_DELAY_MS" -le 60000
  test "$TOCHKA_IMPORT_CLIENT" = .github/scripts/d069-tochka-import.mjs
  test "$TOCHKA_RECONCILE_CHECKER" = .github/scripts/reconcile-tochka-snapshot.py
  test "$PRODUCTION_DATA_INVENTORY" = deploy/v52/maintenance/production-data-inventory.py
  test -f "$TOCHKA_IMPORT_CLIENT"
  test -f "$TOCHKA_RECONCILE_CHECKER"
  test -f "$PRODUCTION_DATA_INVENTORY"
  python3 - "$TOCHKA_RECONCILE_CHECKER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
compile(path.read_text(encoding="utf-8"), str(path), "exec", dont_inherit=True)
PY
  python3 - "$TOCHKA_START_DATE" "$TOCHKA_END_DATE" "$PUBLIC_URL" <<'PY'
import datetime
import sys
from urllib.parse import urlsplit

start_text, end_text, public_url = sys.argv[1:]
try:
    start = datetime.date.fromisoformat(start_text)
    end = datetime.date.fromisoformat(end_text)
except ValueError:
    raise SystemExit("invalid import date")
if start.isoformat() != start_text or end.isoformat() != end_text or start > end:
    raise SystemExit("invalid import window")
if end != datetime.datetime.now(datetime.timezone.utc).date():
    raise SystemExit("TOCHKA_END_DATE must equal the current UTC date")
parsed = urlsplit(public_url)
if (
    parsed.scheme != "https"
    or not parsed.hostname
    or parsed.username is not None
    or parsed.password is not None
    or parsed.path not in {"", "/"}
    or parsed.query
    or parsed.fragment
):
    raise SystemExit("invalid PUBLIC_URL")
PY
}

directory_digest() {
  local root="$1"
  TOCHKA_DIGEST_ROOT="$root" python3 - <<'PY'
import hashlib
import os
import stat
import struct
from pathlib import Path

root = Path(os.environ["TOCHKA_DIGEST_ROOT"]).resolve(strict=True)
if not root.is_dir():
    raise SystemExit("snapshot root is not a directory")
digest = hashlib.sha256()

def add(payload: bytes) -> None:
    digest.update(struct.pack(">Q", len(payload)))
    digest.update(payload)

entries = sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix())
for path in entries:
    relative = path.relative_to(root).as_posix().encode("utf-8")
    metadata = path.lstat()
    add(relative)
    add(oct(stat.S_IMODE(metadata.st_mode)).encode("ascii"))
    if stat.S_ISDIR(metadata.st_mode):
        add(b"directory")
    elif stat.S_ISREG(metadata.st_mode):
        add(b"file")
        add(str(metadata.st_size).encode("ascii"))
        with path.open("rb") as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                add(chunk)
    elif stat.S_ISLNK(metadata.st_mode):
        add(b"symlink")
        add(os.readlink(path).encode("utf-8"))
    else:
        raise SystemExit("unsupported special file in production data")
add(str(len(entries)).encode("ascii"))
print(digest.hexdigest())
PY
}

snapshot_volume() {
  local volume_name="$1"
  local destination="$2"
  local first_entry=""
  test -d "$destination" || return 1
  first_entry="$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit)" || return 1
  test -z "$first_entry" || return 1
  docker run --rm --network none --user 0:0 \
    --mount "type=volume,src=$volume_name,dst=/from,readonly" \
    --entrypoint /bin/sh "$live_image_id" -ceu 'cd /from && tar -cpf - .' \
    | tar -xpf - -C "$destination" || return 1
  return 0
}

restore_restart_policy() {
  local container="$1"
  if [ "$old_restart_name" = on-failure ]; then
    docker update --restart="on-failure:$old_restart_max" "$container" >/dev/null || return 1
  else
    docker update --restart="$old_restart_name" "$container" >/dev/null || return 1
  fi
  test "$(docker inspect "$container" --format '{{.HostConfig.RestartPolicy.Name}}')" = "$old_restart_name" \
    || return 1
  test "$(docker inspect "$container" --format '{{.HostConfig.RestartPolicy.MaximumRetryCount}}')" = "$old_restart_max" \
    || return 1
  return 0
}

container_has_named_network() {
  local container="$1"
  local expected_network="$2"
  local attached_networks=""
  attached_networks="$(docker inspect "$container" \
    --format '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}')" \
    || return 2
  grep -Fxq "$expected_network" <<<"$attached_networks"
}

disconnect_named_network_if_present() {
  local container="$1"
  local expected_network="$2"
  local inspection_status=0
  if container_has_named_network "$container" "$expected_network"; then
    docker network disconnect "$expected_network" "$container" || return 1
  else
    inspection_status=$?
    if [ "$inspection_status" -eq 2 ]; then return 1; fi
  fi
  return 0
}

internal_ready() {
  local container="$1"
  local status
  for _ in $(seq 1 60); do
    status="$(docker exec "$container" node -e \
      "fetch('http://127.0.0.1:8081/api/health',{redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write('000'))" \
      2>/dev/null || true)"
    if [ "$status" = 200 ]; then return 0; fi
    sleep 2
  done
  return 1
}

public_ready() {
  local root_status auth_status
  for _ in $(seq 1 30); do
    root_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \
      "${PUBLIC_URL%/}/" 2>/dev/null || true)"
    auth_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \
      "${PUBLIC_URL%/}/api/auth/me" 2>/dev/null || true)"
    if [ "$root_status" = 200 ] && [ "$auth_status" = 401 ]; then return 0; fi
    sleep 2
  done
  return 1
}

verify_bootstrap_owner_password() {
  local database_path="$1"
  docker exec "$live_id" node -e '
    try {
      const fs = require("node:fs");
      const direct = process.env.ARTHELLO_BOOTSTRAP_PASSWORD || "";
      const filePath = process.env.ARTHELLO_BOOTSTRAP_PASSWORD_FILE || "";
      let password = direct;
      if (filePath) {
        const fromFile = fs.readFileSync(filePath, "utf8").trim();
        if (direct && direct !== fromFile) throw new Error("conflict");
        password = fromFile;
      }
      const login = (process.env.ARTHELLO_BOOTSTRAP_LOGIN || "owner").trim().toLowerCase();
      if (!login || !password || password.length > 512) throw new Error("invalid");
      process.stdout.write(login + "\0" + password);
    } catch {
      process.stderr.write("bootstrap credential source is unavailable\n");
      process.exit(1);
    }
  ' | TOCHKA_AUTH_DB="$database_path" python3 -c '
import base64
import hashlib
import hmac
import os
import sqlite3
import sys
import time

try:
    material = sys.stdin.buffer.read(4096)
    parts = material.split(b"\0")
    if len(parts) != 2:
        raise ValueError("shape")
    login = parts[0].decode("utf-8")
    password = parts[1].decode("utf-8")
    if not login or not password or len(password) > 512:
        raise ValueError("empty")
    path = os.environ["TOCHKA_AUTH_DB"]
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        row = connection.execute(
            "SELECT login,password_salt,password_hash,locked_until "
            "FROM production_auth_credentials WHERE user_id=?",
            ("AUTH-OWNER",),
        ).fetchone()
    finally:
        connection.close()
    if row is None or login != str(row[0]).strip().lower() or int(row[3]) > int(time.time()):
        raise ValueError("credential")
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), str(row[1]).encode("utf-8"), 310000, dklen=32
    )
    calculated = base64.urlsafe_b64encode(derived).rstrip(b"=").decode("ascii")
    if not hmac.compare_digest(calculated, str(row[2])):
        raise ValueError("password")
except Exception:
    sys.stderr.write("bootstrap owner password preflight failed\n")
    raise SystemExit(1)
print("D069_TOCHKA_BOOTSTRAP_AUTH=VERIFIED")
'
}

restore_exact_backup() {
  local restored_snapshot="$1"
  local restored_digest=""
  docker run --rm --network none --user 0:0 \
    --mount "type=volume,src=$DATA_VOLUME,dst=/to" \
    --mount "type=volume,src=$rollback_volume,dst=/from,readonly" \
    --entrypoint /bin/sh "$live_image_id" -ceu '
      find /to -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
      cd /from
      tar -cpf - . | tar -xpf - -C /to
    ' >/dev/null || return 1
  mkdir -p "$restored_snapshot" || return 1
  chmod 0700 "$restored_snapshot" || return 1
  snapshot_volume "$DATA_VOLUME" "$restored_snapshot" || return 1
  restored_digest="$(directory_digest "$restored_snapshot")" || return 1
  test "$restored_digest" = "$before_digest" || return 1
  python3 "$PRODUCTION_DATA_INVENTORY" "$restored_snapshot" >/dev/null || return 1
  return 0
}

cleanup_on_failure() {
  local original_status="${1:-1}"
  if [ "$original_status" -eq 0 ]; then return 0; fi
  trap - EXIT
  trap '' INT TERM HUP
  set +e
  local rollback_failed=0
  local exact_data=1
  local quiesced=1
  local current_name=""
  local paused_state=""
  local running_state=""
  local final_state=""
  printf '::error::Tochka production import failed; recovering production\n'

  if [ "$production_touched" -eq 1 ] \
    && [ -n "$live_id" ] \
    && docker inspect "$live_id" >/dev/null 2>&1; then
    docker update --restart=no "$live_id" >/dev/null 2>&1 || rollback_failed=1
    if [ "$import_network_created" -eq 1 ]; then
      disconnect_named_network_if_present "$live_id" "$import_network" >/dev/null 2>&1 || rollback_failed=1
    fi
    if [ "$public_exposed" -ne 1 ]; then
      disconnect_named_network_if_present "$live_id" "$network_name" >/dev/null 2>&1 || rollback_failed=1
    fi
    paused_state="$(docker inspect "$live_id" --format '{{.State.Paused}}' 2>/dev/null)" \
      || rollback_failed=1
    if [ "$paused_state" = true ]; then
      docker unpause "$live_id" >/dev/null 2>&1 || rollback_failed=1
      container_paused=0
    elif [ "$paused_state" != false ]; then
      rollback_failed=1
    fi
    if [ "$mutation_started" -eq 1 ] && [ "$public_exposed" -ne 1 ]; then
      running_state="$(docker inspect "$live_id" --format '{{.State.Running}}' 2>/dev/null)" \
        || quiesced=0
      if [ "$running_state" = true ]; then
        docker stop --time 60 "$live_id" >/dev/null 2>&1 || quiesced=0
      elif [ "$running_state" != false ]; then
        quiesced=0
      fi
      final_state="$(docker inspect "$live_id" --format '{{.State.Running}} {{.State.Paused}}' 2>/dev/null)" \
        || quiesced=0
      if [ "$final_state" != "false false" ]; then
        quiesced=0
      fi
      exact_data=0
      if [ "$backup_verified" -ne 1 ] || [ "$quiesced" -ne 1 ]; then
        rollback_failed=1
      else
        for restore_attempt in 1 2; do
          if restore_exact_backup "$work/restored-$restore_attempt" >/dev/null 2>&1; then
            exact_data=1
            break
          fi
        done
        if [ "$exact_data" -ne 1 ]; then rollback_failed=1; fi
      fi
    fi

    current_name="$(docker inspect "$live_id" --format '{{.Name}}' 2>/dev/null | sed 's#^/##')"
    if [ -n "$current_name" ] && [ -n "$live_name" ] && [ "$current_name" != "$live_name" ]; then
      docker rename "$live_id" "$live_name" >/dev/null 2>&1 || rollback_failed=1
    fi

    if [ "$exact_data" -eq 1 ]; then
      if [ "$(docker inspect "$live_id" --format '{{.State.Running}}' 2>/dev/null)" != true ]; then
        docker start "$live_id" >/dev/null 2>&1 || rollback_failed=1
      fi
      internal_ready "$live_id" >/dev/null 2>&1 || rollback_failed=1
      restore_restart_policy "$live_id" >/dev/null 2>&1 || rollback_failed=1
      if ! container_has_named_network "$live_id" "$network_name" >/dev/null 2>&1; then
        docker network connect "$network_name" "$live_id" >/dev/null 2>&1 || rollback_failed=1
      fi
      public_ready >/dev/null 2>&1 || rollback_failed=1
      docker exec --user 0:0 "$live_id" rm -f -- "$client_container_path" >/dev/null 2>&1 || rollback_failed=1
    fi
  elif [ "$production_touched" -eq 1 ]; then
    rollback_failed=1
  fi

  if [ "$import_network_created" -eq 1 ]; then
    docker network rm "$import_network" >/dev/null 2>&1 || rollback_failed=1
    import_network_created=0
  fi

  # A volume is retained as recovery evidence only after byte-for-byte
  # verification; a partial copy must never look like a usable backup.
  if [ "$backup_verified" -ne 1 ] && docker volume inspect "$rollback_volume" >/dev/null 2>&1; then
    docker volume rm "$rollback_volume" >/dev/null 2>&1 || rollback_failed=1
  fi

  rm -rf -- "$work" || rollback_failed=1
  if [ "$rollback_failed" -eq 0 ]; then
    if [ "$public_exposed" -eq 1 ]; then
      printf 'D069_TOCHKA_POST_COMMIT_RECOVERY=VERIFIED data_restore_performed=false\n'
    elif [ "$mutation_started" -eq 1 ]; then
      printf 'D069_TOCHKA_ROLLBACK=VERIFIED digest=%s\n' "$before_digest"
    else
      printf 'D069_TOCHKA_RECOVERY=VERIFIED no_data_restore_required=true\n'
    fi
    exit "$original_status"
  fi
  printf '::error::automatic Tochka rollback could not be fully verified\n'
  exit 97
}

handle_signal() {
  exit "$1"
}

preflight_cleanup() {
  local original_status="${1:-1}"
  trap - EXIT
  trap '' INT TERM HUP
  rm -rf -- "$work"
  exit "$original_status"
}

trap 'preflight_cleanup $?' EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM
trap 'handle_signal 129' HUP

command -v flock >/dev/null
if [ -L "$PRODUCTION_LOCK_FILE" ]; then
  printf '::error::production lock path must not be a symlink\n'
  exit 1
fi
exec 9>>"$PRODUCTION_LOCK_FILE"
chmod 0600 "$PRODUCTION_LOCK_FILE"
if ! flock -n 9; then
  printf '::error::another production-volume operation holds the host lock\n'
  exit 1
fi

validate_inputs

live_ids_output="$(docker ps --no-trunc -q --filter "volume=$DATA_VOLUME")"
mapfile -t live_ids <<<"$live_ids_output"
test "${#live_ids[@]}" -eq 1
live_id="${live_ids[0]}"
live_name="$(docker inspect "$live_id" --format '{{.Name}}' | sed 's#^/##')"
live_image_id="$(docker inspect "$live_id" --format '{{.Image}}')"
old_restart_name="$(docker inspect "$live_id" --format '{{.HostConfig.RestartPolicy.Name}}')"
old_restart_max="$(docker inspect "$live_id" --format '{{.HostConfig.RestartPolicy.MaximumRetryCount}}')"
test -n "$live_name"
[[ "$live_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
case "$old_restart_name" in
  no|always|unless-stopped|on-failure) ;;
  *) printf '::error::unsupported production restart policy\n'; exit 1 ;;
esac
[[ "$old_restart_max" =~ ^[0-9]+$ ]]
test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live_id" --format '{{.State.Paused}}')" = false
test "$(docker inspect "$live_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$DATA_VOLUME"
test "$(docker inspect "$live_id" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$EXPECTED_RELEASE_SHA"
test "$(docker image inspect "$live_image_id" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$EXPECTED_RELEASE_SHA"
test "$(docker image inspect "$live_image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$EXPECTED_RELEASE_SHA"

all_ids_output="$(docker ps --no-trunc -aq --filter "volume=$DATA_VOLUME")"
mapfile -t all_container_ids <<<"$all_ids_output"
test "${#all_container_ids[@]}" -ge 1
live_seen=0
for attached_id in "${all_container_ids[@]}"; do
  [[ "$attached_id" =~ ^[a-f0-9]{64}$ ]]
  if [ "$attached_id" = "$live_id" ]; then
    live_seen=$((live_seen + 1))
    continue
  fi
  test "$(docker inspect "$attached_id" --format '{{.State.Running}}')" = false
  test "$(docker inspect "$attached_id" --format '{{.State.Status}}')" = exited
  test "$(docker inspect "$attached_id" --format '{{.HostConfig.RestartPolicy.Name}}')" = no
done
test "$live_seen" -eq 1

mapfile -t networks < <(docker inspect "$live_id" --format '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}')
test "${#networks[@]}" -eq 1
network_name="${networks[0]}"
test -n "$network_name"
hidden_name="arthello-d069-tochka-hidden-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
if docker inspect "$hidden_name" >/dev/null 2>&1; then
  printf '::error::hidden import container name already exists\n'
  exit 1
fi
if docker network inspect "$import_network" >/dev/null 2>&1; then
  printf '::error::temporary import network already exists\n'
  exit 1
fi

internal_ready "$live_id"
public_ready
printf 'D069_TOCHKA_PREVIOUS_PRODUCTION=HEALTHY release=%s\n' "$EXPECTED_RELEASE_SHA"

if docker volume inspect "$rollback_volume" >/dev/null 2>&1; then
  printf '::error::rollback volume already exists\n'
  exit 1
fi

# From here onward failures must recover any newly-created resources, then the
# restart policy, network/name and (once writable) the exact data directory.
trap 'cleanup_on_failure $?' EXIT
docker volume create \
  --label arthello.scope=production-rollback \
  --label arthello.operation=d069-tochka-import \
  --label "arthello.release.sha=$EXPECTED_RELEASE_SHA" \
  --label "arthello.source.run=$GITHUB_RUN_ID" \
  --label "arthello.import.start=$TOCHKA_START_DATE" \
  --label "arthello.import.end=$TOCHKA_END_DATE" \
  "$rollback_volume" >/dev/null

import_network_id="$(docker network create \
  --driver bridge \
  --opt com.docker.network.bridge.enable_icc=false \
  --label arthello.scope=temporary-production-egress \
  --label arthello.operation=d069-tochka-import \
  --label "arthello.source.run=$GITHUB_RUN_ID" \
  "$import_network")"
import_network_created=1
[[ "$import_network_id" =~ ^[a-f0-9]{64}$ ]]
test "$(docker network inspect "$import_network" --format '{{.Name}}')" = "$import_network"
production_touched=1
docker update --restart=no "$live_id" >/dev/null
test "$(docker inspect "$live_id" --format '{{.HostConfig.RestartPolicy.Name}}')" = no
docker network disconnect "$network_name" "$live_id"
# Drain requests admitted before the public write fence. The longest bank-side
# application request is capped at 45 seconds.
sleep 55
docker pause "$live_id" >/dev/null
container_paused=1

docker run --rm --network none --user 0:0 \
  --mount "type=volume,src=$DATA_VOLUME,dst=/from,readonly" \
  --mount "type=volume,src=$rollback_volume,dst=/to" \
  --entrypoint /bin/sh "$live_image_id" -ceu '
    test -z "$(find /to -mindepth 1 -maxdepth 1 -print -quit)"
    cd /from
    tar -cpf - . | tar -xpf - -C /to
  '

snapshot_volume "$DATA_VOLUME" "$before_live_snapshot"
snapshot_volume "$rollback_volume" "$before_backup_snapshot"
before_digest="$(directory_digest "$before_live_snapshot")"
backup_digest="$(directory_digest "$before_backup_snapshot")"
[[ "$before_digest" =~ ^[a-f0-9]{64}$ ]]
test "$backup_digest" = "$before_digest"
python3 "$PRODUCTION_DATA_INVENTORY" "$before_live_snapshot" >/dev/null
python3 "$PRODUCTION_DATA_INVENTORY" "$before_backup_snapshot" >/dev/null
relative_db="$(python3 "$PRODUCTION_DATA_INVENTORY" --print-active-database-relative-path)"
test -f "$before_live_snapshot/$relative_db"
test -f "$before_backup_snapshot/$relative_db"
python3 "$PRODUCTION_DATA_INVENTORY" "$before_backup_snapshot" \
  --github-output "$work/before-credential-inventory" >/dev/null
chmod 0600 "$work/before-credential-inventory"
test "$(docker volume inspect "$rollback_volume" --format '{{index .Labels "arthello.release.sha"}}')" = "$EXPECTED_RELEASE_SHA"
backup_verified=1
printf 'D069_TOCHKA_BACKUP=VERIFIED volume=%s digest=%s\n' "$rollback_volume" "$before_digest"
{
  printf 'backup_volume=%s\n' "$rollback_volume"
  printf 'before_digest=%s\n' "$before_digest"
} >> "$GITHUB_OUTPUT"

# Keep the production DNS target absent while the same, exact release container
# performs authenticated internal API calls against the mounted production data.
docker rename "$live_id" "$hidden_name"
docker network connect "$import_network" "$live_id"
mutation_started=1
docker unpause "$live_id" >/dev/null
container_paused=0
internal_ready "$live_id"

verify_bootstrap_owner_password "$before_backup_snapshot/$relative_db"

docker cp "$TOCHKA_IMPORT_CLIENT" "$live_id:$client_container_path"
docker exec --user 0:0 "$live_id" chmod 0444 "$client_container_path"
import_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! docker exec \
  --env TOCHKA_IMPORT_AUTH_PREFLIGHT=VERIFIED \
  --env "TOCHKA_IMPORT_START_DATE=$TOCHKA_START_DATE" \
  --env "TOCHKA_IMPORT_END_DATE=$TOCHKA_END_DATE" \
  --env "TOCHKA_IMPORT_MAX_ATTEMPTS=$TOCHKA_IMPORT_MAX_ATTEMPTS" \
  --env "TOCHKA_IMPORT_RETRY_DELAY_MS=$TOCHKA_IMPORT_RETRY_DELAY_MS" \
  "$live_id" node "$client_container_path" \
  >"$work/client.stdout.jsonl" 2>"$work/client.stderr.jsonl"; then
  printf '::error::Tochka API import client failed\n'
  exit 1
fi
chmod 0600 "$work/client.stdout.jsonl" "$work/client.stderr.jsonl"

python3 - "$work/client.stdout.jsonl" "$TOCHKA_START_DATE" "$TOCHKA_END_DATE" "$work/client.result" <<'PY'
import json
import os
import sys

input_path, start_date, end_date, output_path = sys.argv[1:]
final = []
with open(input_path, encoding="utf-8") as source:
    for line in source:
        payload = json.loads(line)
        if payload.get("marker") == "TOCHKA_IMPORT_API=COMPLETE":
            final.append(payload)
if len(final) != 1:
    raise SystemExit("missing final import result")
result = final[0]
if (
    result.get("connectionId") != "INT-T-TOCHKA"
    or result.get("startDate") != start_date
    or result.get("endDate") != end_date
    or result.get("accountCount") != 4
    or result.get("statementCount") != 4
    or not isinstance(result.get("transactionCount"), int)
    or result["transactionCount"] <= 0
):
    raise SystemExit("unexpected final import result")
with open(output_path, "w", encoding="ascii") as output:
    output.write(str(result["transactionCount"]) + "\n")
os.chmod(output_path, 0o600)
print(json.dumps({
    "marker": "D069_TOCHKA_API=VERIFIED",
    "accounts": result["accountCount"],
    "statements": result["statementCount"],
    "transactions": result["transactionCount"],
    "attempts": result.get("attempts"),
}, separators=(",", ":"), sort_keys=True))
PY
IFS= read -r expected_transaction_count < "$work/client.result"
[[ "$expected_transaction_count" =~ ^[0-9]+$ ]]
test "$expected_transaction_count" -gt 0

docker exec --user 0:0 "$live_id" rm -f -- "$client_container_path"
docker network disconnect "$import_network" "$live_id"
docker pause "$live_id" >/dev/null
container_paused=1
docker network rm "$import_network" >/dev/null
import_network_created=0

snapshot_volume "$DATA_VOLUME" "$after_snapshot"
after_digest="$(directory_digest "$after_snapshot")"
[[ "$after_digest" =~ ^[a-f0-9]{64}$ ]]
python3 "$PRODUCTION_DATA_INVENTORY" "$after_snapshot" \
  --github-output "$work/after-credential-inventory" >/dev/null
chmod 0600 "$work/after-credential-inventory"

python3 - "$work/before-credential-inventory" "$work/after-credential-inventory" <<'PY'
import re
import sys
from pathlib import Path

def read_inventory(path_text: str) -> tuple[int, str]:
    values: dict[str, str] = {}
    for line in Path(path_text).read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise ValueError("invalid inventory")
        values[key] = value
    if set(values) != {
        "encrypted_credentials_present",
        "encrypted_credentials_count",
        "encrypted_credentials_digest",
    }:
        raise ValueError("invalid inventory keys")
    if values["encrypted_credentials_present"] != "true":
        raise ValueError("encrypted credentials missing")
    count_text = values["encrypted_credentials_count"]
    digest = values["encrypted_credentials_digest"]
    if not count_text.isdigit() or int(count_text) <= 0 or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("invalid credential inventory values")
    return int(count_text), digest

try:
    before = read_inventory(sys.argv[1])
    after = read_inventory(sys.argv[2])
except (OSError, ValueError):
    raise SystemExit("credential inventory validation failed")
if before != after:
    raise SystemExit("encrypted integration credentials changed during import")
print(f"D069_TOCHKA_CREDENTIAL_INVENTORY=VERIFIED count={before[0]}")
PY

python3 "$TOCHKA_RECONCILE_CHECKER" \
  --after-db "$after_snapshot/$relative_db" \
  --before-db "$before_backup_snapshot/$relative_db" \
  --start-date "$TOCHKA_START_DATE" \
  --end-date "$TOCHKA_END_DATE" \
  --min-sync-at "$import_started_at" \
  --connection-id INT-T-TOCHKA \
  --expected-accounts 4 \
  --expected-source-transaction-count "$expected_transaction_count" \
  > "$work/reconciliation.json"
chmod 0600 "$work/reconciliation.json"

python3 - "$work/reconciliation.json" "$work/safe-output" <<'PY'
import json
import os
import sys

report_path, output_path = sys.argv[1:]
with open(report_path, encoding="utf-8") as source:
    report = json.load(source)
if report.get("status") != "ok" or report.get("failures") != []:
    raise SystemExit("reconciliation failed")
counts = report.get("counts") or {}
amounts = report.get("amounts_minor") or {}
values = {
    "account_count": counts.get("accounts"),
    "statement_count": counts.get("latest_statements"),
    "transaction_count": counts.get("stored_transactions"),
    "receipt_count": counts.get("receipt_transactions"),
    "outflow_count": counts.get("outflow_transactions"),
    "bank_receipts_minor": amounts.get("bank_receipts"),
    "registry_receipts_minor": amounts.get("registry_receipts"),
    "receipt_difference_minor": amounts.get("receipt_difference"),
    "bank_outflows_minor": amounts.get("bank_outflows"),
    "registry_outflows_minor": amounts.get("registry_outflows"),
    "outflow_difference_minor": amounts.get("outflow_difference"),
}
if any(not isinstance(value, int) or value < 0 for key, value in values.items() if "difference" not in key):
    raise SystemExit("invalid reconciliation aggregate")
if values["account_count"] != 4 or values["statement_count"] != 4:
    raise SystemExit("unexpected account or statement count")
if values["transaction_count"] <= 0 or values["receipt_count"] <= 0 or values["outflow_count"] <= 0:
    raise SystemExit("real receipt and outflow activity is required")
if values["receipt_difference_minor"] != 0 or values["outflow_difference_minor"] != 0:
    raise SystemExit("registry gross totals differ from bank facts")
with open(output_path, "w", encoding="ascii", newline="\n") as output:
    for key, value in values.items():
        output.write(f"{key}={value}\n")
os.chmod(output_path, 0o600)
print(json.dumps({"marker": "D069_TOCHKA_RECONCILIATION=VERIFIED", **values}, separators=(",", ":"), sort_keys=True))
PY

test "$(docker inspect "$live_id" --format '{{.State.Paused}}')" = true
test "$(docker inspect "$live_id" --format '{{.Image}}')" = "$live_image_id"
test "$(docker inspect "$live_id" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$EXPECTED_RELEASE_SHA"

# Re-publish only after a paused, read-only snapshot has passed reconciliation.
docker rename "$live_id" "$live_name"
docker unpause "$live_id" >/dev/null
container_paused=0
internal_ready "$live_id"
restore_restart_policy "$live_id"

test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live_id" --format '{{.Image}}')" = "$live_image_id"
test "$(docker inspect "$live_id" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$EXPECTED_RELEASE_SHA"
test "$(docker volume inspect "$rollback_volume" --format '{{.Name}}')" = "$rollback_volume"

{
  printf 'after_digest=%s\n' "$after_digest"
  cat "$work/safe-output"
} >> "$GITHUB_OUTPUT"

# Network attachment is the irreversible commit boundary: once the public
# proxy may have accepted a write, failure recovery preserves imported data.
public_exposed=1
docker network connect "$network_name" "$live_id"
public_ready

printf 'D069_TOCHKA_PRODUCTION=VERIFIED release=%s window=%s..%s\n' \
  "$EXPECTED_RELEASE_SHA" "$TOCHKA_START_DATE" "$TOCHKA_END_DATE"
rm -rf -- "$work"
trap - EXIT INT TERM HUP
