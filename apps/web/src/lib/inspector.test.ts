import { describe, expect, it } from 'vitest'
import type { PathInspection, SyncRecordFields } from '@ohhi/workspace'
import {
  chainOf,
  countByState,
  defaultPeekView,
  filterRows,
  isWrong,
  lineDiff,
  peekChain,
  rowState,
  ROW_STATES,
  type ClassifiedRow,
} from './inspector.js'

const row = (over: Partial<PathInspection> = {}): PathInspection => ({
  path: 'notes/a.md',
  guid: 'g-a',
  kind: 'text',
  lca: { headsDigest: 'aaaaaaaaaaaa', contentHash: 'h' },
  doc: { headsDigest: 'aaaaaaaaaaaa', equalsLca: true },
  providerAttached: false,
  journalCount: 0,
  open: false,
  ...over,
})

const record = (over: Partial<SyncRecordFields> = {}): SyncRecordFields => ({
  connected: true,
  synced: true,
  pendingLocal: false,
  diskMatchesCrdt: true,
  diverged: false,
  ...over,
})

describe('rowState', () => {
  it('is in sync when the heads agree and the record is clean', () => {
    expect(rowState(row(), record())).toBe('in-sync')
  })

  it('never classifies a binary or a directory', () => {
    expect(rowState(row({ kind: 'binary', lca: null, doc: null }), undefined)).toBe('not-text')
    expect(rowState(row({ kind: 'dir', lca: null, doc: null }), undefined)).toBe('not-text')
  })

  it('lets the record win on diverged — the reconciler has already refused to write', () => {
    expect(rowState(row({ lca: null }), record({ diverged: true }))).toBe('diverged')
  })

  it('names the missing store before comparing anything', () => {
    expect(rowState(row({ lca: null }), record())).toBe('no-lca')
    expect(rowState(row({ doc: null }), record())).toBe('no-doc')
  })

  it('reads disk-changed off the record and doc-ahead off the heads', () => {
    expect(rowState(row(), record({ diskMatchesCrdt: false }))).toBe('disk-changed')
    expect(rowState(row({ doc: { headsDigest: 'bbbbbbbbbbbb', equalsLca: false } }), record())).toBe(
      'doc-ahead'
    )
  })

  it('works without a record — a doc the shell has not created a record for yet', () => {
    expect(rowState(row({ doc: { headsDigest: 'b', equalsLca: false } }), undefined)).toBe('doc-ahead')
    expect(rowState(row(), undefined)).toBe('in-sync')
  })
})

describe('filterRows / countByState', () => {
  const rows: ClassifiedRow[] = [
    { row: row({ path: 'notes/a.md' }), state: 'in-sync' },
    { row: row({ path: 'notes/b.md' }), state: 'doc-ahead' },
    { row: row({ path: 'daily/c.md' }), state: 'diverged' },
    { row: row({ path: 'img/x.png', kind: 'binary' }), state: 'not-text' },
  ]

  it('filters by prefix, by state, and by both', () => {
    expect(filterRows(rows, { prefix: 'notes', state: null }).map((r) => r.row.path)).toEqual([
      'notes/a.md',
      'notes/b.md',
    ])
    expect(filterRows(rows, { prefix: '', state: 'diverged' }).map((r) => r.row.path)).toEqual([
      'daily/c.md',
    ])
    expect(filterRows(rows, { prefix: 'notes', state: 'doc-ahead' }).map((r) => r.row.path)).toEqual([
      'notes/b.md',
    ])
    expect(filterRows(rows, { prefix: '  ', state: null })).toHaveLength(4)
  })

  it('counts every state, zero included, in the filter order', () => {
    const counts = countByState(rows)
    expect(Object.keys(counts)).toEqual(ROW_STATES)
    expect(counts['in-sync']).toBe(1)
    expect(counts['doc-ahead']).toBe(1)
    expect(counts.diverged).toBe(1)
    expect(counts['not-text']).toBe(1)
    expect(counts['no-lca']).toBe(0)
  })

  it('knows which states are worth a look', () => {
    expect(ROW_STATES.filter(isWrong)).toEqual(['diverged', 'disk-changed', 'doc-ahead'])
  })
})

