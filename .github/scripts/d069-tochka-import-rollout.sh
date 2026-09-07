#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

self_test=0
case "${1:-}" in
  --self-test) self_test=1; shift ;;
  "") ;;
  *) printf '::error::unsupported rollout argument\n'; exit 2 ;;
esac
test "$#" -eq 0

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

supervisor_process_matches() {
  local process_id="$1"
  local expected_start_ticks="$2"
  python3 - "$process_id" "$expected_start_ticks" <<'PY'
import pathlib
import sys

process_id, expected = sys.argv[1:]
try:
    raw = pathlib.Path(f"/proc/{process_id}/stat").read_text(encoding="ascii")
    # The command name is parenthesized and may itself contain spaces. Fields
    # after its final ')' begin with field 3; starttime is field 22.
    fields_after_name = raw.rsplit(")", 1)[1].split()
    current = fields_after_name[19]
except (IndexError, OSError, ValueError):
    raise SystemExit(1)
raise SystemExit(0 if current == expected else 1)
PY
}

read_supervisor_start() {
  local record_path="$1"
  python3 - "$record_path" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" <<'PY'
import re
import sys
from pathlib import Path

path, run_id, run_attempt = sys.argv[1:]
try:
    lines = Path(path).read_text(encoding="ascii").splitlines()
except OSError:
    raise SystemExit(1)
values = {}
for line in lines:
    key, separator, value = line.partition("=")
    if not separator or not key or key in values:
        raise SystemExit(1)
    values[key] = value
if set(values) != {"version", "run_id", "run_attempt", "pid", "start_ticks"}:
    raise SystemExit(1)
if values["version"] != "1" or values["run_id"] != run_id or values["run_attempt"] != run_attempt:
    raise SystemExit(1)
if not re.fullmatch(r"[1-9][0-9]*", values["pid"]) or int(values["pid"]) <= 1:
    raise SystemExit(1)
if not re.fullmatch(r"[1-9][0-9]*", values["start_ticks"]):
    raise SystemExit(1)
print(values["pid"], values["start_ticks"])
PY
}

read_supervisor_status() {
  local record_path="$1"
  local expected_pid="$2"
  local expected_start_ticks="$3"
  python3 - \
    "$record_path" \
    "$GITHUB_RUN_ID" \
    "$GITHUB_RUN_ATTEMPT" \
    "$expected_pid" \
    "$expected_start_ticks" <<'PY'
import re
import sys
from pathlib import Path

path, run_id, run_attempt, process_id, start_ticks = sys.argv[1:]
try:
    lines = Path(path).read_text(encoding="ascii").splitlines()
except OSError:
    raise SystemExit(1)
values = {}
for line in lines:
    key, separator, value = line.partition("=")
    if not separator or not key or key in values:
        raise SystemExit(1)
    values[key] = value
if set(values) != {
    "version", "run_id", "run_attempt", "pid", "start_ticks", "exit_code"
}:
    raise SystemExit(1)
if (
    values["version"] != "1"
    or values["run_id"] != run_id
    or values["run_attempt"] != run_attempt
    or values["pid"] != process_id
    or values["start_ticks"] != start_ticks
    or not re.fullmatch(r"(?:0|[1-9][0-9]{0,2})", values["exit_code"])
    or int(values["exit_code"]) > 255
):
    raise SystemExit(1)
print(values["exit_code"])
PY
}

normalize_supervisor_output() {
  local input_path="$1"
  local output_path="$2"
  local expected_backup="$3"
  python3 - "$input_path" "$output_path" "$expected_backup" <<'PY'
import os
import re
import sys
from pathlib import Path

input_path, output_path, expected_backup = sys.argv[1:]
order = [
    "backup_volume",
    "before_digest",
    "after_digest",
    "account_count",
    "statement_count",
    "transaction_count",
    "receipt_count",
    "outflow_count",
    "bank_receipts_minor",
    "registry_receipts_minor",
    "receipt_difference_minor",
    "bank_outflows_minor",
    "registry_outflows_minor",
    "outflow_difference_minor",
]
try:
    lines = Path(input_path).read_text(encoding="ascii").splitlines()
except OSError:
    raise SystemExit("detached rollout output is unavailable")
values = {}
for line in lines:
    key, separator, value = line.partition("=")
    if not separator or key not in order or key in values or not value:
        raise SystemExit("detached rollout output is malformed")
    values[key] = value
if set(values) != set(order):
    raise SystemExit("detached rollout output is incomplete")
if values["backup_volume"] != expected_backup:
    raise SystemExit("detached rollout backup identity changed")
for key in ("before_digest", "after_digest"):
    if not re.fullmatch(r"[a-f0-9]{64}", values[key]):
        raise SystemExit("detached rollout digest is malformed")
integer_keys = set(order) - {"backup_volume", "before_digest", "after_digest"}
for key in integer_keys:
    if not re.fullmatch(r"-?[0-9]+", values[key]):
        raise SystemExit("detached rollout aggregate is malformed")
    values[key] = str(int(values[key]))
if values["account_count"] != "4" or values["statement_count"] != "4":
    raise SystemExit("detached rollout cardinality changed")
for key in integer_keys - {"receipt_difference_minor", "outflow_difference_minor"}:
    if int(values[key]) < 0:
        raise SystemExit("detached rollout aggregate is negative")
for key in ("transaction_count", "receipt_count", "outflow_count"):
    if int(values[key]) <= 0:
        raise SystemExit("detached rollout has no real activity")
if values["receipt_difference_minor"] != "0" or values["outflow_difference_minor"] != "0":
    raise SystemExit("detached rollout reconciliation differs")
temporary_path = f"{output_path}.tmp.{os.getpid()}"
with open(temporary_path, "x", encoding="ascii", newline="\n") as output:
    for key in order:
        output.write(f"{key}={values[key]}\n")
os.chmod(temporary_path, 0o600)
os.replace(temporary_path, output_path)
PY
}

