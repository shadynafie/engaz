# Build with the full Debian image, which has compilers for native modules.
FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a AS build
# Keep pnpm in a shared location so the runtime user can start it without a download.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
WORKDIR /app
# Normalize modes: a restrictive host umask (e.g. 077 on hardened hosts) would otherwise
# leave the copied tree unreadable to USER node at runtime.
COPY --chmod=755 . .
RUN corepack install
# A self-hosted installation runs only the server and web app. The desktop, mobile, and
# marketing apps stay in the repository for their own builds, not in this image.
RUN pnpm install --frozen-lockfile \
    --filter "@engaz/api..." \
    --filter "@engaz/worker..." \
    --filter "@engaz/web..." \
    --filter "@engaz/sandbox-supervisor..." \
    --filter "@engaz/db..." \
  && rm -rf apps/desktop apps/mobile apps/www
RUN pnpm --filter @engaz/db generate
RUN ENGAZ_ALLOW_DEV_SECRETS=1 pnpm --filter @engaz/web build

FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
# Prisma's migration engine needs OpenSSL, which the slim image omits.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
COPY --from=build /opt/corepack /opt/corepack
WORKDIR /app
COPY --from=build /app /app
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp
ARG GIT_SHA
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
EXPOSE 7792 7791 7091
USER node
CMD ["pnpm", "--filter", "@engaz/api", "start"]
