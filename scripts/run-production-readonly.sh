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
  if [[ "$EXPECTED_LIVE_SOURCE_SHA" == 4a0713b4a7d87f132e49836fe0ce9ca9258bc1ec ]]; then
    timeout 60 python3 -I scripts/production-data-consumers-r14.py \
      --expected-release "$EXPECTED_LIVE_SOURCE_SHA" \
      --release-state-dir "$HOME/.config/arthello/release-state"
  elif [[ "$EXPECTED_LIVE_SOURCE_SHA" == f5fa3e46e3510e6fc98ae4455f4b499c0ba30695 ]]; then
    timeout 60 python3 -I scripts/production-data-consumers-r13.py \
      --expected-release "$EXPECTED_LIVE_SOURCE_SHA" \
      --release-state-dir "$HOME/.config/arthello/release-state"
  else
    timeout 60 python3 -I scripts/production-data-consumers.py \
      --expected-release "$EXPECTED_LIVE_SOURCE_SHA" \
      --release-state-dir "$HOME/.config/arthello/release-state"
  fi
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
# One bounded non-root process; it only waits for an ordinary open when no D1
# handle exists. Unexpected handles or any other identity failure still stop it.
set +e
timeout 90 docker exec -i -e EXPECTED_FILE="/data/$relative" "$live" \
  node --input-type=module - --live-d1-scan < scripts/live-d1-identity.mjs 2>/dev/null
