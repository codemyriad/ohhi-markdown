---
name: testing
description: Testing patterns for the Editor repo, including the three-tier collab-correctness harness (fast-check model tests, reconciler fuzz, Playwright two-context smoke), unit tests with Vitest and Svelte Testing Library, and e2e tests with Playwright. Use this skill when writing, updating, or diagnosing tests.
metadata:
  repo: editor
---

## When to use this skill

Use this skill whenever you:

- Write or update tests for **sync, reconciler, or vault code** — the collab harness is the primary test surface in this repo.
- Write or update **unit tests** for Svelte components, stores, or utilities.
- Work on **e2e tests** using Playwright.
- Need to understand the project's expectations for **determinism**, **fixtures**, **fuzz corpora**, and **assertion style**.

If a task mentions tests (property, fuzz, unit, integration, or e2e), start here. Ground truth for the harness design: `plans/shaping.md` (part D9, Spikes) and `plans/slices.md` (V1 `testkit`).

---

## General testing principles

- **Collab correctness is first-class, from the first commit**: merge quality and sync-state truthfulness are tested properties, not hopes (requirement R7). New sync/reconciler behaviour ships with L0/L1 coverage in the same PR.
- **Minimise and isolate feedback loops**: run only the tests relevant to your change (a single test file, one fuzz fixture, a filtered Playwright run). Prefer small, targeted batches while iterating; use full suites for final verification or CI.
- **Prefer fixtures and helpers over ad-hoc setup**:
  - Centralise complex setup in `libs/testkit` — the TestNetwork, memfs fuzz driver, crash injection, seeded PRNG, and git-audit script live there. Extend them; do not re-implement per-spec.
  - Centralise Playwright app/relay startup in shared e2e fixtures.
- **Determinism over sleeps**: never `setTimeout`-and-hope in harness tests. Use the injected clock/scheduler (see Architectural rule below) and explicit delivery steps on the TestNetwork.
- **Every failure must be replayable**: seeds are printed on failure; a fix PR includes the shrunk counterexample as a permanent regression (see `fuzz-crashers/`).
- **Prefer semantic and accessible selectors** in UI tests:
  - Svelte Testing Library: `getByRole`, `getByLabelText`, etc.
  - Playwright: `page.getByRole`, `page.getByLabel`, etc.
  - Avoid `getByText` or raw selectors unless there is no better semantic hook.

---

## Architectural rule: injected clock/scheduler (lint-enforced)

All Editor-owned sync and reconciler code (`libs/sync`, `libs/vault`) takes an **injected clock/scheduler** — no direct `Date.now()`, `setTimeout`, `setInterval`, or ambient timers. This is enforced by a lint rule; third-party providers (Hocuspocus, y-* internals) are exempt.

Why: the harness must run thousands of simulated interleavings deterministically. If your change needs time or scheduling, thread it through the injected abstraction so L0/L1 can drive it.

---

## The three-tier collab harness

### L0 — Model-based property tests (fast-check + TestNetwork)

Fast, in-memory, per-PR. Tooling: **fast-check v4.8** model-based testing over a `TestNetwork` in `libs/testkit` (a port of the Yjs `testHelper` pattern).

- **TestNetwork primitives**: queued messages between simulated clients; `deliverOne`, `deliverAll`, `partition`, `reconnect`; a **seeded PRNG** drives all randomness.
- **Commands** model user/agent actions: insert, delete, open/close doc, go offline, rejoin.
- **Convergence is asserted on encoded CRDT state** (the D1 rule: state vector + delete-set digest), never on rendered text alone — delete-only updates must not be misclassified as "in sync".
- **Shrinking** yields a minimal failing edit script; the **replay seed is printed on failure**. Re-run with the seed before touching anything else:

```ts
fc.assert(model, { seed: failingSeed, path: failingPath });
```

**Guideline**: when adding a sync behaviour, add or extend an L0 command rather than writing a bespoke scenario test — the property machinery then explores interleavings you did not think of.

### L1 — Reconciler round-trip fuzz (memfs)

