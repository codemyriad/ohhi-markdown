/**
 * Where a skill run lands (writing-harness-shaping B9 *Invocation*):
 * `metadata.ohhi-kind` decides, and this module is the one place that knows
 * how.
 *
 *  - `check` → each finding a comment thread on the passage it quotes,
 *    authored by the skill. The model ends with an `ohhi-findings` block (a
 *    JSON list of `{quote, comment}`), parsed leniently.
 *  - `transform` → a suggestion: the model patches the passage with
 *    `ohhi_patch`, which the harness turns into a proposal (B7). Nothing to
 *    do after the run.
 *  - `generate` → a new note (`createFile`) from the model's one fenced
 *    markdown block — or, with `ohhi-output: insert`, an insert proposal
 *    through the tools, like a transform.
 *  - `research` (and a skill that names no kind) → the chat; nothing lands.
 *
 * Two halves: `landingRules` is appended to the skill's body (so the rules
 * reach the system prompt, not the person's turn in the transcript), and
 * `routeSkillRun` lands the finished run's answer.
 */
import { getLL } from '@ohhi/i18n'
import type { Mention, RunRecord, SkillMeta } from '@ohhi/harness'
import type { FlashInput } from './notices.js'
import { harnessWorkspace, runReply, type RunHandle } from './sessions.svelte.js'
import type { Workspace } from './workspace.svelte.js'

/** The info string of the fenced block a `check` skill's findings come in. */
export const FINDINGS_FENCE = 'ohhi-findings'

/** How the run's output lands: the rules the model is given, by kind. */
export function landingRules(meta: Pick<SkillMeta, 'kind' | 'output'>): string {
  switch (meta.kind) {
    case 'check':
      return [
        '## Where your answer lands',
        '',
        'Each finding becomes a comment on the note, anchored to the text it quotes. Do not edit the note.',
        `End your answer with one fenced block tagged ${FINDINGS_FENCE} holding a JSON list, one object per finding:`,
        '',
        '```' + FINDINGS_FENCE,
        '[{"quote": "exact words from the passage, short and unique", "comment": "the finding, in one or two sentences"}]',
        '```',
        '',
        'Copy each quote exactly from the passage under References. Use [] when you find nothing.',
      ].join('\n')
    case 'transform':
      return [
        '## Where your answer lands',
        '',
        'Your change becomes a suggestion the person accepts or rejects in the note.',
        'Make it with ohhi_patch on the passage under References (old = the exact text you replace; one patch per contiguous change), then say in one line what you changed.',
      ].join('\n')
    case 'generate':
      return meta.output === 'insert'
        ? [
            '## Where your answer lands',
            '',
            'Your text is inserted into the note under References as a suggestion the person reviews: add it with ohhi_patch or ohhi_append, then say in one line where.',
          ].join('\n')
        : [
            '## Where your answer lands',
            '',
            'Your result becomes a new note. Do not write it with tools.',
            "Put the whole note in one fenced block tagged markdown, its first line a '# Title' heading.",
          ].join('\n')
    case 'research':
      return ['## Where your answer lands', '', 'Answer in the chat. Do not edit any note.'].join('\n')
    default:
      return ''
  }
}

/** The skill's body with its landing rules after it — what the run's `skill.body` is. */
export function withLanding(meta: Pick<SkillMeta, 'kind' | 'output'>, body: string): string {
  const rules = landingRules(meta)
  return rules ? `${body.trimEnd()}\n\n${rules}\n` : body
}

// ---- reading the answer ---------------------------------------------------------

export interface Finding {
  quote: string
  comment: string
}

/** Every fenced block in `text`: its info string and body. */
function fences(text: string): { info: string; body: string }[] {
  const out: { info: string; body: string }[] = []
  const re = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm
  for (const m of text.matchAll(re)) out.push({ info: (m[2] ?? '').trim().toLowerCase(), body: m[3] ?? '' })
  return out
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** One finding from whatever the model wrote; null when it has no quote or no comment. */
function findingOf(raw: unknown): Finding | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const quote = str(r.quote) ?? str(r.text) ?? str(r.excerpt)
  const comment = str(r.comment) ?? str(r.finding) ?? str(r.note) ?? str(r.message)
  return quote && comment ? { quote, comment } : null
}

function listOf(json: string): Finding[] | null {
  try {
    const value: unknown = JSON.parse(json)
    const list = Array.isArray(value) ? value : value && typeof value === 'object' ? (value as { findings?: unknown }).findings : null
    if (!Array.isArray(list)) return null
    return list.map(findingOf).filter((f): f is Finding => f !== null)
  } catch {
    return null
  }
}

/**
 * A `check` run's findings, read leniently: the `ohhi-findings` block, else
 * any `json` block, else the last bracketed list in the text. Entries
 * without a quote or a comment are dropped; nothing parseable is `[]`.
 */
export function parseFindings(text: string): Finding[] {
  const blocks = fences(text)
  const ordered = [
    ...blocks.filter((b) => b.info === FINDINGS_FENCE),
    ...blocks.filter((b) => b.info === 'json' || b.info === ''),
  ]
  for (const b of ordered) {
    const found = listOf(b.body)
    if (found) return found
  }
  const close = text.lastIndexOf(']')
  if (close === -1) return []
  for (let start = text.lastIndexOf('[', close); start !== -1; start = start === 0 ? -1 : text.lastIndexOf('[', start - 1)) {
    const found = listOf(text.slice(start, close + 1))
    if (found) return found
  }
  return []
}

