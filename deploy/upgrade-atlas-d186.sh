#!/usr/bin/env bash
# D186: replace only the Atlas application image while preserving its database volume.
# Image identity is proved with a portable runtime fingerprint because daemon-local
# Docker image IDs can be rewritten across image stores.
set -Eeuo pipefail
umask 077

: "${CONTROLLER_SHA:?}" "${ATLAS_SOURCE_SHA:?}" "${ATLAS_SOURCE_TREE:?}"
: "${ATLAS_BUNDLE_DIR:?}" "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
test "$GITHUB_REPOSITORY" = vitaliyozolin-dotcom/ArtHello-OS
test "$ATLAS_SOURCE_SHA" = f856fb3bd098152bb6b02c4d0273c4c9170b130c
test "$ATLAS_SOURCE_TREE" = e63e28520670527bc12d84abcd45cd8fffe2b876
[[ "$CONTROLLER_SHA" =~ ^[a-f0-9]{40}$ ]]

controller_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service=atlas-school-diary
data_volume=atlas-school-diary-data
backups_volume=atlas-school-diary-backups
network=stroios_default
source_before=987abd5951dc4832e2c071d8744051c518bae42e
image_tag="atlas-diary:$ATLAS_SOURCE_SHA"
secret_dir="$HOME/.config/arthello"
central_secret="$secret_dir/atlas-central-access-secret"
pepper_secret="$secret_dir/atlas-passwordless-pepper"
atlas_origin=https://atlas-188-225-38-55.sslip.io
central_origin=https://arthello-188-225-38-55.sslip.io
rollback_name="${service}-d186-rollback-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
backup_name="pre-d186-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.sqlite"
backup_helper="$controller_root/deploy/atlas-offline-backup-d186.mjs"
new_created=0
old_renamed=0
old_stopped=0
release_active=0

restore() {
  local status=$?
  set +e
  if [ "$status" -ne 0 ] && [ "$release_active" -eq 0 ]; then
    printf 'ATLAS_ROLLBACK=STARTED\n' >&2
    if [ "$new_created" -eq 1 ]; then docker rm -f "$service" >/dev/null 2>&1; fi
    if [ "$old_renamed" -eq 1 ]; then
      docker rename "$rollback_name" "$service" >/dev/null 2>&1
      docker start "$service" >/dev/null 2>&1
    elif [ "$old_stopped" -eq 1 ]; then
      docker start "$service" >/dev/null 2>&1
    fi
  fi
  exit "$status"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

current="$(curl --fail --silent --show-error --max-time 20 \
  -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$GITHUB_REPOSITORY/git/ref/heads/main" | jq -er '.object.sha')"
test "$current" = "$CONTROLLER_SHA"
test "$(hostname -I | tr ' ' '\n' | grep -Fx '188.225.38.55' | head -n1)" = 188.225.38.55

for secret in "$central_secret" "$pepper_secret"; do
  test -f "$secret" && test ! -L "$secret" && test -s "$secret"
done
test "$(docker volume inspect "$data_volume" --format '{{index .Labels "arthello.institution"}}')" = atlas-school
test "$(docker volume inspect "$backups_volume" --format '{{index .Labels "arthello.institution"}}')" = atlas-school
test "$(docker inspect "$service" --format '{{.State.Running}}')" = true
test "$(docker inspect "$service" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$data_volume"
test "$(docker inspect "$service" --format '{{range .Mounts}}{{if eq .Destination "/backups"}}{{.Name}}{{end}}{{end}}')" = "$backups_volume"

(cd "$ATLAS_BUNDLE_DIR" && sha256sum --check checksums.sha256)
archive_sha="$(sha256sum "$ATLAS_BUNDLE_DIR/atlas-image.tar.gz" | cut -d ' ' -f 1)"
[[ "$archive_sha" =~ ^[a-f0-9]{64}$ ]]
test "$(jq -er '.sourceSha' "$ATLAS_BUNDLE_DIR/receipt.json")" = "$ATLAS_SOURCE_SHA"
test "$(jq -er '.sourceTree' "$ATLAS_BUNDLE_DIR/receipt.json")" = "$ATLAS_SOURCE_TREE"
builder_image_id="$(jq -er '.imageId' "$ATLAS_BUNDLE_DIR/receipt.json")"
expected_runtime_fingerprint="$(jq -er '.runtimeFingerprintSha256' "$ATLAS_BUNDLE_DIR/receipt.json")"
[[ "$builder_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$expected_runtime_fingerprint" =~ ^[a-f0-9]{64}$ ]]
test -s "$controller_root/deploy/v52/maintenance/image-runtime-fingerprint.jq"

