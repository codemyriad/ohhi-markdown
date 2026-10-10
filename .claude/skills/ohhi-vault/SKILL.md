---
name: ohhi-vault
description: Search, read and edit a markdown vault — Oh hi markdown or Obsidian — with the `ohhi` CLI: ranked search that returns references not bodies, a note's outline, one section or a line range, wikilinks and backlinks, tags, collections (`.base` files: saved views over notes whose frontmatter properties are the columns — list them, query a view, filter by a property), what changed since, and journaled atomic writes. Use when the user asks about "my notes", "my vault", "my second brain", an Obsidian vault, a note by name, wikilinks or backlinks, "what did I write about X", "find the note where I…", "which notes have status X", a table, database, collection or base of notes, or asks you to add to, patch, rename, move or restore a note.
---

# Read and edit a markdown vault with `ohhi`

`ohhi` reads a vault's **plain `.md` files on disk** — the canonical copy, the
same bytes Oh hi markdown, Obsidian and git see. It adds the editor's own index
(ranked search, the wikilink graph, tags, headings) and the editor's own write
discipline (a pre-image journal, then an atomic write), and nothing else (see
**Boundaries**).

Design it around the vault's real shape: notes are small (median ~1 KB) with
short generic titles (`Docs`, `JSON`, `Testing`) and a long tail of huge pasted
link dumps. So **ranked search is the entry point and reading whole notes is the
exception**.

## Setup check

Name the vault, then prove the tool can see it:

```bash
ohhi stats --json
```

A healthy answer is one JSON object with `docs`, `links`, `tags`,
`skippedBinary` and `buildMs`. Exit 2 with a message about the vault means
nothing has told `ohhi` where to look. There are three ways to say, in order of
precedence:

```bash
ohhi stats --vault "/home/you/Documents/black book"   # 1. explicit flag — always wins
export OHHI_VAULT="/home/you/Documents/black book"    # 2. environment
cd "/home/you/Documents/black book" && ohhi stats     # 3. walk up from cwd for .ohhi/ or .obsidian/
```

If the walk-up finds markers at **two** levels it refuses and names both
candidates — a vault inside a vault is ambiguous, and guessing would silently
answer from the wrong one. Pass `--vault` to settle it. Never invent a path: ask
the user which vault they mean.

`ohhi` is not on `PATH` by default. From a checkout of this repo:
`./scripts/install-ohhi.sh` builds it and symlinks `~/.local/bin/ohhi`.

`ohhi help` prints every command, its flags and the exit codes — it is generated
from the same contract this skill describes, so it is never out of date.

## Narrow before you read

The whole point of this surface is that you answer a question without pulling
the vault — usually without pulling a whole note. The ladder, in order:

1. **`search`** — references and snippets, never bodies. This is how you find
   out *which* note, and which line in it.
2. **`read --outline`** — headings, their line numbers and their sizes. No body
   text. One cheap call that tells you what is worth reading.
3. **`read --section "<Heading>"`** or **`read --lines a-b`** — the part you
   actually need.
4. Only then, if the note is genuinely small and you need all of it, plain
   `read`.

Rules that follow from that ladder:

- **Never `read` a note you have not outlined when it could be long.** Anything
  over ~400 lines, and anything `search` reported with a large size, gets
  `--outline` first. `read` has a 20 000-character budget and will truncate —
  truncation is honest (`truncated: true`, and `nextLine` to continue), but a
  truncated read is a wasted read when `--section` would have been exact.
- **`changes --since` before re-reading anything.** If you read a note earlier
  in the session, ask what moved instead of reading it again.
- **Let paging page.** Every list is limited and cursored. Take `--limit 10`
  and a `nextCursor`, not `--limit 1000`.

## Recipes

### Find the note

```bash
ohhi search "connection pooling" --limit 10
ohhi search "postgres" --path Areas/CS --limit 5     # restrict to a subtree
ohhi search "retro" --tag project                    # restrict to a tag (with or without #)
ohhi search "json" --limit 10 --explain              # why each hit ranked where it did
ohhi search "TODO(chris)" --exact                     # literal substring, unranked, document order
ohhi search "fixme|xxx" --regex --case-sensitive     # --exact/--regex are shorthands for --mode
ohhi search "docs" --limit 10 --cursor "<nextCursor from the last page>"
```

