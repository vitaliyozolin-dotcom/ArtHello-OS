#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${ACTION:?ACTION is required}"
: "${RUN_ID:?RUN_ID is required}"
: "${RUN_ATTEMPT:?RUN_ATTEMPT is required}"
: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}"
: "${CANDIDATE_IMAGE_ID:?CANDIDATE_IMAGE_ID is required}"
: "${AUDIT_PUBLIC_ORIGIN:?AUDIT_PUBLIC_ORIGIN is required}"
: "${AUDIT_WORK_ROOT:?AUDIT_WORK_ROOT is required}"
: "${AUDIT_TRANSPORT_ROOT:?AUDIT_TRANSPORT_ROOT is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${CONTROL_SHA:?CONTROL_SHA is required}"
: "${AUDIT_SIDE:?AUDIT_SIDE is required}"
: "${AUDIT_RUNTIME_UID:?AUDIT_RUNTIME_UID is required}"
: "${AUDIT_RUNTIME_GID:?AUDIT_RUNTIME_GID is required}"

AUDIT_SHA="${AUDIT_SHA:-$CANDIDATE_SHA}"
AUDIT_IMAGE="${AUDIT_IMAGE:-$CANDIDATE_IMAGE}"
AUDIT_IMAGE_ID="${AUDIT_IMAGE_ID:-$CANDIDATE_IMAGE_ID}"
AUDIT_EXPECTED_DESIGN_FLAG="${AUDIT_EXPECTED_DESIGN_FLAG:-true}"
AUDIT_SEED_DATE="${AUDIT_SEED_DATE:-}"
AUDIT_SOURCE="${AUDIT_SOURCE:-candidate-migrations-only}"
readonly EXPECTED_SEED_SHA256=b62e9e03192c783ca5c9faad699804c392ff62f119957bdbd35d507393693be4
readonly EXPECTED_PROXY_SHA256=c969aad8815dca827cc1bdbcb5e5a64d143a51820ea37ee7abe29f95de587855

case "$RUN_ID" in
  ''|*[!0-9]*) printf 'Invalid RUN_ID\n' >&2; exit 1 ;;
esac
case "$RUN_ATTEMPT" in
  ''|*[!0-9]*) printf 'Invalid RUN_ATTEMPT\n' >&2; exit 1 ;;
esac
test "$RUN_ATTEMPT" -ge 1
case "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID" in
  *[!0-9:]*|:*|*:) printf 'Invalid audit runtime identity\n' >&2; exit 1 ;;
esac
test "$AUDIT_RUNTIME_UID" -ge 1
test "$AUDIT_RUNTIME_GID" -ge 1
host_uid="$(id -u)"
host_gid="$(id -g)"
if [ "$host_uid" -eq 0 ]; then
  test "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID" = 1001:1001
else
  test "$host_gid" -ge 1
  test "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID" = "$host_uid:$host_gid"
fi

