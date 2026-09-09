#!/bin/sh
set -eu

db_workspace=/app/lib/db
checked_runner="$db_workspace/scripts/checked-migration-runner.mjs"
if [ ! -r "$checked_runner" ]; then
  printf 'ARTHELLO_API_STARTUP_ERROR=checked_migration_runner_missing\n' >&2
  exit 1
fi

if [ -z "${ALFACRM_DOMAIN:-}" ]; then
  if [ -n "${ALFACRM_EMAIL:-}" ] || [ -n "${ALFACRM_API_KEY:-}" ]; then
    printf 'ARTHELLO_API_STARTUP_ERROR=alfacrm_domain_missing_with_credentials\n' >&2
    exit 1
  fi
  export ALFACRM_DOMAIN=disabled.invalid
fi

cd "$db_workspace"
node "$checked_runner"
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
