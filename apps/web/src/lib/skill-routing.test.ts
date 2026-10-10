/**
 * A skill run's landing by `ohhi-kind` (B9): check → threads on the quoted
 * text, generate → a new note, transform/research → nothing after the run.
 */
import { getLL } from '@ohhi/i18n'
import type { RunRecord, SkillMeta } from '@ohhi/harness'
import { createYjsEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import { describe, expect, it, vi } from 'vitest'
import { captureSelection } from './references.js'
import type { RunHandle } from './sessions.svelte.js'
import {
  FINDINGS_FENCE,
  landingRules,
  locateQuote,
  newNoteOf,
  parseFindings,
  rangeOfLines,
  routeSkillRun,
  withLanding,
  type RouteDeps,
} from './skill-routing.js'
import { createThreadRegistry } from './threads.svelte.js'

const w = getLL().web.ai.wiring
const TEXT = 'Intro line.\nThe the cat sat.\nIt was very very nice.\nThe the end.\n'
const PATH = 'notes/story.md'

function handleOf(status: RunRecord['status'] = 'successful', error?: string): RunHandle {
  const run: RunRecord = { runId: 'r1', status, provider: 'p', model: 'm', input: { refs: [], instruction: 'x' }, ...(error ? { error } : {}) }
  return { sessionId: 's1', runId: 'r1', done: Promise.resolve(run) }
}

function setup(answer: string) {
  const doc = createYjsEngine().createDoc('g1')
  doc.transact((t) => t.insert(0, TEXT), 'local')
  const files = new Map<string, string>()
  const registry = createThreadRegistry({
    clock: new SimClock(),
    docForPath: (p) => (p === PATH ? doc : null),
    guidFor: (p) => (p === PATH ? 'g1' : null),
    pathFor: () => PATH,
    files: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) },
  })
  const created: { dir: string; name: string; text: string }[] = []
  const deps: RouteDeps = {
    workspace: {
      ui: { files: [{ path: PATH, guid: 'g1', kind: 'text' }, { path: 'notes/A summary.md', guid: 'g2', kind: 'text' }] } as never,
      threadsFor: (p) => registry.storeFor(p),
      addThread: (p, { author, sendTo: _s, ...rest }) => registry.storeFor(p)?.add({ ...rest, author: author ?? 'me' }) ?? null,
      createFile: vi.fn(async (dir = '', name = '', text = '') => {
        created.push({ dir, name, text })
        return dir ? `${dir}/${name}` : name
      }),
    },
    reply: () => answer,
    flash: vi.fn(),
  }
  return { deps, store: () => registry.storeFor(PATH)!, created }
}

const meta = (kind: SkillMeta['kind'], output?: SkillMeta['output']) => ({ name: 'proofread', kind, ...(output ? { output } : {}) })

