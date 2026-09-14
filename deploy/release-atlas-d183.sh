#!/usr/bin/env bash
# D183: restore the central Atlas SSO boundary and publish the accepted Atlas UI
# without coupling the release to School 1-11 or replacing either data volume.
set -Eeuo pipefail
umask 077

: "${CONTROLLER_SHA:?}" "${ATLAS_SOURCE_SHA:?}" "${ATLAS_SOURCE_TREE:?}"
: "${ATLAS_BUNDLE_DIR:?}" "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
: "${ARTHELLO_OWNER_LOGIN:?}" "${ARTHELLO_OWNER_PASSWORD:?}"
: "${CUTOVER_CONFIRMATION:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"

test "$GITHUB_REPOSITORY" = vitaliyozolin-dotcom/ArtHello-OS
test "$GITHUB_EVENT_NAME" = workflow_dispatch
test "$GITHUB_REF" = refs/heads/main
test "$GITHUB_SHA" = "$CONTROLLER_SHA"
test "$GITHUB_ACTOR" = vitaliyozolin-dotcom
test "$GITHUB_TRIGGERING_ACTOR" = vitaliyozolin-dotcom
test "$GITHUB_RUN_ATTEMPT" = 1
test "$CUTOVER_CONFIRMATION" = "DEPLOY D183 TO PRODUCTION"
[[ "$CONTROLLER_SHA" =~ ^[a-f0-9]{40}$ ]]
test "$ATLAS_SOURCE_SHA" = f856fb3bd098152bb6b02c4d0273c4c9170b130c
test "$ATLAS_SOURCE_TREE" = e63e28520670527bc12d84abcd45cd8fffe2b876

controller_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
central_release=95873e519113e93d9d52ac08166eb46b317e5c6e
central_origin=https://arthello-188-225-38-55.sslip.io
atlas_origin=https://atlas-188-225-38-55.sslip.io
school_origin=https://school-188-225-38-55.sslip.io
pay_origin=https://pay-188-225-38-55.sslip.io
caddy=stroios-caddy-1
central_data=arthello-direct-v44-data
atlas_service=atlas-school-diary
atlas_data=atlas-school-diary-data
atlas_backups=atlas-school-diary-backups
atlas_source_before=987abd5951dc4832e2c071d8744051c518bae42e
secret_dir="$HOME/.config/arthello"
atlas_secret="$secret_dir/atlas-central-access-secret"
state_root="$secret_dir/release-state"
expected_receipt="$state_root/production-d182-$central_release.json"
receipt="$state_root/production-d183-$CONTROLLER_SHA.json"
run_key="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
candidate="arthello-direct-$run_key"
atlas_rollback="${atlas_service}-d133-rollback-$run_key"
work="$(mktemp -d "$state_root/.atlas-d183-$run_key.XXXXXXXX")"
live_inspect="$work/live.json"
runtime_before="$work/runtime.before.env"
runtime_env="$work/runtime.env"
route_before="$work/external-routes.before.caddy"
route_after="$work/external-routes.after.caddy"
route_backup="/data/external-routes.caddy.pre-d183-$run_key"
route_stage="/data/.external-routes.d183-$run_key"
production_receipt="$work/receipt.json"
central_stopped=0
candidate_started=0
route_swapped=0
atlas_changed=0
success=0

current_main() {
  curl --fail-with-body --silent --show-error --max-time 30 \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/git/ref/heads/main" | jq -er '.object.sha'
}

runtime_node="$(command -v node || true)"
if [[ -z "$runtime_node" ]]; then
  runner_root="$(realpath "$RUNNER_TEMP/../..")"
  runtime_node="$runner_root/externals/node24/bin/node"
fi
test -x "$runtime_node"

restore_restart() {
  local target="$1"
  if [ "$old_restart" = on-failure ] && [ "$old_restart_max" -gt 0 ]; then
    docker update --restart="on-failure:$old_restart_max" "$target" >/dev/null
  else
    docker update --restart="$old_restart" "$target" >/dev/null
  fi
}

