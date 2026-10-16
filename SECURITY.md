# Security

Oh Hi markdown is an early work in progress. Security fixes go to `main` and
into the next release; there are no maintained older versions.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting: **Security › Report a vulnerability** on this
repository. It reaches the maintainers only, and we answer there. We aim to
acknowledge a report within a week; a fix and a line in
[docs/guide/changes.md](docs/guide/changes.md) follow as soon as we have one.

Tell us what you found, how to reproduce it, and which part it is in: the web
app, the desktop app, the relay, the `ohhi` CLI or MCP server, or the writing
harness.

## What to know before you report

**The relay can face the internet.** A relay (`apps/relay`) is the server
that shared folders sync through, and the recipe in
[docs/guide/relay.md](docs/guide/relay.md) puts one on a public hostname. By
design:

- A relay reachable from the internet is reachable by anyone. Each shared
  folder is protected by its share links: a link is a capability, and anyone
  holding one can open that folder. Creating and removing links needs the
  operator secret (`OPERATOR_SECRET`), which the people who share enter once
  per device.
- The relay stores shared folders **unencrypted**. Whoever runs it, and
  anyone with access to the machine or its backups, can read every folder
  shared through it. It never holds unshared notes, and it is never the only
  copy of anything.
- The admin routes (`/shares`) are protected by the operator secret alone.
  The relay has **no rate limiting and no abuse controls of its own yet**:
  put it behind a reverse proxy or a tunnel and limit there, and consider
  keeping `/shares` reachable only from your own network. The container
  binds to localhost; TLS and exposure are the proxy's or the tunnel's job.
- There is no end-to-end encryption. Content is protected in transit by the
  TLS you terminate in front of the relay, and at rest by nothing.

**Keys stay on the device.** The writing harness sends text only to the
provider you configured, and nothing leaves the device until you add one.
Provider keys and the relay's operator secret are kept on the device, never
written into the vault and never carried by sync.

**The desktop app** is a Tauri 2 shell with a content security policy, a
filesystem scope limited to the folders you picked, and an updater that
verifies releases against the minisign public key in
`apps/desktop/src-tauri/tauri.conf.json`.
[docs/desktop-builds.md](docs/desktop-builds.md) describes the policy and its
trade-offs.

**The web app** at [app.ohhi.md](https://app.ohhi.md) keeps a browser vault in
its origin's storage and talks only to the relay you choose and the AI
provider you configure.

Reports on any of this are welcome, and especially on anything that lets one
share link reach another folder, a client read data it was not given a link
to, or a page reach keys it should not.
