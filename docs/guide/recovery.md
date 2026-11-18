---
title: When something goes wrong
status: current
date: 2026-10-10
---

# When something goes wrong

This page is for everyone using Oh Hi markdown day to day. The short version: your notes are
ordinary files on disk, and Oh Hi markdown never holds the only copy of them. Nearly
everything that can go wrong can be undone, **as long as you set up snapshots
first**.

## Set this up first

1. **Keep your own notes in the desktop app.** A desktop vault is a real
   folder on your disk: you can snapshot it, back it up, or open it in any
   other editor. A browser vault lives in the browser's private storage, where
   no script, backup tool or file manager can reach it. The browser may also
   clear that storage to free up space unless it has promised to keep it.
   *Settings › Sync & devices* shows whether it has, and can ask it to.
2. **Use the browser for joining team folders.** A shared folder's content also
   lives on your teammates' devices and on the relay, so losing a browser costs
   you a re-join, not notes.
3. **Turn on snapshots for every desktop vault:**

   ```sh
   scripts/vault-snapshot/vault-snapshot.sh install ~/path/to/your/vault
   ```

   Every 10 minutes, this commits the vault to a history kept *outside* the
   vault. The script lives in the Oh Hi markdown repository, under
   `scripts/vault-snapshot/`; its README covers every command.

## What keeps your notes safe

