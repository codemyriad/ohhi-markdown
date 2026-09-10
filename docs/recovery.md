---
status: current
date: 2026-09-10
---

# When something goes wrong

This is for teammates dogfooding Editor. The short version: your notes are
ordinary files on disk, and Editor never holds the only copy of them. Nearly
everything that can go wrong can be undone, **as long as you set up snapshots
first**.

## Set this up first

1. **Keep your own notes in the desktop app.** A desktop vault is a real
   folder on your disk: you can snapshot it, back it up, or open it in any
   other editor. A browser vault lives in the browser's private storage, where
   no script, backup tool or file manager can reach it. The browser may also
   clear that storage to free up space unless it has promised to keep it.
   *Settings › Vaults & shares* shows whether it has, and can ask it to.
2. **Use the browser for joining team folders.** A shared folder's content also
   lives on your teammates' devices and on the relay, so losing a browser costs
   you a re-join, not notes.
3. **Turn on snapshots for every desktop vault:**

   ```sh
   scripts/vault-snapshot/vault-snapshot.sh install ~/path/to/your/vault
   ```

   Every 10 minutes, this commits the vault to a history kept *outside* the
   vault. It is covered in [scripts/vault-snapshot/README.md](../scripts/vault-snapshot/README.md).

## What keeps your notes safe