describe('landing rules', () => {
  it('say where each kind lands, and nothing for a skill that names no kind', () => {
    expect(landingRules(meta('check'))).toContain('```' + FINDINGS_FENCE)
    expect(landingRules(meta('transform'))).toContain('ohhi_patch')
    expect(landingRules(meta('generate'))).toMatch(/new note/)
    expect(landingRules(meta('generate', 'insert'))).toMatch(/inserted/)
    expect(landingRules(meta('research'))).toMatch(/chat/)
    expect(landingRules({})).toBe('')
    expect(withLanding({}, 'Body.')).toBe('Body.')
    expect(withLanding(meta('research'), 'Body.\n')).toMatch(/^Body\.\n\n## Where your answer lands/)
  })
})

describe('parseFindings', () => {
  it('reads the ohhi-findings block first', () => {
    const text = 'Two issues.\n\n```json\n[{"quote":"wrong","comment":"no"}]\n```\n\n```ohhi-findings\n[{"quote": "The the", "comment": "Doubled word."}]\n```\n'
    expect(parseFindings(text)).toEqual([{ quote: 'The the', comment: 'Doubled word.' }])
  })

  it('is lenient: a json block, a bare list, an object with findings, aliased keys; junk entries dropped', () => {
    expect(parseFindings('```json\n{"findings":[{"text":"a","finding":"b"}]}\n```')).toEqual([{ quote: 'a', comment: 'b' }])
    expect(parseFindings('Here: [{"quote":"x","comment":"y"}, {"quote":"no comment"}, 7]')).toEqual([{ quote: 'x', comment: 'y' }])
    expect(parseFindings('Nothing [to] report.')).toEqual([])
    expect(parseFindings('All good.')).toEqual([])
    expect(parseFindings('```ohhi-findings\n[]\n```')).toEqual([])
  })
})

describe('locating text', () => {
  it('maps 1-based lines to characters, and finds a quote inside the passage before anywhere else', () => {
    const lines = rangeOfLines(TEXT, { from: 2, to: 3 })
    expect(TEXT.slice(lines.from, lines.to)).toBe('The the cat sat.\nIt was very very nice.')
    const first = locateQuote(TEXT, 'The the')!
    expect(first.from).toBe(TEXT.indexOf('The the'))
    const later = locateQuote(TEXT, 'The the', rangeOfLines(TEXT, { from: 4, to: 4 }))!
    expect(later.from).toBe(TEXT.lastIndexOf('The the'))
    expect(locateQuote(TEXT, 'VERY VERY')).toEqual({ from: TEXT.indexOf('very very'), to: TEXT.indexOf('very very') + 9 })
    expect(locateQuote(TEXT, 'absent')).toBeNull()
  })

  it('takes a generated note from its markdown block, titled by its heading', () => {
    expect(newNoteOf('Here you go:\n\n```markdown\n# A summary\n\nShort.\n```\n')).toEqual({ title: 'A summary', body: '# A summary\n\nShort.\n' })
    expect(newNoteOf('# Plain: answer?\n\nNo fence.')).toEqual({ title: 'Plain answer', body: '# Plain: answer?\n\nNo fence.\n' })
    expect(newNoteOf('   ')).toBeNull()
  })
})

describe('routeSkillRun', () => {
  it('check: each finding becomes a thread on its quote, authored by the skill; a missing quote is counted, not invented', async () => {
    const answer = '```ohhi-findings\n[{"quote":"The the","comment":"Doubled word."},{"quote":"very very","comment":"Doubled again."},{"quote":"not there","comment":"x"}]\n```'
    const { deps, store } = setup(answer)
    const selection = captureSelection({ path: PATH, text: TEXT, from: TEXT.indexOf('The the end'), to: TEXT.length - 1 })
    const out = await routeSkillRun(deps, { meta: meta('check'), handle: handleOf(), target: { path: PATH, selection } })
    expect(out).toEqual({ kind: 'comments', added: 2, skipped: 1 })
    const threads = store().threads()
    expect(threads.map((t) => [t.author, t.anchor.quote.exact, t.comments[0].body])).toEqual(
      expect.arrayContaining([
        ['proofread', 'The the', 'Doubled word.'],
        ['proofread', 'very very', 'Doubled again.'],
      ])
    )
    // Inside the selection (the last line), not the first match in the note.
    const doubled = threads.find((t) => t.anchor.quote.exact === 'The the')!
    expect(store().rangeOf(doubled)!.from).toBe(TEXT.lastIndexOf('The the'))
    expect(deps.flash).toHaveBeenCalledWith({ level: 'info', text: w.skill_findings_skipped({ name: 'proofread', count: 2, skipped: 1 }) })
  })

  it('check with nothing found says so', async () => {
    const { deps, store } = setup('Looks clean.\n\n```ohhi-findings\n[]\n```')
    expect(await routeSkillRun(deps, { meta: meta('check'), handle: handleOf(), target: { path: PATH, selection: null } })).toEqual({ kind: 'comments', added: 0, skipped: 0 })
    expect(store().threads()).toEqual([])
    expect(deps.flash).toHaveBeenCalledWith({ level: 'info', text: w.skill_no_findings({ name: 'proofread' }) })
  })

  it('generate: a new note beside the target, never over an existing one', async () => {
    const { deps, created } = setup('```markdown\n# A summary\n\nShort.\n```')
    const out = await routeSkillRun(deps, { meta: meta('generate'), handle: handleOf(), target: { path: PATH, selection: null } })
    expect(created).toEqual([{ dir: 'notes', name: 'A summary 2.md', text: '# A summary\n\nShort.\n' }])
    expect(out).toEqual({ kind: 'note', path: 'notes/A summary 2.md' })
  })

  it('transform, generate-insert and research land nothing after the run', async () => {
    for (const m of [meta('transform'), meta('generate', 'insert'), meta('research'), meta(undefined)]) {
      const { deps, created, store } = setup('```ohhi-findings\n[{"quote":"The the","comment":"x"}]\n```')
      expect(await routeSkillRun(deps, { meta: m, handle: handleOf(), target: { path: PATH, selection: null } })).toEqual({ kind: 'chat' })
      expect(created).toEqual([])
      expect(store().threads()).toEqual([])
    }
  })

  it('a failed run lands nothing and says why; a cancelled one is quiet', async () => {
    const { deps, store } = setup('[{"quote":"The the","comment":"x"}]')
    expect(await routeSkillRun(deps, { meta: meta('check'), handle: handleOf('failed', 'bad key'), target: { path: PATH, selection: null } })).toEqual({ kind: 'none', status: 'failed' })
    expect(deps.flash).toHaveBeenCalledWith({ level: 'warn', text: w.skill_failed({ name: 'proofread', error: 'bad key' }) })
    await routeSkillRun(deps, { meta: meta('check'), handle: handleOf('cancelled'), target: { path: PATH, selection: null } })
    expect(deps.flash).toHaveBeenCalledTimes(1)
    expect(store().threads()).toEqual([])
  })
})
