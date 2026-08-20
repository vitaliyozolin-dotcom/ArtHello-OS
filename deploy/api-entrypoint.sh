#!/bin/sh
set -eu

pnpm --filter @workspace/db exec drizzle-kit migrate --config /app/lib/db/drizzle.config.ts
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
