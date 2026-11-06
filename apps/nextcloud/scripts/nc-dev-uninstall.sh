#!/usr/bin/env bash
# Unregister the Oh Hi ExApp from the local Nextcloud stack and stop the dev
# front proxy. The app's volume (nc_app_ohhi_data) is KEPT: this never passes
# --rm-data. Remove it by hand with `docker volume rm nc_app_ohhi_data` if you
# really mean to drop every vault's server state.
set -euo pipefail
NC="${NC_CONTAINER:-spreedtest-nextcloud-1}"
SIDECAR="${NC_SIDECAR:-ohhi-rp-port}"
APP_ID=ohhi

docker exec "$NC" pkill -f "app_api:app:register $APP_ID" 2>/dev/null || true
if docker exec -u www-data "$NC" php occ app_api:app:list 2>/dev/null | grep -q "^$APP_ID "; then
  docker exec -u www-data "$NC" php occ app_api:app:unregister "$APP_ID" --force
fi
docker rm -f "nc_app_$APP_ID" >/dev/null 2>&1 || true
docker rm -f "$SIDECAR" >/dev/null 2>&1 || true
echo "unregistered $APP_ID (volume nc_app_${APP_ID}_data kept); $SIDECAR stopped"
