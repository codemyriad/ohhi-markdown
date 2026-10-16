---
status: current
date: 2026-10-06
---

# Customising Oh hi markdown — layouts, keymaps, templates

Everything you can change about the shell's shape is a **file**: JSON for
layouts and keymaps, markdown for templates, CSS for themes. Files are data,
never code (`quiet-shell-shaping` Decision 2): a vault's `.ohhi/`
folder travels by git and by copy, so nothing in it can run. A person edits
these files in Settings (a view tab — `app.settings`, Mod+, — or, with no
vault open, the vault manager's settings page); **an agent edits them directly** with its own file
tools — this page is everything it needs. Ground truth for the decisions:
`quiet-shell-shaping` F1–F16 and `foundations-plan` Stage 6.

---

## 1. Kinds and where they live

| Kind | File | Schema | Chosen in |
|---|---|---|---|
| Layouts | `layouts/<name>.json` | [`spec/ohhi.layout.v1.schema.json`](../spec/ohhi.layout.v1.schema.json) | *Use layout file…* (palette); Settings › Customise › Layout names the file in use and edits this device's overrides on top |
| Keymaps | `keymaps/<name>.json` | [`spec/ohhi.keymap.v1.schema.json`](../spec/ohhi.keymap.v1.schema.json) | Settings › Customise › Keys |
| Templates | `templates/<name>.md` | frontmatter `description`, `argument-hint` | *Insert template…* (palette) |
| Themes | `themes/<name>/theme.css` (vault only) | [`docs/theming.md`](theming.md) | Settings › Customise › Appearance, under *In this vault* (every theme folder, by name — apart from the eight under *Built in*); Customise's Theme row lists them too. *Add to this vault* writes a shipped example ([`examples/themes/`](../examples/themes/): Nord Light and Dark, built in until 2026-10-15). A theme sets bands A and B; its `color-scheme` also picks which of the two sets of sync colours it gets (band C is per polarity and out of a theme's reach) |

**Settings › Customise** is the overview of all four, and the parent of
the sections that choose them (Editor, Layout, Appearance, Keys — QA round
1): first what is in use, one row per kind with a door to its section; then
the roots below in order, each kind's file in use with the root it came from and what it
shadows, every other name with its root, and **Problems** — every layout or
keymap file that does not parse or validate, listed with its file, root and
message until it is fixed (read from the files on each change and on
*Reload files*, which runs `app.reload-resources`). Its verbs are read-only:
*Copy path* (the desktop app cannot open a folder for you yet) and *Copy as
JSON* (the resolved file in use). Settings › Layout, › Appearance and › Keys
each carry one line naming their file and its root.

Each kind is read from **ordered roots**; the first root that has a name wins:

1. **the vault** — `<vault>/.ohhi/<kind>/`
2. **your user folder** — `~/.config/ohhi/<kind>/` (Linux; `~/Library/Application
   Support/ohhi/<kind>/` on macOS) — **desktop app only**, read-only from the app
3. **built-in** — the layout `default` (the only built-in layout; the
   retired names `light` and `dense` are read as `default`, in a file's
   `extends` and in a stored choice), keymap `default`, templates `daily`
   and `meeting`. The older column shell is an **example** file,
   [`examples/layouts/dense.json`](../examples/layouts/dense.json): copy it
   into `.ohhi/layouts/` to use it

**The vault wins.** A shared vault's `.ohhi/keymaps/default.json` shadows the
built-in `default` for everyone who opens it; Settings › Customise shows
which root each name came from and what it shadows (the palette's *Use
layout file…* rows show each file's path and the same root label, and say
*can't be used* on a file Customise lists under Problems; *Insert template…*
labels each template's root too), so a clash is visible. The *device* stores only which
one is active (`default` or `custom:<name>`), never the file.

**Layouts on a device, in three layers.** What the shell draws is the active
layout file, then this device's **overrides**, then its **pins**:

- the file is `default` unless you pick another with **Use layout file…**
  in the command palette (`layout.use-file`) — the only place a
  `.ohhi/layouts/*.json` is chosen;
- **overrides** (`config.layout.overrides`) are what Settings › Layout and
  Settings › Editor edit: Layout has the shell's options (files drawer or
  column, sidebar dock or column and its corner, tabs, toolbar position,
  format bar and **which buttons it shows** — a picker that writes
  `bars.format` as a plain list, with *Reset to layout file* — word count,
  the selection handle on or off and its buttons, the same picker over
  `bars.selection`),
  Editor the note's (how notes open, line width, typewriter, inline title).
  Each change applies at once — split Settings beside a note to watch it —
  and is kept on this device as the difference from the file; each
  section's reset drops its own. (Settings › Layout's *Pane keys* — how the
  pane mode, Mod+P, shows its keys: *Subtle* in the corner above the word
  count, *Full* as a bar along the bottom, *Off* the mode's name only — is
  device config, not a layout override);
