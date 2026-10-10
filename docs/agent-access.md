---
status: current
date: 2026-10-04
---

# Agent access — the `ohhi` CLI, skill and MCP server

The reference for the **agent surface**: how an external harness (Claude Code
first, any Agent-Skills- or MCP-capable tool after) finds, reads and edits notes
in a vault. Ground truth for the decisions is
[`plans/agent-surface-shaping.md`](../plans/agent-surface-shaping.md) (shape A,
forks 1–4) and its build brief
[`plans/agent-surface-build.md`](../plans/agent-surface-build.md); this doc is
the operating reference over those decisions.

The agent *inside* the app — the Session view, suggestions in the text,
comments sent to the agent, skills in `.agents/skills/` — is the **writing
harness**, documented in [writing-harness.md](writing-harness.md). It calls
the same contract ops as its tools; `ohhi ask` (§10) is that harness from a
terminal.

The operating manual an *agent* reads is the skill,
[`.claude/skills/ohhi-vault/SKILL.md`](../.claude/skills/ohhi-vault/SKILL.md).
This doc is for the human who has to know what the skill is talking about.

---

## 1. What it is, and what it is not

**`ohhi` is files-direct.** It opens the vault folder, reads the canonical `.md`
files through `@ohhi/vault`'s Node adapter, builds an in-memory index
(`libs/index`) for the invocation, answers, and exits. Every write goes through
the same pre-image journal and temp-fsync-rename that the app's own writes do
(golden rule 1), then the file on disk is the new truth.

What it deliberately is **not**:

| Not | Why |
|---|---|
| A relay client | It never joins a room, holds a token or opens a websocket. No network round-trip ever gates a read (R6). |
| A CRDT peer | It owns no Y.Doc and no LCA store. Two reconcilers over one folder is the configuration `plans/shaping.md`'s decision log killed; the *running app* is the only reconciler over the vault. |
| A second index | The CLI and the app query the same `libs/index` contract with the same ranking. A ranking fix is made once (golden rule 8: the index is derived, never a system of record). |
| A system of record | Losing everything `ohhi` stores costs a rebuild and some undo history, never a note. |

**It works with the app closed and with the app open.** See §8.

**What an agent can do to the app itself — for now, by writing files.** The
app's layouts, keymaps and templates are files under
`<vault>/.ohhi/{layouts,keymaps,templates}/`, outside the notes (ignored by
sync and the index). `ohhi` has no op for them yet — `write` refuses non-`.md`
paths, and `resource write`, `layout`, `keymap`, `templates` and `ui get` are
**reserved** op names for the agent layer — so an agent writes them directly
with its own tools, unjournaled, validating against
`spec/ohhi.layout.v1.schema.json` / `spec/ohhi.keymap.v1.schema.json`, and the
person runs *Reload layouts and resources*. The formats, every command,
readout, region and view id, and worked examples:
[`customising.md`](customising.md).

