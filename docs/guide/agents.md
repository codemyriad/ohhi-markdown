---
title: Working with an agent
status: current
date: 2026-10-10
---

# Working with an agent

An AI agent — Claude Code, or any tool that speaks MCP — can search, read and
edit the notes in your vault with the `ohhi` command. It works on the files
directly, with the app open or closed, and every change it makes can be put
back.

## What an agent can do

- **Find notes**: ranked search that answers with references, never whole
  notes, so an agent reads only what it needs.
- **Read** a note's outline, then just one section or a few lines.
- **Follow links** and backlinks, and list links whose note doesn't exist yet.
- **See what changed** since a time.
- **Write, patch and append.** Each write is journaled first and made in one
  step, so a note is never left half-written.
- **Move and rename** (links follow), send a note to the trash instead of
  deleting it, and **restore** an earlier version.

Through MCP each of these is a tool of the same name, starting `ohhi_`
(`ohhi_search`).

## What you need

- **A vault in a folder on disk**, which means the desktop app. A vault kept
  in a browser lives in that browser's own storage, where no agent can reach
  it. To work on one with an agent, open or create a folder vault in the
  desktop app, or link the desktop app to it from **Settings › Sync &
  devices**, which keeps a copy of the vault as files in a folder you choose.
- **The `ohhi` command.** It isn't bundled with the app yet: today it
  installs from a checkout of the Oh hi markdown repository,
  [codemyriad/ohhi-markdown](https://github.com/codemyriad/ohhi-markdown) on
  GitHub. **That repository is private: you need access to it** to follow
  these steps. You also need git and Node 22.

  First get the repository and install its dependencies (the repository's
  own copy of Rush does it, so nothing else needs installing globally):

  ```sh
  git clone git@github.com:codemyriad/ohhi-markdown.git
  cd ohhi-markdown
  node common/scripts/install-run-rush.js install
  ```

  Then, from that folder, two scripts:

  ```sh
  ./scripts/install-ohhi.sh
  ./scripts/install-skill.sh
  ```

  The first builds `ohhi` and links it into `~/.local/bin` (make sure that
  folder is on your `PATH`); the second links the *ohhi-vault* skill into
  `~/.claude/skills`. Both make links rather than copies, so neither goes
  stale.

## Connect one: Settings › Agents

**Settings › Agents** has the lines to copy, with the open vault's folder
already filled in:

- **Claude Code**: start it with the vault named (`OHHI_VAULT="<folder>"
  claude`) and the skill does the rest. This is the recommended route: no
  tools stay loaded, and the skill carries the habits that keep an agent's
  reads small. Instead of the skill, you can add the commands as MCP tools
  (`claude mcp add ohhi -- ohhi mcp --vault "<folder>"`).
- **Another MCP client**: a server entry for its settings, running
  `ohhi mcp --vault <folder>`.
- **A terminal**: `ohhi stats --vault <folder>` checks it sees the vault,
  and `ohhi help` lists every command.

With no vault open, the lines show a placeholder path to replace with your
vault's folder.

## While the app is open

You don't need to close anything. An agent's edit reaches the app the way
any other app's would: the note updates in front of you, even while it is
open, and the file stays exactly what the agent wrote.

- **Ctrl+Z (Cmd+Z) does not undo an agent's edit**, just as it doesn't undo
  someone else's. Use the note's **History**, in the side panel, or ask the
  agent to `restore` it.
- If you were typing in the same note at the same moment, the app doesn't
  pick a winner: it shows both versions for you to review. Nothing is lost.
- The **Log** lists an agent's writes as changes from disk. The app can't yet
  tell an agent's change from another app's, so it doesn't claim to.

## Agents and the app's own files

An agent can also change how the app looks and behaves, by writing its
layout, keymap and template files in the vault's `.ohhi` folder. See
[Customising the app](customise.md).

The full reference for the command — every operation, its flags and its
output — is
[`docs/agent-access.md`](https://github.com/codemyriad/ohhi-markdown/blob/main/docs/agent-access.md)
in the Oh hi markdown repository. The repository is private: the link opens
only for people with access to it.