rollback() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [ "$success" -ne 1 ]; then
    printf 'ATLAS_D183_ROLLBACK=STARTED\n' >&2
    if [ "$route_swapped" -eq 1 ]; then
      docker exec --user 0:0 -e BACKUP="$route_backup" "$caddy" sh -ceu '
        test -f "$BACKUP" && cp "$BACKUP" /data/external-routes.caddy
      ' >/dev/null 2>&1 || true
      docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
      docker restart --time 20 "$caddy" >/dev/null 2>&1 || true
    fi
    if [ "$candidate_started" -eq 1 ]; then docker rm -f "$candidate" >/dev/null 2>&1 || true; fi
    if [ "$central_stopped" -eq 1 ]; then
      docker start "$live_id" >/dev/null 2>&1 || true
      restore_restart "$live_id" >/dev/null 2>&1 || true
    fi
    if [ "$atlas_changed" -eq 1 ] && docker inspect "$atlas_rollback" >/dev/null 2>&1; then
      docker rm -f "$atlas_service" >/dev/null 2>&1 || true
      docker rename "$atlas_rollback" "$atlas_service" >/dev/null 2>&1 || true
      docker start "$atlas_service" >/dev/null 2>&1 || true
    fi
  fi
  rm -f -- "$runtime_before" "$runtime_env"
  rm -rf -- "$work"
  exit "$status"
}
trap rollback EXIT INT TERM HUP

test "$(current_main)" = "$CONTROLLER_SHA"
test "$(hostname -I | tr ' ' '\n' | grep -Fx '188.225.38.55' | head -n1)" = 188.225.38.55
test -s "$expected_receipt"
test ! -e "$receipt"
! docker inspect "$candidate" >/dev/null 2>&1
test -f "$atlas_secret" && test ! -L "$atlas_secret" && test -s "$atlas_secret"
test "$(stat -c '%a' "$atlas_secret")" = 444
test "$(wc -c < "$atlas_secret")" -ge 64
test "$(docker inspect "$caddy" --format '{{.State.Running}}')" = true

jq -e --arg release "$central_release" '
  .schemaVersion==1 and .state=="verified" and .decision=="D182" and
  .releaseSha==$release and (.sourceTree|test("^[a-f0-9]{40}$")) and
  (.imageId|test("^sha256:[a-f0-9]{64}$")) and
  (.candidateContainerId|test("^[a-f0-9]{64}$")) and
  (.activeRouteSha256|test("^[a-f0-9]{64}$")) and
  (.payAssetRoot|test("^/data/arthello-pay-assets-[a-f0-9]{40}$")) and
  (.payAssetSha256["index.html"]|test("^[a-f0-9]{64}$")) and
  (.payAssetSha256["app.js"]|test("^[a-f0-9]{64}$")) and
  (.payAssetSha256["styles.css"]|test("^[a-f0-9]{64}$")) and
  (.payAssetSha256["release.json"]|test("^[a-f0-9]{64}$")) and
  .moneyAcceptanceEnabled==false and .fiscalizationEnabled==false and
  .reverseWriteEnabled==false and .alfaCrmImportEnabled==true
' "$expected_receipt" >/dev/null

docker exec "$caddy" sh -ceu 'cat /data/external-routes.caddy' > "$route_before"
chmod 0600 "$route_before"
expected_route_sha="$(jq -er '.activeRouteSha256' "$expected_receipt")"
test "$(sha256sum "$route_before" | cut -d ' ' -f 1)" = "$expected_route_sha"
readarray -t route_identity < <("$runtime_node" --input-type=module - "$route_before" <<'NODE'
import { readFileSync } from "node:fs";
const body=readFileSync(process.argv[2],"utf8");
const upstreams=new Set(body.match(/arthello-direct-[1-9][0-9]*-[1-9][0-9]*:8081/g)??[]);
const assets=new Set(body.match(/\/data\/arthello-pay-assets-[a-f0-9]{40}/g)??[]);
if(upstreams.size!==1||assets.size!==1)process.exit(1);
console.log([...upstreams][0].replace(/:8081$/,""));
console.log([...assets][0]);
NODE
)
test "${#route_identity[@]}" -eq 2
live_name="${route_identity[0]}"
pay_asset_root="${route_identity[1]}"
test "$pay_asset_root" = "$(jq -er '.payAssetRoot' "$expected_receipt")"

