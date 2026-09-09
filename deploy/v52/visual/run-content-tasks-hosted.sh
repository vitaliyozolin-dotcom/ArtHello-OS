#!/usr/bin/env bash
# Hosted synthetic fixture only. Inputs are directories produced by the workflow.
set -Eeuo pipefail
umask 077
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
[[ "${GITHUB_REPOSITORY:-}" == vitaliyozolin-dotcom/ArtHello-OS ]]
[[ "${TARGET_SOURCE_SHA:-}" == 77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed ]]
[[ "${TARGET_TREE_SHA:-}" == ac3fcaac06acf33bf9ee32e438d0c040adb38fd7 ]]
[[ "${VERIFICATION_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]]
[[ "${EXPECTED_RUNTIME_FINGERPRINT:-}" =~ ^[a-f0-9]{64}$ ]]
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]
source_root="$(realpath -- "${1:?exact source checkout required}")"
artifact_root="$(realpath -- "${2:?downloaded verification artifact required}")"
output_root="$(realpath -- "${3:?new output directory required}")"
script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ "$(git -C "$source_root" rev-parse HEAD)" == "$TARGET_SOURCE_SHA" ]]
[[ "$(git -C "$source_root" rev-parse HEAD^{tree})" == "$TARGET_TREE_SHA" ]]
test -z "$(git -C "$source_root" status --porcelain=v1 --untracked-files=all)"
test -z "$(find "$output_root" -mindepth 1 -maxdepth 1 -print -quit)"
docker info >/dev/null

# Artifact provenance is also independently checked against the GitHub run by the
# workflow before download. Never use an arbitrary image or caller-selected tag.
SOURCE_ROOT="$source_root" ARTIFACT_ROOT="$artifact_root" python3 - <<'PY'
import hashlib, json, os, pathlib, re
root = pathlib.Path(os.environ['ARTIFACT_ROOT'])
source = pathlib.Path(os.environ['SOURCE_ROOT'])
required = {'arthello-v52.json', 'arthello-v52.json.sha256', 'arthello-v52-image.tar.gz'}
assert {p.name for p in root.iterdir()} == required
assert all(p.is_file() and not p.is_symlink() for p in root.iterdir())
raw = (root / 'arthello-v52.json').read_bytes()
digest = hashlib.sha256(raw).hexdigest()
assert (root / 'arthello-v52.json.sha256').read_text() == digest + '  arthello-v52.json\n'
e = json.loads(raw)
expected = dict(repository=os.environ['GITHUB_REPOSITORY'],
    workflowRunId=os.environ['VERIFICATION_RUN_ID'], workflowRunAttempt=os.environ['VERIFICATION_RUN_ATTEMPT'],
    headSha=os.environ['TARGET_SOURCE_SHA'], treeSha=os.environ['TARGET_TREE_SHA'],
    runnerTrust='github-hosted-ephemeral', productionCapability=False)
assert all(type(e[k]) is type(v) and e[k] == v for k, v in expected.items())
files = {'dockerfileSha256':'deploy/v52/Dockerfile', 'runtimeLockSha256':'deploy/v52/runtime/package-lock.json',
    'inventorySha256':'deploy/v52/maintenance/production-data-inventory.py',
    'tochkaCaSha256':'deploy/v52/certificates/russian-trusted-root-ca.pem',
    'fingerprintFilterSha256':'deploy/v52/maintenance/image-runtime-fingerprint.jq'}
for key, path in files.items():
    assert e[key] == hashlib.sha256((source / path).read_bytes()).hexdigest()
with (root / 'arthello-v52-image.tar.gz').open('rb') as f:
    assert e['imageArchiveSha256'] == hashlib.file_digest(f, 'sha256').hexdigest()
assert re.fullmatch(r'sha256:[a-f0-9]{64}', e['imageId'])
assert re.fullmatch(r'[a-f0-9]{64}', e['runtimeFingerprintSha256'])
assert e['runtimeFingerprintSha256'] == os.environ['EXPECTED_RUNTIME_FINGERPRINT']
PY

