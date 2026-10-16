---
status: current
date: 2026-10-10
---

# The writing harness — an agent inside the editor

The reference for the **in-app agent**: a model you point at your own
provider, working over the vault from inside Oh Hi — in a Session view beside
your notes, as suggestions in the text, as replies to comments, and as a peer
other people in a shared note can see. Ground truth for the decisions is
[`plans/writing-harness-shaping.md`](../plans/writing-harness-shaping.md)
(shape B, forks 1–8) and its build brief
[`plans/writing-harness-build.md`](../plans/writing-harness-build.md); this
doc is the operating reference over them.

The harness is the package `libs/harness` (`@ohhi/harness`): providers (Vercel
AI SDK 7), the tool loop, the system prompt, the skill loader's re-export and
the seams in `src/types.ts`. Its tools are the vault's own commands — the
`libs/agent` contract the `ohhi` CLI serves ([agent-access.md](agent-access.md))
— so the agent in the app and an agent in a terminal ask the vault the same
questions in the same words.

---

## 1. The quiet default, and the egress promise

**Nothing AI-shaped is on screen until you add a provider.** No palette rows,
no Session view, no *Send to agent*, no composer: every `ai.*` command carries
`when: aiEnabled`, and the Session view is listed only when a provider exists.
*Settings › AI* is the one surface that exists at rest — it is where a provider
is added.

**Nothing leaves this device until you add a provider.** With one, the text
you reference — and what the agent reads with its tools — is sent to that
endpoint, and nowhere else. There is no Oh Hi server in the path: the loop
runs in the app (the webview on desktop), and the requests go from it straight
to the provider's URL.

## 2. Providers

*Settings › AI › Providers*. A provider is `{ name, kind, baseUrl, model,
apiKey?, timeoutSec?, maxTokens? }` on this device (the app's config, never a
file in the vault, never synced). The key is write-only: no view shows it.

| `kind` | For | `baseUrl` |
|---|---|---|
| `anthropic` | Claude | empty = the vendor's; `/v1` is appended |
| `openai` | OpenAI (Chat Completions) | empty = the vendor's |
| `openrouter` | OpenRouter | empty = the vendor's |
| `openai-compatible` | Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-shaped server | required, e.g. `http://localhost:11434/v1` |

**Talking to a provider from a browser needs CORS** — the request comes from
the app's origin, not from a server. What each needs (documented by the
providers; **not yet verified on real hardware with any build of this app**):

- **Ollama**: start it with `OLLAMA_ORIGINS` set to the app's origin (the
  provider form names it).
- **LM Studio**: turn on *CORS* in its server settings.
- **Anthropic**: the harness sends `anthropic-dangerous-direct-browser-access:
  true`, Anthropic's opt-in for calls straight from a browser. The key is in
  this device's config; anyone with access to the device's storage can read it.
- OpenAI and OpenRouter accept browser calls as they are.