**Status.** Slices G1–G4 of `plans/slices.md`, plus the collections series
(`collections`, `rows`, and `fm`'s write half — `plans/bases-shaping.md`).
`ohhi` never reserializes a YAML block: `fm --set` moves one value's bytes
through the flat-subset patcher (golden rule 2).

---

## 2. Install

Two scripts, both POSIX `sh`, both idempotent, both refusing to clobber anything
that is not a symlink they made:

```sh
./scripts/install-ohhi.sh          # rushx build in apps/cli, then ~/.local/bin/ohhi -> apps/cli/bin/ohhi.mjs
./scripts/install-skill.sh         # ~/.claude/skills/ohhi-vault -> .claude/skills/ohhi-vault
```

Both take `--force` (replace an existing non-symlink) and `--dry-run` (print the
plan, touch nothing). `install-ohhi.sh` also takes `--bin-dir <dir>` if
`~/.local/bin` is not where you want it.

The skill is installed as a **symlink**, on purpose: Cassini's one operational
gap is a skill that reached `~/.claude/skills` as a hand copy and went stale
against its repo. A symlink cannot.

Check `~/.local/bin` is on `PATH`; the script says so if it is not.

**In the app:** Settings › Agents shows these steps and the connect lines —
Claude Code (skill or `claude mcp add`), another MCP client's JSON config, and
plain `ohhi … --vault` — with the open vault's folder already filled in and a
Copy button on each. For a vault kept in browser storage it explains that no
agent can reach it, and how to get the vault into a folder on disk.
Its *Read the guide* — and Help › *Working with an agent* — open the
person-facing summary of this page, `docs/guide/agents.md`.

---

## 3. Selecting the vault

Three ways, in strict precedence order, and **never a guess**:

1. `--vault <path>` — always wins. Must exist and be a directory.
2. `OHHI_VAULT` in the environment.
3. A walk up from the current directory for a folder containing `.ohhi/` or
   `.obsidian/`.

If the walk-up finds markers at **more than one level**, the CLI refuses with
exit 2 and names both candidates (`details.candidates` in `--json`). A vault
inside a vault is genuinely ambiguous and answering from the wrong one is worse
than not answering. If nothing is found, exit 2 names all three ways to say
which vault.

**Data directory.** `ohhi` keeps its own pre-image journal (and nothing else of
consequence) under:

1. `OHHI_DATA_DIR`, else
2. `$XDG_DATA_HOME/ohhi`, else
3. `~/.local/share/ohhi`

Per vault it is `<dataDir>/vaults/<id>/journal`, where `<id>` is the first 16 hex
characters of the sha-256 of the vault's realpath — so two checkouts of the same
folder share a journal and two different vaults never do. `--data-dir <path>`
overrides it for one invocation (this is how the tests get a throwaway journal).

The **app's** journal is a separate namespace it owns alone: no shared writer,
ever. Point `ohhi restore` at it read-only with `--app-store <dir>` (repeatable),
where `<dir>` is the app's `stores/<room>` directory — see `restore` in §7 for
what the union can and cannot see today.

---

## 4. The contract

Every operation is declared once, in
[`libs/agent/src/contract.ts`](../libs/agent/src/contract.ts), as a name + a zod
input schema + a zod output schema + a description. The CLI's flags, its text
renderer, its `--json` mode, the MCP tool list, the JSON Schemas in `spec/` and
the conformance test are all **derived** from that file. That is how "one
implementation" (R3) is enforced instead of hoped. Changing an op's shape is a
contract change: bump its version, regenerate `spec/`, and update the renderer
and the skill in the same change.

### Envelope rules

- **Every output document carries `schema: "ohhi.<op>.v1"`.** A reader written
  against v1 keeps working while v1 is served, and a change of shape is a change
  of name rather than a silent drift. A version grows additively: a new optional
  input or a new output field is still v1 (ignore what you do not know);
  removing, renaming or retyping a field would be v2.
- **Every list carries `returned`, `total`, `nextCursor`.** `nextCursor: null`
  means the end; `total: null` means the backend could not count cheaply, not
  that there are none. Cursors are opaque — pass them back, never parse them.
- **Anything that walks the vault carries `coverage`:**
  `{ docs, skippedBinary, ignored }` — notes indexed, files seen and not
  indexed, and the directory names the adapter never lists (`.ohhi`,
  `.ohhi-cache`, `.git`, `.obsidian`, `.trash`, `node_modules`, `.claude` (the
  skills farm), and the pre-rename `.editor` and `.editor-cache` — shared with the app,
  `libs/vault`'s `IGNORED_DIRS`). This is the honesty counter that keeps
  "nothing found" from being read as "nothing exists" (R7).
- **Search returns references and snippets, never bodies** (R4). Reading is
  `read`, which is addressable below the note and budgeted.

### stdout, stderr, exit codes

**stdout is the answer. stderr is provenance.** In `--json` mode stdout holds
exactly one JSON object with a trailing newline and nothing else — warnings
(`note=3 binaries skipped`, `truncated at line 412`) go to stderr in both modes,
so a pipe into `jq` is always clean.

The **text form is for humans and is not parseable.** Note paths, headings and
snippets are free text and are not quoted or escaped; anything splitting a line
on `key=value` pairs will eventually read a note's own words as fields. This is
stated here and in the skill because the mistake is easy and silent.

| Exit | Meaning | `code` |
|---|---|---|
| 0 | Success — **including an empty list or an empty search** | — |
| 1 | Runtime failure, missing note or section, or a write the core refused | `runtime`, `not_found`, `refused` |
| 2 | Usage: bad flags, no vault, ambiguous vault | `usage` |
| 3 | The note moved under the write: an `--expect-hash` mismatch, or a change that landed while the call was in flight | `conflict` |

**Exit 1 is three different answers.** `refused`, `not_found` and `runtime` all
exit 1, and they want different responses — widen a `patch`, look up the real
path, or give up. A caller that branches on the exit code alone cannot tell
them apart: branch on `code` (from `--json`, or the `ohhi: <code>: …` prefix on
stderr).

An error in `--json` mode prints an `ohhi.error.v1` document on stdout —
`{ schema, code, message, details? }` — *and* the one-line message on stderr. In
text mode it prints only the message, on stderr. The line is always
`ohhi: <code>: <message>`, with the detail lines a usage error carries (candidate
vaults, the offending field) under it, and — on exit 3 — the standing advice
*"the note changed since you read it — re-read it and pass the new
`--expect-hash`"*.

`refused` is the code for a write the core declined on its own rules rather than
on an I/O failure: a `patch` whose `--old` is not unique, `--create-only` on an
existing note, more than 20 files without `--yes`, a non-`.md` or binary target,
a path that leaves the vault.

---

## 5. Global flags

| Flag | Meaning |
|---|---|
| `--vault <path>` | The vault root (§3). |
| `--json` | Print the output document instead of the human form. |
| `--data-dir <path>` | Override the journal/data directory (§3). |
| `--app-store <dir>` | The app's store directory, read-only, for `restore`'s union. Repeatable. |
| `--help`, `-h` | Print the usage. |

`ohhi` with no arguments, `ohhi help` and `ohhi --help` print the usage on
**stdout** and exit 0 — every op with one line of description (write ops marked
`*`), the global flags, the three ways to name a vault, the exit codes, and a
generated one-line grammar per op. An unknown command or an unknown flag prints
the same usage on **stderr** and exits 2; a bad *value* for a known flag prints
the one-line pointer `run \`ohhi help\` for the command list` instead.

Both the usage and the MCP tool list are generated from `OP_SCHEMAS` and the
grammar table — there is no hand-maintained list of commands anywhere.

When the vault was found by walking up rather than named, the CLI says so on
stderr before answering: `vault=/home/you/notes (found by .obsidian above the
working directory)`.

---

## 6. Read operations

### `ls [dir]`

List notes, binaries and folders under a directory.

`--depth <n>` (1 = direct children, the default; 0 = the whole subtree) ·
`--kind text|binary|dir|all` · `--limit` · `--cursor`

The vault root spells itself **`''`** — an empty string, not `.` — in the
output's `dir` field, because every other path in the contract is relative to
the root and the root is the empty prefix. (The text renderer prints `dir=.`
for readability; `--json` says `"dir": ""`.)

```text
$ ohhi ls Areas/CS --depth 1 --kind text
text   Areas/CS/HTML.md        size=961B   mtime=2026-03-04T11:02:07.000Z     # stdout
text   Areas/CS/JSON.md        size=154B   mtime=2025-11-22T09:12:41.000Z
text   Areas/CS/Networking.md  size=4.1K   mtime=2026-01-18T17:44:00.000Z
returned=3 total=398 dir=Areas/CS                                             # stderr
coverage: searched 1037 notes; 41 binaries skipped; ignored .claude, .editor, .editor-cache, .git, .obsidian, .ohhi, .ohhi-cache, .trash, node_modules
```

```jsonc
// ohhi ls Areas/CS --depth 1 --kind text --json
{
  "schema": "ohhi.ls.v1",
  "dir": "Areas/CS",
  "items": [{ "path": "Areas/CS/JSON.md", "kind": "text", "size": 154, "mtime": "2025-11-22T09:12:41.000Z" }],
  "returned": 3, "total": 398, "nextCursor": "…",
  "coverage": { "docs": 1037, "skippedBinary": 41, "ignored": [".claude", ".editor", ".editor-cache", ".git", ".obsidian", ".ohhi", ".ohhi-cache", ".trash", "node_modules"] }
}
```

### `read <path>`

Read a note — whole, its outline, one section, a line range, or its frontmatter —
within a character budget.

`--outline` · `--section "<heading path>"` · `--lines <a>-<b>` · `--frontmatter` ·
`--max-chars <n>` (default 20 000)

The modes are **exclusive and resolved in a declared order** —
`outline`, `frontmatter`, `section`, `lines`, whole note — rather than combined,
so passing two of them is deterministic rather than surprising. The mode that
won is named in the output's `mode` field.

- **`--outline`** returns headings with their level, 1-based line and the
  characters in the section. No body text. It is the cheap first call on any
  note you have not seen.
- **`--section`** takes a heading path: `Decisions`, or `Notes/Open questions`
  for the heading *Open questions* under *Notes*. Matched case-insensitively on
  the trimmed heading text. The section runs from the heading to the line before
  the next heading of the same or higher level. A heading that is not there is
  `not_found` (exit 1).
- **`--lines`** is 1-based and inclusive.
- **Truncation is explicit**: `truncated: true` plus `nextLine`, the first line
  *not* included, to pass back as the start of the next `--lines`. Truncation
  happens at a line boundary, never mid-line — with one deliberate exception: a
  **single line longer than the budget comes back whole**. A budget that
  returned nothing would leave the caller with no way to make progress, and an
  agent looping on `nextLine` forever is worse than one over-long line.
- Every mode returns `size` and `hash` — the sha-256 of the whole file's raw
  bytes, which is the `--expect-hash` for a later write.

In text mode the note's **text is the only thing on stdout** — path, mode, size,
hash and the line range go to stderr — so `ohhi read Notes/X.md > X.md` writes
the note and nothing else. `--outline` and `--frontmatter` print their table on
stdout instead.

```text
$ ohhi read "Areas/CS/JSON.md" --outline
     1  # JSON  (154 chars)                                    # stdout
     6    ## Gotchas  (71 chars)
path=Areas/CS/JSON.md headings=2 size=154B hash=9f2c…          # stderr
```

The hash on that stderr line is the one to pass as `--expect-hash`.

### `search <query>`

Find notes. Returns references and snippets, never bodies.

`--path <prefix>` · `--tag <tag>` · `--mode ranked|exact|regex` (default
`ranked`, with `--exact` and `--regex` as shorthands) · `--case-sensitive` ·
`--explain` · `--limit <n>` (default 10) · `--cursor`

Two combinations are refused as usage errors rather than quietly ignored:
`--case-sensitive` in ranked mode (ranked search is *always* folded and
case-insensitive — use `--exact` for a case-sensitive match) and `--tag` in
exact/regex mode (tags come from the index, which grep does not consult).
`--path` works in both: a query filter in ranked mode, a path prefix in grep
mode.

**`--path` with a space in it reports `total: null`.** The index parses `path:`
out of a whitespace-separated query, so a folder like `Edible/Dev Notes/`
reaches it truncated; the hits are re-filtered here so the answer is correct,
but the count the index returned was for the wider prefix. A number that is not
the count is worse than no number, so it is dropped — `total: null` means "not
counted cheaply", never "none".

```text
$ ohhi search "json" --limit 3
tier=title path=Areas/CS/JSON.md line=1 score=8.41                  # stdout
        1: # [JSON]
tier=body path=Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md line=14 score=3.02
       14: the importer takes a [JSON] payload per restaurant
tier=body path=Areas/CS/Postgres.md line=88 score=2.77
       88: `[json]b` columns index better than `[json]`
returned=3 total=131 query="json" mode=ranked                       # stderr
coverage: searched 1037 notes; 41 binaries skipped; ignored .claude, .editor, .editor-cache, .git, .obsidian, .ohhi, .ohhi-cache, .trash, node_modules
hint=ohhi read --outline Areas/CS/JSON.md   (then --section or --lines; never read a long note whole)
```

Matches are bracketed `[like this]` in the **text** form only (in `--json` they
are `spans` into the snippet text, unbracketed). The brackets are literal
characters added around the match, so a match inside a wikilink prints as
`[[[JSON]]]` — three brackets, not a nesting bug. Snippet lines are collapsed
to one line and clipped, so a hit inside a 4 KB paragraph never floods the
terminal.

**Every line that is not the answer is on stderr** — `returned=…`, `coverage:`,
`hint=`, the truncation line, and the `vault=… (found by …)` provenance line —
which is why `ohhi search … --json | jq` is clean and a human still sees all of
it.

Each hit is `{ path, tier, score, line, snippets[], explain? }`. `tier` is the
ranking structure, not a decoration:

| `tier` | Meaning |
|---|---|
| `title` | The folded basename **is** the query. For a one-word query this is nearly always the note meant. |
| `path` | Every query term appears in the path. |
| `body` | Ranked on content (BM25F over body + headings, with a phrase bonus). |
| `grep` | `--mode exact` / `--mode regex`: an unranked literal match in document order. `score` carries no meaning. |

Results are ordered tier → score → recency (tie-break only) → path.

**Ranked search excludes URL text and fenced code blocks from its terms** — the
measured reason is in the shaping doc: a 64 KB music note with "html" inside 40
URLs otherwise buries the 961-byte note actually called `HTML.md`. The raw text
is kept, so `--mode exact` and `--mode regex` still find those occurrences;
inline code is still indexed.

`--explain` adds per-hit rows of `{ term, field, contribution }` with `field` in
`body | title | heading | phrase`. It is off by default because it is not free.

### `links <path>`

Wikilinks written in a note, with their resolution: `{ target, alias, anchor,
embed, resolved, line, context }`. `resolved: null` is an unresolved link.

`--limit` · `--cursor`

### `backlinks <target>`

Notes that link to a target — a vault path, or a bare note name as a wikilink
writes it — with the line around each link.

`--limit` · `--cursor`

### `unresolved`

Wikilinks whose target does not exist: the note-creation queue. An unresolved
**embed** is a missing attachment, not a note to write, and is flagged as such.

`--limit` · `--cursor`

### `tags`

Tags in the vault with note counts. `--limit` · `--cursor`

### `resolve <target>`

Resolve a wikilink target to a vault path the way the editor does, so a tool and
the app agree on where `[[Docs]]` points. `--from <path>` gives the note the link
is written in, for proximity tie-breaks. `path: null` when nothing matches.

### `stats`

What the index covers, and what it cost:

```text
$ ohhi stats
vault=/home/chris/Documents/black book                     # stdout
docs=1037 terms=48210 links=949 unresolved=114 tags=37
skippedBinary=41 ignored=.claude,.editor,.editor-cache,.git,.obsidian,.ohhi,.ohhi-cache,.trash,node_modules
buildMs=253 indexSchemaVersion=3                           # stderr
```

`buildMs` is the cold index build for **this invocation** — the number the
`< 500 ms` cold-start budget (R6) is measured against.

### `changes --since <iso|j<seq>>`

Paths changed since an instant or since a journal sequence, so an agent resumes
instead of restarting (R4.1).

`--since` takes an ISO-8601 instant (`2026-09-12T09:00:00Z`) or a journal
sequence as `j<n>`. The answer is the union of two sources:

| `kind` | Source |
|---|---|
| `created` | A path on disk with an mtime after `since` and no earlier journal entry. |
| `modified` | A path on disk with an mtime after `since`, over which this tool holds a pre-image. |
| `journaled` | A pre-image record — a write this tool made — for a path with no mtime left to report. |

**`created` does not mean "new to the vault."** It means *nothing here wrote
over anything* — this tool holds no pre-image predating the file. On a vault
`ohhi` has never written, every changed path is `created`, including notes the
user edited in the app an hour ago. The distinction that is always true is
`journaled` vs the rest: `journaled` is "we touched it and it is no longer on
disk" (an `rm`, the old name of an `mv`), which is the one case with no mtime to
report.

**One row per path**, never one per event: when a path is in both sources the
disk row wins the `kind` (it describes what is there *now*) and keeps the
journal's `seq`. So `journaled` means exactly *"this tool touched it and it is
no longer on disk"* — an `rm`, or the source side of an `mv` — which is the one
case that has no mtime left to report.

Sorted by `at`. The answer carries **`cursorSince`**, an ISO-8601 instant (not a
`j<seq>`): pass it back as the next `--since` and you get exactly what moved in
between. `changes` does not build the index — resuming has to be cheap or it
will not be done.

### `skills`

The skills in the vault: every folder under `.agents/skills/` holding a
`SKILL.md` ([Agent Skills](https://agentskills.io/specification) — the folder
Codex, Gemini CLI, Cursor, OpenCode, pi and Copilot read natively). One row per
skill: `name`, `description`, `dir`, Ohhi's `kind` / `input` / `output` (from
`metadata.ohhi-kind` / `ohhi-input` / `ohhi-output`), `hasScripts` and
`problems`. `--limit` · `--cursor`

```text
$ ohhi skills
fact-check  check/section/annotate       Flag claims that need a source. …  scripts=true
line-edit   transform/selection/replace  Tighten prose for rhythm and …
returned=2 total=2 dir=.agents/skills                       # stderr
```

`problems` are validation codes — **empty means valid**, and a skill with
problems is listed (so it can be fixed) but never offered to a model or
exported:

| Code | Rule |
|---|---|
| `frontmatter-missing` / `frontmatter-invalid` | SKILL.md opens with a `---` block the reader can take |
| `name-missing` · `name-format` · `name-length` · `name-mismatch` | `name` is `a-z0-9-` (no leading, trailing or doubled `-`), ≤ 64, and equals the folder name |
| `name-reserved` | `anthropic` / `claude` in a name, or `synced` (Claude Code's reserved words) |
| `description-missing` · `description-length` | 1–1024 characters |
| `compatibility-length` | ≤ 500 characters |
| `metadata-nested` | `metadata` is a map of string → string, one level |
| `metadata-kind` · `metadata-input` · `metadata-output` | `ohhi-kind` ∈ check, transform, generate, research · `ohhi-input` ∈ selection, section, note, folder · `ohhi-output` ∈ replace, insert, annotate, new-note |
| `body-length` | the instructions are ≤ 500 lines |
| `lint-command` · `lint-context` · `lint-hooks` | no `` !`cmd` `` injection, no `context:`, no `hooks:` — Claude-only features a vault skill must not carry |

### `skill <name>`

One skill: `meta` (every field above plus `license`, `compatibility` and the
whole `metadata` map) and `body` — SKILL.md below its frontmatter, the
instructions a model is given when the skill runs. The text view prints the
body on stdout and the facts on stderr. `not_found` (exit 1) when there is no
`.agents/skills/<name>/SKILL.md`.

### `skills export` (not an op) — the skills farm

This is the one full account of the **skills farm**; the code and the other
docs point here.

**Why it exists.** Claude Code reads `.claude/skills/`, not `.agents/skills/`.
The farm puts each **usable** skill there. Usable is valid *and*, once the app
has written `.ohhi/skills.json`, trusted and enabled in it **and** unchanged
since it was trusted — the folder's whole-content hash (every file, not just
`SKILL.md`) must still equal the hash recorded at review. No state file at all
(a vault the app never opened): every valid skill is usable — the person put
it there.

**Two writers, one manifest.**

- `ohhi skills export` **links**: `.claude/skills/<name>` →
  `../../.agents/skills/<name>`.
- The desktop app **copies** (Settings › AI › Skills › *Export for Claude
  Code*; the Tauri fs plugin cannot make links), every file of the skill,
  re-copied when it changes. In the browser there is no farm: no other app
  reads OPFS.
- Both record what they made in `.claude/skills/.ohhi-farm.json`:
  `{ version: 1, skills: { <name>: { by: cli|app, kind: symlink|copy, files? } } }`
  — for a copy, every file it wrote. A CLI link is left as it is while the
  skill is wanted by the app (it already shows the skill).

**What it never touches.** A name in `.claude/skills/` the manifest does not
record is someone's own skill: reported `blocked` and left alone. The manifest
is a file in the vault, so it is read as untrusted input: an entry whose name
is not a valid skill name, or whose `files` reach outside its own
`.claude/skills/<name>/` (`..`, an absolute path, a backslash), is dropped
whole — that folder is then treated as someone else's.

**Removing.** A skill no longer wanted (disabled, untrusted, deleted, changed
since review) loses its farm entry — every harness treats presence as enabled.
A link is removed, never followed; a copy loses exactly the files the manifest
lists, each one's bytes recorded in the pre-image journal first (golden
rule 1), then the folders it leaves empty. A folder someone added a file to
stays. Turning the app's farm off removes the app's copies, never a CLI link.

**The command.** `--dry-run` reports without writing; `--json` prints
`ohhi.skills-export.v1` `{dir, linked, removed, blocked, dryRun}` (a host
command like `ohhi mcp`: no MCP tool, no `spec/` schema). `.claude` is in the
ignored set, so the farm is never synced or indexed twice.

### `collections [dir]`

Every collection in the vault — a `.base` file in Obsidian's format, read as
a documented subset (`libs/collections`) — with its views and how many notes
each shows right now:

```text
$ ohhi collections
Competitors.base                                          # stdout
    All                      table       3 rows
    Direct                   table       2 rows
    Latest two               table       2 rows
returned=1 total=1                                        # stderr
coverage: searched 16 notes; 1 binaries skipped; ignored .editor,.editor-cache,…
```

A view with a formula column prints `(partly: \`formula.age\` is not computed
here)` after its row count.

A view is `supported: false` with `reasons` when a part of the file is outside
the subset this tool reads — a formula column, a `map` view, a function the
grammar does not know. The rows it *can* compute are still returned. `issues`
names top-level blocks read past (`formulas are not computed here`). `error`
is set, and `views` empty, when the file is not readable YAML.

`--limit` · `--cursor`

### `rows [collection]`

The rows of a collection view: each note as a **reference** (`path`, `name`)
plus the columns asked for — never bodies. Values are what the note says
(the index types them by their written form): a number is a number, `true`
is a boolean, `2026-06-02` is a date string, `[[Clusters]]` is the link's
text, a list is an array, an empty or absent property is `null`.

```bash
ohhi rows Competitors.base                                   # the first view, its columns and sort
ohhi rows Competitors.base --view "Threat Watch"             # a view by name (case-insensitive)
ohhi rows Competitors.base --where 'verified < today() - "30d"'   # narrow further, same grammar as the file
ohhi rows Competitors.base --columns threat,verified --sort verified:desc
ohhi rows --where 'file.hasTag("meeting") && status != "done"'    # no collection: every note in the vault
```

With no collection and no `--where`, every note in the vault is a row, and the
columns are the name plus every property those notes carry. A collection
with no `views:` still applies its global filters.

`--where` takes one statement in the file's own filter grammar, ANDed with
the view's filters: comparisons (`==` `!=` `<` `<=` `>` `>=`), `&&` `||` `!`,
`file.hasTag(…)`, `file.hasLink(…)`, `file.inFolder(…)`,
`file.hasProperty(…)`, `.contains(…)`, `.containsAny(…)`, `.containsAll(…)`,
`.isEmpty()`, `.startsWith(…)`, `.endsWith(…)`, `now()`, `today()`,
`date("…")` and a date ± a duration (`"7d"`, `"2 weeks"`). A statement outside
that is a `usage` error naming the statement — formulas are not evaluated
here. `--columns` are property ids as the file writes them (`file.name`,
`status`, `note.status`); with neither a view nor `--columns`, the columns are
the name plus every property the rows carry. A view's `limit` caps the rows
returned. `--limit` · `--cursor`

Rows are references on purpose: `read` the ones that matter. The text
renderer prints the path first for the same reason.

Errors: a path that is not a `.base` → `usage`; an unknown `--view` → `usage`
with `details.views` naming the ones there are; a `--where` the grammar
refuses → `usage` naming the statement; a `.base` that is not readable YAML →
`refused`.

---

## 7. Write operations

All of them: pre-image journaled, then written temp-fsync-rename through the
adapter, with the note's recorded EOL flavour and BOM restored so a CRLF file
stays byte-identical where it was not edited (golden rule 1 and 2). All of them
take `--dry-run` (compute everything, write nothing) and, except `mv`/`rm`/
`restore`, `--expect-hash <h>` (refuse unless the note's current hash is `h`;
exit 3 otherwise).

**`write`, `patch` and `append` edit NOTES and refuse anything else**: a
non-`.md` path is `refused`, as is content that looks binary. An attachment, a
`.canvas`, a stylesheet all have an owner that is not a text patcher.
**`mv` and `rm` accept any file**, `.md` or not — moving a PNG is still moving
a file, and refusing would leave an agent with no way to tidy a vault.

**Every write is a compare-and-swap, `--expect-hash` or not.** Reading the note
and writing it are not one atomic act — the durable journal write sits between
them — so a human saving in Editor, or git, or a second `ohhi`, can land in that
window, and their bytes would be overwritten while the journal held the
*pre-race* pre-image. `writeAtomic` therefore re-reads and re-hashes immediately
before the rename and refuses if the bytes moved: `conflict`, exit 3, nothing
written. So **exit 3 can happen without `--expect-hash`** — it means "somebody
wrote while this call was in flight", and the answer is the same: read it again
and retry. (`--expect-hash` guards a longer window: everything since the agent
last *read*.)

### `write <path>`

Create or replace a note. Text comes from `--text <s>` or stdin.

`--create-only` (refuse when the note exists) · `--expect-hash` · `--dry-run`

Refused for a non-`.md` path or text that looks binary. Returns `created`,
`bytes`, `hash`, and `journalSeq` — the sequence of the pre-image taken before
the write, `null` when the note was new or on a dry run.

**Prefer `patch`.** A whole-file `write` used to make a small edit discards
anything that changed underneath you.

### `patch <path> --old <s> --new <s>`

Replace one exact string. `--old` must occur **exactly once** unless `--all` is
given; otherwise the write is refused with `details.occurrences` and nothing is
written. This unique-match rule is what makes a patch safe against a note a human
may have touched since it was read.

`--all` · `--expect-hash` · `--dry-run`

### `append <path>`

Append text (from `--text` or stdin) at the end of the note, or — with
`--section "<heading path>"` — at the end of that section, before the next
heading of the same or higher level, keeping one blank line. Returns the 1-based
`line` the appended text starts on.

`--section` · `--expect-hash` · `--dry-run`

### `fm <path>`

Read a note's frontmatter, or change it one key at a time. Flat subset:
`key: scalar`, `key: [a, b]`, block lists of scalars. Anything nested returns
`supported: false` with the raw block and no entries, rather than a lossy
parse — and refuses a write.

```bash
ohhi fm "Competitors/Ingredifind.md"                                  # read; `hash` is the --expect-hash for a write
ohhi fm "Competitors/Ingredifind.md" --set depth=Deep --set score=8   # one value's bytes per key
ohhi fm "Competitors/Ingredifind.md" --set verified=2026-06-02 --set active=true
ohhi fm "Competitors/Ingredifind.md" --set-list pillars="[[Clusters]],[[Pricing]]"
ohhi fm "Competitors/Ingredifind.md" --unset draft --rename threat=threat_level
ohhi fm "Competitors/Ingredifind.md" --set depth=Deep --expect-hash <hash> --dry-run
```

`--set KEY=VALUE` writes `true`/`false` as booleans and plain decimals as
numbers, everything else as text — quoted only where a plain scalar would read
back as something else (`"8"` when you meant the text; a quoted value reads
back as text, in `fm`, `rows` and the app alike). `--set-list KEY=A,B` writes
a block list (quote an item that holds a comma; it wins over `--set` for the
same key). `--set KEY=` leaves the key with no value (reads back as `null`);
`--set-list KEY=` writes `[]`. Order: `--rename`, then `--unset`, then
`--set` — so `--unset a --set a=x` ends with `a: x`, and `--rename a=b --set
a=x` ends with both `b` and a new `a`. The patcher moves the value's bytes
and nothing else: the key's spelling, a trailing comment, every other line and
the body stay (golden rule 2). A note with no block gets one; unsetting a key
that is not there is a no-op; a batch that changes nothing writes nothing
(`changed: false`, `ops` says how many keys were asked). A block outside the
flat subset (nested, multi-line, anchors, a duplicate key) is `refused` with
`details.reason` — edit it in the note; renaming onto a key that exists is
`refused` naming the key; an empty or multi-line key or value is `usage`.
Journaled, atomic, compare-and-swap like every write: `--expect-hash` ·
`--dry-run` (shows the block as it would be; `hash` is always the disk's, so
it is the one to expect next); `journalSeq` is the handle `restore` takes.

### `mv <from> <to>`

Move or rename a note or a directory (any extension — see above). The target
must not exist (`refused`), and a move of a directory into itself is `refused`.
A directory holding more than 20 files needs `--yes` (see the note under `rm`).

**The journal is re-keyed** (`journal.rename`): every pre-image for the old
path, and prefix-wise for the subtree under it, moves to the new one — the note
is still the note, so its recoverable history follows it. Journal first, then
the disk move, so a crash in between leaves history pointing forward rather
than nowhere.

`--yes` · `--dry-run`

### `rm <path>`

Move a note or folder to `.trash/<path>` — Obsidian's convention — creating
`.trash/` and suffixing on collision. **It never unlinks.**

The suffix goes **before the extension**: a second removal of `Notes.md` lands
at `.trash/Notes~1.md`, which is still a markdown file a user can open, where
`.trash/Notes.md~1` would not be.

**`rm` journals a pre-image per file, under the file's ORIGINAL path, and does
not re-key the journal** — the opposite of `mv`, deliberately. Two recoveries
follow: the file itself is sitting in `.trash/` where a user can drag it back,
and `ohhi restore <the original path>` puts it back where it was.

**More than 20 files needs `--yes`** (`mv` too). This is the *only* guard on a
burst: the app's mass-change breaker counts known paths **per watch event**, and
Node's recursive watcher delivers one path per event, so a CLI writing 25 files
produces 25 batches of one and never reaches it (Spike S11-Q5, finding F4).
Anything claiming Editor's breaker catches a big CLI batch is wrong.

`--yes` · `--dry-run`

### `restore <path>`

The command four docs promised and nothing implemented until now.

`--list` lists the pre-images available for a path, newest first, each with
`seq`, `at`, `size` and `source` — `cli` for this tool's journal, `app` for the
running editor's, when one was given with `--app-store`. Restoring journals the
*current* bytes first (so a restore is itself undoable), then writes the chosen
pre-image; the default is the latest of any source. The pre-image is written as
the **raw bytes** that were on disk, so its own EOL and BOM travel with it and a
restore is byte-exact by construction.

`--list` · `--seq <n>` · `--source cli|app` · `--dry-run`

**`--list` always succeeds, including with nothing to list.** A note no journal
has a pre-image for answers `entries: []` and exits 0: an empty list means an
empty list, and "what can I put back?" has the answer "nothing". A `restore`
*without* `--list` and no candidate is a different question — it asked for a
version back and there is none — and is `not_found`, exit 1.

**`seq` is only comparable within a `source`.** The two journals have
independent sequence spaces (separate directories, no shared writer — Spike
S11-Q4), so `--seq 1` names one pre-image in each. `--source cli|app` says
which you mean; without it the newer of the two wins and the other is
unreachable. Across the union it is **`at` that orders**, to millisecond
resolution, which is why the listing is sorted by it and why per-path
latest-of-either is enough (no total order exists, and none is needed: a wrong
pick is one more `restore` away from right).

**`--app-store` is honest only for the root mount today.** The app keys a
mount's journal by the path *its own session* sees: the root mount is
vault-relative, but a carved or joined mount runs over a scoped adapter and its
entries are **mount-relative** (Spike S11 finding F3). Nothing prefixes them
back — `mounts.json` names each mount's `path` but no vault root, so the CLI
cannot find the store dirs on its own either. Point `--app-store` at the root
mount's `stores/<room>` and it works; point it at a shared folder's and
`restore --list` will quietly list nothing for `team/plan.md` while the entry
sits under `plan.md`.

---

## 8. Coexistence with a running app

**Reads are never stale.** `ohhi` reads the files, and the app's writes reach
disk atomically, so a read either sees the old bytes or the new ones and never a
torn file.

**A write reaches a running app through its own disk path.** The sequence, all of
it code that already exists for git and Obsidian:

1. `ohhi` journals the note's current bytes, then writes the new bytes
   temp-fsync-rename.
2. The app's recursive watcher fires; the change is quiesced (30 ms on the
   injected clock) so a file still being written is read twice, not once.