- **pins**: *Pin as a column* on the navigator or the dock
  (`config.layout.pins`) wins over both — on a window at least 40rem wide.
  On a small screen a pin is kept but not honoured: the side is the drawer or
  dock it would be unpinned, and its pin control says pins apply on wider
  screens.

None of the three is ever written into a file. A layout *file* is how an
agent, or a team in a shared vault, describes a shell.

`.ohhi/` is ignored by sync: its files never become notes, never reach
search or backlinks, and never travel through a share. They travel the way
the vault folder does (git, Dropbox, a copy).

**Names** are letters, digits, spaces, `-` and `_` (1–64 characters, starting
with a letter or digit). The basename is the name: `.ohhi/layouts/writing.json`
is the layout `writing`.

### Applying a change

Settings applies its changes as you make them: there is no Save button and
nothing to confirm on leaving. Keys writes each change to its keymap file at
once, with an *Undo*. A file written by anything else — an
agent, your editor, `git pull` — is picked up by the desktop app's watcher;
when that cannot run (the browser, or a watcher that failed to start), run
**Reload layouts and resources** (`app.reload-resources`) from the command
palette. An invalid file never half-applies: the shell falls back to the
built-in `default` and posts a notice saying which file and why, with *Show
problems* (Settings › Customise).

When the layout or keymap **in use** is read again and now says something
else, the app says so once — "Layout focus.json reloaded from this vault" —
logged in the Log (its *Customise* chip keeps every reload and problem) and
toasted with *Show* and, only when it can be honest, *Undo*: for a layout,
Undo shows the spec from before the change **for this session** (the app
never writes a layout file; the next change to the file, a pick, a vault
switch or *Reload files* applies the file again, and Settings › Customise
says the layout is held meanwhile); for a keymap file in the vault that the
app may write, Undo writes the bytes it had read back, journaled. A vault
opening, a pick and the app's own writes are not announced, and a file that
can no longer be used is the fallback notice's alone.

### Agents

There is no journaled `ohhi` op for these files yet: `ohhi write` refuses
non-`.md` paths, and `ohhi resource write` (plus `layout`, `keymap`,
`templates`, `ui get`) are **reserved names** for the agent layer
(`quiet-shell-shaping` §Later). Until then an agent writes the files
directly with its own tools — validate against the schema in `spec/` first,
then ask the person to run *Reload layouts and resources*. The person-facing
version of this page is the **Customising the app** guide
(`docs/guide/customise.md`, Help › *Customising the app*, and *Read the
guide* in Settings › Customise).

---

## 2. Layouts — `ohhi.layout.v1`

A layout file is a **partial**: it may `extends` another layout by name and
say only what differs. Resolving it yields the complete shell spec.

```json
{
  "$schema": "ohhi.layout.v1",
  "extends": "default",
  "toolbar": { "position": "bottom" }
}
```