/** The character range of 1-based lines `[from, to]` in `text`. */
export function rangeOfLines(text: string, lines: { from: number; to: number }): { from: number; to: number } {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  const from = starts[Math.max(0, lines.from - 1)] ?? text.length
  const next = starts[lines.to]
  return { from, to: next === undefined ? text.length : Math.max(from, next - 1) }
}

/**
 * Where a quote sits in the note: inside `within` first (the passage the
 * skill ran on), else anywhere; exact, then ignoring case. Null when absent.
 */
export function locateQuote(text: string, quote: string, within?: { from: number; to: number }): { from: number; to: number } | null {
  const at = (hay: string, needle: string, offset: number): { from: number; to: number } | null => {
    const i = hay.indexOf(needle)
    return i === -1 ? null : { from: offset + i, to: offset + i + needle.length }
  }
  const scoped = within ? text.slice(within.from, within.to) : null
  return (
    (scoped !== null ? at(scoped, quote, within!.from) : null) ??
    at(text, quote, 0) ??
    (scoped !== null ? at(scoped.toLowerCase(), quote.toLowerCase(), within!.from) : null) ??
    at(text.toLowerCase(), quote.toLowerCase(), 0)
  )
}

/** A `generate` run's note: its one markdown block (else the whole answer), titled by its first heading. */
export function newNoteOf(text: string): { title: string; body: string } | null {
  const blocks = fences(text)
  const block = blocks.find((b) => b.info === 'markdown' || b.info === 'md') ?? blocks.find((b) => b.info === '')
  const body = (block ? block.body : text).trim()
  if (!body) return null
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body)
  const title = (heading?.[1] ?? body.split('\n')[0] ?? '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim().slice(0, 80)
  return { title: title || getLL().web.ai.wiring.untitled(), body: `${body}\n` }
}

// ---- landing it -----------------------------------------------------------------

export type SkillLanding =
  | { kind: 'comments'; added: number; skipped: number }
  | { kind: 'note'; path: string }
  | { kind: 'chat' }
  | { kind: 'none'; status: RunRecord['status'] }

export interface RouteDeps {
  workspace: Pick<Workspace, 'threadsFor' | 'addThread' | 'createFile' | 'ui'> | null
  /** A finished run's answer. */
  reply(handle: RunHandle): string | null
  flash?(input: FlashInput): void
}

/** What a skill ran on: the note, and the selection's mention when there was one. */
export interface RouteTarget {
  path: string
  selection: Mention | null
}

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** `Title.md` in `dir`, or `Title 2.md`, … — `createFile` opens an existing note rather than write it. */
function freeName(ws: Pick<Workspace, 'ui'>, dir: string, title: string): string {
  const taken = new Set(ws.ui.files.map((f) => f.path))
  const at = (name: string): string => (dir ? `${dir}/${name}` : name)
  let name = `${title}.md`
  for (let n = 2; taken.has(at(name)); n++) name = `${title} ${n}.md`
  return name
}

/** Land a finished skill run by its kind (the header of this file). */
export async function routeSkillRun(
  deps: RouteDeps,
  input: { meta: Pick<SkillMeta, 'name' | 'kind' | 'output'>; handle: RunHandle; target: RouteTarget }
): Promise<SkillLanding> {
  const { meta, handle, target } = input
  const w = getLL().web.ai.wiring
  const run = await handle.done
  if (run.status !== 'successful') {
    if (run.status === 'failed') deps.flash?.({ level: 'warn', text: w.skill_failed({ name: meta.name, error: run.error ?? '' }) })
    return { kind: 'none', status: run.status }
  }
  const ws = deps.workspace
  const answer = deps.reply(handle) ?? ''

  if (meta.kind === 'check' && ws) {
    const store = ws.threadsFor(target.path)
    const text = store?.text() ?? ''
    const sel = target.selection?.ref.kind === 'lines' ? rangeOfLines(text, target.selection.ref.lines) : undefined
    let added = 0
    let skipped = 0
    const findings = parseFindings(answer)
    for (const f of findings) {
      const range = store ? locateQuote(text, f.quote, sel) : null
      if (range && ws.addThread(target.path, { ...range, body: f.comment, author: meta.name })) added++
      else skipped++
    }
    const say =
      findings.length === 0
        ? w.skill_no_findings({ name: meta.name })
        : skipped
          ? w.skill_findings_skipped({ name: meta.name, count: added, skipped })
          : w.skill_findings({ name: meta.name, count: added })
    deps.flash?.({ level: 'info', text: say })
    return { kind: 'comments', added, skipped }
  }

  if (meta.kind === 'generate' && meta.output !== 'insert' && ws) {
    const note = newNoteOf(answer)
    if (!note) {
      deps.flash?.({ level: 'info', text: w.skill_no_note({ name: meta.name }) })
      return { kind: 'chat' }
    }
    const dir = dirOf(target.path)
    const path = await ws.createFile(dir, freeName(ws, dir, note.title), note.body)
    if (!path) return { kind: 'chat' }
    deps.flash?.({ level: 'info', text: w.skill_created({ name: meta.name, path }) })
    return { kind: 'note', path }
  }

  // transform / generate-insert: the proposals landed through the tools during the run.
  // research, or no kind: the answer is the chat.
  return { kind: 'chat' }
}

/** The app's wiring: the open vault's workspace and B's run replies. */
export function routeInApp(flash?: (input: FlashInput) => void): RouteDeps {
  return { workspace: harnessWorkspace(), reply: runReply, ...(flash ? { flash } : {}) }
}
