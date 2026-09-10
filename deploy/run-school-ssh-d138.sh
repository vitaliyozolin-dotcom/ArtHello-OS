#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${RUN_ID:?}" "${RUN_ATTEMPT:?}" "${WORKFLOW_SHA:?}" "${RELEASE_SHA:?}" "${RELEASE_TREE:?}"
: "${SOURCE_SHA256:?}" "${VERIFY_SHA256:?}" "${JOB_DIR:?}"
[[ "$RUN_ID" =~ ^[0-9]+$ && "$RUN_ATTEMPT" =~ ^[0-9]+$ ]]
[[ "$WORKFLOW_SHA" =~ ^[a-f0-9]{40}$ && "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ && "$RELEASE_TREE" =~ ^[a-f0-9]{40}$ ]]
test "$JOB_DIR" = "/tmp/school-d138/${RELEASE_SHA}-${RUN_ID}-${RUN_ATTEMPT}"
test "$(sha256sum "$JOB_DIR/school-release.tar.gz" | cut -d ' ' -f 1)" = "$SOURCE_SHA256"
test "$(sha256sum "$JOB_DIR/verify-school-release.mjs" | cut -d ' ' -f 1)" = "$VERIFY_SHA256"

mapfile -t school_ids < <(docker ps -q | while IFS= read -r id; do
  image="$(docker inspect "$id" --format '{{.Image}}')"
  revision="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  if [ "$revision" = 54242340f2d9b6a9887d69ecc03520ddf9f7982c ]; then printf '%s\n' "$id"; fi
done)
test "${#school_ids[@]}" -eq 1
test "$(docker inspect "${school_ids[0]}" --format '{{.State.Running}}')" = true
school_container="$(docker inspect "${school_ids[0]}" --format '{{.Name}}' | sed 's#^/##')"
[[ "$school_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]

RUN_ID="$RUN_ID" RUN_ATTEMPT="$RUN_ATTEMPT" WORKFLOW_SHA="$WORKFLOW_SHA" \
  RELEASE_SHA="$RELEASE_SHA" RELEASE_TREE="$RELEASE_TREE" \
  SOURCE_ARCHIVE="$JOB_DIR/school-release.tar.gz" SOURCE_SHA256="$SOURCE_SHA256" \
  VERIFY_SCRIPT="$JOB_DIR/verify-school-release.mjs" VERIFY_SHA256="$VERIFY_SHA256" \
  OFFLINE_BASE_REF='node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e' \
  SCHOOL_ORIGIN=https://school-188-225-38-55.sslip.io \
  ARTHELLO_ORIGIN=https://arthello-188-225-38-55.sslip.io JOB_DIR="$JOB_DIR" \
  SCHOOL_CONTAINER="$school_container" \
  bash "$JOB_DIR/school-curriculum-standalone-cutover.sh"
