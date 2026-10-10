---
title: Bringing notes from another app
status: current
date: 2026-10-10
---

# Bringing notes from another app

Oh hi markdown works on a folder of plain markdown (`.md`) files. Anything you
can turn into that folder, you can open. Nothing is imported into a database:
the folder *is* your notes.

## Obsidian

Open the vault folder itself: *Open a folder of notes*, then pick it. That is
all.

- Nothing in it is rewritten or moved. Obsidian and Oh hi markdown can both
  open the same folder.
- Obsidian's settings folder (`.obsidian/`) is left alone. Your daily-note
  settings are read from it, so *Today's daily note* lands where Obsidian
  would put it.
- `[[Wikilinks]]`, tags and frontmatter work as they do in Obsidian.

## Notion

1. In Notion: **Settings → Export**, or a page's **⋯ → Export**. Choose
   **Markdown & CSV**, include subpages, and download the zip.
2. Unzip it into a new folder.
3. In Oh hi markdown: *Open a folder of notes* and pick that folder.

Pages become notes and subpages become folders. A Notion **database** comes
out as a folder of notes plus a CSV file; for now it stays that way — a folder
you can browse, not a table. A proper Notion importer is planned; when it
arrives, this step gets shorter.

## Apple Notes, Bear, Logseq and others

Export to markdown from the app, put the files in a folder, and open the
folder.

- **Bear:** **File → Export Notes…**, choose Markdown.
- **Logseq:** your graph is already a folder of markdown files; open its
  `pages` folder (or the whole graph folder).
- **Apple Notes:** it has no markdown export of its own; use an exporter app
  or a shortcut that writes `.md` files, then open the folder.

## Attachments

Images and other files can sit in the folder beside your notes, and links to
them keep working on your own device. **Attachments do not sync to shared
folders yet**: people you share a folder with see the notes, not the images.
