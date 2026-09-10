#!/usr/bin/env bash
# D122: first Atlas publication plus a reversible central runtime configuration cutover.
set -Eeuo pipefail
umask 077

: "${CONTROLLER_SHA:?}" "${ATLAS_SOURCE_SHA:?}" "${ATLAS_SOURCE_TREE:?}"
: "${ATLAS_BUNDLE_DIR:?}" "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
test "$GITHUB_REPOSITORY" = vitaliyozolin-dotcom/ArtHello-OS
[[ "$CONTROLLER_SHA" =~ ^[a-f0-9]{40}$ ]]
test "$ATLAS_SOURCE_SHA" = 987abd5951dc4832e2c071d8744051c518bae42e
test "$ATLAS_SOURCE_TREE" = 1dccbd1fea14838bde0319014f7509b572b06061

central_origin=https://arthello-188-225-38-55.sslip.io
school_origin=https://school-188-225-38-55.sslip.io
atlas_origin=https://atlas-188-225-38-55.sslip.io
atlas_host=atlas-188-225-38-55.sslip.io
caddy=stroios-caddy-1
expected_live_name=arthello-direct-34495273615-1
expected_live_id=9909bd54d31244627477bd60c3b8e7cc6cd84758902943e54eb555206c4a1142
expected_central_image=sha256:34402014063a05c81754716f46b3f9059297f1d21d37da7e5f00b1eb8f7fdd46
expected_central_release=ff8559254faaedade63a9ee7567a45686d08c13a
central_data=arthello-direct-v44-data
backup_control=arthello-v52-backup-control-34326582961-1
bank_activation=arthello-v52-tochka-activation-34495273615-1
network=stroios_default
atlas_service=atlas-school-diary
atlas_data=atlas-school-diary-data
atlas_backups=atlas-school-diary-backups
secret_dir="$HOME/.config/arthello"
atlas_key="$secret_dir/atlas-central-access-secret"
atlas_pepper="$secret_dir/atlas-passwordless-pepper"
integration_key="$secret_dir/integration-credentials-key"
bootstrap_key="$secret_dir/bootstrap-password"
central_key="$secret_dir/central-access-secret"
run_key="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
candidate="arthello-direct-$run_key"
work="$(mktemp -d "$RUNNER_TEMP/atlas-d122.XXXXXXXX")"
runtime_env="$work/central-runtime.env"
atlas_env="$work/atlas-runtime.env"
routes_before="$work/external-routes.before.caddy"
main_before="$work/Caddyfile.before"
routes_central="$work/external-routes.central.caddy"
routes_maintenance="$work/external-routes.maintenance.caddy"
routes_combined="$work/external-routes.combined.caddy"
gateway_evidence="$work/gateway-evidence.json"
nonce_file="$work/nonce"
route_new="/data/external-routes.atlas-$run_key.caddy"
route_recovery="/data/external-routes.before-atlas-$run_key.caddy"
config_new="/tmp/Caddyfile.atlas-$run_key"
old_stopped=0
candidate_created=0
atlas_created=0
route_changed=0
release_active=0

require_main() {
  local current
  current="$(curl --fail --silent --show-error --max-time 20 \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/git/ref/heads/main" | jq -er '.object.sha')"
  test "$current" = "$CONTROLLER_SHA"
}

wait_health() {
  local target="$1" port="$2" ready=0
  for _ in $(seq 1 60); do
    if docker exec "$target" node -e "fetch('http://127.0.0.1:$port/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      ready=1
      break
    fi
    sleep 2
  done
  test "$ready" = 1
}

