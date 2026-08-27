# syntax=docker/dockerfile:1.7
# The guarded production reset is orchestrated and post-verified by the pinned workflow release.
FROM node:24-bookworm-slim AS application
ENV CI=1
WORKDIR /app
COPY deploy/v52/arthello-sites-v52-source.tar.gz.b64.part-* /tmp/arthello-source-parts/
COPY deploy/v44/overrides/ /tmp/arthello-overrides/
COPY deploy/v52/overrides/ /tmp/arthello-v52-overrides/
RUN cat /tmp/arthello-source-parts/arthello-sites-v52-source.tar.gz.b64.part-* | base64 -d > /tmp/arthello-source.tar.gz \
    && echo "e76fb44dca272825fda4486e7584290b14969c1fd054a8c955eae738899b7c12  /tmp/arthello-source.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/arthello-source.tar.gz -C /app \
    && rm -f /tmp/arthello-source.tar.gz && rm -rf /tmp/arthello-source-parts \
    && cp -a /tmp/arthello-overrides/. /app/ && cp -a /tmp/arthello-v52-overrides/. /app/ \
    && node /app/scripts/patch-dashboard-personalization.mjs \
    && node /app/scripts/patch-sales-operating-workspace.mjs \
    && node /app/scripts/patch-system-foundation.mjs \
    && node /app/scripts/normalize-system-patch-inputs.mjs \
    && node /app/scripts/patch-system-content-legal.mjs \
    && node /app/scripts/patch-system-analytics-readiness.mjs \
    && node /app/scripts/patch-system-operational-modules.mjs \
    && node /app/scripts/patch-system-dialog-portals.mjs \
    && node /app/scripts/patch-mobile-visual-help-followup.mjs \
    && node /app/scripts/prepare-help-finance-ux-v3.mjs \
    && node /app/scripts/patch-help-finance-ux-v3.mjs \
    && node /app/scripts/verify-system-wide-operational-shells.mjs \
    && echo "9e6ea6da02b531ab2bbaed4aceece5f5e7c9a9321709612adc9e12ae0d6554d0  /app/db/index.ts" | sha256sum -c - \
    && rm -rf /tmp/arthello-overrides /tmp/arthello-v52-overrides \
    && ! grep -q 'invoke_user_worker_ahead_of_assets: true' /app/production/runtime-server.mjs \
    && grep -q 'invoke_user_worker_ahead_of_assets: false' /app/production/runtime-server.mjs \
    && grep -q 'has_user_worker: true' /app/production/runtime-server.mjs \
    && npm ci && npm run lint && npm test

FROM node:24-bookworm-slim AS runtime-dependencies
WORKDIR /runtime
RUN npm init -y && npm install --omit=dev --no-audit --no-fund miniflare@4.20260515.0 && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8081 ARTHELLO_D1_PATH=/data/d1
WORKDIR /app
COPY --from=application /app/dist /app/dist
COPY --from=application /app/production/runtime-server.mjs /app/production/runtime-server.mjs
COPY --from=runtime-dependencies /runtime/node_modules /app/node_modules
RUN mkdir -p /data/d1 && chown -R node:node /data
USER node
EXPOSE 8081
CMD ["node", "production/runtime-server.mjs"]
