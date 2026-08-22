#!/usr/bin/env bash
set -Eeuo pipefail

release_sha="${1:-}"
arthello_host="${2:-:80}"
transport_ref="${3:-refs/remotes/origin/transport/arthello-ru-${release_sha}}"

deploy_user=deploy-arthello
root_dir=/srv/arthello
env_file="$root_dir/shared/.env.production"
source_repo="$root_dir/shared/source.git"
release_dir="$root_dir/releases/$release_sha"
transport_path=".arthello-transport/$release_sha"
temporary_dir=
staging_dir=

cleanup() {
  if [ -n "$temporary_dir" ] && [ -d "$temporary_dir" ]; then
    rm -rf -- "$temporary_dir"
  fi
  if [ -n "$staging_dir" ] && [ -d "$staging_dir" ]; then
    rm -rf -- "$staging_dir"
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
case "$transport_ref" in
  refs/remotes/origin/transport/arthello-ru-"$release_sha" | \
  refs/remotes/origin/transport/arthello-ru-"$release_sha"-*) ;;
  *) fail unexpected_transport_ref ;;
esac
transport_branch="${transport_ref#refs/remotes/origin/}"

id "$deploy_user" >/dev/null || fail deploy_user_missing
test -f "$root_dir/.bootstrap-phase1-complete" || fail server_bootstrap_incomplete
test -f "$env_file" || fail production_env_missing
test -d "$source_repo/objects" || fail source_repository_missing

for command_name in curl docker git grep runuser sha256sum tar; do
  command -v "$command_name" >/dev/null || fail "missing_command_$command_name"
done

if grep -Eq '^(ALFACRM_DOMAIN|ALFACRM_EMAIL|ALFACRM_API_KEY|BANK_CONFIG_ACTIVE_KEY_ID|BANK_CONFIG_ENCRYPTION_KEYS)=[^[:space:]]+' "$env_file"; then
  fail live_integration_secret_present
fi

transport_commit="$(runuser -u "$deploy_user" -- \
  git -C "$source_repo" rev-parse "$transport_ref^{commit}")" \
  || fail transport_ref_missing
printf '%s' "$transport_commit" | grep -Eq '^[0-9a-f]{40}$' \
  || fail invalid_transport_commit

temporary_dir="$(mktemp -d /tmp/arthello-git-transport.XXXXXX)"
runuser -u "$deploy_user" -- git -C "$source_repo" archive \
  "$transport_ref" "$transport_path" | tar -x -C "$temporary_dir" \
  || fail transport_extract_failed

payload_dir="$temporary_dir/$transport_path"
test -d "$payload_dir" || fail transport_payload_missing

transport_manifest="$payload_dir/transport.manifest"
transport_checksums="$payload_dir/transport.sha256"
test -f "$transport_manifest" || fail transport_manifest_missing
test -f "$transport_checksums" || fail transport_checksums_missing

grep -Fx "repository=vitaliyozolin-dotcom/ArtHello-OS" "$transport_manifest" >/dev/null \
  || fail transport_repository_mismatch
grep -Fx "application_sha=$release_sha" "$transport_manifest" >/dev/null \
  || fail transport_release_mismatch
grep -Fx "transport_branch=$transport_branch" "$transport_manifest" >/dev/null \
  || fail transport_branch_mismatch
runtime_infrastructure_sha="$(sed -n 's/^runtime_infrastructure_sha=//p' "$transport_manifest")"
printf '%s' "$runtime_infrastructure_sha" | grep -Eq '^[0-9a-f]{40}$' \
  || fail runtime_infrastructure_sha_missing
grep -Fx 'transport=git_chunks' "$transport_manifest" >/dev/null \
  || fail transport_type_mismatch
grep -Fx 'real_data=not_loaded' "$transport_manifest" >/dev/null \
  || fail transport_real_data_boundary_missing
grep -Fx 'integrations=disabled' "$transport_manifest" >/dev/null \
  || fail transport_integration_boundary_missing
grep -Fx 'first_owner=not_created' "$transport_manifest" >/dev/null \
  || fail transport_owner_boundary_missing
grep -Fx 'dns=not_changed' "$transport_manifest" >/dev/null \
  || fail transport_dns_boundary_missing

(
  cd "$payload_dir"
  sha256sum --check transport.sha256
) || fail transport_checksum_failed