The reconciler is fuzzed on **memfs**, interleaving CRDT edits with **external file mutations** — git-shaped, Claude Code-shaped, and Obsidian-shaped writers (including Obsidian's frontmatter rewrites and stale-buffer echoes) — plus **crash injection** at write boundaries.

Scenario matrix includes: two-bridge double-ingestion, relay kill-9/restore, delete-only updates, rename×rename, partial writes, stale-buffer echo, two-device bootstrap, mass-change (git branch switch).

**Blocking invariants** (every fuzz run asserts all of them):

- Convergence across all replicas and disk.
- No data loss — no writer's edit silently disappears.
- **Byte-level EOL round-trip** (per-file EOL flavour/BOM preserved; untouched bytes stay untouched).
- **Valid frontmatter** after every merge.
- **Checkbox count and order** preserved.
- **Idempotence** — re-running the reconciler over a settled state changes nothing.

**Lighter two-session fixture pattern**: for folder-map behaviors (dir ops,
renames, tombstones) that don't need the full fuzz world,
`libs/vault/test/dir-ops.test.ts` establishes a TestNetwork-on-folder-docs-only
two-session fixture — prefer extending it over spinning up the whole L1 driver.

**`fuzz-crashers/` regression corpus**: every counterexample the fuzzer finds is shrunk and checked in as a permanent fixture, replayed on every CI run forever. Never delete entries; if one becomes obsolete, that is a design discussion, not a cleanup commit.

```bash
# Iterating on a single crasher
rushx test -- fuzz-crashers/0042-rename-x-rename.spec.ts
```

### L2 — Playwright two-context smoke

**Exactly ONE Chromium two-context smoke per PR.** Two browser contexts (two simulated devices/users) against a real relay, covering in a single spec:

1. Edit propagation between contexts.
2. Concurrent typing in the same note (no clobbering, cursors visible).
3. Offline → edit → reconnect → convergence (`context.setOffline(true/false)`).
4. **Sync-pill honesty** — the pill must read offline/pending while disconnected and only return to green when state is genuinely durable. Green must never lie.

Do not add more per-PR Playwright specs for collab paths — push the scenario down to L0/L1 instead. The **nightly cron** runs the smoke at **100× depth on a real tmpdir** (real filesystem, real watcher), which is where browser-level flake and FS edge cases are allowed to cost time.

---

## CI budget and deferred lanes

- **Per-PR harness budget: under 3 minutes.** L0/L1 use bounded `numRuns` per PR; nightly runs raise the bounds. If your fixture blows the budget, lower its per-PR bound and let nightly carry the depth — do not delete coverage.
- **Deferred / non-blocking** (never a per-PR gate):
  - **WebKit lane** — lands with the first macOS build; nightly and non-blocking first.
  - **5k-doc load probe** — gates full-vault migration (V4), not PRs.
  - **LLM merge-acceptability corpus** — offline-reviewed only, once dogfooding produces real divergence. **Never a CI gate**: acceptability has no ground truth.

---

## Unit tests (Vitest + Svelte Testing Library)

### Tooling

- **Vitest**: `describe`, `it`, `test`, `expect`, `vi`.
- **Svelte Testing Library**: `render`, `screen`, `cleanup`; `@testing-library/user-event` for interactions.
- **Svelte stores**: `writable`, `get` for store-level tests.

### Structure & lifecycle

- Use `afterEach` to call `cleanup()` and `vi.resetAllMocks()`.
- Use a clear **Arrange → Act → Assert** pattern.
- **Annotate tests with brief comments** describing the aim of each phase when it isn't obvious — this makes failures easier to interpret.

### Component tests

- Start the file with `// @vitest-environment jsdom` — `apps/web`'s vitest runs on node by default so the pure-module suites keep their own `localStorage` stubs. `src/test-setup.ts` loads the jest-dom matchers and stubs `ResizeObserver` / `scrollIntoView` (jsdom has no layout; Melt's positioning needs neither to be real).
- Use realistic props and interact via **roles** and `userEvent` rather than reaching into component internals.
- For event-driven or stateful components, wrap the component in a small **test harness** Svelte file (`src/lib/ui/test-harness/` for the primitives), track emitted events via explicit harness state, and assert on that — not on implementation details.
- Reference suite: `apps/web/src/lib/ui/*.test.ts` (Dialog, DropdownMenu, IconButton, Tabs, the form field).
- Strings: `src/test-setup.ts` loads the `en` dictionary, so `$LL`/`getLL()` resolve in tests. Prefer building expectations from the dictionary (`i18nObject('en')` — Edible's rule) over pasting English literals; the e2e specs still assert literals today, which is tolerated because `en` is the base and the text is byte-identical.
- Accessibility beyond one component is the **axe gate**, `apps/web/e2e/a11y.spec.ts` — part of `rushx e2e`.

### Store and pure-function tests

The sync UI is designed to be unit-testable without a browser:

- `syncRecord` is a plain reactive record (`{connected, pendingOps, diskMatchesCrdt, diverged, ...}`) and the pill status is a **pure function `f(record)`** — test the function exhaustively over record combinations, including partition states. The L2 smoke then only confirms the wiring.
- Reconciler helpers (escalation thresholds, quiesce detection, EOL restore) are pure or clock-injected — unit-test them directly with crafted inputs; leave interleaving exploration to L1.
- Cover edge cases explicitly: out-of-bounds operations, no-op transitions, state resets.

### Round-trip invariants in utilities

For codecs and serializers (frontmatter patching, EOL handling, update encoding), always cover:

- **Round-trip equality** (parse → patch → serialize leaves untouched bytes identical).
- **Error cases** (corrupted input, invalid YAML).
- A representative case from `fuzz-crashers/` if the utility has ever been implicated in one.

---

## E2E tests (Playwright)

### Key locations

- **Harness & fixtures**: `libs/testkit` (TestNetwork, fuzz driver, seeds, git-audit script).
- **Smoke spec**: the single two-context spec lives with the e2e config; nightly depth is the same spec parameterised.

### Fixtures and app setup

- Centralise startup in fixtures: relay process (or test relay), two browser contexts, a temp vault folder per test, share-token join flow.
- **Isolate state between tests**: per-test temp directories and fresh relay state; never share a vault folder across tests.
- After tests that write to a real vault folder, run the **git-audit script** (`git diff --stat` must be clean of churn — only intended changes).
- **The layout an e2e spec boots in is explicit.** `appUrl()` in `apps/web/e2e/fixtures.ts` adds `?layout=dense` (a session-only layout choice, `params.ts`) unless the spec passes `layout: null`; `MANAGER_URL` is `/?layout=dense`. Every spec written against the U2–U6 shell — anything that waits for the navigator column (`file-tree`) or the per-pane status bar — keeps the default `dense`. Since round 3 `dense` is not a built-in but an example file: `parseLayoutParam` maps the URL's `dense` to `custom:dense`, which the built-in root serves by name (a *stored* `dense` choice reads as `default`). A spec about the quiet default passes `layout: null` and gets a fresh profile's `default`; never change the fixture's default to make one spec pass.
- **Where the shell foundations are gated** (`apps/web/e2e/`): `layout.spec.ts` (the layout spec: `default` on a new install; Settings › Layout applies live, closes without asking, persists and *Reset to default* restores; a pin reads *(pinned)* with *Unpin*; no field combination hides `sync`; the palette's *Use layout file…* applies a vault file), `quiet.spec.ts` (the header — arrows, title, readouts, nothing overflowing at 480 px — the format bar, Focus mode, the drawer navigator, the format bar floating bottom centre / under the header without covering the last line, the word-count corner, the dock replacing the Note menu, the tab strip from one note with its `+` (round 4), `panes.open: "replace"`, the focus edge, the off-focus sync dot, the toolbar title as drag handle and tab menu — with axe at each surface), `shared.spec.ts` (two contexts over one relay: the Shared view, People, Changes by name, an honest outage, the onboarding), `dock.spec.ts` (the dock: strip, panel and tabs, Escape / `Mod+ArrowRight`, pinned it opens as the column and collapses back to the floating strip, the narrow-width `«`, hidden in Focus), `fonts.spec.ts` (the built app **and** a spawned `vite dev` load every face with zero console errors and zero failed requests; a WebKit case — skipped unless `npx playwright install webkit` — asserts body text is the static 400 face, since the Linux desktop webview is WebKitGTK), and `chrome.spec.ts` (the pinned rail as the dock panel; the drawer's badge and the Log view; the breadcrumb's folder popover; every chrome surface — the file tree included — measured in the interface font, Public Sans; code in JetBrains Mono). Testids that survived a rename on purpose: `toolbar-title`, `sync-pill-note`, `toolbar-vault-pill` and `data-status` on the `sync` icon — assert on them, not on the old components. `a11y.spec.ts` scans the default layout as well as the `dense` example.
- **Where the editor surface is gated (editor usability E1–E6).** Split by what only a browser can show. **Decoration-level unit tests** in `libs/editor-lang/test/` build a real `EditorState` and assert the decoration *set* — no DOM, because the reveal engine is a function of the state: `quote-setext-task.test.ts` (the provisional bullet on a lone `-`, the hanging `> `, done tasks), `list-preview.test.ts`, `callout.test.ts` (header parse, title row, box line classes, the view-only fold), `fence.test.ts` (auto-close, language ranking, copy text), `image.test.ts` (local `![]()` as the embed widget, remote as click-to-load or a link); the pure modules beside them — `link-completion.test.ts` (scope, ranking, what a pick writes), `table-ops.test.ts` / `table-commands.test.ts` (asserted on the document a key leaves, one transaction), `editing.test.ts` (bracket pairs, wrap-the-selection); `libs/editor/test/attachments.test.ts` and `format.test.ts`; `libs/workspace/test/write-attachment.test.ts` (journaled, never an overwrite). **E2e** in `apps/web/e2e/`: `editing.spec.ts` (the DOM caret after Tab, Tab off a list, the measured task box), `tables.spec.ts` (the Live grid, Tab / Enter in it, the hint bar, the `table.*` palette rows), `images.spec.ts` (a synthetic paste and drop carrying a real PNG; a remote image fetches nothing until *Load image*), `link-popover.spec.ts` (rows, footer, Tab writes a closed link). A new editor rule goes in the unit layer first; an e2e only for layout, focus or the real caret.
- **Unit-level rules that guard the resource formats** (`apps/web/src/lib/`): `command-ids.test.ts` builds every command table and fails on an id missing from `command-ids.ts`; `resource-schemas.test.ts` fails when `spec/ohhi.layout.v1` / `ohhi.keymap.v1`, `examples/` or the generated lists in `docs/customising.md` drift (fix: `cd apps/web && rushx gen-schemas`); `customising-docs.test.ts` validates every id and JSON example in that doc. Template and keymap tests pin the clock (golden rule 5); `libs/workspace/src` is in the clock-injection lint, so the event log and `RoomEventLog` take a `Clock` / scheduler too. Shared fixtures, not copies: `resources.fixture.ts` (a fake vault for the resource roots), `readouts.fixture.ts` (one `AppEvent` builder and a recording `ViewShell` — inject it with `viewShellContext`, since readouts and views take their verbs only from that context), `keymap.fixture.ts`. `libs/ui`'s `theme-contract.test.ts` holds the presence rules: each slot's ink (`--ed-presence-fg-N`) clears 4.5:1, and each slot sits more than 30 units from every sync colour.
- **Lists in Live are unit-tested at the decoration level** (`libs/editor-lang/test/list-preview.test.ts`): the bullet appears when the space after `-` is typed, stays drawn wherever the caret is after the marker, is raw only with the caret inside or just before it, and holds at depths 1–4 with tab indents; Tab / Shift+Tab and the Backspace-selects-the-marker rule live with the preview commands' tests. Caret placement next to a widget differs between engines (an empty item moved the caret in Firefox until only the dash was hidden), so a caret bug reported from one engine wants a decoration-level test, not only a Chromium e2e. `libs/ui`'s `theme-contract.test.ts` holds the list guide's rule as well.

### Test filtering and feedback loops

- By file: `rushx test:run path/to/spec.ts`
- By name: `rushx test:run -g "part of test name"`
- Headed/UI mode for debugging: `rushx test:open`

Prefer filtered runs while iterating; the full suite is for final verification or CI.

### Locator style and async behaviour

- Prefer **role-based** locators (`page.getByRole("button", { name: ... })`) and labels for inputs; `getByText` only when no better hook exists.
- Use explicit waits, never timing assumptions: `await expect(locator).toHaveText(...)` polls; convergence assertions should wait on the sync pill or document state, not on `waitForTimeout`.
- For offline scenarios use the context API and restore state at the end:

```ts
await contextB.setOffline(true);
// ...edit on both sides...
await contextB.setOffline(false);
// assert convergence + pill honesty
```

- **Exception — severing only the relay** (dev server must stay reachable,
  e.g. a reload-while-offline test): `context.setOffline` blocks everything
  including Vite. Use `page.routeWebSocket` with a test-side flag instead.
  Verified against Playwright 1.60 (M1 integration, `collab.spec.ts`): ws
  routes **survive `unrouteAll()` and only take effect after a navigation** —
  register the route before the `goto`, and flip the flag rather than
  unrouting. Before reloading "offline", wait for the pill to be green first:
  green is a durable-blob guarantee (Invariant D), so the wait is
  deterministic, not a sleep.

---

## How to extend this skill

When adding new tests or patterns:

- **Prefer**:
  - Extending `libs/testkit` (commands, writer shapes, crash points) over per-spec scaffolding.
  - Pushing collab scenarios down-tier: L0 if it fits the model, L1 if it needs the filesystem, L2 only if it needs a real browser.
  - Checking shrunk counterexamples into `fuzz-crashers/` with a descriptive name.
- **Avoid**:
  - Adding per-PR Playwright specs for collab paths (the one-smoke rule).
  - Real timers or ambient time in Editor-owned sync/reconciler code (lint will reject it).
  - Asserting convergence on rendered text instead of encoded CRDT state.

When the harness evolves (spike results landing — S1 join/re-seed, S3 frontmatter policy, S6 stale-echo interlock — or new lanes unlocking), update this SKILL to capture the new expectations.
