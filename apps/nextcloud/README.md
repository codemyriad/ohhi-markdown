# @ohhi/nextcloud

The Oh Hi **Nextcloud ExApp**: one Node process, deployed by Nextcloud's
AppAPI behind HaRP, that serves the web shell (in an iframe under
`/exapps/ohhi/ui/`), hosts the relay in-process, and runs a headless custodian
per Nextcloud Files folder enrolled as a vault (the folder is read and written
over WebDAV as the folder's owner).

The operator guide — install, the development loop on the local stack, a
bare run without Nextcloud, troubleshooting — is
[`docs/nextcloud.md`](../../docs/nextcloud.md); the design and its decisions
are the design note `nextcloud-build` (private; cited by decision number). The boot sequence is `src/main.ts`'s header.

## Layout

| File | What |
|---|---|
| `src/types.ts` | `VaultRow` (+ `VAULT_STATUSES`), `Access`, `SessionGrant`, `Hold`, `VaultStatus` (+ `reportedCustodian`); `Env` + `readEnv()` (refuses to start without `APP_SECRET`). Per-file disk state is `@ohhi/workspace`'s `DiskState` |
| `src/http.ts` | the dependency-free router and `ROUTES` — the one route table info.xml and the router share; `registerRoutes(router, handlers)` binds by route name, `addFallbacks` answers `501` for a declared route nothing bound; `fileIdOf` |
| `src/main.ts`, `src/clock.ts` | the entry and the process's one `RealClock` |
| `src/compose.ts` | `createService`: the relay (the one port), the vault service, one custodian per vault row, the token sweep, the access re-check, the free-disk watermark; `startCustodians` / `stopCustodians` |
| `src/handlers-vaults.ts` | `registerVaults(router, deps)`: `api/session`, `api/vaults`, `DELETE api/vaults/:id` (unenrol, owner only), `api/vaults/:id/status`, `api/vaults/:id/holds/:holdId` |
| `src/custodian.ts`, `marker.ts`, `holds.ts`, `files-status.ts` | the headless custodian (a `MountSession` over a `WebDavVaultAdapter`), its marker lease (the format is `@ohhi/vault`'s `formatHostMarker` / `parseHostMarker`), its held batches and its Files status |
| `src/db.ts`, `vaults.ts`, `permissions.ts`, `grants.ts`, `relay-auth.ts` | the vault rows, enrolment rules, `oc:permissions` → access, the short-lived relay tokens `api/session` mints, the relay's `authenticate` hook and live re-check |
| `src/appapi.ts` | the AppAPI header both ways: `verifyAppApiAuth` (constant time), `requireUser` / `requireEmptyUser`, `originAllowed` (the one origin rule — `Sec-Fetch-Site`, or an `Origin` whose host is the request's `Host`, `NEXTCLOUD_URL`'s, or in `OHHI_PUBLIC_ORIGINS`) + `requireSameOrigin` (POST/DELETE guard), `HttpError` + `withHttpErrors`, `readJson`, `ncFetch` (every outbound call: `NEXTCLOUD_URL`'s origin only, manual redirects, a clock timeout) and `ocsClient` over it |
| `src/every.ts` | the repeating-task loop on the injected clock (sweep, re-check, watermark, heartbeat) |
| `src/exapp.ts` | lifecycle: `/heartbeat`, `/init` (→ progress 100), `/enabled` (→ top menu, `ui/embed` script, Files menu); the Files entry "Open in Oh Hi" and its `api/files-action` handler |
| `src/ui.ts` | the static shell at `ui/` with our CSP (inline-script hash computed at startup), `ui/embed.js`, `img/app.svg` |
| `src/handlers-core.ts` | `registerCore(router, deps)`: the lifecycle, the Files action and the shell above, plus `api/me`, `healthz`, `admin/status` |
| `appinfo/info.xml` | the manifest; its `<routes>` equal `ROUTES`, the Files action included (`test/exapp.test.ts`) |
| `Dockerfile`, `start.sh` | the image (frpc + `rush deploy --scenario nextcloud` closure + the `build:nextcloud` / `build:embed` web builds, runs as `node`) and its entrypoint |
| `dev/nginx.conf`, `scripts/nc-dev-*.sh` | the local-stack front proxy and install / uninstall / logs |
| `test/fixtures.ts` | the tests' shared fixtures, a fake Nextcloud among them |

`rushx check` (tsc), `rushx test` (vitest), `rushx build` (esbuild →
`dist/server.mjs`, `better-sqlite3` external). No ambient time under `src/`:
`scripts/check-clock-injection.sh` scans it, and code that needs time takes
a `Clock` from `@ohhi/vault` (`main.ts` builds the one `RealClock`, from
`src/clock.ts`, and passes it down).

## Vault status

`GET /api/vaults/:id/status` → `{vault, custodian, reason?, holds, files, peers}`.
The owner always reads it; anyone else needs read access to the folder.

| `custodian` | `reason` | Meaning | What happens next |
|---|---|---|---|
| `enrolling` | | the folder is being read into the room; `files` counts the notes so far (the shell: "Enrolling… N of M") | `running` |
| `running` | | the custodian keeps the room and the folder in step | |
| `idle` | | between states: starting, stopped, or a boot that will be retried | the retry ladder (30 s → 5 min) |
| `needs-operator` | `folder-gone` | the folder was deleted, moved out of reach or unshared (3 walks found it gone); no walks, no heartbeats | re-probed on the retry ladder, resumes by itself when it is back; or *Remove from Oh Hi* |
| `needs-operator` | | a store, marker or room the custodian will not guess about (epoch mismatch, diverged first join, room silent at boot) | an operator |
| `lease-lost` | | another process holds the folder's marker | retried; takes over a stale lease |

The custodian also announces `holds` (a count) on the folder doc's awareness;
the shell reads this status the moment it moves, and every 5 s only while a
hold is on screen or an enrolment is in flight.

`DELETE /api/vaults/:id` (owner only, `X-Ohhi-Request` + same origin) unenrols:
the custodian stops and releases its lease, the marker is deleted from the
folder (when it names this vault), the row and its recents, the store and the
room on the relay go; the files stay. Only `active` rows count toward the
10-vault cap.

## Live smoke (the local stack)

After `scripts/nc-dev-install.sh`, with `admin` signed in through
`http://localhost:28090` (a Playwright context; every POST carries
`X-Ohhi-Request: 1` and is same-origin):

1. `GET /exapps/ohhi/api/me` → `{uid:'admin', displayName}`.
2. `MKCOL` `OhhiSmoke/` and `PUT` `OhhiSmoke/hello.md` over WebDAV as admin;
   `PROPFIND` its `oc:fileid`.
3. `POST /exapps/ohhi/api/vaults {fileId}` → a `VaultRow` (the same row again
   for an enrolled folder).
4. `POST /exapps/ohhi/api/session {vaultId}` → `{token, expiresAt,
   readOnly:false, room, vaultId}` (no relay URL: the shell's own origin's
   `/exapps/ohhi/ws`, here `ws://localhost:28090/exapps/ohhi/ws`).
5. `GET /exapps/ohhi/api/vaults/<id>/status` → `custodian:'running'`, the
   note's guid `match`.
6. A Hocuspocus client on `ws://localhost:28090/exapps/ohhi/ws` (the
   session cookie on the upgrade) with the grant's token: `<room>/folder` holds `hello.md`; an insert into
   `<room>/<guid>` (Y.Text `content`) reaches Files, and a `curl PUT` reaches
   the doc.
7. `alice` gets 403 from `POST /api/session {vaultId}` before a read share of
   `/OhhiSmoke` and `readOnly:true` right after it.

Measured 2026-10-11 (NC 35, HaRP): doc → Files 0.43–0.44 s; Files → doc
2.1 s with a peer (26.9 s before the join hint); folder doc sync 13 ms.

## Live e2e and bench (the local stack)

`apps/web/e2e/nextcloud-live.spec.ts` drives demos 1–3, holds, the marker
and a read-only share in two real browser sessions (admin, alice), with the
browsers' sockets as they are (no proxy shim: the origin rule admits the
upgrade's `Origin` by the request's `Host`). It is ignored by the default
`rushx e2e`; run it from `apps/web` with `OHHI_NC_E2E=1
OHHI_NC_ADMIN_PASSWORD=… OHHI_NC_ALICE_PASSWORD=… ./node_modules/.bin/playwright test
e2e/nextcloud-live.spec.ts` (the spec header has the full set of env vars and
where alice's password comes from).
It unenrols its vault through `DELETE /api/vaults/:id` at the end.
`scripts/nc-dev-forget-vaults.sh` is **dev-only**, for a stuck row the API
cannot reach: it deletes rows and stores from the container's volume and
restarts it.

Measured 2026-10-12 (NC 35, HaRP, no shim): 6 passed in 2.4 min; burst MOVE →
holds notice 0.29 s (was ~15 s on the blind poll); editor → Files bytes
1.6 s; Files PUT → editor 1.2 s; container restart → both pills green 1.8 s;
unshare → reader out 36 s.

## Bench

`OHHI_NC_ADMIN_PASSWORD=… node scripts/bench-enrol.mjs` uploads 1,000 notes
from `libs/workspace/bench/gen-vault.ts` (seed 42: 3.32 MB, 83 folders, depth ≤ 3)
over WebDAV at parallelism 8. It then enrols the folder, waits for the
custodian to run, and measures; it ends by deleting the folder in Files and
unenrolling the vault (`DELETE /api/vaults/:id`). Request counts come from
Nextcloud's access log (UA `node`). With `OHHI_LOG_LEVEL=debug`
(`OHHI_LOG_LEVEL=debug SKIP_BUILD=1 scripts/nc-dev-install.sh`) the
container logs each walk's cost: `walk incremental, 1 PROPFIND`.
Measured 2026-10-12 on NC 35, HaRP (the image with the 2026-10-12 e2e fixes):

| | |
|---|---|
| upload (83 MKCOL + 1,000 PUT, p8) | 146.3 s |
| `POST /api/vaults` | 1.18 s |
| enrol → `custodian: running`, `files` holds 1,000 `match` | 96.2 s (88 PROPFIND, 1,005 GET, 4 PUT); status `enrolling` with N of M throughout, then `running` |
| idle, no peer (120 s) | **2 PROPFIND/min** (one per 30 s walk), 2 GET + 2 PUT/min (the marker lease). Was 33.5 PROPFIND/min |
| Files PUT → custodian GET, no peer | 26.1 s (the walk interval's phase, ≤ 30 s) |
| Files PUT → custodian GET, Hocuspocus peer | 0.58 s; → the doc's text at the peer 0.77 s |
| peer: folder doc (1,083 entries) synced | 0.46 s |
| with a peer (60 s) | 32 PROPFIND/min (the 2 s active interval, one each), 7 GET/min |
| memory (`docker stats`) | 76 MiB before → 268 MiB after enrol → 235 MiB idle → 235 MiB with a peer |
| folder deleted in Files | `running` until the third walk without it: `needs-operator`, reason `folder-gone` at 90.5 s; one log line; then no walks and no heartbeats (8 PROPFIND + 4 GET in the 150 s window, all before the stop). No crash, no restart |

Idle walk cost, before: about 17 PROPFINDs per 30 s walk on this vault. The
walk itself was right (an unchanged tree is one PROPFIND); `list()` and
`listDirs()` re-listed every folder each call, and the enrolment's tail
(`bootScan`: both) fell inside the idle window — as would every Files-status
retry (`rescan`). They now walk from the watcher's table
(`libs/vault` `webdav-adapter.test.ts`, the 3-deep tree).
