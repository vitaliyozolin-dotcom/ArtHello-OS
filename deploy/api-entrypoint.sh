#!/bin/sh
set -eu

db_workspace=/app/lib/db
drizzle_bin="$db_workspace/node_modules/.bin/drizzle-kit"
if [ ! -x "$drizzle_bin" ]; then
  printf 'ARTHELLO_API_STARTUP_ERROR=offline_drizzle_binary_missing\n' >&2
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
"$drizzle_bin" migrate --config ./drizzle.config.ts
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
