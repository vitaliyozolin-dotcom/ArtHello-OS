# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS application

ENV CI=1
WORKDIR /app
COPY deploy/v44/src/package.json deploy/v44/src/package-lock.json /app/
RUN npm ci
COPY deploy/v44/src/ /app/
RUN ! grep -q 'invoke_user_worker_ahead_of_assets: true' /app/production/runtime-server.mjs \
    && grep -q 'invoke_user_worker_ahead_of_assets: false' /app/production/runtime-server.mjs \
    && grep -q 'has_user_worker: true' /app/production/runtime-server.mjs \
    && npm run typecheck \
    && npm run lint \
    && npm test

FROM node:24-bookworm-slim AS runtime-dependencies

WORKDIR /runtime
RUN npm init -y \
    && npm install --omit=dev --no-audit --no-fund miniflare@4.20260515.0 \
    && npm cache clean --force

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8081 \
    ARTHELLO_D1_PATH=/data/d1
WORKDIR /app
COPY --from=application /app/dist /app/dist
COPY --from=application /app/production/runtime-server.mjs /app/production/runtime-server.mjs
COPY --from=runtime-dependencies /runtime/node_modules /app/node_modules
RUN mkdir -p /data/d1 && chown -R node:node /data
USER node
EXPOSE 8081
CMD ["node", "production/runtime-server.mjs"]
