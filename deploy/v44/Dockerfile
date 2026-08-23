# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS application

ENV CI=1
WORKDIR /app
COPY deploy/v44/arthello-sites-v44-source.tar.gz.part-* /tmp/arthello-source-parts/
RUN cat /tmp/arthello-source-parts/arthello-sites-v44-source.tar.gz.part-* > /tmp/arthello-source.tar.gz \
    && tar -xzf /tmp/arthello-source.tar.gz -C /app \
    && rm -f /tmp/arthello-source.tar.gz \
    && rm -rf /tmp/arthello-source-parts \
    && npm ci \
    && npm run lint \
    && npm test

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8081 \
    ARTHELLO_D1_PATH=/data/d1
WORKDIR /app
COPY --from=application /app /app
RUN mkdir -p /data/d1 && chown -R node:node /data
USER node
EXPOSE 8081
CMD ["node", "production/runtime-server.mjs"]
