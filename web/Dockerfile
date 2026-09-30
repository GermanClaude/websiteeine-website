# syntax=docker/dockerfile:1.7
#
# SCP:SL Trust Network web panel: Vite build served by an unprivileged nginx.
# Build from the REPOSITORY ROOT (the panel consumes ../shared from source):
#
#   docker build -f web/Dockerfile -t scpsl-trust-web .
#
# Runtime environment (rendered into the nginx config on start, see web/nginx.conf):
#   BACKEND_UPSTREAM (backend:3000), NGINX_RESOLVER (127.0.0.11), CLIENT_MAX_BODY_SIZE (520m)
# Build-time variable: VITE_REGISTRATION_ENABLED (true) — only hides the registration link; the
# backend's ALLOW_REGISTRATION decides (R10).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.28-alpine
ARG PNPM_VERSION=10.33.0

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN npm install -g "pnpm@${PNPM_VERSION}" && pnpm config set store-dir /pnpm/store
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# backend/package.json keeps the workspace in line with the lockfile; its deps are not installed.
COPY tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY shared ./shared
COPY web ./web
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@scpsl-trust/web..."

ARG VITE_REGISTRATION_ENABLED=true
ENV VITE_REGISTRATION_ENABLED=${VITE_REGISTRATION_ENABLED}
# `build` = tsc --noEmit && vite build → web/dist
RUN pnpm --filter @scpsl-trust/web build

# CSP: hash every inline <script> of the built index.html (the theme bootstrap) into the config.
RUN node -e " \
  const fs = require('node:fs'); const crypto = require('node:crypto'); \
  const html = fs.readFileSync('web/dist/index.html', 'utf8'); \
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)] \
    .map((m) => \"'sha256-\" + crypto.createHash('sha256').update(m[1]).digest('base64') + \"'\"); \
  const conf = fs.readFileSync('web/nginx.conf', 'utf8').replace('__SPA_SCRIPT_HASHES__', hashes.join(' ')); \
  if (conf.includes('__SPA_SCRIPT_HASHES__')) throw new Error('placeholder left in nginx.conf'); \
  fs.writeFileSync('/tmp/default.conf.template', conf); \
  console.log('inline script hashes:', hashes.join(' ') || '(none)');"

# ---------------------------------------------------------------------------
# runtime: nginx as uid 101, listening on 8080
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
ENV BACKEND_UPSTREAM=backend:3000 \
    NGINX_RESOLVER=127.0.0.11 \
    CLIENT_MAX_BODY_SIZE=520m
COPY --from=build /tmp/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
