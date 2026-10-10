/**
 * The collection tab's pure half: cell kinds, the one op an edit becomes,
 * how it lands on a live doc, and the toolbar's transforms.
 */
import { describe, expect, it } from 'vitest'
import type { EngineDoc } from '@ohhi/sync'
import type { PropValue, Row } from '@ohhi/index'
import {
  applyFrontmatterOp,
  cellDraft,
  cellText,
  columnKind,
  groupRows,
  kindOf,
  newRowText,
  opFor,
  replaceDocText,
  toggleSort,
  uniqueName,
} from './collection-cells.js'

/** A live doc in miniature: a string with the two text operations. */
function fakeDoc(initial: string): EngineDoc & { text: string; transactions: number } {
  const doc = {
    guid: 'g',
    text: initial,
    transactions: 0,
    getText: () => doc.text,
    transact: (fn: (t: { insert(i: number, s: string): void; delete(i: number, n: number): void }) => void) => {
      doc.transactions++
      fn({
        insert: (i, s) => (doc.text = doc.text.slice(0, i) + s + doc.text.slice(i)),
        delete: (i, n) => (doc.text = doc.text.slice(0, i) + doc.text.slice(i + n)),
      })
    },
    getMap: () => {
      throw new Error('not a folder doc')
    },
    transactMap: () => {
      throw new Error('not a folder doc')
    },
    raw: () => null,
    destroy: () => {},
  }
  return doc as unknown as EngineDoc & { text: string; transactions: number }
}

const s = (value: string): PropValue => ({ kind: 'string', value })
const n = (value: number): PropValue => ({ kind: 'number', value })
const d = (value: string): PropValue => ({ kind: 'date', value, ms: Date.parse(value) })
const link = (target: string, alias: string | null = null): PropValue => ({ kind: 'link', target, alias, resolved: null })
const list = (...items: string[]): PropValue => ({ kind: 'list', items: items.map((v) => ({ kind: 'string', value: v })) })

describe('what a cell shows and which editor it takes', () => {
  it('kindOf follows the value; a link shows its alias, a list its items', () => {
    expect(kindOf(undefined)).toBeNull()
    expect(kindOf({ kind: 'null' })).toBeNull()
    expect(kindOf(s('x'))).toBe('text')
    expect(kindOf(n(1))).toBe('number')
    expect(kindOf(d('2026-01-01'))).toBe('date')
    expect(kindOf(link('A'))).toBe('link')
    expect(kindOf(list('a'))).toBe('list')
    expect(cellText(link('Clusters', 'the clusters'))).toBe('the clusters')
    expect(cellText(list('a', 'b'))).toBe('a, b')
    expect(cellDraft(link('Clusters', 'x'))).toBe('Clusters')
    expect(cellDraft(undefined)).toBe('')
  })

  it('columnKind: an empty cell borrows the kind most of its column has', () => {
    expect(columnKind(undefined, [d('2026-01-01'), d('2026-02-01'), s('tbd')])).toBe('date')
    expect(columnKind(undefined, [undefined, undefined])).toBe('text')
    expect(columnKind(s('x'), [n(1), n(2)])).toBe('text')
  })
})

describe('opFor — the one op an edit becomes', () => {
  it('writes each kind as the frontmatter would say it', () => {
    expect(opFor('done', 'boolean', true)).toEqual({ op: 'set', key: 'done', value: true })
    expect(opFor('done', 'boolean', 'false')).toEqual({ op: 'set', key: 'done', value: false })
    expect(opFor('tags', 'list', 'a, b ,, c')).toEqual({ op: 'set', key: 'tags', value: ['a', 'b', 'c'] })
    expect(opFor('tags', 'list', '')).toEqual({ op: 'set', key: 'tags', value: [] })
    expect(opFor('pillar', 'link', 'Clusters')).toEqual({ op: 'set', key: 'pillar', value: '[[Clusters]]' })
    expect(opFor('pillar', 'link', '[[Clusters|c]]')).toEqual({ op: 'set', key: 'pillar', value: '[[Clusters|c]]' })
    expect(opFor('pillar', 'link', '')).toEqual({ op: 'set', key: 'pillar', value: '' })
    expect(opFor('score', 'number', ' 8 ')).toEqual({ op: 'set', key: 'score', value: 8 })
    expect(opFor('score', 'number', 'n/a')).toEqual({ op: 'set', key: 'score', value: 'n/a' })
    expect(opFor('score', 'number', '')).toEqual({ op: 'set', key: 'score', value: '' })
    expect(opFor('depth', 'text', 'Deep')).toEqual({ op: 'set', key: 'depth', value: 'Deep' })
  })
})

