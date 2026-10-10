/**
 * Anchored comment threads (writing-harness B8): the dual anchor follows
 * edits, re-anchors by quote after a rebuild from text, and is null once the
 * passage is gone; the records ride a `comments` Y.Map on an enrolled doc
 * and are materialized to `.ohhi/comments/<guid>.json` on the injected clock.
 */
import { createYjsEngine, type EngineDoc, type SyncEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import { describe, expect, it } from 'vitest'
import {
  COMMENTS_DIR,
  THREAD_WRITE_DEBOUNCE_MS,
  ThreadStore,
  commentsFile,
  findQuote,
  parseThreadsFile,
  quoteAt,
  type ThreadFiles,
} from '../src/threads.js'

const TEXT = 'Intro line.\nThe plan is to ship in March.\nOutro.\n'

function memFiles(): ThreadFiles & { store: Map<string, string>; writes: number } {
  const store = new Map<string, string>()
  const files = {
    store,
    writes: 0,
    read: async (p: string) => store.get(p) ?? null,
    write: async (p: string, text: string) => {
      files.writes++
      store.set(p, text)
    },
  }
  return files
}

function ids(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

function docWith(engine: SyncEngine, guid: string, text: string): EngineDoc {
  const doc = engine.createDoc(guid)
  doc.transact((t) => t.insert(0, text), 'local')
  return doc
}

const edit = (doc: EngineDoc, at: number, insert: string, del = 0): void =>
  doc.transact((t) => {
    if (del) t.delete(at, del)
    if (insert) t.insert(at, insert)
  }, 'local')

function enrolled(text = TEXT) {
  const engine = createYjsEngine()
  const doc = docWith(engine, 'g1', text)
  const clock = new SimClock()
  const files = memFiles()
  const store = new ThreadStore({ key: 'g1', path: () => 'plan.md', doc, files, clock, newId: ids() })
  return { engine, doc, clock, files, store }
}

const PLAN = TEXT.indexOf('plan')

describe('the text quote', () => {
  it('keeps 32 characters of context either side', () => {
    const long = `${'a'.repeat(40)}XYZ${'b'.repeat(40)}`
    const q = quoteAt(long, 40, 43)
    expect(q).toEqual({ exact: 'XYZ', prefix: 'a'.repeat(32), suffix: 'b'.repeat(32) })
  })

  it('picks the occurrence whose prefix and suffix agree best', () => {
    const text = 'see the plan here. And the plan there. And the plan again.'
    const second = text.indexOf('plan', text.indexOf('plan') + 1)
    const q = quoteAt(text, second, second + 4)
    expect(findQuote(text, q)).toEqual({ from: second, to: second + 4 })
    // The surroundings changed a little: still the nearest match.
    const edited = text.replace('And the plan there', 'And thee plan there')
    const at = edited.indexOf('plan there')
    expect(findQuote(edited, q)).toEqual({ from: at, to: at + 4 })
  })

  it('is null when the quoted text is gone', () => {
    expect(findQuote('nothing here', { exact: 'plan', prefix: '', suffix: '' })).toBeNull()
  })
})

describe('ThreadStore on an enrolled doc', () => {
  it('follows inserts before, inside and after the passage', () => {
    const { doc, store } = enrolled()
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'vague' })
    expect(t.anchor.live).toBeDefined()
    expect(t.anchor.quote).toMatchObject({ exact: 'plan' })

    edit(doc, 0, 'NEW ') // before
    expect(store.rangeOf(t)).toEqual({ from: PLAN + 4, to: PLAN + 8 })
    edit(doc, PLAN + 4 + 2, '--') // inside: "pl--an"
    expect(store.rangeOf(t)).toEqual({ from: PLAN + 4, to: PLAN + 10 })
    expect(doc.getText().slice(PLAN + 4, PLAN + 10)).toBe('pl--an')
    edit(doc, PLAN + 10, ' B') // right after: outside the range
    edit(doc, doc.getText().length, 'tail') // at the end
    expect(store.rangeOf(t)).toEqual({ from: PLAN + 4, to: PLAN + 10 })
  })

  it('resolves to null once the quoted text is deleted', () => {
    const { doc, store } = enrolled()
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'x' })
    edit(doc, PLAN - 4, '', 'The plan'.length)
    expect(doc.getText()).not.toContain('plan')
    expect(store.rangeOf(t)).toBeNull()
  })

  it('re-anchors by quote after a rebuild from the file (a fresh Y.Doc)', async () => {
    const { store, files, clock } = enrolled()
    store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'vague' })
    clock.advance(THREAD_WRITE_DEBOUNCE_MS)
    await Promise.resolve()
    expect(files.store.has(commentsFile('g1'))).toBe(true)

    // The doc is rebuilt from the file's bytes — new items, new client — and
    // someone wrote above the passage on disk meanwhile.
    const rebuilt = docWith(createYjsEngine(), 'g1', `# Title\n\n${TEXT}`)
    const again = new ThreadStore({ key: 'g1', path: () => 'plan.md', doc: rebuilt, files, clock: new SimClock() })
    await again.load()
    const [t] = again.threads()
    expect(t.comments.map((c) => c.body)).toEqual(['vague'])
    const at = rebuilt.getText().indexOf('plan')
    expect(again.rangeOf(t)).toEqual({ from: at, to: at + 4 })
  })

  it('materializes on the injected clock: one write per burst, none before the debounce', async () => {
    const { store, files, clock } = enrolled()
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'one', sendTo: ['agent'] })
    store.reply(t.id, { author: 'Ben', body: 'two' })
    expect(files.writes).toBe(0)
    clock.advance(THREAD_WRITE_DEBOUNCE_MS - 1)
    expect(files.writes).toBe(0)
    clock.advance(1)
    await Promise.resolve()
    expect(files.writes).toBe(1)
    const file = parseThreadsFile(files.store.get(`${COMMENTS_DIR}g1.json`) ?? '')
    expect(file?.threads[0]).toMatchObject({ id: t.id, path: 'plan.md', resolved: false })
    expect(file?.threads[0].comments.map((c) => [c.author, c.body, c.to])).toEqual([
      ['Ana', 'one', ['agent']],
      ['Ben', 'two', undefined],
    ])
  })

  it('never touches the text: the markdown bytes are the same after every thread operation', () => {
    const { doc, store } = enrolled()
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'x' })
    store.reply(t.id, { author: 'Ben', body: 'y' })
    store.resolve(t.id)
    expect(doc.getText()).toBe(TEXT)
  })

  it('resolve, reopen and markAnswered change the record', () => {
    const { store, clock } = enrolled()
    clock.advance(1000)
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'x', sendTo: ['agent'] })
    expect(t.created).toBe(1000)
    store.resolve(t.id)
    expect(store.get(t.id)?.resolved).toBe(true)
    store.resolve(t.id, false)
    expect(store.get(t.id)?.resolved).toBe(false)
    store.markAnswered(t.id, t.comments[0].id)
    const reply = store.reply(t.id, { author: 'Claude', body: 'done', answering: t.comments[0].id })
    expect(reply?.at).toBe(1000)
    expect(store.get(t.id)?.comments.map((c) => [c.author, c.answered, c.answering])).toEqual([
      ['Ana', true, undefined],
      ['Claude', undefined, t.comments[0].id],
    ])
    expect(store.reply('nope', { author: 'x', body: 'y' })).toBeNull()
  })

  it('syncs through the doc: two peers replying at once both survive', () => {
    const a = enrolled()
    const engineB = createYjsEngine()
    const docB = engineB.createDoc('g1')
    engineB.applyUpdate(docB, a.engine.encodeUpdateSince(a.doc, null), 'remote')
    const t = a.store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'root' })
    engineB.applyUpdate(docB, a.engine.encodeUpdateSince(a.doc, null), 'remote')

    const filesB = memFiles()
    const clockB = new SimClock()
    const storeB = new ThreadStore({ key: 'g1', path: () => 'plan.md', doc: docB, files: filesB, clock: clockB, newId: ids('b') })
    expect(storeB.threads().map((x) => x.id)).toEqual([t.id])
    expect(storeB.rangeOf(storeB.threads()[0])).toEqual({ from: PLAN, to: PLAN + 4 })

    const heads = { a: a.engine.heads(a.doc), b: engineB.heads(docB) }
    a.store.reply(t.id, { author: 'Ana', body: 'from A' })
    storeB.reply(t.id, { author: 'Ben', body: 'from B' })
    engineB.applyUpdate(docB, a.engine.encodeUpdateSince(a.doc, heads.a), 'remote')
    a.engine.applyUpdate(a.doc, engineB.encodeUpdateSince(docB, heads.b), 'remote')

    const bodies = (s: ThreadStore) => s.get(t.id)?.comments.map((c) => c.body).sort()
    expect(bodies(a.store)).toEqual(['from A', 'from B', 'root'])
    expect(bodies(storeB)).toEqual(['from A', 'from B', 'root'])
    // A peer's change is materialized on this device too.
    clockB.advance(THREAD_WRITE_DEBOUNCE_MS)
    expect(filesB.writes).toBe(1)
  })

  it("keeps the opening comment first even when a reply's clock is behind it", () => {
    const { store } = enrolled()
    const t = store.add({ from: 0, to: 5, author: 'Ana', body: 'root', at: 5000 })
    store.reply(t.id, { author: 'Ben', body: 'late', at: 10 }) // a peer's skewed clock
    store.reply(t.id, { author: 'Cleo', body: 'later', at: 6000 })
    store.resolve(t.id)
    expect(store.get(t.id)?.comments.map((c) => c.body)).toEqual(['root', 'late', 'later'])
  })

  it('notifies listeners on local and remote changes', () => {
    const { store } = enrolled()
    let n = 0
    const off = store.onChange(() => n++)
    store.add({ from: 0, to: 5, author: 'Ana', body: 'x' })
    expect(n).toBe(1)
    off()
    store.add({ from: 0, to: 5, author: 'Ana', body: 'y' })
    expect(n).toBe(1)
  })

  it('flushes a pending write on dispose rather than dropping it', async () => {
    const { store, files } = enrolled()
    store.add({ from: 0, to: 5, author: 'Ana', body: 'x' })
    await store.dispose()
    expect(files.writes).toBe(1)
  })
})

