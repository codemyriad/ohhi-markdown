---
title: Customising the app
status: current
date: 2026-10-10
---

# Customising the app

The shape of the app — where the toolbar sits, which buttons it has, what each
key does, the templates you insert, the colours — is kept in **files**. You can
change most of it from Settings, edit the files yourself, or ask an agent to
write them. The files are data, never code: nothing in them can run.

## The four kinds of file

| Kind | File | Chosen in |
|---|---|---|
| Layout | `layouts/<name>.json` | *Use layout file…* in the command palette |
| Keymap | `keymaps/<name>.json` | Settings › Keys |
| Template | `templates/<name>.md` | *Insert template…* in the command palette |
| Theme | `themes/<name>/theme.css` (in a vault only) | Settings › Appearance |

A file's name is its name in the app: `.ohhi/layouts/writing.json` is the
layout *writing*.

## Where the files live

Each kind is looked for in three places, in this order. The first place that
has a name wins:

1. **This vault**, in its `.ohhi` folder. It travels with the folder (git,
   Dropbox, a copy), so everyone who opens the vault gets the same files. It is
   never shared through a share link and never shows up as a note.
2. **Your config folder**, `~/.config/ohhi` on Linux and
   `~/Library/Application Support/ohhi` on macOS. Desktop app only; the app
   reads it but never writes to it.
3. **Built in**: the *default* layout and keymap, and the *daily* and
   *meeting* templates.

So a vault's `.ohhi/keymaps/default.json` replaces the built-in default keys
for everyone who opens that vault. The app always tells you which place a name
came from: a small label reads *this vault*, *config folder* or *built in*,
and "shadows built in" when a file hides one of the same name.

## See it all: Settings › Customise

**Settings › Customise** is where Settings opens, and the parent of the
four parts that choose what you use: Editor, Layout, Appearance and Keys. It
starts with **what is in use**: one line per kind (layout, keymap,
templates, theme) with where it came from, and a button to the part of
Settings that changes it. Below that it shows the three places in order,
the **files** — every other name you could pick — and **Problems**: any
layout or keymap file that can't be read, with the reason. A broken file
stays listed there until it is fixed.

- **Reload files** reads every place again. The desktop app notices a file
  that changes on disk by itself; in a browser, or when it didn't, use this
  (or *Reload layouts and resources* in the command palette).
- **Copy path** copies where a file is, to open it in your editor.
- **Copy as JSON** copies the layout or keymap in use as a complete file, a
  good starting point for your own.

## Layouts

Pick a layout file with **Use layout file…** in the command palette (each row
says where the file is from). Settings › Layout and Settings › Editor then
change *this device's* settings on top of that file — they apply at once and
are never written into the file. *Reset* in each section drops them.

A layout file only says what differs from another one:

```json
{
  "$schema": "ohhi.layout.v1",
  "extends": "default",
  "toolbar": { "position": "bottom" },
  "bars": { "format": ["-format.image"] }
}
```

saved as `.ohhi/layouts/bottom.json`, is the default layout with the toolbar
at the bottom and no image button. A layout can't hide the note's sync state:
a file that tries is refused.

## Keys

Settings › Keys changes keys as you go, with **Undo**. When the keymap in use
is one the app can't write (the built-in one, or one from your config folder),
your first change creates `.ohhi/keymaps/mine.json` in the vault, holding only
what you changed, and uses it from then on.

## Templates

Put a markdown file in `.ohhi/templates/`. It appears in the palette as
*Insert template: name*, and *Insert template…* lets you type its name and
arguments. `{{date}}`, `{{time}}` and `{{title}}` are filled in, and `$1`,
`$2`, … are the arguments you type after the name.

## When a file changes on disk

When a file in use changes — you saved it in your editor, `git pull` brought
a new one, an agent wrote it — the desktop app reloads it and says so, with
an **Undo**:

- for a **layout**, Undo goes back to the layout you had, for this session;
  the file itself is not touched (the app never writes layout files), and the
  next change to it or *Reload files* applies it again;
- for a **keymap** in this vault, Undo puts the file back as it was. The
  change is kept in the app's journal, so nothing is lost.

If the new file can't be used, nothing half-applies: the built-in default
stands in, a notice says which file and why, and **Show problems** opens
Settings › Customise. Every reload and problem is also in the **Log** (the
*Customise* filter shows only those).

## Ask an agent

An agent can write these files for you. Settings › Customise has a prompt to
copy, with your vault's folder filled in. See
[Working with an agent](agents.md) for connecting one.

The full reference — every field, every button and readout id, and the JSON
Schemas a file is checked against — is
[`docs/customising.md`](https://github.com/codemyriad/ohhi-markdown/blob/main/docs/customising.md)
in the Oh Hi markdown repository. The repository is private: the link opens
only for people with access to it.