describe('applyFrontmatterOp — one value’s bytes, one transaction', () => {
  it('moves only the value and leaves every other byte', () => {
    const doc = fakeDoc('---\nthreat: direct # keep\ndepth: Deep\n---\n\n# Note\n')
    const out = applyFrontmatterOp(doc, { op: 'set', key: 'depth', value: 'Shallow' })
    expect(out.ok).toBe(true)
    expect(doc.text).toBe('---\nthreat: direct # keep\ndepth: Shallow\n---\n\n# Note\n')
    expect(doc.transactions).toBe(1)
  })

  it('adds a key to a note without a block, and refuses a nested block without touching it', () => {
    const doc = fakeDoc('# Note\n')
    expect(applyFrontmatterOp(doc, { op: 'set', key: 'depth', value: 'Deep' }).ok).toBe(true)
    expect(doc.text).toBe('---\ndepth: Deep\n---\n# Note\n')
    const nested = fakeDoc('---\nmeta:\n  deep: true\n---\n')
    const out = applyFrontmatterOp(nested, { op: 'set', key: 'depth', value: 'Deep' })
    expect(out).toEqual({ ok: false, reason: 'nested' })
    expect(nested.transactions).toBe(0)
  })

  it('is a no-op when the bytes are already there', () => {
    const doc = fakeDoc('---\ndepth: Deep\n---\n')
    applyFrontmatterOp(doc, { op: 'set', key: 'depth', value: 'Deep' })
    expect(doc.transactions).toBe(0)
  })
})

describe('replaceDocText — the smallest edit', () => {
  it('keeps the common prefix and suffix and writes the middle once', () => {
    const doc = fakeDoc('views:\n  - type: table\n    name: All\n  - type: list\n')
    const seen: string[] = []
    const orig = doc.transact
    doc.transact = (fn, origin) => {
      seen.push(String(origin))
      orig.call(doc, (t) => {
        fn({
          insert: (i, s) => {
            seen.push(`insert@${i}:${s}`)
            t.insert(i, s)
          },
          delete: (i, n) => {
            seen.push(`delete@${i}+${n}`)
            t.delete(i, n)
          },
        })
      }, origin)
    }
    replaceDocText(doc, 'views:\n  - type: table\n    name: Every\n  - type: list\n')
    expect(doc.text).toBe('views:\n  - type: table\n    name: Every\n  - type: list\n')
    expect(seen).toEqual(['local', 'delete@33+3', 'insert@33:Every'])
    replaceDocText(doc, doc.text)
    expect(doc.transactions).toBe(1)
  })
})

describe('toggleSort and groupRows', () => {
  it('cycles none → asc → desc → none on one column', () => {
    expect(toggleSort([], 'a')).toEqual([{ property: 'a', direction: 'asc' }])
    expect(toggleSort([{ property: 'a', direction: 'asc' }], 'a')).toEqual([{ property: 'a', direction: 'desc' }])
    expect(toggleSort([{ property: 'a', direction: 'desc' }], 'a')).toEqual([])
    expect(toggleSort([{ property: 'b', direction: 'desc' }], 'a')).toEqual([{ property: 'a', direction: 'asc' }])
  })

  const row = (name: string, props: Record<string, PropValue>): Row => ({
    guid: name,
    path: `${name}.md`,
    name,
    folder: '',
    ext: 'md',
    tags: [],
    links: [],
    mtime: null,
    size: 0,
    props,
  })

  it('groups by a property, empties last, rows in their given order', () => {
    const rows = [row('a', { depth: s('Deep') }), row('b', {}), row('c', { depth: s('Shallow') }), row('d', { depth: s('Deep') })]
    const groups = groupRows(rows, { key: { prop: 'depth' }, direction: 'asc' })
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.name)])).toEqual([
      ['Deep', ['a', 'd']],
      ['Shallow', ['c']],
      ['', ['b']],
    ])
    expect(groupRows(rows, { key: { prop: 'depth' }, direction: 'desc' }).map((g) => g.key)).toEqual(['Shallow', 'Deep', ''])
    expect(groupRows(rows, null)).toEqual([{ key: '', rows }])
  })
})

describe('new rows and new names', () => {
  it('newRowText writes the columns as empty keys', () => {
    expect(newRowText(['threat', 'depth'])).toBe('---\nthreat:\ndepth:\n---\n\n')
    expect(newRowText([])).toBe('')
  })

  it('uniqueName counts up past what is taken', () => {
    expect(uniqueName(new Set(), 'Team', 'Collection', '.base')).toBe('Collection.base')
    expect(uniqueName(new Set(['Team/Collection.base']), 'Team', 'Collection', '.base')).toBe('Collection 2.base')
    expect(uniqueName(new Set(['Collection.base', 'Collection 2.base']), '', 'Collection', '.base')).toBe('Collection 3.base')
  })
})
