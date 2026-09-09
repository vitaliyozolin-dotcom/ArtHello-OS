#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ && "$BROWSER_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$BROWSER_FINGERPRINT" =~ ^[a-f0-9]{64}$ ]]
[[ "$BROWSER_PHASE" == before || "$BROWSER_PHASE" == after ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]

# This same release job imported the sandbox-tested hosted bundle. No pull/build
# or installation is permitted here; exact source and portable identity are bound.
browser_image_id="$(docker image inspect "arthello-e2e:$BROWSER_SOURCE_SHA" --format '{{.Id}}')"
[[ "$browser_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
fingerprint="$(docker image inspect "$browser_image_id" | jq -cS -f deploy/v52/maintenance/image-runtime-fingerprint.jq | sha256sum | cut -d ' ' -f 1)"
test "$fingerprint" = "$BROWSER_FINGERPRINT"
test "$(docker image inspect "$browser_image_id" --format '{{.Config.User}}')" = 1000:1000
test "$(docker image inspect "$browser_image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$BROWSER_SOURCE_SHA"
test "$(docker image inspect "$browser_image_id" --format '{{index .Config.Labels "org.arthello.role"}}')" = e2e-browser
precheck_node="$(command -v node || true)"
if [[ -z "$precheck_node" ]]; then
  runner_root="$(realpath "$RUNNER_TEMP/../..")"
  precheck_node="$runner_root/externals/node24/bin/node"
fi
test -x "$precheck_node"
"$precheck_node" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(2)'
current_main="$(curl --fail --silent --show-error --max-time 20 -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS/git/ref/heads/main | jq -er '.object.sha')"
test "$current_main" = "$RELEASE_SHA"

report="$RUNNER_TEMP/r9-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$BROWSER_PHASE.json"
test ! -e "$report" && test ! -L "$report"
cleanup_report() { rm -f -- "$report"; }
trap cleanup_report EXIT
CHECKED_SOURCE_SHA="$BROWSER_SOURCE_SHA" BROWSER_IMAGE_ID="$browser_image_id" PRECHECK_NODE="$precheck_node" \
  bash scripts/run-server-browser.sh | tee "$report"
mapfile -t observed_live_ids < <(docker ps --filter 'name=^/arthello-direct-' --format '{{.ID}}')
test "${#observed_live_ids[@]}" -eq 1
observed_after="$(docker inspect "${observed_live_ids[0]}" --format '{{index .Config.Labels "arthello.release.sha"}}')"
test "$observed_after" = "$OBSERVED_LIVE_ARTHELLO_SHA"
BROWSER_REPORT_FILE="$report" python3 -I .github/scripts/r9-live-browser-acceptance.py