describe('ThreadStore on a tracked file (JSON only, no CRDT)', () => {
  it('anchors by quote, materializes, and loads back', async () => {
    let text = TEXT
    const files = memFiles()
    const clock = new SimClock()
    const store = new ThreadStore({ key: 'notes/plan.md', path: () => 'notes/plan.md', doc: null, text: () => text, files, clock, newId: ids() })
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'x' })
    expect(t.anchor.live).toBeUndefined()
    store.reply(t.id, { author: 'Ben', body: 'y' })
    store.resolve(t.id)
    clock.advance(THREAD_WRITE_DEBOUNCE_MS)
    await Promise.resolve()
    expect(files.writes).toBe(1)

    text = `prefix ${TEXT}`
    const back = new ThreadStore({ key: 'notes/plan.md', path: () => 'notes/plan.md', doc: null, text: () => text, files, clock })
    await back.load()
    const [loaded] = back.threads()
    expect(loaded).toMatchObject({ id: t.id, resolved: true })
    expect(loaded.comments.map((c) => c.body)).toEqual(['x', 'y'])
    expect(back.rangeOf(loaded)).toEqual({ from: PLAN + 7, to: PLAN + 11 })
  })

  it('reads a corrupt file as nothing, not a crash', async () => {
    const files = memFiles()
    files.store.set(commentsFile('k'), '{nope')
    const store = new ThreadStore({ key: 'k', path: () => 'k.md', doc: null, text: () => '', files, clock: new SimClock() })
    await store.load()
    expect(store.threads()).toEqual([])
  })
})
