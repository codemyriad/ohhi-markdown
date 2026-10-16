# Oh Hi markdown relay image. Build from the repo root (the lockfile and
# rush.json live there); Dockerfile.dockerignore narrows the context:
#
#   docker build -f apps/relay/Dockerfile -t ohhi-relay .
#
# Dependencies come from the repo lockfile, never re-resolved:
# - `rush install` refuses any package.json that drifted from pnpm-lock.yaml.
#   It is the full install, not `--to @ohhi/relay`: without Rush's
#   usePnpmFrozenLockfileForRushInstall experiment a filtered install
#   re-resolves peers (it once dropped @hocuspocus/server's y-protocols peer and
#   the relay died at import). `cmp` fails the build if pnpm changed the
#   lockfile at all.
# - `rush deploy` (common/config/rush/deploy.json) copies the relay and only its
#   production dependency closure into one self-contained folder.
# Both run in the build stage for the target platform, so better-sqlite3's
# native binding matches the runtime's arch and libc (amd64 or arm64 alike).

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
# better-sqlite3 fetches a prebuilt binding when one exists for the platform
# and falls back to node-gyp otherwise; the toolchain stays in this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN node common/scripts/install-run-rush.js install \
  && cmp common/config/rush/pnpm-lock.yaml common/temp/pnpm-lock.yaml \
  && node common/scripts/install-run-rush.js deploy --project @ohhi/relay --target-folder /deploy

FROM ${NODE_IMAGE}
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
# The base image's unprivileged `node` user (uid 1000) owns the data dir.
# Creating it before VOLUME makes a fresh named volume inherit that owner; a
# bind mount has to be chowned to 1000 on the host instead.
RUN mkdir /data && chown node:node /data
COPY --from=build /deploy /app
WORKDIR /app/apps/relay
USER node
VOLUME /data
EXPOSE 8787
# /healthz proves the database answers a read (src/server.ts). Slim images
# ship no curl; Node's own fetch does the job.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# No init shim: node is PID 1 and gets `docker stop`'s SIGTERM directly;
# main.ts flushes pending doc stores and exits. The relay spawns no children.
CMD ["node", "--experimental-strip-types", "src/main.ts"]