describe('chainOf (the pipeline row)', () => {
  it('reads every link as equal for a settled, synced file', () => {
    expect(chainOf(row({ providerAttached: true }), record())).toEqual({
      diskLca: 'equal',
      lcaDoc: 'equal',
      relay: 'synced',
    })
  })

  it('doc ahead with a flush pending: disk still equals the LCA, the doc does not', () => {
    const r = row({ doc: { headsDigest: 'b', equalsLca: false }, providerAttached: true })
    expect(chainOf(r, record({ diskMatchesCrdt: false, pendingLocal: true }))).toEqual({
      diskLca: 'equal',
      lcaDoc: 'differs',
      relay: 'pending',
    })
  })

  it('a disk change not yet ingested: doc level with the LCA, disk not', () => {
    expect(chainOf(row(), record({ diskMatchesCrdt: false }))).toMatchObject({ diskLca: 'differs', lcaDoc: 'equal' })
  })

  it('diverged breaks both links; offline and no-relay show on the last', () => {
    const r = row({ doc: { headsDigest: 'b', equalsLca: false }, providerAttached: true })
    expect(chainOf(r, record({ diverged: true, connected: false }))).toEqual({
      diskLca: 'differs',
      lcaDoc: 'differs',
      relay: 'offline',
    })
    expect(chainOf(row(), record()).relay).toBe('none')
    expect(chainOf(row({ kind: 'dir', lca: null, doc: null }), undefined)).toEqual({
      diskLca: 'unknown',
      lcaDoc: 'unknown',
      relay: 'none',
    })
  })

  it('does not guess without a record or without both stores', () => {
    expect(chainOf(row(), undefined).diskLca).toBe('unknown')
    expect(chainOf(row({ lca: null }), record())).toMatchObject({ diskLca: 'unknown', lcaDoc: 'unknown' })
  })

  it('peekChain replaces the inference with the measured hashes', () => {
    const inferred = chainOf(row(), record())
    const peek = { disk: { text: 'x', hash: 'h1' }, lca: { text: 'y', hash: 'h2' }, doc: { text: 'x' } }
    expect(peekChain(inferred, peek).diskLca).toBe('differs')
    expect(peekChain(inferred, { ...peek, lca: null }).diskLca).toBe('equal')
    expect(peekChain(inferred, null)).toBe(inferred)
  })

  it('picks the diff across the link that differs as the default view', () => {
    expect(defaultPeekView({ diskLca: 'equal', lcaDoc: 'differs', relay: 'none' })).toBe('doc-lca')
    expect(defaultPeekView({ diskLca: 'differs', lcaDoc: 'equal', relay: 'none' })).toBe('disk-lca')
    expect(defaultPeekView({ diskLca: 'equal', lcaDoc: 'equal', relay: 'none' })).toBe('doc')
  })
})

describe('lineDiff', () => {
  const kinds = (a: string, b: string) => lineDiff(a, b)!.map((l) => `${l.kind[0]}:${l.text}`)

  it('marks what moved from a to b, keeping the common prefix and suffix', () => {
    expect(kinds('one\ntwo\nthree', 'one\n2\nthree')).toEqual(['s:one', 'd:two', 'a:2', 's:three'])
  })

  it('handles pure insertions, pure deletions and identical texts', () => {
    expect(kinds('a\nb', 'a\nx\nb')).toEqual(['s:a', 'a:x', 's:b'])
    expect(kinds('a\nx\nb', 'a\nb')).toEqual(['s:a', 'd:x', 's:b'])
    expect(kinds('a\nb', 'a\nb')).toEqual(['s:a', 's:b'])
    expect(kinds('', 'a')).toEqual(['d:', 'a:a'])
  })

  it('finds a longest common subsequence in the middle', () => {
    expect(kinds('a\nb\nc\nd', 'b\nd\ne')).toEqual(['d:a', 's:b', 'd:c', 's:d', 'a:e'])
  })

  it('refuses above the cap rather than stalling the pane', () => {
    expect(lineDiff('x\n'.repeat(4000), 'y')).toBeNull()
  })
})
