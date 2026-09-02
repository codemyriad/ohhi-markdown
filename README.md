# Editor

A collaborative, agent-native markdown editor — a drop-in replacement for Obsidian over a plain-markdown vault, with CRDT-based sharing, views over notes, and agents as first-class collaborators.

> "Editor" is a deliberately plain working name — the real name is still being chosen.

## Why

- Plain `.md` files on disk stay the source of truth — git, Claude Code, and Obsidian keep working on the same vault.
- Share a single note or a directory with your own devices or teammates; concurrent edits merge (CRDTs) — no `.sync-conflict` files, no git-style resolution ceremony.
- Self-hostable relay (Fly.io / cheap VPS), privacy and data-ownership first, offline-resilient.
- Agent-native: pull notes into context like Cursor does for code; route to cloud, local, or self-hosted models; agent personalities as skills living in the vault; tasks and flashcards built on special blocks + agent workflows.
- "Views over notes": collate notes onto spatial pages like a physical notepad.

## Status

Shaping → tracer bullet. See [`/plans`](./plans) — start with [`plans/frame.md`](./plans/frame.md), then [`plans/shaping.md`](./plans/shaping.md) and [`plans/slices.md`](./plans/slices.md).

## Running it

See the **[runbook](docs/running-and-testing.md)** — install, run the test suite, drive the two-tab collaboration demo in a browser, and (once set up) the Tauri desktop shell.

## Repo layout

Rush monorepo (same conventions as Edible): `apps/` for applications, `libs/` for shared libraries, `common/` for Rush config, `.claude/skills/` for agent skills, `/plans` for shaping and slice plans.