resolve_trusted_executable() {
  local executable_name="$1"
  local candidate
  local resolved
  local owner
  local mode
  local mode_bits
  candidate="$(type -P "$executable_name")" || return 1
  [[ "$candidate" = /* ]] || return 1
  resolved="$(realpath -e -- "$candidate")" || return 1
  [ -f "$resolved" ] && [ ! -L "$resolved" ] && [ -x "$resolved" ] || return 1
  owner="$(stat -c '%u' "$resolved")" || return 1
  [ "$owner" = 0 ] || [ "$owner" = "$host_uid" ] || return 1
  mode="$(stat -c '%a' "$resolved")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  mode_bits=$((8#$mode))
  [ $((mode_bits & 022)) -eq 0 ] || return 1
  printf '%s\n' "$resolved"
}

docker_binary="$(resolve_trusted_executable docker)" || {
  printf 'Unable to resolve a trusted Docker client binary\n' >&2
  exit 1
}
timeout_binary="$(resolve_trusted_executable timeout)" || {
  printf 'Unable to resolve a trusted timeout binary\n' >&2
  exit 1
}
readonly docker_binary timeout_binary
readonly DOCKER_CONTROL_TIMEOUT=60s
readonly DOCKER_CONTROL_KILL_AFTER=10s

docker_control() {
  [ "$#" -ge 1 ] || return 1
  "$timeout_binary" --foreground --signal=TERM \
    --kill-after="$DOCKER_CONTROL_KILL_AFTER" "$DOCKER_CONTROL_TIMEOUT" \
    "$docker_binary" "$@"
}

if [[ ! "$CANDIDATE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  printf 'Invalid CANDIDATE_SHA\n' >&2
  exit 1
fi
if [[ ! "$CANDIDATE_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  printf 'Invalid CANDIDATE_IMAGE_ID\n' >&2
  exit 1
fi
if [[ ! "$AUDIT_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  printf 'Invalid AUDIT_SHA\n' >&2
  exit 1
fi
if [[ ! "$AUDIT_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  printf 'Invalid AUDIT_IMAGE_ID\n' >&2
  exit 1
fi
if [[ ! "$CONTROL_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  printf 'Invalid CONTROL_SHA\n' >&2
  exit 1
fi
case "$AUDIT_SIDE" in
  base|candidate) ;;
  *) printf 'Invalid AUDIT_SIDE\n' >&2; exit 1 ;;
esac
case "$AUDIT_EXPECTED_DESIGN_FLAG" in
  true|false) ;;
  *) printf 'Invalid AUDIT_EXPECTED_DESIGN_FLAG\n' >&2; exit 1 ;;
esac
case "$AUDIT_SOURCE" in
  base-migrations-only|candidate-migrations-only) ;;
  *) printf 'Invalid AUDIT_SOURCE\n' >&2; exit 1 ;;
esac
if [ -n "$AUDIT_SEED_DATE" ] && [[ ! "$AUDIT_SEED_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  printf 'Invalid AUDIT_SEED_DATE\n' >&2
  exit 1
fi
case "$AUDIT_PUBLIC_ORIGIN" in
  http://127.0.0.1:33212) ;;
  *) printf 'Invalid audit public origin\n' >&2; exit 1 ;;
esac
case "$AUDIT_WORK_ROOT" in
  /*) ;;
  *) printf 'Invalid audit work root\n' >&2; exit 1 ;;
esac
test -d "$AUDIT_WORK_ROOT"
test ! -L "$AUDIT_WORK_ROOT"
test "$AUDIT_WORK_ROOT" = "$RUNNER_TEMP"
test "$AUDIT_WORK_ROOT" != /
test "$(realpath -e -- "$AUDIT_WORK_ROOT")" = "$AUDIT_WORK_ROOT"
transport_sentinel="$AUDIT_TRANSPORT_ROOT/owner"
transport_side_dir="$AUDIT_TRANSPORT_ROOT/$AUDIT_SIDE"
run_instance="$RUN_ID-$RUN_ATTEMPT"
test "$AUDIT_TRANSPORT_ROOT" = \
  "$RUNNER_TEMP/school-flag-off-transport-$run_instance"
validate_transport_root() {
  local unexpected
  local side_name
  local side_path
  local side_socket
  test -d "$AUDIT_TRANSPORT_ROOT" || return 1
  test ! -L "$AUDIT_TRANSPORT_ROOT" || return 1
  test "$(stat -c '%u:%g:%a' "$AUDIT_TRANSPORT_ROOT")" = \
    "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID:700" || return 1
  test -f "$transport_sentinel" || return 1
  test ! -L "$transport_sentinel" || return 1
  test "$(stat -c '%u:%g:%a' "$transport_sentinel")" = \
    "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID:600" || return 1
  test "$(cat "$transport_sentinel")" = \
    "$RUN_ID|$RUN_ATTEMPT|$CONTROL_SHA" || return 1
  if ! unexpected="$(
    find -P "$AUDIT_TRANSPORT_ROOT" -mindepth 1 -maxdepth 1 \
      ! -name owner ! -name base ! -name candidate -print -quit
  )"; then
    return 1
  fi
  test -z "$unexpected" || return 1
  for side_name in base candidate; do
    side_path="$AUDIT_TRANSPORT_ROOT/$side_name"
    if [ -e "$side_path" ] || [ -L "$side_path" ]; then
      test -d "$side_path" || return 1
      test ! -L "$side_path" || return 1
      test "$(stat -c '%u:%g:%a' "$side_path")" = \
        "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID:700" || return 1
      if ! unexpected="$(
        find -P "$side_path" -mindepth 1 -maxdepth 1 \
          ! -name audit.sock -print -quit
      )"; then
        return 1
      fi
      test -z "$unexpected" || return 1
      side_socket="$side_path/audit.sock"
      if [ -e "$side_socket" ] || [ -L "$side_socket" ]; then
        test -S "$side_socket" || return 1
        test ! -L "$side_socket" || return 1
        test "$(stat -c '%u:%g:%a' "$side_socket")" = \
          "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID:600" || return 1
      fi
    fi
  done
  test -d "$transport_side_dir" || return 1
  test ! -L "$transport_side_dir" || return 1
  test "$(stat -c '%u:%g:%a' "$transport_side_dir")" = \
    "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID:700" || return 1
  return 0
}
case "$ACTION" in
  prepare) validate_transport_root ;;
  cleanup)
    if [ -e "$AUDIT_TRANSPORT_ROOT" ] || [ -L "$AUDIT_TRANSPORT_ROOT" ]; then
      validate_transport_root
    fi
    ;;
  *) ;;
esac

audit="school-1-11-authorized-visual-$run_instance-$AUDIT_SIDE"
audit_proxy="school-1-11-authorized-visual-$run_instance-$AUDIT_SIDE-proxy"
work="$AUDIT_WORK_ROOT/school-authorized-visual-$run_instance-$AUDIT_SIDE"
work_pending="$work.pending"
work_tombstone="$work.cleanup"
work_pending_tombstone="$work_pending.cleanup"
work_sentinel="$work/.school-authorized-visual-owner"
work_pending_sentinel="$work_pending/.school-authorized-visual-owner"
container_ids_file="$work/.container-ids"
container_ids_tmp="$work/.container-ids.tmp"
container_intent_file="$work/.container-intent"
app_cid_file="$work/.app.cid"
proxy_cid_file="$work/.proxy.cid"
seed_script="$work/seed.mjs"
proxy_script="$work/proxy.mjs"
proxy_socket="$transport_side_dir/audit.sock"
work_pending_created=0
work_pending_devino=""
audit_created_id=""
proxy_created_id=""
CLEANUP_ACTIVE_KIND=""
CLEANUP_ACTIVE_SOURCE=""
CLEANUP_ACTIVE_TARGET=""
CLEANUP_ACTIVE_DEVINO=""
CLEANUP_SOCKET_PRESENT=no

case "$audit:$audit_proxy:$work:$work_tombstone" in
  school-1-11-authorized-visual-*:school-1-11-authorized-visual-*-proxy:*/school-authorized-visual-*:*/school-authorized-visual-*.cleanup) ;;
  *) printf 'Invalid audit resource names\n' >&2; exit 1 ;;
esac

probe_exact_container() {
  local target="$1"
  local inventory
  local name
  local matches=0
  if ! inventory="$(docker_control ps -a --format '{{.Names}}')"; then
    printf 'Docker container inventory failed\n' >&2
    return 1
  fi
  PROBED_RESOURCE_PRESENT=no
  while IFS= read -r name; do
    if [ "$name" = "$target" ]; then
      matches=$((matches + 1))
      PROBED_RESOURCE_PRESENT=yes
    fi
  done <<< "$inventory"
  test "$matches" -le 1
}

probe_exact_container_id() {
  local target="$1"
  local inventory
  local container_id
  local matches=0
  [[ "$target" =~ ^[a-f0-9]{64}$ ]] || return 1
  if ! inventory="$(docker_control ps -a --no-trunc --format '{{.ID}}')"; then
    printf 'Docker container ID inventory failed\n' >&2
    return 1
  fi
  PROBED_ID_PRESENT=no
  while IFS= read -r container_id; do
    if [ "$container_id" = "$target" ]; then
      matches=$((matches + 1))
      PROBED_ID_PRESENT=yes
    fi
  done <<< "$inventory"
  test "$matches" -le 1
}

assert_container_structure() {
  local target="$1"
  local role="$2"
  local expected_app_id="$audit_created_id"
  if [ "$role" = proxy ] && [ -z "$expected_app_id" ] &&
    [ -f "$container_ids_file" ] && [ ! -L "$container_ids_file" ]; then
    expected_app_id="$(sed -n 's/^app=//p' "$container_ids_file")" || return 1
  fi
  if [ "$role" = proxy ] && [ -z "$expected_app_id" ] &&
    [ -f "$app_cid_file" ] && [ ! -L "$app_cid_file" ]; then
    expected_app_id="$(cat "$app_cid_file")" || return 1
  fi
  if [ "$role" = proxy ]; then
    [[ "$expected_app_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  fi
  docker_control inspect "$target" | \
    EXPECTED_ROLE="$role" \
    EXPECTED_SEED="$seed_script" \
    EXPECTED_PROXY_SCRIPT="$proxy_script" \
    EXPECTED_PROXY_DIR="$transport_side_dir" \
    EXPECTED_APP_ID="$expected_app_id" \
    python3 -c '
import json, os, sys
d = json.load(sys.stdin)[0]
h = d["HostConfig"]
c = d["Config"]
role = os.environ["EXPECTED_ROLE"]
uid = os.environ["AUDIT_RUNTIME_UID"]
gid = os.environ["AUDIT_RUNTIME_GID"]
if c["User"] != uid + ":" + gid:
    raise RuntimeError("Wrong audit runtime identity")
if h["AutoRemove"] or h["Privileged"] or not h["ReadonlyRootfs"]:
    raise RuntimeError("Wrong audit isolation mode")
if h["RestartPolicy"] != {"Name": "no", "MaximumRetryCount": 0}:
    raise RuntimeError("Wrong audit restart policy")
if h.get("PortBindings") not in ({}, None) or h["PublishAllPorts"]:
    raise RuntimeError("Unexpected audit port exposure")
if h["CapDrop"] != ["ALL"] or h["CapAdd"] not in (None, []) or h["SecurityOpt"] != ["no-new-privileges:true"]:
    raise RuntimeError("Wrong audit security options")
if h["LogConfig"] != {"Type": "local", "Config": {"max-file": "1", "max-size": "10m"}}:
    raise RuntimeError("Wrong audit log cap")
if h.get("Ulimits") != [{"Name": "nofile", "Hard": 1024, "Soft": 1024}]:
    raise RuntimeError("Wrong audit file-descriptor limit")
if h.get("Devices") not in (None, []) or h.get("Binds") not in (None, []):
    raise RuntimeError("Unexpected audit device or legacy bind")
if role == "app":
    command = "set -eu; node /control/seed.mjs; exec ./scripts/container-entrypoint.sh node server.js"
    if c["Entrypoint"] != ["/bin/sh"] or c["Cmd"] != ["-c", command]:
        raise RuntimeError("Wrong audit app command")
    if h["NetworkMode"] != "none":
        raise RuntimeError("Wrong audit app network")
    if (h["Memory"], h["MemorySwap"], h["NanoCpus"], h["PidsLimit"]) != (1073741824, 1073741824, 1500000000, 256):
        raise RuntimeError("Wrong audit app resource limits")
    expected_tmpfs = {
        "/data": {"rw", "noexec", "nosuid", "nodev", "size=268435456", "mode=0750", "uid=" + uid, "gid=" + gid},
        "/tmp": {"rw", "noexec", "nosuid", "nodev", "size=134217728", "mode=1770", "uid=" + uid, "gid=" + gid},
    }
    expected_mounts = [("/control/seed.mjs", os.environ["EXPECTED_SEED"], False, "bind")]
else:
    if c["Entrypoint"] != ["node"] or c["Cmd"] != ["/control/proxy.mjs"]:
        raise RuntimeError("Wrong audit proxy command")
    if h["NetworkMode"] != "container:" + os.environ["EXPECTED_APP_ID"]:
        raise RuntimeError("Wrong audit proxy network")
    if (h["Memory"], h["MemorySwap"], h["NanoCpus"], h["PidsLimit"]) != (134217728, 134217728, 500000000, 64):
        raise RuntimeError("Wrong audit proxy resource limits")
    expected_tmpfs = {
        "/tmp": {"rw", "noexec", "nosuid", "nodev", "size=33554432", "mode=1770", "uid=" + uid, "gid=" + gid},
    }
    expected_mounts = sorted([
        ("/control/proxy.mjs", os.environ["EXPECTED_PROXY_SCRIPT"], False, "bind"),
        ("/transport", os.environ["EXPECTED_PROXY_DIR"], True, "bind"),
    ])
actual_tmpfs = {key: set(value.split(",")) for key, value in h["Tmpfs"].items()}
if actual_tmpfs != expected_tmpfs:
    raise RuntimeError("Wrong audit tmpfs")
actual_mounts = sorted(
    (item["Destination"], item["Source"], item["RW"], item["Type"])
    for item in d["Mounts"] if item["Type"] == "bind"
)
if actual_mounts != sorted(expected_mounts) or any(item["Type"] not in {"bind", "tmpfs"} for item in d["Mounts"]):
    raise RuntimeError("Wrong audit mounts")
' || return 1
}

assert_owned_container() {
  local target="$1"
  local role="$2"
  local name_policy="${3:-exact}"
  local actual
  local app_id_count
  local expected_id
  local expected_id_count
  local invalid_id_lines
  local proxy_id_count
  local total_id_lines
  local expected_name
  local expected_script_sha
  case "$name_policy" in
    exact|recorded-id) ;;
    *) return 1 ;;
  esac
  case "$role" in
    app)
      expected_name="$audit"
      expected_script_sha="$EXPECTED_SEED_SHA256"
      expected_id="$audit_created_id"
      ;;
    proxy)
      expected_name="$audit_proxy"
      expected_script_sha="$EXPECTED_PROXY_SHA256"
      expected_id="$proxy_created_id"
      ;;
    *) return 1 ;;
  esac
  if [ -z "$expected_id" ]; then
    [ -f "$container_ids_file" ] && [ ! -L "$container_ids_file" ] || return 1
    [ "$(stat -c '%u:%g:%a' "$container_ids_file")" = "$host_uid:$host_gid:600" ] || return 1
    total_id_lines="$(wc -l < "$container_ids_file")" || return 1
    app_id_count="$(sed -n '/^app=[a-f0-9]\{64\}$/p' "$container_ids_file" | wc -l)" || return 1
    proxy_id_count="$(sed -n '/^proxy=[a-f0-9]\{64\}$/p' "$container_ids_file" | wc -l)" || return 1
    invalid_id_lines="$(sed -n '/^app=[a-f0-9]\{64\}$/d; /^proxy=[a-f0-9]\{64\}$/d; p' "$container_ids_file")" || return 1
    [ -z "$invalid_id_lines" ] || return 1
    [ "$app_id_count" -eq 1 ] || return 1
    [ "$proxy_id_count" -le 1 ] || return 1
    [ "$total_id_lines" -eq $((app_id_count + proxy_id_count)) ] || return 1
    expected_id_count="$(sed -n "s/^$role=//p" "$container_ids_file" | wc -l)" || return 1
    [ "$expected_id_count" -eq 1 ] || return 1
    expected_id="$(sed -n "s/^$role=//p" "$container_ids_file")" || return 1
  fi
  [[ "$expected_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  if ! actual="$(docker_control inspect "$target" --format '{{index .Config.Labels "school.system"}}')"; then
    printf 'Audit container ownership inspect failed: %s\n' "$target" >&2
    return 1
  fi
  [ "$actual" = school-1-11 ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.environment"}}')" = synthetic-local-authorized-visual-audit ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.purpose"}}')" = design-v1-authorized-audit ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.audit-role"}}')" = "$role" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.audit-side"}}')" = "$AUDIT_SIDE" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.audit-sha"}}')" = "$AUDIT_SHA" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.audit-run-id"}}')" = "$RUN_ID" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.audit-run-attempt"}}')" = "$RUN_ATTEMPT" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.runtime-uid"}}')" = "$AUDIT_RUNTIME_UID" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.runtime-gid"}}')" = "$AUDIT_RUNTIME_GID" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.control-sha"}}')" = "$CONTROL_SHA" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{index .Config.Labels "school.control-script-sha"}}')" = "$expected_script_sha" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{.Image}}')" = "$AUDIT_IMAGE_ID" ] || return 1
  [ "$(docker_control inspect "$target" --format '{{.Id}}')" = "$expected_id" ] || return 1
  if [ "$name_policy" = exact ]; then
    [ "$(docker_control inspect "$target" --format '{{.Name}}')" = "/$expected_name" ] || return 1
  else
    [[ "$(docker_control inspect "$target" --format '{{.Name}}')" =~ ^/.+ ]] || return 1
  fi
  assert_container_structure "$target" "$role" || return 1
}

expected_container_intent() {
  printf '%s\n' \
    'version=1' \
    "run-id=$RUN_ID" \
    "run-attempt=$RUN_ATTEMPT" \
    "side=$AUDIT_SIDE" \
    "audit-sha=$AUDIT_SHA" \
    "image-id=$AUDIT_IMAGE_ID" \
    "control-sha=$CONTROL_SHA" \
    "app-name=$audit" \
    "proxy-name=$audit_proxy" \
    "runtime=$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID"
}

