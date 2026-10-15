# Theming

Editor's look is a **design system, not a stylesheet**: one token layer drives
every surface — the Svelte chrome and the CodeMirror editing surface alike — so
changing a theme is changing tokens in one place, never editing components.

Shaped in [`plans/v2-shaping.md`](../plans/v2-shaping.md) (Fork 2). Built in
slice **V2a**.

## Three bands, two attributes

Bands A and B hang off `data-theme` on `<html>`; band C hangs off
`data-polarity` (`light` | `dark`), which the app sets beside it from the
theme's polarity.

| Band | What | Owner | Cascade |
|---|---|---|---|
| **A — Chrome** | DaisyUI v5 semantic tokens: `--color-base-100/200/300`, `--color-base-content`, `primary`/`secondary`/`accent`/`neutral`, `info`/`success`/`warning`/`error` (each with a `-content` pair), `--radius-*`, `--size-*`, `--border`, `--depth`, `--noise` | `@plugin "daisyui/theme"` in `libs/ui/src/styles/tokens/*.css` | DaisyUI's own layers |
| **B — Editor** | `--ed-*`: surface/ink/measure, h1–h6, emphasis, code + 9 syntax slots, links and wikilinks, tags, frontmatter, block furniture, selection/caret/gutter, peer-cursor chrome, `--ed-presence-1..8` and their ink `--ed-presence-fg-1..8`, `--ed-group-1..8`, the pane and tab chrome | `libs/ui/src/styles/tokens/` | `@layer editor.tokens`, overridable by `@layer editor.user` |
| **C — Honesty** | `--ed-sync-ok` / `-pending` / `-diverged` / `-offline` (+ `-fg`), **one set per polarity** | `libs/ui/src/styles/sync-tokens.css` | **UNLAYERED**, chosen by `data-polarity` |

**Band C is chosen per polarity, not per theme** (themes review, 2026-10-15,
Fork 3-B). `sync-tokens.css` holds two sets — the light one on `:root` and
`[data-polarity='light']`, the dark one on `[data-polarity='dark']` — and
the dot and icon rules below follow the same two scopes. `lib/theme.svelte.ts`
sets the attribute whenever the theme resolves (a built-in's polarity is in
`DARK_THEMES`; a custom theme's is read off its `color-scheme` once its CSS is
in), and the pre-paint script in `index.html` sets it before first paint —
for a custom theme from the last polarity the app resolved
(`editor:polarity`, `K_POLARITY` in `config.ts`), since its CSS waits on the
vault. So every theme of a polarity shows the same four colours, and a custom
**dark** theme gets the dark-legible set (a per-theme band C left it the light
green and amber). A theme cannot set an attribute, so this gives a theme no
new reach and the sanitizer nothing new to strip. `theme-contract.test.ts`
refuses a `[data-theme]` selector in `sync-tokens.css`.

**Band C is defended twice, because once is not enough.** Cascade layers only
settle conflicts on the *same element*, and custom properties **inherit** — so
a theme containing `body { --ed-sync-ok: red }` would be the only declaration
on `<body>` and the pill would inherit it, layer priority never entering the
picture. So: (1) `sanitizeThemeCss()` strips the sync tokens, pill-targeting
rules and `!important` before injection; and (2) the dot's **colour and
geometry are unlayered longhands on the dot's own element** (`.ed-sync-dot`),
which an ancestor declaration cannot reach and a layered normal rule cannot
outrank. Since foundations round 2 (2026-10-06) the toolbar's and status
bar's sync state is an **icon**, not a dot — the `sync` readout — and it is
defended the same way: `.ed-sync-icon` and the `[data-status] > .ed-sync-icon`
rules in `sync-tokens.css` are unlayered longhands on the svg itself **and on
every shape inside it** (a layered `.lucide path { stroke: … }` lands on the
child, so an inherited stroke would lose), with `fill: none` and literal
per-polarity colours, so no theme can repaint, fill or hide it.
`apps/web/e2e/v2.spec.ts` attacks it rather than assuming it. That is golden rule 4 ("sync state
never lies") expressed in the cascade rather than in a code review — and it is
why offering user themes at all is safe, given a theme file travels with a
shared vault.

The sync colours are deliberately **not** DaisyUI's `success`/`warning`/
`error`/`neutral`:

1. Those are *brand* colours. Retinting `success` toward a marketing green
   would silently retint the honesty signal.
2. The four states are not four severities. `pill-status.ts` encodes
   `SEVERITY = {green:0, yellow:1, offline:2, red:3}` — `offline` outranks
   `yellow`. No severity ladder expresses that, so mapping onto one would lie
   by construction.

Colour is never the only channel: `SyncPill.svelte` also carries a `title`, an
`sr-only` label, and the `data-status` attribute Playwright asserts on.

## Rules that are easy to get silently wrong

- **`@theme inline` is mandatory** for any token whose value is another
  `var()`. Plain `@theme` resolves at `:root`, so a nested `[data-theme]`
  subtree would inherit the *outer* theme's computed colour and paint the wrong
  sync dot while every test passed.
- **`prefix: dui-` stays.** Not house style: unprefixed DaisyUI claims `.link`,
  `.table`, `.checkbox`, `.divider`, `.badge`, `.tab` — exactly the class names
  a markdown renderer and an Obsidian-shaped user theme want.
- **No literal colours in `libs/editor/src/theme.ts`.** `EditorView.theme()`
  injects ONE global stylesheet keyed on the spec object; a literal would
  freeze that colour for every theme and every view. Every value is
  `var(--ed-*)`, so switching `data-theme` restyles CodeMirror with no
  dispatch and no view recreation. The one exception is `EditorView.darkTheme`,
  a boolean facet in a `Compartment`.
- **Style both selection mechanisms.** `.cm-selectionBackground` (drawn) and
  `.cm-content ::selection` (native) are different things; miss either and the
  selection vanishes the day someone adds `drawSelection()`.
- **No `t.list` rule.** `@lezer/markdown` tags lists as `BulletList/...`, i.e.
  every descendant — colouring `t.list` tints all list *text*. The bullets are
  `ListMark`, which is `processingInstruction` (`--ed-marker`).
- **No raw palette utilities in components.** `scripts/check-design-tokens.sh`
  is a build gate: a single `bg-white` makes one panel ignore the theme, and the
  failure is invisible until someone switches to dark.
- **Muted text stops at `/70`.** The same script fails `text-base-content` at
  60% opacity or below: on the first `editor-light`, `/60` was 4.19:1 and `/40`
  2.41:1 against 4.5:1 required; on today's (Oh hi Light) `/60` is 4.05:1 and
  on Fjord Light 3.90:1, while `/70` clears 4.9:1 on every built-in's
  `base-100` and `base-200`. `text-primary` on a `bg-primary/15` tint is 3.8:1 for
  the same reason — solid chips use the `primary`/`primary-content` pair. The
  axe gate (`apps/web/e2e/a11y.spec.ts`) measures this on the rendered app.

## Group colours (`--ed-group-1..8`)

The eight colours a **tab group** can be painted in (W2, tab-groups-shaping
Fork 5-B): a chip's dot, its tint, and the 2 px cap over its tabs. A group
stores the slot *number*, never a hex, so switching theme retints every group
and a device-local group keeps its identity.

**Group colour is taste, not honesty** — a user theme may retint the whole
band, and two people's "CS reading" groups being different colours costs
nothing. Three things are not taste, and `theme-contract.test.ts` asserts
them: the band exists in every theme, the eight are far enough apart to tell
apart, and none of them is the **diverged red** — the same reservation the
presence band carries, because red means "your document diverged" in every
Editor theme. Each slot also clears 3:1 against `--color-base-100`; the dot is
a non-text graphic and WCAG 1.4.11 is the bar.

Separation from `--ed-sync-ok` / `-pending` / `-offline` is deliberately *not*
asserted: a palette's own green and yellow (Nord's, say) may sit near the sync
ok and pending, and a chip that carries the name you gave it, in the tab
strip, is not the pill in the status bar.

