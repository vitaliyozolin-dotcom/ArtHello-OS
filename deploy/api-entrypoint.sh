#!/bin/sh
set -eu

db_workspace=/app/lib/db
drizzle_bin="$db_workspace/node_modules/.bin/drizzle-kit"
if [ ! -x "$drizzle_bin" ]; then
  printf 'ARTHELLO_API_STARTUP_ERROR=offline_drizzle_binary_missing\n' >&2
  exit 1
fi

cd "$db_workspace"
"$drizzle_bin" migrate --config ./drizzle.config.ts
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
