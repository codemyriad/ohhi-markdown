# @editor/relay

Thin, self-hostable Hocuspocus v4 sync server (design: `docs/architecture/relay.md`).
Static per-share bearer tokens, doc names scoped as `<folderGuid>/<docGuid>`,
doc state persisted as blobs in SQLite. The relay is infrastructure, not
authority over content — files on disk stay canonical.

## Run locally

```sh
rushx dev                       # node --experimental-strip-types src/main.ts
# env: PORT (default 8787), DATA_DIR (default ./data)
```

Checks and tests:

```sh
rushx check                     # tsc --noEmit
rushx test                      # vitest integration tests (real server + providers)
```

## Create a share

A share grants one bearer token access to every doc under one folder GUID
(`<folderGuid>/...`, including `<folderGuid>/folder`). Tokens are handed to
joiners out-of-band (V1: paste it).

```sh
node --experimental-strip-types src/cli.ts share-add <folderGuid> [--read-only] [--label "laptop"]
# prints the token
node --experimental-strip-types src/cli.ts share-list
node --experimental-strip-types src/cli.ts share-rm <token>
node --experimental-strip-types src/cli.ts backup <destPath>   # online SQLite backup
```

Uses the same `DATA_DIR` as the server. Clients connect with
`HocuspocusProvider({ url, name: '<folderGuid>/<docGuid>', token })`.

## Operator admin API (in-app minting — M4)

Set `OPERATOR_SECRET` to enable an HTTP admin surface on the same port the
websocket uses (unset, the routes answer 404 and the CLI stays the only
mutation path):

```sh
OPERATOR_SECRET=my-secret node --experimental-strip-types src/main.ts
```

```
POST   /shares            { folderGuid, label?, readOnly? }  → { token, … }
GET    /shares[?folder=g]                                    → { shares: […] }
DELETE /shares/<token>                                       → { removed: true }
```

Every call requires `Authorization: Bearer $OPERATOR_SECRET`. CORS is `*` —
the credential is the bearer secret itself, and the web app calls it
cross-origin. Revoking a token blocks NEW connections only; live connections
persist until they reconnect. The app stores the secret in **Settings** and
uses this API for its one-click share flows.

`GET /healthz` needs no credential: `200 {"ok":true}` while the database
answers a read, `503 {"ok":false}` otherwise.

## Run in a container

`Dockerfile` builds from the **repo root** and installs dependencies from the
repo lockfile (`rush install` + `rush deploy`; the header explains why). No
architecture is hardcoded — the same file builds linux/amd64 and linux/arm64.

```sh
docker build -f apps/relay/Dockerfile -t ohhi-relay .    # from the repo root
printf 'OPERATOR_SECRET=%s\n' "$(openssl rand -hex 32)" > relay.env && chmod 600 relay.env
docker run -d --name ohhi-relay --restart unless-stopped --env-file relay.env \
  -p 127.0.0.1:8787:8787 -v ohhi-relay-data:/data ohhi-relay
```

Or, from `apps/relay`, `docker compose up -d --build` (`compose.yaml`: named
volume, git-ignored `.env` for the secret, loopback-only port, restart policy).

| Env | Image default | |
|---|---|---|
| `OPERATOR_SECRET` | unset | Enables the admin API. A runtime secret — env file or secret store, never baked into the image or committed. |
| `SEED_SHARE` | unset | Dev/e2e only (pre-creates known tokens). **Never set in production.** |
| `PORT` | `8787` | |
| `DATA_DIR` | `/data` | The volume. Owned by the image's non-root `node` user (uid 1000); `chown 1000:1000` a bind-mounted host dir. |

Node runs as PID 1 and handles `docker stop`'s SIGTERM itself: pending doc
stores are flushed, then it exits 0. The image's `HEALTHCHECK` polls
`/healthz`. Upgrading is rebuild + recreate; schema migrations are additive
and run on start.

### Behind Caddy

TLS terminates at the host's reverse proxy; the relay speaks plain HTTP and
ws on loopback. Caddy proxies websockets with no extra config:

```caddy
relay.ohhi.md {
	reverse_proxy 127.0.0.1:8787
}
```

Clients then use `wss://relay.ohhi.md`. (If Caddy itself runs in a
container, 127.0.0.1 is its own loopback: put both on one Docker network and
proxy to `ohhi-relay:8787` instead.)

### Shares and backups from the host

```sh
docker exec ohhi-relay node --experimental-strip-types src/cli.ts share-add <folderGuid> --label laptop
```

The relay is never the only copy of any content — every enrolled doc lives in
full on each client and the files live on disk — so losing it means
re-seeding shares, not losing data. A backup saves re-creating every share.
`cli.ts backup` uses SQLite's online backup API, so it runs against the live
relay. Nightly, keeping 14 days (`%` must be escaped in crontab):

```cron
# /etc/cron.d/ohhi-relay-backup
15 3 * * * root docker exec ohhi-relay node --experimental-strip-types src/cli.ts backup /data/backups/relay-$(date +\%F).db && docker exec ohhi-relay find /data/backups -name 'relay-*.db' -mtime +14 -delete
```

Backups on the relay's own volume survive a bad deploy, not a lost disk —
copy `/data/backups` off the host too if that matters. To restore, stop the
relay and swap the file in with the image's own user:

```sh
docker stop ohhi-relay
docker run --rm --volumes-from ohhi-relay ohhi-relay \
  sh -c 'cp /data/backups/relay-2026-09-10.db /data/relay.db && rm -f /data/relay.db-wal /data/relay.db-shm'
docker start ohhi-relay
```