docker inspect "$live_name" > "$live_inspect"
live_id="$(jq -er '.[0].Id' "$live_inspect")"
live_image="$(jq -er '.[0].Image' "$live_inspect")"
live_tree="$(jq -er '.[0].Config.Labels["arthello.release.tree"]' "$live_inspect")"
test "$live_id" = "$(jq -er '.candidateContainerId' "$expected_receipt")"
test "$live_image" = "$(jq -er '.imageId' "$expected_receipt")"
test "$live_tree" = "$(jq -er '.sourceTree' "$expected_receipt")"
test "$(jq -er '.[0].State.Running' "$live_inspect")" = true
test "$(docker image inspect "$live_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$central_release"
test "$(docker image inspect "$live_image" --format '{{index .Config.Labels "org.opencontainers.image.source-tree"}}')" = "$live_tree"
test "$(jq -r '.[0].Mounts[] | select(.Destination=="/data") | .Name' "$live_inspect")" = "$central_data"
network="$(jq -er '.[0].NetworkSettings.Networks | keys | select(length==1) | .[0]' "$live_inspect")"
[[ "$network" =~ ^[A-Za-z0-9_.-]+$ ]]
old_restart="$(jq -er '.[0].HostConfig.RestartPolicy.Name' "$live_inspect")"
old_restart_max="$(jq -er '.[0].HostConfig.RestartPolicy.MaximumRetryCount' "$live_inspect")"
case "$old_restart" in no|always|unless-stopped|on-failure) ;; *) exit 1 ;; esac
[[ "$old_restart_max" =~ ^[0-9]+$ ]]
test "$(jq -r '.[0].Config.Env[]' "$live_inspect" | grep -Fx "RELEASE_SHA=$central_release" | wc -l)" -eq 1
test "$(jq -r '.[0].Config.Env[]' "$live_inspect" | grep -Ec '^ALFACRM_IMPORT_ENABLED=(1|true|yes)$')" -eq 1

for name in index.html app.js styles.css release.json; do
  expected_asset_sha="$(jq -er --arg name "$name" '.payAssetSha256[$name]' "$expected_receipt")"
  actual_asset_sha="$(docker exec -e ROOT="$pay_asset_root" -e NAME="$name" "$caddy" sh -ceu '
    case "$NAME" in index.html|app.js|styles.css|release.json) ;; *) exit 1 ;; esac
    test -d "$ROOT" && test ! -L "$ROOT" && test -s "$ROOT/$NAME" && test ! -L "$ROOT/$NAME"
    sha256sum "$ROOT/$NAME" | cut -d " " -f 1
  ')"
  test "$actual_asset_sha" = "$expected_asset_sha"
done

jq -r '.[0].Config.Env[]' "$live_inspect" > "$runtime_before"
"$runtime_node" "$controller_root/deploy/atlas-runtime-recovery-d183.mjs" env \
  --input "$runtime_before" --output "$runtime_env" --atlas-origin "$atlas_origin"
chmod 0600 "$runtime_env"
test "$(grep -Fx "ATLAS_PUBLIC_ORIGIN=$atlas_origin" "$runtime_env" | wc -l)" -eq 1
test "$(grep -Fx 'ATLAS_CENTRAL_ACCESS_SECRET_FILE=/run/secrets/atlas-central-access-secret' "$runtime_env" | wc -l)" -eq 1

atlas_mount_count="$(jq '[.[0].Mounts[] | select(.Destination=="/run/secrets/atlas-central-access-secret")] | length' "$live_inspect")"
case "$atlas_mount_count" in
  0) ;;
  1)
    jq -e --arg source "$atlas_secret" '
      .[0].Mounts[] | select(.Destination=="/run/secrets/atlas-central-access-secret") |
      .Type=="bind" and .Source==$source and .RW==false
    ' "$live_inspect" >/dev/null
    ;;
  *) exit 1 ;;
esac
mount_args=()
while IFS= read -r spec; do mount_args+=(--mount "$spec"); done < <(
  jq -er '.[0].Mounts[] |
    if .Type=="volume" then "type=volume,src="+.Name+",dst="+.Destination+(if .RW then "" else ",readonly" end)+",volume-nocopy"
    elif .Type=="bind" then "type=bind,src="+.Source+",dst="+.Destination+(if .RW then "" else ",readonly" end)
    else empty end' "$live_inspect"
)
test "${#mount_args[@]}" -ge 6
if [ "$atlas_mount_count" -eq 0 ]; then
  mount_args+=(--mount "type=bind,src=$atlas_secret,dst=/run/secrets/atlas-central-access-secret,readonly")
fi

"$runtime_node" "$controller_root/deploy/atlas-runtime-recovery-d183.mjs" route \
  --input "$route_before" --output "$route_after" \
  --old-upstream "$live_name" --new-upstream "$candidate"
chmod 0600 "$route_after"
atlas_live_source="$(docker inspect "$atlas_service" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
case "$atlas_live_source" in
  "$atlas_source_before") atlas_changed=1 ;;
  "$ATLAS_SOURCE_SHA") atlas_changed=0 ;;
  *) printf 'Unexpected Atlas source: %s\n' "$atlas_live_source" >&2; exit 1 ;;