The four default pairs share **one light and one dark set** of group colours,
as they share the presence colours (themes review Fork 5-A, below); the Nord
example theme restates its own.

## Presence colours (`--ed-presence-1..8`, `--ed-presence-fg-1..8`)

The eight colours a peer is drawn in — their caret, and since sharing E1 the
initials on tree rows, tab avatars and the people stack. A peer is a **slot
number** (`presence.ts`), never a hex. Unlike groups, presence sits beside
the sync pill everywhere, so `theme-contract.test.ts` asserts more:

- no slot is the diverged red, nor within 60 units of it (the long-standing
  rule);
- **every slot is more than 30 units from every sync colour** (`ok`,
  `pending`, `offline`, `diverged`) of its theme's polarity — a peer's avatar must never
  read as a sync state (golden rule 4); this is what retinted editor-light's
  slot 3 (it *was* the pending amber, `#8a6300` → `#5b55b5`) and the Nord
  example's slots 2 and 4 (listed below);
- each slot has an **ink**, `--ed-presence-fg-N`, the colour initials are
  drawn in on it, which must clear **4.5:1** (WCAG 1.4.3 — initials are
  text). The light themes' ink is white; the dark themes' is near-black (`#14181d` in the four dark defaults, `#0b0e13` in the Nord Dark example). A custom
  theme that retints a slot must check its ink.

**The defaults share them** (themes review Fork 5-A): Oh hi, Graphite, Fjord
and Iris carry one light set and one dark set of presence colours, so a peer
keeps their colour when you switch between them — a peer's colour is
identity, not decoration. The Nord example restates its own; any custom
theme may.

## Panes & tabs (`--ed-pane-*`, `--ed-strip-bg`, `--ed-tab-*`, `--ed-group-cap`)

How the pane chrome **looks** (spike S21, quiet-shell F3). Whether a piece of
it **exists** — the strip, the per-pane status bar, the focus edge, the
"Pane 2 · 3 tabs" lead, the split hairline — is the layout spec's
(`regions.tabs`, `regions.statusbar`, `panes.focusMark`, `panes.lead`,
`panes.borders`), never a token. Every default is the value the chrome
painted before the tokens existed, so no built-in theme restates them.

| Token | Default | Read by |
|---|---|---|
| `--ed-pane-divider` | `var(--color-base-300)` | the 1 px hairline between two panes (`ResizeHandle`, inline); `panes.borders: "none"` paints it transparent, the separator stays focusable |
| `--ed-pane-focus` | `var(--color-primary)` | the focused pane's mark: the strip's bottom inset, and the top edge drawn when two or more panes are on screen. **Must clear 3:1 against `--color-base-100`** (`theme-contract.test.ts`, WCAG 1.4.11) |
| `--ed-pane-focus-width` | `2px` | both focus marks |
| `--ed-pane-mode` | `var(--color-accent)` | the outline on the focused pane while a pane mode (`Mod+P`) is live |
| `--ed-group-cap` | `2px` | the group's colour rule over its tabs |
| `--ed-strip-bg` | `var(--color-base-200)` | the tab strip |
| `--ed-tab-active-bg` | `var(--ed-surface)` | the selected tab, so it merges with the page under it |
| `--ed-tab-live` | `var(--color-primary)` | the dot on the selected tab |

Not here, on purpose: the **off-focus sync dot** an unfocused pane shows when
its note is not in sync (`regions.statusbar: "merged"`, golden rule 4). It is
the band C `.ed-sync-dot`, unlayered, out of reach of every theme.