Ranked search is **always** folded and case-insensitive, so `--case-sensitive`
there is a usage error — as is `--tag` in `--exact`/`--regex` mode, because tags
come from the index and grep does not consult it. `--path` works in both, but a
folder name containing a **space** makes `total` come back `null`: the hits are
right, the count is not. Ranked search does **not** index URL text or fenced
code, so a pasted link dump cannot bury the small note actually named for the
word; when you *want* what is inside a URL or a fence, `--mode exact` and
`--mode regex` read the raw bytes.

### Read the part you need

```bash
ohhi read "Areas/CS/JSON.md" --outline               # headings + lines + section sizes
ohhi read "Areas/CS/JSON.md" --section "Decisions"   # one section
ohhi read "Areas/CS/JSON.md" --section "Notes/Open questions"   # B under A
ohhi read "Areas/CS/JSON.md" --lines 12-40           # 1-based, inclusive
ohhi read "Areas/CS/JSON.md" --frontmatter           # the block only
ohhi read "Areas/CS/JSON.md" --max-chars 4000        # tighter budget than the 20 000 default
ohhi read "Areas/CS/JSON.md"                         # whole note — the exception, not the default
```

A section is addressed by its **heading path**, matched case-insensitively on
the trimmed heading text; it runs from the heading to the line before the next
heading of the same or higher level. `not_found` means that heading is not
there — run `--outline` and use a heading that is.

If two mode flags are passed the winner is declared, not surprising:
**`--outline` → `--frontmatter` → `--section` → `--lines` → the whole note**,
and the output's `mode` field names which one applied. Truncation is always at a
line boundary — except a single line longer than `--max-chars`, which comes back
whole.

### Follow the graph

```bash
ohhi links "Areas/CS/JSON.md"        # wikilinks written IN the note, each with its resolution
ohhi backlinks "JSON"                # notes linking TO it — a bare name, as a wikilink writes it
ohhi backlinks "Areas/CS/JSON.md"    # or a path
ohhi resolve "JSON" --from "Daily/03-01-2025.md"   # where a link target actually points
ohhi unresolved --limit 20           # links with no target — the note-creation queue
ohhi tags --limit 50                 # tags with note counts
ohhi ls "Areas/CS" --depth 1 --kind text
ohhi stats
```

### Query a collection

A collection is a `.base` file (Obsidian's format): saved views over the notes
in a folder, whose properties are the columns. Rows come back as references
plus the columns you ask for — never bodies.

```bash
ohhi collections                                             # every .base, its views, live row counts
ohhi rows Competitors.base                                   # the first view: its columns and sort
ohhi rows Competitors.base --view "Threat Watch" --json      # a view by name
ohhi rows Competitors.base --where 'verified < today() - "30d"' --columns verified,threat
ohhi rows --where 'file.hasTag("meeting") && status != "done"'   # the whole vault, no collection
ohhi rows --columns status,due --sort due                      # every note as records, no filter
```

`--where` is one statement in the file's own grammar (comparisons, `&&` `||`
`!`, `file.hasTag/hasLink/inFolder/hasProperty`, `.contains/.isEmpty/
.startsWith`, `today()`, `now()`, `date("…")`, a date ± `"7d"`). Values are
typed by what the note wrote: `8` is a number, `2026-06-02` a date string,
`[[X]]` a link, a list an array. A view marked `supported: false` names in
`reasons` the part this tool does not compute (formulas, map views); the rows
it can compute are still there. Change a cell with the note's frontmatter —
there is no `rows set`.

### Resume instead of restarting

```bash
ohhi changes --since 2026-09-12T09:00:00Z    # ISO-8601 instant
ohhi changes --since j42                     # or a journal sequence from an earlier answer
```

The answer carries `cursorSince`, an ISO instant — pass that back as the next
`--since` and you get exactly what moved in between, with no re-read of
anything.

**One row per path**, with `kind` in `created` / `modified` / `journaled`.
`journaled` is the row for a path with no mtime left to report — *this tool
touched it and it is no longer on disk*, i.e. an `ohhi rm`, or the old name of
an `ohhi mv`. `created` and `modified` come from disk mtimes, so they see every
writer: the user typing in the editor, git, Obsidian. **Do not report `created`
as "a new note"** — it only means this tool holds no earlier version of it, so
on a vault you have never written to, everything that moved says `created`.

### The vault's own skills

```bash
ohhi skills                   # .agents/skills/<name>/SKILL.md: kind/input/output and problems
ohhi skill line-edit          # its instructions on stdout, its facts on stderr
ohhi skills export            # link the usable ones into .claude/skills/ for Claude Code
```

