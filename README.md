# Oh hi markdown

A collaborative, agent-native markdown editor over a folder of plain `.md`
files: a drop-in replacement for Obsidian that keeps your notes as ordinary
files on disk, lets you share a note or a folder with your own devices or
your team through a relay you run, and treats agents as first-class
collaborators.

> **Early days.** Oh hi markdown is a work in progress. The people building
> it use it every day, and it is rough: features land fast, some are
> half-finished, and things change without ceremony. Try it, keep your notes
> in git or a backup as you would anyway, and tell us what breaks.

- **Try it in the browser:** [app.ohhi.md](https://app.ohhi.md). Nothing
  leaves your browser unless you add a relay or an AI provider.
- **Desktop builds and the project page:** [ohhi.md](https://ohhi.md).

## What it does

- **Files are canonical.** Your vault is a folder of markdown files. Oh hi
  markdown never holds the only copy; every write goes through a pre-image
  journal and an atomic rename, and frontmatter edits are surgical,
  byte-preserving patches, so git, Obsidian and any other tool keep working
  on the same folder with no spurious diffs.
- **Share a folder, edit it together.** Share one note or one folder with
  your devices or your teammates through a relay you run. Concurrent edits
  merge through CRDTs (Yjs): no `.sync-conflict` files, and a sync pill that
  never lies about whether the relay has your edits.
- **Agents as collaborators.** The `ohhi` CLI and the `ohhi mcp` server give
  any agent ranked search, outlines, sections, links and backlinks,
  collections and journaled writes over a vault
  ([docs/agent-access.md](docs/agent-access.md)). The in-app writing harness
  talks to the provider you choose — Anthropic, OpenAI, OpenRouter, any
  OpenAI-compatible endpoint or a local server — and sends nothing anywhere
  until you add one ([docs/writing-harness.md](docs/writing-harness.md)).
  Skills live in the vault.
- **Collections.** Notes as rows, in Obsidian's `.base` format: saved views
  over a folder whose frontmatter properties are the columns.
- **Yours to shape.** Layouts, keymaps, templates and themes are data files
  under the vault's `.ohhi/` folder ([docs/customising.md](docs/customising.md),
  [docs/theming.md](docs/theming.md)).

## Running it from source

The **[runbook](docs/running-and-testing.md)** covers the toolchain (Node 22,
Rush, pnpm), the test suite, the two-tab collaboration demo in a browser and
the desktop (Tauri 2) shell. In short:

```sh
rush install                     # or: node common/scripts/install-run-rush.js install
cd apps/web && rushx dev         # the web app
cd apps/desktop && rushx dev     # the desktop shell
```

The documentation index is [docs/README.md](docs/README.md): primers on the
ideas (a CRDT over plain text, LCA reconciliation, sync and the relay), the
architecture pages and the glossary.

## Running your own relay

Sharing goes through a relay: a small Node server (`apps/relay`) with a
Docker image, one SQLite file and one operator secret.
[docs/guide/relay.md](docs/guide/relay.md) is the recipe: start it, put TLS in
front with Caddy or publish it through a Cloudflare Tunnel, keep backups. A
relay that faces the internet is reachable by anyone; read
[SECURITY.md](SECURITY.md) before you expose one. The public web app and the
desktop builds are described in [docs/public-deploy.md](docs/public-deploy.md).

## Repo layout

A Rush monorepo. `apps/` holds the applications (`web`, `desktop`, `relay`,
`cli` for the `ohhi` binary, `site` for ohhi.md), `libs/` the shared
libraries (`sync`, `vault`, `workspace`, `editor`, `index`, `agent`,
`harness`, …), `docs/` the documentation, `spec/` the generated JSON schemas
of the agent contract and the resource formats, `examples/` example layouts,
keymaps and themes, and `.claude/skills/` the skills agents use to work in
this repo. [`CLAUDE.md`](CLAUDE.md) is the instruction file for coding agents,
and the shortest honest summary of the rules the code follows.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). It is early: open an issue before a
large change, and expect the ground to move.

## Licence

Oh hi markdown is free software under the
[GNU Affero General Public License v3](LICENSE) (SPDX: `AGPL-3.0-only`).
Contributions are accepted under the same licence.
