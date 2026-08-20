# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build:application

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production PORT=8080
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY --from=build /app /app
RUN chmod 0555 /app/deploy/api-entrypoint.sh
USER node
EXPOSE 8080
ENTRYPOINT ["/app/deploy/api-entrypoint.sh"]

FROM caddy:2.10-alpine AS web
COPY --from=build /app/artifacts/alpha-crm-sync/.vite-dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
