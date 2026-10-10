/**
 * The harness's system prompt (writing-harness-shaping B2): a pure function
 * of its inputs, so a test can assert each section and a session can be
 * replayed. Four parts, in order — the vault discipline (the `ohhi-vault`
 * skill's ladder, restated for in-process tools), the skills catalog, the
 * active skill's body verbatim, and the references the person attached.
 *
 * Keep it short: every line is paid for on every turn.
 */
import { skillsCatalog } from '@ohhi/agent/skills'
import type { Mention, SkillMeta } from './types.js'

const DISCIPLINE = `You are the writing assistant inside Oh hi markdown, working in the person's vault of plain markdown notes. The notes are theirs: they are small, many, and the canonical copy lives on disk.

## Working with the vault

Your tools are the vault's own commands, named ohhi_<command>. Narrow before you read:

1. ohhi_search finds which note and which line. It returns references and snippets, never bodies.
2. ohhi_read with outline: true gives headings, line numbers and section sizes — no body.
3. ohhi_read with section or lines reads only the part you need.
4. A whole-note ohhi_read is the exception: only for a note you know is short.

- Never read a note that could be long without its outline first. Reads are budgeted; truncation says so (truncated, nextLine), but a truncated read is a wasted one.
- Quote references, not bodies: cite notes as path (lines a–b) instead of pasting them back.
- The references below are already in front of you; do not read them again unless you need more than they show.
- Let paging page: take a small limit and follow nextCursor rather than asking for everything.

## Changing notes

- Prefer ohhi_patch (one exact, unique string) or ohhi_append (to the end of a section) over ohhi_write, which replaces the whole note.
- Pass the hash you read as expectHash, so a note that changed under you is refused rather than overwritten.
- In the app your edits arrive as suggestions the person accepts or rejects. Say in one line what you proposed and where.
- A question gets an answer. A requested change gets the change (proposed) plus a one-line reply. Do not change what was not asked for.`

/** The send-to-agent rule (B8): the reply lands in the thread, so it is short, and a change is a proposal. */
const THREAD = `## A comment asked

The person's message is a comment on the passage under References, and your final text is posted as the reply in that comment thread.

- A question: answer it in the reply, briefly. Change nothing.
- A requested change: propose the edit (ohhi_patch on that passage), then reply in one line saying what you proposed.`

/** A fence longer than any backtick run inside `text`, so a quoted note can never close it early. */
function fenceFor(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  return '`'.repeat(longest + 1)
}

/** `path (from–to)`, `path › Section`, `path/ (folder)` or `path`. */
function refHeading(m: Mention): string {
  const r = m.ref
  switch (r.kind) {
    case 'lines':
      return `${r.path} (${r.lines.from}–${r.lines.to})`
    case 'section':
      return `${r.path} › ${r.section}`
    case 'folder':
      return `${r.path.replace(/\/+$/, '')}/ (folder)`
    case 'file':
      return r.path
  }
}

/**
 * Fenced blocks headed `path (from–to)` + hash (B5). A mention without a
 * snapshot (a whole file, a folder) is listed by heading only: the model
 * reads it through the tools, narrowly, like anything else in the vault.
 */
export function renderRefs(refs: Mention[]): string {
  return refs
    .map((m) => {
      const head = `### ${refHeading(m)}${m.hash ? ` · hash ${m.hash}` : ''}`
      if (m.snapshot === undefined) {
        const how = m.ref.kind === 'folder' ? 'list it with ohhi_ls' : 'read it with ohhi_read (outline first)'
        return `${head}\n(not attached — ${how})`
      }
      const fence = fenceFor(m.snapshot)
      const body = m.snapshot.endsWith('\n') ? m.snapshot : `${m.snapshot}\n`
      return `${head}\n${fence}markdown\n${body}${fence}`
    })
    .join('\n\n')
}

/** The harness's system prompt: vault discipline, the skills catalog, the active skill, the references. */
export function systemPrompt(input: {
  skills: SkillMeta[]
  skill?: { meta: SkillMeta; body: string }
  refs: Mention[]
  /** The turn answers a comment thread (send to agent, B8): its final text is posted as the reply. */
  thread?: boolean
}): string {
  const parts = [DISCIPLINE]
  const catalog = skillsCatalog(input.skills)
  if (catalog) {
    parts.push(
      `## Skills\n\nSkills are folders of instructions in the vault. When a task matches one, load it with ohhi_skill (by name) before you start, and follow it.\n\n${catalog}`,
    )
  }
  if (input.skill) {
    parts.push(`## Active skill: ${input.skill.meta.name}\n\nThe person ran this skill. Follow it.\n\n${input.skill.body.trim()}`)
  }
  if (input.thread) parts.push(THREAD)
  if (input.refs.length > 0) {
    parts.push(`## References\n\nWhat the person attached to this message, as it was when they attached it.\n\n${renderRefs(input.refs)}`)
  }
  return parts.join('\n\n') + '\n'
}