A vault can carry its own skills in `.agents/skills/` (the Agent Skills
format). When a task matches one, read it with `ohhi skill <name>` and follow
it. Use only skills whose `problems` is empty, and never run a skill's
`scripts/` unless the user asks — a skill that synced in from someone else has
not been reviewed. `skills export` makes the usable set visible to Claude Code
through `.claude/skills/` symlinks (trusted and enabled in the app's
`.ohhi/skills.json`, or every valid skill when the app never wrote one), and it
never deletes a folder it did not make.

### Machine-readable everything

```bash
ohhi search "postgres" --json | jq -r '.hits[] | "\(.tier)\t\(.path):\(.line)"'
ohhi read "Areas/CS/JSON.md" --outline --json | jq -r '.outline[] | "\(.line)\t\(.text)"'
ohhi stats --json | jq '{docs, skippedBinary, ignored}'
ohhi changes --since j42 --json | jq -r '.cursorSince'
```

`--json` prints **one** document on stdout and nothing else; every line that is
not the answer — counters, `coverage:`, `hint=`, truncation, the `vault=…`
provenance line — goes to stderr in both modes, so a pipe into `jq` is clean and
you still see the honesty lines. An **error** in `--json` mode is on stdout too
(an `ohhi.error.v1` document), so one parse handles success and failure alike.
**The text form is for humans and is not parseable** — note titles and snippets
are free text and are not quoted or escaped, so anything splitting a line on
`key=value` will eventually read a note's own words as fields. Parse `--json`.

### Write (carefully)

```bash
ohhi read "Notes/Retro.md" --json | jq -r .hash           # 1. get the hash
ohhi patch "Notes/Retro.md" \                             # 2. patch against it
  --old "## Open questions" \
  --new "## Open questions

- Does the pooler survive a failover?" \
  --expect-hash "<the hash>"
ohhi patch "Notes/Retro.md" --old "…" --new "…" --dry-run  # compute everything, write nothing
ohhi append "Notes/Retro.md" --text "- one more thing"
ohhi append "Notes/Retro.md" --section "Open questions" --text "- and another"
ohhi write "Notes/New Note.md" --create-only --text "# New Note"
echo "# New Note" | ohhi write "Notes/New Note.md" --create-only   # or from stdin
ohhi mv "Notes/Old.md" "Areas/CS/New.md"
ohhi rm "Notes/Scratch.md"                                # to .trash/, never deleted outright
ohhi restore "Notes/Retro.md" --list                      # pre-images kept before earlier writes
ohhi restore "Notes/Retro.md"                             # put the latest one back
ohhi restore "Notes/Retro.md" --seq 41
ohhi restore "Notes/Retro.md" --seq 41 --source app       # --seq 41 of WHICH journal
```

The rules, and why:

- **Prefer `patch` to `write`.** `patch` replaces one exact string and refuses
  when that string is not unique — which is what makes it safe to run against a
  note a human may have edited since you read it. `write` replaces the whole
  note, so a whole-file `write` used to make a small edit will silently discard
  anything that changed underneath you. Never work around a refused `patch` with
  a `write`.
- **Always `read` first and pass `--expect-hash`.** The hash comes from `read`'s
  output. It is what stands between you and clobbering a human's edit made
  between your read and your write; without it, "the note changed since I read
  it" is not detectable. (A write that loses a race *during* the call is always
  refused, hash or no hash — but that is a much narrower window than the one
  `--expect-hash` covers.)
- **`--dry-run` when unsure.** It computes everything — the match count, the
  resulting hash, where the appended line lands — and writes nothing.
- **Frontmatter is read-only.** `ohhi fm <path>` reads it; there is no `fm set`
  yet, and the surgical byte-preserving patcher that will make one safe does not
  exist. Do not edit frontmatter with `patch` or `write` to work around this —
  reserialising YAML is exactly the spurious-diff failure the editor forbids.
  Tell the user it is not available.
- **Keep bursts under 20 files.** `mv`/`rm` on a directory holding more than 20
  files is refused without `--yes`, and that refusal is the **only** guard: the
  running editor's own breaker does not catch a CLI burst. If you truly need a
  large batch, do it in runs of a dozen and say so.
- **`write`/`patch`/`append` only edit `.md` notes**; anything else is
  `refused`. `mv` and `rm` move any file, attachments included.
