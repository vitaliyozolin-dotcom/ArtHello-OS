ARG NEXT_PUBLIC_SCHOOL_DESIGN_V1=true
ARG NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED=false

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder
ARG NEXT_PUBLIC_SCHOOL_DESIGN_V1
ARG NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SCHOOL_DESIGN_V1=$NEXT_PUBLIC_SCHOOL_DESIGN_V1
ENV NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED=$NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runner
ARG NEXT_PUBLIC_SCHOOL_DESIGN_V1
ARG NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_PUBLIC_SCHOOL_DESIGN_V1=$NEXT_PUBLIC_SCHOOL_DESIGN_V1
ENV NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED=$NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/data/atlas-school.sqlite
RUN groupadd --system --gid 1001 school && useradd --system --uid 1001 --gid school school
COPY --from=builder --chown=school:school /app/.next/standalone ./
COPY --from=builder --chown=school:school /app/.next/static ./.next/static
COPY --from=builder --chown=school:school /app/public ./public
COPY --from=builder --chown=school:school /app/drizzle ./drizzle
COPY --from=builder --chown=school:school /app/lib/curriculum-import.mjs /app/lib/curriculum-allocation.mjs ./lib/
RUN mkdir -p /data /backups && chown -R school:school /data /backups
USER school
EXPOSE 3000
CMD ["node", "server.js"]
