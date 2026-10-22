# Oh Hi — the Nextcloud ExApp image (nextcloud-build decision 18).
# Build from the repo root; Dockerfile.dockerignore narrows the context:
#
#   docker build -f apps/nextcloud/Dockerfile -t ghcr.io/codemyriad/ohhi-nextcloud:0.1.0 .
#
# The tag is appinfo/info.xml's <image-tag>; scripts/nc-dev-install.sh reads it.
#
# Layout shipped to the container:
#   /app/apps/nextcloud/dist/server.mjs  the ExApp process (lifecycle, static shell, API, relay)
#   /app/...                             `rush deploy --scenario nextcloud`: its production closure (better-sqlite3)
#   /app/web                             the shell, built with --base /exapps/ohhi/ui/ (OHHI_WEB_DIST)
#   /app/embed/embed.js                  the embedded page's bootstrap IIFE (OHHI_EMBED_DIST)
#   /usr/local/bin/frpc                  FRP client for the HaRP tunnel
#   /app/start.sh                        writes /tmp/frpc.toml, starts frpc, execs node
#
# Dependencies come from the repo lockfile, never re-resolved (as apps/relay/Dockerfile):
# the full `rush install`, then `cmp` fails the build if pnpm touched the lockfile.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG FRP_VERSION=0.61.1

FROM debian:bookworm-slim AS frpc-fetcher
ARG FRP_VERSION
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tar \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
 case "${TARGETARCH:-amd64}" in \
   amd64) frp_arch=amd64 ;; \
   arm64) frp_arch=arm64 ;; \
   *) echo "unsupported TARGETARCH: ${TARGETARCH:-amd64}" >&2; exit 1 ;; \
 esac; \
 curl -fSL "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${frp_arch}.tar.gz" -o /tmp/frp.tgz; \
 mkdir -p /out; \
 tar -xzf /tmp/frp.tgz -C /tmp; \
 cp "/tmp/frp_${FRP_VERSION}_linux_${frp_arch}/frpc" /out/frpc; \
 chmod +x /out/frpc; \
 /out/frpc --version

FROM ${NODE_IMAGE} AS build
# better-sqlite3 fetches a prebuilt binding when one exists for the platform
# and falls back to node-gyp otherwise; the toolchain stays in this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN node common/scripts/install-run-rush.js install \
  && cmp common/config/rush/pnpm-lock.yaml common/temp/pnpm-lock.yaml
# The shell (Help pages first: they are generated into public/guide/), the
# embed bootstrap, then the server bundle.
RUN cd apps/web \
  && node ../../common/scripts/install-run-rushx.js build-guide \
  && node ../../common/scripts/install-run-rushx.js build:nextcloud \
  && node ../../common/scripts/install-run-rushx.js build:embed \
  && cd ../nextcloud \
  && node ../../common/scripts/install-run-rushx.js build \
  && test -f /repo/apps/web/dist-nextcloud/index.html \
  && test -f /repo/apps/web/dist-embed/embed.js \
  && test -f /repo/apps/nextcloud/dist/server.mjs
RUN node common/scripts/install-run-rush.js deploy --scenario nextcloud --target-folder /deploy

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    OHHI_WEB_DIST=/app/web \
    OHHI_EMBED_DIST=/app/embed \
    APP_PERSISTENT_STORAGE=/data
# The base image's unprivileged `node` user (uid 1000) runs everything. AppAPI
# mounts its volume at /nc_app_<appid>_data (and sets APP_PERSISTENT_STORAGE
# to it); creating that folder here, owned by `node`, makes a fresh named
# volume inherit the owner. /data is the default outside AppAPI.
RUN mkdir -p /data /nc_app_ohhi_data && chown node:node /data /nc_app_ohhi_data
# HaRP installs Nextcloud's CA bundle and the frp mTLS client certs by
# exec'ing `mkdir -p /usr/local/share/ca-certificates` and `mkdir -p
# /certs/frp` in the container AS ITS USER, and aborts the cert step when
# either fails (then frpc gets `EOF` forever) — so both folders must already
# exist. Its files arrive through the
# Docker API (root); `update-ca-certificates` then fails as `node`, which HaRP
# only logs: start.sh hands the files to Node as NODE_EXTRA_CA_CERTS instead.
RUN mkdir -p /usr/local/share/ca-certificates /certs/frp
COPY --from=frpc-fetcher /out/frpc /usr/local/bin/frpc
COPY --from=build /deploy /app
COPY --from=build /repo/apps/nextcloud/dist /app/apps/nextcloud/dist
COPY --from=build /repo/apps/web/dist-nextcloud /app/web
COPY --from=build /repo/apps/web/dist-embed /app/embed
COPY apps/nextcloud/start.sh /app/start.sh
RUN chmod 0755 /app/start.sh
WORKDIR /app/apps/nextcloud
USER node
# No init shim: start.sh execs node as PID 1 (docker stop's SIGTERM reaches
# it); frpc is its background child.
CMD ["/app/start.sh"]