| | What it keeps | Where | How you get at it |
|---|---|---|---|
| **Your files** | the notes themselves | your vault folder | any app |
| **Snapshots** (once installed) | the whole vault, every 10 minutes | `~/.local/share/editor-snapshots/` (Linux), `~/Library/Application Support/editor-snapshots/` (macOS) | `vault-snapshot.sh log / show / restore` |
| **Pre-image journal** | a note's previous content, saved before *every* write or delete Editor makes to it; the newest 20 per note | Editor's app data (see [below](#getting-a-version-out-of-the-journal)) | by hand only |
| **Synced copies** | shared folders only | teammates' devices, and the relay | re-join the folder |

Snapshots are the recovery tool. The journal is a last resort: there is no
restore command for it yet. (The `editor restore` in the glossary hasn't been
built.) The sync devtools panel lists a note's journal entries by time and
size, but can't restore them.

## Undo a change with your snapshots

This works the same whether you broke the note yourself, Editor did, or a
teammate's edit or delete synced in. Put the good version back on disk, and
Editor treats it as an edit you made, which then syncs to everyone sharing the
folder.

```sh
vault-snapshot.sh log ~/Notes projects/plan.md            # find the version you want
vault-snapshot.sh restore ~/Notes projects/plan.md 3f2a1c9
vault-snapshot.sh restore ~/Notes projects 3f2a1c9        # or a whole folder
```

**Then quit Editor and open it again.** Here is why:

- **The note still exists** (you're undoing an edit). Editor notices the file
  change straight away and takes it in as an ordinary edit. Reopening does no
  harm.
- **The note had been deleted.** Editor only picks up *new* files when it opens
  a vault, not while it is running. Reopening brings the note back into the
  vault, and it syncs to the folder as a new note.
- **Big differences ask first.** Editor opens a review instead of applying the
  restore in two cases: the restored version differs from what Editor last saw
  by more than about 60% (on notes over about 240 characters), or the note also
  changed in Editor in the meantime. **Keep theirs** takes the version on disk,
  which is your restore.
- **Many files at once.** If more than 20 files changed while Editor was
  closed, it stops at a *"N files changed at once"* dialog before syncing any
  of them. **Apply changes** goes ahead. **Not now** leaves them alone for this
  session.

For a big restore, **quit Editor first, then restore, then open it**. You get
one dialog listing everything, instead of the changes flowing out one note at a
time while Editor runs.

A restore never deletes anything, and it snapshots the vault first, so you can
undo a restore the same way.

## What happens when…

| What happened | What survives | What to do |
|---|---|---|
| **Editor wrote something wrong into a note** (garbled, cut short, a bad merge) | the previous version, in your snapshots and in the journal | Restore it from a snapshot (above). No snapshots? Take it from the [journal](#getting-a-version-out-of-the-journal). Then [report it](#reporting-a-problem). |
| **A teammate's edit or delete synced to you** | your snapshots; the journal also holds the version Editor overwrote or removed on your disk | Restore the note or folder from a snapshot, then quit and reopen Editor. Your restored version syncs back to everyone. Let the teammate know. |
| **You deleted a note outside Editor** (file manager, terminal) | the synced content | Editor asks what to do. **Restore file** puts it back from the synced copy. **Confirm removal** deletes it for everyone sharing the folder, and journals a copy first. |
| **Editor's sync state is broken** (a vault won't open, or errors appear on every note) | your files: sync state is kept separately | Take a snapshot, then [report it](#reporting-a-problem) before anything else. The last resort is in [Resetting a vault's sync state](#resetting-a-vaults-sync-state). |
| **The relay is lost** | everything: every device keeps full copies, and the files are on disk | Keep working. Edits sync once the relay is back, and the sync pill won't show green until then. Restoring the relay from its backup is the operator's job. If it comes back without its data, or from a backup older than a share, those links stop working. The operator then creates the shares again and sends new links. Ask before re-joining: joining needs a new or empty folder. |
| **Browser storage was cleared** | shared folders, on teammates' devices and the relay | Re-join your shared folders from their links. Notes that lived only in that browser vault are gone, which is why your own notes belong in the desktop app. |
| **A lost machine or dead disk** | shared folders, on teammates' devices and the relay | Re-join shared folders on the new machine. Your private notes and your snapshots were on that disk, so only an off-machine backup brings them back. The snapshot script doesn't make one. |

### Resetting a vault's sync state

Use this only if Chris says so. Take a snapshot first.

In the vault manager, click **✕** on the vault, then **Remove?** to confirm.

- **Desktop vault:** your files are never touched. The vault's sync state,
  shares and tokens are deleted, and opening the folder again starts it fresh,
  with new share links. If the vault has shared folders in it, talk to Chris
  first, because they won't reconnect by themselves.
- **Browser vault:** ✕ **deletes its notes too**, because they live nowhere
  else.

*Settings › Vaults & shares › forget* is different: it only takes the vault
off the list.

## Getting a version out of the journal

This is desktop only, and a last resort. Editor keeps its own data in:

- Linux: `~/.local/share/dev.chris.editor/`
- macOS: `~/Library/Application Support/dev.chris.editor/`

Each saved version is one file under `stores/…/journal/`. The file is named
`<n>.<time>-<path>.bin`:

- `<time>` is milliseconds since 1970.
- `<path>` is the note's path, with `/` written as `%2F`.

The file holds the note's old content byte for byte. Copy it somewhere, rename
it to `.md`, and restore it like any other file. An empty file means the note
didn't exist before that write.

```sh
find ~/.local/share/dev.chris.editor/stores -path '*journal*' -name '*plan.md.bin' | sort
```

Only the newest 20 versions per note are kept. Copy the ones you need before
Editor writes that note many more times, and don't edit anything else in this
folder. A browser vault's journal is inside the browser and can't be reached.

## Where Editor keeps its state

- **Desktop:** the app data folder above. `stores/<vault>/` holds the vault's
  folder list (`mounts.json`). For the vault and for each shared folder, it
  also holds the sync state, what Editor last saw on disk (`lca.json`), and the
  journal. The vault list, settings and share tokens live in the app's own
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
2. **What you did, and roughly when.** Snapshots and the journal are
   timestamped, so the time narrows things down.
3. **The Activity section** in the right rail. It keeps every notice and error
   from the session, even after the toast has gone. Take a screenshot.
4. **The sync devtools for the affected note.** Turn them on in
   *Settings › Developer › Developer tools*, or with the toggle at the foot of
   Activity. In the browser, adding `?debug=1` to the URL turns them on for one
   session. Select the note and screenshot the panel. It shows the sync record,
   disk ↔ CRDT state and journal entries.
5. **The sync pill's colour**, and whether a teammate sees the same thing.
6. **Desktop app or browser** (and which browser), plus which vault and folder.

Send it all to Chris.