assert_container_intent() {
  [ -f "$container_intent_file" ] && [ ! -L "$container_intent_file" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$container_intent_file")" = \
    "$host_uid:$host_gid:600" ] || return 1
  [ "$(cat "$container_intent_file")" = "$(expected_container_intent)" ] || return 1
}

load_journaled_container_id() {
  local role="$1"
  local cid_file
  local current_id
  local canonical_id=""
  local cid_id=""
  local total_id_lines
  local app_id_count
  local proxy_id_count
  local invalid_id_lines
  local role_id_count
  JOURNALED_CONTAINER_ID=""
  JOURNAL_RECOVERY_REQUIRED=no

  case "$role" in
    app)
      current_id="$audit_created_id"
      cid_file="$app_cid_file"
      ;;
    proxy)
      current_id="$proxy_created_id"
      cid_file="$proxy_cid_file"
      ;;
    *) return 1 ;;
  esac

  if [ -n "$current_id" ]; then
    [[ "$current_id" =~ ^[a-f0-9]{64}$ ]] || return 1
    JOURNALED_CONTAINER_ID="$current_id"
  fi

  if [ -e "$container_ids_file" ] || [ -L "$container_ids_file" ]; then
    [ -f "$container_ids_file" ] && [ ! -L "$container_ids_file" ] || return 1
    [ "$(stat -c '%u:%g:%a' "$container_ids_file")" = \
      "$host_uid:$host_gid:600" ] || return 1
    total_id_lines="$(wc -l < "$container_ids_file")" || return 1
    app_id_count="$(sed -n '/^app=[a-f0-9]\{64\}$/p' "$container_ids_file" | wc -l)" || return 1
    proxy_id_count="$(sed -n '/^proxy=[a-f0-9]\{64\}$/p' "$container_ids_file" | wc -l)" || return 1
    invalid_id_lines="$(sed -n '/^app=[a-f0-9]\{64\}$/d; /^proxy=[a-f0-9]\{64\}$/d; p' "$container_ids_file")" || return 1
    [ -z "$invalid_id_lines" ] || return 1
    [ "$app_id_count" -eq 1 ] || return 1
    [ "$proxy_id_count" -le 1 ] || return 1
    [ "$total_id_lines" -eq $((app_id_count + proxy_id_count)) ] || return 1
    role_id_count="$(sed -n "s/^$role=//p" "$container_ids_file" | wc -l)" || return 1
    [ "$role_id_count" -le 1 ] || return 1
    if [ "$role_id_count" -eq 1 ]; then
      canonical_id="$(sed -n "s/^$role=//p" "$container_ids_file")" || return 1
      [[ "$canonical_id" =~ ^[a-f0-9]{64}$ ]] || return 1
    fi
  fi

  if [ -e "$cid_file" ] || [ -L "$cid_file" ]; then
    [ -f "$cid_file" ] && [ ! -L "$cid_file" ] || return 1
    [ "$(stat -c '%u:%g:%a' "$cid_file")" = "$host_uid:$host_gid:600" ] || return 1
    cid_id="$(cat "$cid_file")" || return 1
    if [[ ! "$cid_id" =~ ^[a-f0-9]{64}$ ]]; then
      cid_id=""
      JOURNAL_RECOVERY_REQUIRED=yes
    fi
  fi

  for current_id in "$canonical_id" "$cid_id"; do
    if [ -n "$current_id" ]; then
      if [ -n "$JOURNALED_CONTAINER_ID" ] && \
        [ "$JOURNALED_CONTAINER_ID" != "$current_id" ]; then
        printf 'Conflicting audit container IDs for %s\n' "$role" >&2
        return 1
      fi
      JOURNALED_CONTAINER_ID="$current_id"
    fi
  done
}

persist_recovered_cid() {
  local role="$1"
  local recovered_id="$2"
  local cid_file
  [[ "$recovered_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  case "$role" in
    app) cid_file="$app_cid_file" ;;
    proxy) cid_file="$proxy_cid_file" ;;
    *) return 1 ;;
  esac
  [ -d "$work" ] && [ ! -L "$work" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$work")" = "$host_uid:$host_gid:700" ] || return 1
  [ ! -e "$container_ids_tmp" ] && [ ! -L "$container_ids_tmp" ] || return 1
  printf '%s\n' "$recovered_id" > "$container_ids_tmp" || return 1
  chmod 0600 "$container_ids_tmp" || return 1
  [ "$(stat -c '%u:%g:%a' "$container_ids_tmp")" = \
    "$host_uid:$host_gid:600" ] || return 1
  mv -T -- "$container_ids_tmp" "$cid_file" || return 1
  [ -f "$cid_file" ] && [ ! -L "$cid_file" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$cid_file")" = "$host_uid:$host_gid:600" ] || return 1
  [ "$(cat "$cid_file")" = "$recovered_id" ] || return 1
}

remove_owned_container() {
  local target="$1"
  local role="$2"
  local expected_id=""
  local recovered_id=""
  local name_policy=recorded-id

  load_journaled_container_id "$role" || return 1
  expected_id="$JOURNALED_CONTAINER_ID"
  probe_exact_container "$target" || return 1

  if [ -z "$expected_id" ] && [ "$PROBED_RESOURCE_PRESENT" = yes ]; then
    assert_container_intent || return 1
    recovered_id="$(docker_control inspect "$target" --format '{{.Id}}')" || return 1
    [[ "$recovered_id" =~ ^[a-f0-9]{64}$ ]] || return 1
    case "$role" in
      app) audit_created_id="$recovered_id" ;;
      proxy) proxy_created_id="$recovered_id" ;;
      *) return 1 ;;
    esac
    assert_owned_container "$recovered_id" "$role" exact || return 1
    persist_recovered_cid "$role" "$recovered_id" || return 1
    expected_id="$recovered_id"
    name_policy=recorded-id
  elif [ -z "$expected_id" ] && [ "$JOURNAL_RECOVERY_REQUIRED" = yes ]; then
    printf 'Malformed CID journal cannot be recovered without the exact container name: %s\n' \
      "$target" >&2
    return 1
  fi

  if [ -n "$expected_id" ]; then
    case "$role" in
      app) audit_created_id="$expected_id" ;;
      proxy) proxy_created_id="$expected_id" ;;
      *) return 1 ;;
    esac
    if [ "$JOURNAL_RECOVERY_REQUIRED" = yes ]; then
      persist_recovered_cid "$role" "$expected_id" || return 1
      JOURNAL_RECOVERY_REQUIRED=no
    fi
    probe_exact_container_id "$expected_id" || return 1
    if [ "$PROBED_ID_PRESENT" = yes ]; then
      if ! assert_owned_container "$expected_id" "$role" "$name_policy"; then
        printf 'Refusing to remove unowned audit container ID: %s\n' "$expected_id" >&2
        return 1
      fi
      docker_control rm -f "$expected_id" >/dev/null || return 1
    fi
    probe_exact_container_id "$expected_id" || return 1
    [ "$PROBED_ID_PRESENT" = no ] || return 1
  fi

  probe_exact_container "$target" || return 1
  [ "$PROBED_RESOURCE_PRESENT" = no ] || return 1
}

validate_container_ids_journal_at() {
  local journal="$1"
  local total_id_lines
  local app_id_count
  local proxy_id_count
  local invalid_id_lines
  [ -f "$journal" ] && [ ! -L "$journal" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$journal")" = "$host_uid:$host_gid:600" ] || return 1
  total_id_lines="$(wc -l < "$journal")" || return 1
  app_id_count="$(sed -n '/^app=[a-f0-9]\{64\}$/p' "$journal" | wc -l)" || return 1
  proxy_id_count="$(sed -n '/^proxy=[a-f0-9]\{64\}$/p' "$journal" | wc -l)" || return 1
  invalid_id_lines="$(sed -n '/^app=[a-f0-9]\{64\}$/d; /^proxy=[a-f0-9]\{64\}$/d; p' "$journal")" || return 1
  [ -z "$invalid_id_lines" ] || return 1
  [ "$app_id_count" -eq 1 ] || return 1
  [ "$proxy_id_count" -le 1 ] || return 1
  [ "$total_id_lines" -eq $((app_id_count + proxy_id_count)) ] || return 1
}

validate_exact_cid_at() {
  local journal="$1"
  local journal_id
  [ -f "$journal" ] && [ ! -L "$journal" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$journal")" = "$host_uid:$host_gid:600" ] || return 1
  [ "$(stat -c '%s' "$journal")" -eq 65 ] || return 1
  [ "$(wc -l < "$journal")" -eq 1 ] || return 1
  journal_id="$(cat "$journal")" || return 1
  [[ "$journal_id" =~ ^[a-f0-9]{64}$ ]] || return 1
}

validate_owned_work_tree() {
  local directory="$1"
  local tree_state="$2"
  local sentinel="$directory/.school-authorized-visual-owner"
  local seed="$directory/seed.mjs"
  local proxy="$directory/proxy.mjs"
  local canonical="$directory/.container-ids"
  local temporary="$directory/.container-ids.tmp"
  local intent="$directory/.container-intent"
  local app_cid="$directory/.app.cid"
  local proxy_cid="$directory/.proxy.cid"
  local unexpected
  local temporary_size
  local path

  [ -d "$directory" ] && [ ! -L "$directory" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$directory")" = "$host_uid:$host_gid:700" ] || return 1
  if ! unexpected="$(
    find -P "$directory" -mindepth 1 -maxdepth 1 \
      ! -name .school-authorized-visual-owner \
      ! -name .container-ids ! -name .container-ids.tmp \
      ! -name .container-intent ! -name .app.cid ! -name .proxy.cid \
      ! -name seed.mjs ! -name proxy.mjs -print -quit
  )"; then
    return 1
  fi
  [ -z "$unexpected" ] || return 1

  if [ ! -e "$sentinel" ] && [ ! -L "$sentinel" ]; then
    [ "$tree_state" = tombstone ] || return 1
    if ! unexpected="$(
      find -P "$directory" -mindepth 1 -maxdepth 1 -print -quit
    )"; then
      return 1
    fi
    [ -z "$unexpected" ] || return 1
    return 0
  fi
  [ -f "$sentinel" ] && [ ! -L "$sentinel" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$sentinel")" = "$host_uid:$host_gid:600" ] || return 1
  [ "$(cat "$sentinel")" = \
    "$RUN_ID|$RUN_ATTEMPT|$AUDIT_SIDE|$AUDIT_SHA|$CONTROL_SHA" ] || return 1

  for path in "$seed" "$proxy" "$canonical" "$temporary" \
    "$intent" "$app_cid" "$proxy_cid"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] || return 1
      [ "$(stat -c '%u:%g' "$path")" = "$host_uid:$host_gid" ] || return 1
      case "$path:$(stat -c '%a' "$path")" in
        "$seed:444"|"$proxy:444"|"$canonical:600"|"$temporary:600"|\
        "$intent:600"|"$app_cid:600"|"$proxy_cid:600") ;;
        *) return 1 ;;
      esac
    fi
  done
  if [ -e "$seed" ]; then
    [ "${EXPECTED_SEED_SHA256}  ${seed}" = "$(sha256sum "$seed")" ] || return 1
  fi
  if [ -e "$proxy" ]; then
    [ "${EXPECTED_PROXY_SHA256}  ${proxy}" = "$(sha256sum "$proxy")" ] || return 1
  fi
  if [ -e "$canonical" ]; then
    validate_container_ids_journal_at "$canonical" || return 1
  fi
  if [ -e "$temporary" ]; then
    temporary_size="$(stat -c '%s' "$temporary")" || return 1
    [[ "$temporary_size" =~ ^[0-9]+$ ]] || return 1
    [ "$temporary_size" -le 256 ] || return 1
    sha256sum "$temporary" >/dev/null || return 1
  fi
  if [ -e "$intent" ]; then
    [ "$(cat "$intent")" = "$(expected_container_intent)" ] || return 1
  fi
  if [ -e "$app_cid" ]; then
    validate_exact_cid_at "$app_cid" || return 1
  fi
  if [ -e "$proxy_cid" ]; then
    validate_exact_cid_at "$proxy_cid" || return 1
  fi
  return 0
}

