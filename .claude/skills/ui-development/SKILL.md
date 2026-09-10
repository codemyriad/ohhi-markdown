---
name: ui-development
description: Svelte 5, Tailwind, and CodeMirror 6 UI patterns for the Editor repo (collaborative markdown editor). Use this skill when building or updating UI components, the editor wrapper, sync-state indicators, or styles.
metadata:
  repo: editor
---

## When to use this skill

Use this skill whenever you:

- Implement or modify **Svelte UI components** (file tree, vault picker, divergence review, badges, pills).
- Work on the **CodeMirror 6 editor wrapper** or its Svelte integration.
- Work with **Tailwind CSS**.
- Build or change **sync-state UI** (pills, badges, rollups).
- Need to ensure **accessibility** and **test-friendly markup**.

If a task touches visual components, layout, or styles, start here before reaching for other skills.

---

## Design system & component libraries

This project uses:

- **Svelte 5** – runes-based reactivity (`$props`, `$state`, `$derived`, `$effect`, etc.).
- **Tailwind CSS v4** – utility-first CSS, CSS-first configuration (`@theme`, `@plugin`, `@layer`).
- **DaisyUI v5** – standard CSS components, `dui-` prefixed (the Edible convention). Adopted in slice V2a.
- **Melt UI** (`@melt-ui/svelte` 0.86 builders + the `@melt-ui/pp` preprocessor, as Edible) – every overlay, menu, tooltip and tab list. Adopted in chrome-shaping slice U1.
- **lucide** (`@lucide/svelte`) – icons. Always `aria-hidden="true"`, always beside a label (see `IconButton`).
- **zod** – form schemas; validation state via `createForm` (below). **Not Superforms**: it is built for SvelteKit form actions and this app has none (`plans/chrome-shaping.md` Fork 1).
- **CodeMirror 6** – the editor surface (see the integration pattern below).

### The primitives — `apps/web/src/lib/ui/` (read before building any chrome)

| Primitive | Use it for | Never |
|---|---|---|
| `Dialog` | every overlay: scrim, z-scale, portal, focus trap + restore, Escape, click-outside, `aria-labelledby`/`describedby` from `title`/`description` | a hand-rolled `fixed inset-0` |
| `DropdownMenu` + `MenuItem` + `MenuSeparator` | any list of actions behind a trigger — arrows, Home/End, typeahead, Escape, focus back on the trigger | a `role="menu"` div with an `onclick` |
| `Tooltip` | a label on hover **and keyboard focus**; the child spreads the trigger attrs itself (`focus` does not bubble) | `title=` as the only label |
| `IconButton` | an icon-only control: `aria-label` + tooltip from one `label`; `showLabel` for rail rows | an `<button>` with only an SVG in it |
| `Tabs` | one tab stop, arrows move, only the active panel in the DOM | a row of buttons toggling `{#if}`s |
| `Toaster` + `toast()` | announcing a notice without stealing focus (`role=status`, polite) | an inline error string in the header |
| `createForm` + `Field` / `TextControl` / `CheckControl` / `FieldErrors` / `Description` | any form with a rule in it — the field wires `aria-invalid`, `aria-required` and `aria-describedby` (description + errors) exactly as Edible's `form-field` builder does | inputs with ad-hoc `error` spans |

**The shell's layout (chrome U2)** is three columns under a one-line header:
the **navigator** (`data-testid="navigator"`: actions cluster → `FileTree` →
vault switcher + settings; resizable via `ResizeHandle`, a valued
`separator`), the editor `<main>` with `StatusBar` (word count + the note's
pill), and `RightRail` (collapsed = icon column, expanded = stacked foldable
sections). **A rail section is data, not markup**: push a `RailSection`
`{ id, label, icon, badge? }` onto `railSections` in `App.svelte` and render
its body in the rail's `children(id)` snippet — that is how U4's *This note*
and U5's *Activity* land. Layout state (`treeOpen`, `treeWidth`, `railOpen`,
`railFolded`) is device-level, normalised by the pure `lib/layout.ts` and
persisted through `config.ts` like the theme; the width persists on gesture
end, never per pointer-move.

