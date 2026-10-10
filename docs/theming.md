# Theming

Editor's look is a **design system, not a stylesheet**: one token layer drives
every surface — the Svelte chrome and the CodeMirror editing surface alike — so
changing a theme is changing tokens in one place, never editing components.

Shaped in [`plans/v2-shaping.md`](../plans/v2-shaping.md) (Fork 2). Built in
slice **V2a**.

## Three bands, one attribute

Everything hangs off `data-theme` on `<html>`.

| Band | What | Owner | Cascade |
|---|---|---|---|
| **A — Chrome** | DaisyUI v5 semantic tokens: `--color-base-100/200/300`, `--color-base-content`, `primary`/`secondary`/`accent`/`neutral`, `info`/`success`/`warning`/`error` (each with a `-content` pair), `--radius-*`, `--size-*`, `--border`, `--depth`, `--noise` | `@plugin "daisyui/theme"` in `libs/ui/src/styles/tokens/*.css` | DaisyUI's own layers |
| **B — Editor** | `--ed-*`: surface/ink/measure, h1–h6, emphasis, code + 9 syntax slots, links and wikilinks, tags, frontmatter, block furniture, selection/caret/gutter, peer-cursor chrome, `--ed-presence-1..8` and their ink `--ed-presence-fg-1..8`, `--ed-group-1..8`, the pane and tab chrome | `libs/ui/src/styles/tokens/` | `@layer editor.tokens`, overridable by `@layer editor.user` |
| **C — Honesty** | `--ed-sync-ok` / `-pending` / `-diverged` / `-offline` (+ `-fg`) | `libs/ui/src/styles/sync-tokens.css` | **UNLAYERED** |

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
per-theme colours, so no theme can repaint, fill or hide it.
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
  60% opacity or below: on `editor-light`, `/60` is 4.19:1 and `/40` is 2.41:1
  against 4.5:1 required. `text-primary` on a `bg-primary/15` tint is 3.8:1 for
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
asserted: in the Nord themes the palette's own green and yellow **are** its
sync ok and pending, and a chip that carries the name you gave it, in the tab
strip, is not the pill in the status bar.

## Presence colours (`--ed-presence-1..8`, `--ed-presence-fg-1..8`)

The eight colours a peer is drawn in — their caret, and since sharing E1 the
initials on tree rows, tab avatars and the people stack. A peer is a **slot
number** (`presence.ts`), never a hex. Unlike groups, presence sits beside
the sync pill everywhere, so `theme-contract.test.ts` asserts more:

- no slot is the diverged red, nor within 60 units of it (the long-standing
  rule);
- **every slot is more than 30 units from every sync colour** (`ok`,
  `pending`, `offline`, `diverged`) in its theme — a peer's avatar must never
  read as a sync state (golden rule 4); this is what retinted editor-light's
  slot 3 (it *was* the pending amber, `#8a6300` → `#5b55b5`) and the Nord
  themes' slots 2 and 4 (listed below);
