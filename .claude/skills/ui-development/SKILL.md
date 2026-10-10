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

**The shell's layout is data (quiet-shell F1–F9, foundations Stages 1–2 and
rounds 2–3).** What the shell draws is a resolved **layout spec**
(`lib/layout-spec.ts`, zod): `regions` (header `toolbar|breadcrumb`,
navigator `column|drawer|off`, rail `dock|column`, tabs `auto|always`,
statusbar `pane|merged`, format `bottom|top|off`, status `corner|off`),
`bars` (`toolbar.left`, `toolbar.center`, `toolbar.right`, `format`,
`statusbar`, `status`),
`toolbar.position`, `dock.position` (`top-right|bottom-right`), `panes`
(`borders`, `focusMark`, `lead`, `open: tab|replace`), `views`, `editor`
(`measure`, `typewriter`, `inlineTitle`) and `focus.keep`. A layout **file**
may `extends` another and edit lists with `+id` / `-id` / `"|"`; every file
goes through `upgradeLayout()`, which reads the old names (`extends:
"light"` / `"dense"`, `rail: "menu"`, `bars["toolbar.format"]`, readouts
`note.pill` / `people`) as today's — write the new ones. **One layout ships
built in, `default`** (`lib/layouts/default.json`: header = back / forward,
nothing in the centre, `sync`, the drawer and — with developer tools on —
the `inspector` bug icon; the tab strip from one note (`tabs: always`; `auto`
is still an option); the format bar floating at the editor's bottom; words ·
characters in the editor's corner; the navigator as a floating panel; the
rail as the dock; an inline title); `light`
and `dense` are aliases of it, and `dense` (the U2–U6 column shell) lives on
only as an **example file**, `lib/layouts/examples/dense.json`, which the
built-in root answers by name but never lists (the e2e fixtures' `?layout=dense`
→ `custom:dense`). Files are read by `lib/resources.svelte.ts` from ordered
**resource roots** — the vault's `.ohhi/<kind>/` → `~/.config/ohhi/<kind>/`
(desktop, read-only) → built-in; the vault wins — for the kinds `layouts`,
`keymaps`, `templates`. The app **never writes a layout file**: a person
picks one with the palette's *Use layout file…* (`layout.use-file`, the
`layouts` palette mode) and an agent writes them. On the device, three
layers: the active file → **overrides** (`config.layout.overrides`, a
`LayoutFile` delta; `applyOverrides`, `overridesFor`) → **pins**
(`config.layout.pins`, `navigator` / `rail` as a column; `applyPins`).
Settings › Layout (`LayoutSettings.svelte`) is **one live form** over the
overrides — curated fields only (files, sidebar + its corner, tabs, toolbar
position, format bar, word count, how notes open, line width, typewriter,
inline title), each applied under the dialog and persisted at once, *Reset to
default*, no Save, no dirty guard. `lib/shell-layout.svelte.ts` holds the
spec, the overrides, the pins (`pin` / `unpin` / `pinned` / `resetPins`)
and **seeds** the column toggles (`treeOpen`, `railOpen`) from it; after
that they are session-only (`sessionStorage`). The wiring lives in
`lib/customise.svelte.ts`; what every resource kind shares is
`lib/resource-kind.ts`. `treeWidth` persists through `config.ts` (on gesture
end, never per pointer-move). `app.reload-resources` re-reads the roots.
The regions' hosts: `components/ShellHeader.svelte` (whichever header the
layout draws, inside the always-present banner landmark, and the bottom
toolbar's footer); `components/Toolbar.svelte` (one
`role=toolbar`, roving focus, three **readout** groups; the `title` readout,
`toolbar-title`, is a strip-less pane's drag handle and tab menu wherever a
layout still puts it — `default`'s centre is empty because the strip names
the note); the strip's `+` sits after the last tab and docks left of the mode
control on overflow (`newTabDocks`, `lib/pane-chrome.ts`, over a
`ResizeObserver`); `components/FormatBar.svelte` (`bars.format`: **command
ids** rendered as buttons from the registry, folding into a *Format* menu at
narrow widths; a pill **floating inside the editor area** — bottom centre,
or under the header for `top` — in `EditorArea`'s floating layer, whose
height pads every CM6 scroller through `--ed-float-bottom` / `--ed-float-top`
so it never covers the last line); `components/CornerStatus.svelte`
(`bars.status`, by default `words` and `chars` — `note-count.svelte.ts`,
the note or the selection — floating bottom right in the same layer); the
mode menu is **not** a toolbar readout any more: the tab strip's own control
(`tab-mode:<pane>`) offers Live / Source / Reading; `components/NavigatorDrawer.svelte` (the unpinned navigator: the same
`Navigator` as a **non-modal floating panel** from the editor area's left
edge — no scrim, no focus trap, a click in the editor leaves it open, Escape
closes, a tree row drags onto a pane; the `Navigator`'s own 32 px header row
carries pin / unpin); the **dock**
(`components/Dock.svelte`, a floating icon strip at `dock.position` — the
collapsed form **always**, pinned or not — and `components/DockPanel.svelte`,
Links and History behind a compact `ui/Tabs` row (`size: 'sm'`, 32 px, 11 px
labels with `icon`s, pin and collapse in its `end` snippet — **pinned, unpin
only**, and `Mod+ArrowRight` then focuses its tab; a bottom-right strip
stacks above the corner count) — **one
panel for both expanded forms**: floating from `EditorArea`, or the pinned
rail column, `Rail.svelte` = `<Dock
form="column">`; one `railOpen` + one `railTab`, so a pinned column never
also opens a popover; testids `dock`, `dock-panel`, `rail-tab:<id>`,
`rail-pin` / `rail-unpin`); `components/InlineTitle.svelte` (an `<input>`
in an `<h1>`, mounted by `Pane.svelte` into the CM6 scroller, never part of
the document; it renames through `file-actions.renameNote` and reads
`--ed-title`); `Pane.svelte`'s strip / status bar / focus edge / off-focus
sync dot decided by the pure `lib/pane-chrome.ts`. **A readout is data, not
markup**: one entry in `READOUTS` (`lib/readouts.ts`; 14 ids plus the
aliases `note.pill` and `people`, which render `sync`) + its id in
`READOUT_IDS` + a component under `components/readouts/` that reads shell
state from a `ReadoutContext`, never per-pane props; it follows the focused
pane (`lib/readout-state.ts`). **Every readout bar renders through one
`components/BarItems.svelte`** — the toolbar's three groups and the per-pane
`StatusBar`'s `spec.bars.statusbar` alike, so the sync state everywhere *is*
the `sync` readout (`readouts/Sync.svelte`: the Shared view's glyph stroked
by the **unlayered** `[data-status] > .ed-sync-icon` rules, avatars beside
it, a who-is-where hover card, a click to Shared); never hand-place a readout
in a bar. **Verbs come only from the `ViewShell` context** (`lib/views.ts`,
`getViewShell()`): a readout or a view that opens a note or a view, creates
or pins calls it — there is no `open` on `ReadoutContext` and no
`onOpenPath` prop on a view; a component test injects a recording shell from
`lib/readouts.fixture.ts` (`viewShellContext`).
**The tables ARE the command table, for bars too**: every format-bar item is
a registry command id (or a `TOOLBAR_ITEM_IDS` entry such as
`format.paragraph-style`), every bar readout a catalogue id — never a button
written into a host. **Focus mode** (`view.focus`, `Mod+.`, `Escape` leaves)
hides every region outside `focus.keep` (`default` keeps the toolbar and the
format bar; the dock and the corner hide); the schema refuses
`regions.statusbar: "merged"` unless `regions.header` is `"toolbar"` (no other
bar would carry the merged `sync`; Settings does not offer either field), a spec whose on-screen bar lacks `sync`, and one whose `focus.keep`
would hide it (golden rule 4 in the file format). A layout's `views` decides
which view tabs the palette offers (`offersView`; empty = all). **A dock tab
is data**: `RAIL_SECTIONS` (`lib/layout.ts`, `links`,
`history`) plus its icon in `Dock.svelte`'s `DOCK_ICONS` and its body in
`DockPanel`. Agent-facing reference: `docs/customising.md`.
**The tab strip's end buttons are data too**: `bars.tabs` (command ids;
default `workspace.split-right`, `workspace.split-down`) drawn by
`StripCommands.svelte` from the registry, an icon per id in `COMMAND_ICONS`
(`lib/command-icons.ts`, the one icon table the format bar, its Settings
picker and the strip all read; an id without one is skipped with one warning) — faint until hovered or
focused, hidden in a strip under 36rem (a container query on the strip). **The
format bar is one row that never wraps** (`FormatBar.svelte`): it scrolls
sideways with a mask fade at whichever end has more, the wheel mapped to
horizontal; under 30rem it folds into one *Format* menu; which buttons it
shows is `FormatBarPicker` in Settings › Layout, writing `overrides.bars.format`.
**Pane keys** (`config.paneHints`, `pane-hints.svelte.ts`: `subtle` default ·
`full` · `off`): *Full* is `ModeBar.svelte` along the bottom; *Subtle* / *Off*
draw `ModeCue.svelte` in the focused pane's bottom-right, above the word count
(badge, two verbs from `mode-cue.ts`, `?` for all keys in a status card —
nothing in it is interactive, the keyboard belongs to the mode).

