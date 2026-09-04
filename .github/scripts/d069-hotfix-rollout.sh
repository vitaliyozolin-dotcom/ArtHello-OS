#!/usr/bin/env bash
set -Eeuo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${DATA_VOLUME:?DATA_VOLUME is required}"
: "${D069_IMAGE_ID:?D069_IMAGE_ID is required}"
: "${PUBLIC_URL:?PUBLIC_URL is required}"

work="$RUNNER_TEMP/arthello-d069-hotfix-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
backup_snapshot="$work/backup"
rollback_volume="arthello-d069-hotfix-rollback-$GITHUB_RUN_ID"
rollback_container=""
candidate_id=""
candidate_name=""
live_id=""
live_name=""
network_name=""
old_image_id=""
old_restart_name=""
old_restart_max=0
live_paused=0
old_stopped=0
old_renamed=0
candidate_may_mutate=0
restore_data_on_failure=1
backup_verified=0
data_fingerprint=""

mkdir -p "$backup_snapshot"
chmod 0700 "$work" "$backup_snapshot"

fingerprint_database() {
  local database_path="$1"
  D069_FINGERPRINT_DB="$database_path" python3 - <<'PY'
import hashlib
import json
import os
import re
import sqlite3
import struct
from urllib.parse import quote

database_path = os.environ["D069_FINGERPRINT_DB"]
connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
digest = hashlib.sha256()

def add(value):
    if value is None:
        payload = b"N"
    elif isinstance(value, bytes):
        payload = b"B" + value
    elif isinstance(value, float):
        payload = b"F" + repr(value).encode("ascii")
    elif isinstance(value, int):
        payload = b"I" + str(value).encode("ascii")
    else:
        payload = b"T" + str(value).encode("utf-8")
    digest.update(struct.pack(">Q", len(payload)))
    digest.update(payload)

def table_info(table):
    return list(connection.execute(f'PRAGMA table_info("{table}")'))

def hash_rows(table, where="", parameters=()):
    info = table_info(table)
    if not info:
        raise SystemExit(f"required table missing: {table}")
    columns = [row[1] for row in info]
    column_index = {column: index for index, column in enumerate(columns)}
    primary_key = [row[1] for row in sorted(info, key=lambda row: row[5]) if row[5]]
    order_by = ",".join(f'"{column}"' for column in primary_key) if primary_key else "rowid"
    query = f'SELECT * FROM "{table}"'
    if where:
        query += f" WHERE {where}"
    query += f" ORDER BY {order_by}"
    add(table)
    for schema_value in connection.execute(
        "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
        "WHERE tbl_name=? ORDER BY type,name",
        (table,),
    ):
        for value in schema_value:
            add(value)
    for info_row in info:
        for value in info_row:
            add(value)
    count = 0
    for row in connection.execute(query, parameters):
        count += 1
        normalized_row = list(row)
        if (
            table == "entities"
            and normalized_row[column_index["id"]] == "SUP-T-001"
            and str(normalized_row[column_index["created_by"]]).startswith("system-")
        ):
            normalized_row[column_index["updated_at"]] = "<normalized:startup-maintenance>"
        if (
            table == "integration_connections"
            and normalized_row[column_index["id"]] in {
                "INT-T-D1", "INT-T-ALFACRM", "INT-T-FORMS", "INT-T-PHONE",
                "INT-T-WHATSAPP", "INT-T-TG", "INT-T-VK", "INT-T-YANDEX",
                "INT-T-MAIL", "INT-T-ADS", "INT-T-SOCIAL", "INT-T-TOCHKA",
                "INT-T-TBANK", "INT-T-DIARY", "INT-T-EDO", "INT-T-1C",
                "INT-T-ACS", "INT-T-CAM", "INT-T-OPENAI-IMAGES",
            }
        ):
            normalized_row[column_index["updated_at"]] = "<normalized:catalog-maintenance>"
        for value in normalized_row:
            add(value)
    add(count)
    return count

try:
    connection.execute("PRAGMA query_only=ON")
    if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("database integrity failed")
    if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise SystemExit("foreign key violations found")

    required_columns = {
        "cashflow_article",
        "pnl_article",
        "accrual_period",
        "counterparty_label",
        "management_purpose",
    }
    operation_columns = {row[1] for row in table_info("financial_operations")}
    missing_columns = required_columns - operation_columns
    if missing_columns:
        raise SystemExit("D-069 columns missing: " + ",".join(sorted(missing_columns)))

    owner_credential = connection.execute(
        "SELECT COUNT(*) FROM production_auth_credentials "
        "WHERE user_id='AUTH-OWNER' AND length(password_hash)>0 AND length(password_salt)>0"
    ).fetchone()[0]
    if owner_credential != 1:
        raise SystemExit("owner credential missing")
    owner_access = connection.execute(
        "SELECT COUNT(*) FROM app_users u "
        "JOIN user_system_access g ON g.user_id=u.id AND g.system_id='SYS-ARTHELLO-OS' "
        "WHERE u.id='USR-OWNER' AND u.status='Активен' AND u.role='Собственник' "
        "AND u.is_administrative=1 AND g.status='Активен' AND g.role='Собственник' "
        "AND u.access_version=g.access_version"
    ).fetchone()[0]
    if owner_access != 1:
        raise SystemExit("canonical owner access missing")

    setup_row = connection.execute(
        "SELECT state_value FROM system_runtime_state WHERE state_key='integration_setup:INT-T-TOCHKA'"
    ).fetchone()
    if not setup_row:
        raise SystemExit("Tochka setup missing")
    try:
        setup = json.loads(setup_row[0])
    except Exception as error:
        raise SystemExit("Tochka setup is invalid") from error
    if setup.get("secretStatus") != "stored" or not setup.get("customerCode"):
        raise SystemExit("stored Tochka credential binding missing")
    credential_scopes = ["INT-T-TOCHKA", setup.get("legalEntityId"), setup.get("customerCode")]
    if any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{1,79}", value) for value in credential_scopes):
        raise SystemExit("active Tochka credential scope is invalid")
    encode_component = lambda value: quote(value, safe="-_.!~*'()")
    active_credential_key = "integration_credential:v2:" + ":".join(
        encode_component(value) for value in credential_scopes
    )
    active_credential_row = connection.execute(
        "SELECT state_value FROM system_runtime_state WHERE state_key=?",
        (active_credential_key,),
    ).fetchone()
    if not active_credential_row:
        raise SystemExit("active Tochka credential envelope missing")
    try:
        active_envelope = json.loads(active_credential_row[0])
    except Exception as error:
        raise SystemExit("active Tochka credential envelope is invalid") from error
    if (
        active_envelope.get("version") != 1
        or active_envelope.get("algorithm") != "AES-GCM"
        or not active_envelope.get("iv")
        or not active_envelope.get("ciphertext")
    ):
        raise SystemExit("active Tochka credential envelope is incomplete")

    pending_cashflow_backfill = connection.execute(
        "SELECT COUNT(*) FROM financial_operations "
        "WHERE cashflow_article='' AND category<>'' AND category<>'Не классифицировано'"
    ).fetchone()[0]
    if pending_cashflow_backfill:
        raise SystemExit("financial operation cashflow backfill is not settled")

    protected_tables = {
        "production_auth_credentials",
        "app_users",
        "user_system_access",
        "entities",
        "integration_connections",
        "bank_accounts",
        "bank_statement_imports",
        "bank_transactions",
        "financial_operations",
        "finance_accruals",
        "finance_budgets",
        "finance_forecast_items",
        "finance_payroll_summary",
        "finance_corrections",
        "finance_reconciliation_issues",
        "client_accruals",
        "client_bonuses",
        "client_lifecycles",
        "accounting_documents",
        "accounting_document_links",
        "accounting_completeness_checks",
        "accounting_exports",
        "accounting_integrations",
    }
    existing_tables = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    missing_tables = protected_tables - existing_tables
    if missing_tables:
        raise SystemExit("required data tables missing: " + ",".join(sorted(missing_tables)))
    for table in sorted(protected_tables):
        hash_rows(table)
    credential_rows = hash_rows(
        "system_runtime_state",
        "state_key='integration_setup:INT-T-TOCHKA' "
        "OR state_key LIKE 'integration_credential:v2:INT-T-TOCHKA:%'",
    )
    if credential_rows < 2:
        raise SystemExit("Tochka setup or encrypted credential envelope missing")
    print(digest.hexdigest())
finally:
    connection.close()
PY
}

