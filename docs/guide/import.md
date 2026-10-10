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

### Pasting and dropping pictures

Paste a picture into a note, or drag picture files (PNG, JPEG, GIF, WebP,
AVIF, SVG, BMP) or a PDF onto it. While you drag, the note shows where the
file will be saved. The file is written into your folder — never over a file
that is already there — and a link goes in where you pasted or dropped it:
`![[Pasted image 20261010140307.png]]` for a picture, `[[paper.pdf]]` for a
PDF. A pasted picture is named by the time, as Obsidian names it; a dropped
file keeps its own name. If the name is taken, ` 1`, ` 2`… is added.

**Where it goes** follows Obsidian's own setting, *Default location for new
attachments* (`attachmentFolderPath` in `.obsidian/app.json`), read again
before every paste so a change in Obsidian applies at once:

- not set, or `/`: the top of the vault;
- `./`: the same folder as the note;
- `./name`: a folder called *name* inside the note's folder;
- anything else: that folder of the vault.

**In a shared folder, pictures stay inside the share.** The same setting is
read from the share's top instead of the vault's, so a picture never lands
outside the folder its note is in. Because pictures don't sync yet, the app
then tells you so: the people you share with see the note and the picture's
name, but a placeholder where the picture is. Pasting is still allowed; it
just never pretends they have the image.

**Finding a picture by name.** `![[shot.png]]` finds the file the way Obsidian
does: the exact path first, then beside the note, then any file of that name
anywhere in the vault, the shortest path first. So a picture in an
`Attachments/` folder shows without the folder in the link.

`![alt](picture.png)` with a path in your vault shows the picture too. One
with a web address (`https://…`) is **not** loaded when you open the note — an
image request tells the site you opened it — but waits in a box naming the
site, with *Load image* to fetch it. Some sites refuse to be loaded this way;
the box then says so.