3. The reconciler classifies the note against its LCA. Disk-ahead is ingested as
   one `disk`-origin transaction of character ops into the live Y.Doc —
   **including when the note is open in a pane**: what the open-doc rule skips
   is *materialization*, not ingest. The user watches the paragraph appear, and
   **Editor writes no bytes of its own** — the file stays literally the agent's
   write, so `git diff` shows the agent's change and nothing else, and the
   ingest does not arm a flush that would churn mtime or reflow EOL/BOM.
4. If the user also had unflushed edits to the same note, it is a genuine
   three-way divergence and lands in the **review UI**: **nothing is written and
   nothing is journaled**, the human's sentence is still in the CRDT and the
   agent's bytes are still on disk. It never becomes a `.conflict` file, and
   neither side silently wins. The pending 800 ms flush does not overwrite the
   agent either — a flush is a reconcile with editor ownership suspended, not a
   blind write. Resolving the review writes once and journals the agent's bytes
   it replaces, so the agent's version stays recoverable.

No lock, no handshake, no "please close the editor". The agent does not need to
know whether the app is running.

Three consequences worth knowing before they surprise someone:

- **`Mod+Z` does not undo an agent's edit.** Ingested ops carry origin `'disk'`,
  which is outside the shared `Y.UndoManager`'s tracked origins — the same
  reason a remote peer's edit is not on your undo stack. The undo path for an
  agent write is the History rail or `ohhi restore`, not the keyboard (Spike S11
  finding F5).