snapshot_volume() {
  local image_id="$1"
  local volume_name="$2"
  local target="$3"
  mkdir -p "$target"
  chmod 0700 "$target"
  docker run --rm --network none --user 0:0 \
    --mount "type=volume,src=$volume_name,dst=/from,readonly" \
    --entrypoint /bin/sh "$image_id" -ceu 'cd /from && tar -cpf - .' \
    | tar -xpf - -C "$target"
  python3 deploy/v52/maintenance/production-data-inventory.py "$target" >/dev/null
}

restore_restart_policy() {
  local container="$1"
  if [ "$old_restart_name" = on-failure ]; then
    docker update --restart="on-failure:$old_restart_max" "$container" >/dev/null
  else
    docker update --restart="$old_restart_name" "$container" >/dev/null
  fi
}

internal_ready() {
  local container="$1"
  local status
  for _ in $(seq 1 60); do
    status="$(docker exec "$container" node -e "fetch('http://127.0.0.1:8081/api/health',{redirect:'error'}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write('000'))" 2>/dev/null || true)"
    if [ "$status" = 200 ]; then return 0; fi
    sleep 2
  done
  return 1
}

public_ready() {
  local root_status auth_status
  for _ in $(seq 1 30); do
    root_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "$PUBLIC_URL/" || true)"
    auth_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "$PUBLIC_URL/api/auth/me" || true)"
    if [ "$root_status" = 200 ] && [ "$auth_status" = 401 ]; then return 0; fi
    sleep 2
  done
  return 1
}

