#!/usr/bin/env bash
# DEV ONLY — for STUCK rows. The way to unenrol a vault is `DELETE
# /api/vaults/:id` (the shell's *Remove from Oh Hi*): it stops the custodian,
# removes the marker, the row, the store and the room. This script is for a
# row that API cannot reach (a broken store, a container that will not start).
#
# Forgets vault rows in the local stack's ExApp container: deletes the rows
# (and their recents) from ohhi.db and their custodian stores from the
# volume, then restarts the container so no custodian keeps running in memory.
# Never touches Nextcloud Files (delete the folder there yourself first).
#
#   scripts/nc-dev-forget-vaults.sh <vault-id>...
#   scripts/nc-dev-forget-vaults.sh --prefix OhhiE2E-   # every row whose owner_path starts with it
#
# The relay's docs for the room are left in relay.db (harmless; the room id is never reused).
set -euo pipefail
CONTAINER="${OHHI_NC_CONTAINER:-nc_app_ohhi}"
if [ "$#" -eq 0 ]; then
  echo "usage: $0 <vault-id>... | --prefix <owner_path prefix>" >&2
  exit 2
fi
if [ "$1" = "--prefix" ]; then
  [ -n "${2:-}" ] || { echo "--prefix needs a value" >&2; exit 2; }
  MODE=prefix; ARG="$2"
else
  MODE=ids; ARG="$*"
fi
docker exec -e MODE="$MODE" -e ARG="$ARG" "$CONTAINER" node -e '
const { readdirSync, rmSync } = require("node:fs")
const dir = "/app/common/temp/node_modules/.pnpm"
const pkg = readdirSync(dir).find((d) => d.startsWith("better-sqlite3@"))
const Database = require(`${dir}/${pkg}/node_modules/better-sqlite3`)
const db = new Database("/nc_app_ohhi_data/ohhi.db")
const rows = process.env.MODE === "prefix"
  ? db.prepare("SELECT id, owner_path FROM vaults WHERE substr(owner_path, 1, length(?)) = ?").all(process.env.ARG, process.env.ARG)
  : process.env.ARG.split(/\s+/).map((id) => db.prepare("SELECT id, owner_path FROM vaults WHERE id = ?").get(id)).filter(Boolean)
for (const r of rows) {
  if (!/^[0-9a-f-]{36}$/.test(r.id)) continue
  db.prepare("DELETE FROM vault_access WHERE vault_id = ?").run(r.id)
  db.prepare("DELETE FROM vaults WHERE id = ?").run(r.id)
  rmSync(`/nc_app_ohhi_data/vaults/${r.id}`, { recursive: true, force: true })
  console.log(`forgot ${r.id} (${r.owner_path})`)
}
if (rows.length === 0) console.log("nothing to forget")
'
docker restart "$CONTAINER" >/dev/null
echo "restarted $CONTAINER"
