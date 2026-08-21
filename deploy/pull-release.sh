#!/usr/bin/env bash
set -Eeuo pipefail

release_sha="${1:-}"
arthello_host="${2:-:80}"
repository=vitaliyozolin-dotcom/ArtHello-OS
deploy_user=deploy-arthello
root_dir=/srv/arthello
env_file="$root_dir/shared/.env.production"
token_file="$root_dir/shared/github-https/token"
source_repo="$root_dir/shared/source.git"
release_dir="$root_dir/releases/$release_sha"
release_tag="arthello-ru-$release_sha"
api_root="https://api.github.com/repos/$repository"
temporary_dir=
curl_config=

cleanup() {
  if [ -n "$temporary_dir" ] && [ -d "$temporary_dir" ]; then
    rm -rf -- "$temporary_dir"
  fi
  if [ -n "$curl_config" ] && [ -f "$curl_config" ]; then
    rm -f -- "$curl_config"
  fi
}
trap cleanup EXIT

fail() {
  printf 'ARTHELLO_DEPLOY_ERROR=%s\n' "$1" >&2
  exit 1
}

compose() {
  ARTHELLO_HOST="$arthello_host" docker compose \
    --env-file "$env_file" -f compose.production.yml "$@"
}

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  fail run_as_root_in_timeweb_console
fi

printf '%s' "$release_sha" | grep -Eq '^[0-9a-f]{40}$' \
  || fail invalid_release_sha
id "$deploy_user" >/dev/null || fail deploy_user_missing
test -f "$root_dir/.bootstrap-phase1-complete" || fail server_bootstrap_incomplete
test -f "$env_file" || fail production_env_missing
test -s "$token_file" || fail github_token_missing

for command_name in curl docker git grep python3 runuser sha256sum tar; do
  command -v "$command_name" >/dev/null || fail "missing_command_$command_name"
done

if grep -Eq '^(ALFACRM_DOMAIN|ALFACRM_EMAIL|ALFACRM_API_KEY|BANK_CONFIG_ACTIVE_KEY_ID|BANK_CONFIG_ENCRYPTION_KEYS)=[^[:space:]]+' "$env_file"; then
  fail live_integration_secret_present
fi

temporary_dir="$(mktemp -d /tmp/arthello-release.XXXXXX)"
curl_config="$(mktemp /tmp/arthello-curl.XXXXXX)"
chmod 0600 "$curl_config"
{
  printf 'header = "Authorization: Bearer %s"\n' "$(cat "$token_file")"
  printf 'header = "X-GitHub-Api-Version: 2022-11-28"\n'
  printf 'proto = "=https"\n'
  printf 'tlsv1.2\n'
  printf 'silent\n'
  printf 'show-error\n'
  printf 'fail\n'
} > "$curl_config"

release_json="$temporary_dir/release.json"
curl --config "$curl_config" \
  --header 'Accept: application/vnd.github+json' \
  --output "$release_json" \
  "$api_root/releases/tags/$release_tag" \
  || fail github_release_lookup_failed

mapfile -t release_fields < <(python3 - "$release_json" "$release_sha" <<'PY'
import json
import sys

path, sha = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    release = json.load(handle)

expected = {
    f"arthello-ru-images-{sha}.tar.gz": "bundle",
    f"arthello-ru-images-{sha}.manifest": "manifest",
    f"arthello-ru-images-{sha}.sha256": "checksums",
    f"arthello-ru-pull-release-{sha}.sh": "script",
}
assets = {asset["name"]: asset for asset in release.get("assets", [])}
missing = sorted(set(expected) - set(assets))
if missing:
    raise SystemExit("missing release assets: " + ", ".join(missing))

print(release.get("tag_name", ""))
print(release.get("target_commitish", ""))
print(str(assets[f"arthello-ru-images-{sha}.tar.gz"]["id"]))
print(assets[f"arthello-ru-images-{sha}.tar.gz"].get("digest") or "")
print(str(assets[f"arthello-ru-images-{sha}.manifest"]["id"]))
print(str(assets[f"arthello-ru-images-{sha}.sha256"]["id"]))
print(str(assets[f"arthello-ru-pull-release-{sha}.sh"]["id"]))
PY
) || fail invalid_release_metadata

[ "${#release_fields[@]}" -eq 7 ] || fail invalid_release_metadata
[ "${release_fields[0]}" = "$release_tag" ] || fail release_tag_mismatch
[ "${release_fields[1]}" = "$release_sha" ] || fail release_target_mismatch
bundle_asset_id="${release_fields[2]}"
bundle_api_digest="${release_fields[3]}"
manifest_asset_id="${release_fields[4]}"
checksums_asset_id="${release_fields[5]}"
script_asset_id="${release_fields[6]}"

download_asset() {
  asset_id="$1"
  destination="$2"
  curl --config "$curl_config" \
    --location \
    --retry 3 \
    --retry-all-errors \
    --connect-timeout 20 \
    --max-time 1800 \
    --header 'Accept: application/octet-stream' \
    --output "$destination" \
    "$api_root/releases/assets/$asset_id"
}

bundle_name="arthello-ru-images-$release_sha.tar.gz"
manifest_name="arthello-ru-images-$release_sha.manifest"
checksums_name="arthello-ru-images-$release_sha.sha256"
script_name="arthello-ru-pull-release-$release_sha.sh"
download_asset "$bundle_asset_id" "$temporary_dir/$bundle_name" \
  || fail bundle_download_failed
download_asset "$manifest_asset_id" "$temporary_dir/$manifest_name" \
  || fail manifest_download_failed
download_asset "$checksums_asset_id" "$temporary_dir/$checksums_name" \
  || fail checksums_download_failed