- **Putting a note back to a state Editor recently flushed opens a review.** The
  stale-echo guard is content-hash equality against the last 8 things Editor
  itself wrote, and it cannot tell a deliberate `ohhi restore` from another
  editor's stale autosave buffer — so it escalates and lets a human look.
  Nothing is lost either way. Expect it; do not retry. It is best-effort: the
  ring is in memory and is thrown away by an app restart or a session restart
  (finding F2), so the same restore may apply silently instead.
- **A big batch is not caught by the app.** The mass-change breaker counts known
  paths per watch *event*, and Node's watcher emits one path per event, so a CLI
  burst never reaches it (finding F4). `ohhi`'s own `--yes` rule at 20 files is
  the guard.

**Editor's own write is a compare-and-swap too** (finding F1, fixed) — the
mirror of the rule in §7. Editor's
`materialize` reads a file to classify it, journals the pre-image, and only then
writes; a write landing inside that window used to be overwritten with no
journal entry and no review. `VaultAdapter.writeAtomic` now takes an
`expectHash` and refuses with a `WriteConflictError` if the bytes moved, and the
reconciler re-classifies instead of writing — so an agent's bytes are ingested
or reviewed, never silently replaced, in every ordering.

The behaviour above is pinned by **Spike S11**,
[`plans/spike-s11-agent-write-coexistence.md`](../plans/spike-s11-agent-write-coexistence.md),
and by its L1 fixture (`libs/workspace/test/agent-write-coexistence.test.ts`) —
which is where the answers live for: ingest into an open note without fighting
the caret (S11-Q1), a pending flush against an agent write (S11-Q2), the
stale-echo ring when an agent reverts its own edit (S11-Q3), whether `restore`
needs a total order across both journals (S11-Q4), and whether refusing >20 files
is enough against the breaker (S11-Q5). Read the spike before changing any of it.

