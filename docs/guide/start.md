---
title: Getting started
status: current
date: 2026-10-10
---

# Getting started

Oh hi markdown is a notes app for a folder of plain markdown files. Your notes
stay ordinary files on your disk: any other app can open them, and Oh hi
markdown never keeps the only copy. When you want to, you can share one folder
with other people and edit it together, live.

This page takes about two minutes.

## Install the app

Use the desktop app for your own notes. A browser works too, but keeps its
notes inside the browser (see [the browser](#or-use-a-browser) below).

Download the newest release from the releases page your team uses (ask the
person who shared Oh hi markdown with you if you don't have the link).

**macOS**

1. Open the `.dmg` and drag **ohhi** into Applications.
2. The first launch is blocked ("Apple could not verify…"), because the app is
   not notarized yet. Clear it once, either way:
   - in Terminal: `xattr -dr com.apple.quarantine "/Applications/ohhi.app"`,
     then open the app normally;
   - or try to open it, then go to **System Settings → Privacy & Security**,
     find "ohhi was blocked…", choose **Open Anyway** and confirm with your
     password.

Updates after that install themselves; only the first launch needs this.

**Linux**

- The **AppImage** is the one to pick: `chmod +x ohhi_*.AppImage`, then run it.
  It needs FUSE 2. On Ubuntu 22.04 that is `sudo apt install libfuse2`; on
  24.04 and later, `sudo apt install libfuse2t64`.
- The `.deb` installs with `sudo apt install ./ohhi_*_amd64.deb`, but only
  updates itself when the release carries a signature for it. Prefer the
  AppImage.

## The first screen

The first time you open the app it asks one thing: what do you have?

- **Open a folder of notes.** Pick a folder on your disk and start writing.
  An Obsidian vault opens as it is; nothing in it is rewritten.
- **Add a folder someone shared with you.** Paste the link they sent you.
- **Bring your vault from another device.** Paste a device link you made on
  your other computer.

In a browser, the first door is **Start a vault in this browser** instead.

## Open your notes

Choose *Open a folder of notes* and pick the folder. Any folder of `.md` files
works: an existing Obsidian vault, a folder you already keep notes in, or a
new empty one. Your files are not moved or converted, and the app writes only
the notes you change.

Coming from Notion, Apple Notes, Bear or Logseq? See
[Bringing notes from another app](import.md).

## Add a folder someone shared with you

Someone sends you a link to a folder. Choose *Add a folder someone shared with
you*, paste the link, and pick where it goes: inside a vault you already have,
or as a vault of its own (the app asks for an empty folder to put it in).

The folder syncs through a relay, the small server your team runs. You need
to be able to reach it: on a team setup that usually means being on the
company network or VPN first. If the app says it can't reach the relay, that
is the thing to check.

More in [Sharing and the relay](sharing.md).

## Link a second device

Your own second computer gets your whole vault with a device link:

1. On the first computer: **Settings › Sync › Link a device…**, then copy the
   link.
2. On the second: *Bring your vault from another device*, paste the link and
   pick an empty folder.

A device link opens your whole vault, so it is only ever for your own
devices. Never send it to anyone else.

## Or use a browser

Your team may also serve the app in a browser. A browser vault lives inside
the browser's own storage: no backup tool or file manager can reach it, and
the browser may clear it to free space unless it has promised to keep it. It
is good for joining a shared folder from a machine that isn't yours; keep
your own notes in the desktop app.

## Where help is

The **question mark** at the right end of the toolbar opens Help:

- these guides, including [When something goes wrong](recovery.md);
- **Keyboard shortcuts**, which opens Settings › Hotkeys;
- **What's new**, the changes in the version you are running;
- **Report a problem…**, which copies a short report with the facts someone
  needs to help you. Paste it in your team chat.

Everything Help does is also in the command palette (`Ctrl+Shift+P`, or
`Cmd+Shift+P` on a Mac).