cleanup_on_failure() {
  local original_status="${1:-1}"
  if [ "$original_status" -eq 0 ]; then return 0; fi
  trap - EXIT
  # Once rollback starts, defer repeated catchable cancellation signals so the
  # verified restore cannot be interrupted between clearing and repopulating /data.
  trap '' INT TERM HUP
  set +e
  local rollback_failed=0
  local candidate_quiesced=1
  local data_safe_to_start=1
  printf '::error::D-069 hotfix rollout failed; restoring previous production\n'

  if [ -n "$live_id" ] && docker inspect "$live_id" >/dev/null 2>&1 \
    && [ "$(docker inspect "$live_id" --format '{{.State.Paused}}' 2>/dev/null)" = true ]; then
    docker unpause "$live_id" >/dev/null 2>&1 || rollback_failed=1
    live_paused=0
  fi

  if [ -n "$rollback_container" ] && docker inspect "$rollback_container" >/dev/null 2>&1; then
    old_renamed=1
  fi

  if [ -n "$candidate_id" ] && docker inspect "$candidate_id" >/dev/null 2>&1; then
    if ! docker rm -f "$candidate_id" >/dev/null 2>&1; then
      candidate_quiesced=0
      rollback_failed=1
    fi
  elif [ -n "$candidate_name" ] && docker inspect "$candidate_name" >/dev/null 2>&1; then
    if ! docker rm -f "$candidate_name" >/dev/null 2>&1; then
      candidate_quiesced=0
      rollback_failed=1
    fi
  fi

  if [ "$candidate_may_mutate" -eq 1 ] && [ "$restore_data_on_failure" -eq 1 ]; then
    data_safe_to_start=0
    if [ "$backup_verified" -ne 1 ] || [ "$candidate_quiesced" -ne 1 ]; then
      rollback_failed=1
    else
      for restore_attempt in 1 2; do
        if docker run --rm --network none --user 0:0 \
          --mount "type=volume,src=$DATA_VOLUME,dst=/to" \
          --mount "type=volume,src=$rollback_volume,dst=/from,readonly" \
          --entrypoint /bin/sh "$old_image_id" -ceu '
            find /to -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
            cd /from
            tar -cpf - . | tar -xpf - -C /to
          ' >/dev/null 2>&1; then
          restored_snapshot="$work/restored-$restore_attempt"
          if snapshot_volume "$old_image_id" "$DATA_VOLUME" "$restored_snapshot"; then
            relative_restored_db="$(python3 deploy/v52/maintenance/production-data-inventory.py --print-active-database-relative-path)"
            restored_fingerprint="$(fingerprint_database "$restored_snapshot/$relative_restored_db")"
            if [ -n "$data_fingerprint" ] && [ "$restored_fingerprint" = "$data_fingerprint" ]; then
              data_safe_to_start=1
              break
            fi
          fi
        fi
        printf '::warning::verified restore attempt %s failed\n' "$restore_attempt"
      done
      if [ "$data_safe_to_start" -ne 1 ]; then
        printf '::error::restored database fingerprint does not match verified backup\n'
        rollback_failed=1
      fi
    fi
  fi

  if [ "$data_safe_to_start" -eq 1 ]; then
    if [ "$old_renamed" -eq 1 ] && docker inspect "$rollback_container" >/dev/null 2>&1; then
      docker rename "$rollback_container" "$live_name" >/dev/null 2>&1 || rollback_failed=1
    fi
    if [ -n "$live_name" ] && docker inspect "$live_name" >/dev/null 2>&1; then
      restored_image_id="$(docker inspect "$live_name" --format '{{.Image}}' 2>/dev/null)"
      if [ "$restored_image_id" != "$old_image_id" ]; then
        rollback_failed=1
      else
        if [ -n "$network_name" ] \
          && ! docker inspect "$live_name" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' 2>/dev/null \
            | grep -Fxq "$network_name"; then
          docker network connect "$network_name" "$live_name" >/dev/null 2>&1 || rollback_failed=1
        fi
        if [ "$(docker inspect "$live_name" --format '{{.State.Running}}' 2>/dev/null)" != true ]; then
          docker start "$live_name" >/dev/null 2>&1 || rollback_failed=1
        fi
        restore_restart_policy "$live_name" || rollback_failed=1
      fi
    fi

    if [ -n "$live_name" ] && docker inspect "$live_name" >/dev/null 2>&1; then
      internal_ready "$live_name" || rollback_failed=1
      public_ready || rollback_failed=1
    else
      rollback_failed=1
    fi
  else
    rollback_failed=1
  fi

  if [ "$rollback_failed" -eq 0 ]; then
    printf 'D069_HOTFIX_ROLLBACK=VERIFIED\n'
  else
    printf '::error::automatic rollback could not be fully verified\n'
  fi
  rm -rf -- "$work"
  if [ "$rollback_failed" -ne 0 ]; then exit 97; fi
  exit "$original_status"
}