work="$(mktemp -d "$RUNNER_TEMP/arthello-visual.XXXXXXXX")"
nonce="$(openssl rand -hex 12)"
resource="arthello-visual-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${nonce}"
network="$resource-net"
volume="$resource-data"
app="$resource-app"
browser="$resource-browser"
made_network=0 made_volume=0 made_app=0 made_browser=0
cleanup() {
  local prior=$? cleanup_failed=0
  trap - EXIT INT TERM
  if (( made_browser )); then docker rm -f "$browser" >/dev/null || cleanup_failed=1; fi
  if (( made_app )); then docker rm -f "$app" >/dev/null || cleanup_failed=1; fi
  if (( made_volume )); then docker volume rm "$volume" >/dev/null || cleanup_failed=1; fi
  if (( made_network )); then docker network rm "$network" >/dev/null || cleanup_failed=1; fi
  rm -rf -- "$work" || cleanup_failed=1
  if (( cleanup_failed )); then echo 'ARTHELLO_VISUAL_CLEANUP=BLOCKED'; exit 1; fi
  exit "$prior"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

gzip -t "$artifact_root/arthello-v52-image.tar.gz"
gzip -dc "$artifact_root/arthello-v52-image.tar.gz" > "$work/app-image.tar"
docker load --input "$work/app-image.tar" > "$work/docker-load.log"
rm -- "$work/app-image.tar"
image_tag="arthello-v52-verify:$TARGET_SOURCE_SHA"
image_id="$(docker image inspect "$image_tag" --format '{{.Id}}')"
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
docker image inspect "$image_id" > "$work/app-image.json"
jq -e --arg sha "$TARGET_SOURCE_SHA" --arg tree "$TARGET_TREE_SHA" \
  'length == 1 and .[0].Os == "linux" and .[0].Architecture == "amd64" and
   .[0].Config.User == "node" and .[0].Config.WorkingDir == "/app" and
   .[0].Config.Cmd == ["node","production/runtime-server.mjs"] and
   (.[0].Config.Entrypoint // []) == ["docker-entrypoint.sh"] and
   .[0].Config.Labels["org.opencontainers.image.revision"] == $sha and
   .[0].Config.Labels["org.opencontainers.image.source-tree"] == $tree' "$work/app-image.json" >/dev/null
fingerprint="$(jq -cS -f "$source_root/deploy/v52/maintenance/image-runtime-fingerprint.jq" "$work/app-image.json" | sha256sum | cut -d ' ' -f 1)"
[[ "$fingerprint" == "$(jq -er '.runtimeFingerprintSha256' "$artifact_root/arthello-v52.json")" ]]

# The browser is built off-host from the existing frozen lock and base digest.
# No application build, package install or live credential is used on a VPS.
browser_context="$work/browser-context"
node "$script_root/assemble-browser-context.cjs" "$source_root/deploy/browser" "$browser_context"
docker build --platform linux/amd64 --build-arg "SOURCE_SHA=$TARGET_SOURCE_SHA" \
  --tag "$resource-browser-image" "$browser_context" > "$work/browser-build.log" 2>&1
browser_id="$(docker image inspect "$resource-browser-image" --format '{{.Id}}')"
[[ "$browser_id" =~ ^sha256:[a-f0-9]{64}$ ]]
common=(--pull never --user 1000:1000 --read-only --cap-drop ALL
  --security-opt no-new-privileges --pids-limit 256
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=700)
timeout --signal=TERM --kill-after=10 90 docker run --rm --init "${common[@]}" \
  --network none --security-opt "seccomp=$source_root/deploy/browser/seccomp.json" \
  --memory 1g --memory-swap 1g --cpus 1 --shm-size 128m "$browser_id" --smoke

docker network create --internal --label "org.arthello.visual=$nonce" "$network" >/dev/null
made_network=1
[[ "$(docker network inspect "$network" --format '{{.Internal}}')" == true ]]
[[ "$(docker network inspect "$network" --format '{{index .Labels "org.arthello.visual"}}')" == "$nonce" ]]
docker volume create --label "org.arthello.visual=$nonce" "$volume" >/dev/null
made_volume=1
[[ "$(docker volume inspect "$volume" --format '{{index .Labels "org.arthello.visual"}}')" == "$nonce" ]]
# The only /data source is the new invocation-owned volume. No path/volume input.
docker run --rm "${common[@]}" --network none --mount "type=volume,source=$volume,target=/data" \
  --entrypoint node "$image_id" -e 'const f=require("node:fs"); if(f.readdirSync("/data").join()!=="d1" || f.readdirSync("/data/d1").length)process.exit(1)'

temp_password="VisualTmp_$(openssl rand -hex 24)"
permanent_password="VisualFinal_$(openssl rand -hex 24)"
printf '::add-mask::%s\n::add-mask::%s\n' "$temp_password" "$permanent_password"
printf 'INTEGRATION_CREDENTIALS_KEY=%s\nCENTRAL_ACCESS_SECRET=%s\nARTHELLO_BOOTSTRAP_LOGIN=owner\nARTHELLO_BOOTSTRAP_PASSWORD=%s\nARTHELLO_PUBLIC_ORIGIN=http://localhost:18082\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$temp_password" > "$work/app.env"
printf 'VISUAL_TEMP_PASSWORD=%s\nVISUAL_DATA_ROOT=/data\n' "$temp_password" > "$work/fixture.env"
printf 'TEMP_PASSWORD=%s\nPERMANENT_PASSWORD=%s\nPILOT_UPSTREAM=http://visual-app:8081\nVISUAL_OUTPUT=/screens\n' \
  "$temp_password" "$permanent_password" > "$work/browser.env"
docker create --name "$app" "${common[@]}" --network "$network" --network-alias visual-app --dns 127.0.0.1 \
  --memory 2g --memory-swap 2g --cpus 2 --env-file "$work/app.env" \
  --tmpfs /app/node_modules/.mf:rw,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=700 \
  --mount "type=volume,source=$volume,target=/data" "$image_id" >/dev/null
made_app=1
wait_ready() {
  local ready=0
  for attempt in $(seq 1 60); do
    if docker exec "$app" node -e 'fetch("http://127.0.0.1:8081/api/health").then(async r=>{const j=await r.json();if(r.status!==200||j.status!=="ok"||j.database!=="available")process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  (( ready ))
}
docker start "$app" >/dev/null
wait_ready
docker stop --time 20 "$app" >/dev/null
# This destructive auth reset is permitted only on the new volume above while
# the sole application consumer is stopped. The production DB is never copied.
docker run --rm "${common[@]}" --network none --env-file "$work/fixture.env" \
  --mount "type=volume,source=$volume,target=/data" \
  --mount "type=bind,source=$source_root/deploy/v52/visual/prepare-visual-fixture.mjs,target=/fixture.mjs,readonly" \
  --entrypoint node "$image_id" /fixture.mjs
docker start "$app" >/dev/null
wait_ready

mkdir "$output_root/screens"
chmod 0777 "$output_root/screens"
docker create --name "$browser" --init "${common[@]}" --network "$network" --dns 127.0.0.1 \
  --security-opt "seccomp=$source_root/deploy/browser/seccomp.json" \
  --memory 2g --memory-swap 2g --cpus 2 --shm-size 256m --env-file "$work/browser.env" \
  --mount "type=bind,source=$source_root,target=/source,readonly" \
  --mount "type=bind,source=$script_root/content-tasks-scoped.cjs,target=/runner.cjs,readonly" \
  --mount "type=bind,source=$output_root/screens,target=/screens" \
  --entrypoint node "$browser_id" /runner.cjs >/dev/null
made_browser=1
test "$(docker inspect "$app" --format '{{.Image}}')" = "$image_id"
test "$(docker inspect "$browser" --format '{{.Image}}')" = "$browser_id"
timeout --signal=TERM --kill-after=10 600 docker start --attach "$browser"
test "$(docker inspect "$browser" --format '{{.State.ExitCode}}')" = 0
jq -n --arg source "$TARGET_SOURCE_SHA" --arg tree "$TARGET_TREE_SHA" \
  --arg run "$VERIFICATION_RUN_ID" --arg image "$image_id" --arg fingerprint "$fingerprint" \
  --arg browser "$browser_id" --arg runner "$GITHUB_SHA" \
  '{kind:"synthetic-content-tasks-visual",result:"pass",sourceSha:$source,treeSha:$tree,
    verificationRunId:$run,loadedImageId:$image,runtimeFingerprintSha256:$fingerprint,
    browserImageId:$browser,runnerSourceSha:$runner,externalTraffic:"blocked-internal-network",
    data:"new-synthetic-volume",viewports:[[390,844],[1440,900]],routes:["content","tasks"],
    pngCount:14,liveAcceptance:"not_run",savePersistence:"not_tested",taskNumberAssertion:"visible_801"}' \
  > "$output_root/evidence.json"
echo 'ARTHELLO_SYNTHETIC_CONTENT_TASKS=PASS png=14 live=not_run'
