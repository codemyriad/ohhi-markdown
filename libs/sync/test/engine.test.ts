import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '../src/yjs-engine.js'

const engine = createYjsEngine()

function connect2(guidA = 'doc-a', text = '') {
  const a = engine.createDoc(guidA)
  const b = engine.createDoc(guidA)
  if (text) a.transact((t) => t.insert(0, text), 'seed')
  engine.applyUpdate(b, engine.encodeUpdateSince(a, null))
  return { a, b }
}

describe('engine seam (Yjs impl)', () => {
  it('round-trips text through transactions', () => {
    const doc = engine.createDoc('d1')
    doc.transact((t) => t.insert(0, 'hello world'), 'local')
    doc.transact((t) => t.delete(5, 6), 'local')
    expect(doc.getText()).toBe('hello')
  })

  it('converges two docs via update exchange', () => {
    const { a, b } = connect2('d2', 'base\n')
    a.transact((t) => t.insert(0, 'A-edit '), 'local')
    b.transact((t) => t.insert(b.getText().length, 'B-edit'), 'local')
    engine.applyUpdate(b, engine.encodeUpdateSince(a, engine.heads(b)))
    engine.applyUpdate(a, engine.encodeUpdateSince(b, engine.heads(a)))
    expect(a.getText()).toBe(b.getText())
    expect(a.getText()).toContain('A-edit ')
    expect(a.getText()).toContain('B-edit')
  })

  it('heads equality detects delete-only divergence (the sv-only bug class)', () => {
    const { a, b } = connect2('d3', 'abcdef')
    const before = engine.heads(a)
    expect(engine.headsEqual(before, engine.heads(b))).toBe(true)

    // Delete-only edit: state vector does not advance, only the delete set.
    a.transact((t) => t.delete(0, 3), 'local')
    const after = engine.heads(a)

    // Sanity: this is precisely why heads must include the delete set.
    expect(engine.headsEqual(before, after)).toBe(false)
    expect(engine.headsEqual(after, engine.heads(b))).toBe(false)
  })

  it('encode/decode heads round-trips equality', () => {
    const { a } = connect2('d4', 'content')
    const h = engine.heads(a)
    const decoded = engine.decodeHeads(engine.encodeHeads(h))
    expect(engine.headsEqual(h, decoded)).toBe(true)
  })

  it('emits updates with the transaction origin', () => {
    const doc = engine.createDoc('d5')
    const origins: unknown[] = []
    const off = engine.onUpdate(doc, (_u, origin) => origins.push(origin))
    doc.transact((t) => t.insert(0, 'x'), 'disk')
    doc.transact((t) => t.insert(0, 'y'), 'local')
    off()
    doc.transact((t) => t.insert(0, 'z'), 'local')
    expect(origins).toEqual(['disk', 'local'])
  })

  it('folder map: entries + observe with origin', () => {
    const folder = engine.createDoc('folder-1')
    const seen: unknown[] = []
    const offObserve = folder.getMap().observe((origin) => seen.push(origin))
    folder.transactMap(
      (m) => m.set('notes/a.md', { guid: 'g1', kind: 'text' }),
      'seed'
    )
    expect(folder.getMap().get('notes/a.md')).toEqual({ guid: 'g1', kind: 'text' })
    expect(seen).toEqual(['seed'])
    offObserve()
  })

  it('encodeUpdateSince(heads) produces a minimal catch-up update', () => {
    const { a, b } = connect2('d6', 'shared base that is long enough to matter\n')
    a.transact((t) => t.insert(0, 'tip'), 'local')
    const delta = engine.encodeUpdateSince(a, engine.heads(b))
    const full = engine.encodeUpdateSince(a, null)
    expect(delta.length).toBeLessThan(full.length)
    engine.applyUpdate(b, delta)
    expect(b.getText()).toBe(a.getText())
  })
})

describe('update inspection (sharing E3: attribution at arrival)', () => {
  it('clientIdsOf names the replicas whose inserts an update carries', () => {
    const { a, b } = connect2('attr-1', 'base')
    const seen: Uint8Array[] = []
    const off = engine.onUpdate(b, (u) => seen.push(u))
    b.transact((t) => t.insert(0, 'B '), 'local')
    off()
    expect(engine.clientIdsOf(seen[0]!)).toEqual([engine.clientIdOf(b)])
    expect(engine.clientIdOf(a)).not.toBe(engine.clientIdOf(b))
    // A full-state update carries every author, ascending.
    const full = engine.encodeUpdateSince(b, null)
    expect(engine.clientIdsOf(full)).toEqual([engine.clientIdOf(a), engine.clientIdOf(b)].sort((x, y) => x - y))
  })

  it('a delete-only update carries no client id (the delete set names authors, not deleters)', () => {
    const { b } = connect2('attr-2', 'abcdef')
    const seen: Uint8Array[] = []
    const off = engine.onUpdate(b, (u) => seen.push(u))
    b.transact((t) => t.delete(0, 3), 'local')
    off()
    expect(engine.clientIdsOf(seen[0]!)).toEqual([])
    expect(engine.charDeltaOf(seen[0]!)).toEqual({ added: 0, removed: 3 })
  })

  it('charDeltaOf counts inserted characters and deleted items', () => {
    const { b } = connect2('attr-3', 'abcdef')
    const seen: Uint8Array[] = []
    const off = engine.onUpdate(b, (u) => seen.push(u))
    b.transact((t) => {
      t.delete(0, 2)
      t.insert(0, 'hello')
    }, 'local')
    off()
    expect(engine.charDeltaOf(seen[0]!)).toEqual({ added: 5, removed: 2 })
  })
})