download_asset "$script_asset_id" "$temporary_dir/$script_name" \
  || fail script_download_failed

(
  cd "$temporary_dir"
  sha256sum --check "$checksums_name"
) || fail release_checksum_failed

bundle_sha256="$(sha256sum "$temporary_dir/$bundle_name" | cut -d ' ' -f 1)"
if [ -n "$bundle_api_digest" ] && [ "$bundle_api_digest" != "sha256:$bundle_sha256" ]; then
  fail github_asset_digest_mismatch
fi

grep -Fx "repository=$repository" "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_repository_mismatch
grep -Fx "source_sha=$release_sha" "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_release_mismatch
grep -Fx 'real_data=not_loaded' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_real_data_boundary_missing
grep -Fx 'integrations=disabled' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_integration_boundary_missing
grep -Fx 'first_owner=not_created' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_owner_boundary_missing
grep -Fx 'dns=not_changed' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_dns_boundary_missing
bash -n "$temporary_dir/$script_name" || fail downloaded_script_invalid

if [ ! -d "$release_dir" ]; then
  test -d "$source_repo/objects" || fail source_repository_missing
  staging_dir="$(mktemp -d "$root_dir/releases/.${release_sha}.XXXXXX")"
  runuser -u "$deploy_user" -- git -C "$source_repo" archive "$release_sha" \
    | tar -x -C "$staging_dir"
  printf '%s\n' "$release_sha" > "$staging_dir/.arthello-release-sha"
  chown -R "$deploy_user:$deploy_user" "$staging_dir"
  mv "$staging_dir" "$release_dir"
fi

test -f "$release_dir/.arthello-release-sha" || fail existing_release_is_unverified
[ "$(cat "$release_dir/.arthello-release-sha")" = "$release_sha" ] \
  || fail existing_release_sha_mismatch
test -f "$release_dir/deploy/compose.production.yml" || fail production_compose_missing

previous_release="$(readlink -f "$root_dir/current" 2>/dev/null || true)"
old_api_container="$(docker ps -a \
  --filter label=com.docker.compose.project=arthello-os \
  --filter label=com.docker.compose.service=api -q | head -n 1)"
old_web_container="$(docker ps -a \
  --filter label=com.docker.compose.project=arthello-os \
  --filter label=com.docker.compose.service=web -q | head -n 1)"
old_api_image_id=
old_api_image_ref=
old_web_image_id=
old_web_image_ref=

if [ -n "$old_api_container" ]; then
  old_api_image_id="$(docker inspect -f '{{.Image}}' "$old_api_container")"
  old_api_image_ref="$(docker inspect -f '{{.Config.Image}}' "$old_api_container")"
fi
if [ -n "$old_web_container" ]; then
  old_web_image_id="$(docker inspect -f '{{.Image}}' "$old_web_container")"
  old_web_image_ref="$(docker inspect -f '{{.Config.Image}}' "$old_web_container")"
fi

docker image load --input "$temporary_dir/$bundle_name"

for image_name in "arthello-os-api:$release_sha" "arthello-os-web:$release_sha"; do
  docker image inspect "$image_name" >/dev/null || fail expected_image_missing
  image_revision="$(docker image inspect \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
    "$image_name")"
  [ "$image_revision" = "$release_sha" ] || fail image_revision_mismatch
done
docker image inspect postgres:16-alpine >/dev/null || fail postgres_image_missing

docker image tag "arthello-os-api:$release_sha" arthello-os-api:local
docker image tag "arthello-os-web:$release_sha" arthello-os-web:local

install -m 0444 "$temporary_dir/$manifest_name" "$release_dir/.arthello-image-manifest"
install -m 0444 "$temporary_dir/$checksums_name" "$release_dir/.arthello-image-checksums"
install -d -m 0750 -o "$deploy_user" -g "$deploy_user" "$root_dir/shared/bin"
install -m 0755 -o root -g root \
  "$temporary_dir/$script_name" "$root_dir/shared/bin/arthello-pull-release"

cd "$release_dir/deploy"
compose up -d --no-build --pull never --remove-orphans

healthy=0
for _ in $(seq 1 36); do
  if curl --fail --silent --show-error http://127.0.0.1/api/healthz >/dev/null; then
    healthy=1
    break
  fi
  sleep 5
done

if [ "$healthy" -ne 1 ]; then
  compose ps >&2 || true
  if [ -n "$previous_release" ] \
    && [ -f "$previous_release/deploy/compose.production.yml" ] \
    && [ -n "$old_api_image_id" ] && [ -n "$old_api_image_ref" ] \
    && [ -n "$old_web_image_id" ] && [ -n "$old_web_image_ref" ]; then
    docker image tag "$old_api_image_id" "$old_api_image_ref"
    docker image tag "$old_web_image_id" "$old_web_image_ref"
    cd "$previous_release/deploy"
    compose up -d --no-build --pull never --force-recreate
    fail health_check_failed_rollback_restored
  fi
  compose down --remove-orphans || true
  fail health_check_failed_candidate_stopped
fi

ln -sfn "$release_dir" "$root_dir/current"

printf 'ARTHELLO_DEPLOY_SHA=%s\n' "$release_sha"
printf 'ARTHELLO_DEPLOY_SOURCE=private_github_release\n'
printf 'ARTHELLO_HEALTH=OK\n'
printf 'ARTHELLO_REAL_DATA=NOT_LOADED\n'
printf 'ARTHELLO_INTEGRATIONS=DISABLED\n'
printf 'ARTHELLO_FIRST_OWNER=NOT_CREATED\n'
printf 'ARTHELLO_DNS=NOT_CHANGED\n'
compose ps