supervise_rollout() {
  local source_root=""
  local runner_temp_real=""
  local supervisor_root=""
  local supervisor_root_real=""
  local bundle_root=""
  local child_runtime=""
  local child_output=""
  local child_log=""
  local start_record=""
  local status_record=""
  local normalized_output=""
  local launcher_pid=""
  local child_pid=""
  local child_start_ticks=""
  local child_status=""
  local expected_blob=""
  local copied_blob=""
  local destination=""
  local path=""
  local var_tmp_mode=""
  local wait_iteration=0
  local process_gone=0
  local supervisor_max_runtime=120m
  local expected_backup="arthello-d069-tochka-rollback-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  local -a runtime_paths=(
    .github/scripts/d069-tochka-import-rollout.sh
    .github/scripts/d069-tochka-import.mjs
    .github/scripts/reconcile-tochka-snapshot.py
    deploy/v52/maintenance/production-data-inventory.py
  )

  command -v git >/dev/null
  command -v mktemp >/dev/null
  command -v nohup >/dev/null
  command -v setsid >/dev/null
  command -v timeout >/dev/null
  command -v realpath >/dev/null
  command -v python3 >/dev/null
  setsid --help 2>&1 | grep -Fq -- '--fork'
  test -d /var/tmp
  test ! -L /var/tmp
  test "$(stat -c %u /var/tmp)" -eq 0
  var_tmp_mode="$(stat -c %a /var/tmp)"
  [[ "$var_tmp_mode" =~ ^[0-7]{3,4}$ ]]
  test $(( (8#$var_tmp_mode & 18) == 0 || (8#$var_tmp_mode & 512) != 0 )) -eq 1

  : "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
  source_root="$(pwd -P)"
  test "$source_root" = "$(realpath -e "$GITHUB_WORKSPACE")"
  test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
  runner_temp_real="$(realpath -e "$RUNNER_TEMP")"
  supervisor_root="$(mktemp -d "/var/tmp/arthello-d069-tochka-supervisor-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.XXXXXX")"
  chmod 0700 "$supervisor_root"
  test ! -L "$supervisor_root"
  test "$(stat -c %u "$supervisor_root")" -eq "$(id -u)"
  test "$(stat -c %a "$supervisor_root")" = 700
  supervisor_root_real="$(realpath -e "$supervisor_root")"
  case "$supervisor_root_real" in
    "$runner_temp_real"|"$runner_temp_real"/*)
      printf '::error::detached supervisor root must be outside RUNNER_TEMP\n'
      return 2
      ;;
  esac

  bundle_root="$supervisor_root/bundle"
  child_runtime="$supervisor_root/runtime"
  child_output="$supervisor_root/child.github-output"
  child_log="$supervisor_root/child.log"
  start_record="$supervisor_root/started"
  status_record="$supervisor_root/terminal-status"
  normalized_output="$supervisor_root/normalized.github-output"
  mkdir -p "$bundle_root" "$child_runtime"
  chmod 0700 "$bundle_root" "$child_runtime"
  for path in "${runtime_paths[@]}"; do
    test -f "$path"
    test ! -L "$path"
    expected_blob="$(git rev-parse "$GITHUB_SHA:$path")"
    [[ "$expected_blob" =~ ^[a-f0-9]{40,64}$ ]]
    test "$(git hash-object --path="$path" "$path")" = "$expected_blob"
    destination="$bundle_root/$path"
    mkdir -p "$(dirname "$destination")"
    cp -- "$path" "$destination"
    chmod 0400 "$destination"
    copied_blob="$(git hash-object --path="$path" "$destination")"
    test "$copied_blob" = "$expected_blob"
  done
  : > "$child_output"
  : > "$child_log"
  chmod 0600 "$child_output" "$child_log"

  printf 'D069_TOCHKA_SUPERVISOR=STARTING root=%s\n' "$supervisor_root_real"
  (
    cd "$bundle_root"
    exec env \
      -u RUNNER_TRACKING_ID \
      -u GH_TOKEN \
      -u GITHUB_TOKEN \
      -u ACTIONS_RUNTIME_TOKEN \
      -u ACTIONS_ID_TOKEN_REQUEST_TOKEN \
      -u ACTIONS_ID_TOKEN_REQUEST_URL \
      -u ACTIONS_RUNTIME_URL \
      -u ACTIONS_CACHE_URL \
      -u ACTIONS_RESULTS_URL \
      D069_SUPERVISED_CHILD=1 \
      D069_SUPERVISOR_ROOT="$supervisor_root_real" \
      RUNNER_TEMP="$child_runtime" \
      GITHUB_OUTPUT="$child_output" \
      nohup setsid --fork bash -c '
        set -Eeuo pipefail
        umask 077
        bundle_root="$1"
        rollout_path="$2"
        start_record="$3"
        status_record="$4"
        run_id="$5"
        run_attempt="$6"
        max_runtime="$7"
        test "$max_runtime" = 120m
        namespace_process_id="$BASHPID"
        [[ "$namespace_process_id" =~ ^[1-9][0-9]*$ ]]
        identity_temporary="$start_record.identity.$namespace_process_id"
        test ! -e "$identity_temporary"
        # Run Python as a direct foreground child. Its host-visible PPid is the
        # detached Bash process; NSpid proves that this is our Bash namespace PID.
        python3 - "$namespace_process_id" > "$identity_temporary" <<'"'"'PY'"'"'
import pathlib
import re
import sys

namespace_pid = sys.argv[1]
self_after_name = pathlib.Path("/proc/self/stat").read_text(encoding="ascii").rsplit(")", 1)[1].split()
host_parent = self_after_name[1]
if not re.fullmatch(r"[1-9][0-9]*", host_parent) or int(host_parent) <= 1:
    raise SystemExit(1)
status_lines = pathlib.Path(f"/proc/{host_parent}/status").read_text(encoding="ascii").splitlines()
namespace_ids = [line.split()[1:] for line in status_lines if line.startswith("NSpid:")]
if len(namespace_ids) != 1 or not namespace_ids[0] or namespace_ids[0][-1] != namespace_pid:
    raise SystemExit(1)
parent_after_name = pathlib.Path(f"/proc/{host_parent}/stat").read_text(encoding="ascii").rsplit(")", 1)[1].split()
start_ticks = parent_after_name[19]
if not re.fullmatch(r"[1-9][0-9]*", start_ticks):
    raise SystemExit(1)
print(host_parent, start_ticks)
PY
        read -r process_id process_start_ticks < "$identity_temporary"
        rm -f -- "$identity_temporary"
        [[ "$process_id" =~ ^[1-9][0-9]*$ ]]
        test "$process_id" -gt 1
        [[ "$process_start_ticks" =~ ^[1-9][0-9]*$ ]]
        start_temporary="$start_record.tmp.$process_id"
        {
          printf "version=1\n"
          printf "run_id=%s\n" "$run_id"
          printf "run_attempt=%s\n" "$run_attempt"
          printf "pid=%s\n" "$process_id"
          printf "start_ticks=%s\n" "$process_start_ticks"
        } > "$start_temporary"
        chmod 0600 "$start_temporary"
        mv -f -- "$start_temporary" "$start_record"
        cd "$bundle_root"
        set +e
        # This watchdog lives inside the detached session. Its one TERM reaches
        # the rollout and any blocked foreground command; the rollout trap then
        # performs recovery without a later forced kill interrupting rollback.
        timeout --preserve-status --signal=TERM "$max_runtime" bash "$rollout_path"
        rollout_status=$?
        status_temporary="$status_record.tmp.$process_id"
        {
          printf "version=1\n"
          printf "run_id=%s\n" "$run_id"
          printf "run_attempt=%s\n" "$run_attempt"
          printf "pid=%s\n" "$process_id"
          printf "start_ticks=%s\n" "$process_start_ticks"
          printf "exit_code=%s\n" "$rollout_status"
        } > "$status_temporary"
        chmod 0600 "$status_temporary"
        mv -f -- "$status_temporary" "$status_record"
        exit "$rollout_status"
      ' bash \
      "$bundle_root" \
      .github/scripts/d069-tochka-import-rollout.sh \
      "$start_record" \
      "$status_record" \
      "$GITHUB_RUN_ID" \
      "$GITHUB_RUN_ATTEMPT" \
      "$supervisor_max_runtime"
  ) </dev/null >> "$child_log" 2>&1 &
  launcher_pid="$!"
  if ! wait "$launcher_pid"; then
    cat "$child_log"
    printf '::error::detached rollout launcher failed; evidence retained at %s\n' "$supervisor_root_real"
    return 1
  fi

  for wait_iteration in $(seq 1 300); do
    if [ -f "$start_record" ]; then break; fi
    sleep 0.1
  done
  if [ ! -f "$start_record" ]; then
    cat "$child_log"
    printf '::error::detached rollout did not publish its identity; evidence retained at %s\n' "$supervisor_root_real"
    return 1
  fi
  read -r child_pid child_start_ticks < <(read_supervisor_start "$start_record")
  if ! supervisor_process_matches "$child_pid" "$child_start_ticks" && [ ! -f "$status_record" ]; then
    sleep 1
    if [ ! -f "$status_record" ]; then
      cat "$child_log"
      printf '::error::detached rollout exited without terminal status; evidence retained at %s\n' "$supervisor_root_real"
      return 1
    fi
  fi

  while [ ! -f "$status_record" ]; do
    if ! supervisor_process_matches "$child_pid" "$child_start_ticks"; then
      sleep 1
      if [ ! -f "$status_record" ]; then
        cat "$child_log"
        printf '::error::detached rollout lost without terminal status; evidence retained at %s\n' "$supervisor_root_real"
        return 1
      fi
      break
    fi
    sleep 1
  done
  child_status="$(read_supervisor_status "$status_record" "$child_pid" "$child_start_ticks")"

  for wait_iteration in $(seq 1 100); do
    if ! supervisor_process_matches "$child_pid" "$child_start_ticks"; then
      process_gone=1
      break
    fi
    sleep 0.1
  done
  if [ "$process_gone" -ne 1 ]; then
    cat "$child_log"
    printf '::error::detached rollout remained live after terminal status; evidence retained at %s\n' "$supervisor_root_real"
    return 1
  fi

  cat "$child_log"
  if [ "$child_status" -ne 0 ]; then
    printf '::error::detached rollout failed with status %s; evidence retained at %s\n' \
      "$child_status" "$supervisor_root_real"
    return "$child_status"
  fi
  normalize_supervisor_output "$child_output" "$normalized_output" "$expected_backup"
  cat "$normalized_output" >> "$GITHUB_OUTPUT"
  rm -rf -- "$supervisor_root_real"
  printf 'D069_TOCHKA_SUPERVISOR=VERIFIED\n'
}

if [ "$self_test" -eq 0 ] && [ "${D069_SUPERVISED_CHILD:-}" != 1 ]; then
  supervise_rollout
  exit 0
fi

if [ "$self_test" -eq 0 ]; then
  : "${D069_SUPERVISOR_ROOT:?D069_SUPERVISOR_ROOT is required for detached child}"
  test "$(pwd -P)" = "$D069_SUPERVISOR_ROOT/bundle"
  test "$(realpath -e "$RUNNER_TEMP")" = "$D069_SUPERVISOR_ROOT/runtime"
  test "$(realpath -m "$GITHUB_OUTPUT")" = "$D069_SUPERVISOR_ROOT/child.github-output"
  test "$(stat -c %u "$D069_SUPERVISOR_ROOT")" -eq "$(id -u)"
  test "$(stat -c %a "$D069_SUPERVISOR_ROOT")" = 700
fi

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
network_id=""
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

container_lacks_named_network() {
  local container="$1"
  local unexpected_network="$2"
  local inspection_status=0
  if container_has_named_network "$container" "$unexpected_network"; then
    return 1
  else
    inspection_status=$?
    test "$inspection_status" -eq 1
  fi
}

container_has_no_networks() {
  local container="$1"
  local attached_network_count=""
  attached_network_count="$(docker inspect "$container" --format '{{len .NetworkSettings.Networks}}')" \
    || return 1
  test "$attached_network_count" = 0
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

validate_canonical_public_topology_payload() {
  python3 - \
    "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" "${10}" <<'PY'
import ipaddress
import json
import re
import sys

(
    container_id,
    container_name,
    network_name,
    network_id,
    port_bindings_text,
    publish_all_text,
    network_mode_text,
    hostname_text,
    configured_mac_text,
    networks_text,
) = sys.argv[1:]

def fail(reason: str) -> None:
    raise SystemExit(f"unsupported production public topology: {reason}")

try:
    port_bindings = json.loads(port_bindings_text)
    publish_all = json.loads(publish_all_text)
    network_mode = json.loads(network_mode_text)
    hostname = json.loads(hostname_text)
    configured_mac = json.loads(configured_mac_text)
    networks = json.loads(networks_text)
except (TypeError, ValueError):
    fail("invalid Docker inspection data")

if port_bindings not in (None, {}):
    fail("published host ports are forbidden")
if publish_all is not False:
    fail("PublishAllPorts must be false")
if network_mode != network_name:
    fail("the canonical network must be HostConfig.NetworkMode")
if hostname not in {container_id[:12], container_name}:
    fail("custom container hostname cannot be reconstructed")
if configured_mac not in (None, ""):
    fail("configured endpoint MAC address cannot be reconstructed")
if not isinstance(networks, dict) or list(networks) != [network_name]:
    fail("exactly the canonical public network must be attached")

endpoint = networks[network_name]
if not isinstance(endpoint, dict) or endpoint.get("NetworkID") != network_id:
    fail("canonical network identity changed")

try:
    endpoint_ipv4 = ipaddress.IPv4Address(endpoint.get("IPAddress"))
except (ipaddress.AddressValueError, TypeError):
    fail("canonical endpoint has no valid dynamic IPv4 address")
endpoint_mac = endpoint.get("MacAddress")
if not isinstance(endpoint_mac, str) or not re.fullmatch(
    r"[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}", endpoint_mac
):
    fail("canonical endpoint has no valid MAC address")
dynamic_mac = "02:42:" + ":".join(f"{byte:02x}" for byte in endpoint_ipv4.packed)
if endpoint_mac.lower() != dynamic_mac:
    fail("fixed per-network endpoint MAC address cannot be reconstructed")

allowed_names = {container_id, container_id[:12], container_name}
for field in ("Aliases", "DNSNames"):
    values = endpoint.get(field)
    if values is None:
        continue
    if (
        not isinstance(values, list)
        or any(not isinstance(value, str) or value not in allowed_names for value in values)
    ):
        fail(f"custom endpoint {field.lower()} cannot be reconstructed")

for field in ("IPAMConfig", "Links", "DriverOpts"):
    value = endpoint.get(field)
    if value not in (None, {}, []):
        fail(f"custom endpoint {field.lower()} cannot be reconstructed")
if endpoint.get("GwPriority") not in (None, 0):
    fail("custom endpoint gateway priority cannot be reconstructed")
PY
}

validate_canonical_public_topology() {
  local container="$1"
  local expected_container_name="$2"
  local expected_network="$3"
  local expected_network_id="$4"
  local port_bindings_json=""
  local publish_all_json=""
  local network_mode_json=""
  local hostname_json=""
  local configured_mac_json=""
  local networks_json=""

  port_bindings_json="$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')" \
    || return 1
  publish_all_json="$(docker inspect "$container" --format '{{json .HostConfig.PublishAllPorts}}')" \
    || return 1
  network_mode_json="$(docker inspect "$container" --format '{{json .HostConfig.NetworkMode}}')" \
    || return 1
  hostname_json="$(docker inspect "$container" --format '{{json .Config.Hostname}}')" \
    || return 1
  configured_mac_json="$(docker inspect "$container" --format '{{json .Config.MacAddress}}')" \
    || return 1
  networks_json="$(docker inspect "$container" --format '{{json .NetworkSettings.Networks}}')" \
    || return 1

  validate_canonical_public_topology_payload \
    "$container" \
    "$expected_container_name" \
    "$expected_network" \
    "$expected_network_id" \
    "$port_bindings_json" \
    "$publish_all_json" \
    "$network_mode_json" \
    "$hostname_json" \
    "$configured_mac_json" \
    "$networks_json"
}

run_rollout_self_tests() {
  local container_id="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  local canonical_networks='{"arthello-public":{"NetworkID":"network-id","IPAddress":"172.18.0.5","MacAddress":"02:42:ac:12:00:05","Aliases":["arthello-live","0123456789ab"],"DNSNames":["arthello-live","0123456789ab"],"IPAMConfig":null,"Links":null,"DriverOpts":null,"GwPriority":0}}'
  local fixed_mac_networks='{"arthello-public":{"NetworkID":"network-id","IPAddress":"172.18.0.5","MacAddress":"02:42:ac:12:00:99","Aliases":["arthello-live"],"DNSNames":["arthello-live"],"IPAMConfig":null,"Links":null,"DriverOpts":null,"GwPriority":0}}'
  local missing_mac_networks='{"arthello-public":{"NetworkID":"network-id","IPAddress":"172.18.0.5","MacAddress":"","Aliases":["arthello-live"],"DNSNames":["arthello-live"],"IPAMConfig":null,"Links":null,"DriverOpts":null,"GwPriority":0}}'
  local protocol_root="$work/supervisor-protocol"
  local protocol_start="$protocol_root/started"
  local protocol_status="$protocol_root/terminal-status"
  local protocol_output="$protocol_root/child.github-output"
  local protocol_normalized="$protocol_root/normalized.github-output"
  local protocol_identity="$protocol_root/live-identity"
  local protocol_namespace_pid="$BASHPID"
  local protocol_child_pid=""
  local protocol_start_ticks=""
  local protocol_exit_code=""
  local expected_backup="arthello-d069-tochka-rollback-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"

  validate_canonical_public_topology_payload \
    "$container_id" arthello-live arthello-public network-id \
    null false '"arthello-public"' '"0123456789ab"' '""' "$canonical_networks"
  if validate_canonical_public_topology_payload \
    "$container_id" arthello-live arthello-public network-id \
    null false '"arthello-public"' '"0123456789ab"' '""' "$fixed_mac_networks" \
    >/dev/null 2>&1; then
    printf 'fixed endpoint MAC fixture unexpectedly passed\n' >&2
    return 1
  fi
  if validate_canonical_public_topology_payload \
    "$container_id" arthello-live arthello-public network-id \
    null false '"arthello-public"' '"0123456789ab"' '""' "$missing_mac_networks" \
    >/dev/null 2>&1; then
    printf 'missing endpoint MAC fixture unexpectedly passed\n' >&2
    return 1
  fi

  command -v nohup >/dev/null
  command -v setsid >/dev/null
  command -v timeout >/dev/null
  setsid --help 2>&1 | grep -Fq -- '--fork'
  timeout --preserve-status --signal=TERM 1s true
  mkdir -p "$protocol_root"
  chmod 0700 "$protocol_root"
  [[ "$protocol_namespace_pid" =~ ^[1-9][0-9]*$ ]]
  python3 - "$protocol_namespace_pid" > "$protocol_identity" <<'PY'
import pathlib
import re
import sys

namespace_pid = sys.argv[1]
self_after_name = pathlib.Path("/proc/self/stat").read_text(encoding="ascii").rsplit(")", 1)[1].split()
host_parent = self_after_name[1]
if not re.fullmatch(r"[1-9][0-9]*", host_parent) or int(host_parent) <= 1:
    raise SystemExit(1)
status_lines = pathlib.Path(f"/proc/{host_parent}/status").read_text(encoding="ascii").splitlines()
namespace_ids = [line.split()[1:] for line in status_lines if line.startswith("NSpid:")]
if len(namespace_ids) != 1 or not namespace_ids[0] or namespace_ids[0][-1] != namespace_pid:
    raise SystemExit(1)
parent_after_name = pathlib.Path(f"/proc/{host_parent}/stat").read_text(encoding="ascii").rsplit(")", 1)[1].split()
start_ticks = parent_after_name[19]
if not re.fullmatch(r"[1-9][0-9]*", start_ticks):
    raise SystemExit(1)
print(host_parent, start_ticks)
PY
  read -r protocol_child_pid protocol_start_ticks < "$protocol_identity"
  rm -f -- "$protocol_identity"
  if ! supervisor_process_matches "$protocol_child_pid" "$protocol_start_ticks"; then
    printf 'live supervisor identity fixture did not match its Bash parent\n' >&2
    return 1
  fi
  {
    printf 'version=1\n'
    printf 'run_id=%s\n' "$GITHUB_RUN_ID"
    printf 'run_attempt=%s\n' "$GITHUB_RUN_ATTEMPT"
    printf 'pid=%s\n' "$protocol_child_pid"
    printf 'start_ticks=%s\n' "$protocol_start_ticks"
  } > "$protocol_start.tmp"
  chmod 0600 "$protocol_start.tmp"
  mv -f -- "$protocol_start.tmp" "$protocol_start"
  read -r protocol_child_pid protocol_start_ticks < <(read_supervisor_start "$protocol_start")
  if supervisor_process_matches 999999999 1; then
    printf 'missing supervisor process fixture unexpectedly passed\n' >&2
    return 1
  fi
  {
    printf 'version=1\n'
    printf 'run_id=%s\n' "$GITHUB_RUN_ID"
    printf 'run_attempt=%s\n' "$GITHUB_RUN_ATTEMPT"
    printf 'pid=%s\n' "$protocol_child_pid"
    printf 'start_ticks=%s\n' "$protocol_start_ticks"
    printf 'exit_code=0\n'
  } > "$protocol_status.tmp"
  chmod 0600 "$protocol_status.tmp"
  mv -f -- "$protocol_status.tmp" "$protocol_status"
  protocol_exit_code="$(read_supervisor_status \
    "$protocol_status" "$protocol_child_pid" "$protocol_start_ticks")"
  test "$protocol_exit_code" -eq 0

  {
    printf 'backup_volume=%s\n' "$expected_backup"
    printf 'before_digest=%064d\n' 0
    printf 'after_digest=%064d\n' 1
    printf 'account_count=4\nstatement_count=4\ntransaction_count=6\n'
    printf 'receipt_count=3\noutflow_count=3\n'
    printf 'bank_receipts_minor=1500\nregistry_receipts_minor=1500\nreceipt_difference_minor=0\n'
    printf 'bank_outflows_minor=700\nregistry_outflows_minor=700\noutflow_difference_minor=0\n'
  } > "$protocol_output"
  chmod 0600 "$protocol_output"
  normalize_supervisor_output "$protocol_output" "$protocol_normalized" "$expected_backup"
  test "$(wc -l < "$protocol_normalized")" -eq 14

  python3 - "${BASH_SOURCE[0]}" <<'PY'
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text(encoding="utf-8")
supervisor_start = source.index("supervise_rollout() {")
supervisor_end = source.index("\nif [ \"$self_test\" -eq 0 ]", supervisor_start)
supervisor = source[supervisor_start:supervisor_end]
for token in (
    "-u RUNNER_TRACKING_ID",
    "D069_SUPERVISED_CHILD=1",
    "nohup setsid --fork bash -c",
    "timeout --preserve-status --signal=TERM",
    "supervisor_max_runtime=120m",
    "set -Eeuo pipefail",
    'namespace_process_id="$BASHPID"',
    'python3 - "$namespace_process_id" > "$identity_temporary"',
    'pathlib.Path("/proc/self/stat")',
    'line.startswith("NSpid:")',
    'pathlib.Path(f"/proc/{host_parent}/stat")',
    'read -r process_id process_start_ticks < "$identity_temporary"',
    'child_runtime="$supervisor_root/runtime"',
    'child_output="$supervisor_root/child.github-output"',
    'child_log="$supervisor_root/child.log"',
    'start_record="$supervisor_root/started"',
    'status_record="$supervisor_root/terminal-status"',
):
    if token not in supervisor:
        raise SystemExit(f"missing detached-supervisor token: {token}")
for forbidden in (
    'process_start_ticks="$(python3',
    'process_identity="$(python3',
    '\n        process_id="$BASHPID"',
    'test "$process_id" = "$BASHPID"',
    'child_output="$child_runtime/',
    'child_log="$child_runtime/',
    'start_record="$child_runtime/',
    'status_record="$child_runtime/',
):
    if forbidden in supervisor:
        raise SystemExit(f"supervisor control file entered child runtime: {forbidden}")
listener_start = source.rindex("internal_listener_ready() {")
listener_end = source.index("\n}\n\npublic_ready()", listener_start)
listener = source[listener_start:listener_end]
for token in ('require("node:net")', "net.createConnection", 'host: "127.0.0.1"', "port: 8081"):
    if token not in listener:
        raise SystemExit(f"missing non-mutating listener probe token: {token}")
for forbidden in ("fetch(", "/api/", "/api/health"):
    if forbidden in listener:
        raise SystemExit(f"listener probe invokes an HTTP handler: {forbidden}")
main_start = source.index("production_touched=1\n", source.index("# From here onward failures must recover"))
main_end = source.index("verify_bootstrap_owner_password", main_start)
main = source[main_start:main_end]
sequence = [
    'docker network disconnect "$network_name" "$live_id"',
    "public_fenced",
    'docker stop --time 120 "$live_id"',
    'snapshot_volume "$DATA_VOLUME" "$before_live_snapshot"',
    'docker network connect "$import_network" "$live_id"',
    "mutation_started=1",
    'docker start "$live_id"',
]
position = -1
for token in sequence:
    next_position = main.find(token, position + 1)
    if next_position < 0:
        raise SystemExit(f"missing quiescence token: {token}")
    position = next_position
if 'sleep 55' in main or 'docker unpause "$live_id"' in main:
    raise SystemExit("baseline path can resume a pre-fence request")

post_start = source.index(
    'docker exec --user 0:0 "$live_id" rm -f -- "$client_container_path"',
    source.index('IFS= read -r expected_transaction_count'),
)
post_end = source.index('connect_canonical_public_network "$live_id"', post_start)
post = source[post_start:post_end]
post_sequence = [
    'docker network disconnect "$import_network" "$live_id"',
    'docker stop --time 120 "$live_id"',
    'snapshot_volume "$DATA_VOLUME" "$after_snapshot"',
    'python3 "$TOCHKA_RECONCILE_CHECKER"',
    'docker rename "$live_id" "$live_name"',
    'docker start "$live_id"',
    'internal_listener_ready "$live_id"',
    "public_exposed=1",
]
position = -1
for token in post_sequence:
    next_position = post.find(token, position + 1)
    if next_position < 0:
        raise SystemExit(f"missing post-import quiescence token: {token}")
    position = next_position
if 'docker pause "$live_id"' in post or 'docker unpause "$live_id"' in post:
    raise SystemExit("post-import path can resume work after validation")
start_position = post.index('docker start "$live_id"')
exposure_position = post.index("public_exposed=1", start_position)
detached_health = post[start_position:exposure_position]
for token in (
    'container_lacks_named_network "$live_id" "$network_name"',
    'container_lacks_named_network "$live_id" "$import_network"',
    'container_has_no_networks "$live_id"',
    'internal_listener_ready "$live_id"',
):
    if token not in detached_health:
        raise SystemExit(f"missing detached-health token: {token}")
for forbidden in ("public_ready", "curl ", "fetch(", "/api/", "/api/health"):
    if forbidden in detached_health:
        raise SystemExit(f"pre-exposure readiness can invoke an HTTP handler: {forbidden}")
PY
  printf 'D069_TOCHKA_ROLLOUT_SELF_TESTS=VERIFIED\n'
}

if [ "$self_test" -eq 1 ]; then
  run_rollout_self_tests
  rm -rf -- "$work"
  exit 0
fi

connect_canonical_public_network() {
  local container="$1"
  test "$(docker network inspect "$network_name" --format '{{.Id}}')" = "$network_id" \
    || return 1
  docker network connect "$network_name" "$container" || return 1
  validate_canonical_public_topology "$container" "$live_name" "$network_name" "$network_id" \
    || return 1
  return 0
}

ensure_canonical_public_network() {
  local container="$1"
  local inspection_status=0
  if container_has_named_network "$container" "$network_name"; then
    validate_canonical_public_topology "$container" "$live_name" "$network_name" "$network_id" \
      || return 1
  else
    inspection_status=$?
    test "$inspection_status" -eq 1 || return 1
    connect_canonical_public_network "$container" || return 1
  fi
  return 0
}

internal_listener_ready() {
  local container="$1"
  for _ in $(seq 1 60); do
    if docker exec "$container" node -e '
      const net = require("node:net");
      const socket = net.createConnection({ host: "127.0.0.1", port: 8081 });
      socket.setTimeout(10_000);
      socket.once("connect", () => { socket.destroy(); process.exit(0); });
      socket.once("timeout", () => { socket.destroy(); process.exit(1); });
      socket.once("error", () => process.exit(1));
    ' >/dev/null 2>&1; then
      return 0
    fi
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

detached_public_status() {
  case "$1" in
    000|502|503|504) return 0 ;;
    *) return 1 ;;
  esac
}

public_fenced() {
  local root_status=""
  local auth_status=""
  local attempt=0
  local nonce=""
  for attempt in 1 2 3; do
    nonce="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$attempt"
    root_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \
      --header 'Cache-Control: no-cache' --header 'Pragma: no-cache' \
      "${PUBLIC_URL%/}/?d069_fence=$nonce" 2>/dev/null || true)"
    auth_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \
      --header 'Cache-Control: no-cache' --header 'Pragma: no-cache' \
      "${PUBLIC_URL%/}/api/auth/me?d069_fence=$nonce" 2>/dev/null || true)"
    if ! detached_public_status "$root_status" || ! detached_public_status "$auth_status"; then
      printf '::error::public write fence is not closed (root=%s auth=%s)\n' \
        "$root_status" "$auth_status"
      return 1
    fi
    if [ "$attempt" -lt 3 ]; then sleep 2; fi
  done
  return 0
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
      internal_listener_ready "$live_id" >/dev/null 2>&1 || rollback_failed=1
      restore_restart_policy "$live_id" >/dev/null 2>&1 || rollback_failed=1
      ensure_canonical_public_network "$live_id" >/dev/null 2>&1 || rollback_failed=1
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

# Docker appends a newline after the template's println. Capture first to strip
# trailing newlines and propagate inspect failures before parsing network names.
network_names_output="$(docker inspect "$live_id" --format '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}')"
mapfile -t networks <<<"$network_names_output"
test "${#networks[@]}" -eq 1
network_name="${networks[0]}"
test -n "$network_name"
network_id="$(docker network inspect "$network_name" --format '{{.Id}}')"
[[ "$network_id" =~ ^[a-f0-9]{64}$ ]]
test "$(docker network inspect "$network_name" --format '{{.Name}}')" = "$network_name"
test "$(docker network inspect "$network_name" --format '{{.Driver}}')" = bridge
test "$(docker network inspect "$network_name" --format '{{.Scope}}')" = local
test "$(docker network inspect "$network_name" --format '{{.Internal}}')" = false
test "$(docker network inspect "$network_name" --format '{{.Ingress}}')" = false
validate_canonical_public_topology "$live_id" "$live_name" "$network_name" "$network_id"
hidden_name="arthello-d069-tochka-hidden-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
if docker inspect "$hidden_name" >/dev/null 2>&1; then
  printf '::error::hidden import container name already exists\n'
  exit 1
fi
if docker network inspect "$import_network" >/dev/null 2>&1; then
  printf '::error::temporary import network already exists\n'
  exit 1
fi

internal_listener_ready "$live_id"
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
container_lacks_named_network "$live_id" "$network_name"
public_fenced
container_lacks_named_network "$live_id" "$network_name"
# A disconnected network blocks new public work but does not quiesce requests
# already admitted by the application. Stop the container before the baseline
# copy so even long-running request finalizers cannot resume during import.
docker stop --time 120 "$live_id" >/dev/null
test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = false
test "$(docker inspect "$live_id" --format '{{.State.Paused}}')" = false
container_lacks_named_network "$live_id" "$network_name"

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
container_has_named_network "$live_id" "$import_network"
container_lacks_named_network "$live_id" "$network_name"
mutation_started=1
docker start "$live_id" >/dev/null
test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live_id" --format '{{.State.Paused}}')" = false
internal_listener_ready "$live_id"

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
container_lacks_named_network "$live_id" "$import_network"
container_lacks_named_network "$live_id" "$network_name"
container_has_no_networks "$live_id"
# A timed-out API request can keep executing in the server after its client has
# aborted. Stop, rather than pause, so no request or background job can resume
# after the validated snapshot and mutate data before public exposure.
docker stop --time 120 "$live_id" >/dev/null
test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = false
test "$(docker inspect "$live_id" --format '{{.State.Paused}}')" = false
container_lacks_named_network "$live_id" "$import_network"
container_lacks_named_network "$live_id" "$network_name"
container_has_no_networks "$live_id"
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

test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = false
test "$(docker inspect "$live_id" --format '{{.State.Paused}}')" = false
test "$(docker inspect "$live_id" --format '{{.Image}}')" = "$live_image_id"
test "$(docker inspect "$live_id" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$EXPECTED_RELEASE_SHA"
container_lacks_named_network "$live_id" "$network_name"
container_lacks_named_network "$live_id" "$import_network"
container_has_no_networks "$live_id"

# Start and health-check with every network still detached. Re-publish only
# after a stopped, immutable snapshot has passed reconciliation.
docker rename "$live_id" "$live_name"
docker start "$live_id" >/dev/null
test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live_id" --format '{{.State.Paused}}')" = false
container_lacks_named_network "$live_id" "$network_name"
container_lacks_named_network "$live_id" "$import_network"
container_has_no_networks "$live_id"
internal_listener_ready "$live_id"
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
connect_canonical_public_network "$live_id"
public_ready

printf 'D069_TOCHKA_PRODUCTION=VERIFIED release=%s window=%s..%s\n' \
  "$EXPECTED_RELEASE_SHA" "$TOCHKA_START_DATE" "$TOCHKA_END_DATE"
rm -rf -- "$work"
trap - EXIT INT TERM HUP
