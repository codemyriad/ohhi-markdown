---
status: current
date: 2026-10-10
---

# Oh Hi markdown docs

Learning and reference documentation for Oh Hi markdown — a collaborative, agent-native markdown editor over a plain-markdown vault. These docs *teach the concepts*. The decisions behind them were made in the team's design notes (`frame` → `shaping` → `slices` → code), which are private: code and docs cite a note by name and decision id (`shaping` D5(a), `v2-shaping` Fork 1), and the reasoning that matters for working on the code is carried here. See [`CLAUDE.md`](../CLAUDE.md), *The design notes are private*.

## Index

| Doc | What it covers |
|---|---|
| [running-and-testing.md](running-and-testing.md) | **The runbook.** How to install the toolchain, run the test suite, drive the two-tab collaboration demo in a browser, launch the Tauri desktop shell, and troubleshoot. |
| [agent-access.md](agent-access.md) | **The agent surface.** The `ohhi` CLI, the `ohhi-vault` skill and the `ohhi mcp` server: installing them, naming a vault, the versioned `--json` contract and exit codes, every read and write operation, and how an agent's write coexists with a running app. |
| [writing-harness.md](writing-harness.md) | **The in-app agent.** The quiet default and the egress promise; providers (and the local-server CORS notes); sessions, references and `@`; suggestions, direct mode and *Undo agent edit*; the agent as a peer in a shared note; comments and *Send to agent*; skills in `.agents/skills/`, trust and the `.claude/skills/` farm; how `ohhi ask` relates; what is Later. |
| [customising.md](customising.md) | **Changing the app's own shape** (for people and agents). The `.ohhi/` resource root — layouts, keymaps, templates (themes: theming.md) — its folders and precedence, the `extends` + delta grammar, and every command, readout, region and view id (those lists are generated: `cd apps/web && rushx gen-schemas`). |
| [public-deploy.md](public-deploy.md) | **The public deployment.** `app.ohhi.md` (Cloudflare Pages) and `dist.ohhi.md` (R2): the two build flavours, the once-only Cloudflare and GitHub steps, what each push does (`main` → previews, `production` → app.ohhi.md, `site` → ohhi.md, `release` → the public desktop release on dist.ohhi.md), *Get the desktop app*, the settings a public repository needs, and the open questions. The company's own relay host is documented in the private `codemyriad/systems` repository; running a relay for your own group is [guide/relay.md](guide/relay.md). |
| [nextcloud.md](nextcloud.md) | **Oh Hi in Nextcloud.** The ExApp (`apps/nextcloud`): what it needs (AppAPI, a HaRP daemon, a WebSocket-forwarding front proxy) and what leaves the server (nothing) and what holds copies of note content, the three install steps, verifying, updating and uninstalling, what runs inside the container, the development loop on a local stack, and troubleshooting a vault's status. |
| [desktop-builds.md](desktop-builds.md) | **Desktop releases.** continuous builds from the `release` branch, release assets, the auto-updater, installing on macOS and Linux, and the webview's Content Security Policy. |
| [mobile-builds.md](mobile-builds.md) | **Android and iOS builds.** The mobile workflow (debug APK and Simulator app on a push to `release` or *Run workflow*, TestFlight on demand), where the artifacts land, the versioned iOS project, building iOS on a Mac over SSH, the TestFlight secrets, and what is not done yet. |
| [guide/](guide/) | **The guide pages, for teammates** (first-run E4): [getting started](guide/start.md), [sharing and the relay](guide/sharing.md), [when something goes wrong](guide/recovery.md) (snapshots, undo, the failure-mode table, reporting a problem — formerly `recovery.md`), [bringing notes from another app](guide/import.md), [running your own relay](guide/relay.md) and [what's new](guide/changes.md). Plain sentences, no repo knowledge assumed; rendered into the web build at `/guide/<page>.html` by `apps/web/scripts/build-guide.mjs` and opened from the app's Help menu. Neutral about the deployment: team-specific sentences come from build variables, never from these pages. |
| [theming.md](theming.md) | **The design system.** Three token bands driven by one `data-theme` attribute, why the sync-honesty tokens are unlayered, how CodeMirror is themed from the same tokens, the four built-in themes, and the Obsidian→Editor porting table for custom themes. |
| [glossary.md](glossary.md) | Every term a newcomer hits in this repo, alphabetical, cross-linked to the primers. |
| [primers/01-crdts-and-yjs.md](primers/01-crdts-and-yjs.md) | What a CRDT is and why; Yjs concretely — Y.Doc, Y.Text, updates, state vectors, delete sets (why heads = SV + DS), transactions/origins, awareness. |
| [primers/02-plain-text-crdt-over-markdown.md](primers/02-plain-text-crdt-over-markdown.md) | Why the CRDT runs over the literal markdown bytes vs rich-text trees and block models; round-trip fidelity; the moment.dev pt 2 critique; what we give up. |
| [primers/03-lca-reconciliation.md](primers/03-lca-reconciliation.md) | **The core primer.** Files canonical + CRDT alongside: the LCA/shadow-copy pattern, the classification matrix, the atomic-LCA-advance rule (and the dormancy data-loss bug it kills), escalation thresholds, the mass-change breaker. |
| [primers/04-engine-seam.md](primers/04-engine-seam.md) | The thin interface over the CRDT engine: why it exists (v14 migration, Loro hedge, invariant testing), what's in it, what deliberately isn't, and the no-yjs-imports-outside-libs/sync rule. |
| [primers/05-sync-and-relay.md](primers/05-sync-and-relay.md) | Sync end to end: always-on local docs, update exchange, the Hocuspocus relay as rendezvous, why offline needs no special machinery, sync-pill honesty, the sharing model. |

Suggested reading order for a newcomer: 01 → 02 → 03 → 04 → 05, with the glossary open in a split.

## Conventions

- **Docs-as-we-go.** Documentation is updated *in the same change* as the code or plan it describes — never as a follow-up task. A PR that changes behavior a doc describes, and doesn't touch the doc, is incomplete (same multi-level-consistency rule the plans follow; see [CLAUDE.md](../CLAUDE.md)).
- **Primers vs architecture.** `primers/` explain *concepts* — they should stay true even as implementations evolve. `architecture/` describes *our actual systems* as built (module-by-module, with file paths). Architecture docs are being written in parallel and will be listed here as they land.
- **Frontmatter.** Every doc carries `status:` (`current` | `superseded`) and a `date:` of last substantive revision.
- **Clean-room rule.** relay.md's plugin is MIT, but we describe its reconciliation ideas as general patterns in our own terminology and never copy or closely paraphrase its source. Our state machines are our own designs that honor the same proven invariants.
- **The design notes win.** If a doc and a design note disagree, the note is right; fix the doc in the same change that surfaces the disagreement.