**Journals do not merge.** The app writes its own namespace, `ohhi` writes its
own, and neither is a writer in the other's. `restore` reads the union and
labels each entry's `source`.

---

## 9. `ohhi mcp` — the MCP server

A stdio MCP server over the same core, in `apps/cli/src/mcp.ts`. One tool per op,
named `ohhi_<op>`; input schemas are generated from the same zod schemas
(`z.toJSONSchema`), descriptions come from the registry, and each result is the
`--json` document as text content. An `OpError` comes back as `isError: true`
carrying the `ohhi.error.v1` document. The vault is resolved once at start-up,
from `--vault`, the environment, or the cwd.

```sh
claude mcp add ohhi -- ohhi mcp --vault "/home/you/Documents/black book"
```

This is the replacement for the third-party `@bitbonsai/mcpvault` entry in
`~/.claude.json`. For Claude Code the **skill is the better route** — it costs no
resident tool definitions and it carries the operating discipline — so the MCP
server exists for harnesses that cannot run a skill.

The tool list is generated, never hand-written: a new op in `contract.ts` is a
new MCP tool with no further work. The MCP SDK is imported lazily, only when
`ohhi mcp` is the command — a cold `ohhi search` must not pay for ~200 KB of
transport it never uses (R6).

---

## 10. `ohhi ask` — the writing harness from a terminal

