/**
 * Running a skill and where its answer lands. `ai.run-skill` picks a skill
 * that fits the selection or the note and starts the turn; then
 * `metadata.ohhi-kind` decides where the answer lands, and this module is the
 * one place that knows how.
 *
 *  - `check` → each finding a comment thread on the passage it quotes,
 *    authored by the skill. The model ends with an `ohhi-findings` block (a
 *    JSON list of `{quote, comment}`), parsed leniently.
 *  - `transform` → a suggestion: the model patches the passage with
 *    `ohhi_patch`, which the harness turns into a proposal. Nothing to
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
import { mount, unmount } from 'svelte'
import { getLL } from '@ohhi/i18n'
import type { Mention, RunRecord, SkillInput, SkillMeta } from '@ohhi/harness'
import { aiEnabled } from './ai-config.svelte.js'
import type { Command } from './commands.js'
import type { FlashInput } from './notices.js'
import { mentionOf, rangeOfLines } from './references.js'
import { captureFocusedSelection, harnessWorkspace, runReply, startRun, type RunHandle, type StartRunInput } from './sessions.svelte.js'
import { currentSkills, type SkillsStore } from './skills.svelte.js'
import SkillPicker from './components/SkillPicker.svelte'
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
  return { title: title || getLL().web.ai.skills.run.untitled(), body: `${body}\n` }
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
  const w = getLL().web.ai.skills.run
  const run = await handle.done
  if (run.status !== 'successful') {
    if (run.status === 'failed') deps.flash?.({ level: 'warn', text: w.failed({ name: meta.name, error: run.error ?? '' }) })
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
        ? w.no_findings({ name: meta.name })
        : skipped
          ? w.findings_skipped({ name: meta.name, count: added, skipped })
          : w.findings({ name: meta.name, count: added })
    deps.flash?.({ level: 'info', text: say })
    return { kind: 'comments', added, skipped }
  }

  if (meta.kind === 'generate' && meta.output !== 'insert' && ws) {
    const note = newNoteOf(answer)
    if (!note) {
      deps.flash?.({ level: 'info', text: w.answered_no_note({ name: meta.name }) })
      return { kind: 'chat' }
    }
    const dir = dirOf(target.path)
    const path = await ws.createFile(dir, freeName(ws, dir, note.title), note.body)
    if (!path) return { kind: 'chat' }
    deps.flash?.({ level: 'info', text: w.created({ name: meta.name, path }) })
    return { kind: 'note', path }
  }

  // transform / generate-insert: the proposals landed through the tools during the run.
  // research, or no kind: the answer is the chat.
  return { kind: 'chat' }
}

/** In the app: the open vault's workspace and the registry's run replies. */
export function routeInApp(flash?: (input: FlashInput) => void): RouteDeps {
  return { workspace: harnessWorkspace(), reply: runReply, ...(flash ? { flash } : {}) }
}

// ---- ai.run-skill ------------------------------------------------------------------

/** What `ai.run-skill` runs on: the focused note, and its selection as a `lines` mention when there is one. */
export interface SkillTarget {
  path: string
  selection: Mention | null
}

/** Which skills fit a target: by `ohhi-input` (a skill that does not say fits anything). */
export function fitsTarget(input: SkillInput | undefined, hasSelection: boolean): boolean {
  if (input === undefined) return true
  return hasSelection ? input === 'selection' || input === 'section' : input !== 'selection'
}

/** A palette over the skills; resolves with the pick, or null when dismissed. */
export function pickSkill(skills: SkillMeta[], placeholder: string): Promise<SkillMeta | null> {
  return new Promise((resolve) => {
    let instance: ReturnType<typeof mount> | null = null
    const done = (meta: SkillMeta | null): void => {
      if (instance) void unmount(instance)
      instance = null
      resolve(meta)
    }
    instance = mount(SkillPicker, { target: document.body, props: { skills, placeholder, onPick: (m: SkillMeta) => done(m), onClose: () => done(null) } })
  })
}

export interface RunSkillDeps {
  flash?(input: FlashInput): void
  selectedPath?(): string | null
  /** Injected for tests; `startRun` (`sessions.svelte.ts`, the one run door) otherwise. */
  startRun?(input: StartRunInput): Promise<RunHandle | null>
  /** Injected for tests; `currentSkills` otherwise. */
  skills?(): SkillsStore | null
  /** Injected for tests; the focused note and `captureFocusedSelection` otherwise. */
  target?(): Promise<SkillTarget | null>
  pick?(skills: SkillMeta[], placeholder: string): Promise<SkillMeta | null>
  /** Injected for tests; `routeSkillRun` over the open vault otherwise (lands the answer by `meta.kind`). */
  route?(input: { meta: SkillMeta; handle: RunHandle; target: SkillTarget }): Promise<unknown>
}

/**
 * `ai.run-skill`: on the selection or the focused note, a picker of the
 * usable skills whose `ohhi-input` fits, then a turn through `startRun`
 * with that skill and the target as its reference — in a new
 * session, opened beside the note.
 */
export function runSkillCommand(deps: RunSkillDeps): Command {
  const t = getLL().web.ai
  const skillsOf = deps.skills ?? currentSkills
  const targetOf =
    deps.target ??
    (async (): Promise<SkillTarget | null> => {
      const path = deps.selectedPath?.() ?? null
      return path ? { path, selection: await captureFocusedSelection(path) } : null
    })
  const pick = deps.pick ?? pickSkill
  const start = deps.startRun ?? startRun
  const say = (text: string): void => deps.flash?.({ level: 'info', text })
  return {
    id: 'ai.run-skill',
    title: t.commands.run_skill(),
    group: getLL().web.commands.groups.ai(),
    when: () => aiEnabled(),
    run: async () => {
      const store = skillsOf()
      if (!store) return say(t.skills.run.no_vault())
      const target = await targetOf()
      if (!target) return say(t.skills.run.no_note())
      const hasSelection = target.selection !== null
      const what = hasSelection ? t.skills.run.target_selection() : t.skills.run.target_note()
      const offered = (await store.source().list()).filter((m) => fitsTarget(m.input, hasSelection))
      if (offered.length === 0) return say(t.skills.run.none({ target: what }))
      const meta = await pick(offered, t.skills.run.placeholder({ target: what }))
      if (!meta) return
      const body = (await store.source().body(meta.name)) ?? ''
      const refs: Mention[] = [target.selection ?? mentionOf({ kind: 'file', path: target.path })]
      // The kind decides where the answer lands (`skill-routing.ts`): its rules ride on the body.
      const handle = await start({ instruction: meta.description, refs, skill: { meta, body: withLanding(meta, body) } })
      if (!handle) return say(t.skills.run.not_started({ name: meta.name }))
      say(t.skills.run.started({ name: meta.name }))
      void store.markUsed(meta.dir.slice(meta.dir.lastIndexOf('/') + 1))
      void (deps.route ?? ((input) => routeSkillRun(routeInApp(deps.flash), input)))({ meta, handle, target })
    },
  }
}