**The tree's sync policy (chrome U3, Fork 3) is a pure module**,
`lib/tree-status.ts`: a file row shows its pill only when it is *not* green
(inside a shared folder) or only when *diverged* (outside one — a local file's
"offline" is the absence of a relay, not a state); a mount root carries the
rollup of its docs + its folder doc; a 2 px guide in the provenance tint marks
the shared subtree. Do not put status logic in `FileTree.svelte` — extend
`rowStatus` / `mountRollup` and their tests. Refusals explain themselves at
the point of refusal: `planDrop`'s reason renders on the hovered row
(`drop-refusal`) and as a toast on `dragend`. Sharing actions live in the
tree's context menu (`Share…`, `Add a shared folder here…`, disabled-with-
reason where mounts would nest) and the command palette — never in the header.

**Sharing and presence live where the thing is (chrome U4, Fork 2 C)**: the
rail's *This note* section (`NoteSection.svelte`) says where the open note
lives, whether that place is Local / Shared by you / Shared with you (+ relay
host), who is online **there** (`ui.presenceByRoom`, per room — the union
`ui.presence` survives only as the count on the rail icon), and who holds
access — **links and the labels you gave them, never people**: there is no
identity until device-key tokens, and the copy says so. The header pill is
`scopedRollup` (`lib/share-status.ts`, pure): fed only by docs that have a
relay; with nothing shared it renders "Local vault · nothing shared" in
words, because a pill for an absence reads as a problem. A shared folder's
tree badge carries its online count.

**Dismissal policy is per dialog and set at mount:** informational dialogs close on Escape *and* a click outside; a confirm (`role="alertdialog"`, `ConfirmDialog`, `BreakerDialog`) closes on Escape only — a stray click must not read as an answer; the divergence review closes on neither, it is resolved. `TreeContextMenu` predates Melt and already meets the contract (roving focus, Escape, focus return, disabled-with-reason); migrate it opportunistically, not speculatively.

**Component tests** live beside the primitive (`Dialog.test.ts`), start with `// @vitest-environment jsdom`, drive through `@testing-library/svelte` + `user-event`, and assert roles, names, focus and keys — never internals. A stateful primitive gets a harness in `src/lib/ui/test-harness/`. **The axe gate** is `apps/web/e2e/a11y.spec.ts`: it fails the e2e run on any violation, on every surface it opens; do not switch a rule off to pass it — list the reason and the slice that lifts it.

**Where things live**: `libs/ui` (tokens + themes, CSS only), `libs/editor`
(the CM6 surface and its theme), `libs/editor-lang` (markdown language
extras), `libs/index` (the derived index), `apps/web/src/lib/components`
(the shell). Ground truth for UI decisions: `plans/v2-shaping.md` and
`docs/theming.md`, then `plans/shaping.md` / `plans/slices.md`.

Storybook is not set up; add it later if needed.

### Design tokens — read `docs/theming.md` before touching colour

`libs/ui` owns the whole token system, in three bands driven by one
`data-theme` attribute on `<html>`:

| Band | Use it for | Examples |
|---|---|---|
| **A — chrome** (DaisyUI) | every app surface | `bg-base-100`, `bg-base-200`, `text-base-content/70`, `border-base-300`, `bg-primary text-primary-content`, `text-error`, `dui-btn` |
| **B — editor** (`--ed-*`) | anything inside or about the editing surface | `bg-ed-surface`, `text-ed-wikilink`, `font-ed-mono`, or `var(--ed-h1)` from CM6 |
| **C — sync honesty** (`--ed-sync-*`) | the pill and nothing else | `bg-ed-sync-ok` / `-pending` / `-diverged` / `-offline` |

**Rules, all enforced or load-bearing:**

- **Never write a raw palette utility** — no `bg-white`, `text-gray-500`,
  `border-blue-500`, `bg-black/30`. `scripts/check-design-tokens.sh` fails the
  build on them. A single one makes a panel ignore the theme, and it is
  invisible until someone switches to dark.
