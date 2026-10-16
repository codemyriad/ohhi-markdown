/**
 * Send to agent (B8): the thread's passage is the reference, the comment
 * the instruction, the run carries the thread; its answer is the reply and
 * the comment is answered.
 */
import { getLL } from '@ohhi/i18n'
import type { RunRecord } from '@ohhi/harness'
import { describe, expect, it, vi } from 'vitest'
import { mentionOf } from './references.js'
import type { RunHandle, StartRunInput } from './sessions.svelte.js'
import { askAgent, commentSessionTitle, type AskAgentDeps } from './thread-agent.js'

import { threadsFixture } from './harness.fixture.js'

const TEXT = 'The plan is to ship in March.'
const PATH = 'plan.md'

function setup(run: Partial<RunRecord> = {}, opts: { busy?: string } = {}) {
  const { registry, doc: held } = threadsFixture({ text: TEXT, path: PATH })
  const doc = held.current!
  const store = registry.storeFor(PATH)!
  const started: StartRunInput[] = []
  const deps: AskAgentDeps = {
    workspace: {
      threadsFor: (p) => registry.storeFor(p),
      reply: (p, id, c) => registry.storeFor(p)?.reply(id, { ...c, author: c.author ?? 'Ana' }) ?? null,
    },
    startRun: vi.fn(async (input: StartRunInput): Promise<RunHandle | null> => {
      started.push(input)
      if (opts.busy && input.sessionId === opts.busy) return null
      const record: RunRecord = {
        runId: 'r1', status: 'successful', provider: 'p', model: 'm',
        input: { refs: input.refs ?? [], instruction: input.instruction }, ...(input.threadId ? { threadId: input.threadId } : {}), ...run,
      }
      return { sessionId: input.sessionId ?? 'new', runId: 'r1', done: Promise.resolve(record) }
    }),
    reply: () => 'In March means the 3rd.',
    mention: async (p, s, range) => ({ ...mentionOf({ kind: 'lines', path: p, lines: { from: 1, to: 1 } }), snapshot: s.text().slice(range.from, range.to) }),
    session: () => 's-current',
    flash: vi.fn(),
  }
  return { store, deps, started }
}

describe('askAgent', () => {
  it('runs the comment over the thread’s passage, posts the answer as the reply and marks the comment answered', async () => {
    const { store, deps, started } = setup()
    const t = store.add({ from: 23, to: 28, author: 'Ana', body: 'Which day?', sendTo: ['agent'] })
    const run = await askAgent(deps, PATH, t.id)
    expect(run?.status).toBe('successful')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ instruction: 'Which day?', threadId: t.id, sessionId: 's-current' })
    // …and the run opens its session view (no `open: false`): Send to agent shows the session.
    expect(started[0].open).toBeUndefined()
    // The session the person has open keeps its name: no title handed in, not even one cut from the comment.
    expect(started[0].title).toBeNull()
    expect(started[0].refs?.[0]).toMatchObject({ ref: { kind: 'lines', path: PATH }, snapshot: 'March' })
    const thread = store.get(t.id)!
    expect(thread.comments).toHaveLength(2)
    expect(thread.comments[0].answered).toBe(true)
    expect(thread.comments[1]).toMatchObject({ author: getLL().web.ai.session.agent(), body: 'In March means the 3rd.', answering: thread.comments[0].id })
  })

  it('a busy current session hands the run to a new one', async () => {
    const { store, deps, started } = setup({}, { busy: 's-current' })
    const t = store.add({ from: 0, to: 3, author: 'Ana', body: 'Why?', sendTo: ['agent'] })
    await askAgent(deps, PATH, t.id)
    expect(started.map((s) => s.sessionId)).toEqual(['s-current', undefined])
    // The new one is named after the comment's place, not its words.
    expect(started[1].title).toBe(getLL().web.ai.comments.session_title_line({ note: PATH, line: 1 }))
  })

  it('asked for a new session, it never uses the current one', async () => {
    const { store, deps, started } = setup()
    const t = store.add({ from: 0, to: 3, author: 'Ana', body: 'jiaosdjas', sendTo: ['agent'] })
    await askAgent(deps, PATH, t.id, 'new')
    expect(started.map((s) => s.sessionId)).toEqual([undefined])
    expect(started[0].title).not.toContain('jiaosdjas')
  })

  it('sent to a session the person picked, it runs there, not in the current one', async () => {
    const { store, deps, started } = setup()
    const t = store.add({ from: 0, to: 3, author: 'Ana', body: 'Why?', sendTo: ['agent'] })
    await askAgent(deps, PATH, t.id, { sessionId: 's-picked' })
    expect(started.map((s) => s.sessionId)).toEqual(['s-picked'])
    expect(started[0].title).toBeNull()
  })

  it('a new session’s title says where the comment is: the note, and its line or lines', () => {
    const w = getLL().web.ai.comments
    const lines = (from: number, to: number) => mentionOf({ kind: 'lines', path: 'notes/plan.md', lines: { from, to } })
    expect(commentSessionTitle('notes/plan.md', lines(3, 4))).toBe(w.session_title_lines({ note: 'plan.md', from: 3, to: 4 }))
    expect(commentSessionTitle('notes/plan.md', lines(3, 3))).toBe(w.session_title_line({ note: 'plan.md', line: 3 }))
    expect(commentSessionTitle('notes/plan.md', mentionOf({ kind: 'file', path: 'notes/plan.md' }))).toBe(w.session_title({ note: 'plan.md' }))
  })

  it('a failed run posts nothing, leaves the comment unanswered and says why', async () => {
    const { store, deps } = setup({ status: 'failed', error: 'bad key' })
    const t = store.add({ from: 0, to: 3, author: 'Ana', body: 'Why?', sendTo: ['agent'] })
    await askAgent(deps, PATH, t.id)
    expect(store.get(t.id)!.comments).toHaveLength(1)
    expect(store.get(t.id)!.comments[0].answered).toBeFalsy()
    expect(deps.flash).toHaveBeenCalledWith({ level: 'warn', text: getLL().web.ai.comments.thread_failed({ error: 'bad key' }) })
  })

  it('a thread with nothing addressed to the agent starts nothing', async () => {
    const { store, deps } = setup()
    const t = store.add({ from: 0, to: 3, author: 'Ana', body: 'Note to self' })
    expect(await askAgent(deps, PATH, t.id)).toBeNull()
    expect(deps.startRun).not.toHaveBeenCalled()
  })
})