esac
test "$(docker inspect "$atlas_service" --format '{{.State.Running}}')" = true
test "$(docker inspect "$atlas_service" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$atlas_data"
test "$(docker inspect "$atlas_service" --format '{{range .Mounts}}{{if eq .Destination "/backups"}}{{.Name}}{{end}}{{end}}')" = "$atlas_backups"
test "$(current_main)" = "$CONTROLLER_SHA"
printf 'ATLAS_D183_PREDECESSOR=VERIFIED central=%s route=%s atlas=%s\n' "$central_release" "$expected_route_sha" "$atlas_live_source"

bash "$controller_root/deploy/upgrade-atlas-d133.sh"
test "$(docker inspect "$atlas_service" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$ATLAS_SOURCE_SHA"
test "$(docker inspect "$atlas_service" --format '{{index .Config.Labels "org.opencontainers.image.source-tree"}}')" = "$ATLAS_SOURCE_TREE"
if [ "$atlas_changed" -eq 1 ]; then
  test "$(jq -er '.backup.integrity' "$ATLAS_BUNDLE_DIR/atlas-d133-production-receipt.json")" = ok
  test "$(docker inspect "$atlas_rollback" --format '{{.State.Running}}')" = false
fi
printf 'ATLAS_D183_BACKUP=VERIFIED data_volume=%s backups_volume=%s\n' "$atlas_data" "$atlas_backups"

test "$(current_main)" = "$CONTROLLER_SHA"
docker update --restart=no "$live_id" >/dev/null
docker stop --time 30 "$live_id" >/dev/null
central_stopped=1
test "$(docker inspect "$live_id" --format '{{.State.Running}}')" = false

docker run -d --name "$candidate" --restart no --read-only \
  --tmpfs /tmp --tmpfs /app/node_modules/.mf:rw,uid=1000,gid=1000,mode=0700 \
  --network "$network" --env-file "$runtime_env" \
  "${mount_args[@]}" \
  --label "arthello.release.sha=$central_release" \
  --label "arthello.release.tree=$live_tree" \
  --label "arthello.config.decision=D183" \
  --label "arthello.controller.sha=$CONTROLLER_SHA" \
  --label "arthello.release.run=$GITHUB_RUN_ID" \
  "$live_image" >/dev/null
candidate_started=1
candidate_id="$(docker inspect "$candidate" --format '{{.Id}}')"
[[ "$candidate_id" =~ ^[a-f0-9]{64}$ ]]
ready=0
for _ in $(seq 1 90); do
  if docker exec "$candidate" node -e "fetch('http://127.0.0.1:8081/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{const b=await r.json();if(!r.ok||b.status!=='ok'||b.database!=='available')process.exit(1)}).catch(()=>process.exit(1))"; then ready=1; break; fi
  sleep 2
done
test "$ready" -eq 1
test "$(docker inspect "$candidate" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$central_data"
test "$(docker inspect "$candidate" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Fx "ATLAS_PUBLIC_ORIGIN=$atlas_origin" | wc -l)" -eq 1
test "$(docker inspect "$candidate" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Fx 'ATLAS_CENTRAL_ACCESS_SECRET_FILE=/run/secrets/atlas-central-access-secret' | wc -l)" -eq 1
docker inspect "$candidate" | jq -e --arg source "$atlas_secret" '
  [.[0].Mounts[] | select(.Type=="bind" and .Source==$source and .Destination=="/run/secrets/atlas-central-access-secret" and .RW==false)] | length==1
' >/dev/null
docker exec -e ATLAS_ORIGIN="$atlas_origin" "$candidate" node --input-type=module -e '
  const response=await fetch("http://127.0.0.1:8081/api/atlas-sso/open",{redirect:"manual"});
  if(response.status!==303||response.headers.get("location")!==process.env.ATLAS_ORIGIN+"/auth/central/start")process.exit(1);
'

route_owner="$(docker exec "$caddy" stat -c '%u:%g' /data/external-routes.caddy)"
docker cp "$route_before" "$caddy:$route_backup"
docker cp "$route_after" "$caddy:$route_stage"
docker exec --user 0:0 -e OWNER="$route_owner" -e BACKUP="$route_backup" -e STAGE="$route_stage" "$caddy" sh -ceu '
  chown "$OWNER" "$BACKUP" "$STAGE"
  chmod 0600 "$BACKUP" "$STAGE"
  mv "$STAGE" /data/external-routes.caddy
'
route_swapped=1
docker exec "$caddy" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
docker restart --time 20 "$caddy" >/dev/null