**The shell's composition (`App.svelte`, split 2026-09-20 — see
`plans/shell-structure.md`).** `App.svelte` is the composition root and the
three-way router (manager / connecting / workspace), ~500 lines, and nothing
else. Each concern is a runes module in `apps/web/src/lib/` built by a
`create*(host)` factory that takes what it needs as an explicit object and
exposes state through getters — the `createNavigation` / `createPanes` /
`createGroupUi` shape — so a `.test.ts` can drive it with a fake:
`session.svelte.ts` (the boot state machine: view, workspace, `bootGen`),
`manager.svelte.ts` (the registry mirrors and the four ways a vault gets in),
`share-actions.svelte.ts` (share dialogs + confirms), `file-actions.svelte.ts`
(tree ops, the shared `TreeOpDialog`, note creation), `daily.svelte.ts`,
`shell-layout.svelte.ts` (the spec, columns, folds, Focus, the drawer's read
state, toasts), `shell-commands.ts` (the ordered command registrations and
the capture-phase keydown), and since the foundations build
`resources.svelte.ts`, `keymap.svelte.ts`, `templates.svelte.ts`,
`customise.svelte.ts`, `note-count.svelte.ts` and `shared.svelte.ts`
(`plans/shell-structure.md` lists
them with their pure halves). The workspace markup is hosts under
`components/`: `Toolbar`, `Navigator` / `NavigatorDrawer`, `EditorArea`
(builds the `PaneRender` context and the strip's group snippets), `Rail`,
`WorkspaceDialogs` (everything that pops up for files and sharing) and
`GroupOverlays`; view tabs are `Inspector`, `LogView` and `SharedView`. **Adding a shell feature**: state and handlers go in the
module for its concern (or a new `create*` with a test), the markup in the
host that renders that region; `App.svelte` only gains a prop or a host
line. Strings in modules read `getLL()`, never `$LL`.

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

**Sharing and presence live where the thing is (sharing E1–E6; chrome U4's
*This note* is dissolved)**: presence is drawn in place from
`ui.presenceByPath` through the pure `lib/presence.ts` (on tree rows and mount
roots one `PresenceChip` — at most two initials, then the count; avatars in
tabs; beside the `sync` icon a stack capped at three + "+N", with a hover /
focus card of who is editing where — colours from the
presence band `--ed-presence-N` with initials in its ink `--ed-presence-fg-N`, **nothing when alone**; a theme's slots must clear 4.5:1 with their ink and sit 30+ units from every sync colour — `theme-contract.test.ts`). Where a folder
lives (Local / Shared by you / Shared with you, + relay) is the
**breadcrumb's folder popover** (`folderShareFacts`); the whole shared world
is the **Shared view** (`view: 'shared'`, `app.shared`, `Mod+Shift+S`) over
`SharedSnapshot` from `libs/workspace` — relays, shared folders (carved /
joined only; the root-linked vault is under *Your devices*), People (one fact
each: the note their caret is in), devices, Changes; a relay card says "in sync with the relay since …" / "last in sync …", never "durable" — green is relay receipt today. A room's relay is resolved once, by `roomRelayUrl` in `libs/workspace`. **The door is the `sync` icon** (`readouts/Sync.svelte`, round 2 P5): click
opens Shared; old testids (`sync-pill-note`, `toolbar-vault-pill`) and
`data-status` ride its button; the navigator's foot has no pill any more. In
the tree, `SyncPill` (the unlayered dot) still marks a row that is not
green. Access is **links and the labels you gave them, never
people** (`ShareSheet.svelte`; joining is `AddSharedFolderDialog.svelte`):
there is no identity until device-key tokens, and the copy says so. The header pill is
`scopedRollup` (`lib/share-status.ts`, pure): fed only by docs that have a
relay; with nothing shared it renders "Local vault · nothing shared" in
words, because a pill for an absence reads as a problem — the `sync` icon
falls back to it when no note with a relay is focused. Delete-only remote
edits carry no author; `libs/workspace`'s `attribution.ts` credits them to
the one peer whose awareness says the note is open (`here`), else the peer
last attributed there, else the relay.

**Events, flashes, the Log view and the drawer (spike S22, quiet-shell
F12/F13, Stages 4a + 4c)**: there is no `ui.error` string and no rail *Activity*.
Anything worth keeping goes into the one event log —
`workspace.notify({ level, code, params?, path?, room?, mount? })` for the
app's own complaints, `workspace.log(event)` for anything else — as an
`AppEvent` (`libs/workspace/src/events.ts`: kind, level, scope, actor,
`count`, a typed payload of **code + params, never words**) on the injected
clock in `ui.events` (newest first, capped; an immediate repeat folds into
`×N`). The app's own log is in memory; each mount's room log
(`RoomEventLog`, `<room>/events.json`) persists changes, peers and relay
state, and is merged in on open — history, so it never toasts. The words are chosen at render time by `describeEvent(event,
LL)` (`lib/event-text.ts`); a new notice code is a row in `NOTICE_TEXT` plus a
dictionary key. Feedback to a gesture the person just made (a refused drop, a
copy confirmation) is `workspace.flash({ level, text })`: toasted, never
logged. `shell-layout.svelte.ts` toasts each logged error/warning once (info
never; `toastsWhenLogged`) and each flash once; a component reports through an
`onNotice` prop, never by calling `toast()` itself. Two readers: the **Log
view** (`view: 'log'`, `components/LogView.svelte`, command `app.log`, one per
pane) filters by level chips, scope (all / this vault / a shared folder / this
note) and time over the pure `lib/log-view.ts`, offers *Copy as text* (a
plain-text report, with a select-it-yourself fallback) and *Clear* (confirmed);
the **drawer** (`components/readouts/Drawer.svelte`, the `drawer` readout —
the toolbar's right end, and in the dense header beside the rail toggle) is a
bell whose badge counts errors and warnings, plus other people's shared
changes, since `layout.lastSeenAt` (kept per vault on the device,
`config.drawerSeen`; opening the drawer marks seen) and whose `ui/Popover`
says what is in it in one line, then errors and warnings, then others'
changes **one row per note with names** (`groupForDrawer`, `lib/changes.ts`),
and one footer link, *Open the Log* (no count) — no *Open Shared*.
Both render rows through `EventRow.svelte` (level glyph in the semantic
`text-error`/`-warning`/`-info` colour — never the sync tokens — relative time
from the pure `relativeTime` re-read on a `clockTick`, scope, ×N, and a hint
for an error the app can help with). A view tab is a row in `VIEW_KINDS`
(`panes.ts`) plus a `ViewDef` in `lib/views.ts`. The developer-tools toggle
lives in Settings › Developer only.

**Settings (settings-shaping ST1–ST6)** is a **view tab**, one per window:
open it with `openView('settings', '<section>')` (or
`getViewShell()?.openSettings(section)`; `Mod+,` is `app.settings`), the
section riding as the tab's `viewArg`. With no vault open the manager shows
the same body as a page (`SettingsPage.svelte`); the tab is
`SettingsView.svelte`; both render `Settings.svelte` — the grouped nav (You ·
Editor · Layout · Appearance · Keys | Sync & devices · Customise · Agents |
Developer · About, `SETTINGS_GROUPS` in `lib/settings.ts`) and the section
on show. Each section is its own `*Settings.svelte` in `components/`. A
section in `NEEDS_VAULT` (Keys, Customise) says "open a vault" when none is
open rather than hiding. What a section may ask about where it is drawn
(vault open, its kind and folder, desktop, the host, moving to another
section) is the `SettingsEnv` context — `getSettingsEnv()` from
`settings-host.ts`; tests inject one with `settingsEnvContext(env)`.
**One save model, no Save button and no close guard:** every control
applies as it changes; a text field that validates (the name, the relay)
commits on Enter or blur; Keys writes each change through to a keymap file,
with Undo. File-backed sections carry a `ResourceSource` line (the file in
use and its root). The nav and the sections measure their own width
(container queries): below 32rem the nav is a `<select>` (`Tabs`'
`collapse`), and a section's grids use `@md:`-style container breakpoints,
never `sm:`, so a split pane gets the narrow layout. Test ids:
`settings-view` / `settings-page`, `settings` (with `data-section`),
`settings-tab:<id>`, `settings-section:<id>`, `settings-needs-vault:<id>`,
`settings-tabs-select`. Add a setting to the section it belongs to.

**Dismissal policy is per dialog and set at mount:** informational dialogs close on Escape *and* a click outside; a confirm (`role="alertdialog"`, `ConfirmDialog`, `BreakerDialog`) closes on Escape only — a stray click must not read as an answer; the divergence review closes on neither, it is resolved. `TreeContextMenu` predates Melt and already meets the contract (roving focus, Escape, focus return, disabled-with-reason); migrate it opportunistically, not speculatively.

**Component tests** live beside the primitive (`Dialog.test.ts`), start with `// @vitest-environment jsdom`, drive through `@testing-library/svelte` + `user-event`, and assert roles, names, focus and keys — never internals. A stateful primitive gets a harness in `src/lib/ui/test-harness/`. **The axe gate** is `apps/web/e2e/a11y.spec.ts`: it fails the e2e run on any violation, on every surface it opens; do not switch a rule off to pass it — list the reason and the slice that lifts it.

**Where things live**: `libs/ui` (tokens + themes, CSS only), `libs/editor`
(the CM6 surface and its theme), `libs/editor-lang` (markdown language
extras), `libs/index` (the derived index), `libs/i18n` (the dictionaries —
see *Strings and i18n* below), `apps/web/src/lib/components`
(the shell). Ground truth for UI decisions: `plans/v2-shaping.md`,
`plans/read-shaping.md` (the editing surface: view modes, live preview,
frontmatter, tags) and `docs/theming.md`, then `plans/shaping.md` /
`plans/slices.md`.

Storybook is not set up; add it later if needed.

### Design tokens — read `docs/theming.md` before touching colour

`libs/ui` owns the whole token system, in three bands driven by one
`data-theme` attribute on `<html>`:

| Band | Use it for | Examples |
|---|---|---|
| **A — chrome** (DaisyUI) | every app surface | `bg-base-100`, `bg-base-200`, `text-base-content/70`, `border-base-300`, `bg-primary text-primary-content`, `text-error`, `dui-btn` |
| **B — editor** (`--ed-*`) | anything inside or about the editing surface, and type everywhere | `bg-ed-surface`, `text-ed-wikilink`, `font-ed-ui` / `font-ed-prose` / `font-ed-mono` (never raw `font-sans` / `font-mono` — `check-design-tokens.sh` refuses them), or `var(--ed-h1)` from CM6 |
| **C — sync honesty** (`--ed-sync-*`) | the pill's dot and the `sync` icon (`.ed-sync-icon`), nothing else | `bg-ed-sync-ok` / `-pending` / `-diverged` / `-offline` |

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

## Strings and i18n — `libs/i18n` (`@ohhi/i18n`, typesafe-i18n)

**No hardcoded user-facing strings.** Every label, heading, placeholder,
`aria-label`, tooltip, dialog title/body, menu item, refusal reason, toast
title, command title and error message a user can read is a key in the
dictionary. The layout, the adapter and the habits are Edible's
(`@edible/shared/i18n`), so they transfer unchanged:

```
libs/i18n/.typesafe-i18n.json      { adapter: 'svelte', esmImports: true }
libs/i18n/src/i18n/en/index.ts     the ROOT dictionary: `common` (Cancel, Close, Save, Working…)
libs/i18n/src/i18n/en/web/index.ts the `web` NAMESPACE: the shell, grouped by surface
libs/i18n/src/i18n/i18n-*.ts       GENERATED (types, util, util.sync, util.async, svelte) — committed, never edited
libs/i18n/src/i18n/formatters.ts   per-locale formatters (hand-written; empty today)
libs/i18n/src/index.ts             re-exports the types + `getLL()`
```

**How to add a string.**

1. Put it in `en/web/index.ts` under the group for the surface that renders
   it (`manager`, `tree`, `settings`, `share.folder`, …). Keys are
   `snake_case`; arguments are typed — `'Rename {name:string}'`,
   `'{count:number} word{{s}}'` (plural), `'{state:string} · {host:string}'`.
   Only `en` is hand-written; other locales extend it
   (`extendDictionary(en, mergeTranslations(en, json))`) when they arrive.
2. `cd libs/i18n && rushx generate` (one-shot) — or keep `rushx typesafe-i18n`
   (watch mode, Edible's script name) running while you work. `rushx check`
   in `libs/i18n` regenerates and typechecks, so a stale generated file can
   never reach CI; the app's own `rushx check` fails on a key that does not
   exist.
3. Use it. In a component, subscribe to the store and alias the group:

   ```svelte
   <script lang="ts">
     import { LL } from '@ohhi/i18n/i18n-svelte'
     const t = $derived($LL.web.tree)
   </script>
   <h2>{t.files()}</h2>
   <IconButton label={targetDir ? t.new_note_in({ dir: targetDir }) : t.new_note()} … />
   ```

   In a module that is not a component (`.ts`, `.svelte.ts` — `tree-model`,
   `pill-status`, `navigation`, the workspace shim), call `getLL()` from
   `@ohhi/i18n` at the point of use: `getLL().web.tree.drop.already_there({ name })`.
   It reads the same store, so the module stays a pure function of its
   inputs and unit-tests on node — `apps/web/src/test-setup.ts` does
   `loadLocale('en'); setLocale('en')` first, as Edible's `vitest.setup` does.
4. A sentence with inline markup (`<code>`, `<em>`) renders `{@html t.key({ … })}`
   with the markup passed as arguments and any user- or config-derived text
   through `escapeHtml` (`apps/web/src/lib/html.ts`) — the Edible pattern;
   the dictionary never carries classes.

**What is not a dictionary key**: persisted identifiers (the default vault
name written into config, the `Anonymous` awareness name sent to peers, a
share's stored label) — those are data, and translating stored data would
change on a locale switch; glyphs (`▸`, `✕`, `…` after a truncated token);
and the developer inspector's field-name echoes (`connected true · synced
false`), which print record fields, not copy.

**Loading** happens once, in `apps/web/src/lib/i18n.ts` (`initI18n`): detect
(`detectLocale(navigatorDetector)`), `loadLocaleAsync` + `loadNamespaceAsync('web')`,
`setLocale` — then `main.ts` mounts. The store answers `''` before that, so
nothing renders early. Playwright asserts on the English text; a wording
change is a dictionary edit and its spec catches it. Not replicated from
Edible, on purpose: JSON export for translators and the Weblate preview
toolbar — a desktop app with one locale and no translators has nothing to
export; they return with the second locale.

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
  - **The same rule applies INSIDE those callbacks, and inside `onhandle`.**
    CM6 builds decorations, and the wrapper reports its handle, from within
    the `$effect` that creates the view — so a `$state`/`$derived` read in
    `resolve()` or in the `onhandle` callback becomes a dependency of the
    view's own lifecycle. Wrap them in `untrack()` (see
    `components/Pane.svelte`): without it, any change to the surrounding
    state rebuilds the editor, and a wrapper that writes state back on
    teardown (the pane tree's resume point) loops until Svelte throws
    `effect_update_depth_exceeded`.
  - Live-preview decorations (marker hiding, checkbox widgets, image embeds)
    land here in V2e — sliced X1–X4 in `plans/read-shaping.md`; see the
    block-widget pattern below. Footnotes, math, `%%` comments and
    transclusion stay out: the re-measured vault has **zero** of each.
    Callouts (Obsidian's `> [!type]±`) render as tinted boxes with view-only
    folding since E3 (`preview/callout*.ts`). Tables render as a grid in
    Reading and, since E4, in Live while the selection is outside the table —
    the moment the caret enters, the raw pipes are back (with column guides
    and the table hint bar, `preview/table-hint.ts`) and the `table.*` keys
    and commands edit it (`preview/table-commands.ts` over the pure
    `table-ops.ts`); HTML is never rendered, in any mode.

### Live-preview widgets — the block-widget pattern (`libs/editor-lang/src/preview/`, X1)

Everything Live and Reading render is a **decoration over unchanged bytes**.
Nothing rendered is ever inserted into the document, so the Y.Text, the undo
manager, the remote carets and `git diff` never see it
(`plans/read-shaping.md` B2 and Spike S12). Five rules carry that:

- **A widget is static DOM built in `toDOM`** — checkbox, bullet, `<hr>`,
  fence badge, image embed, the Reading table, the frontmatter tag strip. No
  Svelte component mounts inside CodeMirror: a widget is rebuilt whenever
  `eq()` says it differs, so it must be cheap and hold no reactive state.
  Anything it needs from the app — open a link, read an attachment, search a
  tag, a translated label — arrives through the `readHost` **Facet**, exactly
  as `wikiLinkHost` does and for the same reason (a prop the wrapper tracks
  would destroy the view).
- **Every hidden range is also an atomic range.** A `Decoration.replace` that
  hides a marker must be returned from `EditorView.atomicRanges` too, or the
  caret walks into text the reader cannot see. Whole-line furniture uses
  `Decoration.replace({ block: true })` over whole lines and is never nested
  inside an inline replacement.
- **Markers hide off the active region only.** `activeLines(selection, doc)`
  is a pure function with its own unit tests: a node whose range intersects an
  active line keeps its markers as plain text. `source` hides nothing;
  `reading` has no active lines. Keep that rule in the pure module — never in
  a widget, and never by reading the selection inside `toDOM`.
- **A widget edits by dispatching, like a keystroke.** The checkbox dispatches
  the one-character change `[ ]` ↔ `[x]`, which travels the path typing takes
  (Y.Text → peer → disk → one line in `git diff`). Never mutate a widget's DOM
  to *show* a change; re-render from the document.
- **List markers are the one exception to the caret's-line rule** (round 4;
  `plans/read-shaping.md` B2.3 amended): a bullet's `- ` renders as the
  bullet widget on the caret's line too, once complete, and turns back to
  text only while the selection is on the marker; an empty item hides only
  the dash; Backspace at the text's start first selects the marker; the
  widget is a plain inline span on the baseline, never an inline-block (CM6
  draws the caret beside a widget from its client rect, and an inline-block's
  rect is the whole line box, so the caret came out taller and higher). Tab / Shift+Tab indent / outdent list lines
  (`edit.indent-list` / `edit.outdent-list`, `libs/editor-lang`
  `preview/commands.ts`, bound in the editor's own keymap — not yet in
  `COMMAND_IDS`, so not rebindable from a keymap file). They SET the
  selection (`selectionAfterListEdit`, `assoc: 1`), never map it, so the DOM
  caret stays on the text side of the bullet. Off a list line Tab inserts a
  tab and Shift+Tab outdents (`insertIndent` / `indentLess`, below the list
  keys); Escape-then-Tab (CM6's tab-focus mode) is the keyboard way out.
  `proseEditing()` (`libs/editor-lang/src/editing.ts`) pairs `(`, `[`, `{` and the backtick
  — never quotes, they are apostrophes — and wraps a selection in `* _ = ~`.
  A lone `-` under a paragraph, caret on it, is a faint provisional bullet
  and the paragraph keeps its body style (fork D1, `preview/setext.ts`). Depth guides are a
  background over `--cm-list-depth`, sized by `--ed-list-indent` and
  painted `--ed-list-guide`. `libs/editor` and `libs/editor-lang` are read
  from source by `vite dev`: hard-reload after changing them (extensions are
  built when a view mounts).
- **Class names are `cm-*`, and every colour is a token.** The rules live in
  `libs/editor/src/theme.ts` and read `--ed-*` only — `docs/theming.md` lists
  the `(V2e)` entries and what reads each. A new construct usually needs no
  new token; if it does, the contract file and its test come first. A token
  whose value derives from DaisyUI's colours (`--ed-popover-*`, `--ed-drop-*`,
  `--ed-task-done-*`) lives **only in `_contract.css`** — a built-in theme
  restates a token only when its value differs (Nord's done-task grey). Every
  card the editor draws (code card, callout, popover, table hint, drop
  target) takes `--ed-card-radius`; every button a widget owns takes the one
  `--ed-focus-ring` rule; a state gets a semantic token (`--ed-code-copied`)
  rather than borrowing another construct's.
- **A button inside a widget owns its press** (the fence's language chip and
  *Copy*, the callout fold, a remote image's *Load image*): `mousedown`
  `preventDefault()`s so the caret does not move — a moved caret changes the
  active region and tears the widget down under the pointer — and `click`
  (Enter / Space too, it is a real `<button>`) runs the action — that is
  `claim(button, run)`, exported once from `preview/widgets.ts` and used by
  the code card, callouts, the table hint and the remote image. Every widget
  extends `ReadWidget` (mousedown and click reach the editor, nothing else);
  one with its own buttons answers `ownsEvent(event, selector) ||
  super.ignoreEvent(event)`, so a press elsewhere on it still puts the caret
  there. A picture drawn from a `blob:` URL extends `BlobWidget`, which
  revokes the URL when the widget goes.
- **Icons in decorations come from `preview/icons.ts`**: lucide's own node
  lists restated as data (decoration code runs outside Svelte, so no
  `@lucide/svelte`), `aria-hidden`, `currentColor` — the widgets' and the link
  popover's rows alike. Add an icon there, never an inline SVG path in a
  widget.
- **Widget copy travels as nested label groups** on `ReadHost.labels`
  (`code`, `callout`, `table`, `remoteImage`, `linkPopover`), each optional
  with an English `FALLBACK_*` exported from `@ohhi/editor-lang`. The shell
  builds them in ONE place, `editorLabels()` in `lib/read.svelte.ts`, which
  `Pane.svelte` hands to both hosts (`wikiLinkHost` takes `.linkPopover`).
- **The link popover is a CM6 autocomplete tooltip, not a `ui/` overlay** —
  the one exception to "overlays come from `apps/web/src/lib/ui/`". Its rules
  (scope per fork A2, ranking, what a pick writes and where the caret lands,
  share-relative targets) are pure in `libs/editor-lang/src/link-completion.ts`
  with unit tests; `link-completion-view.ts` turns them into the source, the
  rows, the one-line group headers and the key-hint footer. Its look is
  `theme.ts`'s autocomplete block over `--ed-popover-*` (dressed as
  `ui/Popover`). Every completion source registers in the single `override`
  array in `wikilink-view.ts`.
- **Paste and drop of pictures go through the `attachmentHost` Facet**
  (`libs/editor/src/attachments.ts`): the editor notices the files the host
  `accepts` (libs/workspace's `isAttachmentFile` — the editor keeps no type
  table of its own), hands them to the host, and inserts what it answers (`![[x.png]]`,
  `[[x.pdf]]`) in one transaction; without a host, CM6's own paste and drop
  run. Placement and naming are pure in `libs/workspace/src/attachments.ts`
  (Obsidian's `attachmentFolderPath`, the share keeps its pictures), the write
  is `writeAttachment` (journaled, atomic, never an overwrite), and the shell's
  host is `apps/web/src/lib/attachment-host.ts` (the shared-folder notice —
  golden rule 4: never imply peers have the bytes).

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

## The writing harness surfaces (writing-harness B4–B10)

Nothing here renders without a provider: gate a component on `aiEnabled()`
(`config.ts`), a command on `when: aiEnabled`, and a view on
`ViewContext.ai()` — *Settings › AI* is the one AI surface at rest. Strings
live under `$LL.web.ai.<area>` (one sub-object per area). Every command is a
registry id in `command-ids.ts` (golden rule 7). Docs: `docs/writing-harness.md`.

| Surface | Where | Test ids |
|---|---|---|
| Session view (a view tab, `app.session`) | `SessionView.svelte` + family | `session-view`, `session-empty`, `session-transcript`, `session-message` (`data-role`), `session-header`, `session-run-status` (`data-status`), `session-stop`, `session-retry`, `session-error` |
| Composer and `@` references | `SessionComposer.svelte`, `libs/editor/src/composer.ts` | `session-composer`, `session-composer-input`, `session-send`, `mention-menu`, `mention-option` (`data-kind`), `mention-chip` |
| Tool calls and proposals in the transcript | `ToolCard.svelte` | `tool-card` (`data-tool`, `data-state`), `tool-summary`, `tool-hits`, `tool-open` |
| Suggestions in the note | `libs/editor/src/suggestions.ts`, `suggestions.svelte.ts` | classes `ed-suggest-del` / `ed-suggest-add` / `ed-suggest-stale` |
| Comments | `CommentBubble.svelte`, `libs/editor/src/comments.ts`, `threads.svelte.ts` | `comment-bubble`, `comment-body`, `comment-submit`, `comment-send-agent`, `comment-resolve`, `comment-thread`, `thread-list`, `comment-marker:<id>` |
| The agent as a peer | `libs/workspace/src/agent-presence.ts`, `agent-presence.ts`, `libs/editor/src/working-highlight.ts` | the presence stack's `[data-peer="<name> (agent)"]`; class `ed-agent-working`; y-codemirror's `.cm-ySelectionInfo` |

Editor decorations follow one pattern (`comments.ts`, `suggestions.ts`,
`working-highlight.ts`): a `StateField` the host feeds with a `StateEffect`,
mapped through edits between sends, painted from a band-B token through
`var()`; a host-subscribing `ViewPlugin` pushes a microtask later, never
inside an update. Pass these as **stable** entries in `Pane.svelte`'s one
`extensions` array, reading the pane's path and doc **untracked**.

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
- **Shell primitives**: `apps/web/src/lib/ui/` (Melt-backed Dialog / menus / Tooltip / IconButton / Tabs / Toaster / Popover / form fields)
- **Layout spec, presets and resources**: `apps/web/src/lib/layout-spec.ts`, `lib/layouts/*.json`, `lib/resources.svelte.ts`; the toolbar `components/Toolbar.svelte`, readouts `components/readouts/` via `lib/readouts.ts`, view tabs via `lib/views.ts`
- **Bundled fonts**: `libs/ui/fonts/` + the generated `libs/ui/src/styles/fonts.css` (`cd libs/ui && rushx fonts`): Public Sans and JetBrains Mono, read through `--ed-font-*` only; no per-device choice. `vite dev` serves them through `server.fs.allow` in `apps/web/vite.config.ts`
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