```sh
ohhi ask "what did I decide about pooling?" --ref Areas/CS/Postgres.md#Decisions
ohhi ask "summarise this week" --provider local --model llama3.1 --json
```

`ohhi ask` runs the **writing harness** (`libs/harness`, the same loop the app's
Session view runs) with this process as its host: a model, the vault's own
commands as tools, and an answer. It is **not a contract op** — it is not a
vault operation but an agent run over the vault — so it has no `OP_SCHEMAS`
entry, no `spec/` schema and no MCP tool, like `ohhi mcp`.

- **Read-only.** The model is offered the read ops only (`ohhi_search`,
  `ohhi_read`, `ohhi_links`, …, `ohhi_skills`, `ohhi_skill`) — never `write`,
  `patch`, `append`, `mv`, `rm` or `restore`. The system prompt restates the
  skill's ladder for the tools: search, then outline, then a section or a line
  range.
- **Output.** The answer streams to **stdout**; each tool call is one line on
  **stderr** (`tool=ohhi_search query="pooling" limit=5`), then a provenance
  line (`provider=… model=… tokens=in/out`). With `--json`, stdout carries one
  `ohhi.ask.v1` document and nothing else:
  `{ schema, text, usage: { input, output } | null, tools: [{ name, input }] }`
  (its zod schema is `AskOut` in `apps/cli/src/ask.ts`).