runtime_fingerprint() {
  docker image inspect "$1" \
    | jq -cS -f "$controller_root/deploy/v52/maintenance/image-runtime-fingerprint.jq" \
    | sha256sum \
    | cut -d ' ' -f 1
}

live_source="$(docker inspect "$service" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
if [ "$live_source" = "$ATLAS_SOURCE_SHA" ]; then
  gateway_image_id="$(docker inspect "$service" --format '{{.Image}}')"
  [[ "$gateway_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
  gateway_runtime_fingerprint="$(runtime_fingerprint "$gateway_image_id")"
  test "$gateway_runtime_fingerprint" = "$expected_runtime_fingerprint"
  test "$(docker image inspect "$gateway_image_id" --format '{{index .Config.Labels "org.opencontainers.image.source-tree"}}')" = "$ATLAS_SOURCE_TREE"
  curl -fsS --max-time 20 "$atlas_origin/api/health" | jq -e '.status == "ok"' >/dev/null
  jq -n --arg controller "$CONTROLLER_SHA" --arg source "$ATLAS_SOURCE_SHA" --arg tree "$ATLAS_SOURCE_TREE" \
    --arg archive "$archive_sha" --arg builderImage "$builder_image_id" --arg gatewayImage "$gateway_image_id" \
    --arg runtimeFingerprint "$gateway_runtime_fingerprint" \
    '{schemaVersion:1,kind:"atlas-ui-release",controllerSha:$controller,sourceSha:$source,sourceTree:$tree,status:"already-active",dataVolumePreserved:true,archiveSha256:$archive,builderImageId:$builderImage,gatewayImageId:$gatewayImage,runtimeFingerprintSha256:$runtimeFingerprint}' \
    > "$ATLAS_BUNDLE_DIR/atlas-d186-production-receipt.json"
  printf 'ATLAS_IMAGE_ID_REPRESENTATION builder=%s gateway=%s\n' "$builder_image_id" "$gateway_image_id"
  printf 'ATLAS_IMAGE_RUNTIME_FINGERPRINT=VERIFIED sha256=%s\n' "$gateway_runtime_fingerprint"
  printf 'ATLAS_DATA_VOLUME=PRESERVED\nATLAS_UPGRADE=SUCCESS\n'
  release_active=1
  exit 0
fi
test "$live_source" = "$source_before"

if docker image inspect "$image_tag" >/dev/null 2>&1; then
  stale_users="$(docker ps -aq --filter "ancestor=$image_tag")"
  test -z "$stale_users"
  docker image rm "$image_tag" >/dev/null
fi
load_log="$ATLAS_BUNDLE_DIR/docker-load.log"
if ! docker image load --input "$ATLAS_BUNDLE_DIR/atlas-image.tar.gz" >"$load_log" 2>&1; then
  sed -n '1,160p' "$load_log" >&2
  printf '::error::Docker rejected the verified Atlas image archive before production cutover\n' >&2
  exit 1
fi
sed -n '1,80p' "$load_log"
gateway_image_id="$(docker image inspect "$image_tag" --format '{{.Id}}')"
[[ "$gateway_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
gateway_runtime_fingerprint="$(runtime_fingerprint "$gateway_image_id")"
if [ "$gateway_runtime_fingerprint" != "$expected_runtime_fingerprint" ]; then
  printf '::error::Imported Atlas runtime fingerprint does not match hosted evidence\n' >&2
  exit 1
fi
test "$(docker image inspect "$gateway_image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$ATLAS_SOURCE_SHA"
test "$(docker image inspect "$gateway_image_id" --format '{{index .Config.Labels "org.opencontainers.image.source-tree"}}')" = "$ATLAS_SOURCE_TREE"
printf 'ATLAS_IMAGE_ID_REPRESENTATION builder=%s gateway=%s\n' "$builder_image_id" "$gateway_image_id"
printf 'ATLAS_IMAGE_RUNTIME_FINGERPRINT=VERIFIED sha256=%s\n' "$gateway_runtime_fingerprint"
image_ref="$gateway_image_id"

# Stop first so the main database and its WAL are a stable offline snapshot.
docker stop --time 30 "$service" >/dev/null
old_stopped=1
test "$(docker inspect "$service" --format '{{.State.Running}}')" = false
test -f "$backup_helper" && test ! -L "$backup_helper"
backup_result="$(docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges:true \
  --tmpfs /work:rw,nosuid,nodev,noexec,size=512m \
  --volume "$data_volume:/data:ro" --volume "$backups_volume:/backups" \
  --mount "type=bind,src=$backup_helper,dst=/run/atlas-offline-backup-d186.mjs,readonly" \
  --entrypoint node "$image_ref" /run/atlas-offline-backup-d186.mjs \
  /data/atlas-school.sqlite /work/atlas-school.sqlite "/backups/$backup_name")"
case "$backup_result" in
  'ATLAS_OFFLINE_BACKUP=VERIFIED wal=included') backup_wal_included=true ;;
  'ATLAS_OFFLINE_BACKUP=VERIFIED wal=absent') backup_wal_included=false ;;
  *) exit 1 ;;
esac
printf '%s\n' "$backup_result"
docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,nosuid,nodev,size=32m --volume "$backups_volume:/backups:ro" \
  --env BACKUP_PATH="/backups/$backup_name" --entrypoint node "$image_ref" --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.env.BACKUP_PATH, { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    const journalMode = db.prepare("PRAGMA journal_mode").get()?.journal_mode;
    db.close();
    if (integrity !== "ok" || journalMode !== "delete") process.exit(1);
  '
backup_sha="$(docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges:true \
  --volume "$backups_volume:/backups:ro" --entrypoint sha256sum "$image_ref" "/backups/$backup_name" | cut -d ' ' -f 1)"
[[ "$backup_sha" =~ ^[a-f0-9]{64}$ ]]
printf 'ATLAS_BACKUP=VERIFIED\n'

docker rename "$service" "$rollback_name"
old_renamed=1
docker run -d --name "$service" --restart unless-stopped --network "$network" \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m,uid=1001,gid=1001 \
  --cap-drop ALL --security-opt no-new-privileges --memory 768m --pids-limit 128 \
  -e PUBLIC_APP_ORIGIN="$atlas_origin" -e ARTHELLO_PUBLIC_ORIGIN="$central_origin" \
  -e DATABASE_PATH=/data/atlas-school.sqlite \
  --mount "type=bind,src=$central_secret,dst=/run/secrets/atlas-central-access-secret,readonly" \
  --mount "type=bind,src=$pepper_secret,dst=/run/secrets/atlas-passwordless-pepper,readonly" \
  -v "$data_volume:/data" -v "$backups_volume:/backups" \
  --label "org.opencontainers.image.revision=$ATLAS_SOURCE_SHA" \
  --label "org.opencontainers.image.source-tree=$ATLAS_SOURCE_TREE" \
  --label arthello.institution=atlas-school \
  --entrypoint /bin/sh "$image_ref" -ceu '
    export CENTRAL_ACCESS_SECRET="$(cat /run/secrets/atlas-central-access-secret)"
    export PASSWORDLESS_PEPPER="$(cat /run/secrets/atlas-passwordless-pepper)"
    exec node server.js
  ' >/dev/null
new_created=1

ready=0
for _ in $(seq 1 60); do
  if docker exec "$service" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1
test "$(docker inspect "$service" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')" = "$data_volume"
curl -fsS --max-time 20 "$atlas_origin/api/health" | jq -e '.status == "ok"' >/dev/null

release_active=1
printf 'ATLAS_DATA_VOLUME=PRESERVED\nATLAS_ROLLBACK=RETAINED_UNTIL_SSO\nATLAS_UPGRADE=SUCCESS\n'
jq -n --arg controller "$CONTROLLER_SHA" --arg source "$ATLAS_SOURCE_SHA" --arg tree "$ATLAS_SOURCE_TREE" \
  --arg archive "$archive_sha" --arg builderImage "$builder_image_id" --arg gatewayImage "$gateway_image_id" \
  --arg runtimeFingerprint "$gateway_runtime_fingerprint" \
  --arg backup "$backup_name" --arg backupSha "$backup_sha" --arg rollback "$rollback_name" \
  --argjson backupWalIncluded "$backup_wal_included" \
  '{schemaVersion:1,kind:"atlas-ui-release",controllerSha:$controller,sourceSha:$source,sourceTree:$tree,status:"pending-sso-acceptance",dataVolumePreserved:true,archiveSha256:$archive,builderImageId:$builderImage,gatewayImageId:$gatewayImage,runtimeFingerprintSha256:$runtimeFingerprint,rollbackContainer:$rollback,backup:{file:$backup,sha256:$backupSha,integrity:"ok",journalMode:"delete",walIncluded:$backupWalIncluded}}' \
  > "$ATLAS_BUNDLE_DIR/atlas-d186-production-receipt.json"
