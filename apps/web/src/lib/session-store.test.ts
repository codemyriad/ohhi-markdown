import { describe, expect, it } from 'vitest'
import type { RunRecord } from '@ohhi/harness'
import { createSessionStore, latestRuns, parseSession, sessionPath } from './session-store.js'
import { memAppFiles } from './harness.fixture.js'

function setup(seed?: Record<string, string>) {
  let now = 1_000
  let n = 0
  const files = memAppFiles(seed)
  const clock = { now: () => now, schedule: () => () => {} }
  const store = createSessionStore(files, { clock, vault: 'v1', newId: () => `e${++n}` })
  return { files, store, tick: (ms: number) => (now += ms) }
}

const run = (runId: string, status: RunRecord['status']): RunRecord => ({
  runId,
  status,
  input: { refs: [], instruction: 'hi' },
  provider: 'p1',
  model: 'm1',
})

describe('session store', () => {
  it('round-trips a header and chained entries through one jsonl file', async () => {
    const { store, files, tick } = setup()
    const header = await store.create({ id: 's1', title: 'Plans' })
    expect(header).toEqual({ type: 'session', version: 1, id: 's1', created: 1_000, vault: 'v1', title: 'Plans' })

    tick(5)
    const [a, b] = await store.append('s1', [
      { type: 'message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } },
      { type: 'run', run: run('r1', 'running') },
    ])
    expect(a.parentId).toBeNull()
    expect(b.parentId).toBe(a.id)

    // Every line is JSON: header first, then the entries in order.
    const text = files.files.get(sessionPath('s1'))!
    const lines = text.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.type)).toEqual(['session', 'message', 'run'])

    // A fresh store (no cache) reads the same thing back.
    const again = createSessionStore(files, { clock: { now: () => 0, schedule: () => () => {} }, vault: 'v1' })
    const loaded = await again.load('s1')
    expect(loaded?.header.title).toBe('Plans')
    expect(loaded?.entries.map((e) => e.id)).toEqual([a.id, b.id])
    expect(loaded?.leaf).toBe(b.id)
    expect(loaded?.problems).toEqual([])
  })

  it('serialises concurrent appends: every entry lands, chained in call order', async () => {
    const { store } = setup()
    await store.create({ id: 's1' })
    await Promise.all([
      store.append('s1', [{ type: 'label', label: 'one' }]),
      store.append('s1', [{ type: 'label', label: 'two' }]),
      store.append('s1', [{ type: 'label', label: 'three' }]),
    ])
    const loaded = await store.load('s1')
    expect(loaded!.entries.map((e) => (e.type === 'label' ? e.label : null))).toEqual(['one', 'two', 'three'])
    expect(loaded!.entries[2].parentId).toBe(loaded!.entries[1].id)
  })

  it('skips and reports a corrupt line instead of failing the session', () => {
    const text = [
      JSON.stringify({ type: 'session', version: 1, id: 's1', created: 1, vault: 'v' }),
      JSON.stringify({ id: 'a', parentId: null, at: 2, type: 'label', label: 'ok' }),
      '{"id": "b", "parentId": "a", "at": 3, "type": "lab', // torn write from another editor
      JSON.stringify({ nope: true }),
      JSON.stringify({ id: 'c', parentId: 'a', at: 4, type: 'label', label: 'still ok' }),
    ].join('\n')
    const parsed = parseSession(text)!
    expect(parsed.entries.map((e) => e.id)).toEqual(['a', 'c'])
    expect(parsed.problems).toEqual([
      { line: 3, reason: 'json' },
      { line: 4, reason: 'shape' },
    ])
    expect(parsed.leaf).toBe('c')
  })

  it('a file with no readable header is not a session', () => {
    expect(parseSession('garbage\n')).toBeNull()
    expect(parseSession('')).toBeNull()
  })

  it('lists sessions newest activity first, with the latest run and provider', async () => {
    const { store, tick } = setup()
    await store.create({ id: 'old', title: 'Old' })
    tick(10)
    await store.create({ id: 'new' })
    tick(10)
    await store.append('old', [{ type: 'run', run: run('r1', 'running') }])
    tick(10)
    await store.append('old', [{ type: 'run', run: run('r1', 'successful') }])

    const list = await store.list()
    expect(list.map((s) => s.id)).toEqual(['old', 'new'])
    expect(list[0]).toMatchObject({ title: 'Old', provider: 'p1', lastAt: 1_030, archived: false })
    expect(list[0].lastRun?.status).toBe('successful')
    expect(list[1].lastRun).toBeUndefined()
  })

  it('rename rewrites the header; archive hides a session until asked', async () => {
    const { store } = setup()
    await store.create({ id: 's1' })
    await store.rename('s1', '  Draft review ')
    expect((await store.load('s1'))!.header.title).toBe('Draft review')

    await store.archive('s1')
    expect(await store.list()).toEqual([])
    expect((await store.list({ archived: true })).map((s) => s.id)).toEqual(['s1'])
  })

  it('invalidate drops the cache so another writer’s change is read', async () => {
    const { store, files } = setup()
    await store.create({ id: 's1', title: 'Mine' })
    const header = JSON.stringify({ type: 'session', version: 1, id: 's1', created: 1, vault: 'v1', title: 'Theirs' })
    files.files.set(sessionPath('s1'), `${header}\n`)
    expect((await store.load('s1'))!.header.title).toBe('Mine')
    store.invalidate('s1')
    expect((await store.load('s1'))!.header.title).toBe('Theirs')
  })

  it('latestRuns folds status changes per run', () => {
    const entries = [
      { id: 'a', parentId: null, at: 1, type: 'run' as const, run: run('r1', 'scheduled') },
      { id: 'b', parentId: 'a', at: 2, type: 'run' as const, run: run('r2', 'running') },
      { id: 'c', parentId: 'b', at: 3, type: 'run' as const, run: run('r1', 'failed') },
    ]
    expect(latestRuns(entries).map((r) => [r.runId, r.status])).toEqual([
      ['r1', 'failed'],
      ['r2', 'running'],
    ])
  })
})