validate_owned_pending_tree() {
  local directory="$1"
  local tree_state="$2"
  local sentinel="$directory/.school-authorized-visual-owner"
  local current_devino
  local sentinel_size
  local unexpected
  local sentinel_valid=no

  [ -d "$directory" ] && [ ! -L "$directory" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$directory")" = "$host_uid:$host_gid:700" ] || return 1
  current_devino="$(stat -c '%d:%i' "$directory")" || return 1
  if ! unexpected="$(
    find -P "$directory" -mindepth 1 -maxdepth 1 \
      ! -name .school-authorized-visual-owner -print -quit
  )"; then
    return 1
  fi
  [ -z "$unexpected" ] || return 1

  if [ -f "$sentinel" ] && [ ! -L "$sentinel" ] &&
    [ "$(stat -c '%u:%g:%a' "$sentinel")" = "$host_uid:$host_gid:600" ] &&
    [ "$(cat "$sentinel")" = \
      "$RUN_ID|$RUN_ATTEMPT|$AUDIT_SIDE|$AUDIT_SHA|$CONTROL_SHA" ]; then
    sentinel_valid=yes
  fi
  if [ "$sentinel_valid" = yes ]; then
    return 0
  fi

  if [ "$tree_state" = active ]; then
    [ "$directory" = "$work_pending" ] || return 1
    [ "$work_pending_created" -eq 1 ] || return 1
    [ -n "$work_pending_devino" ] || return 1
    [ "$current_devino" = "$work_pending_devino" ] || return 1
  else
    [ "$tree_state" = tombstone ] || return 1
  fi
  if [ -e "$sentinel" ] || [ -L "$sentinel" ]; then
    [ -f "$sentinel" ] && [ ! -L "$sentinel" ] || return 1
    [ "$(stat -c '%u:%g:%a' "$sentinel")" = "$host_uid:$host_gid:600" ] || return 1
    sentinel_size="$(stat -c '%s' "$sentinel")" || return 1
    [[ "$sentinel_size" =~ ^[0-9]+$ ]] || return 1
    [ "$sentinel_size" -le 256 ] || return 1
    sha256sum "$sentinel" >/dev/null || return 1
  fi
  return 0
}

preflight_cleanup_filesystem() {
  local state_count=0
  local state_path
  CLEANUP_ACTIVE_KIND=""
  CLEANUP_ACTIVE_SOURCE=""
  CLEANUP_ACTIVE_TARGET=""
  CLEANUP_ACTIVE_DEVINO=""
  CLEANUP_SOCKET_PRESENT=no

  if [ -e "$AUDIT_TRANSPORT_ROOT" ] || [ -L "$AUDIT_TRANSPORT_ROOT" ]; then
    validate_transport_root || return 1
    if [ -e "$proxy_socket" ] || [ -L "$proxy_socket" ]; then
      CLEANUP_SOCKET_PRESENT=yes
    fi
  else
    [ ! -e "$proxy_socket" ] && [ ! -L "$proxy_socket" ] || return 1
  fi

  for state_path in "$work" "$work_pending" \
    "$work_tombstone" "$work_pending_tombstone"; do
    if [ -e "$state_path" ] || [ -L "$state_path" ]; then
      state_count=$((state_count + 1))
    fi
  done
  [ "$state_count" -le 1 ] || return 1

  if [ -e "$work" ] || [ -L "$work" ]; then
    validate_owned_work_tree "$work" active || return 1
    CLEANUP_ACTIVE_KIND=work
    CLEANUP_ACTIVE_SOURCE="$work"
    CLEANUP_ACTIVE_TARGET="$work_tombstone"
  elif [ -e "$work_pending" ] || [ -L "$work_pending" ]; then
    validate_owned_pending_tree "$work_pending" active || return 1
    CLEANUP_ACTIVE_KIND=pending
    CLEANUP_ACTIVE_SOURCE="$work_pending"
    CLEANUP_ACTIVE_TARGET="$work_pending_tombstone"
  elif [ -e "$work_tombstone" ] || [ -L "$work_tombstone" ]; then
    validate_owned_work_tree "$work_tombstone" tombstone || return 1
    CLEANUP_ACTIVE_KIND=work-tombstone
    CLEANUP_ACTIVE_TARGET="$work_tombstone"
  elif [ -e "$work_pending_tombstone" ] || [ -L "$work_pending_tombstone" ]; then
    validate_owned_pending_tree "$work_pending_tombstone" tombstone || return 1
    CLEANUP_ACTIVE_KIND=pending-tombstone
    CLEANUP_ACTIVE_TARGET="$work_pending_tombstone"
  fi
  if [ -n "$CLEANUP_ACTIVE_KIND" ]; then
    CLEANUP_ACTIVE_DEVINO="$(stat -c '%d:%i' \
      "${CLEANUP_ACTIVE_SOURCE:-$CLEANUP_ACTIVE_TARGET}")" || return 1
    [ -n "$CLEANUP_ACTIVE_DEVINO" ] || return 1
  fi
  return 0
}

purge_owned_work_tombstone() {
  local directory="$1"
  local expected_devino="$2"
  local sentinel="$directory/.school-authorized-visual-owner"
  local path
  [ "$(stat -c '%d:%i' "$directory")" = "$expected_devino" ] || return 1
  validate_owned_work_tree "$directory" tombstone || return 1
  for path in "$directory/seed.mjs" "$directory/proxy.mjs" \
    "$directory/.container-ids" "$directory/.container-ids.tmp" \
    "$directory/.container-intent" "$directory/.app.cid" \
    "$directory/.proxy.cid"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      rm -f -- "$path" || return 1
    fi
  done
  if [ -e "$sentinel" ] || [ -L "$sentinel" ]; then
    rm -f -- "$sentinel" || return 1
  fi
  rmdir -- "$directory" || return 1
}

purge_owned_pending_tombstone() {
  local directory="$1"
  local expected_devino="$2"
  local sentinel="$directory/.school-authorized-visual-owner"
  [ "$(stat -c '%d:%i' "$directory")" = "$expected_devino" ] || return 1
  validate_owned_pending_tree "$directory" tombstone || return 1
  if [ -e "$sentinel" ] || [ -L "$sentinel" ]; then
    rm -f -- "$sentinel" || return 1
  fi
  rmdir -- "$directory" || return 1
}

commit_cleanup_filesystem() {
  local committed_devino="$CLEANUP_ACTIVE_DEVINO"

  if [ "$CLEANUP_SOCKET_PRESENT" = yes ]; then
    [ -S "$proxy_socket" ] && [ ! -L "$proxy_socket" ] || return 1
    [ "$(stat -c '%u:%g:%a' "$proxy_socket")" = \
      "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID:600" ] || return 1
    rm -f -- "$proxy_socket" || return 1
    [ ! -e "$proxy_socket" ] && [ ! -L "$proxy_socket" ] || return 1
  else
    [ ! -e "$proxy_socket" ] && [ ! -L "$proxy_socket" ] || return 1
  fi

  case "$CLEANUP_ACTIVE_KIND" in
    work|pending)
      [ -d "$CLEANUP_ACTIVE_SOURCE" ] && \
        [ ! -L "$CLEANUP_ACTIVE_SOURCE" ] || return 1
      [ "$(stat -c '%d:%i' "$CLEANUP_ACTIVE_SOURCE")" = \
        "$CLEANUP_ACTIVE_DEVINO" ] || return 1
      [ ! -e "$CLEANUP_ACTIVE_TARGET" ] && \
        [ ! -L "$CLEANUP_ACTIVE_TARGET" ] || return 1
      [ ! -e "$proxy_socket" ] && [ ! -L "$proxy_socket" ] || return 1
      mv -T -n -- "$CLEANUP_ACTIVE_SOURCE" "$CLEANUP_ACTIVE_TARGET" || return 1
      [ ! -e "$CLEANUP_ACTIVE_SOURCE" ] && \
        [ ! -L "$CLEANUP_ACTIVE_SOURCE" ] || return 1
      [ -d "$CLEANUP_ACTIVE_TARGET" ] && \
        [ ! -L "$CLEANUP_ACTIVE_TARGET" ] || return 1
      [ "$(stat -c '%d:%i' "$CLEANUP_ACTIVE_TARGET")" = \
        "$CLEANUP_ACTIVE_DEVINO" ] || return 1
      ;;
    work-tombstone|pending-tombstone|'') ;;
    *) return 1 ;;
  esac

  case "$CLEANUP_ACTIVE_KIND" in
    work|work-tombstone)
      purge_owned_work_tombstone "$work_tombstone" "$committed_devino" || return 1
      ;;
    pending|pending-tombstone)
      purge_owned_pending_tombstone \
        "$work_pending_tombstone" "$committed_devino" || return 1
      work_pending_created=0
      work_pending_devino=""
      ;;
    '') ;;
    *) return 1 ;;
  esac
  return 0
}