scan_status=$?
set -e
if [[ "$scan_status" -eq 124 ]]; then echo 'READONLY_BLOCKED=identity_scan_timeout'; exit 2; fi
if [[ "$scan_status" -ne 0 ]]; then echo 'READONLY_BLOCKED=live_file_identity'; exit 2; fi
printf 'READONLY_LIVE_SOURCE=%s\nREADONLY_IMAGE=%s\n' "$source" "$image"
echo 'READONLY_BACKUP=exact_readonly_consumer_history_not_verified'
# Validate a bounded single report before anything from the probe reaches logs.
# The final trailer is written by this shell, separately from the Docker stdout.
validate_report() {
  python3 -I -c '
import datetime, json, re, sys
LIMIT = 32768
def require(value):
    if not value:
        raise ValueError()
def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result
def fields(value, names):
    require(type(value) is dict and set(value) == set(names.split()))
def count(value):
    require(type(value) is int and 0 <= value <= 9007199254740991)
def counts(value, names):
    fields(value, names)
    for item in value.values():
        count(item)
def nullable_count(value):
    if value is not None:
        count(value)
def timestamp(value):
    require(type(value) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", value))
    datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
def nullable_timestamp(value):
    if value is not None:
        timestamp(value)
def choice(value, choices):
    require(value is None or value in choices.split())
def runtime(value, stamp):
    fields(value, "state observedAtUtc setup connection autosync statementLease retainedJobs statementImports latestRun")
    require(value["state"] in ("observed", "partial", "invalid_window"))
    require(value["observedAtUtc"] == stamp or value["observedAtUtc"] is None and value["state"] == "invalid_window")
    for name in ("setup", "connection", "autosync", "statementLease", "retainedJobs", "statementImports", "latestRun"):
        component = value[name]
        require(type(component) is dict and component.get("state") in
                ("observed", "not_observed", "invalid", "schema_missing", "unavailable", "over_limit"))
    setup = value["setup"]
    fields(setup, "state startDate syncIntervalMinutes syncMinute")
    if setup["startDate"] is not None:
        require(type(setup["startDate"]) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", setup["startDate"]))
        datetime.date.fromisoformat(setup["startDate"])
    nullable_count(setup["syncIntervalMinutes"])
    nullable_count(setup["syncMinute"])
    connection = value["connection"]
    fields(connection, "state status enabled nextSyncAtUtc")
    choice(connection["status"], "running forming_statements connection_error paused awaiting_sync review_required unknown not_observed")
    require(connection["enabled"] is None or type(connection["enabled"]) is bool)
    nullable_timestamp(connection["nextSyncAtUtc"])
    autosync = value["autosync"]
    fields(autosync, "state outcome generationMatchesSetup nextAtUtc leasedUntilUtc leaseState failures updatedAgeSeconds httpStatus httpStatusState updatedAtUtc failureStage failureStageState commitFailureKind commitFailureKindState")
    choice(autosync["outcome"], "running complete pending busy error unknown not_observed")
    require(autosync["generationMatchesSetup"] is None or type(autosync["generationMatchesSetup"]) is bool)
    nullable_timestamp(autosync["nextAtUtc"])
    nullable_timestamp(autosync["leasedUntilUtc"])
    choice(autosync["leaseState"], "active expired released unknown")
    nullable_count(autosync["failures"])
    nullable_count(autosync["updatedAgeSeconds"])
    require(autosync["httpStatusState"] in ("observed", "missing", "invalid"))
    if autosync["httpStatusState"] == "observed":
        require(type(autosync["httpStatus"]) is int and 100 <= autosync["httpStatus"] <= 599)
    else:
        require(autosync["httpStatus"] is None)
    nullable_timestamp(autosync["updatedAtUtc"])
    require(autosync["failureStageState"] in ("observed", "missing", "invalid"))
    if autosync["failureStageState"] == "observed":
        require(autosync["outcome"] == "error" and type(autosync["failureStage"]) is str
                and autosync["failureStage"] in ("setup_references", "credential_read", "statement_state_open", "bank_sync",
                    "statement_fence", "sync_commit", "statement_acknowledge", "statement_release",
                    "sync_callback", "response_decode", "response_result"))
    else:
        require(autosync["failureStage"] is None)
    require(autosync["commitFailureKindState"] in ("observed", "missing", "invalid"))
    if autosync["commitFailureKindState"] == "observed":
        require(autosync["outcome"] == "error" and autosync["failureStageState"] == "observed"
                and autosync["failureStage"] == "sync_commit" and type(autosync["commitFailureKind"]) is str)
        choice(autosync["commitFailureKind"], "provider_identity transaction_identity unique_constraint required_value foreign_key check_constraint schema binding_type query_limit database_busy storage_full database_readonly storage_error other")
    else:
        require(autosync["commitFailureKind"] is None)
    lease = value["statementLease"]
    fields(lease, "state expiresAtUtc leaseState")
    nullable_timestamp(lease["expiresAtUtc"])
    choice(lease["leaseState"], "active expired released unknown")
    jobs = value["retainedJobs"]
    fields(jobs, "state scopeMatch providerStatus total invalidRows exactWindowRows olderEndRows otherWindowRows oldestAgeSeconds")
    require(jobs["scopeMatch"] == "unverified" and jobs["providerStatus"] == "not_stored")
    for key in ("total", "invalidRows", "exactWindowRows", "olderEndRows", "otherWindowRows", "oldestAgeSeconds"):
        nullable_count(jobs[key])
    imports = value["statementImports"]
    fields(imports, "state readyRows pendingRows failedRows unknownRows")
    for key in ("readyRows", "pendingRows", "failedRows", "unknownRows"):
        nullable_count(imports[key])
    latest = value["latestRun"]
    fields(latest, "state startedAtUtc finishedAtUtc")
    nullable_timestamp(latest["startedAtUtc"])
    nullable_timestamp(latest["finishedAtUtc"])
def states(value, observed, others):
    require(type(value) is dict)
    if value.get("state") == "observed":
        fields(value, "state " + observed)
        count(value[observed])
    else:
        fields(value, "state")
        require(value["state"] in others.split())
def commit_schema(value):
    fields(value, "state tables")
    require(value["state"] in ("observed", "partial"))
    expected = {
        "audit_events": "actor action entity_type entity_id payload".split(),
        "bank_accounts": "id connection_id legal_entity_id provider_account_id masked_account name currency status balance_minor balance_as_of synced_at".split(),
        "bank_statement_imports": "id connection_id legal_entity_id provider_statement_id provider_account_id start_date end_date status start_balance_minor end_balance_minor currency transaction_count fetched_at".split(),
        "bank_transactions": "id connection_id legal_entity_id provider_account_id provider_statement_id provider_transaction_id payment_id operation_date direction amount_minor currency status document_number transaction_type description counterparty_name counterparty_inn counterparty_kpp source_payload_hash financial_operation_id imported_at".split(),
        "financial_operations": "id operation_date period direction amount_minor category report_class counterparty_entity_id contract_id document_id project_entity_id legal_entity_id object_entity_id cfr_entity_id bank_operation_ref operation_kind source_system source_file source_sheet source_ref data_quality status created_by".split(),
        "integration_log_entries": "run_id connection_id level event message record_ref".split(),
        "integration_sync_runs": "id connection_id started_at finished_at trigger status received_count accepted_count rejected_count error_count conflict_count checkpoint error_message initiated_by correlation_id dry_run".split(),
    }
    fields(value["tables"], " ".join(expected))
    for name, allowed in expected.items():
        table = value["tables"][name]
        if table.get("state") != "observed":
            fields(table, "state")
            require(table["state"] in ("schema_missing", "unavailable", "over_limit"))
            continue
        fields(table, "state missingColumns primaryKeyMatches providerIndex unexpectedRequiredColumns foreignKeyRows triggerRows uniqueIndexCount")
        missing = table["missingColumns"]
        require(type(missing) is list and all(type(item) is str and item in allowed for item in missing))
        require(len(set(missing)) == len(missing))
        require(type(table["primaryKeyMatches"]) is bool)
        require(table["providerIndex"] in (("matched", "missing") if name.startswith("bank_") else ("not_required",)))
        for key in ("unexpectedRequiredColumns", "foreignKeyRows", "triggerRows", "uniqueIndexCount"):
            count(table[key])
            require(table[key] <= 128)
    observed = all(table["state"] == "observed" for table in value["tables"].values())
    require((value["state"] == "observed") == observed)

def validate(value, code):
    require(type(value) is dict and type(value.get("schemaVersion")) is int
            and value["schemaVersion"] == 1 and value.get("liveAcceptance") == "not_run"
            and value.get("productionMutations") is False)
    status = value.get("status")
    if status == "blocked":
        fields(value, "schemaVersion status reason liveAcceptance productionMutations")
        require(code == 2 and value["reason"] == "readonly_source_unavailable")
        return status
    fields(value, "schemaVersion liveAcceptance tables checks bankWindow bankRuntime status observedAtUtc productionMutations"
           + (" bankCommitSchema" if "bankCommitSchema" in value else ""))
    if "bankCommitSchema" in value:
        commit_schema(value["bankCommitSchema"])
    require((code, status) in ((0, "bounded_checks_complete"), (2, "incomplete_or_issues")))
    stamp = value["observedAtUtc"]
    timestamp(stamp)
    runtime(value["bankRuntime"], stamp)
    fields(value["tables"], "app_users app_systems organization_branches user_system_access user_branch_access bank_accounts bank_statement_imports bank_transactions financial_operations developer_feedback developer_feedback_events integration_connections integration_sync_runs alfacrm_finance_snapshots alfacrm_family_merge_candidates")
    for table in value["tables"].values():
        states(table, "rows", "not_installed over_limit unavailable")
        if table["state"] == "observed":
            require(table["rows"] <= 10000)
    fields(value["checks"], "bankLinks accessUsers accessSystems branchUsers branchTargets feedbackAuthors feedbackEvents importConnections")
    for check in value["checks"].values():
        states(check, "violations", "schema_missing not_checked unavailable")
    bank = value["bankWindow"]
    require(type(bank) is dict and type(bank.get("checksComplete")) is bool)
    if bank.get("state") == "observed":
        fields(bank, "state period sync coverage transactions duplicates activity checksComplete")
        fields(bank["period"], "startDate endDate")
        require(bank["period"] == {"startDate": "2026-09-01", "endDate": stamp[:10]}
                and stamp[:10] >= "2026-09-01")
        sync = bank["sync"]
        fields(sync, "state freshness rejectedRows errorRows conflictRows")
        require(sync["state"] in ("complete", "pending", "failed", "review_required", "unknown", "not_observed")
                and sync["freshness"] in ("verified", "not_requested", "stale_or_unobserved"))
        for key in ("rejectedRows", "errorRows", "conflictRows"):
            count(sync[key])
        counts(bank["coverage"], "accountRows distinctAccountKeys legalEntities invalidAccountKeys accountsWithStatement coveredInLatestRun accountsWithContainingStatementInLatestRun accountsWithMatchingTransactionCount")
        counts(bank["transactions"], "rows eligibleRows incomeRows expenseRows eligibleMissingLinks danglingLinks pendingOrNonRub unexpectedAccountRows incomeAmountMinor expenseAmountMinor linkedIncomeAmountMinor linkedExpenseAmountMinor linkedFinancialRows financialMismatchRows")
        if bank["checksComplete"]:
            money=bank["transactions"]
            require(money["financialMismatchRows"] == 0 and money["linkedFinancialRows"] == money["eligibleRows"]
                    and money["incomeAmountMinor"] == money["linkedIncomeAmountMinor"]
                    and money["expenseAmountMinor"] == money["linkedExpenseAmountMinor"])
        counts(bank["duplicates"], "groups excessRows missingIdentityRows")
        require(bank["activity"] in ("observed", "not_observed"))
    else:
        fields(bank, "state checksComplete")
        require(bank["state"] in ("schema_missing", "not_checked", "invalid_window", "unavailable")
                and bank["checksComplete"] is False)
    complete = (all(item["state"] == "observed" for item in value["tables"].values())
                and all(item["state"] == "observed" and item["violations"] == 0 for item in value["checks"].values())
                and bank["checksComplete"])
    require(complete == (status == "bounded_checks_complete"))
    return status
try:
    raw = sys.stdin.buffer.read(LIMIT + 1)
    if len(raw) > LIMIT:
        print("output_limit")
        raise SystemExit()
    payload, trailer = raw.rstrip(b"\n").rsplit(b"\n", 1)
    require(re.fullmatch(rb"D075_PROBE_EXIT=[0-9]{1,3}", trailer))
    code = int(trailer.split(b"=")[1])
    if code == 124:
        print("timeout")
    elif code not in (0, 2):
        print("failed")
    else:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=unique)
        status = validate(value, code)
        sanitized = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
        print(status)
        print(sanitized)
except Exception:
    print("invalid_report")
'
}
# No pull/build, inherited production env, secrets, network, Docker socket or RW mount.
# The external deadline also bounds synchronous SQLite queries. Cleanup owns only probe.
set +e
probe_report="$(
  {
    timeout 60 docker run --name "$probe" --pull never --rm -i \
  --label "arthello.readonly.probe=$label" --user 1000:1000 \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 32 --memory 192m --cpus 0.25 \
  --mount "type=volume,src=$volume,dst=/data,readonly,volume-nocopy" \
  --entrypoint node "$image" --input-type=module - --production-readonly \
      < scripts/production-readonly.mjs 2>/dev/null
    printf '\nD075_PROBE_EXIT=%s\n' "$?"
  } | validate_report 2>/dev/null
)"
transport_status=$?
set -e
result="${probe_report%%$'\n'*}"
case "$result" in
  output_limit) echo 'READONLY_BLOCKED=probe_output_limit'; exit 2 ;;
  timeout) echo 'READONLY_BLOCKED=probe_timed_out'; exit 2 ;;
  failed) echo 'READONLY_BLOCKED=probe_failed'; exit 2 ;;
  invalid_report) echo 'READONLY_BLOCKED=invalid_probe_report'; exit 2 ;;
  bounded_checks_complete|incomplete_or_issues|blocked) ;;
  *) echo 'READONLY_BLOCKED=invalid_probe_report'; exit 2 ;;
esac
if [[ "$transport_status" -ne 0 ]]; then echo 'READONLY_BLOCKED=probe_transport_failed'; exit 2; fi
if [[ "$result" = blocked ]]; then
  printf '%s\n' "${probe_report#*$'\n'}"
  echo 'READONLY_BLOCKED=readonly_source_unavailable'; exit 2
fi
if ! final_selection="$(observe_consumers 2>/dev/null)" || [[ "$final_selection" != "$selection" ]]; then
  echo 'READONLY_BLOCKED=final_runtime_identity'; exit 2
fi
printf '%s\nREADONLY_RESULT=%s\n' "${probe_report#*$'\n'}" "$result"
echo 'READONLY_FINISHED=aggregate_observation_not_live_acceptance'
if [[ "$result" = incomplete_or_issues ]]; then exit 2; fi
