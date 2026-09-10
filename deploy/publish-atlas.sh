#!/usr/bin/env bash
# First installation only. Never alters the existing ArtHello or 1–11 containers.
set -Eeuo pipefail
: "${GITHUB_SHA:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_TOKEN:?}" "${ATLAS_BUNDLE_DIR:?}"
test "$GITHUB_REPOSITORY" = vitaliyozolin-dotcom/ArtHello-OS
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
central_origin=https://arthello-188-225-38-55.sslip.io
atlas_origin=https://atlas-188-225-38-55.sslip.io
atlas_host=atlas-188-225-38-55.sslip.io
caddy=stroios-caddy-1
service=atlas-school-diary
volume=atlas-school-diary-data
backup_volume=atlas-school-diary-backups
secret_root="$HOME/.config/arthello"
key_file="$secret_root/atlas-central-access-secret"
pepper_file="$secret_root/atlas-passwordless-pepper"
work="$(mktemp -d "${RUNNER_TEMP:?}/atlas-release.XXXXXX")"
chmod 0700 "$work"
trap 'rm -f -- "$work/runtime.env"' EXIT
require_source() {
  local current
  current="$(curl --fail --silent --show-error --max-time 15 -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/git/ref/heads/atlas/foundation" | jq -er '.object.sha')"
  test "$current" = "$GITHUB_SHA"
}
require_source
# A new diary cannot be published until the separately reviewed central release exists.
status="$(curl --silent --show-error --max-time 15 --output /dev/null --dump-header "$work/central.headers" --write-out '%{http_code}' "$central_origin/api/atlas-sso/open")"
if test "$status" != 303 || ! tr -d '\r' < "$work/central.headers" | grep -Fxi "location: $atlas_origin/auth/central/start" >/dev/null; then
  echo 'ATLAS_RELEASE_BLOCKED: Production ArtHello has not enabled the dedicated Atlas SSO origin.' >&2
  exit 78
fi
# Provision this distinct shared key during the central release; never reuse the School key.
test ! -L "$secret_root" && test ! -L "$key_file" && test -f "$key_file"
test "$(stat -c %a "$key_file")" = 600
test "$(stat -c %u "$key_file")" = "$(id -u)"
test "$(wc -c < "$key_file")" -ge 32
if test -f "$secret_root/central-access-secret" && cmp -s "$key_file" "$secret_root/central-access-secret"; then
  echo 'ATLAS_RELEASE_BLOCKED: Atlas requires a distinct synchronization key.' >&2; exit 78
fi
# Initial installation is deliberately non-destructive on retries or an existing diary.
! docker inspect "$service" >/dev/null 2>&1
! docker volume inspect "$volume" >/dev/null 2>&1
! docker volume inspect "$backup_volume" >/dev/null 2>&1
docker inspect "$caddy" --format '{{.State.Running}}' | grep -Fx true >/dev/null
networks="$(docker inspect "$caddy" | jq -r '.[0].NetworkSettings.Networks | keys[]')"
test "$(printf '%s\n' "$networks" | wc -l)" = 1
network="$networks"
test "$(df --output=avail -B1 /var/lib/docker | tail -1 | tr -d ' ')" -ge 4294967296
(cd "$ATLAS_BUNDLE_DIR" && sha256sum --check checksums.sha256)
test "$(jq -er .sourceSha "$ATLAS_BUNDLE_DIR/receipt.json")" = "$GITHUB_SHA"
image_id="$(jq -er .imageId "$ATLAS_BUNDLE_DIR/receipt.json")"
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
docker load --input "$ATLAS_BUNDLE_DIR/atlas-image.tar.gz" >/dev/null
test "$(docker image inspect "atlas-diary:$GITHUB_SHA" --format '{{.Id}}')" = "$image_id"
test "$(docker image inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$GITHUB_SHA"
docker cp "$caddy:/data/external-routes.caddy" "$work/routes.before"
docker cp "$caddy:/etc/caddy/Caddyfile" "$work/Caddyfile.before"
! grep -F "$atlas_host" "$work/routes.before" "$work/Caddyfile.before"
before_sha="$(sha256sum "$work/routes.before" | cut -d ' ' -f 1)"
cat "$work/routes.before" > "$work/routes.after"
printf '\n%s {\n  encode gzip\n  reverse_proxy %s:3000\n}\n' "$atlas_host" "$service" >> "$work/routes.after"
route_new="/data/external-routes.atlas-$GITHUB_RUN_ID.caddy"
config_new="/tmp/Caddyfile.atlas-$GITHUB_RUN_ID"
docker cp "$work/routes.after" "$caddy:$route_new"
docker exec "$caddy" sh -ceu "sed 's#/data/external-routes.caddy#$route_new#' /etc/caddy/Caddyfile > '$config_new'"
docker exec "$caddy" caddy validate --config "$config_new" --adapter caddyfile >/dev/null 2>&1
require_source
# Generate only the Atlas-local credential pepper. No staff or child records are seeded.
if ! test -e "$pepper_file"; then
  (umask 077; python3 -c 'import secrets; print(secrets.token_hex(32))' > "$pepper_file")