- **Muted text is `text-base-content/70` at the least — the contrast floor.**
  `/60` measures 4.19:1 on the light theme and `/40` 2.41:1; both fail WCAG AA
  and the axe gate. `scripts/check-design-tokens.sh` fails the build below
  `/70`. Hierarchy comes from size, weight and case, not from fading text.
  A genuinely inactive control (WCAG 1.4.3 exempts it) marks the line
  `contrast-exempt`. Likewise **never `text-primary` on a `bg-primary/N`
  tint** (3.8:1): a solid chip is `bg-primary text-primary-content` — the
  pairs DaisyUI guarantees — and a tinted row keeps body ink.
- **Never put a literal colour in a CM6 theme object.** `EditorView.theme()`
  injects one global stylesheet that never re-runs; use `var(--ed-*)`.
- **Never re-implement an overlay.** Use `Dialog` from `src/lib/ui/` (scrim,
  z-scale, Escape, click-outside, focus trap + restore) and `Palette.svelte`
  for anything list-and-filter shaped.
- **The sync tokens are unlayered on purpose.** Don't "tidy" them into a
  `@layer`: that is what stops an injected user theme from repainting the pill.
- Adding a token means adding it to `libs/ui/src/styles/tokens/_contract.css`
  with a default. `theme-contract.test.ts` asserts the contract, the sync-colour
  separation, contrast, and that no presence colour sits near the diverged red.

---

## Documentation lookup strategy

### Svelte MCP server (Svelte 5)

Always use the Svelte MCP server when:

- Building or updating Svelte 5 components.
- Working with runes (`$props()`, `$state()`, `$derived()`, `$effect()`, etc.).
- Understanding Svelte 5 snippet/slot patterns (for example `{@render ...}` instead of `<slot>`).
- Clarifying lifecycle rules, reactivity, or TypeScript integration.

### Context7 MCP server

Use Context7 when you are unsure about:

- Tailwind: available utilities and recommended patterns (responsive spacing, typography).
- CodeMirror 6: `EditorView` / `EditorState` APIs, extensions, keymaps, decorations, Compartments.

For the **vendored** libraries (y-codemirror.next, diff-match-patch, node-diff3), read the vendored source in this repo — upstream docs may not match what we ship.

### Inferring from existing code

Most of the time, especially for Tailwind, **prefer inference from this repo**:

- **First**: search for similar components or screens and mirror spacing, colors, and typography.
- **Then**: only reach for external docs (via Context7) when patterns in the repo are unclear or incomplete.

---

## CodeMirror 6 integration pattern (shaping D3)

The editor is **not Svelte-rendered DOM**. Svelte wraps and feeds CodeMirror; CM6 owns the editing surface.

- **Thin Svelte 5 wrapper component** owns the `EditorView`:
  - Create the view inside `$effect`, mounted into a bound container element.
  - Return a cleanup function that calls `view.destroy()`.
  - Never destroy/recreate the view in response to prop changes — reconfigure instead.
- **Compartments for reconfiguration**:
  - Wrap every configurable extension (read-only, keymaps, theme, language) in a CodeMirror `Compartment`.
  - Dispatch `compartment.reconfigure(...)` from `$effect` when the related prop or state changes.
- **Collab binding**:
  - The **vendored y-codemirror.next** binding connects the open doc's Y.Text and awareness (remote cursors/selections) to the view via `docSession`.
  - Document state flows through Yjs, not Svelte. Do not mirror editor content into `$state`; the Y.Doc is the source of truth.
- **Markdown language extras live in `libs/editor-lang`**:
  - Wikilinks shipped in V2c as a ~120-line `MarkdownConfig` on **upstream**
    `@codemirror/lang-markdown` — explicitly **not** a fork of
    `lezer-markdown-obsidian` (`plans/v2-shaping.md` Fork 3). Add new syntax
    the same way.
  - Host behaviour (resolve / open / create a link target) arrives through the
    `wikiLinkHost` **Facet**, never as a prop: a prop the wrapper tracks would
    destroy and rebuild the `EditorView` — losing cursor, scroll and undo — on
    every parent render.
  - Live-preview decorations (marker hiding, checkbox widgets, image embeds)
    land here in V2e. Tables, callouts and transclusion stay out: the real
    vault has 56 table rows and zero of the other two.

