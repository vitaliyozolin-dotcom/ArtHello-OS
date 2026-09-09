#!/usr/bin/env bash
set +x
set -Eeuo pipefail
mode=normal
if (( $# )); then
  if (( $# != 1 )) || [[ "$1" != --candidate-gate ]]; then echo 'SERVER_BROWSER_BLOCKED=arguments_invalid'; exit 2; fi
  mode=--candidate-gate
fi
[[ "$CHECKED_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$BROWSER_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
test -x "$PRECHECK_NODE"
test -n "${ARTHELLO_E2E_LOGIN:-}" && test -n "${ARTHELLO_E2E_PASSWORD:-}" || { echo 'SERVER_BROWSER_BLOCKED=dedicated_credentials_missing'; exit 2; }
name="arthello-e2e-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
if docker inspect "$name" >/dev/null 2>&1; then echo 'SERVER_BROWSER_BLOCKED=invocation_already_exists'; exit 2; fi
cleanup() {
  if [[ "$(docker inspect "$name" --format '{{index .Config.Labels "org.arthello.e2e.invocation"}}' 2>/dev/null || true)" == "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" ]]; then
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Credentials and the optional maintenance nonce travel over stdin only, never Docker configuration, command-line
# arguments, mounts, artifacts, browser logs or saved browser state.
"$PRECHECK_NODE" --input-type=module -e '
  import { validateBrowserInput } from "./deploy/browser/flow.mjs";
  try {
    const input = {login:process.env.ARTHELLO_E2E_LOGIN,password:process.env.ARTHELLO_E2E_PASSWORD};
    if (process.argv[1] === "--candidate-gate") {
      let nonce = "";
      for await (const chunk of process.stdin) { nonce += chunk; if (nonce.length > 65) throw Error(); }
      if (nonce.endsWith("\n")) nonce = nonce.slice(0, -1);
      input.maintenanceNonce = nonce;
    }
    process.stdout.write(JSON.stringify(validateBrowserInput(input)));
  }
  catch { process.exitCode=2; }
' -- "$mode" | timeout --signal=TERM --kill-after=10 150 docker run --rm --init -i \
  --name "$name" --label "org.arthello.e2e.invocation=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --pull never --user 1000:1000 --network bridge --read-only --log-driver none \
  --cap-drop ALL --security-opt no-new-privileges \
  --security-opt "seccomp=$PWD/deploy/browser/seccomp.json" \
  --memory 1g --memory-swap 1g --cpus 1 --pids-limit 256 --shm-size 128m \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=700 \
  "$BROWSER_IMAGE_ID"
