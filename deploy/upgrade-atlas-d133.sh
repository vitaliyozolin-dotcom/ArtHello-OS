#!/usr/bin/env bash
# D133: replace only the Atlas application image while preserving its database volume.
set -Eeuo pipefail
umask 077

: "${CONTROLLER_SHA:?}" "${ATLAS_SOURCE_SHA:?}" "${ATLAS_SOURCE_TREE:?}"
: "${ATLAS_BUNDLE_DIR:?}" "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
test "$GITHUB_REPOSITORY" = vitaliyozolin-dotcom/ArtHello-OS
test "$ATLAS_SOURCE_SHA" = f856fb3bd098152bb6b02c4d0273c4c9170b130c
test "$ATLAS_SOURCE_TREE" = e63e28520670527bc12d84abcd45cd8fffe2b876
[[ "$CONTROLLER_SHA" =~ ^[a-f0-9]{40}$ ]]

service=atlas-school-diary
data_volume=atlas-school-diary-data
backups_volume=atlas-school-diary-backups
network=stroios_default
source_before=987abd5951dc4832e2c071d8744051c518bae42e
image_ref="atlas-diary:$ATLAS_SOURCE_SHA"
secret_dir="$HOME/.config/arthello"
central_secret="$secret_dir/atlas-central-access-secret"
pepper_secret="$secret_dir/atlas-passwordless-pepper"
atlas_origin=https://atlas-188-225-38-55.sslip.io
central_origin=https://arthello-188-225-38-55.sslip.io
rollback_name="${service}-d133-rollback-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
backup_name="pre-d133-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.sqlite"
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

live_source="$(docker inspect "$service" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
if [ "$live_source" = "$ATLAS_SOURCE_SHA" ]; then
  curl -fsS --max-time 20 "$atlas_origin/api/health" | jq -e '.status == "ok"' >/dev/null
  jq -n --arg controller "$CONTROLLER_SHA" --arg source "$ATLAS_SOURCE_SHA" \
    '{schemaVersion:1,kind:"atlas-ui-release",controllerSha:$controller,sourceSha:$source,status:"already-active",dataVolumePreserved:true}' \
    > "$ATLAS_BUNDLE_DIR/atlas-d133-production-receipt.json"
  printf 'ATLAS_DATA_VOLUME=PRESERVED\nATLAS_UPGRADE=SUCCESS\n'
  release_active=1
  exit 0
fi
test "$live_source" = "$source_before"

(cd "$ATLAS_BUNDLE_DIR" && sha256sum --check checksums.sha256)
test "$(jq -er '.sourceSha' "$ATLAS_BUNDLE_DIR/receipt.json")" = "$ATLAS_SOURCE_SHA"
test "$(jq -er '.sourceTree' "$ATLAS_BUNDLE_DIR/receipt.json")" = "$ATLAS_SOURCE_TREE"
expected_image="$(jq -er '.imageId' "$ATLAS_BUNDLE_DIR/receipt.json")"
[[ "$expected_image" =~ ^sha256:[a-f0-9]{64}$ ]]
docker load --input "$ATLAS_BUNDLE_DIR/atlas-image.tar.gz" >/dev/null
test "$(docker image inspect "$image_ref" --format '{{.Id}}')" = "$expected_image"
test "$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$ATLAS_SOURCE_SHA"
test "$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.source-tree"}}')" = "$ATLAS_SOURCE_TREE"

# Stop first so the plain SQLite copy is transactionally stable.
docker stop --time 30 "$service" >/dev/null
old_stopped=1
test "$(docker inspect "$service" --format '{{.State.Running}}')" = false
docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges:true \
  --volume "$data_volume:/data:ro" --volume "$backups_volume:/backups" \
  --env BACKUP_NAME="$backup_name" --entrypoint /bin/sh "$image_ref" -ceu '
    test -s /data/atlas-school.sqlite
    test ! -e "/backups/$BACKUP_NAME"
    cp /data/atlas-school.sqlite "/backups/$BACKUP_NAME"
    chmod 0444 "/backups/$BACKUP_NAME"
    sync
  '
docker run --rm --network none --read-only --user 1001:1001 --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,nosuid,nodev,size=32m --volume "$backups_volume:/backups:ro" \
  --env BACKUP_PATH="/backups/$backup_name" --entrypoint node "$image_ref" --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.env.BACKUP_PATH, { readOnly: true });
    const result = db.prepare("PRAGMA integrity_check").get();
    db.close();
    if (result.integrity_check !== "ok") process.exit(1);
  '
backup_sha="$(docker run --rm --network none --read-only --volume "$backups_volume:/backups:ro" --entrypoint sha256sum "$image_ref" "/backups/$backup_name" | cut -d ' ' -f 1)"
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
  --arg backup "$backup_name" --arg backupSha "$backup_sha" --arg rollback "$rollback_name" \
  '{schemaVersion:1,kind:"atlas-ui-release",controllerSha:$controller,sourceSha:$source,sourceTree:$tree,status:"pending-sso-acceptance",dataVolumePreserved:true,rollbackContainer:$rollback,backup:{file:$backup,sha256:$backupSha,integrity:"ok"}}' \
  > "$ATLAS_BUNDLE_DIR/atlas-d133-production-receipt.json"
