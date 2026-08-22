#!/bin/sh
set -eu

drizzle_bin=/app/lib/db/node_modules/.bin/drizzle-kit
if [ ! -x "$drizzle_bin" ]; then
  printf 'ARTHELLO_API_STARTUP_ERROR=offline_drizzle_binary_missing\n' >&2
  exit 1
fi

"$drizzle_bin" migrate --config /app/lib/db/drizzle.config.ts
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