| Field | What |
|---|---|
| `$schema` | always `"ohhi.layout.v1"` |
| `extends` | a layout by name (`default` or a file's name); a file that extends its own name (`.ohhi/layouts/default.json` with `"extends": "default"`) extends the one it shadows |
| `regions` | `header` (`toolbar`/`breadcrumb`), `navigator` (`column`/`drawer`/`off`), `rail` (`dock`/`column` — collapsed, always the dock's floating icon strip; open, a floating panel with Links and History tabs, or that panel as a column), `tabs` (`auto`/`always`), `statusbar` (`pane`/`merged`), `format` (`bottom`/`top`/`off` — the format bar floating over the editor at the bottom centre, or under the header, or none), `status` (`corner`/`off` — the `bars.status` readouts floating at the editor's bottom right), `selection` (`on`/`off` — the selection handle: `bars.selection` on a small pill at the end of a settled selection) |
| `bars` | eight lists — `toolbar.left`, `toolbar.center`, `toolbar.right`, `format`, `statusbar`, `status`, `tabs`, `selection`. `format`, `tabs` and `selection` hold **command ids** (`format`: by default the `format.*` buttons and, last, `note.comment` — the comment button; `tabs`: faint buttons at the end of every pane's tab strip — by default `workspace.split-right` and `workspace.split-down`; `selection`: the selection handle — by default `note.comment` and `ai.ask-selection`, drawn as *Comment* and *Ask*); the others hold **readout ids** |
| `toolbar` | `position`: `top`/`bottom` |
| `dock` | `position`: `top-right`/`bottom-right` — where the dock's icon strip floats |
| `panes` | `borders` (`hairline`/`none`), `focusMark`, `lead` (booleans), `open` (`tab`/`replace`) |
| `views` | the view ids whose commands the palette offers (`inspector`, `log`, `shared`); an empty list offers every registered view. `settings` is always offered, listed or not: it is where a layout is changed back |
| `editor` | `measure` (`narrow`/`comfortable`/`wide`), `typewriter` (boolean), `inlineTitle` (boolean — the note's name as an editable heading at the top of its body; editing it renames the file) |
| `focus` | `keep`: the region ids Focus mode leaves on screen |

**The selection handle** (`regions.selection`, `bars.selection`) is a small
pill that appears at the end of a selection once it settles — never during a
drag — beside the last selected character, or just below that line when the
line has no room; never over the selected words. Typing, Escape, an empty
selection or the focus leaving the note takes it down, and it never appears
while the selection overlaps an agent's proposal (the proposal's own
*Accept* / *Reject* pair is the control there). An item whose command cannot
run is left out: *Ask* (`ai.ask-selection`) appears only once a provider is
added in Settings › AI. Under a finger the same pill sits below the end
line, clear of the system's selection handle and away from the system's own
menu above the words. `Alt+F10` from the text moves the keyboard onto it.
Formatting stays on the format bar, whose buttons name their command and key
in a tooltip ("Bold · Ctrl+B").

The floating format bar, the `status` corner and the dock's icon strip are a
note's chrome: a view tab (Inspector, Log, Shared) or an empty tab focused
draws none of them, and focusing a note brings them back.

**On a small screen** (a window under 40rem — 640 px — wide; one breakpoint,
`apps/web/src/lib/small-screen.svelte.ts`) the same layout file draws a
phone's shell. The format bar never folds into its *Format* menu: it fills
the row and scrolls sideways, every command a button. The `status` corner's
counts (`words`, `chars`, `reading-time`) fold into one chip at the bar's
right end showing the first count's number alone ("1,204"); a tap shows them
in full. Any other readout in `bars.status` is drawn as it is — `sync` is
never folded away. (On a wider screen the bar still folds into the menu when
the pane it floats over is under 30rem.) A tap in a note closes the
navigator drawer and the dock's floating panel, which would otherwise cover
most of it; on a wider screen they stay open until closed. (Whatever the
width, a finger's tap on a wikilink places the caret and shows a small card
with *Open* rather than opening the note; a mouse click still follows it.)

**Older names still load.** Files written before 2026-10-06 are read as
today's shape: `extends: "light"` → `"default"`, `regions.rail: "menu"` →
`"dock"`, `bars["toolbar.format"]` → `bars.format`, and the readout ids
`note.pill` and `people` → `sync` (the one icon that now carries the note's
sync state and who is online). `extends: "dense"` is read as `"default"`
too — copy the example file instead. Write the new names.

### The delta grammar (every list field)

- **Plain ids replace** the inherited list: `["words", "|", "sync"]`.
- **`+id` appends** (if absent), **`-id` removes**, order kept. A list holding
  any `+`/`-` entry is a delta over the inherited list — never both kinds in
  one list.
- **`"|"` is a separator.** In a replace list it sits where written; in a
  delta list `"|"` or `"+|"` appends one and `"-|"` drops them all. Runs of
  separators collapse and are trimmed from the ends, so a removal never
  strands one.

### The `sync` invariant

Three rules, all enforced when a layout is resolved; a layout that breaks one
is refused, not rendered — the pill is how the app keeps "sync state never
lies" (golden rule 4), and no file may hide it:

1. The open note's sync state — the `sync` readout — must be in **the bar
   that is on screen**: `statusbar` when `regions.statusbar` is `pane`, any
   of the toolbar's three groups (`toolbar.left`, `toolbar.center`,
   `toolbar.right`) when it is `merged`.
2. `regions.statusbar: "merged"` is only allowed with `regions.header:
   "toolbar"` — with the breadcrumb header there is no toolbar to carry the
   pill, so a layout file that combines them is refused (Settings › Layout
   does not offer the header at all).
3. `focus.keep` must keep the region whose bar carries `sync` (`statusbar`,
   or `toolbar` when merged), so Focus mode can never hide it either.

---

## 3. Keymaps — `ohhi.keymap.v1`

A keymap is a set of **overrides** over the command table's own default keys.
An id it does not name keeps its default; the built-in `default` keymap names
none.

```json
{
  "$schema": "ohhi.keymap.v1",
  "extends": "default",
  "bindings": {
    "daily.next": "Alt+ArrowRight",
    "nav.quick-open": ["Mod+o", "Mod+k"],
    "format.bold": []
  }
}
```

- A binding is **one chord** (a string), **several** (a list — all of them
  work), or **`[]` to unbind** the command entirely. For the `format.*`
  commands the editor's own copy of the key goes too, so `"format.bold": []`
  leaves Mod+B doing nothing at all.
- A chord is modifiers then one key, joined by `+`: `Mod` (Cmd on a Mac, Ctrl
  elsewhere), `Shift`, `Alt`, `Ctrl`, then a key as `KeyboardEvent.key` spells
  it (`k`, `=`, `[`, `ArrowRight`, `Backspace`, `Tab`). `Ctrl+Mod+X` is Ctrl+Cmd
  on a Mac and Ctrl+Alt elsewhere (Alt alone on the arrows — Ctrl+Alt+Arrow is
  the desktop's workspace switcher).
- `extends` layers keymaps: the parent's bindings first, this file's over them,
  per command id. Cycles are refused.
- Settings › Keys edits **the active keymap file**, writing each change as
  you make it (journaled, like every app write). When the keymap in use is
  read-only — the built-in `default`, a file in your user folder, or a vault
  file named like a built-in — the first change creates
  `.ohhi/keymaps/mine.json` (`mine-2.json` if that name is taken) that
  `extends` it and holds only what changed, and makes it the keymap in use.
  *Undo* puts back what the last change replaced (removing `mine.json` again
  if that change created it). Search finds a command by name, id or key, and
  *Press keys* finds what a chord runs.
- Shortcuts saved on a device before keymaps were files move into
  `.ohhi/keymaps/device.json` (`device-2.json` if that name is taken) the
  first time a vault is open, and that keymap becomes active.

The format commands' default keys (the `default` keymap; every one can be
rebound or unbound like any other): bold `Mod+B`, italic `Mod+I`, link
`Mod+K` (Obsidian's), strikethrough `Mod+Shift+X`, highlight `Mod+Shift+H`,
bullet list `Mod+Shift+8`, numbered list `Mod+Shift+7`. Inline code
(`format.code`), headings, task, quote, callout, code block, table, image,
rule, indent and outdent are unbound by default — inline code because
`Mod+E` is editing ↔ Reading and `Mod+Shift+C` is the browser's element
picker, the headings because `Mod+1`–`9` are the browser's tab keys; bind
them from a keymap file. In the editor
itself, `Mod+L` toggles a task, Tab / Shift+Tab indent a list item (and insert
a tab in a paragraph), and in a table Tab / Shift+Tab move between cells and
Enter moves down a row.

Two kinds of palette row cannot be bound, because their ids come and go: one
`group.open:<id>` per saved tab group and one `template:<name>` per template.
Bind `template.insert` instead.

---

## 4. Templates — `.ohhi/templates/<name>.md`

Obsidian-shaped (a folder of markdown), with arguments shaped like Claude
Code's slash commands. Each file is a palette row **Insert template: name**
under *Templates*; **Insert template…** (`template.insert`) opens a picker
where the first word picks the template and the rest are its arguments
(`meeting Retro "Ana Bo"`). The text lands at the focused editor's caret, as
one edit.

```markdown
---
description: Meeting notes — attendees, agenda, decisions, actions
argument-hint: "[topic] [attendees…]"
---
## ${1:-Meeting} — {{date}} {{time}}

**Attendees:** $@
```

| In the body | Becomes |
|---|---|
| `{{date}}` | today, in the vault's daily-note format (`.obsidian/daily-notes.json`; `YYYY-MM-DD` without one) |
| `{{date:FORMAT}}` | today in a moment-style format (`YYYY`, `MM`, `M`, `DD`, `D`, `MMMM`, `MMM`, `dddd`, `ddd`, `Y`, `YY`) |
| `{{time}}` | now, `HH:mm` |
| `{{title}}` | the note it is inserted into, without `.md` |
| `$1` … `$9` | that argument (empty when not given) |
| `${1:-default}` | that argument, or `default` |
| `$@` | every argument, space-separated |
| `$$` | a literal `$` |

`description` and `argument-hint` are removed from what is inserted; any other
frontmatter key stays, line for line.

---

## 5. The id lists

Generated from the code (`cd apps/web && rushx gen-schemas`); a test fails if
they drift, and another fails if this page names an id the app does not have.

### Command ids

Every key in a keymap's `bindings`, and every entry of a layout's
`bars.format`, `bars.tabs` and `bars.selection`, is one of these.

<!-- generated:command-ids — rushx gen-schemas in apps/web; never hand-edit -->
- `nav.quick-open`
- `nav.command-palette`
- `nav.search`
- `file.new`
- `file.new-folder`
- `file.new-collection`
- `file.delete`
- `file.move`
- `share.folder`
- `share.add`
- `share.link-device`
- `nav.back`
- `nav.forward`
- `view.sidebar`
- `view.rail`
- `daily.today`
- `daily.prev`
- `daily.next`
- `app.settings`
- `app.inspector`
- `app.log`
- `app.shared`
- `app.reload-resources`
- `view.focus`
- `template.insert`
- `layout.use-file`
- `app.desktop-download`
- `help.menu`
- `help.start`
- `help.shortcuts`
- `help.recovery`
- `help.sharing`
- `help.customise`
- `help.agents`
- `help.changes`
- `help.report`
- `workspace.split-auto`
- `workspace.split-down`
- `workspace.split-right`
- `workspace.close-pane`
- `workspace.focus-left`
- `workspace.focus-down`
- `workspace.focus-up`
- `workspace.focus-right`
- `workspace.focus-next`
- `workspace.zoom`
- `workspace.rotate`
- `workspace.move-left`
- `workspace.move-down`
- `workspace.move-up`
- `workspace.move-right`
- `workspace.resize-left`
- `workspace.resize-down`
- `workspace.resize-up`
- `workspace.resize-right`
- `workspace.equalize`
- `workspace.mode`
- `workspace.close-others`
- `tab.new`
- `tab.close`
- `tab.prev`
- `tab.next`
- `tab.goto-1`
- `tab.goto-2`
- `tab.goto-3`
- `tab.goto-4`
- `tab.goto-5`
- `tab.goto-6`
- `tab.goto-7`
- `tab.goto-8`
- `tab.goto-9`
- `tab.move-left`
- `tab.move-down`
- `tab.move-up`
- `tab.move-right`
- `tab.pin`
- `tab.reopen`
- `group.new`
- `group.toggle`
- `group.close`
- `group.copy-links`
- `group.ungroup`
- `group.move-left`
- `group.move-down`
- `group.move-up`
- `group.move-right`
- `view.toggle-reading`
- `view.toggle-source`
- `view.mode-live`
- `view.mode-source`
- `view.mode-reading`
- `edit.toggle-checkbox`
- `format.bold`
- `format.italic`
- `format.strike`
- `format.highlight`
- `format.code`
- `format.heading-1`
- `format.heading-2`
- `format.heading-3`
- `format.paragraph`
- `format.list`
- `format.ordered-list`
- `format.task`
- `format.indent`
- `format.outdent`
- `format.quote`
- `format.callout`
- `format.code-block`
- `format.link`
- `format.wikilink`
- `format.table`
- `format.image`
- `format.rule`
- `table.insert-row-below`
- `table.insert-column-right`
- `table.delete-row`
- `table.delete-column`
- `table.align`
- `table.move-row-up`
- `table.move-row-down`
- `table.move-column-left`
- `table.move-column-right`
- `app.session`
- `ai.new-session`
- `ai.add-selection`
- `ai.ask-selection`
- `ai.run-skill`
- `ai.stop-run`
- `ai.accept-suggestion`
- `ai.reject-suggestion`
- `ai.accept-all`
- `ai.reject-all`
- `ai.next-suggestion`
- `ai.previous-suggestion`
- `ai.undo-agent`
- `note.comment`
<!-- /generated -->

`bars.format` also takes the format bar's grouped items, which are not
commands (and so cannot be bound):

<!-- generated:toolbar-item-ids — rushx gen-schemas in apps/web; never hand-edit -->
- `format.paragraph-style`
<!-- /generated -->

### Readout ids

Entries of `bars.toolbar.left`, `bars.toolbar.center`, `bars.toolbar.right`
and `bars.statusbar`. The last two below, `note.pill` and `people`, are old
names read as `sync`; `vault.pill` draws the same icon. `help` is the Help
menu (the default layout's last `toolbar.right` item): its rows are the
`help.*` commands — `help.start`, `help.shortcuts`, `help.recovery`,
`help.sharing`, `help.customise`, `help.agents`, `help.changes`,
`help.report` — which the palette lists and a
keymap can bind; `help.menu` opens the menu itself, and is offered only while
a layout draws the `help` readout. `session` is the Session view's door (the
default layout draws it between `inspector` and `help`): it opens the current
AI session beside the note, and draws nothing until a provider is added in
Settings › AI, as `inspector` draws nothing while developer tools are off.

<!-- generated:readout-ids — rushx gen-schemas in apps/web; never hand-edit -->
- `nav`
- `title`
- `sync`
- `words`
- `chars`
- `reading-time`
- `mode`
- `vault.pill`
- `pane.lead`
- `daily.nav`
- `breadcrumb`
- `group.chip`
- `drawer`
- `inspector`
- `help`
- `last-agent-write`
- `session`
- `note.pill`
- `people`
<!-- /generated -->

### Bar ids

The keys of `bars`.

<!-- generated:bar-ids — rushx gen-schemas in apps/web; never hand-edit -->
- `toolbar.left`
- `toolbar.center`
- `toolbar.right`
- `format`
- `statusbar`
- `status`
- `tabs`
- `selection`
<!-- /generated -->

### Region ids

Entries of `focus.keep`.

<!-- generated:region-ids — rushx gen-schemas in apps/web; never hand-edit -->
- `toolbar`
- `header`
- `navigator`
- `rail`
- `tabs`
- `statusbar`
- `format`
- `status`
<!-- /generated -->

### View ids

Entries of `views` — the views whose palette commands a layout offers; an empty list offers all of them.

<!-- generated:view-ids — rushx gen-schemas in apps/web; never hand-edit -->
- `inspector`
- `log`
- `shared`
- `settings`
- `session`
<!-- /generated -->

---

## 6. Worked examples

### A bottom toolbar without the image button

`<vault>/.ohhi/layouts/bottom.json`:

```json
{
  "$schema": "ohhi.layout.v1",
  "extends": "default",
  "toolbar": { "position": "bottom" },
  "bars": { "format": ["-format.image"] }
}
```

Then pick **bottom** in Settings › Layout (or, after an agent wrote it, run
*Reload layouts and resources* and pick it there). Everything else is the
`default` layout's; the delta keeps the rest of the format bar in order, and
the format bar keeps floating at the bottom of the editor, above the moved
toolbar.

### Rebind "next daily note"

`<vault>/.ohhi/keymaps/mine.json`:

```json
{
  "$schema": "ohhi.keymap.v1",
  "extends": "default",
  "bindings": {
    "daily.prev": "Alt+ArrowLeft",
    "daily.next": "Alt+ArrowRight"
  }
}
```

Then choose **mine** under Keymap in Settings › Keys. If a keymap file is
already active (`custom:device` after the migration, say), add the two lines
to *that* file's `bindings` instead and reload — no choice needed.

---

## 7. `examples/` and `spec/`

- [`examples/layouts/`](../examples/layouts/) — the built-in `default` and
  the `dense` example (navigator and rail columns under a breadcrumb header,
  a strip and status bar per pane), as files to copy and edit.
- [`examples/keymaps/my-keys.json`](../examples/keymaps/my-keys.json) — a
  keymap with the rebinds above.
- [`spec/ohhi.layout.v1.schema.json`](../spec/ohhi.layout.v1.schema.json),
  [`spec/ohhi.keymap.v1.schema.json`](../spec/ohhi.keymap.v1.schema.json) — JSON
  Schema (draft 2020-12) with every id enumerated.

All four are generated by `cd apps/web && rushx gen-schemas`, beside the CLI's
own `spec/` files (`cd apps/cli && rushx gen-schemas`); never hand-edit them.
`apps/web/src/lib/resource-schemas.test.ts` fails on drift, and
`apps/web/src/lib/customising-docs.test.ts` checks this page against the app.
