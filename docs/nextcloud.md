# Oh Hi in Nextcloud (the ExApp)

Oh Hi ships for Nextcloud as an **AppAPI external app** ("ExApp"): one
container, deployed by Nextcloud's AppAPI on a **HaRP** daemon, that

- serves the Oh Hi shell, which Nextcloud shows under its own top menu
  (**Oh Hi**) and in Files (**Open in Oh Hi** on a folder);
- runs the live-editing relay for the people editing together;
- keeps each enrolled Files folder and its notes in step, reading and writing
  the folder over Nextcloud's own WebDAV as the folder's owner.

The folder in Files stays the source of truth: notes are ordinary `.md`
files, every write goes through Nextcloud (versions kept), and who may read
or write a vault is whatever the folder's Nextcloud sharing says.

The package is `apps/nextcloud` (`@ohhi/nextcloud`). Its build brief is the
design note `nextcloud-build` — private, like every design note (see
`CLAUDE.md`) — cited here by decision number.

## What the app needs

- Nextcloud **32 to 36** with **AppAPI** enabled.
- A **HaRP** deploy daemon (next section). The Docker Socket Proxy daemon is
  deprecated upstream and not tested here.
- A front proxy that sends `/exapps/` to HaRP **with WebSocket upgrades**
  (Step 2) — the relay is a WebSocket.
- Nothing else: no extra Nextcloud apps, no environment variables, no
  outbound network access. `files_versions` is recommended (it is on by default).

## What leaves the server

**Nothing.** The container talks only to the Nextcloud that installed it
(OCS and WebDAV, at the daemon's `NEXTCLOUD_URL`) and to the browsers of
signed-in Nextcloud users, through Nextcloud's own proxy. It makes no other
outbound connection: no telemetry, no update check, no third-party service.
The shell it serves carries a Content Security Policy with
`connect-src 'self'`, so the page itself cannot reach anything but this
Nextcloud either.

**Privacy note.** Two places hold copies of note content besides the files
themselves, and both should be treated like Nextcloud data:

- the app's **persistent volume** (`nc_app_ohhi_data`, mounted at
  `/nc_app_ohhi_data`): the vault table, and per vault the live-editing
  state (the notes' text and its edit history) the relay and the folder's
  custodian keep. It is derived state — losing it costs a re-sync from the
  files, not the notes — but it is note content: back it up and delete it
  with the same care as the data directory, as one snapshot unit;
- each user's **browser** (origin-private storage under the Nextcloud
  origin, kept apart per Nextcloud user), as in every Oh Hi browser vault.

The AppAPI secret, session tokens and cookies are never logged; logs carry
room ids and AppAPI request ids only.

## Install

All `occ …` below are shorthand for however your deployment runs occ
(`sudo -u www-data php occ …`, `docker exec -u www-data <nc> php occ …`).

### Step 1 — A HaRP deploy daemon