---

## Sync-state UI conventions (shaping D11)

- Each doc has a reactive **sync record**: `{connected, pendingOps, diskMatchesCrdt, diverged}`.
- The **sync pill** is a pure function: `f(syncRecord) → green | yellow | red | offline`.
  - Keep `f` a plain exported function — no component state, no side effects — so the test harness can assert it directly, including under relay kill and network partition.
  - The pill component only renders the result of `f`; it must contain no additional status logic.
- **Honesty rule**: the UI must **never show green unless the doc is durably synced**. When in doubt, degrade to yellow or offline. A stale green pill is a fatal bug, not a cosmetic one.
- Binaries are excluded from sync: badge them "not synced" in the file tree; the pill never claims them.
- V1 scope is a per-open-doc pill plus a tiny global rollup. Per-folder pills and durable-ack semantics land later — don't pre-build them.

---

## Example workflow: building a new component

1. Find similar components and review:
   - Markup structure.
   - Tailwind classes and tokens.
2. Implement with Svelte 5 runes:
   - Use `$props()` for props.
   - Use `$state()` for component-local state.
   - Use `$derived()` for derived values.
   - Use `$effect()` for side effects (including CM6 lifecycle, per the pattern above).
3. Style with Tailwind:
   - Stick to tokens and patterns used elsewhere in the repo.
4. Keep status/display logic in pure functions where tests need to assert it (sync pill rule above generalizes well).
5. Ensure accessibility (see best practices below).

---

## UI best practices

- **Consistency first**:
  - Mirror component structure, tokens, and spacing from existing components.
- **Svelte 5 runes standard**:
  - Prefer `$props`, `$state`, `$derived`, `$effect` over older Svelte patterns.
- **Tailwind v4 patterns**:
  - Use the CSS-first configuration with `@theme` and other modern Tailwind features.
  - `@theme inline` is mandatory for any token whose value is another `var()`.
  - Avoid bespoke inline styles when utilities suffice.
- **Accessibility** (the standard is Edible's; the gate is axe):
  - Use semantic elements and roles:
    - Buttons and links with proper roles and labels; icon-only controls through `IconButton`.
    - Dialogs, alerts, menus, tabs and forms through the `src/lib/ui/` primitives — they carry the ARIA.
  - Ensure keyboard navigation works:
    - Focus is visible (`focus-visible:outline-2 focus-visible:outline-primary`) and logical.
    - No keyboard traps (mind the CM6 boundary — Escape should be able to leave the editor).
  - This directly supports:
    - Screen-reader usage.
    - Automated tests that rely on `getByRole` and `getByLabelText`.
    - The `a11y.spec.ts` gate, which runs axe on every surface it opens.

---

## File locations

Key UI locations in this repo:

- **Svelte 5 app**: `apps/web` (hosted by the `apps/desktop` Tauri shell)
- **Shell primitives**: `apps/web/src/lib/ui/` (Melt-backed Dialog / menus / Tooltip / IconButton / Tabs / Toaster / form fields)
- **Editor wrapper + CM6 integration**: `libs/editor` (vendored y-codemirror.next lives with it)
- **Sync provider and sync records**: `libs/sync`
- **Ground truth for UI decisions**: `/plans/shaping.md` (D3 editor, D11 sync state) and `/plans/slices.md` (V1 UI affordances)

When adding components, prefer `apps/web` for app UI and `libs/editor` for anything touching the editor surface.

---

## How to extend this skill

When UI patterns or libraries change (for example adopting Melt UI, adding live-preview decorations, or Tailwind upgrades):

- Update this SKILL to reflect:
  - New recommended component approaches.
  - New design tokens or spacing rules.
  - Changes to the editor wrapper or sync-pill contracts.
- Keep instructions:
  - **Concrete** (point to specific components or patterns).
  - **Stable** (avoid duplicating fast-changing details from external docs; reference them via MCP instead).