handle_signal() {
  exit "$1"
}

trap 'cleanup_on_failure $?' EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM
trap 'handle_signal 129' HUP

mapfile -t live_ids < <(docker ps -q --filter "volume=$DATA_VOLUME")
test "${#live_ids[@]}" -eq 1
live_id="${live_ids[0]}"
live_name="$(docker inspect "$live_id" --format '{{.Name}}' | sed 's#^/##')"
old_image_id="$(docker inspect "$live_id" --format '{{.Image}}')"
old_restart_name="$(docker inspect "$live_id" --format '{{.HostConfig.RestartPolicy.Name}}')"
old_restart_max="$(docker inspect "$live_id" --format '{{.HostConfig.RestartPolicy.MaximumRetryCount}}')"
test -n "$live_name"
[[ "$old_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$DATA_VOLUME"

docker inspect "$live_id" > "$work/live.json"
python3 - "$work/live.json" "$work/live.env" "$work/run.args" "$work/network.name" <<'PY'
import json
import os
import sys

inspect_path, env_path, args_path, network_path = sys.argv[1:]
data = json.load(open(inspect_path, encoding="utf-8"))[0]
environment = data.get("Config", {}).get("Env") or []
with open(env_path, "w", encoding="utf-8", newline="\n") as output:
    for item in environment:
        if not isinstance(item, str) or "\n" in item or "\r" in item:
            raise SystemExit("unsafe environment entry")
        output.write(item + "\n")
os.chmod(env_path, 0o600)

arguments = []
for mount in data.get("Mounts") or []:
    mount_type = mount.get("Type")
    destination = mount.get("Destination")
    if mount_type not in {"volume", "bind"} or not isinstance(destination, str) or not destination or "," in destination or "\n" in destination:
        raise SystemExit("unsupported mount")
    source = mount.get("Name") if mount_type == "volume" else mount.get("Source")
    if not isinstance(source, str) or not source or "," in source or "\n" in source:
        raise SystemExit("unsafe mount source")
    specification = f"type={mount_type},src={source},dst={destination}"
    if not mount.get("RW", False):
        specification += ",readonly"
    arguments += ["--mount", specification]

host = data.get("HostConfig") or {}
if host.get("ReadonlyRootfs"):
    arguments.append("--read-only")
for destination, options in (host.get("Tmpfs") or {}).items():
    arguments += ["--tmpfs", f"{destination}:{options}" if options else destination]
user = data.get("Config", {}).get("User") or ""
if user:
    arguments += ["--user", user]
workdir = data.get("Config", {}).get("WorkingDir") or ""
if workdir:
    arguments += ["--workdir", workdir]
networks = list((data.get("NetworkSettings", {}).get("Networks") or {}).keys())
if len(networks) != 1 or not networks[0] or "\n" in networks[0]:
    raise SystemExit("expected one Docker network")
arguments += ["--network", networks[0]]
with open(network_path, "w", encoding="utf-8", newline="\n") as output:
    output.write(networks[0] + "\n")
os.chmod(network_path, 0o600)
with open(args_path, "wb") as output:
    for argument in arguments:
        output.write(argument.encode("utf-8") + b"\0")
PY
chmod 0600 "$work/live.json" "$work/run.args" "$work/network.name"
test -s "$work/live.env"
test -s "$work/run.args"
test -s "$work/network.name"
mapfile -d '' -t run_args < "$work/run.args"
IFS= read -r network_name < "$work/network.name"
test -n "$network_name"

docker volume create \
  --label arthello.scope=production-rollback \
  --label "arthello.release.sha=$GITHUB_SHA" \
  --label "arthello.rollback.source=$live_name" \
  "$rollback_volume" >/dev/null

docker update --restart=no "$live_id" >/dev/null
docker network disconnect "$network_name" "$live_id"
# Drain any mutation that was already in flight before the network write fence.
# The longest application-side bank request is capped at 45 seconds.
sleep 55
docker pause "$live_id" >/dev/null
live_paused=1
backup_ok=0
if docker run --rm --network none --user 0:0 \
  --mount "type=volume,src=$DATA_VOLUME,dst=/from,readonly" \
  --mount "type=volume,src=$rollback_volume,dst=/to" \
  --entrypoint /bin/sh "$old_image_id" -ceu 'cd /from && tar -cpf - . | tar -xpf - -C /to'; then
  backup_ok=1
fi
test "$backup_ok" -eq 1

snapshot_volume "$old_image_id" "$rollback_volume" "$backup_snapshot"
relative_db="$(python3 deploy/v52/maintenance/production-data-inventory.py --print-active-database-relative-path)"
data_fingerprint="$(fingerprint_database "$backup_snapshot/$relative_db")"
[[ "$data_fingerprint" =~ ^[a-f0-9]{64}$ ]]
backup_verified=1
printf 'D069_HOTFIX_BACKUP=VERIFIED volume=%s\n' "$rollback_volume"

rollback_container="${live_name}-rollback-d069-hotfix-${GITHUB_RUN_ID}"
docker rename "$live_id" "$rollback_container"
old_renamed=1
docker unpause "$live_id" >/dev/null
live_paused=0
docker stop --time 30 "$live_id" >/dev/null
old_stopped=1

candidate_may_mutate=1
candidate_name="${live_name}-candidate-d069-hotfix-${GITHUB_RUN_ID}"
candidate_id="$(docker run -d \
  --name "$candidate_name" \
  --restart=no \
  --env-file "$work/live.env" \
  "${run_args[@]}" \
  --label "arthello.release.sha=$GITHUB_SHA" \
  --label "arthello.release.kind=d069-allocation-hotfix" \
  "$D069_IMAGE_ID")"
test -n "$candidate_id"
test "$(docker inspect "$candidate_name" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$DATA_VOLUME"
internal_ready "$candidate_name"

post_snapshot="$work/post"
docker pause "$candidate_name" >/dev/null
post_copy_ok=0
if snapshot_volume "$D069_IMAGE_ID" "$DATA_VOLUME" "$post_snapshot"; then
  post_copy_ok=1
fi
docker unpause "$candidate_name" >/dev/null
test "$post_copy_ok" -eq 1
relative_post_db="$(python3 deploy/v52/maintenance/production-data-inventory.py --print-active-database-relative-path)"
post_fingerprint="$(fingerprint_database "$post_snapshot/$relative_post_db")"
test "$post_fingerprint" = "$data_fingerprint"
printf 'D069_HOTFIX_SCHEMA_DATA_CREDENTIAL=VERIFIED\n'

restore_data_on_failure=0
restore_restart_policy "$candidate_name"
test "$(docker inspect "$candidate_name" --format '{{.State.Running}}')" = true
test "$(docker inspect "$candidate_name" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$GITHUB_SHA"
internal_ready "$candidate_name"
docker rename "$candidate_name" "$live_name"
candidate_name="$live_name"
test "$(docker inspect "$live_name" --format '{{.State.Running}}')" = true
test "$(docker inspect "$live_name" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$GITHUB_SHA"
internal_ready "$live_name"
public_ready
test "$(docker inspect "$rollback_container" --format '{{.State.Running}}')" = false
test "$(docker volume inspect "$rollback_volume" --format '{{.Name}}')" = "$rollback_volume"

printf 'D069_HOTFIX_PRODUCTION=VERIFIED sha=%s\n' "$GITHUB_SHA"
printf 'live_name=%s\nrollback_container=%s\nrollback_volume=%s\ndata_fingerprint=%s\n' \
  "$live_name" "$rollback_container" "$rollback_volume" "$data_fingerprint" >> "$GITHUB_OUTPUT"
trap - EXIT INT TERM HUP
rm -rf -- "$work"
