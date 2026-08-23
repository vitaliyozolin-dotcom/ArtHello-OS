FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/data/school-1-11.sqlite
RUN groupadd --system --gid 1001 school && useradd --system --uid 1001 --gid school school
COPY --from=builder --chown=school:school /app/.next/standalone ./
COPY --from=builder --chown=school:school /app/.next/static ./.next/static
COPY --from=builder --chown=school:school /app/public ./public
COPY --from=builder --chown=school:school /app/drizzle ./drizzle
COPY --from=builder --chown=school:school /app/deploy/bootstrap ./bootstrap
COPY --from=builder --chown=school:school /app/scripts/bootstrap-owner.mjs /app/scripts/backup-db.mjs /app/scripts/container-entrypoint.sh ./scripts/
RUN mkdir -p /data /backups && chown -R school:school /data /backups
USER school
EXPOSE 3000
ENTRYPOINT ["./scripts/container-entrypoint.sh"]
CMD ["node", "server.js"]
