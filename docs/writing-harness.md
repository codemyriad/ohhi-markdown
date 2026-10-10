---
status: current
date: 2026-10-10
---

# The writing harness — an agent inside the editor

The reference for the **in-app agent**: a model you point at your own
provider, working over the vault from inside Oh hi — in a Session view beside
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
endpoint, and nowhere else. There is no Oh hi server in the path: the loop
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
providers; **not yet verified on every platform's build of this app**):

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

A **session** is a conversation with the agent, opened as a view tab
(`app.session`; *New AI session* in the palette; `Mod+Shift+L` adds the
selection to the current session, starting one if there is none). The composer
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
`ohhi_patch` or `ohhi_append`, the op runs against a capturing copy of the
backend; the bytes it would have written become a **suggestion** — a record
beside the text (`{ range, baseText, proposedText, status }`), drawn in the
note as the struck text and the inserted proposal, never bytes in the file.
The model is told it proposed (`ohhi.proposal.v1`), not that it wrote.

- **Accept** (`Mod+Enter` in the suggestion, or *Accept suggestion* /
  *Accept all suggestions*) applies it in one transaction carrying the run's
  agent origin. **Reject** (`Mod+Backspace`) drops it; the text is never
  touched.
- The range is pinned with Yjs relative positions, so it follows every edit
  around it. If anyone changes the text **inside** it before it is accepted, it
  turns **stale** and can no longer be applied — a proposal never reverts what
  changed under it.
- On a shared note the records live in the note's Y.Doc, so every peer sees
  the proposal and can accept or reject it. On a never-shared note they live
  in memory for the open note and are lost on reload.
- **Direct mode** (`ai.directEdit` in the device's config) accepts each
  proposal the moment it lands — the same record, the same origin, so it is
  still attributed and undoable.
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

`Mod+Shift+M` (*Comment on selection*) opens a thread on the selected text.
Threads live in the note's Y.Doc (`comments`) and are materialised to
`.ohhi/comments/<guid>.json`; they can be exported as CriticMarkup for review
elsewhere. Comments are not edits: writing, replying to or resolving one
changes no byte of the note and logs no `doc.changed`.

With a provider, a comment can be **sent to the agent**: it starts a run in the
note's session with the thread's passage as a line-range reference and the
comment as the instruction. A question gets a reply in the thread; a requested
change gets a suggestion linked to the thread, plus a one-line reply.

## 7. Skills

A **skill** is a folder in the vault's `.agents/skills/<name>/` with a
`SKILL.md` (the Agent Skills format: frontmatter `name`, `description`,
optional `metadata`). The app reads the same folders every other harness does.
`metadata.ohhi-kind` (`check`, `transform`, `generate`, `research`) says where
*Run a skill…* lands its result: comments, a suggestion, a new note or a
suggestion to insert, or the chat.

- **Trust.** A skill you made here or reviewed is trusted; one that arrived by
  sync, or that something else wrote, is listed untrusted and **not offered to
  the agent** until you review it. A trusted skill changed by someone else
  loses its trust. The state is `.ohhi/skills.json`, device-local — every
  person reviews for themselves. A skill's `scripts/` never run in the app.
- **The farm.** Claude Code reads `.claude/skills/` only. *Settings › AI ›
  Skills* (on desktop) or `ohhi skills export` links each usable skill there
  (`.claude/skills/<name>` → `../../.agents/skills/<name>`) and records what it
  made in `.claude/skills/.ohhi-farm.json`, so it never removes a skill it did
  not make. `.claude` is ignored by sync and the index.
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
  starting person's Yjs client, so a peer's Changes feed names the person,
  not the agent; the starting device's own log names the agent.

## Where the code is

| Piece | Path |
|---|---|
| Seams, providers, loop, prompt, tools | `libs/harness/src/` (`types.ts`, `model.ts`, `agent.ts`, `prompt.ts`, `tools.ts`) |
| The app's backend and transport | `apps/web/src/lib/agent-backend.ts`, `ai-transport.ts`, `ai-runs.svelte.ts`, `sessions.svelte.ts` |
| Suggestions, the agent origin, the throttle | `libs/workspace/src/suggestions.ts`, `agent-origin.ts`, `agent-throttle.ts`; drawn by `libs/editor/src/suggestions.ts` |
| The agent's presence | `libs/workspace/src/agent-presence.ts`; `apps/web/src/lib/agent-presence.ts`; `libs/editor/src/working-highlight.ts` |
| Comments | `libs/workspace/src/threads.ts`, `apps/web/src/lib/threads.svelte.ts`, `libs/editor/src/comments.ts` |
| Skills | `libs/agent/src/skills.ts` (the one loader), `apps/web/src/lib/skills.svelte.ts`, `apps/cli/src/skills-export.ts` |
| The mock LLM (tests) | `libs/testkit/src/mock-llm.ts`, `mock-llm-server.ts` (`@ohhi/testkit/src/node`) |
