# syntax=docker/dockerfile:1
# ProyekKas web/worker/migrate — one image family, several commands (ADR 0002 §2).
# Build context = repo root:
#   docker build -f apps/web/Dockerfile --target runner  -t proyekkas-web:<ver> .
#   docker build -f apps/web/Dockerfile --target migrate -t proyekkas-migrate:<ver> .
# Base = control-plane pin: node:24.22.1-alpine (Alpine 3.24, musl 1.2.6 → sharp 0.35.4 prebuilt OK),
# pinned by index digest (verified with `docker image inspect` / `docker manifest inspect`).
# The Next build uses webpack (Turbopack was OOM-killed at 1.5/1.9 GiB, spike g) → build host ≥ 2 GiB.
ARG NODE_IMAGE=node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

# ---- deps: full dependency tree (dev deps needed for build/migrate) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

# ---- build: OpenAPI generation + next build (standalone, webpack) + esbuild worker bundle ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=1280
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only (the Payload config is imported during `next build`); the runtime
# env is validated at boot (src/lib/env.ts). No real secret is ever baked into the image.
WORKDIR /app/apps/web
RUN PAYLOAD_SECRET=build-time-placeholder-not-a-secret-0000 \
    DATABASE_URL=postgres://build:build@127.0.0.1:1/build \
    npm run build

# ---- migrate: one-shot `payload migrate` (and the idempotent seed) as the OWNER role (ADR 0006 §6) ----
FROM build AS migrate
ENV NODE_ENV=production \
    TZ=Asia/Makassar \
    NODE_OPTIONS=--max-old-space-size=320
# Drop tooling the one-shot migrate/seed never loads (Trivy: CRITICAL Go stdlib CVEs in old esbuild
# binaries of @esbuild-kit/* and drizzle-kit — used only by `migrate:create`; HIGH CVEs in npm's
# bundled deps). tsx (payload bin) keeps the top-level esbuild. Verified: migrate + seed still run.
RUN addgroup -S -g 1001 nextjs && adduser -S -D -H -u 1001 -G nextjs -s /sbin/nologin nextjs \
 && rm -rf /app/apps/web/.next/cache /app/node_modules/@esbuild-kit /app/node_modules/drizzle-kit/node_modules/@esbuild \
           /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER 1001:1001
WORKDIR /app/apps/web
# Seed (APP role DSN): node /app/node_modules/payload/bin.js run src/seed/index.ts
CMD ["node", "/app/node_modules/payload/bin.js", "migrate"]

# ---- runner: standalone output, no npm, non-root ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Asia/Makassar \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup -S -g 1001 nextjs \
 && adduser -S -D -H -u 1001 -G nextjs -s /sbin/nologin nextjs \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
# Monorepo standalone layout: /app/apps/web/server.js + /app/node_modules (traced).
COPY --from=build --chown=root:root /app/apps/web/.next/standalone ./
COPY --from=build --chown=root:root /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=root:root /app/apps/web/dist ./apps/web/dist
# APK publish helper for /unduh (node built-ins only; runbook docs/proyekkas/runbooks/rilis-apk.md).
COPY --from=build --chown=root:root /app/apps/web/scripts/publish-apk.mjs ./apps/web/scripts/publish-apk.mjs
RUN mkdir -p /app/apps/web/.next/cache /data/media \
 && chown nextjs:nextjs /app/apps/web/.next/cache /data/media
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Web (default). Worker: `node apps/web/dist/worker.mjs`.
CMD ["node", "apps/web/server.js"]