The terminal's providers (`ohhi ask`) live in `~/.config/ohhi/providers.json`
(same shape) — the two are configured separately
([agent-access.md §10](agent-access.md#10-ohhi-ask--the-writing-harness-from-a-terminal)).

## 3. Sessions, references and `@`

A **session** is a conversation with the agent, opened as a view tab. Its
doors: the speech-bubble icon on the toolbar (the `session` readout, drawn
only once a provider exists), *Open AI session* and *New AI session* in the
palette (`app.session`, `ai.new-session`), and `Mod+Shift+L`, which opens the
current session — starting one if there is none — carrying the selection
along as a reference when there is one. A selection has its own door: the **selection
handle**, a small pill at the end of a settled selection, offers *Comment*
and — once a provider exists — *Ask* (`ai.ask-selection`, the layout's
`bars.selection`). *Ask* opens the current session (or a new one) beside the
note with the selection as a line-range chip and the composer focused; it
sends nothing, the question is yours to type. It is `Mod+Shift+L`'s gesture
made visible, and it requires a selection (from the palette, without one, it
says to select some text). The handle never appears over a proposal.
A session opens **beside** the note it
was opened from, never over it: to the right while both halves keep 40rem,
below in a narrower pane; a second open goes to the pane already there rather
than splitting again, and *Open* on a session card brings the note back where
it already is.

**The first screen.** A session with nothing said yet is anchored to the
bottom, over the composer, which keeps its place and takes the keyboard:
*Start* — *Ask about ‹note›* (the note you came from, as a chip in the
composer), *Summarise ‹note›* (a turn of its own with the note as its
reference), *Run a skill…* (types the `/` that opens the skills) and
*Continue ‹last session›* — then the recent sessions as a list: the title,
the note it was about, when, and the provider. On a vault's very first
session it also says where the words go ("Text you reference is sent to
‹provider› at ‹host›"); after that, Settings › AI says it. The provider the
next run goes to is a picker at the composer's foot (with *Manage
providers…*), not a header readout — re-resolved from settings every run,
it only chooses which.

The composer
takes plain text plus **references**: type `@` for a menu of notes, folders and
headings, or hand it a selection. Each reference is a chip and resolves to one
of four kinds — a note, a folder (named only), a section (`path#Heading`), or a
line range (`path:12-20`) — rendered into the prompt as a fenced block headed
`path (12–20)` with the text's hash, so the agent can tell whether the note
moved on since.

The agent reads the vault with the read ops (`ohhi_search`, `ohhi_read`,
`ohhi_links`, `ohhi_backlinks`, … `ohhi_skills`, `ohhi_skill`) and the same
ladder the `ohhi-vault` skill teaches: search, then a note's outline, then one
section or line range. Each call is a card in the transcript; a hit opens its note.

**Sessions on disk.** Each session is one JSONL file at
`.ohhi/sessions/<id>.jsonl` (pi's session format): a header, then entries —
messages (AI SDK `UIMessage`s), **run records**, labels — each with a parent
id. A run record says what was asked (`refs`, `skill`, `instruction`), of
which provider and model, with what result (`status`, `usage`, `error`), and
which suggestions and comment thread it produced. `.ohhi/` is ignored by sync,
the index and enrolment, so sessions are this device's; writes go through the
journal (golden rule 1).

## 4. Suggestions, direct mode, *Undo agent edit*

**The agent never writes a note directly.** When it calls `ohhi_write`,
`ohhi_patch`, `ohhi_append` or `ohhi_fm` with `set`/`unset`/`rename` (a plain
`ohhi_fm` is a read, offered in a read-only run too; a write there is
refused), the op runs against a capturing copy of the
backend; the bytes it would have written become a **suggestion** — a record
beside the text (`{ range, baseText, proposedText, status }`), drawn in the
note as the struck text and the inserted proposal, never bytes in the file.
The model is told it proposed (`ohhi.proposal.v1`), not that it wrote.

- **Accept** (`Mod+Enter` with the caret in the suggestion, or *Accept
  suggestion* / *Accept all suggestions*) applies it in one transaction
  carrying the run's agent origin. **Reject** (`Mod+Backspace`) drops it; the
  text is never touched. The two keys are the editor's while the caret is in
  a suggestion and CodeMirror's own otherwise (`Mod+Enter` inserts a blank
  line), and Settings › Keys lists them on the two rows.
- **On the screen** (QA round 1): the *current* proposal — the one under
  the caret, else the next after it, else the first — carries an *Accept* /
  *Reject* pair right after it, its keys as hints (any other proposal shows
  its pair while the pointer is over it; a stale one offers *Reject* only).
  Each proposal has a mark in the gutter — a dot, numbered when the note
  holds several — that moves the caret to it. *Next suggestion* / *Previous
  suggestion* (`ai.next-suggestion`, `ai.previous-suggestion`, unbound by
  default) step the caret through them from the palette.
- **From the session**: a proposal's card shows the change as a diff and its
  status read from the same record (pending · changed since proposed ·
  applied · no longer proposed), with *Accept*, *Reject* and *Show in note*.
  Every one of them brings the proposal into view in its note first (the
  note where it is, else opened beside the session; the note scrolls to it);
  *Show in note* also moves the keyboard there, so `Mod+Enter` works at once.
- **One path.** The pair, the card, the keys and the palette all run the same
  registry commands (`ai.accept-suggestion`, `ai.reject-suggestion`) on the
  same suggestion record: a button and a key cannot disagree. A rejected
  suggestion's record is dropped, so its card says "no longer proposed".
- The range is pinned with Yjs relative positions, so it follows every edit
  around it. If anyone changes the text **inside** it before it is accepted, it
  turns **stale** and can no longer be applied — a proposal never reverts what
  changed under it.
- On a shared note the records live in the note's Y.Doc, so every peer sees
  the proposal and can accept or reject it. On a never-shared note they live
  in memory for the open note and are lost on reload.
- **Direct mode** (`ai.directEdit` in the device's config) applies each edit
  the moment it lands — the same record, the same origin, so it is still
  attributed and undoable. It is a device setting only: there is no
  per-session toggle yet.
- **A proposal needs the note open.** The suggestion lives on the note's live
  document, so the agent can propose only in a note that is open in this app
  (in any pane). A write to a closed note, or to a path that does not exist
  yet, is refused with an error the agent sees — it never lands on disk
  behind your back.
- **Undo agent edit** (`ai.undo-agent`) takes back everything the agent's last
  run applied, and only that: your own `Ctrl+Z` never undoes the agent, and
  undoing the agent never undoes what you typed inside its text.
- The edit is **attributed**: the event log records `doc.changed` with
  `actor: agent` and the run's name; the `last-agent-write` readout shows it.

**The agent's pace is bounded.** Every agent transaction — a proposal pinned,
a suggestion applied in direct mode — goes through a token bucket (10 per
100 ms, on the injected clock): a burst runs at once, the rest wait their turn,
nothing is dropped. The offsets are pinned when the agent asks, so whatever a
person types while an edit waits moves the edit with it.

## 5. The agent as a peer

While a run works on a **shared** note, the note's awareness carries a second
state beside yours: the agent, named `<name> (agent)`, with a status
(`thinking`, `composing`, `idle`) and the range it is working on. Everyone in
the note sees it:

- in the presence stack, the tab and the tree, in a presence slot like any
  person (never a sync colour);
- as a caret with its name tag, drawn by the collab binding like any peer's;
- as a soft **working highlight** over its range (`--ed-agent-working-bg`,
  [theming.md](theming.md)).

It stays `idle` for 15 s after the run ends — long enough to see who just
proposed — then leaves. Its awareness updates are coalesced to one per 300 ms.
A never-shared note has no awareness and shows nothing.

## 6. Comments, and *Send to agent*

*Comment on selection* (`note.comment`, `Mod+Shift+M`) opens a thread on the
selected text; a bare caret inside a commented passage opens that thread, and
with nothing selected it says to select the text first. The command has three
doors, all the same registry command: the key, the comment button at the end
of the default format bar (`bars.format` ends `"|", "note.comment"`; it is
pressable whenever a note is open, Reading included, and Settings › Layout's
formatting-bar picker can take it off), and the *Comment on selection* button
at the top of the dock's **Comments** tab. That tab lists the note's threads
behind an *Open n · Resolved n · All* segmented filter; its empty state names
the key in force and the bar button, and *Export as CriticMarkup* shows only
while there are open threads.
Threads live in the note's Y.Doc (`comments`) and are materialised to
`.ohhi/comments/<guid>.json`; they can be exported as CriticMarkup for review
elsewhere. Comments are not edits: writing, replying to or resolving one
changes no byte of the note and logs no `doc.changed`.

With a provider, a comment can be **sent to the agent**. The new-comment
bubble is a text box and two buttons: *Comment* (saves the thread, nothing
else) and *Send to agent* (saves it and starts a run with the thread's
passage as a line-range reference and the comment as the instruction).
Where it goes is said quietly under the buttons — "Sends to ‹the current
session›", or "Starts a new session" when there is none; with more than one
session that line is a small menu of the sessions and *New session*. A new
session is named after the comment's place ("Comment on plan.md (lines
3–4)"), not its words; a session you already have open keeps its own name
(an untitled one stays untitled), so its tab is still the one you had.
Once sent, the thread's *Sent to the agent* / *Answered* carries *Open
session*, and in the session the comment's turn says *From a comment in
plan.md* with *Show thread*, which opens the thread's bubble in its note. A question gets a reply in the thread; a requested
change gets a suggestion linked to the thread, plus a one-line reply.

## 7. Skills

A **skill** is a folder in the vault's `.agents/skills/<name>/` with a
`SKILL.md` (the Agent Skills format: frontmatter `name`, `description`,
optional `metadata`). The app reads the same folders every other harness does.
`metadata.ohhi-kind` (`check`, `transform`, `generate`, `research`) says where
*Run a skill…* lands its result: comments, a suggestion, a new note or a
suggestion to insert, or the chat.

- **Trust.** A skill you made here or reviewed is trusted, pinned to the
  hash of its **whole folder** as you reviewed it (scripts, references and
  assets included); one that arrived by sync, or that something else wrote,
  is listed untrusted and **not offered to the agent** until you review it. A
  trusted skill changed by someone else loses its trust, and any skill whose
  folder no longer hashes to what was trusted is not offered. *Trust* refuses
  a folder that changed since you opened its review. The state is
  `.ohhi/skills.json`, device-local — every person reviews for themselves. A
  skill's `scripts/` never run in the app.
- **Import.** From GitHub (pinned to a commit) or, on desktop, a local
  folder. Every file is written as its bytes — scripts, images, a `LICENSE` —
  through the journal; binaries are listed in the review, not shown. An
  import never lands over an existing folder, and fails whole if any file
  cannot be written.
- **The farm** puts usable skills in `.claude/skills/` for Claude Code — see
  [agent-access.md § the skills farm](agent-access.md#skills-export-not-an-op--the-skills-farm).
- The agent sees the usable skills' names and descriptions in its prompt and
  reads a body with `ohhi_skill` when one applies.

## 8. `ohhi ask`

`ohhi ask "…" --ref path#Heading` runs the same harness from a terminal, over
the files, **read-only** (no proposals: there is no document to propose in).
See [agent-access.md §10](agent-access.md#10-ohhi-ask--the-writing-harness-from-a-terminal).

## 9. Later

Not built, on purpose, with where each would go:

- **Shared sessions** — a session other people in the room can read and
  continue. `.ohhi/` is never synced (a decision, not a gap); a shared session
  needs its own shaping (a session as a room doc, or as a visible note).
- **Skill evals** — measuring a skill against examples before trusting it.
- **The relay as a host** — the loop running beside the relay (an agent
  that edits while nobody's app is open), shape C in the shaping doc.
- **Attribution on a peer.** The agent's edits reach other devices as the
  starting person's Yjs client, so **a peer's Changes feed names the person,
  not the agent**; only the starting device's own log names the agent.
- **Proposals in a closed note or a new path** — materialising the note's
  document for the proposal, so the agent can suggest in a note nobody has
  open, or propose a new note.
- **A per-session direct-mode toggle** in the Session header; today direct
  mode is the device setting only.
- **A review bar.** A row above the note while it holds proposals
  ("Suggestion 1 of 3", ‹ ›, Accept / Reject, Accept all / Reject all) —
  explored and held back until reviews of many proposals prove common; the
  pair, the gutter marks and the two stepping commands cover them today.
  *Accept all* / *Reject all* are palette rows only.
- **Default keys for stepping.** `ai.next-suggestion` /
  `ai.previous-suggestion` ship unbound until a pair of keys is chosen.
- **Importing CriticMarkup into threads.** The reader exists
  (`importCriticMarkup` in `libs/workspace/src/criticmarkup.ts`), but wiring
  it to an action means mapping each comment from the de-marked text back
  into the note that still carries the markup, and deciding whether the
  markup is then removed (a note edit) or left; until that is shaped, threads
  go out as CriticMarkup (*Export*) and do not come back in.

## Where the code is

| Piece | Path |
|---|---|
| Seams, providers, loop, prompt, tools | `libs/harness/src/` (`types.ts`, `model.ts`, `agent.ts`, `prompt.ts`, `tools.ts`) |
| The app's backend and transport | `apps/web/src/lib/agent-backend.ts`, `ai-transport.ts`, `ai-runs.svelte.ts`, `sessions.svelte.ts` |
| Suggestions, the agent origin, the throttle | `libs/workspace/src/suggestions.ts`, `agent-origin.ts`, `agent-throttle.ts`; drawn by `libs/editor/src/suggestions.ts` (the marks, the pair, the gutter); the commands in `apps/web/src/lib/suggestions.svelte.ts`; *Show in note* / *Show thread* in `suggestion-reveal.ts`; the card in `ToolCard.svelte` |
| The agent's presence | `libs/workspace/src/agent-presence.ts`; `apps/web/src/lib/agent-presence.ts`; `libs/editor/src/working-highlight.ts` |
| Comments | `libs/workspace/src/threads.ts`, `apps/web/src/lib/threads.svelte.ts`, `libs/editor/src/comments.ts` |
| The selection handle | `libs/editor/src/selection-bar.ts` (when and where), `apps/web/src/lib/components/SelectionBar.svelte` (the items, `bars.selection`); `ai.ask-selection` in `shell-commands.ts` |
| Skills | `libs/agent/src/skills.ts` (the one loader, the trust rule, the farm helpers), `apps/web/src/lib/skills.svelte.ts` (trust state), `skill-import.ts` (review and import), `skill-routing.ts` (`ai.run-skill` and where a run lands), `skills-farm.ts`; `apps/cli/src/skills-export.ts` |
| The mock LLM (tests) | `libs/testkit/src/mock-llm.ts`, `mock-llm-server.ts` (`@ohhi/testkit/src/node`) |