write_container_ids() {
  local temporary="$container_ids_tmp"
  [[ "$audit_created_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  if [ -n "$proxy_created_id" ]; then
    [[ "$proxy_created_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  fi
  [ -d "$work" ] && [ ! -L "$work" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$work")" = "$host_uid:$host_gid:700" ] || return 1
  [ ! -e "$temporary" ] && [ ! -L "$temporary" ] || return 1
  {
    printf 'app=%s\n' "$audit_created_id"
    if [ -n "$proxy_created_id" ]; then
      printf 'proxy=%s\n' "$proxy_created_id"
    fi
  } > "$temporary" || return 1
  chmod 0600 "$temporary" || return 1
  [ "$(stat -c '%u:%g:%a' "$temporary")" = "$host_uid:$host_gid:600" ] || return 1
  mv -T -- "$temporary" "$container_ids_file" || return 1
  [ -f "$container_ids_file" ] && [ ! -L "$container_ids_file" ] || return 1
}

remove_resources() {
  local cleanup_rc=0
  local containers_absent=yes
  local app_cleanup_proven=no
  local proxy_cleanup_proven=no
  if remove_owned_container "$audit_proxy" proxy; then
    proxy_cleanup_proven=yes
  else
    cleanup_rc=1
  fi
  if remove_owned_container "$audit" app; then
    app_cleanup_proven=yes
  else
    cleanup_rc=1
  fi
  if [ "$proxy_cleanup_proven" != yes ] || [ "$app_cleanup_proven" != yes ]; then
    containers_absent=no
  fi
  PROBED_RESOURCE_PRESENT=yes
  if ! probe_exact_container "$audit_proxy"; then cleanup_rc=1; fi
  if [ "$PROBED_RESOURCE_PRESENT" != no ]; then containers_absent=no; fi
  PROBED_RESOURCE_PRESENT=yes
  if ! probe_exact_container "$audit"; then cleanup_rc=1; fi
  if [ "$PROBED_RESOURCE_PRESENT" != no ]; then containers_absent=no; fi
  if [ "$containers_absent" = yes ]; then
    if preflight_cleanup_filesystem; then
      commit_cleanup_filesystem || cleanup_rc=1
    else
      cleanup_rc=1
    fi
  else
    cleanup_rc=1
  fi
  return "$cleanup_rc"
}

case "$ACTION" in
  prepare)
    : "${AUDIT_PASSWORD:?AUDIT_PASSWORD is required for prepare}"
    if [ "${#AUDIT_PASSWORD}" -lt 32 ] || [[ ! "$AUDIT_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]]; then
      printf 'Invalid audit password\n' >&2
      exit 1
    fi

    test "$(docker_control image inspect "$AUDIT_IMAGE" --format '{{.Id}}')" = \
      "$AUDIT_IMAGE_ID"
    design_flag_values="$(
      docker_control image inspect "$AUDIT_IMAGE_ID" \
        --format '{{range .Config.Env}}{{println .}}{{end}}' | \
        sed -n 's/^NEXT_PUBLIC_SCHOOL_DESIGN_V1=//p' | sed '/^$/d'
    )"
    test "$(printf '%s\n' "$design_flag_values" | wc -l)" -eq 1
    test "$design_flag_values" = "$AUDIT_EXPECTED_DESIGN_FLAG"
    probe_exact_container "$audit"
    if [ "$PROBED_RESOURCE_PRESENT" = yes ]; then
      printf 'Audit container already exists\n' >&2
      exit 1
    fi
    probe_exact_container "$audit_proxy"
    if [ "$PROBED_RESOURCE_PRESENT" = yes ]; then
      printf 'Audit proxy container already exists\n' >&2
      exit 1
    fi
    if [ -e "$work" ] || [ -L "$work" ]; then
      printf 'Audit work directory already exists\n' >&2
      exit 1
    fi
    if [ -e "$work_pending" ] || [ -L "$work_pending" ]; then
      printf 'Audit pending work directory already exists\n' >&2
      exit 1
    fi
    if [ -e "$work_tombstone" ] || [ -L "$work_tombstone" ] ||
      [ -e "$work_pending_tombstone" ] || [ -L "$work_pending_tombstone" ]; then
      printf 'Audit cleanup tombstone already exists\n' >&2
      exit 1
    fi
    proxy_socket_bytes="$(
      LC_ALL=C printf '%s' "$proxy_socket" | LC_ALL=C wc -c | tr -d '[:space:]'
    )"
    [[ "$proxy_socket_bytes" =~ ^[0-9]+$ ]]
    test "$proxy_socket_bytes" -lt 108

    prepare_finished=0
    prepare_cleanup() {
      local rc=$?
      local cleanup_rc=0
      trap - EXIT
      set +e
      if [ "$prepare_finished" -ne 1 ]; then
        remove_resources || cleanup_rc=1
        printf 'SCHOOL_AUTHORIZED_VISUAL_PREPARE_CLEANUP=ATTEMPTED_AFTER_FAILURE result=%s\n' \
          "$cleanup_rc" >&2
      fi
      if [ "$rc" -eq 0 ] && [ "$cleanup_rc" -ne 0 ]; then rc=1; fi
      exit "$rc"
    }
    trap prepare_cleanup EXIT

    mkdir -m 0700 -- "$work_pending"
    work_pending_created=1
    work_pending_devino="$(stat -c '%d:%i' "$work_pending")"
    test -n "$work_pending_devino"
    printf '%s|%s|%s|%s|%s\n' \
      "$RUN_ID" "$RUN_ATTEMPT" "$AUDIT_SIDE" "$AUDIT_SHA" "$CONTROL_SHA" \
      > "$work_pending_sentinel"
    chmod 0600 "$work_pending_sentinel"
    test "$(stat -c '%u:%g:%a' "$work_pending")" = "$host_uid:$host_gid:700"
    test "$(stat -c '%u:%g:%a' "$work_pending_sentinel")" = \
      "$host_uid:$host_gid:600"
    test "$(cat "$work_pending_sentinel")" = \
      "$RUN_ID|$RUN_ATTEMPT|$AUDIT_SIDE|$AUDIT_SHA|$CONTROL_SHA"
    mv -T -- "$work_pending" "$work"
    work_pending_created=0
    work_pending_devino=""
    test -d "$work"
    test ! -L "$work"
    test "$(stat -c '%u:%g:%a' "$work")" = "$host_uid:$host_gid:700"
    test "$(cat "$work_sentinel")" = \
      "$RUN_ID|$RUN_ATTEMPT|$AUDIT_SIDE|$AUDIT_SHA|$CONTROL_SHA"

    cat > "$seed_script" <<'PREPARE_DATA'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const run = process.env.AUDIT_RUN_ID;
const password = process.env.AUDIT_PASSWORD;
const seedDate = process.env.AUDIT_SEED_DATE || '';
const source = process.env.AUDIT_SOURCE;
if (!/^[0-9]+$/.test(run || '')) throw new Error('Invalid audit run id');
if (!/^[A-Za-z0-9_-]{32,}$/.test(password || '')) throw new Error('Invalid audit password');
if (!new Set(['base-migrations-only', 'candidate-migrations-only']).has(source)) {
  throw new Error('Invalid audit source');
}
if (seedDate && !/^\d{4}-\d{2}-\d{2}$/.test(seedDate)) throw new Error('Invalid audit seed date');

const target = '/data/school-1-11.sqlite';
const db = new DatabaseSync(target);
db.exec('PRAGMA foreign_keys = OFF');
const migrationFiles = readdirSync('/app/drizzle')
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (migrationFiles.length < 6) throw new Error('Candidate migration inventory is incomplete');
for (const file of migrationFiles) {
  db.exec(readFileSync('/app/drizzle/' + file, 'utf8'));
}
db.exec('PRAGMA foreign_keys = ON');

const userTables = db
  .prepare(`SELECT name FROM sqlite_schema
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '__drizzle%'
      AND name NOT LIKE '_cf_%'
    ORDER BY name`)
  .all()
  .map((row) => row.name);
if (userTables.length < 20) throw new Error('Unexpected candidate table inventory');
const quoteIdentifier = (value) => '"' + String(value).replaceAll('"', '""') + '"';
for (const table of userTables) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM ' + quoteIdentifier(table)).get().count;
  if (count !== 0) throw new Error('Candidate migration schema is not empty: ' + table);
}

const className = '1А';
const subjects = [
  { id: 'audit-subject-math', name: 'Математика', short: 'Математика', color: '#6d5bd0', icon: 'calculator' },
  { id: 'audit-subject-russian', name: 'Русский язык', short: 'Русский', color: '#e04512', icon: 'book' },
  { id: 'audit-subject-world', name: 'Окружающий мир', short: 'Окр. мир', color: '#168455', icon: 'globe' },
];
const insertSubject = db.prepare(
  `INSERT INTO subjects
    (id, name, short_name, color, icon, stage, weekly_hours, status)
   VALUES (?, ?, ?, ?, ?, '1–4', 4, 'active')`,
);
for (const subject of subjects) {
  insertSubject.run(subject.id, subject.name, subject.short, subject.color, subject.icon);
}

const students = Array.from({ length: 6 }, (_, index) => ({
  id: 'audit-student-' + String(index + 1).padStart(2, '0'),
  firstName: 'Ученик',
  lastName: 'Тестовый ' + String(index + 1).padStart(2, '0'),
  color: ['#e04512', '#6d5bd0', '#168455', '#2563eb', '#c78012', '#0e7490'][index],
}));
const insertStudent = db.prepare(
  `INSERT INTO students
    (id, first_name, last_name, class_name, avatar_color, status)
   VALUES (?, ?, ?, ?, ?, 'active')`,
);
for (const student of students) {
  insertStudent.run(student.id, student.firstName, student.lastName, className, student.color);
}

const scrypt = promisify(scryptCallback);
const salt = randomBytes(16);
const derived = await scrypt(password, salt, 64, {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const passwordHash =
  'scrypt$32768$8$1$' +
  salt.toString('base64url') +
  '$' +
  Buffer.from(derived).toString('base64url');

const roles = new Map([
  ['director', 'Аудит Директор'],
  ['teacher', 'Аудит Учитель'],
  ['parent', 'Аудит Родитель'],
  ['student', 'Аудит Ученик'],
]);
const users = new Map();
for (const [role, displayName] of roles) {
  const id = 'authorized-visual-' + run + '-' + role;
  const email = 'authorized-visual-' + run + '-' + role + '@invalid.local';
  const linkedStudentId = role === 'parent' || role === 'student' ? students[0].id : null;
  db.prepare(
    `INSERT INTO users
      (id, email, display_name, role, linked_student_id, status, profile_status,
       notes, password_hash, password_state, auth_version, failed_login_count,
       locked_until, identity_source, central_access_version)
     VALUES (?, ?, ?, ?, ?, 'active', 'confirmed', '',
       ?, 'active', 1, 0, NULL, 'visual_audit', 0)`,
  ).run(id, email, displayName, role, linkedStudentId, passwordHash);
  users.set(role, { id, email });
}

db.prepare(
  `INSERT INTO school_classes
    (id, name, grade, homeroom_teacher_user_id, status)
   VALUES ('audit-class-1a', ?, 1, ?, 'active')`,
).run(className, users.get('teacher').id);

for (const role of ['parent', 'student']) {
  db.prepare(
    "INSERT INTO user_student_links (id, user_id, student_id, relation) VALUES (?, ?, ?, ?)",
  ).run(
    'authorized-visual-link-' + run + '-' + role,
    users.get(role).id,
    students[0].id,
    role === 'student' ? 'self' : 'guardian',
  );
}

db.prepare(
  `INSERT INTO teacher_assignments
    (id, teacher_user_id, class_name, subject_id, status, notes)
   VALUES (?, ?, ?, ?, 'confirmed', 'ephemeral visual audit')`,
).run(
  'authorized-visual-assignment-' + run,
  users.get('teacher').id,
  className,
  subjects[0].id,
);

const lessonIds = [];
const insertLesson = db.prepare(
  `INSERT INTO lessons
    (id, class_name, weekday, starts_at, ends_at, subject_id,
     teacher_user_id, room, status, note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', NULL)`,
);
for (let weekday = 1; weekday <= 5; weekday += 1) {
  const subject = subjects[(weekday - 1) % subjects.length];
  const id = 'audit-lesson-' + weekday;
  lessonIds.push(id);
  insertLesson.run(
    id,
    className,
    weekday,
    '0' + (7 + weekday) + ':30',
    '0' + (8 + weekday) + ':15',
    subject.id,
    users.get('teacher').id,
    'Кабинет ' + (10 + weekday),
  );
}

const today = seedDate ? new Date(seedDate + 'T12:00:00.000Z') : new Date();
if (Number.isNaN(today.valueOf()) || (seedDate && today.toISOString().slice(0, 10) !== seedDate)) {
  throw new Error('Invalid normalized audit seed date');
}
const addDays = (amount) => {
  const value = new Date(today);
  value.setUTCDate(value.getUTCDate() + amount);
  return value;
};
const dateOnly = (value) => value.toISOString().slice(0, 10);
const dateTime = (value, hour = 12) => {
  const copy = new Date(value);
  copy.setUTCHours(hour, 0, 0, 0);
  return copy.toISOString();
};

const insertGrade = db.prepare(
  `INSERT INTO grades
    (id, student_id, subject_id, teacher_user_id, value, weight,
     title, grade_date, comment)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
);
for (const [studentIndex, student] of students.entries()) {
  insertGrade.run(
    'audit-grade-' + studentIndex + '-math',
    student.id,
    subjects[0].id,
    users.get('teacher').id,
    4 + (studentIndex % 2),
    1,
    'Самостоятельная работа',
    dateOnly(addDays(-2)),
  );
  insertGrade.run(
    'audit-grade-' + studentIndex + '-russian',
    student.id,
    subjects[1].id,
    users.get('teacher').id,
    3 + (studentIndex % 3),
    2,
    'Контрольная работа',
    dateOnly(addDays(-1)),
  );
}

const insertHomework = db.prepare(
  `INSERT INTO homework
    (id, class_name, subject_id, teacher_user_id, title, description, due_at, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'published')`,
);
for (const [index, subject] of subjects.entries()) {
  insertHomework.run(
    'audit-homework-' + index,
    className,
    subject.id,
    users.get('teacher').id,
    ['Задачи 12–16', 'Упражнение 24', 'Наблюдение за погодой'][index],
    'Синтетическое учебное задание для проверки макета.',
    dateTime(addDays(index + 1), 15),
  );
}

db.prepare(
  `INSERT INTO achievements
    (id, student_id, teacher_user_id, title, description, category, achievement_date)
   VALUES ('audit-achievement-1', ?, ?, 'Отличная работа',
     'Синтетическое достижение для проверки карточки.', 'study', ?)`,
).run(students[0].id, users.get('teacher').id, dateOnly(addDays(-3)));

db.prepare(
  `INSERT INTO teacher_comments
    (id, student_id, teacher_user_id, subject_id, body, visibility, comment_date)
   VALUES ('audit-comment-1', ?, ?, ?,
     'Синтетический комментарий для визуального аудита.', 'parent', ?)`,
).run(
  students[0].id,
  users.get('teacher').id,
  subjects[0].id,
  dateOnly(addDays(-1)),
);

db.prepare(
  `INSERT INTO threads
    (id, student_id, parent_user_id, teacher_user_id, title)
   VALUES ('audit-thread-1', ?, ?, ?, 'Учебный диалог')`,
).run(students[0].id, users.get('parent').id, users.get('teacher').id);
db.prepare(
  `INSERT INTO messages
    (id, thread_id, author_user_id, body, read_at)
   VALUES ('audit-message-1', 'audit-thread-1', ?,
     'Синтетическое сообщение для проверки макета.', NULL)`,
).run(users.get('parent').id);

const insertMenu = db.prepare(
  `INSERT INTO menu_days
    (id, day_date, breakfast, lunch, snack, allergens)
   VALUES (?, ?, 'Каша и фрукты', 'Суп и горячее', 'Выпечка', '')`,
);
for (let index = 0; index < 3; index += 1) {
  insertMenu.run('audit-menu-' + index, dateOnly(addDays(index)));
}

const insertEvent = db.prepare(
  `INSERT INTO events
    (id, title, description, starts_at, location, audience, status, capacity)
   VALUES (?, ?, ?, ?, 'Школа', 'all', 'published', ?)`,
);
insertEvent.run(
  'audit-event-1',
  'Школьная встреча',
  'Синтетическое событие для проверки карточки.',
  dateTime(addDays(2), 16),
  60,
);
insertEvent.run(
  'audit-event-2',
  'Творческая мастерская',
  'Синтетическое событие для проверки длинного заголовка.',
  dateTime(addDays(5), 14),
  24,
);

const insertActivity = db.prepare(
  `INSERT INTO activities
    (id, title, schedule, teacher, price, capacity, enrolled, status)
   VALUES (?, ?, ?, 'Педагог', ?, ?, ?, 'open')`,
);
insertActivity.run('audit-activity-1', 'Робототехника', 'Среда · 16:00', 0, 16, 9);
insertActivity.run('audit-activity-2', 'Театральная студия', 'Пятница · 15:30', 1200, 20, 14);

db.prepare(
  `INSERT INTO subscriptions
    (id, student_id, name, period, status, balance, lessons_left, renewal_at)
   VALUES ('audit-subscription-1', ?, 'Школьное питание', 'month', 'active', 2400, 12, ?)`,
).run(students[0].id, dateOnly(addDays(30)));

db.prepare(
  `INSERT INTO programs
    (id, academic_year, class_name, subject_id, teacher_user_id, title,
     status, planned_lessons, completed_lessons, review_comment)
   VALUES ('audit-program-1', '2026/2027', ?, ?, ?,
     'Математика · 1 класс', 'approved', 132, 18, '')`,
).run(className, subjects[0].id, users.get('teacher').id);

const insertAttendance = db.prepare(
  `INSERT INTO attendance
    (id, lesson_id, student_id, status, note, marked_by_user_id)
   VALUES (?, ?, ?, ?, NULL, ?)`,
);
for (const [index, student] of students.entries()) {
  insertAttendance.run(
    'audit-attendance-' + index,
    lessonIds[0],
    student.id,
    index === 4 ? 'absent' : 'present',
    users.get('teacher').id,
  );
}

const insertNotification = db.prepare(
  `INSERT INTO notifications
    (id, user_id, category, title, body, entity_type, entity_id, critical, read_at)
   VALUES (?, ?, 'study', 'Учебное уведомление',
     'Синтетическое уведомление для визуального аудита.', 'lesson', ?, 0, NULL)`,
);
for (const [role, user] of users) {
  insertNotification.run('audit-notification-' + role, user.id, lessonIds[0]);
}

const invitationId = 'audit-invitation-1';
db.prepare(
  `INSERT INTO account_invitations
    (id, token_hash, target_role, student_id, class_name, created_by_user_id,
     expires_at, max_uses, used_count, status)
   VALUES (?, ?, 'parent', ?, ?, ?, ?, 1, 0, 'active')`,
).run(
  invitationId,
  randomBytes(32).toString('hex'),
  students[1].id,
  className,
  users.get('director').id,
  dateTime(addDays(7)),
);
db.prepare(
  `INSERT INTO registration_requests
    (id, email, display_name, requested_role, student_first_name,
     student_last_name, class_name, relation, invitation_id, student_id, status)
   VALUES ('audit-registration-1', 'request@invalid.local', 'Заявитель Тестовый',
     'parent', 'Ученик', 'Тестовый 02', ?, 'guardian', ?, ?, 'pending')`,
).run(className, invitationId, students[1].id);

db.prepare(
  `INSERT INTO audit_log
    (id, actor_user_id, action, entity_type, entity_id, details)
   VALUES ('audit-log-1', ?, 'visual.audit.seed', 'fixture', ?, '{}')`,
).run(users.get('director').id, 'authorized-visual-' + run);

const unsafeUsers = db.prepare(
  `SELECT COUNT(*) AS count FROM users
   WHERE email NOT LIKE '%@invalid.local'
      OR phone IS NOT NULL
      OR central_user_id IS NOT NULL`,
).get().count;
const unsafeRequests = db.prepare(
  `SELECT COUNT(*) AS count FROM registration_requests
   WHERE email NOT LIKE '%@invalid.local'`,
).get().count;
const credentialRows = db.prepare(
  `SELECT
    (SELECT COUNT(*) FROM auth_sessions) +
    (SELECT COUNT(*) FROM credential_tokens) AS count`,
).get().count;
if (unsafeUsers !== 0 || unsafeRequests !== 0 || credentialRows !== 0) {
  throw new Error('Synthetic fixture privacy invariant failed');
}

const integrityAfter = db.prepare('PRAGMA integrity_check').all();
if (integrityAfter.length !== 1 || integrityAfter[0].integrity_check !== 'ok') {
  throw new Error('Authorized visual output integrity failed');
}
const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
if (foreignKeyViolations.length) throw new Error('Authorized visual foreign key check failed');
db.close();
chmodSync('/data', 0o750);
chmodSync(target, 0o640);
console.log(`SCHOOL_AUTHORIZED_VISUAL_SOURCE=${source}`);
console.log('SCHOOL_AUTHORIZED_VISUAL_DATA=SYNTHETIC');
console.log('SCHOOL_AUTHORIZED_VISUAL_ROLES=SEEDED');
PREPARE_DATA

    chmod 0444 "$seed_script"
    test "${EXPECTED_SEED_SHA256}  ${seed_script}" = "$(sha256sum "$seed_script")"
    cat > "$proxy_script" <<'PROXY_DATA'
import { chmodSync } from 'node:fs';
import { createServer, connect } from 'node:net';

const socketPath = process.env.AUDIT_PROXY_SOCKET;
if (socketPath !== '/transport/audit.sock') {
  throw new Error('Invalid audit proxy socket path');
}
const server = createServer((client) => {
  const upstream = connect({ host: '127.0.0.1', port: 3000 });
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
});
server.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
  console.log('SCHOOL_AUTHORIZED_VISUAL_PROXY=READY');
});
PROXY_DATA
    chmod 0444 "$proxy_script"
    test "${EXPECTED_PROXY_SHA256}  ${proxy_script}" = "$(sha256sum "$proxy_script")"

    audit_secret="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
    test "${#audit_secret}" -eq 64
    expected_container_intent > "$container_intent_file"
    chmod 0600 "$container_intent_file"
    assert_container_intent

    audit_created_id="$(
      docker_control create \
      --cidfile "$app_cid_file" \
      --name "$audit" \
      --network none \
      --user "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID" \
      --read-only \
      --tmpfs "/data:rw,noexec,nosuid,nodev,size=268435456,mode=0750,uid=$AUDIT_RUNTIME_UID,gid=$AUDIT_RUNTIME_GID" \
      --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=134217728,mode=1770,uid=$AUDIT_RUNTIME_UID,gid=$AUDIT_RUNTIME_GID" \
      --memory 1073741824 \
      --memory-swap 1073741824 \
      --cpus 1.5 \
      --log-driver local \
      --log-opt max-size=10m \
      --log-opt max-file=1 \
      --security-opt no-new-privileges:true \
      --cap-drop ALL \
      --pids-limit 256 \
      --ulimit nofile=1024:1024 \
      --label school.system=school-1-11 \
      --label school.environment=synthetic-local-authorized-visual-audit \
      --label school.purpose=design-v1-authorized-audit \
      --label school.audit-role=app \
      --label school.audit-side="$AUDIT_SIDE" \
      --label school.candidate-sha="$AUDIT_SHA" \
      --label school.audit-sha="$AUDIT_SHA" \
      --label school.audit-run-id="$RUN_ID" \
      --label school.audit-run-attempt="$RUN_ATTEMPT" \
      --label school.runtime-uid="$AUDIT_RUNTIME_UID" \
      --label school.runtime-gid="$AUDIT_RUNTIME_GID" \
      --label school.control-sha="$CONTROL_SHA" \
      --label school.control-script-sha="$EXPECTED_SEED_SHA256" \
      -e AUDIT_PASSWORD="$AUDIT_PASSWORD" \
      -e AUDIT_RUN_ID="$RUN_ID" \
      -e AUDIT_SEED_DATE="$AUDIT_SEED_DATE" \
      -e AUDIT_SOURCE="$AUDIT_SOURCE" \
      -e NODE_ENV=production \
      -e PORT=3000 \
      -e DATABASE_PATH=/data/school-1-11.sqlite \
      -e PUBLIC_APP_ORIGIN="$AUDIT_PUBLIC_ORIGIN" \
      -e CENTRAL_ACCESS_SECRET="$audit_secret" \
      --mount type=bind,source="$seed_script",target=/control/seed.mjs,readonly \
      --entrypoint /bin/sh \
      "$AUDIT_IMAGE_ID" -c \
        'set -eu; node /control/seed.mjs; exec ./scripts/container-entrypoint.sh node server.js'
    )"

    [[ "$audit_created_id" =~ ^[a-f0-9]{64}$ ]]
    test -f "$app_cid_file"
    test ! -L "$app_cid_file"
    test "$(stat -c '%u:%g:%a' "$app_cid_file")" = "$host_uid:$host_gid:600"
    test "$(cat "$app_cid_file")" = "$audit_created_id"
    write_container_ids
    assert_owned_container "$audit_created_id" app
    audit_id="$audit_created_id"
    [[ "$audit_id" =~ ^[a-f0-9]{64}$ ]]
    test "$audit_id" = "$audit_created_id"
    test "$(docker_control inspect "$audit_id" --format '{{.State.Status}}')" = created
    test "$(docker_control inspect "$audit_id" --format '{{.State.Running}}')" = false
    test "$(docker_control inspect "$audit_id" --format '{{.HostConfig.NetworkMode}}')" = none
    test "$(docker_control inspect "$audit_id" --format '{{.Config.User}}')" = \
      "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID"
    test "$(docker_control inspect "$audit_id" --format '{{.HostConfig.ReadonlyRootfs}}')" = true
    test "$(docker_control inspect "$audit_id" --format '{{.HostConfig.Privileged}}')" = false
    test "$(docker_control inspect "$audit_id" --format '{{.HostConfig.Memory}}')" = 1073741824
    test "$(docker_control inspect "$audit_id" --format '{{.HostConfig.MemorySwap}}')" = 1073741824
    test "$(docker_control inspect "$audit_id" --format '{{.HostConfig.NanoCpus}}')" = 1500000000
    test "$(docker_control inspect "$audit_id" --format '{{.HostConfig.PidsLimit}}')" = 256
    test "$(docker_control inspect "$audit_id" --format '{{len .HostConfig.PortBindings}}')" = 0
    docker_control inspect "$audit_id" | EXPECTED_SEED="$seed_script" \
      EXPECTED_APP_COMMAND='set -eu; node /control/seed.mjs; exec ./scripts/container-entrypoint.sh node server.js' \
      python3 -c '
import json, os, sys
d = json.load(sys.stdin)[0]
h = d["HostConfig"]
c = d["Config"]
uid = os.environ["AUDIT_RUNTIME_UID"]
gid = os.environ["AUDIT_RUNTIME_GID"]
if d["State"]["Status"] != "created" or d["State"]["Running"]:
    raise RuntimeError("Audit app started before exact inspection")
if c["User"] != uid + ":" + gid:
    raise RuntimeError("Wrong audit app runtime identity")
if c["Entrypoint"] != ["/bin/sh"] or c["Cmd"] != ["-c", os.environ["EXPECTED_APP_COMMAND"]]:
    raise RuntimeError("Wrong audit app command")
if h["NetworkMode"] != "none" or h["AutoRemove"] or h["Privileged"] or not h["ReadonlyRootfs"]:
    raise RuntimeError("Wrong audit app isolation mode")
if h["RestartPolicy"] != {"Name": "no", "MaximumRetryCount": 0}:
    raise RuntimeError("Wrong audit app restart policy")
if h["Memory"] != 1073741824 or h["MemorySwap"] != 1073741824 or h["NanoCpus"] != 1500000000 or h["PidsLimit"] != 256:
    raise RuntimeError("Wrong audit app resource limits")
if h.get("Ulimits") != [{"Name": "nofile", "Hard": 1024, "Soft": 1024}]:
    raise RuntimeError("Wrong audit app file-descriptor limit")
if h.get("PortBindings") not in ({}, None) or h["PublishAllPorts"]:
    raise RuntimeError("Unexpected audit app port exposure")
expected_tmpfs = {
    "/data": {"rw", "noexec", "nosuid", "nodev", "size=268435456", "mode=0750", "uid=" + uid, "gid=" + gid},
    "/tmp": {"rw", "noexec", "nosuid", "nodev", "size=134217728", "mode=1770", "uid=" + uid, "gid=" + gid},
}
actual_tmpfs = {k: set(v.split(",")) for k, v in h["Tmpfs"].items()}
if actual_tmpfs != expected_tmpfs:
    raise RuntimeError("Wrong audit tmpfs configuration")
binds = [m for m in d["Mounts"] if m["Type"] == "bind"]
if len(binds) != 1 or binds[0]["Destination"] != "/control/seed.mjs" or binds[0]["Source"] != os.environ["EXPECTED_SEED"] or binds[0]["RW"]:
    raise RuntimeError("Wrong audit bind mount")
if any(m["Type"] not in {"bind", "tmpfs"} for m in d["Mounts"]):
    raise RuntimeError("Unexpected audit mount type")
if h["CapDrop"] != ["ALL"] or h["CapAdd"] not in (None, []) or h["SecurityOpt"] != ["no-new-privileges:true"]:
    raise RuntimeError("Wrong audit security options")
if h["LogConfig"] != {"Type": "local", "Config": {"max-file": "1", "max-size": "10m"}}:
    raise RuntimeError("Wrong audit log cap")
' 

    docker_control start "$audit_id" >/dev/null
    assert_owned_container "$audit_id" app
    test "$(docker_control inspect "$audit_id" --format '{{.State.Running}}')" = true

    proxy_created_id="$(
      docker_control create \
      --cidfile "$proxy_cid_file" \
      --name "$audit_proxy" \
      --network "container:$audit_id" \
      --user "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID" \
      --read-only \
      --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1770,uid=$AUDIT_RUNTIME_UID,gid=$AUDIT_RUNTIME_GID" \
      --memory 134217728 \
      --memory-swap 134217728 \
      --cpus 0.5 \
      --log-driver local \
      --log-opt max-size=10m \
      --log-opt max-file=1 \
      --pids-limit 64 \
      --ulimit nofile=1024:1024 \
      --security-opt no-new-privileges:true \
      --cap-drop ALL \
      --label school.system=school-1-11 \
      --label school.environment=synthetic-local-authorized-visual-audit \
      --label school.purpose=design-v1-authorized-audit \
      --label school.audit-role=proxy \
      --label school.audit-side="$AUDIT_SIDE" \
      --label school.candidate-sha="$AUDIT_SHA" \
      --label school.audit-sha="$AUDIT_SHA" \
      --label school.audit-run-id="$RUN_ID" \
      --label school.audit-run-attempt="$RUN_ATTEMPT" \
      --label school.runtime-uid="$AUDIT_RUNTIME_UID" \
      --label school.runtime-gid="$AUDIT_RUNTIME_GID" \
      --label school.control-sha="$CONTROL_SHA" \
      --label school.control-script-sha="$EXPECTED_PROXY_SHA256" \
      -e AUDIT_PROXY_SOCKET=/transport/audit.sock \
      --mount type=bind,source="$proxy_script",target=/control/proxy.mjs,readonly \
      --mount type=bind,source="$transport_side_dir",target=/transport \
      --entrypoint node "$AUDIT_IMAGE_ID" /control/proxy.mjs
    )"

    [[ "$proxy_created_id" =~ ^[a-f0-9]{64}$ ]]
    test -f "$proxy_cid_file"
    test ! -L "$proxy_cid_file"
    test "$(stat -c '%u:%g:%a' "$proxy_cid_file")" = "$host_uid:$host_gid:600"
    test "$(cat "$proxy_cid_file")" = "$proxy_created_id"
    write_container_ids
    assert_owned_container "$proxy_created_id" proxy
    proxy_id="$proxy_created_id"
    [[ "$proxy_id" =~ ^[a-f0-9]{64}$ ]]
    test "$proxy_id" = "$proxy_created_id"
    test "$(docker_control inspect "$proxy_id" --format '{{.State.Status}}')" = created
    test "$(docker_control inspect "$proxy_id" --format '{{.State.Running}}')" = false
    test "$(docker_control inspect "$proxy_id" --format '{{.HostConfig.NetworkMode}}')" = "container:$audit_id"
    test "$(docker_control inspect "$proxy_id" --format '{{.Config.User}}')" = \
      "$AUDIT_RUNTIME_UID:$AUDIT_RUNTIME_GID"
    test "$(docker_control inspect "$proxy_id" --format '{{.HostConfig.ReadonlyRootfs}}')" = true
    test "$(docker_control inspect "$proxy_id" --format '{{.HostConfig.Privileged}}')" = false
    test "$(docker_control inspect "$proxy_id" --format '{{.HostConfig.Memory}}')" = 134217728
    test "$(docker_control inspect "$proxy_id" --format '{{.HostConfig.MemorySwap}}')" = 134217728
    test "$(docker_control inspect "$proxy_id" --format '{{.HostConfig.NanoCpus}}')" = 500000000
    test "$(docker_control inspect "$proxy_id" --format '{{.HostConfig.PidsLimit}}')" = 64
    test "$(docker_control inspect "$proxy_id" --format '{{len .HostConfig.PortBindings}}')" = 0
    docker_control inspect "$proxy_id" | \
      EXPECTED_PROXY_SCRIPT="$proxy_script" EXPECTED_PROXY_DIR="$transport_side_dir" \
      EXPECTED_APP_ID="$audit_id" \
      python3 -c '
import json, os, sys
d = json.load(sys.stdin)[0]
h = d["HostConfig"]
c = d["Config"]
uid = os.environ["AUDIT_RUNTIME_UID"]
gid = os.environ["AUDIT_RUNTIME_GID"]
if d["State"]["Status"] != "created" or d["State"]["Running"]:
    raise RuntimeError("Audit proxy started before exact inspection")
if c["User"] != uid + ":" + gid:
    raise RuntimeError("Wrong audit proxy runtime identity")
if c["Entrypoint"] != ["node"] or c["Cmd"] != ["/control/proxy.mjs"]:
    raise RuntimeError("Wrong audit proxy command")
if h["NetworkMode"] != "container:" + os.environ["EXPECTED_APP_ID"] or h["AutoRemove"] or h["Privileged"] or not h["ReadonlyRootfs"]:
    raise RuntimeError("Wrong audit proxy isolation mode")
if h["RestartPolicy"] != {"Name": "no", "MaximumRetryCount": 0}:
    raise RuntimeError("Wrong audit proxy restart policy")
if h["Memory"] != 134217728 or h["MemorySwap"] != 134217728 or h["NanoCpus"] != 500000000 or h["PidsLimit"] != 64:
    raise RuntimeError("Wrong audit proxy resource limits")
if h.get("Ulimits") != [{"Name": "nofile", "Hard": 1024, "Soft": 1024}]:
    raise RuntimeError("Wrong audit proxy file-descriptor limit")
if h.get("PortBindings") not in ({}, None) or h["PublishAllPorts"]:
    raise RuntimeError("Unexpected audit proxy port exposure")
mounts = sorted(
    (m["Destination"], m["Source"], m["RW"], m["Type"])
    for m in d["Mounts"] if m["Type"] == "bind"
)
expected = sorted([
    ("/control/proxy.mjs", os.environ["EXPECTED_PROXY_SCRIPT"], False, "bind"),
    ("/transport", os.environ["EXPECTED_PROXY_DIR"], True, "bind"),
])
if mounts != expected or any(m["Type"] not in {"bind", "tmpfs"} for m in d["Mounts"]):
    raise RuntimeError("Wrong audit proxy mounts")
tmpfs = {k: set(v.split(",")) for k, v in h["Tmpfs"].items()}
if tmpfs != {"/tmp": {"rw", "noexec", "nosuid", "nodev", "size=33554432", "mode=1770", "uid=" + uid, "gid=" + gid}}:
    raise RuntimeError("Wrong audit proxy tmpfs")
if h["CapDrop"] != ["ALL"] or h["CapAdd"] not in (None, []) or h["SecurityOpt"] != ["no-new-privileges:true"]:
    raise RuntimeError("Wrong audit proxy security options")
if h["LogConfig"] != {"Type": "local", "Config": {"max-file": "1", "max-size": "10m"}}:
    raise RuntimeError("Wrong audit proxy log cap")
' 
    docker_control start "$proxy_id" >/dev/null
    assert_owned_container "$proxy_id" proxy
    test "$(docker_control inspect "$proxy_id" --format '{{.State.Running}}')" = true
    app_pid="$(docker_control inspect "$audit_id" --format '{{.State.Pid}}')"
    proxy_pid="$(docker_control inspect "$proxy_id" --format '{{.State.Pid}}')"
    [[ "$app_pid" =~ ^[1-9][0-9]*$ ]]
    [[ "$proxy_pid" =~ ^[1-9][0-9]*$ ]]
    test "$(readlink "/proc/$app_pid/ns/net")" = "$(readlink "/proc/$proxy_pid/ns/net")"

    audit_healthy=0
    for attempt in $(seq 1 90); do
      if [ -S "$proxy_socket" ] && SOCKET_PATH="$proxy_socket" python3 - <<'VERIFY_HEALTH'
import os
import socket

client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
client.settimeout(3)
client.connect(os.environ['SOCKET_PATH'])
client.sendall(b'GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
chunks = []
while True:
    part = client.recv(65536)
    if not part:
        break
    chunks.append(part)
    if sum(map(len, chunks)) > 1048576:
        raise RuntimeError('Audit health response too large')
response = b''.join(chunks)
head, body = response.split(b'\r\n\r\n', 1)
if not head.startswith(b'HTTP/1.1 200 '):
    raise RuntimeError('Audit health status is not 200')
if b'"status":"ok"' not in body:
    raise RuntimeError('Audit health payload is not ok')
VERIFY_HEALTH
      then
        audit_healthy=1
        break
      fi
      probe_exact_container "$audit"
      test "$PROBED_RESOURCE_PRESENT" = yes
      if [ "$(docker_control inspect "$audit_id" --format '{{.State.Running}}')" != true ]; then
        break
      fi
      probe_exact_container "$audit_proxy"
      test "$PROBED_RESOURCE_PRESENT" = yes
      if [ "$(docker_control inspect "$proxy_id" --format '{{.State.Running}}')" != true ]; then
        break
      fi
      sleep 2
    done
    if [ "$audit_healthy" -ne 1 ]; then
      docker_control logs "$audit_id" --tail 120 >&2 || :
      docker_control logs "$proxy_id" --tail 120 >&2 || :
      exit 1
    fi
    test -S "$proxy_socket"
    test ! -L "$proxy_socket"
    test "$(stat -c '%u:%a' "$proxy_socket")" = \
      "$AUDIT_RUNTIME_UID:600"

    docker_control exec -i "$audit_id" node --input-type=module - <<'VERIFY_EGRESS'
import { networkInterfaces } from 'node:os';
const interfaces = networkInterfaces();
const names = Object.keys(interfaces).sort();
if (names.length !== 1 || names[0] !== 'lo') {
  throw new Error('Audit network namespace is not loopback-only');
}
for (const address of interfaces.lo || []) {
  if (!address.internal || !new Set(['127.0.0.1', '::1']).has(address.address)) {
    throw new Error('Audit network namespace contains a non-loopback address');
  }
}
console.log('SCHOOL_AUTHORIZED_VISUAL_EGRESS=none-network');
VERIFY_EGRESS
    seed_output="$(docker_control logs "$audit_id" 2>&1)"
    test "$(printf '%s\n' "$seed_output" | sed -n 's/^SCHOOL_AUTHORIZED_VISUAL_SOURCE=//p' | tail -n1)" = "$AUDIT_SOURCE"
    test "$(printf '%s\n' "$seed_output" | sed -n 's/^SCHOOL_AUTHORIZED_VISUAL_DATA=//p' | tail -n1)" = SYNTHETIC
    test "$(printf '%s\n' "$seed_output" | sed -n 's/^SCHOOL_AUTHORIZED_VISUAL_ROLES=//p' | tail -n1)" = SEEDED
    printf 'SCHOOL_AUTHORIZED_VISUAL_SOURCE=%s\n' "$AUDIT_SOURCE"
    printf 'SCHOOL_AUTHORIZED_VISUAL_DATA=SYNTHETIC\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_ROLES=SEEDED\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_NETWORK_MODE=none\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_DATA_STORAGE=tmpfs-capped-256m\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_TRANSPORT=unix-socket\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_BINDING=unix-socket-only\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_APP_CONTAINER_ID=%s\n' "$audit_id"
    printf 'SCHOOL_AUTHORIZED_VISUAL_PROXY_CONTAINER_ID=%s\n' \
      "$proxy_id"
    printf 'SCHOOL_AUTHORIZED_VISUAL_CANDIDATE_IMAGE_ID=%s\n' "$CANDIDATE_IMAGE_ID"
    printf 'SCHOOL_AUTHORIZED_VISUAL_AUDIT_SHA=%s\n' "$AUDIT_SHA"
    printf 'SCHOOL_AUTHORIZED_VISUAL_AUDIT_IMAGE_ID=%s\n' "$AUDIT_IMAGE_ID"
    printf 'SCHOOL_AUTHORIZED_VISUAL_DESIGN_FLAG=%s\n' "$AUDIT_EXPECTED_DESIGN_FLAG"
    printf 'SCHOOL_AUTHORIZED_VISUAL_SEED_DATE=%s\n' "${AUDIT_SEED_DATE:-runtime-current-date}"
    printf 'SCHOOL_AUTHORIZED_VISUAL_IMAGE_PIN=IMMUTABLE\n'
    printf 'SCHOOL_AUTHORIZED_VISUAL_FIXTURE=READY\n'
    prepare_finished=1
    ;;

  cleanup)
    remove_resources
    probe_exact_container "$audit"
    test "$PROBED_RESOURCE_PRESENT" = no
    probe_exact_container "$audit_proxy"
    test "$PROBED_RESOURCE_PRESENT" = no
    test ! -e "$work"
    test ! -L "$work"
    test ! -e "$work_pending"
    test ! -L "$work_pending"
    test ! -e "$work_tombstone"
    test ! -L "$work_tombstone"
    test ! -e "$work_pending_tombstone"
    test ! -L "$work_pending_tombstone"
    test ! -e "$proxy_socket"
    test ! -L "$proxy_socket"
    printf 'SCHOOL_AUTHORIZED_VISUAL_CLEANUP=OK\n'
    ;;

  *)
    printf 'ACTION must be prepare or cleanup\n' >&2
    exit 1
    ;;
esac
