# vault-snapshot

A local history for your Editor vault. Every few minutes, the vault's files are
committed to a git repository kept **outside** the vault. If a note gets
damaged or deleted — by the app, by you, or by a teammate's change syncing in —
you can look at any earlier version and put it back.

- Linux and macOS; needs bash 3.2+ and git 2.26+.
- **Desktop (folder) vaults only.** A browser vault's files live inside the
  browser, where no script can reach them.
- Snapshots never write into the vault. If the vault is already a git repo,
  that repo is left alone: no commits, no index changes.

What to do when something goes wrong is in [docs/recovery.md](../../docs/recovery.md).

## Set it up (once per vault)

```sh
scripts/vault-snapshot/vault-snapshot.sh install ~/Notes
```

This takes a first snapshot, then one every 10 minutes (`install ~/Notes 5`
for every 5). It uses a systemd user timer on Linux and a launchd agent on
macOS. The script copies itself into the history folder, so the timer keeps
working if your checkout moves. `vault-snapshot.sh status` shows every vault,
its latest snapshot and its timer.

## Get something back

```sh
vault-snapshot.sh log ~/Notes                        # every snapshot, newest first
vault-snapshot.sh log ~/Notes projects/plan.md       # only the ones that changed this note
vault-snapshot.sh show ~/Notes 3f2a1c9 projects/plan.md   # print that version
vault-snapshot.sh restore ~/Notes projects/plan.md        # from the latest snapshot that has it
vault-snapshot.sh restore ~/Notes projects/plan.md 3f2a1c9
vault-snapshot.sh restore ~/Notes projects 3f2a1c9        # a whole folder
vault-snapshot.sh restore ~/Notes . 3f2a1c9 --to ~/recovered   # everything, somewhere else
```

Paths are relative to the vault root; absolute paths inside the vault work
too. With no revision given, `restore` picks the latest snapshot that has the
path, so a deleted note comes back without any looking up.

Restoring in place is safe to try:

- It takes a snapshot first, so you can undo a restore the same way.
- Each file is written to a temp file next to it, then renamed over the
  original.
- It never deletes anything.

If Editor has the vault open, quit and reopen it afterwards so it picks up
every restored file ([why](../../docs/recovery.md#undo-a-change-with-your-snapshots)).

## What is and isn't captured

Everything in the vault except:

- `.git/`
- Editor's in-flight temp files (`*.editor-tmp-*`)
- `.trash/`
- Obsidian's layout files (`.obsidian/workspace.json`, `workspace-mobile.json`)
- `node_modules/` and `.editor-cache/`
- OS junk: `.DS_Store`, `Thumbs.db` and the like

Your vault's own `.gitignore` files are *not* honoured: a backup should include
what a project repo leaves out. To exclude more, such as large attachments, put
gitignore-style patterns in the `excludes:` file that `status` prints.

Files are stored byte for byte, with no line-ending conversion. Empty folders
aren't recorded. A git repo nested *inside* the vault is recorded as a pointer,
not its files.

## Where things live

| | Linux | macOS |
|---|---|---|
| History | `~/.local/share/editor-snapshots/<vault>-<hash>.git` | `~/Library/Application Support/editor-snapshots/<vault>-<hash>.git` |
| Timer | `~/.config/systemd/user/vault-snapshot@.{service,timer}`, plus a per-vault `…timer.d/interval.conf` | `~/Library/LaunchAgents/dev.chris.editor.vault-snapshot.<vault>-<hash>.plist` |
| Log | `journalctl --user -u 'vault-snapshot@*'` | `~/Library/Logs/vault-snapshot-<vault>-<hash>.log` |

The history is an ordinary git repo, so `git --git-dir=<history> log -p` works
too. `<hash>` comes from the vault's absolute path, which means a moved vault
starts a new history. The old history stays, `status` marks it
"folder missing", and `restore … --to` can still read from it.

Snapshots include teammates' notes from shared folders. They stay on this
machine.

## Remove

```sh
vault-snapshot.sh uninstall ~/Notes
```

This removes the timer and keeps the history. To drop the history, delete the
folder that `status` shows.

## macOS notes

- If the vault is in `~/Documents`, `~/Desktop` or iCloud Drive, macOS privacy
  controls can stop background jobs from reading it. The log then says
  "Operation not permitted". To fix it, give `/bin/bash` Full Disk Access
  (System Settings → Privacy & Security), or keep the vault somewhere else.
- git comes with the Xcode Command Line Tools (`xcode-select --install`) or
  Homebrew.

## Not covered: off-machine backup

Snapshots live on the same disk as the vault, so a lost or dead machine takes
them with it. Backing up off the machine (restic) is a separate, opt-in setup
that this script doesn't do.