Run HaRP beside a Docker engine (options in the
[HaRP README](https://github.com/nextcloud/HaRP)):

```bash
docker run \
  -e HP_SHARED_KEY="<a strong ascii key>" \
  -e NC_INSTANCE_URL="https://cloud.example.com" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$(pwd)"/certs:/certs \
  --name appapi-harp -h appapi-harp --restart unless-stopped \
  -p 8780:8780 -p 8782:8782 \
  -d ghcr.io/nextcloud/nextcloud-appapi-harp:release
```

Register it in **Administration settings → AppAPI → Register Daemon**
(template "HaRP Proxy") and run **Test deploy** from its menu. `occ
app_api:daemon:list` shows it afterwards.

### Step 2 — Route `/exapps/` to HaRP, upgrades included

AppAPI reaches a HaRP-hosted app through the **public** URL
(`https://cloud.example.com/exapps/ohhi/…`), and so do browsers. Your TLS
terminator must send `/exapps/` to HaRP's port 8780 — not to Nextcloud — and
must forward the `Upgrade` and `Connection` headers there, or the relay's
WebSocket never opens (the shell then shows "not in sync" forever).

Caddy does both by default:

```caddyfile
handle /exapps/* {
    reverse_proxy 127.0.0.1:8780        # HaRP
}
handle {
    reverse_proxy 127.0.0.1:11000       # Nextcloud
}
```

`handle`, not `handle_path`: HaRP routes on the full `/exapps/<appid>/…` path.
nginx needs the upgrade headers spelled out:

```nginx
location /exapps/ {
    proxy_pass http://127.0.0.1:8780;   # no path after the port: keep the prefix
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_read_timeout 3600s;
}
```

`apps/nextcloud/dev/nginx.conf` is a complete working example.

### Step 3 — Register the app

From the App Store: **Apps → Oh Hi → Deploy and enable**.

By hand, with the manifest from this repository:

```bash
occ app_api:app:register ohhi <daemon-name> \
  --info-xml /path/to/apps/nextcloud/appinfo/info.xml --wait-finish
occ app_api:app:list        # ohhi (Oh Hi): 0.1.0 [enabled]
```

AppAPI pulls `ghcr.io/codemyriad/ohhi-nextcloud:<image-tag>` (the tag is the
manifest's `<version>`), starts the container, waits for `/heartbeat`, calls
`/init` (the app answers and reports 100 %), then `PUT /enabled`, where the app
registers its top-menu entry, the script that hosts the shell, and the Files
entry **Open in Oh Hi** (folders). Re-enabling re-registers all three.

### Verify

- The container log (`docker logs nc_app_ohhi`) shows `[exapp] enabled=1`,
  `init: reported progress=100` and three `ui …: registered` lines.
- **Oh Hi** appears in the top menu; it opens the vault list inside Nextcloud.
- In Files, a folder's menu has **Open in Oh Hi**.

### Update and uninstall

```bash
occ app_api:app:update ohhi
occ app_api:app:unregister ohhi            # keeps the volume (vault state)
```

`--rm-data` also deletes the volume — every vault's live-editing state. The
files in Nextcloud are untouched either way.

## Inside the container

| Path | What |
|---|---|
| `GET /heartbeat`, `POST /init`, `PUT /enabled` | AppAPI lifecycle (undeclared routes; `/init` and `/enabled` require AppAPI's own header) |
| `ui/…` | the shell (`OHHI_WEB_DIST`, built with `--base /exapps/ohhi/ui/`) and `ui/embed.js` (`OHHI_EMBED_DIST`) |
| `img/app.svg` | the menu icon |
| `api/…`, `ws`, `healthz`, `admin/status` | the API and the relay (`nextcloud-build` §HTTP); `DELETE api/vaults/:id` unenrols (owner only) |
| `api/files-action` | the Files menu handler: answers `{redirect_handler: 'app'}`, and AppAPI opens the Oh Hi page with `?fileIds=<id>` |

Every request must carry a valid `AUTHORIZATION-APP-API` header (AppAPI and
HaRP add it; it is checked in constant time); every `POST` and `DELETE` also
needs `X-Ohhi-Request: 1` from the same origin, and the relay's WebSocket
upgrade an `Origin` too. "Same origin" is: `Sec-Fetch-Site: same-origin`, or
an `Origin` whose host (name and port; scheme ignored, TLS ends upstream)
equals the request's own `Host`, or `NEXTCLOUD_URL`'s host, or an origin
listed in **`OHHI_PUBLIC_ORIGINS`** (comma-separated, an optional deploy
variable in `info.xml`) — set it only when your front proxy rewrites `Host`.
`OHHI_LOG_LEVEL=debug` adds one log line per folder walk with its cost in
WebDAV requests. The image runs as the unprivileged
`node` user; `start.sh` starts `frpc` (the HaRP tunnel, mutual TLS with the
certs HaRP installs at `/certs/frp`) and then the Node process.

## Development loop (the local stack)

The local development stack is Cassini's harness (compose project `spreedtest`):
Nextcloud 35 at `http://localhost:28080`, AppAPI, and the HaRP daemon
`harp_local`, whose registry map sends `ghcr.io` to local images — a locally
built `ghcr.io/codemyriad/ohhi-nextcloud:<tag>` is used without a pull.

```bash
apps/nextcloud/scripts/nc-dev-install.sh      # docker build + (re)register + front proxy
SKIP_BUILD=1 apps/nextcloud/scripts/nc-dev-install.sh   # re-register the image you have
apps/nextcloud/scripts/nc-dev-logs.sh         # docker logs -f nc_app_ohhi
apps/nextcloud/scripts/nc-dev-uninstall.sh    # unregister (volume kept) + stop the proxy
```

The install script builds the image from the repo root, unregisters any
existing `ohhi` (never with `--rm-data`), registers it from
`appinfo/info.xml`, cycles disable → enable if the container never saw
`PUT /enabled`, and starts the sidecar `ohhi-rp-port` (nginx on
`spreedtest_default`, `dev/nginx.conf`) on **:28090** — the stack's own proxy
does not forward WebSocket upgrades. Then open
<http://localhost:28090/apps/app_api/embedded/ohhi/app> and sign in (`admin`,
`alice` or `bob`; the admin password is in the `spreedtest-nextcloud-1`
environment).

Without Nextcloud, the process runs bare:

```bash
cd apps/nextcloud && rushx build
APP_SECRET=dev APP_PORT=23000 OHHI_WEB_DIST=../web/dist-nextcloud OHHI_EMBED_DIST=../web/dist-embed rushx start
curl -H "authorization-app-api: $(printf 'alice:dev' | base64)" localhost:23000/api/me
```

## Troubleshooting

**Every route 404s through HaRP but works through `/index.php/apps/app_api/proxy/…`.**
HaRP matches the route patterns against the path *with* its leading slash;
AppAPI's PHP proxy strips it. Every `<url>` in `info.xml` must start `^\/?`
(and escape every `/`, since AppAPI wraps patterns in `/…/i`).
`test/exapp.test.ts` holds the manifest to that.

**The page loads but stays "not in sync"; no WebSocket in the network tab.**
The front proxy does not forward `Upgrade`/`Connection` on `/exapps/` (Step 2).
HaRP itself passes upgrades through (idle timeout 1800 s).

**`register --wait-finish` hangs; the container log repeats `connect to server error: EOF`.**
`frpc` is dialling HaRP without the mutual-TLS client certs. HaRP copies them
to `/certs/frp` in the container on first start, by running `mkdir -p` there as
the container's user — the image pre-creates `/certs/frp` and
`/usr/local/share/ca-certificates` because it runs as `node`; HaRP's log says
`Failed to create … cert dir` when that is missing. To recover a hung
register: `pkill -f "app_api:app:register ohhi"` in the Nextcloud container,
`occ app_api:app:unregister ohhi --force` (data kept), fix, register again.

**Re-registering over a live registration fails at `/init` with 401.** AppAPI
still holds the old secret. Unregister first (data kept), then register.

**`[enabled]` but no Oh Hi in the top menu.** The container never received
`PUT /enabled?enabled=1` (look for `enabled=1` in its log): usually Step 2's
route is missing. `occ app_api:app:disable ohhi && occ app_api:app:enable ohhi`
resends it.

**The log says `Nextcloud does not answer for the owner yet (app not enabled?); waiting`.**
Normal during a register: the container starts before AppAPI enables the app,
and Nextcloud refuses an ExApp's calls until then. The custodians start on
`enabled=1` (`custodian running (boot)` per vault). If it persists after
`enabled=1`, the vault's owner no longer exists or Nextcloud is unreachable
from the container (`NEXTCLOUD_URL`).

**A vault shows "Folder not found in Files" (`needs-operator`, reason `folder-gone`).**
Its folder was deleted, moved out of reach or unshared from its owner: after
three watch walks that found it gone, the custodian stopped (no walks, no
marker heartbeat, one log line). It re-probes on the retry ladder (30 s
doubling to 5 min) and resumes by itself when the folder is back (restored
from the trash, moved back). To let it go instead, the owner uses *Remove
from Oh Hi* (`DELETE /api/vaults/:id`): the files stay in Nextcloud, the
marker, the server's copy and the room are removed. Only `active` vaults
count toward the 10-vault cap.

**The relay refuses the browser's socket (`permission-denied`) though the page works.**
The upgrade's `Origin` matched none of the rule above: your proxy rewrites
`Host` on `/exapps/`. Forward it (`proxy_set_header Host $http_host`) or list
the public origin in `OHHI_PUBLIC_ORIGINS`.

**An external edit (Files upload, desktop client) takes up to 30 s to reach the
editor.** That is the idle WebDAV walk interval; it drops to 2 s while someone
has the vault open (and at once when a browser joins).

**Anything else.** `docker logs nc_app_ohhi` (the app), `docker logs
appapi-harp` (routing, cert installation), `nextcloud.log` (AppAPI). Logs never
contain the AppAPI header, a token or a cookie.