fi
test ! -L "$pepper_file" && test "$(stat -c %a "$pepper_file")" = 600
python3 - "$key_file" "$pepper_file" "$work/runtime.env" "$atlas_origin" "$central_origin" <<'PY'
import pathlib,sys,os
key,pepper,target,atlas,central=sys.argv[1:]
values={'CENTRAL_ACCESS_SECRET':pathlib.Path(key).read_text().strip(),'PASSWORDLESS_PEPPER':pathlib.Path(pepper).read_text().strip(),'PUBLIC_APP_ORIGIN':atlas,'ARTHELLO_PUBLIC_ORIGIN':central,'DATABASE_PATH':'/data/atlas-school.sqlite'}
assert all('\n' not in v and '\r' not in v for v in values.values())
assert len(values['CENTRAL_ACCESS_SECRET'])>=32 and len(values['PASSWORDLESS_PEPPER'])>=32
fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
PY
docker volume create --label arthello.institution=atlas-school "$volume" >/dev/null
docker volume create --label arthello.institution=atlas-school "$backup_volume" >/dev/null
# Mount propagation copies only the image's empty, correctly owned directories.
docker run -d --name "$service" --restart unless-stopped --network "$network" \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m,uid=1001,gid=1001 \
  --cap-drop ALL --security-opt no-new-privileges --memory 768m --pids-limit 128 \
  --env-file "$work/runtime.env" -v "$volume:/data" -v "$backup_volume:/backups" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" --label arthello.institution=atlas-school \
  "$image_id" >/dev/null
rm -- "$work/runtime.env"
ready=0
for attempt in $(seq 1 30); do
  if docker exec "$service" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1
# Keep an online-consistent SQLite backup before any public traffic.
docker exec "$service" node --input-type=module -e "import {DatabaseSync,backup} from 'node:sqlite'; const db=new DatabaseSync('/data/atlas-school.sqlite'); if(db.prepare(\"SELECT institution_id FROM diary_identity WHERE id='primary'\").get()?.institution_id!=='atlas-school')throw Error('institution'); await backup(db,'/backups/first-install.sqlite'); db.close();"
require_source
# Compare and swap the complete route file. All previously served sites remain byte-identical.
docker exec -e EXPECTED_SHA="$before_sha" -e NEW_ROUTE="$route_new" "$caddy" sh -ceu '
  test "$(sha256sum /data/external-routes.caddy | cut -d " " -f 1)" = "$EXPECTED_SHA"
  mv "$NEW_ROUTE" /data/external-routes.caddy
'
docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
# After publication retain the service/data on any failure; never restore a database automatically.
curl --retry 5 --retry-delay 3 --fail --silent --show-error --max-time 20 "$atlas_origin/api/health" > "$work/public-health.json"
container_id="$(docker inspect "$service" --format '{{.Id}}')"
jq --arg container "$container_id" --arg url "$atlas_origin" '. + {containerId:$container,publicUrl:$url,publicHealth:true,naturalBrowserAcceptance:false}' "$ATLAS_BUNDLE_DIR/receipt.json" > "$ATLAS_BUNDLE_DIR/production-receipt.json"
echo "ATLAS_PUBLIC_URL=$atlas_origin"
echo 'ATLAS_RELEASE_HEALTHY: Natural staff login acceptance remains required.'