| | What it keeps | Where | How you get at it |
|---|---|---|---|
| **Your files** | the notes themselves | your vault folder | any app |
| **Snapshots** (once installed) | the whole vault, every 10 minutes | `~/.local/share/ohhi-snapshots/` (Linux), `~/Library/Application Support/ohhi-snapshots/` (macOS) | `vault-snapshot.sh log / show / restore` |
| **Pre-image journal** | a note's previous content, saved before *every* write or delete Oh Hi markdown makes to it; the newest 20 per note | Oh Hi markdown's app data (see [below](#getting-a-version-out-of-the-journal)) | by hand only |
| **Synced copies** | shared folders only | teammates' devices, and the relay | re-join the folder |

Snapshots are the recovery tool. The journal is the last resort, and it has
two front doors: the *History* tab of the dock (the small icon strip at the
editor's right edge; it opens as a floating panel, or as the right sidebar
when pinned) lists a note's saved versions and puts one back, and `ohhi restore` does the same from a
terminal (`ohhi restore --list <path>`, then `--seq`). The developer
inspector (Settings › Developer, then *Open inspector*) shows how many
versions each file has, but restoring is the History section's job.

## Undo a change with your snapshots

This works the same whether you broke the note yourself, Oh Hi markdown did, or a
teammate's edit or delete synced in. Put the good version back on disk, and
Oh Hi markdown treats it as an edit you made, which then syncs to everyone sharing the
folder.

```sh
vault-snapshot.sh log ~/Notes projects/plan.md            # find the version you want
vault-snapshot.sh restore ~/Notes projects/plan.md 3f2a1c9
vault-snapshot.sh restore ~/Notes projects 3f2a1c9        # or a whole folder
```

**Then quit Oh Hi markdown and open it again.** Here is why:

- **The note still exists** (you're undoing an edit). Oh Hi markdown notices the file
  change straight away and takes it in as an ordinary edit. Reopening does no
  harm.
- **The note had been deleted.** Oh Hi markdown only picks up *new* files when it opens
  a vault, not while it is running. Reopening brings the note back into the
  vault, and it syncs to the folder as a new note.
- **Big differences ask first.** Oh Hi markdown opens a review instead of applying the
  restore in two cases: the restored version differs from what Oh Hi markdown last saw
  by more than about 60% (on notes over about 240 characters), or the note also
  changed in Oh Hi markdown in the meantime. **Keep theirs** takes the version on disk,
  which is your restore.
- **Many files at once.** If more than 20 files changed while Oh Hi markdown was
  closed, it stops at a *"N files changed at once"* dialog before syncing any
  of them. **Apply changes** goes ahead. **Not now** leaves them alone for this
  session.

For a big restore, **quit Oh Hi markdown first, then restore, then open it**. You get
one dialog listing everything, instead of the changes flowing out one note at a
time while Oh Hi markdown runs.

A restore never deletes anything, and it snapshots the vault first, so you can
undo a restore the same way.

## What happens when…

| What happened | What survives | What to do |
|---|---|---|
| **Oh Hi markdown wrote something wrong into a note** (garbled, cut short, a bad merge) | the previous version, in your snapshots and in the journal | Restore it from a snapshot (above). No snapshots? Take it from the [journal](#getting-a-version-out-of-the-journal). Then [report it](#reporting-a-problem). |
| **A teammate's edit or delete synced to you** | your snapshots; the journal also holds the version Oh Hi markdown overwrote or removed on your disk | Restore the note or folder from a snapshot, then quit and reopen Oh Hi markdown. Your restored version syncs back to everyone. Let the teammate know. |
| **You deleted a note outside Oh Hi markdown** (file manager, terminal) | the synced content | Oh Hi markdown asks what to do. **Restore file** puts it back from the synced copy. **Confirm removal** deletes it for everyone sharing the folder, and journals a copy first. |
| **Oh Hi markdown's sync state is broken** (a vault won't open, or errors appear on every note) | your files: sync state is kept separately | Take a snapshot, then [report it](#reporting-a-problem) before anything else. The last resort is in [Resetting a vault's sync state](#resetting-a-vaults-sync-state). |
| **The relay is lost** | everything: every device keeps full copies, and the files are on disk | Keep working. Edits sync once the relay is back, and the sync pill won't show green until then. Restoring the relay from its backup is the operator's job. If it comes back without its data, or from a backup older than a share, those links stop working. The operator then creates the shares again and sends new links. Ask before re-joining: joining needs a new or empty folder. |
| **Browser storage was cleared** | shared folders, on teammates' devices and the relay | Re-join your shared folders from their links. Notes that lived only in that browser vault are gone, which is why your own notes belong in the desktop app. |
| **A lost machine or dead disk** | shared folders, on teammates' devices and the relay | Re-join shared folders on the new machine. Your private notes and your snapshots were on that disk, so only an off-machine backup brings them back. The snapshot script doesn't make one. |

### Resetting a vault's sync state

Use this only if the person who looks after your team's setup asks you to.
Take a snapshot first.

In the vault manager, open the vault's **⋯** menu, choose *Remove from this
list…*, then **Remove?** to confirm.

- **Desktop vault:** your files are never touched. The vault's sync state,
  shares and tokens are deleted, and opening the folder again starts it fresh,
  with new share links. If the vault has shared folders in it, ask whoever
  shared them first, because they won't reconnect by themselves.
- **Browser vault:** removing it **deletes its notes too**, because they live
  nowhere else.

## Getting a version out of the journal

This is desktop only, and a last resort. Oh Hi markdown keeps its own data in:

- Linux: `~/.local/share/md.ohhi/`
- macOS: `~/Library/Application Support/md.ohhi/`

A version saved by a build from before 16 October 2026 may also be in the
older folder in the same place, `md.ohhi.desktop`, which the app copied from
and kept.

Each saved version is one file under `stores/…/journal/`. The file is named
`<n>.<time>.<size>-<path>.bin` (older versions may lack the `.<size>` part):

- `<time>` is milliseconds since 1970.
- `<size>` is the version's length in bytes.
- `<path>` is the note's path, with `/` written as `%2F`.

The file holds the note's old content byte for byte. Copy it somewhere, rename
it to `.md`, and restore it like any other file. An empty file means the note
didn't exist before that write.

```sh
find ~/.local/share/md.ohhi/stores -path '*journal*' -name '*plan.md.bin' | sort
```

Only the newest 20 versions per note are kept. Copy the ones you need before
Oh Hi markdown writes that note many more times, and don't edit anything else in this
folder. A browser vault's journal is inside the browser and can't be reached.

## Where Oh Hi markdown keeps its state

- **Desktop:** the app data folder above. `stores/<vault>/` holds the vault's
  folder list (`mounts.json`). For the vault and for each shared folder, it
  also holds the sync state, what Oh Hi markdown last saw on disk (`lca.json`), the
  journal, and `events.json` — that folder's recent changes and connection
  history as the Log view and the Shared view's Changes show them (capped, and
  safe to delete: it only empties those lists). The vault list, settings and share tokens live in the app's own
  local storage.
- **Browser:** the browser's private file storage (OPFS): `stores/` (the same
  sync state) and `vaults/` (browser vaults' notes). None of it is visible as
  files.

For a desktop vault, all of this is derived from your files and the relay.
Losing it costs a fresh sync, never a note.

## Reporting a problem

Capture the problem *before* you fix it. Fixing it destroys the evidence.

1. **Snapshot now** (`vault-snapshot.sh snapshot <vault>`). This freezes the
   broken state.
2. **Help › Report a problem…** (the question mark at the toolbar's right
   end, or *Report a problem…* in the command palette). Say what happened in
   a sentence; the app attaches the facts below and **Copy report** puts the
   whole thing on your clipboard. Paste it wherever you ask for help. The app sends
   nothing anywhere by itself, and note contents are never included: it
   carries paths, never text.

   What it attaches: the app's version and whether it is the desktop app or a
   browser; the open vault's name and kind; the relay and its state; the
   open note's path, its sync state in the pill's own words and how many
   people are online; how many errors and warnings this session has had; and
   the last 20 events from the Log, one line each.
3. **What you did, and roughly when.** Snapshots and the journal are
   timestamped, so the time narrows things down.
4. **The Log view**, if the problem is older than 20 events. Open it from the
   bell at the toolbar's right end with *Open the Log*, or with *Open log* in
   the command palette. It keeps every error, warning and notice from the
   session — and each shared folder's changes and connection history across
   restarts — even after the toast has gone, and even after you clear the
   bell's list (*Clear all*, a row's ×, or *Clear notifications* in the
   command palette): clearing takes rows out of the bell, never out of the
   Log. *Copy as text* puts the whole list on the clipboard.
5. **The sync inspector for the affected note**, if you are asked for it. Turn
   developer tools on in *Settings › Developer*, then open the inspector:
   *Open inspector* in the command palette, or the bug icon at the toolbar's
   right. In the browser, adding `?debug=1` to the URL turns developer tools on
   for one session. The note you were looking at when the inspector opened is
   selected (it does not follow the focus afterwards; click a row to pick
   another): its chain (disk, base — the text disk and doc last agreed on —
   doc, relay), its state in words, and the diff that explains it. (*Inspect
   this note* in the sync icon's hover card opens that note in its own
   inspector tab.) Then **Copy report** → *The selected file*, and paste the
   text into your report instead of a screenshot.
6. **Whether a teammate sees the same thing.**