- **Flags.** `--provider ID` (default: the file's `defaultProvider`, else the
  first), `--model M` (overrides the provider's), `--skill NAME` (the vault
  skill `.agents/skills/NAME`, its body in the prompt; a skill with problems is
  refused), `--ref` (repeatable): `path` (the note, attached when it fits the
  read budget), `path/` (a folder, named only), `path#Heading/Sub` (one
  section), `path:12-20` (a line range). Attached text goes into the prompt
  under *References*, headed `path (12–20) · hash …`.
- **Providers** come from `$XDG_CONFIG_HOME/ohhi/providers.json` (else
  `~/.config/ohhi/providers.json`), the app's `AiConfig` shape:

  ```json
  {
    "providers": [
      { "id": "claude", "name": "Claude", "kind": "anthropic", "baseUrl": "", "model": "claude-sonnet-4-5" },
      { "id": "local", "name": "Ollama", "kind": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "llama3.1" }
    ],
    "defaultProvider": "claude"
  }
  ```

  `kind` is `anthropic`, `openai`, `openrouter` or `openai-compatible` (the
  last needs `baseUrl`; the others default to the vendor's endpoint). The key
  is `apiKey` in the file or, overriding it, `$OHHI_API_KEY`; it is never read
  from the vendors' own environment variables. `timeoutSec` and `maxTokens`
  are honoured as in the app.
- **Exit codes.** 0 · **1** a provider or run error, with the provider's
  message (`ohhi: runtime: claude: invalid x-api-key`) · **2** usage: no
  providers file (the message names the path to create), an unknown
  `--provider`, a bad `--ref`, a flag that is not `ask`'s.

The harness and the AI SDK under it are imported lazily, only for `ask`: a cold
`ohhi search` does not pay for them (R6). The app's own providers live in its
settings on the device, not in this file — the two are configured separately.

---

## 11. `spec/` and the conformance test

`spec/` holds a JSON Schema per output document —
`spec/ohhi.<op>.v1.schema.json` plus `spec/ohhi.error.v1.schema.json` — with
`$id: https://ohhi.md/schema/ohhi.<op>.v1.schema.json`. They are **generated**
from `libs/agent/src/contract.ts` and committed:

```sh
cd apps/cli && rushx gen-schemas
```

Two more files in `spec/` are not op outputs but the app's own resource
formats — `ohhi.layout.v1.schema.json` and `ohhi.keymap.v1.schema.json` — and
are generated by the app, which owns the command table and the catalogues they
enumerate: `cd apps/web && rushx gen-schemas` (drift test:
`apps/web/src/lib/resource-schemas.test.ts`; see [`customising.md`](customising.md)).

Regenerate, never hand-edit. `apps/cli/test/conformance.test.ts` is the gate,
and it asserts three things:

1. **No drift** — the schema on disk for every op equals the freshly generated
   one. A contract change that did not regenerate `spec/` fails here.
2. **Real output validates** — every op is run through `run([…, '--json'])` over
   a fixture vault and the stdout document is parsed by
   `OP_SCHEMAS[op].output`.
3. **Exit codes are a contract** — 0 on an empty search, 2 on an unknown op and
   on no vault, 3 on an `--expect-hash` mismatch, 1 on a `read` of a missing
   note.

---

## 12. Where the code is

| Path | What |
|---|---|
| `libs/agent/src/contract.ts` | **The contract.** Every op's name, schemas and description. |
| `libs/agent/src/backend.ts` | `VaultBackend` — root, adapter, lazy index, docs, journal, clock, coverage. |
| `libs/agent/src/select-vault.ts` | Vault selection and the data directory. |
| `libs/agent/src/ops/` | One file per op, registered in `ops/index.ts`. |
| `libs/collections/src/` | The `.base` reader, the filter grammar and the view patcher behind `collections` and `rows`. |
| `apps/cli/src/run.ts` | `run(argv, io) => exit code` — no framework, `node:util` `parseArgs`. |
| `apps/cli/src/render/` | The text renderers (humans only). |
| `apps/cli/src/mcp.ts` | The stdio MCP server. |
| `apps/cli/src/ask.ts` | `ohhi ask` — the Node host of `libs/harness`, and `ohhi.ask.v1`. |
| `apps/cli/src/gen-schemas.ts` | Writes `spec/`. |
| `spec/` | The generated JSON Schemas. |
| `.claude/skills/ohhi-vault/SKILL.md` | The agent-facing operating manual. |

`libs/agent` is host-neutral: it knows nothing about a process, a terminal or a
transport, and it takes an injected `Clock` (golden rule 5) — the CLI passes
`RealClock`, tests pass `SimClock`. When V3 lands `apps/agentd` and the
live-session agent peer, `VaultBackend` gains an app-backed implementation and
the CLI and MCP server gain presence without a second vocabulary.

Running the tests and the cold-start bench:
[`running-and-testing.md`](running-and-testing.md) §3.