- each slot has an **ink**, `--ed-presence-fg-N`, the colour initials are
  drawn in on it, which must clear **4.5:1** (WCAG 1.4.3 — initials are
  text). The light themes' ink is white; the dark themes' is near-black (`#14181d` in editor-dark, `#0b0e13` in nord-dark). A custom
  theme that retints a slot must check its ink.

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
| `--ed-checkbox` / `--ed-checkbox-done` | the task box (a real `<input type=checkbox>` drawn with `appearance: none`, so the same 0.9em square in every engine: Chris's WebKitGTK screenshot, measured): `--ed-checkbox` is its 1px border, `--ed-checkbox-done` its fill and border once checked — `var(--ed-checkbox)` in every built-in theme since E2 — with the tick in `--ed-surface`. 1,941 of them in the real vault (X1) |
| `--ed-task-done-fg` / `--ed-task-done-decoration` | a checked task's text (E2, fork C1): `var(--ed-ink-faint)`, and a whole `text-decoration` value — a 1px line-through in a 60% mix of the done ink |
| `--ed-mark-bg` / `--ed-mark-fg` | `==highlight==`, a new inline node (X1) |
| `--ed-code-bg` | the inline-code chip, once the backticks are hidden (X1) |
| `--ed-code-block-fg` | a fence's body text under its slab, beside the nine `--ed-syn-*` slots (X1) |
| `--ed-quote-border` | the blockquote's left border, once `> ` is hidden (X1). On the caret's line the revealed `> ` hangs in the line's padding beside it, out of the flow, so the text does not move; quotes are upright (E2) |
| `--ed-link-hover` | a rendered link under the pointer — in Live and Reading a plain click navigates, so it must look clickable (X1) |
| `--ed-table-header-bg` / `--ed-table-row-alt-bg` / `--ed-table-border` | the Reading table widget, and Live's column guides over the raw pipes (X2) |
| `--ed-frontmatter-bg` / `--ed-frontmatter-border` | the YAML block's fencing while the caret is inside it (X3) |
| `--ed-tag-bg-hover` / `--ed-tag-radius` | the tag chip, both in the text and in the collapsed frontmatter strip (X4) |

`--ed-title` is the filename-as-title line, a different thing from `h1`. It
was declared and unread until round 2 (P3) gave Editor that line: the
**inline title** (`InlineTitle.svelte`, `editor.inlineTitle` in the layout),
an `<input>` inside an `<h1>` mounted in the editor's scroller above the note,
reads it.

## Theme switching

`ThemePref = 'system' | 'editor-light' | 'editor-dark' | 'nord-light' |
'nord-dark' | 'custom:<name>'`, stored in `editor:config.theme` and mirrored to
the `editor:theme` string key.

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

Drop a file at `<vault>/.ohhi/themes/<name>/theme.css` — deliberately the
same shape as `.obsidian/themes/<name>/theme.css` — then name it in Settings.
(The folder was `.editor/themes/` before the rename; a vault made then needs
its theme folder moved by hand. On the desktop app, reading `.ohhi/` relies on
a file-access entry for dot-folders that has not yet been checked on a real
build — `plans/spike-resource-root.md` F0.)

Start from `libs/ui/src/styles/_template.css`; **the complete, authoritative
token list with a default for every entry is
`libs/ui/src/styles/tokens/_contract.css`** (115 tokens, grouped and commented;
the entries marked `(V2e)` are the live-preview band — see above for what
reads each one).

Four rules the file itself will not tell you:

- **One block, `[data-theme="<name>"]`**, where `<name>` matches the folder
  name. Set DaisyUI's `--color-*` and our `--ed-*` **directly**. Do *not* write
  `@plugin "daisyui/theme"` — that is a compile-time Tailwind directive, and a
  stylesheet injected at runtime cannot use it.
- **Declare `color-scheme: dark` or `light`.** It picks CodeMirror's own base
  rules (scrollbars, panels, tooltip chrome) and the native form-control
  palette. Omit it and Editor falls back to your OS preference, which will be
  wrong half the time.
- **Names are `[\w -]{1,64}`** — letters, digits, spaces, `-`, `_`. Anything
  else is refused, because the name becomes both a path segment and a
  `[data-theme]` value.
- **Expect one frame of the built-in default at boot.** The pre-paint script
  can set the attribute before CSS loads, but a vault-resident theme cannot be
  read until the vault opens.

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

**`editor-light` / `editor-dark` are ours. `nord-light` / `nord-dark` are a
port of "Obsidian Nord", and they are built on opposite principles.** Nord is
polychrome and identity-forward: six hues across h1–h6, yellow bold *and*
italic, a 60%-alpha aurora-red selection. It is beautiful, and its loudest
colour is red — which in this app is also the colour of *your document has
diverged*. Our defaults invert that budget: headings are a six-step **luminance
ramp of one hue**, hue is spent only on links, code, tags and unresolved
wikilinks, and the highest-chroma things on screen are the four sync colours
and the eight presence colours.

### Documented deviations from the Nord port

Everything else is Nord's own value. These are not port bugs.

| Theme | Token | Nord | Ours | Why |
|---|---|---|---|---|
| both | `--ed-presence-*` | includes `#bf616a` | red excluded | Aurora red is reserved for divergence in every Editor theme; a peer's caret must never read as a conflict marker. Asserted by `theme-contract.test.ts`. |
| both | `--ed-wikilink-unresolved` | (Nord has none) | dark `#a888a0`, light `#9a5b3d` | Same reservation, same test. Nord contains no WARM colour that is both near its link orange and clear of its aurora red, so dark goes cool. |
| nord-dark | `--ed-marker` | `#8fbcbb` (frost0) | `#4c566a` (nord3) | `--ed-marker` is the dimmed syntax mark (`#`, `*`, `>`), not the ordered-list number it was first mapped from. |
| nord-dark | `--ed-presence-8` | `#d08770` | `#cbb69a` | Nord's orange sits ~42 units from its red — too close under the rule above. Nord does not contain eight hues that all clear the red. |
| nord-dark | `--ed-group-7` | `#d08770` | `#d08770` (kept) | The same orange stays in the GROUP band. A presence colour is an unlabelled 2 px caret that can appear anywhere in the text; a group colour always arrives with the group's name, so the floor there is "not the conflict colour" (42 units) rather than presence's "nowhere near it" (60). |
| nord-dark | `--ed-sync-diverged-fg` | `#2e3440` | `#140a0c` | Nord's darkest background reaches only 3.05:1 on aurora red; "diverged" is the label that most needs reading. |
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
| nord-dark | `--ed-presence-2` | `#a3be8c` (green) | `#e0a3b8` | Nord's green **is** nord-dark's `--ed-sync-ok`: a peer would read as "synced". Presence slots must sit 30+ units from every sync colour. |
| nord-dark | `--ed-presence-4` | `#ebcb8b` (yellow) | `#d8dee9` | Nord's yellow is its `--ed-sync-pending`. Same rule. |
| nord-dark | `--ed-presence-fg-1..8` | (none) | `#0b0e13` | Nord-dark's slots are light; dark initials clear 4.5:1 on all eight. |
| nord-light | `--ed-presence-2` | `#4d7c2f` | `#2f7a5a` | Too near nord-light's sync ok green. Same rule. |
| nord-light | `--ed-presence-4` | `#8a6300` | `#8f5a2b` | Was nord-light's sync pending amber itself. Same rule. |
| nord-light | `--ed-selection` | red @ 60% | red @ 30% | 60% red on white drops selected body text to ~3.1:1. |
| nord-light | `--ed-table-header-bg` | `rgba(light2, .2)` | `#eceff4` | Effectively invisible on white. |

Two of these are worth stating plainly: the presence and unresolved-link rules
mean **nord-*​ is not a pixel-exact port and does not try to be.** Where Nord's
palette and Editor's one non-negotiable (red means diverged) collide, the
invariant wins and the deviation is listed here.

**nord-dark keeps `--ed-selection` at Nord's own 60% aurora red** even though
selected body text lands near 2.9:1 — that is what Chris reads today, and
changing it would silently make the daily experience differ from Obsidian.
Override `--ed-selection` in a custom theme if you want more.

## Not yet, and deliberately

- **Callout tokens** (`--ed-callout-*`) are not shipped: live preview (X1)
  deliberately does not render callouts, and the measured vault contains
  **zero** of them — along with zero footnotes, math and transclusions
  (`plans/read-shaping.md` §Evidence). They arrive with the construct, if a
  complaint ever asks for it.
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