bundle_name="arthello-ru-images-$release_sha.tar.gz"
manifest_name="arthello-ru-images-$release_sha.manifest"
checksums_name="arthello-ru-images-$release_sha.sha256"
release_script_name="arthello-ru-pull-release-$release_sha.sh"

mapfile -t bundle_parts < <(find "$payload_dir" -maxdepth 1 -type f \
  -name "$bundle_name.part-*" -print | sort)
[ "${#bundle_parts[@]}" -gt 1 ] || fail transport_bundle_parts_missing
cat "${bundle_parts[@]}" > "$temporary_dir/$bundle_name"
cp "$payload_dir/$manifest_name" "$temporary_dir/$manifest_name"
cp "$payload_dir/$checksums_name" "$temporary_dir/$checksums_name"
cp "$payload_dir/$release_script_name" "$temporary_dir/$release_script_name"

(
  cd "$temporary_dir"
  sha256sum --check "$checksums_name"
) || fail release_checksum_failed

grep -Fx "repository=vitaliyozolin-dotcom/ArtHello-OS" \
  "$temporary_dir/$manifest_name" >/dev/null || fail manifest_repository_mismatch
grep -Fx "source_sha=$release_sha" "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_release_mismatch
grep -Fx "runtime_infrastructure_sha=$runtime_infrastructure_sha" \
  "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_runtime_infrastructure_mismatch
grep -Fx 'offline_runtime_check=passed' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_offline_runtime_check_missing
grep -Fx 'real_data=not_loaded' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_real_data_boundary_missing
grep -Fx 'integrations=disabled' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_integration_boundary_missing
grep -Fx 'first_owner=not_created' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_owner_boundary_missing
grep -Fx 'dns=not_changed' "$temporary_dir/$manifest_name" >/dev/null \
  || fail manifest_dns_boundary_missing
bash -n "$temporary_dir/$release_script_name" || fail downloaded_script_invalid

if [ ! -d "$release_dir" ]; then
  staging_dir="$(mktemp -d "$root_dir/releases/.${release_sha}.XXXXXX")"
  runuser -u "$deploy_user" -- git -C "$source_repo" archive "$release_sha" \
    | tar -x -C "$staging_dir"
  printf '%s\n' "$release_sha" > "$staging_dir/.arthello-release-sha"
  chown -R "$deploy_user:$deploy_user" "$staging_dir"
  mv "$staging_dir" "$release_dir"
  staging_dir=
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
  runtime_revision="$(docker image inspect \
    --format '{{index .Config.Labels "org.opencontainers.image.runtime-revision"}}' \
    "$image_name")"
  [ "$runtime_revision" = "$runtime_infrastructure_sha" ] \
    || fail image_runtime_revision_mismatch
done
docker image inspect postgres:16-alpine >/dev/null || fail postgres_image_missing

docker image tag "arthello-os-api:$release_sha" arthello-os-api:local
docker image tag "arthello-os-web:$release_sha" arthello-os-web:local
# compose.production.yml declares build-only services without an explicit
# image field. Compose resolves those to <project>-<service>:latest even when
# --no-build is used, so provide that deterministic alias as well.
docker image tag "arthello-os-api:$release_sha" arthello-os-api:latest
docker image tag "arthello-os-web:$release_sha" arthello-os-web:latest

install -m 0444 "$temporary_dir/$manifest_name" "$release_dir/.arthello-image-manifest"
install -m 0444 "$temporary_dir/$checksums_name" "$release_dir/.arthello-image-checksums"
install -m 0444 "$transport_manifest" "$release_dir/.arthello-transport-manifest"

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
printf 'ARTHELLO_DEPLOY_SOURCE=private_git_chunks\n'
printf 'ARTHELLO_TRANSPORT_COMMIT=%s\n' "$transport_commit"
printf 'ARTHELLO_RUNTIME_INFRASTRUCTURE_SHA=%s\n' "$runtime_infrastructure_sha"
printf 'ARTHELLO_HEALTH=OK\n'
printf 'ARTHELLO_REAL_DATA=NOT_LOADED\n'
printf 'ARTHELLO_INTEGRATIONS=DISABLED\n'
printf 'ARTHELLO_FIRST_OWNER=NOT_CREATED\n'
printf 'ARTHELLO_DNS=NOT_CHANGED\n'
compose ps
