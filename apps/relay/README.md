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
```

Uses the same `DATA_DIR` as the server. Clients connect with
`HocuspocusProvider({ url, name: '<folderGuid>/<docGuid>', token })`.

## Deploy to Fly.io

`Dockerfile` and `fly.toml` are untested templates. Roughly:

```sh
fly apps create editor-relay          # or your own name; update fly.toml
fly volumes create relay_data --size 1
fly deploy
fly ssh console -C 'node --experimental-strip-types src/cli.ts share-add <folderGuid>'
```

One small VM, one volume. V1 runs with volume snapshots only; relay loss means
re-seeding coordination, not data loss (every enrolled doc lives in full on
each client). Litestream replication is scheduled with the V2 update-log work.

## Notes

- `@types/ws` is not in the workspace; tests use a minimal ambient shim
  (`test/ws.d.ts`) for the `ws` polyfill.
