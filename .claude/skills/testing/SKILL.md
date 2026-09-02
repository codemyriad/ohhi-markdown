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

- Use realistic props and interact via **roles** and `userEvent` rather than reaching into component internals.
- For event-driven components, wrap the component in a small **test harness** Svelte file, track emitted events via explicit harness state, and assert on that — not on implementation details.

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
