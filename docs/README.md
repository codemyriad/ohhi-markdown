---
status: current
date: 2026-10-04
---

# Editor docs

Learning and reference documentation for the Editor project — a collaborative, agent-native markdown editor over a plain-markdown vault. These docs *teach the concepts*; the [plans](../plans/) remain ground truth for decisions ([frame](../plans/frame.md) → [shaping](../plans/shaping.md) → [slices](../plans/slices.md) → code).

## Index

| Doc | What it covers |
|---|---|
| [running-and-testing.md](running-and-testing.md) | **The runbook.** How to install the toolchain, run the test suite, drive the two-tab collaboration demo in a browser, launch the Tauri desktop shell, and troubleshoot. |
| [agent-access.md](agent-access.md) | **The agent surface.** The `ohhi` CLI, the `ohhi-vault` skill and the `ohhi mcp` server: installing them, naming a vault, the versioned `--json` contract and exit codes, every read and write operation, and how an agent's write coexists with a running app. |
| [customising.md](customising.md) | **Changing the app's own shape** (for people and agents). The `.ohhi/` resource root — layouts, keymaps, templates (themes: theming.md) — its folders and precedence, the `extends` + delta grammar, and every command, readout, region and view id (those lists are generated: `cd apps/web && rushx gen-schemas`). |
| [deploy-tailnet.md](deploy-tailnet.md) | **The team host.** The relay, web app and desktop update feed in one LXC on the team host, reachable only over the company tailnet: how a push to the `release` branch reaches everyone, one-time setup, teammate onboarding, operations and backups. |
| [desktop-builds.md](desktop-builds.md) | **Desktop releases.** continuous builds from the `release` branch, release assets, the auto-updater, installing on macOS and Linux, and the webview's Content Security Policy. |
| [recovery.md](recovery.md) | **When something goes wrong** (for dogfooders). Set up snapshots first; undo changes from snapshots; a failure-mode table (bad write, a teammate's delete, broken sync state, relay lost, browser storage cleared, machine lost); what to capture when reporting a problem. |
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
- **Plans win.** If a doc and [plans/shaping.md](../plans/shaping.md) disagree, the plan is right; fix the doc in the same change that surfaces the disagreement.