## Suggestions (`--ed-suggest-del` / `-add` / `-stale`)

An agent's proposed edit is drawn in the note as track changes
(writing-harness B7): the text it would replace struck through in
`--ed-suggest-del`, the proposal inserted beside it in `--ed-suggest-add`, and
a proposal a peer's edit overtook — it will not be applied — dashed in
`--ed-suggest-stale`. They paint the `ed-suggest-*` classes from
`libs/editor/src/suggestions.ts`; nothing drawn is in the document. All three
are text colours, so `theme-contract.test.ts` asserts each clears 4.5:1 on
`--ed-surface`, that add and del stay apart, and that none sits near the
diverged red: a proposal is not a conflict.

## Type (`--ed-font-prose` / `-ui` / `-mono`)

Three roles: note text (CodeMirror and Reading), the chrome, and code. The
contract defaults are app-wide and **bundled** — **Public Sans** for prose and
UI (400, 500, 600 and a 400 italic) and **JetBrains Mono** for code (400,
500), each followed by the system stack — **static** woff2 instances, one file
per weight (a variable file is the suspected cause of body text rendering
bold in WebKitGTK, the Linux desktop webview — suspected, not confirmed: the
bold on Chris's desktop build is still unexplained; `fetch-fonts.mjs` refuses
a variable file either way), with `font-synthesis: none`
on `html` so nothing fakes a weight or slant — latin + latin-ext, OFL, 156 KB
in all, in
`libs/ui/fonts/`; `libs/ui/src/styles/fonts.css` is generated by
`cd libs/ui && rushx fonts`, and nothing is fetched at runtime. Under
`vite dev` the faces are served from `libs/ui/fonts/` through
`server.fs.allow` in `apps/web/vite.config.ts` (without it each one 403s).
A theme may redeclare any `--ed-font-*`; one that names another family gets
the system's copy or the fallback stack. There is **no per-device choice**:
since round 3 (Q7) Settings has no font pickers and the config no `fonts`.

**Every surface reads these tokens, Tailwind's included.** `base.css` points
Tailwind's own families at them — `--default-font-family` and `--font-sans`
at `--ed-font-ui`, `--default-mono-font-family` and `--font-mono` at
`--ed-font-mono` — because Preflight sets `html` and `code, kbd, samp, pre`
from those, and left alone they were Tailwind's `ui-sans-serif` /
`ui-monospace` stacks, which no theme could reach (the file tree's
font question in round 2). `scripts/check-design-tokens.sh` refuses a raw
`font-sans` / `font-serif` / `font-mono` utility in `apps/web` and
`libs/editor` — use `font-ed-ui` / `font-ed-prose` / `font-ed-mono`.
`chrome.spec.ts` asserts the tree renders in Public Sans in the browser, and
`fonts.spec.ts` that the build and `vite dev` load every face with no console
error or failed request; the desktop build is not yet measured.

## The live-preview tokens (marked `(V2e)` in the contract)

Seventeen contract entries carry a `(V2e)` comment. They were declared in V2a
with defensible defaults and read by **nothing**, because they describe
constructs no surface rendered yet — so a theme written in V2a would not need
editing when live preview landed. **X1–X4 (`plans/read-shaping.md`) are their
first readers** — sixteen of the seventeen, all of them read in
`libs/editor/src/theme.ts`. That file is the only place CodeMirror's classes
meet the token layer, which is what makes a rendered markdown surface
themeable at all (the "no literal colours in a CM6 theme object" rule above is
what buys it).

