#!/bin/sh
# Entrypoint of the Oh Hi ExApp image (the shape of Cassini's exapp-start.sh).
#
# AppAPI injects APP_ID, APP_SECRET, APP_PORT, APP_HOST, APP_VERSION,
# AA_VERSION, NEXTCLOUD_URL and APP_PERSISTENT_STORAGE on every daemon; a HaRP
# daemon (without direct connect) adds HP_FRP_ADDRESS / HP_FRP_PORT /
# HP_SHARED_KEY and mounts mutual-TLS client certs at /certs/frp. With those,
# this writes /tmp/frpc.toml and runs frpc in the background so HaRP can reach
# the process; then it execs node (PID 1).
#
# Never echo APP_SECRET or HP_SHARED_KEY.
set -eu

log() { printf '[ohhi-start] %s\n' "$*" >&2; }

require_env() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    log "missing required env: $1"
    exit 2
  fi
}

require_env APP_SECRET
require_env APP_ID
require_env APP_PORT

log "APP_ID=${APP_ID} APP_VERSION=${APP_VERSION:-unset} AA_VERSION=${AA_VERSION:-unset} bind ${APP_HOST:-127.0.0.1}:${APP_PORT}"

if [ -n "${HP_FRP_ADDRESS:-}" ]; then
  require_env HP_FRP_PORT
  require_env HP_SHARED_KEY
  # HaRP's own cert is self-signed with CN/SAN harp.nc on every start: the
  # server name is a fixed magic value, never deployment-specific.
  tls_block=""
  if [ -f /certs/frp/client.crt ]; then
    tls_block='transport.tls.certFile = "/certs/frp/client.crt"
transport.tls.keyFile = "/certs/frp/client.key"
transport.tls.trustedCaFile = "/certs/frp/ca.crt"'
    log "frpc: mutual TLS (/certs/frp)"
  fi
  umask 077
  cat >/tmp/frpc.toml <<TOML
serverAddr = "${HP_FRP_ADDRESS}"
serverPort = ${HP_FRP_PORT}
loginFailExit = false
transport.tls.enable = true
transport.tls.serverName = "harp.nc"
${tls_block}
metadatas.token = "${HP_SHARED_KEY}"

# HaRP correlates /exapps/${APP_ID}/… with this backend by name + remotePort;
# without it every proxied request (AppAPI's heartbeat included) is a 503.
[[proxies]]
name = "${APP_ID}"
type = "tcp"
remotePort = ${APP_PORT}
localIP = "127.0.0.1"
localPort = ${APP_PORT}
TOML
  umask 022
  log "frpc -> ${HP_FRP_ADDRESS}:${HP_FRP_PORT}"
  frpc -c /tmp/frpc.toml &
else
  log "no HP_FRP_ADDRESS: direct-reachable daemon, frpc not started"
fi

# Nextcloud's CA bundle, as HaRP installed it (see the Dockerfile): Node reads
# its own CA store, so the custom CAs reach it through NODE_EXTRA_CA_CERTS.
if ls /usr/local/share/ca-certificates/*.crt >/dev/null 2>&1 && [ -z "${NODE_EXTRA_CA_CERTS:-}" ]; then
  for crt in /usr/local/share/ca-certificates/*.crt; do cat "$crt"; echo; done >/tmp/ohhi-extra-ca.pem
  export NODE_EXTRA_CA_CERTS=/tmp/ohhi-extra-ca.pem
  log "trusting $(grep -c 'BEGIN CERTIFICATE' /tmp/ohhi-extra-ca.pem) extra CA certificate(s) from Nextcloud"
fi

storage="${APP_PERSISTENT_STORAGE:-/data}"
if ! mkdir -p "$storage" 2>/dev/null || [ ! -w "$storage" ]; then
  log "WARNING: ${storage} is not writable by $(id -un): vault state cannot persist"
fi

exec node /app/apps/nextcloud/dist/server.mjs