restore() {
  local status=$?
  set +e
  if [ "$release_active" -eq 0 ]; then
    if [ "$route_changed" -eq 1 ]; then
      docker exec "$caddy" sh -ceu \
        "test -s '$route_recovery'; cp '$route_recovery' /data/external-routes.caddy"
      docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
    fi
    if [ "$atlas_created" -eq 1 ]; then docker rm -f "$atlas_service" >/dev/null 2>&1; fi
    if [ "$candidate_created" -eq 1 ]; then docker rm -f "$candidate" >/dev/null 2>&1; fi
    if [ "$old_stopped" -eq 1 ]; then
      docker start "$expected_live_id" >/dev/null
      docker update --restart=unless-stopped "$expected_live_id" >/dev/null
    fi
  fi
  rm -f -- "$runtime_env" "$atlas_env" "$nonce_file"
  if [ "$release_active" -eq 1 ] || [ "$route_changed" -eq 0 ]; then rm -rf -- "$work"; fi
  exit "$status"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

require_main
test "$(hostname -I | tr ' ' '\n' | grep -Fx '188.225.38.55' | head -n1)" = 188.225.38.55
test "$(docker inspect "$caddy" --format '{{.State.Running}}')" = true
test "$(df --output=avail -B1 /var/lib/docker | tail -1 | tr -d ' ')" -ge 4294967296
curl -fsS --max-time 20 "$central_origin/api/health" | jq -e '.status == "ok" and .database == "available"' >/dev/null
curl -fsS --max-time 20 "$school_origin/api/health" | jq -e '.status == "ok"' >/dev/null

mapfile -t live_ids < <(docker ps --filter 'name=^/arthello-direct-' --format '{{.ID}}')
test "${#live_ids[@]}" -eq 1
live_id="$(docker inspect "${live_ids[0]}" --format '{{.Id}}')"
test "$live_id" = "$expected_live_id"
test "$(docker inspect "$live_id" --format '{{.Name}}' | sed 's#^/##')" = "$expected_live_name"
test "$(docker inspect "$live_id" --format '{{.Image}}')" = "$expected_central_image"
test "$(docker inspect "$live_id" --format '{{index .Config.Labels "arthello.release.sha"}}')" = "$expected_central_release"
test "$(docker inspect "$live_id" --format '{{.HostConfig.RestartPolicy.Name}}')" = unless-stopped
test "$(docker inspect "$live_id" --format '{{.HostConfig.ReadonlyRootfs}}')" = true
test "$(docker inspect "$live_id" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}')" = "$network"
test "$(docker inspect "$live_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$central_data"
docker inspect "$live_id" | jq -e --arg control "$backup_control" --arg activation "$bank_activation" '
  [.[0].Mounts[] | select(.Type == "volume" and .RW == false)] as $m |
  any($m[]; .Destination == "/var/lib/arthello-v52-backup-control" and .Name == $control) and
  any($m[]; .Destination == "/var/lib/arthello-v52-tochka-activation" and .Name == $activation)
' >/dev/null
configured="$(docker inspect "$live_id" --format '{{range .Config.Env}}{{println .}}{{end}}')"
expected_env_names='["ARTHELLO_BOOTSTRAP_LOGIN","ARTHELLO_BOOTSTRAP_PASSWORD_FILE","ARTHELLO_D1_PATH","ARTHELLO_PUBLIC_ORIGIN","CENTRAL_ACCESS_SECRET_FILE","INTEGRATION_CREDENTIALS_KEY_FILE","NODE_ENV","NODE_EXTRA_CA_CERTS","NODE_VERSION","OPENAI_OCR_MODEL","PATH","PORT","RELEASE_SHA","SCHOOL_DIARY_ALLOWED_ORIGINS","SCHOOL_DIARY_SYNC_URL","SCHOOL_PUBLIC_ORIGIN","TOCHKA_AUTOSYNC_ACTIVATION_ID","TOCHKA_AUTOSYNC_ENABLED","YARN_VERSION"]'
docker inspect "$live_id" | jq -e --argjson expected "$expected_env_names" \
  '([.[0].Config.Env[] | split("=")[0]] | sort) == $expected' >/dev/null
for pair in \
  NODE_ENV=production PORT=8081 ARTHELLO_D1_PATH=/data/d1 \
  ARTHELLO_PUBLIC_ORIGIN="$central_origin" ARTHELLO_BOOTSTRAP_LOGIN=owner \
  ARTHELLO_BOOTSTRAP_PASSWORD_FILE=/run/secrets/bootstrap-password \
  INTEGRATION_CREDENTIALS_KEY_FILE=/run/secrets/integration-credentials-key \
  SCHOOL_PUBLIC_ORIGIN="$school_origin" SCHOOL_DIARY_SYNC_URL="$school_origin" \
  SCHOOL_DIARY_ALLOWED_ORIGINS="$school_origin" \
  CENTRAL_ACCESS_SECRET_FILE=/run/secrets/central-access-secret \
  OPENAI_OCR_MODEL=gpt-4.1-mini NODE_EXTRA_CA_CERTS=/app/production/russian-trusted-root-ca.pem \
  RELEASE_SHA="$expected_central_release" TOCHKA_AUTOSYNC_ENABLED=1; do
  grep -Fx "$pair" <<<"$configured" >/dev/null
done
autosync_id="$(sed -n 's/^TOCHKA_AUTOSYNC_ACTIVATION_ID=//p' <<<"$configured")"
[[ "$autosync_id" =~ ^[a-f0-9]{64}$ ]]

for file in "$integration_key" "$bootstrap_key" "$central_key"; do
  test -f "$file" && test ! -L "$file" && test -s "$file"
done
for spec in \
  "$integration_key:/run/secrets/integration-credentials-key" \
  "$bootstrap_key:/run/secrets/bootstrap-password" \
  "$central_key:/run/secrets/central-access-secret"; do
  source=${spec%%:*}; destination=${spec#*:}
  docker inspect "$live_id" | jq -e --arg source "$source" --arg destination "$destination" '
    [.[0].Mounts[] | select(.Type == "bind" and .Source == $source and .Destination == $destination and .RW == false)] | length == 1
  ' >/dev/null
done

test ! -L "$secret_dir"
install -d -m 0700 "$secret_dir"
for secret in "$atlas_key" "$atlas_pepper"; do
  if [ ! -e "$secret" ]; then
    temporary="$(mktemp "$secret_dir/.atlas-secret.XXXXXXXX")"
    python3 -I -c 'import secrets,sys; open(sys.argv[1],"w",encoding="ascii").write(secrets.token_hex(32))' "$temporary"
    chmod 0444 "$temporary"
    mv -- "$temporary" "$secret"
    sync -d "$secret_dir"
  fi
  test -f "$secret" && test ! -L "$secret" && test "$(stat -c '%a' "$secret")" = 444
  test "$(wc -c < "$secret")" -ge 64
done
! cmp -s "$atlas_key" "$central_key"

for resource in "$atlas_service" "$atlas_data" "$atlas_backups"; do
  ! docker inspect "$resource" >/dev/null 2>&1
done
(cd "$ATLAS_BUNDLE_DIR" && sha256sum --check checksums.sha256)
atlas_archive_sha="$(sha256sum "$ATLAS_BUNDLE_DIR/atlas-image.tar.gz" | cut -d ' ' -f 1)"
[[ "$atlas_archive_sha" =~ ^[a-f0-9]{64}$ ]]
test "$(jq -er '.sourceSha' "$ATLAS_BUNDLE_DIR/receipt.json")" = "$ATLAS_SOURCE_SHA"
test "$(jq -er '.sourceTree' "$ATLAS_BUNDLE_DIR/receipt.json")" = "$ATLAS_SOURCE_TREE"
atlas_image="$(jq -er '.imageId' "$ATLAS_BUNDLE_DIR/receipt.json")"
[[ "$atlas_image" =~ ^sha256:[a-f0-9]{64}$ ]]
atlas_image_ref="atlas-diary:$ATLAS_SOURCE_SHA"
if docker image inspect "$atlas_image_ref" >/dev/null 2>&1; then
  stale_users="$(docker ps -aq --filter "ancestor=$atlas_image_ref")"
  test -z "$stale_users"
  docker image rm "$atlas_image_ref" >/dev/null
fi
docker load --input "$ATLAS_BUNDLE_DIR/atlas-image.tar.gz" >/dev/null
loaded_atlas_image="$(docker image inspect "$atlas_image_ref" --format '{{.Id}}')"
[[ "$loaded_atlas_image" =~ ^sha256:[a-f0-9]{64}$ ]]
loaded_atlas_revision="$(docker image inspect "$atlas_image_ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
if [ "$loaded_atlas_revision" != "$ATLAS_SOURCE_SHA" ]; then
  printf 'Atlas image revision mismatch: expected=%s loaded=%s\n' "$ATLAS_SOURCE_SHA" "$loaded_atlas_revision" >&2
  exit 1
fi
loaded_atlas_tree="$(docker image inspect "$atlas_image_ref" --format '{{index .Config.Labels "org.opencontainers.image.source-tree"}}')"
if [ "$loaded_atlas_tree" != "$ATLAS_SOURCE_TREE" ]; then
  printf 'Atlas image source-tree mismatch: expected=%s loaded=%s\n' "$ATLAS_SOURCE_TREE" "$loaded_atlas_tree" >&2
  exit 1
fi

{
  printf 'NODE_ENV=production\nPORT=8081\nARTHELLO_D1_PATH=/data/d1\n'
  printf 'ARTHELLO_PUBLIC_ORIGIN=%s\nARTHELLO_BOOTSTRAP_LOGIN=owner\n' "$central_origin"
  printf 'ARTHELLO_BOOTSTRAP_PASSWORD_FILE=/run/secrets/bootstrap-password\n'
  printf 'INTEGRATION_CREDENTIALS_KEY_FILE=/run/secrets/integration-credentials-key\n'
  printf 'SCHOOL_PUBLIC_ORIGIN=%s\nSCHOOL_DIARY_SYNC_URL=%s\nSCHOOL_DIARY_ALLOWED_ORIGINS=%s\n' "$school_origin" "$school_origin" "$school_origin"
  printf 'CENTRAL_ACCESS_SECRET_FILE=/run/secrets/central-access-secret\n'
  printf 'ATLAS_PUBLIC_ORIGIN=%s\nATLAS_CENTRAL_ACCESS_SECRET_FILE=/run/secrets/atlas-central-access-secret\n' "$atlas_origin"
  printf 'OPENAI_OCR_MODEL=gpt-4.1-mini\nNODE_EXTRA_CA_CERTS=/app/production/russian-trusted-root-ca.pem\n'
  printf 'RELEASE_SHA=%s\nTOCHKA_AUTOSYNC_ENABLED=1\nTOCHKA_AUTOSYNC_ACTIVATION_ID=%s\n' "$expected_central_release" "$autosync_id"
} > "$runtime_env"
chmod 0600 "$runtime_env"
{
  printf 'PUBLIC_APP_ORIGIN=%s\nARTHELLO_PUBLIC_ORIGIN=%s\nDATABASE_PATH=/data/atlas-school.sqlite\n' "$atlas_origin" "$central_origin"
} > "$atlas_env"
chmod 0600 "$atlas_env"

docker cp "$caddy:/data/external-routes.caddy" "$routes_before"
docker cp "$caddy:/etc/caddy/Caddyfile" "$main_before"
! grep -F "$atlas_host" "$routes_before" "$main_before"
caddy_id="$(docker inspect "$caddy" --format '{{.Id}}')"
python3 -I .github/scripts/d083-maintenance-route.py observe-gateway \
  --input "$routes_before" --main-config "$main_before" \
  --gateway-env-evidence "$gateway_evidence" --gateway-id "$caddy_id"
python3 -I -c 'import secrets,sys; open(sys.argv[1],"w").write(secrets.token_hex(32)+"\n")' "$nonce_file"
chmod 0600 "$nonce_file"
python3 -I .github/scripts/d083-maintenance-route.py render \
  --input "$routes_before" --main-config "$main_before" \
  --normal-output "$routes_central" --maintenance-output "$routes_maintenance" \
  --old-upstream "$expected_live_name:8081" --candidate-upstream "$candidate:8081" \
  --nonce-file "$nonce_file" --gateway-env-evidence "$gateway_evidence"
cp "$routes_central" "$routes_combined"
printf '\n%s {\n  encode gzip\n  reverse_proxy %s:3000\n}\n' "$atlas_host" "$atlas_service" >> "$routes_combined"
docker cp "$routes_before" "$caddy:$route_recovery"
docker cp "$routes_combined" "$caddy:$route_new"
docker exec "$caddy" sh -ceu "sed 's#/data/external-routes.caddy#$route_new#' /etc/caddy/Caddyfile > '$config_new'"
docker exec "$caddy" caddy validate --config "$config_new" --adapter caddyfile >/dev/null

docker volume create --label arthello.institution=atlas-school "$atlas_data" >/dev/null
docker volume create --label arthello.institution=atlas-school "$atlas_backups" >/dev/null
docker run -d --name "$atlas_service" --restart unless-stopped --network "$network" \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m,uid=1001,gid=1001 \
  --cap-drop ALL --security-opt no-new-privileges --memory 768m --pids-limit 128 \
  --env-file "$atlas_env" \
  --mount "type=bind,src=$atlas_key,dst=/run/secrets/atlas-central-access-secret,readonly" \
  --mount "type=bind,src=$atlas_pepper,dst=/run/secrets/atlas-passwordless-pepper,readonly" \
  -v "$atlas_data:/data" -v "$atlas_backups:/backups" \
  --label "org.opencontainers.image.revision=$ATLAS_SOURCE_SHA" --label arthello.institution=atlas-school \
  --entrypoint /bin/sh "$atlas_image_ref" -ceu '
    export CENTRAL_ACCESS_SECRET="$(cat /run/secrets/atlas-central-access-secret)"
    export PASSWORDLESS_PEPPER="$(cat /run/secrets/atlas-passwordless-pepper)"
    exec node server.js
  ' >/dev/null
atlas_created=1
rm -f -- "$atlas_env"
wait_health "$atlas_service" 3000
docker exec "$atlas_service" node --input-type=module -e "import {DatabaseSync,backup} from 'node:sqlite'; const db=new DatabaseSync('/data/atlas-school.sqlite'); if(db.prepare(\"SELECT institution_id FROM diary_identity WHERE id='primary'\").get()?.institution_id!=='atlas-school')throw Error('institution'); if(db.prepare('SELECT count(*) n FROM users').get().n!==0)throw Error('users'); await backup(db,'/backups/first-install.sqlite'); db.close();"

require_main
docker update --restart=no "$live_id" >/dev/null
docker stop --time 30 "$live_id" >/dev/null
old_stopped=1
docker run -d --name "$candidate" --restart no --read-only \
  --tmpfs /tmp --tmpfs /app/node_modules/.mf:rw,uid=1000,gid=1000,mode=0700 \
  --network "$network" --env-file "$runtime_env" \
  --mount "type=bind,src=$integration_key,dst=/run/secrets/integration-credentials-key,readonly" \
  --mount "type=bind,src=$bootstrap_key,dst=/run/secrets/bootstrap-password,readonly" \
  --mount "type=bind,src=$central_key,dst=/run/secrets/central-access-secret,readonly" \
  --mount "type=bind,src=$atlas_key,dst=/run/secrets/atlas-central-access-secret,readonly" \
  --mount "type=volume,src=$backup_control,dst=/var/lib/arthello-v52-backup-control,readonly,volume-nocopy" \
  --mount "type=volume,src=$bank_activation,dst=/var/lib/arthello-v52-tochka-activation,readonly,volume-nocopy" \
  -v "$central_data:/data" \
  --label "arthello.release.sha=$expected_central_release" \
  "$expected_central_image" >/dev/null
candidate_created=1
rm -f -- "$runtime_env"
wait_health "$candidate" 8081
test "$(docker exec "$candidate" node -e "fetch('http://127.0.0.1:8081/api/atlas-sso/open',{redirect:'manual'}).then(r=>{console.log(r.status);process.exit(r.status===303&&r.headers.get('location')==='$atlas_origin/auth/central/start'?0:1)}).catch(()=>process.exit(1))")" = 303

require_main
before_sha="$(sha256sum "$routes_before" | cut -d ' ' -f 1)"
docker exec -e EXPECTED_SHA="$before_sha" -e NEW_ROUTE="$route_new" "$caddy" sh -ceu '
  test "$(sha256sum /data/external-routes.caddy | cut -d " " -f 1)" = "$EXPECTED_SHA"
  mv "$NEW_ROUTE" /data/external-routes.caddy
'
route_changed=1
docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
curl -fsS --retry 5 --retry-delay 2 --max-time 20 "$central_origin/api/health" | jq -e '.status == "ok" and .database == "available"' >/dev/null
curl -fsS --retry 5 --retry-delay 2 --max-time 20 "$school_origin/api/health" | jq -e '.status == "ok"' >/dev/null
curl -fsS --retry 5 --retry-delay 2 --max-time 20 "$atlas_origin/api/health" | jq -e '.status == "ok"' >/dev/null
open_headers="$work/atlas-open.headers"
open_status="$(curl --silent --show-error --max-time 20 --output /dev/null --dump-header "$open_headers" --write-out '%{http_code}' "$central_origin/api/atlas-sso/open")"
test "$open_status" = 303
tr -d '\r' < "$open_headers" | grep -Fxi "location: $atlas_origin/auth/central/start" >/dev/null
docker update --restart=unless-stopped "$candidate" >/dev/null
test "$(docker inspect "$candidate" --format '{{.State.Running}}')" = true
test "$(docker inspect "$atlas_service" --format '{{.State.Running}}')" = true
require_main
release_active=1
jq -n --arg controller "$CONTROLLER_SHA" --arg atlasSource "$ATLAS_SOURCE_SHA" \
  --arg atlasSourceTree "$ATLAS_SOURCE_TREE" --arg atlasArchiveSha256 "$atlas_archive_sha" \
  --arg atlasBuilderImageId "$atlas_image" --arg atlasGatewayImageId "$loaded_atlas_image" \
  --arg centralContainer "$(docker inspect "$candidate" --format '{{.Id}}')" \
  --arg atlasContainer "$(docker inspect "$atlas_service" --format '{{.Id}}')" \
  --arg url "$atlas_origin" \
  '{schemaVersion:1,kind:"atlas-d122-production-receipt",controllerSha:$controller,atlasSourceSha:$atlasSource,atlasSourceTree:$atlasSourceTree,atlasArchiveSha256:$atlasArchiveSha256,atlasBuilderImageId:$atlasBuilderImageId,atlasGatewayImageId:$atlasGatewayImageId,centralContainerId:$centralContainer,atlasContainerId:$atlasContainer,publicUrl:$url,centralHealth:true,schoolHealth:true,atlasHealth:true,centralSsoOpen:true,naturalBrowserAcceptance:false}' \
  | tee "$ATLAS_BUNDLE_DIR/production-receipt.json"
echo "ATLAS_PUBLIC_URL=$atlas_origin"
echo 'ATLAS_D122_HEALTHY: natural staff and mobile acceptance remain required.'