| Token | What reads it |
|---|---|
| `--ed-bullet` | the bullet widget — a filled dot 0.36em across after a 0.25em lead, centred on the x-height, about half an em from the text (E2, 2026-10-10) — that replaces `- ` the moment the space is typed, on the caret's line too; the marker is text only while the selection is on it (X1, amended 2026-10-06) |
| `--ed-list-indent` | *(not `(V2e)` — read since 2026-10-06)* the width of one list nesting level in Live and Reading: the tab stop on list lines and the bullet's own box, so a child's dot sits under its parent's text. Default `1.1em` (tightened from `1.6em` in E2). A task's box takes the same column, so a task's text lines up with a sibling bullet's. Source keeps the four-column tabs |
| `--ed-list-guide` | *(not `(V2e)` — read since 2026-10-06)* the 1px depth guide down each nesting level's children, drawn from the syntax tree's depth (a line class, no DOM measurement). Default `var(--ed-hr)` — the rule's hairline; `theme-contract.test.ts` asserts it resolves to `--ed-hr` in every built-in theme |
| `--ed-checkbox` / `--ed-checkbox-done` | the task box (a real `<input type=checkbox>` drawn with `appearance: none`, so the same 0.9em square in every engine: Chris's WebKitGTK screenshot, measured): `--ed-checkbox` is its 1px border, `--ed-checkbox-done` its fill and border once checked — the contract's `var(--ed-checkbox)`, which no built-in theme restates — with the tick in `--ed-surface`. 1,941 of them in the real vault (X1) |
| `--ed-task-done-fg` / `--ed-task-done-decoration` | a checked task's text (E2, fork C1): `var(--ed-ink-faint)`, and a whole `text-decoration` value — a 1px line-through in a 60% mix of the done ink |
| `--ed-mark-bg` / `--ed-mark-fg` | `==highlight==`, a new inline node (X1) |
| `--ed-code-bg` | the inline-code chip, once the backticks are hidden (X1) |
| `--ed-code-block-fg` | a fence's body text under its slab, beside the nine `--ed-syn-*` slots (X1) |
| `--ed-quote-border` | the blockquote's left border, once `> ` is hidden (X1). On the caret's line the revealed `> ` hangs in the line's padding beside it, out of the flow, so the text does not move; quotes are upright (E2) |
| `--ed-link-hover` | a rendered link under the pointer — in Live and Reading a plain click navigates (a finger's tap on a wikilink in Live shows the link card instead, QA round 1), so it must look clickable (X1) |
| `--ed-table-header-bg` / `--ed-table-row-alt-bg` / `--ed-table-border` | the Reading table widget, and Live's column guides over the raw pipes (X2) |
| `--ed-frontmatter-bg` / `--ed-frontmatter-border` | the YAML block's fencing while the caret is inside it (X3) |
| `--ed-tag-bg-hover` / `--ed-tag-radius` | the tag chip, both in the text and in the collapsed frontmatter strip (X4) |

`--ed-title` is the filename-as-title line, a different thing from `h1`. It
was declared and unread until round 2 (P3) gave Editor that line: the
**inline title** (`InlineTitle.svelte`, `editor.inlineTitle` in the layout),
an `<input>` inside an `<h1>` mounted in the editor's scroller above the note,
reads it.

## The editor usability tokens (`--ed-card-radius`, `--ed-focus-ring`, `--ed-popover-*`, `--ed-drop-*`, `--ed-code-copied`, `--ed-callout-*`, `--ed-task-done-*`)

Added by the editor usability pass (`plans/editor-usability-shaping.md`,
E1–E5, 2026-10-10). All of them are read only in `libs/editor/src/theme.ts`.
**A token whose value derives from the DaisyUI colours lives only in the
contract**: the popover, drop and done-task groups resolve from what every
theme already sets, so a built-in theme restates one only when its value
differs (the panes & tabs precedent). A custom theme may restate one too: the
Nord example's done-task grey is the case.
The callout colours are restated per built-in theme.

### Cards and focus (`--ed-card-radius`, `--ed-focus-ring`)

| Token | Default | Read by |
|---|---|---|
| `--ed-card-radius` | `8px` | every card the editor draws: the code card's corners, a callout's box, the link popover, the table hint and the link card (`.cm-tooltip`), the drop target |
| `--ed-focus-ring` | `var(--ed-caret)` | the one `:focus-visible` outline (2px) of the buttons a widget owns — the code card's language chip and *Copy*, a callout's chevron, a remote image's *Load image* |

### Link popover (`--ed-popover-*`)

The `[[` and `#` completion tooltip. CodeMirror draws it, but it is dressed as
the shell's `Popover` (`ui/Popover.svelte`: rounded, a base-300 hairline,
base-100, a large shadow) so the editor's one overlay matches the chrome.
Group headers are one line each; rows are compact single lines.

| Token | Default | Read by |
|---|---|---|
| `--ed-popover-bg` / `--ed-popover-ink` / `--ed-popover-border` | `base-100` / `base-content` / `base-300` | the tooltip box and its row text |
| `--ed-popover-muted` | content 75% into base-100 | group headers ("In Design team", "Only you · not in this share"), the footer's text |
| `--ed-popover-faint` | content 62% into base-100 | a row's folder (dim, right-aligned), the row icons |
| `--ed-popover-match` | `primary` | the matched letters, bolded, and the *Create* row |
| `--ed-popover-selected` | primary 13% | the selected row |
| `--ed-popover-footer-bg` | `base-200` | the key-hint footer (↵ / Tab link, `#` heading, `\|` alias, Esc) |
| `--ed-popover-shadow` | Tailwind's `shadow-xl` | the tooltip |

### Images (`--ed-drop-*`)

| Token | Default | Read by |
|---|---|---|
| `--ed-drop-border` | primary 60% | the dashed outline of the drop target drawn over the editor while image files are dragged onto it |
| `--ed-drop-bg` | primary 7% | the drop target's tint |
| `--ed-drop-ink` / `--ed-drop-muted` | `--ed-popover-ink` / `--ed-popover-muted` | the target's two lines ("Drop to add to this note", where it will be saved); the remote placeholder's text and button |

A remote `![alt](https://…)` waits in a dashed box (`--ed-code-border`) naming
its host until a click loads it; nothing is fetched by opening the note.

### Callouts (`--ed-callout-*`)

`> [!type] Title` boxes. Each type's colour does three things: tints the box
(`color-mix` 9%), draws its 1px hairline **all round** (26%; no coloured left
rail), and paints the title row and its lucide icon. The radius is
`--ed-card-radius`. The body stays `--ed-ink`.

| Token | Default | Types |
|---|---|---|
| `--ed-callout-note` | `primary` | note (and `info`, `todo` by default) |
| `--ed-callout-tip` | `--ed-syn-function` | tip, hint, important (and `abstract`) |
| `--ed-callout-success` | `success` | success, check, done |
| `--ed-callout-warning` | `warning` | warning, caution, attention |
| `--ed-callout-danger` | `error` | danger, error (and `failure`) |
| `--ed-callout-question` | `accent` | question, help, faq |
| `--ed-callout-bug` | `error` | bug |
| `--ed-callout-example` | `--ed-syn-keyword` | example |
| `--ed-callout-quote` | `--ed-ink-faint` | quote, cite |
| `--ed-callout-info` / `-abstract` / `-todo` / `-failure` | `note` / `tip` / `note` / `danger` | the four types that follow another by default; set one to give it its own colour |

Nine colours for Obsidian's thirteen types; the alias list is
`libs/editor-lang/src/preview/callout.ts`. A theme can repaint any of them,
and a type's colour must stay readable as text on the 9% tint of itself.

### Done tasks (`--ed-task-done-*`)

`--ed-task-done-fg` and `--ed-task-done-decoration` style a checked task's
text (fork C1: muted and struck). The row in the live-preview table above has
the defaults. A theme that wants fork C2 (muted only) sets
`--ed-task-done-decoration: none`.

### The code card (`--ed-code-copied`)

A fenced block is drawn as **one card**, from existing tokens but one: every line carries `--ed-code-block-bg` and the side hairlines in
`--ed-code-border`; the opening fence becomes a header bar (a language chip on
the left, *Copy* on the right, both in `--ed-ink-muted`, hovering to
`--ed-code-bg` / `--ed-ink`) and the closing fence a thin cap, each with the
top or bottom hairline and `--ed-card-radius`. When the caret is on a fence
line that line shows as text and takes the edge itself (`cm-code-first` /
`cm-code-last`), so there is never a seam. Body text is `--ed-code-block-fg`
with the `--ed-syn-*` slots; *Copied* flashes in `--ed-code-copied` (default
`var(--ed-callout-success)`), the one token the card adds.

## Comment threads (`--ed-comment-bg`, `--ed-comment-resolved-bg`)

The passage a comment thread hangs off (writing harness, B8) is tinted with
`--ed-comment-bg`; once the thread is resolved, with the fainter
`--ed-comment-resolved-bg`, so a settled discussion stays findable without
competing with the open ones. Both are read by `libs/editor/src/comments.ts`
(the `ed-comment` / `ed-comment-resolved` marks) and nothing else. The
built-ins use a violet tint on purpose: never the search yellow
(`--ed-search-match-*`) and never a sync colour — a comment is neither a
match nor a state. The thread's gutter dot and the active thread's underline
reuse `--ed-caret` (`--ed-gutter-fg` once resolved), so they need no token of
their own.

## The agent's working range (`--ed-agent-working-bg`)

While an in-app agent works on a shared note (writing harness, B10), the
passage it says it is on is shaded with `--ed-agent-working-bg` in every
editor that has the note open — yours and your peers'. It is read by
`libs/editor/src/working-highlight.ts` (the `ed-agent-working` mark) and
nothing else. It is a *presence* colour: the built-ins use a cyan tint,
which `theme-contract.test.ts` keeps away from every sync colour, the comment
violet and the search yellow. The agent's caret and its name tag
(`<name> (agent)`) are drawn like any peer's, from the presence slots.

## Theme switching

`ThemePref = 'system' | BuiltinTheme | 'custom:<name>'`, where `BuiltinTheme`
is one of the eight ids in `BUILTIN_THEMES` (`libs/ui/src/tokens.ts`, the
registry Settings › Appearance lists from — see *The built-in themes* below),
stored in `editor:config.theme` and mirrored to the `editor:theme` string key.
`system` resolves to `DEFAULT_LIGHT_THEME` / `DEFAULT_DARK_THEME`
(`editor-light` / `editor-dark`, Oh hi Light and Dark). Applying a theme also
sets `data-polarity` (band C) and mirrors it to `editor:polarity`.

A stored id that is no longer built in is read through `RETIRED_THEMES`
(`libs/ui/src/tokens.ts`): `nord-light` / `nord-dark`, saved before Nord left
the built-ins, read as `custom:nord-light` / `custom:nord-dark` — the vault
theme of the same name (`migrateThemePref` in `config.ts`; the pre-paint
script carries the same list, kept equal by `theme.test.ts`). See *The Nord
example* below for what happens when the open vault has no such folder.

`system` is resolved to an **explicit** `data-theme` at boot rather than left to
`:root:not([data-theme])`. DaisyUI's `--prefersdark` could handle band A in pure
CSS, but band B lives under `[data-theme="…"]` selectors and would need every
dark token duplicated inside a media query to match; one code path is worth more
than the CSS-only purity, and the boot script is synchronous so there is no
flash either way.

The mirror key exists because `config.ts` stores everything under one JSON blob
that grows with every vault, share and room token — `JSON.parse`-ing it on the
critical paint path for one string is wasteful and, worse, fragile. A missing or
corrupt mirror degrades to `system`, which is always defensible.

Theme is **device-level, not vault-level**: it is a preference about this
screen, and pushing it through the CRDT would make one collaborator's
aesthetics another's problem.

## Custom themes

A custom theme is a folder in the vault, `<vault>/.ohhi/themes/<name>/theme.css`
— deliberately the same shape as `.obsidian/themes/<name>/theme.css`. It
travels with the vault (a share, a synced folder), so every device that opens
the vault can use it; which theme a device *uses* stays device config.
(The folder was `.editor/themes/` before the rename; a vault made then needs
its theme folder moved by hand. On the desktop app, reading `.ohhi/` relies on
a file-access entry for dot-folders that has not yet been checked on a real
build — `plans/spike-resource-root.md` F0.)

**Settings › Appearance shows the difference** (Chris, 2026-10-15): the picker
is two groups.

- **Built in** — *System* and the eight themes that ship with the app
  (`BUILTIN_THEMES`, *The built-in themes* below).
- **In this vault** — every theme folder the open vault holds that has a
  `theme.css`, by its folder's name, the one in use pressed. The list comes
  from the resource loader (`resources.themes`, over the vault adapters'
  `listAppDirs` — the folder-shaped twin of `listAppDir`, on all four
  adapters) and is read again on a vault switch, on *Reload files* and, on the
  desktop, when a file under `.ohhi/themes/` changes; a theme in use re-reads
  its file then too, so editing it applies without a re-pick. With no vault
  open, or a vault with no theme folder, the group says so. Under it, the
  typed-name field stays as the fallback for a folder the list does not show,
  and the **example themes** the app ships that this vault lacks, each with
  *Add to this vault* (below).

Settings › Customise lists the same folders on its Theme row, under *Also
here*.

**Adding an example writes a file, on your say-so.** *Add to this vault*
writes the bundled example to `.ohhi/themes/<name>/theme.css` through
`Workspace.writeAppFile` — the pre-image journaled, then an atomic write
(golden rule 1; `plans/quiet-shell-shaping.md` F8: writes from Settings go
through the journal like every other app write). It never writes over a file
already there; it says so instead. The examples live in
[`examples/themes/`](../examples/themes/) — copying a folder from there into
a vault by hand, or having an agent do it, is the same thing.

**A theme the vault does not hold.** When the device's choice names a folder
the open vault lacks, the default of its polarity (Oh hi Light or Oh hi Dark)
stands in and the choice is kept: Appearance's source line and Customise's
Theme row say what stands in for what, and the theme comes back as soon as a
vault with the folder opens, or the folder is added.

Start from `libs/ui/src/styles/_template.css`; **the complete, authoritative
token list with a default for every entry is
`libs/ui/src/styles/tokens/_contract.css`** (146 tokens, grouped and commented;
the entries marked `(V2e)` are the live-preview band — see above for what
reads each one).

Four rules the file itself will not tell you:

- **One block, `[data-theme="<name>"]`**, where `<name>` matches the folder
  name. Set DaisyUI's `--color-*` and our `--ed-*` **directly** — bands A and
  B, nothing else. Do *not* write `@plugin "daisyui/theme"` — that is a
  compile-time Tailwind directive, and a stylesheet injected at runtime cannot
  use it.
- **Declare `color-scheme: dark` or `light`.** It picks CodeMirror's own base
  rules (scrollbars, panels, tooltip chrome), the native form-control
  palette, **and which of band C's two sets of sync colours your theme gets**
  (`data-polarity`). Omit it and Editor falls back to your OS preference,
  which will be wrong half the time. The sync colours themselves are out of a
  theme's reach either way.
- **Names are `[\w -]{1,64}`** — letters, digits, spaces, `-`, `_`. Anything
  else is refused (and not listed), because the name becomes both a path
  segment and a `[data-theme]` value.
- **Until the vault is read, the default of its polarity stands in.** The
  pre-paint script cannot read a vault-resident theme, so it shows Oh hi Light
  or Oh hi Dark by the polarity the app last resolved for the theme
  (`editor:polarity`), and the theme replaces it once the vault opens. Its
  sync colours are right from the first frame.

Editor injects the file into `@layer editor.user`.

`sanitizeThemeCss()` strips, in order: comments, `@import`, `@charset` /
`@namespace`, any declaration using `image-set()` / `cross-fade()`, every
non-`data:` `url()`, every `--ed-sync-*` declaration, every rule targeting the
pill, and **`!important` itself**. **This is not hygiene**: a theme folder
arrives with the vault, i.e. it is another person's content, and CSS `url()` is
a working beacon out of a local-first app. Ship fonts as `data:` URIs or not at
all.

The `!important` strip is the non-obvious one, and it is why the whole scheme
holds. For **normal** declarations, unlayered has the *highest* priority — so
our unlayered pill rules beat a themed one. For **important** declarations,
layer order **reverses** and unlayered has the *lowest* — so a theme's
`.ed-sync-dot { background: red !important }` would beat anything we could
write in CSS. There is no cascade-level defence against that; removing
`!important` at load is the defence, and a theme has no legitimate need for it
anyway since it already sits in the highest-priority normal layer.

### Obsidian → Editor token map

| Obsidian | Editor |
|---|---|
| `--background-primary` | `--ed-surface` (and usually `--color-base-100`) |
| `--background-secondary` | `--color-base-200` |
| `--background-secondary-alt` / `--background-modifier-border` | `--color-base-300` |
| `--text-normal` / `--text-muted` / `--text-faint` | `--ed-ink` / `--ed-ink-muted` / `--ed-ink-faint` |
| `--h1-color` … `--h6-color` | `--ed-h1` … `--ed-h6` |
| `--inline-title-color` | `--ed-title` |
| `--bold-color` / `--italic-color` | `--ed-bold` / `--ed-italic` |
| `--text-highlight-bg` / `-fg` | `--ed-mark-bg` / `--ed-mark-fg` |
| `--code-normal` / `--code-background` | `--ed-code-fg` / `--ed-code-bg` |
| `--text-accent` / `--text-accent-hover` | `--ed-link` / `--ed-link-hover` |
| `--link-url` | `--ed-url` |
| `--link-unresolved-color` | `--ed-wikilink-unresolved` |
| `--tag-color` / `--tag-background` / `--tag-radius` | `--ed-tag-fg` / `--ed-tag-bg` / `--ed-tag-radius` |
| `--text-selection` | `--ed-selection` |
| `--cursor-line-background` | `--ed-active-line` |
| `--checkbox-color` / `--checklist-done-color` | `--ed-checkbox` / `--ed-task-done-fg` (the done text; the checked box is `--ed-checkbox-done`) |
| `--table-header-background` / `--table-row-even-background` | `--ed-table-header-bg` / `--ed-table-row-alt-bg` |
| `--background-modifier-cover` | `--ed-scrim` (the dialog scrim — a colour of its own because DaisyUI's `neutral` is the ink colour in dark themes) |

No equivalent exists for `--ed-sync-*` — that is the point (band C).

## The built-in themes

Eight, in the order Settings › Appearance lists them under *Built in* (after
*System*). The
registry is `BUILTIN_THEMES` / `DARK_THEMES` / `THEME_LABEL_KEYS` in
`libs/ui/src/tokens.ts`; each label is a dictionary entry,
`web.settings.appearance.theme_names.<id with _>`.

| Id | Label | What it is |
|---|---|---|
| `editor-light` / `editor-dark` | Oh hi Light / Oh hi Dark | **The default pair** (what *System* resolves to): the review's direction B, *Ledger*. Paper and a fountain pen — warm neutrals from the page (`#faf8f4`) to the darkest chrome, one ink-blue for everything you can follow (link, wikilink, title, caret), teal code, a sand chip for tags, a visible warm heading ramp. |
| `graphite-light` / `graphite-dark` | Graphite Light / Dark | Direction A. No accent at all: buttons, focus marks and the caret are ink, the only hue on the page is a link, headings by weight and size alone, the unresolved link a grey ghost. |
| `fjord-light` / `fjord-dark` | Fjord Light / Dark | Direction C. Nord's temperature on our rules: cool blue-greys, frost for the caret and accent, mauve for a note not written yet, a cool heading ramp. |
| `iris-light` / `iris-dark` | Iris Light / Dark | Direction D. One violet with discipline (caret, title, links, selection), cyan for code, a rose comment tint and unresolved link. |

**The four pairs are ours.** Nord, the port of "Obsidian Nord" that was
built in beside them, moved out on 2026-10-15 (Fork 4-A, slice T2): it is an
example custom theme now — *The Nord example* below.
They come from the design review *Oh hi Theme Explorations* (2026-10-15),
which found the first Editor Light/Dark flat — one plane, two teals doing
seven jobs, an invisible heading ramp, a dark borrowed from GitHub and One
Dark — and drew four directions from this token contract, each checked
against `theme-contract.test.ts` and the floors here. The ids `editor-light` /
`editor-dark` are plumbing kept so a stored preference keeps working
(Fork 2-A); the first palettes are in git history. Shared by all four pairs:
band C per polarity (Fork 3-B), one light and one dark set of presence and
group colours (Fork 5-A), and the agent-suggestion, comment and agent-working
colours. Graphite states its headings by weight and size alone (Fork 6-A, on
purpose); the other three carry a visible ramp of one hue, h1 darkest
(Fork 6-B).

**The readability floors**, which every built-in clears and `theme-contract.test.ts` asserts: body ink **7:1** on the
surface; every text colour **4.5:1** (links, suggestions, initials on a
presence slot, sync labels, and the five syntax colours a reader reads on
the fence's own slab, `--ed-code-block-bg`); headings **3:1** (large text);
marks **3:1** — the pane focus edge and group dots on `base-100`, and the code
comment, which may recede, on its slab (strictly above 3:1: the first Editor
Dark's 2.98 rounded to the "3.0" that hid it).

## The Nord example

`examples/themes/nord-light/theme.css` and `examples/themes/nord-dark/theme.css`:
the port of "Obsidian Nord", a built-in until 2026-10-15 and now a custom
theme a vault holds (v2-shaping Fork 2, Fork 4-A; the themes review's slice
T2). Add one from Settings › Appearance › *In this vault* › *Add to this
vault*, or copy its folder into `<vault>/.ohhi/themes/`. The files are the
built-in token files converted to the custom-theme format — one
`[data-theme]` block, bands A and B, Nord's own people and group colours
restated — and `libs/ui/src/example-themes.test.ts` holds them to it: one
block named after the folder, a `color-scheme`, contract tokens only, nothing
the sanitizer strips (`theme.test.ts` checks the sanitizer leaves each file as
it is, comments aside), and every honesty rule a built-in meets against the
sync set of its polarity.

**A device that chose Nord before the move** (Chris's `nord-dark`): its stored
`nord-dark` is read as `custom:nord-dark`. The pre-paint script paints Oh hi
Dark (the dark polarity is known). When the vault opens: if it holds
`.ohhi/themes/nord-dark/`, Nord Dark applies as before; if not, Oh hi Dark
stands in, the choice is kept, and the app says so **once per name, ever**
(the `theme_retired` notice, a warning that toasts with *Show themes* —
Appearance, where *Add to this vault* is — and stays in the Log under
*Customise*). Adding it applies it at once, since the choice already names it;
every later launch reads it from the vault.

**The floors it misses**, Nord's own values kept on purpose and asserted to
still miss (`MISSES` in `example-themes.test.ts`, so this list cannot go
stale): the code fence — Nord Dark's keyword `#81a1c1` (3.74:1), number
`#b48ead` (3.55:1) and comment `#616e88` (1.96:1) on nord1 `#3b4252`; Nord
Light's keyword (3.50:1), string (3.39:1), number (4.45:1) and type (4.15:1)
on its slab. Every other floor — body ink 7:1, headings 3:1, the suggestion
colours 4.5:1 — it meets. The axe findings that kept it out of the built-in
pass also stand: Nord Light's chrome ink at the shell's `/70` is 3.87:1 on
white; Nord Dark's tag (`#8fbcbb` on `#434c5e`, 4.14:1) and link orange
(`#d08770`, 4.39:1) sit under 4.5:1. Each is a one-token correction in the
file, if wanted.

Nord is polychrome and identity-forward: six hues across h1–h6, yellow bold
*and* italic, a 60%-alpha aurora-red selection. It is beautiful, and its
loudest colour is red — which in this app is also the colour of *your
document has diverged*. Our defaults invert that budget: hue is spent only on
links, code, tags and unresolved wikilinks, and the highest-chroma things on
screen are the four sync colours and the eight presence colours.

### Documented deviations in the Nord example

Everything else is Nord's own value. These are not port bugs.

| Theme | Token | Nord | Ours | Why |
|---|---|---|---|---|
| both | `--ed-presence-*` | includes `#bf616a` | red excluded | Aurora red is reserved for divergence in every Editor theme; a peer's caret must never read as a conflict marker. Asserted by `theme-contract.test.ts`. |
| both | `--ed-wikilink-unresolved` | (Nord has none) | dark `#a888a0`, light `#9a5b3d` | Same reservation, same test. Nord contains no WARM colour that is both near its link orange and clear of its aurora red, so dark goes cool. |
| nord-dark | `--ed-marker` | `#8fbcbb` (frost0) | `#4c566a` (nord3) | `--ed-marker` is the dimmed syntax mark (`#`, `*`, `>`), not the ordered-list number it was first mapped from. |
| nord-dark | `--ed-presence-8` | `#d08770` | `#cbb69a` | Nord's orange sits ~42 units from its red — too close under the rule above. Nord does not contain eight hues that all clear the red. |
| nord-dark | `--ed-group-7` | `#d08770` | `#d08770` (kept) | The same orange stays in the GROUP band. A presence colour is an unlabelled 2 px caret that can appear anywhere in the text; a group colour always arrives with the group's name, so the floor there is "not the conflict colour" (42 units) rather than presence's "nowhere near it" (60). |
| both | `--ed-sync-*` | green, yellow, aurora red, nord3 | the shared light or dark set | Band C is one set per polarity since 2026-10-15 (Fork 3-B), so Nord shows the same sync colours as every theme of its polarity. Its own `#2e3440` on aurora red reached only 3.05:1, which is why nord-dark once carried its own `--ed-sync-diverged-fg`. |
| nord-light | `--ed-code-fg` | `#88c0d0` (1.9:1) | `#3b6e7d` (5.7:1) | Unreadable on white. |
| nord-light | `--ed-h1` … `--ed-h6` | aurora hues (h2 was 1.6:1) | darkened, hue preserved | Same. |
| nord-light | `--ed-ink-faint` | `--text-faint` = dark0 | `#6b7690` | Upstream inverts it: `--text-faint` was *darker* than `--text-normal`. |
| nord-light | `--ed-link` / `--ed-url` / `--ed-bold` / `--ed-italic` | aurora hues | darkened, hue preserved | Contrast. |
| nord-light | `--ed-title` | `--inline-title-color` = yellow | `#a17c2f` | 1.6:1 on white. |
| nord-light | `--ed-link-hover` | `--text-accent-hover` = `#81a1c1` | `#5e81ac` | 2.4:1 on white. |
| nord-light | `--ed-checkbox` | `--checkbox-color` = `#81a1c1` | `#5e81ac` | Same. |
| nord-light | `--ed-ink-muted` | `--text-muted` = dark1 `#3b4252` | `#4c566a` (dark3) | Upstream makes "muted" *darker* than normal text; we step it the other way so the hierarchy reads. |
| nord-light | `--ed-wikilink` | (Nord has none; dark maps it to `--text-accent`) | `#5e81ac` | On white, the accent orange is the same hue as the unresolved colour; frost separates them. |
| nord-light | `--ed-presence-8` | `#9c5335` | `#a8327d` | ~55 units from the diverged red — same rule as nord-dark's slot 8. |
| nord-dark | `--ed-presence-2` | `#a3be8c` (green) | `#e0a3b8` | Nord's green was nord-dark's `--ed-sync-ok` while band C was per theme: a peer would have read as "synced". Presence slots must sit 30+ units from every sync colour. Kept since band C went per polarity (the port is not retuned). |
| nord-dark | `--ed-agent-working-bg` | (Nord has none) | `#88d0e0` at 22% | Not frost1 `#88c0d0`: the shared dark offline grey `#8b96a6` sits 59 units from it, under the 60 the agent tint must clear from every sync colour. |
| nord-dark | `--ed-presence-4` | `#ebcb8b` (yellow) | `#d8dee9` | Nord's yellow was its `--ed-sync-pending`. Same rule, same history. |
| nord-dark | `--ed-presence-fg-1..8` | (none) | `#0b0e13` | Nord-dark's slots are light; dark initials clear 4.5:1 on all eight. |
| nord-light | `--ed-presence-4` | `#8a6300` | `#8f5a2b` | Was nord-light's sync pending amber itself. Same rule. |
| nord-light | `--ed-selection` | red @ 60% | red @ 30% | 60% red on white drops selected body text to ~3.1:1. |
| nord-light | `--ed-table-header-bg` | `rgba(light2, .2)` | `#eceff4` | Effectively invisible on white. |
| both | `--ed-syn-*` on `--ed-code-block-bg` | Nord's own | Nord's own (kept) | **Under the fence floors** — the misses listed above, named in `example-themes.test.ts` (`MISSES`) rather than repainted. |

Two of these are worth stating plainly: the presence and unresolved-link rules
mean **nord-*​ is not a pixel-exact port and does not try to be.** Where Nord's
palette and Editor's one non-negotiable (red means diverged) collide, the
invariant wins and the deviation is listed here.

**nord-dark keeps `--ed-selection` at Nord's own 60% aurora red** even though
selected body text lands near 2.9:1 — that is what Chris reads today, and
changing it would silently make the daily experience differ from Obsidian.
It is your file now: change `--ed-selection` in `.ohhi/themes/nord-dark/theme.css` if you want more.

## Not yet, and deliberately

- **Footnote, math and transclusion tokens** are not shipped: live preview
  does not render those constructs, and the measured vault contains **zero**
  of each (`plans/read-shaping.md` §Evidence). They arrive with the construct.
  (Callouts were in this list until 2026-10-10; Chris's editor review brought
  them back, and their tokens are above.)
- **Tauri window translucency** (Chris's `appearance.json` has
  `translucency: true`) is out of scope. If it is added, `--ed-surface` must
  become semi-transparent *per theme* — a token-contract change, not a shell
  change. Do not bolt it on with a hardcoded `rgba()`.
- **Peer cursor colours** are still published as a hex on the awareness
  `user.color` field, so a peer already on screen keeps the colour their own
  client chose. Making every viewer resolve peers against their own theme means
  sending a slot index instead — an awareness **wire-format** change needing a
  version-tolerant reader, sequenced with the `y-codemirror.next` vendoring
  already flagged as `TODO(V2)` in `libs/editor/src/binding.ts`.
