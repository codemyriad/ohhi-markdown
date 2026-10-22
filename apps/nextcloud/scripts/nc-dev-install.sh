#!/usr/bin/env bash
# Build the Oh Hi ExApp image and (re)install it into the local Nextcloud
# stack (compose project `spreedtest`: Nextcloud 35 + AppAPI + HaRP daemon
# `harp_local`), then start the WebSocket-forwarding front proxy on :28090.
#
#   apps/nextcloud/scripts/nc-dev-install.sh            build + install
#   SKIP_BUILD=1 apps/nextcloud/scripts/nc-dev-install.sh   reuse the image
#
# Rules this encodes (spike S16; Cassini's lib-exapp-register.sh):
# - NEVER `app_api:app:unregister --rm-data`: the app's volume holds vault state.
# - Re-registering over a live registration fails at /init (AppAPI keeps the
#   old secret): unregister first (data kept), then register.
# - A `--wait-finish` register hangs while the tunnel is down; a stuck one is
#   pkill'ed before we start.
# - The daemon maps ghcr.io → local images, so the locally built
#   ghcr.io/codemyriad/ohhi-nextcloud:<image-tag> is used without a pull.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"   # apps/nextcloud
repo="$(cd "$here/../.." && pwd)"
NC="${NC_CONTAINER:-spreedtest-nextcloud-1}"
NETWORK="${NC_NETWORK:-spreedtest_default}"
DAEMON="${NC_DAEMON:-harp_local}"
SIDECAR="${NC_SIDECAR:-ohhi-rp-port}"
PORT="${NC_SIDECAR_PORT:-28090}"
APP_ID=ohhi
INFO="$here/appinfo/info.xml"

log() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*" >&2; }
occ() { docker exec -u www-data "$NC" php occ "$@"; }

manifest() { sed -n "s#.*<$1>\\([^<]*\\)</$1>.*#\\1#p" "$INFO" | head -n1; }
registry="$(manifest registry)"
image="$(manifest image)"
tag="$(manifest image-tag)"
[[ -n "$registry" && -n "$image" && -n "$tag" ]] || { echo "error: no <registry>/<image>/<image-tag> in $INFO" >&2; exit 1; }
ref="$registry/$image:$tag"

docker inspect "$NC" >/dev/null 2>&1 || { echo "error: container $NC is not running (start the spreedtest stack)" >&2; exit 1; }

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  log "docker build $ref"
  docker build -f "$repo/apps/nextcloud/Dockerfile" -t "$ref" "$repo"
fi

log "stop any stuck app:register"
docker exec "$NC" pkill -f "app_api:app:register $APP_ID" 2>/dev/null || true

if occ app_api:app:list 2>/dev/null | grep -q "^$APP_ID "; then
  log "unregister the existing $APP_ID (data kept)"
  occ app_api:app:unregister "$APP_ID" --force || true
fi
# A container left behind by a forced unregister would hold the name.
docker rm -f "nc_app_$APP_ID" >/dev/null 2>&1 || true

log "register $APP_ID on $DAEMON"
docker cp "$INFO" "$NC:/tmp/ohhi-info.xml"
docker exec "$NC" chown www-data /tmp/ohhi-info.xml
# Optional deploy env (declared in info.xml): OHHI_LOG_LEVEL=debug logs each walk's cost.
env_args=()
[[ -n "${OHHI_LOG_LEVEL:-}" ]] && env_args+=(--env "OHHI_LOG_LEVEL=$OHHI_LOG_LEVEL")
[[ -n "${OHHI_PUBLIC_ORIGINS:-}" ]] && env_args+=(--env "OHHI_PUBLIC_ORIGINS=$OHHI_PUBLIC_ORIGINS")
if ! timeout "${REGISTER_TIMEOUT:-300}" docker exec -u www-data "$NC" php occ app_api:app:register "$APP_ID" "$DAEMON" --info-xml /tmp/ohhi-info.xml --wait-finish ${env_args[@]+"${env_args[@]}"}; then
  docker exec "$NC" pkill -f "app_api:app:register $APP_ID" 2>/dev/null || true
  echo "error: register did not finish; the container's log:" >&2
  docker logs --tail 30 "nc_app_$APP_ID" >&2 || true
  exit 1
fi

# `register` may not deliver PUT /enabled to a fresh container (Cassini's
# lesson); the UI entries are registered from it, so cycle once if the
# container never logged it.
sleep 2
if ! docker logs "nc_app_$APP_ID" 2>&1 | grep -q 'enabled=1'; then
  log "no PUT /enabled seen: disable → enable"
  occ app_api:app:disable "$APP_ID" || true
  occ app_api:app:enable "$APP_ID"
fi

log "front proxy $SIDECAR on :$PORT (WebSocket-forwarding /exapps/)"
docker rm -f "$SIDECAR" >/dev/null 2>&1 || true
docker run -d --name "$SIDECAR" --network "$NETWORK" -p "$PORT:80" \
  -v "$here/dev/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine >/dev/null

log "done"
cat >&2 <<MSG
Open http://localhost:$PORT/apps/app_api/embedded/$APP_ID/app (sign in as admin, alice or bob).
Logs:      apps/nextcloud/scripts/nc-dev-logs.sh
Uninstall: apps/nextcloud/scripts/nc-dev-uninstall.sh
MSG
