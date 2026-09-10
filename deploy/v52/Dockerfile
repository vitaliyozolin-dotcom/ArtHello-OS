# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# The guarded production reset is orchestrated and post-verified by the pinned workflow release.
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS application
ENV CI=1 ARTHELLO_BACKUP_REQUIRE_UNIX=1
WORKDIR /app
COPY deploy/v52/src/ /app/
RUN ! grep -q 'invoke_user_worker_ahead_of_assets: true' /app/production/runtime-server.mjs \
    && grep -q 'invoke_user_worker_ahead_of_assets: false' /app/production/runtime-server.mjs \
    && grep -q 'has_user_worker: true' /app/production/runtime-server.mjs \
    && npm ci && npm run lint && npm test

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime-dependencies
WORKDIR /runtime
COPY deploy/v52/runtime/package.json deploy/v52/runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV NODE_ENV=production PORT=8081 ARTHELLO_D1_PATH=/data/d1 \
    NODE_EXTRA_CA_CERTS=/app/production/russian-trusted-root-ca.pem
WORKDIR /app
# Python is installed only while building this verified image, never on the host.
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/v52/backup/backup.py deploy/v52/backup/bridge.py deploy/v52/backup/worker.py deploy/v52/backup/probe.py deploy/v52/backup/activation-volume.py /opt/arthello-backup/
COPY --from=application /app/dist /app/dist
COPY --from=application /app/production/runtime-server.mjs /app/production/runtime-server.mjs
COPY --from=application /app/production/tochka-transport.mjs /app/production/tochka-transport.mjs
COPY --from=application /app/production/backup-transport.mjs /app/production/backup-transport.mjs
COPY --from=application /app/production/tochka-autosync-timer.mjs /app/production/tochka-autosync-timer.mjs
COPY --from=runtime-dependencies /runtime/node_modules /app/node_modules
COPY deploy/v52/certificates/russian-trusted-root-ca.pem /app/production/russian-trusted-root-ca.pem
RUN node --input-type=module -e "import { readFileSync } from 'node:fs'; import { X509Certificate } from 'node:crypto'; const certificate = new X509Certificate(readFileSync(process.env.NODE_EXTRA_CA_CERTS)); const expected = 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31'; if (certificate.fingerprint256 !== expected || !certificate.ca || certificate.subject !== certificate.issuer || !certificate.checkIssued(certificate) || !certificate.verify(certificate.publicKey) || Date.parse(certificate.validTo) <= Date.now()) process.exit(1);" \
    && chmod 0444 /app/production/russian-trusted-root-ca.pem \
    && mkdir -p /data/d1 && chown -R node:node /data \
    && install -d -o 1000 -g 1000 -m 0700 /var/backups/arthello-v52 \
    && install -d -o 1000 -g 1000 -m 0750 /var/lib/arthello-v52-backup-control \
    && install -d -o 1002 -g 1000 -m 0750 /var/lib/arthello-v52-tochka-activation \
    && printf 'ARTHELLO_BACKUP_STORAGE_V1\n' > /var/backups/arthello-v52/.layout \
    && printf 'ARTHELLO_BACKUP_CONTROL_V1\n' > /var/lib/arthello-v52-backup-control/.layout \
    && printf 'ARTHELLO_TOCHKA_ACTIVATION_VOLUME_V2\n' > /var/lib/arthello-v52-tochka-activation/.activation-volume-v2.seed \
    && chown 1000:1000 /var/backups/arthello-v52/.layout /var/lib/arthello-v52-backup-control/.layout \
    && chmod 0444 /var/backups/arthello-v52/.layout /var/lib/arthello-v52-backup-control/.layout \
    && chown 1002:1000 /var/lib/arthello-v52-tochka-activation/.activation-volume-v2.seed \
    && chmod 0440 /var/lib/arthello-v52-tochka-activation/.activation-volume-v2.seed \
    && chmod 0444 /opt/arthello-backup/*.py
USER node
EXPOSE 8081
CMD ["node", "production/runtime-server.mjs"]