- Every write journals the previous bytes first, then writes atomically. That is
  what `restore` restores — including, when the editor's own store directory was
  given with `--app-store`, pre-images the app took. That union is honest only
  for the app's **root** store: a note inside a shared folder can show no app
  history even though the app has some, so say that rather than concluding the
  history is gone.
- **`rm` never unlinks.** The file goes to `.trash/<path>` *and* a pre-image is
  journaled under the note's **original** path, so
  `ohhi restore "Notes/Scratch.md"` puts it back where it was. `mv` is the
  opposite on purpose: it re-keys the journal, so a renamed note keeps its
  history under the new name.
- **`--seq` belongs to a journal.** The CLI's journal and the app's number
  independently, so `--seq 1` names a different pre-image in each; pass
  `--source cli|app` when you mean one of them. `restore --list` prints the
  source of every entry, and orders the union by `at`.
- **`restore --list` on a note with no history is an empty list and exit 0**,
  not an error. Say "nothing to restore" and stop; do not retry. (A plain
  `restore` with nothing to restore *is* exit 1 `not_found` — that call asked
  for a version back.)

## How to use what you get

**Snippets are matches, not quotations.** Ranked search folds case and
diacritics, so a snippet's bracketed match may not be spelled the way the query
was, and the brackets are the renderer's (a match inside a wikilink prints
`[[[JSON]]]`, not a malformed link). Quote the note, not the snippet —
`read --lines` around the hit's `line` first.

**`tier` says *why* a hit is where it is**, and it is usually the answer to
"is this the note they meant":

| `tier` | Meaning |
|---|---|
| `title` | The note's **name** is the query. For a one-word query this is almost always the note the user means — say so, and prefer it. |
| `path` | Every query term appears in the path. Strong, weaker than `title`. |
| `body` | Ranked on content. A high-scoring `body` hit in a 60 KB note is often a link dump, not a subject. |
| `grep` | `--mode exact`/`--mode regex`: an unranked literal match in document order. `score` carries no meaning here. |

**`coverage` tells you what the answer did not look at.** Every vault-walking
answer carries `{docs, skippedBinary, ignored}`. `docs` far below what the user
expects means you are pointed at the wrong vault. A non-zero `skippedBinary`
means **"nothing found" is not the same as "nothing exists"** — say so when a
search comes back empty. `ignored` names the directories never walked (`.trash/`
among them, which is why `rm` is safe and why a trashed note is not missing).

**`returned` / `total` / `nextCursor`** are on every list: `nextCursor: null`
means you have seen everything, `total: null` means the backend could not count
cheaply — never that there are none.

**An empty result is exit 0.** A search that found nothing succeeded. Do not
retry it with a bigger `--limit`; retry it with a different query, or with
`--mode exact` if you were searching for something that lives in a URL or a code
fence.

## Reading failures correctly

Exit code first, then the `code` field in `--json` mode (text mode prints the
message on stderr as `ohhi: <code>: <message>`). **Exit 1 is three different
answers** — `refused`, `not_found` and `runtime` all exit 1 and want different
responses — so branch on `code`, never on the exit code alone.