public_acceptance() {
  curl --fail --silent --show-error --max-time 15 "$central_origin/api/health" | jq -e '.status=="ok" and .database=="available"' >/dev/null &&
  curl --fail --silent --show-error --max-time 15 "$atlas_origin/api/health" | jq -e '.status=="ok"' >/dev/null &&
  curl --fail --silent --show-error --max-time 15 "$school_origin/api/health" | jq -e '.status=="ok"' >/dev/null &&
  curl --fail --silent --show-error --max-time 15 "$pay_origin/pay-assets/release.json" | jq -e '.decision=="D182" and .releaseSha=="95873e519113e93d9d52ac08166eb46b317e5c6e"' >/dev/null &&
  test "$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$central_origin/api/atlas-sso/open")" = 303 &&
  curl --silent --show-error --max-time 15 --output /dev/null --dump-header - "$central_origin/api/atlas-sso/open" | tr -d '\r' | grep -Fxi "location: $atlas_origin/auth/central/start" >/dev/null
}
public_ready=0
for _ in $(seq 1 30); do
  if public_acceptance; then public_ready=1; break; fi
  sleep 2
done
test "$public_ready" -eq 1
printf 'ATLAS_D183_CENTRAL_SSO_OPEN=VERIFIED status=303\n'

export ATLAS_OWNER_ACCESS_APPLY=1
owner_result="$("$runtime_node" "$controller_root/deploy/activate-atlas-owner-access.mjs")"
jq -e '.status=="accepted" and .ownerGrant=="director" and .atlasSso=="verified"' <<<"$owner_result" >/dev/null
printf 'ATLAS_D183_OWNER_SSO=VERIFIED role=director\n'

test "$(current_main)" = "$CONTROLLER_SHA"
restore_restart "$candidate"
candidate_restart_count="$(docker inspect "$candidate" --format '{{.RestartCount}}')"
atlas_restart_count="$(docker inspect "$atlas_service" --format '{{.RestartCount}}')"
for _ in $(seq 1 13); do
  sleep 5
  docker exec "$candidate" node -e "fetch('http://127.0.0.1:8081/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  docker exec "$atlas_service" node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  test "$(docker inspect "$candidate" --format '{{.RestartCount}}')" = "$candidate_restart_count"
  test "$(docker inspect "$atlas_service" --format '{{.RestartCount}}')" = "$atlas_restart_count"
done
public_acceptance

route_sha="$(sha256sum "$route_after" | cut -d ' ' -f 1)"
jq -n \
  --arg controller "$CONTROLLER_SHA" --arg centralRelease "$central_release" \
  --arg centralTree "$live_tree" --arg centralImage "$live_image" \
  --arg candidate "$candidate_id" --arg previous "$live_id" \
  --arg route "$route_sha" --arg assets "$pay_asset_root" \
  --arg atlasSource "$ATLAS_SOURCE_SHA" --arg atlasTree "$ATLAS_SOURCE_TREE" \
  --arg atlasContainer "$(docker inspect "$atlas_service" --format '{{.Id}}')" \
  --argjson payHashes "$(jq '.payAssetSha256' "$expected_receipt")" \
  --argjson data "$(jq '.dataProof' "$expected_receipt")" \
  --argjson alfa "$(jq '.alfaLiveProof' "$expected_receipt")" \
  --argjson owner "$owner_result" '
    {schemaVersion:1,state:"verified",decision:"D183",controllerSha:$controller,
     applicationReleaseSha:$centralRelease,sourceTree:$centralTree,imageId:$centralImage,
     candidateContainerId:$candidate,previousContainerId:$previous,activeRouteSha256:$route,
     payAssetRoot:$assets,payAssetSha256:$payHashes,dataProof:$data,alfaLiveProof:$alfa,
     alfaCrmImportEnabled:true,reverseWriteEnabled:false,moneyAcceptanceEnabled:false,fiscalizationEnabled:false,
     atlas:{sourceSha:$atlasSource,sourceTree:$atlasTree,containerId:$atlasContainer,dataVolume:"atlas-school-diary-data",dataVolumePreserved:true,ownerSso:$owner}}
  ' > "$production_receipt"
chmod 0600 "$production_receipt"
ln "$production_receipt" "$receipt"
if [ "$atlas_changed" -eq 1 ]; then docker rm "$atlas_rollback" >/dev/null; fi
success=1
rm -f -- "$runtime_before" "$runtime_env"
trap - EXIT INT TERM HUP
printf 'ATLAS_D183_PRODUCTION=VERIFIED controller=%s central=%s atlas=%s candidate=%s\n' \
  "$CONTROLLER_SHA" "$central_release" "$ATLAS_SOURCE_SHA" "$candidate"
printf 'candidate=%s\nreceipt=%s\n' "$candidate" "$receipt"
rm -rf -- "$work"
