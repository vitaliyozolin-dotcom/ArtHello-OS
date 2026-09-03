# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# The guarded production reset is orchestrated and post-verified by the pinned workflow release.
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS application
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
    && node /app/scripts/patch-tochka-customer-permission-fallback.mjs \
    && node /app/scripts/patch-tochka-multi-company-selection.mjs \
    && node /app/scripts/patch-tochka-statement-array-response.mjs \
    && node /app/scripts/patch-system-dialog-portals.mjs \
    && node /app/scripts/patch-mobile-visual-help-followup.mjs \
    && node /app/scripts/prepare-help-finance-ux-v3.mjs \
    && node /app/scripts/patch-help-finance-ux-v3.mjs \
    && node /app/scripts/patch-mobile-canonical-v5.mjs \
    && node /app/scripts/patch-tochka-finance-bank-visibility.mjs \
    && node /app/scripts/patch-safe-json-responses.mjs \
    && node /app/scripts/patch-school-sso-entry.mjs \
    && node /app/scripts/verify-system-wide-operational-shells.mjs \
    && echo "e78978c13431d32a0db2db25da73f24fd6245703aa14d4cb3ec34647324f6f40  /app/db/index.ts" | sha256sum -c - \
    && node /app/scripts/patch-finance-operation-allocation.mjs \
    && rm -rf /tmp/arthello-overrides /tmp/arthello-v52-overrides \
    && ! grep -q 'invoke_user_worker_ahead_of_assets: true' /app/production/runtime-server.mjs \
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
COPY --from=application /app/dist /app/dist
COPY --from=application /app/production/runtime-server.mjs /app/production/runtime-server.mjs
COPY --from=application /app/production/tochka-transport.mjs /app/production/tochka-transport.mjs
COPY --from=runtime-dependencies /runtime/node_modules /app/node_modules
COPY deploy/v52/certificates/russian-trusted-root-ca.pem /app/production/russian-trusted-root-ca.pem
RUN node --input-type=module -e "import { readFileSync } from 'node:fs'; import { X509Certificate } from 'node:crypto'; const certificate = new X509Certificate(readFileSync(process.env.NODE_EXTRA_CA_CERTS)); const expected = 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31'; if (certificate.fingerprint256 !== expected || !certificate.ca || certificate.subject !== certificate.issuer || !certificate.checkIssued(certificate) || !certificate.verify(certificate.publicKey) || Date.parse(certificate.validTo) <= Date.now()) process.exit(1);" \
    && chmod 0444 /app/production/russian-trusted-root-ca.pem \
    && mkdir -p /data/d1 && chown -R node:node /data
USER node
EXPOSE 8081
CMD ["node", "production/runtime-server.mjs"]