| Exit | `code` | What it means | What to do |
|---|---|---|---|
| 0 | — | Success, **including an empty list**. | Report the absence; check `coverage.skippedBinary` before calling it "nothing exists". |
| 2 | `usage` | No vault could be determined. | Ask the user for the path, or pass `--vault`. Do not guess, and do not search the filesystem for one. |
| 2 | `usage` | Ambiguous vault — markers at more than one level; `details.candidates` names them. | Ask which, then pass `--vault`. |
| 2 | `usage` | Bad flag, missing positional, or a value the schema refused (the message names the field). | Fix the invocation. Run `ohhi help` for the op's flags. |
| 3 | `conflict` | `--expect-hash` did not match: the note changed since you read it. | **Re-read it.** Look at what changed, decide whether your edit still applies, then retry with the new hash. Never retry by dropping `--expect-hash`. |
| 3 | `conflict` | The note changed *while the write was in flight* (somebody saved in the editor as you wrote). Happens with or without `--expect-hash`; **nothing was written**. | Re-read and retry once. If it keeps happening, the user is actively editing that note — say so and ask. |
| 1 | `refused` | `patch`'s `--old` is not unique — `details.occurrences` says how many. | **Widen `--old`** with surrounding lines until it is unique. Use `--all` only when you genuinely mean every occurrence. |
| 1 | `refused` | `patch`'s `--old` occurs zero times. | Re-read the note; the text is not what you thought. Do not fall back to `write`. |
| 1 | `refused` | `--create-only` on a note that exists. | Read it and `patch`/`append` instead, or pick another name. |
| 1 | `refused` | More than 20 files without `--yes`. | Confirm with the user, then pass `--yes` — or do it in smaller runs. |
| 1 | `refused` | Target is not a `.md` note, is binary, or the destination of a `mv` exists. | Pick a different path. |
| 1 | `refused` | A path outside the vault, or a symlink leading out of it. | Stay inside the vault. This is a guard, not a bug. |
| 2 | `usage` | `rows <path>` on a file that is not a `.base`; an unknown `--view` (`details.views` lists the real names); a `--where` outside the grammar (the message quotes the statement). | Pick a listed view; rewrite the statement with the operators and functions the recipe lists — there are no formulas. |
| 1 | `refused` | A `.base` that is not readable YAML. | Read it with `read`; the person fixes it in the app's Source mode. Do not rewrite it. |
| 1 | `not_found` | The note, or the `--section` heading, is not there. | For a note: `search` or `ls` for the real path. For a section: `read --outline` and use a heading it lists. |
| 1 | `not_found` | `restore <path>` with no pre-image, or a `--seq` that is not in that journal. | Run `restore <path> --list` first. If the list is **empty** (exit 0), nothing has a version to put back — say so and stop. If it is not, take a `seq` **and its `source`** from it. |
| 0 | — | `restore … --list` printed `entries: []`. | Not an error: nothing here has written that note. Do not retry, and do not go looking in `.trash/` unless the user asks. |
| 1 | `runtime` | An I/O failure — unreadable file, full disk, broken journal. | Read the message. Most are not worth retrying. |

## Boundaries

**This surface is files-direct.** It does not join a relay, hold a token, own a
CRDT or run a reconciler. It reads and writes the canonical `.md` files, and
that is the whole mechanism.

**It works whether or not Oh hi markdown is running.** When the app *is* open, it
notices your write through its own file watcher and ingests it — into the open
note, live in the pane, if the user is looking at it, and without rewriting your
bytes. If the user had unsaved edits to the same note, the divergence lands in
the app's review UI for them to resolve: nothing is written, your bytes are
still on disk and their sentence is still in the editor. It never becomes a
`.conflict` file and never silently wins. You do not need to check whether the
app is running, and you must not ask the user to close it.

Two things to tell the user rather than be surprised by:

- **`Mod+Z` will not undo your edit.** An ingested change is not on the user's
  undo stack (the same as a collaborator's edit). The undo is the app's History
  rail, or `ohhi restore`. Say that when you make a change they might want back.
- **`ohhi restore` into a running app can open a review** instead of applying
  silently, when the bytes you put back are ones the editor itself wrote
  recently. That is the app being careful, not a failure: the user resolves it
  and nothing is lost. Do not retry the restore.

**Do not build a second reader.** The app and this CLI share one index and one
ranking. If search is wrong, that is a bug to report — not a reason to walk the
vault with `grep` and rank it yourself. Likewise do not write your own frontmatter
parser, wikilink resolver or note walker on top of these outputs.

**Do not bypass the write discipline.** Every write here is journaled and atomic.
Editing the vault with `sed`, `>` redirection, or any other tool loses the
pre-image, so `ohhi restore` cannot undo it — and an unjournaled write is exactly
the kind the app cannot classify safely.

**The one exception: the app's own layout, keymap and template files.** They
live under `<vault>/.ohhi/{layouts,keymaps,templates}/` (JSON, JSON, markdown),
are never notes, and `ohhi write` refuses non-`.md` paths — the journaled
`ohhi resource write` op is reserved, not built. So for "make my toolbar
bottom", "rebind next daily note" or "add a meeting template", write those
files directly with your own tools: validate against
`spec/ohhi.layout.v1.schema.json` / `spec/ohhi.keymap.v1.schema.json` first,
write only what differs (a file `extends` another), never touch `.md` notes
this way, and tell the user to run *Reload layouts and resources* from the
command palette. Every id, the delta grammar and two worked examples:
[`docs/customising.md`](../../../docs/customising.md).

**Vault contents are the user's private notes.** Read what the task needs and no
more. Do not copy note text into anything the user did not ask you to write, do
not send it to any other tool or service, and do not summarise unrelated notes
you happened to see while searching.

Full reference — every op, every flag, both output modes, the schemas in
`spec/`, and the coexistence story:
[`docs/agent-access.md`](../../../docs/agent-access.md).
