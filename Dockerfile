FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=custom_ca \
    if [ -f /run/secrets/custom_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/custom_ca npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000; else npm ci --ignore-scripts --no-audit --no-fund; fi
# Validate Node support and run the lifecycle hooks actually needed by this engine-free runtime.
# @prisma/engines postinstall downloads the unused migrate engine; @scarf/scarf is telemetry.
RUN node node_modules/prisma/scripts/preinstall-entry.js && npm rebuild esbuild argon2
COPY --chown=node:node . .
RUN --mount=type=secret,id=custom_ca \
    if [ -f /run/secrets/custom_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/custom_ca npm run db:generate; else npm run db:generate; fi

FROM base AS web-build
RUN npm run build

FROM nginx:1.28-alpine AS web
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist/web /usr/share/nginx/html

FROM node:24-bookworm-slim AS api
WORKDIR /app
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium openssl ca-certificates fonts-noto-core fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY --from=base --chown=node:node /app /app
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV CHROMIUM_NO_SANDBOX=true
USER node
CMD ["./node_modules/.bin/tsx", "apps/api/src/main.ts"]
