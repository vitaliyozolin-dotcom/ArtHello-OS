FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e
ARG SOURCE_SHA
LABEL org.arthello.role="e2e-browser" org.opencontainers.image.revision=$SOURCE_SHA
WORKDIR /opt/arthello-e2e
COPY package.json pnpm-lock.yaml run.mjs flow.mjs smoke.mjs proxy.mjs ./
COPY node_modules ./node_modules
ENV XDG_CONFIG_HOME=/tmp/config XDG_CACHE_HOME=/tmp/cache
USER 1000:1000
ENTRYPOINT ["node", "/opt/arthello-e2e/run.mjs"]
