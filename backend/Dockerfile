# syntax=docker/dockerfile:1.7
#
# SCP:SL Trust Network backend image.
# Build from the REPOSITORY ROOT (the image needs the pnpm workspace and the shared package):
#
#   docker build -f backend/Dockerfile -t scpsl-trust-backend .
#
# Base image choice: Debian bookworm-slim (glibc). `argon2` (the only native dependency) ships
# prebuilt binaries for linux-x64 and linux-arm64 for both glibc and musl
# (node_modules/argon2/prebuilds/linux-*/argon2*.{glibc,musl}.node, loaded by node-gyp-build),
# so neither stage needs a C/C++ toolchain. glibc is the most widely exercised prebuild target
# and keeps the build and runtime stages ABI-identical; alpine would also work (musl prebuild).
# On any other platform (e.g. linux/arm/v6) the install falls back to node-gyp and the build
# stage would need `apt-get install -y python3 make g++`.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=10.33.0

# ---------------------------------------------------------------------------
# build: install the workspace (backend + shared only), build, prune to prod deps
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN npm install -g "pnpm@${PNPM_VERSION}" && pnpm config set store-dir /pnpm/store
WORKDIR /repo

# 1) lockfile only → download every package into the store (cached layer)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# 2) manifests + sources, offline install of the backend and its workspace dependencies
#    (web/package.json is copied so the workspace matches the lockfile; its deps are not installed)
COPY tsconfig.base.json ./
COPY web/package.json web/package.json
COPY shared ./shared
COPY backend ./backend
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@scpsl-trust/backend..."

# 3) build shared (dist is required at runtime: the backend bundle keeps it external) + backend
RUN pnpm --filter @scpsl-trust/shared build \
 && pnpm --filter @scpsl-trust/backend build

# 4) self-contained production tree: backend package.json, dist/, migrations/ and a node_modules
#    with production dependencies only (shared is copied in with its dist/ and test-vectors/).
#    --legacy: the workspace does not use inject-workspace-packages (pnpm 10 default deploy needs it).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @scpsl-trust/backend deploy --prod --legacy --offline /out \
 && node -e "require('/out/node_modules/argon2')" \
 && test -f /out/dist/index.js && test -f /out/dist/cli/migrate.js && test -d /out/migrations

# ---------------------------------------------------------------------------
# runtime: node + production files, non-root
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LOG_PRETTY=false \
    STORAGE_LOCAL_DIR=/data/evidence \
    MAIL_FILE_DIR=/data/mail \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app

# Application files are owned by root and read-only for the service user.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/migrations ./migrations
COPY --chmod=0755 scripts/docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint

# Writable state (local evidence storage, dev mail files) lives in /data only.
RUN mkdir -p /data/evidence /data/mail && chown -R node:node /data
VOLUME ["/data"]

# `node` (uid 1000) is provided by the official image.
USER node
EXPOSE 3000

# Liveness only (/readyz also checks PostgreSQL + Redis). No curl in slim images → use node's fetch.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# serve (default) | migrate [--status] | create-admin --email … --username … | verify-audit [...] | <any command>
ENTRYPOINT ["backend-entrypoint"]
CMD ["serve"]
