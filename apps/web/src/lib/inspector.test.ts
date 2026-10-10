import { describe, expect, it } from 'vitest'
import type { PathInspection, SyncRecordFields } from '@ohhi/workspace'
import {
  chainOf,
  countByState,
  defaultPeekView,
  filterRows,
  isWrong,
  lineDiff,
  mountAgreement,
  mountHealth,
  peekChain,
  relayHost,
  reportText,
  sortRows,
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

describe('sortRows (worst first, fork 4)', () => {
  const rows = [
    { row: row({ path: 'b.md' }), state: 'in-sync' as const },
    { row: row({ path: 'img.png', kind: 'binary' }), state: 'not-text' as const },
    { row: row({ path: 'z.md' }), state: 'diverged' as const },
    { row: row({ path: 'a.md' }), state: 'doc-ahead' as const },
    { row: row({ path: 'c.md' }), state: 'diverged' as const },
  ]
  it('orders by state severity, then path; not-text last', () => {
    expect(sortRows(rows, 'worst').map((r) => r.row.path)).toEqual(['c.md', 'z.md', 'a.md', 'b.md', 'img.png'])
  })
  it('orders by path with not-text still last, and leaves the input alone', () => {
    expect(sortRows(rows, 'path').map((r) => r.row.path)).toEqual(['a.md', 'b.md', 'c.md', 'z.md', 'img.png'])
    expect(rows[0].row.path).toBe('b.md')
  })
})

describe('mountHealth (the scope chip\'s dot)', () => {
  const r = (state: Parameters<typeof isWrong>[0], relay: 'synced' | 'pending' = 'synced') => ({
    row: row(),
    state,
    chain: { diskLca: 'equal' as const, lcaDoc: 'equal' as const, relay },
  })
  it('needs-token is offline whatever the rows say', () => {
    expect(mountHealth([r('diverged')], 'needs-token').tone).toBe('offline')
  })
  it('diverged beats pending beats ok', () => {
    expect(mountHealth([r('doc-ahead'), r('diverged')], 'active').tone).toBe('diverged')
    expect(mountHealth([r('disk-changed')], 'active').tone).toBe('pending')
    expect(mountHealth([r('in-sync', 'pending')], 'active')).toMatchObject({ tone: 'pending', atRelay: 1 })
    expect(mountHealth([r('in-sync'), r('no-doc')], null).tone).toBe('ok')
  })
})

describe('mountAgreement (line 2 of the card)', () => {
  const m = (desc: { status: string; relay: string | null; neverHeld: boolean } | null, mountPath = 'f', relay: string | null = 'wss://r') => ({
    mountPath,
    relay,
    desc,
  })
  it('agrees when status is active and the relay matches or is the default', () => {
    expect(mountAgreement(m({ status: 'active', relay: 'wss://r', neverHeld: false })).kind).toBe('agrees')
    expect(mountAgreement(m({ status: 'active', relay: null, neverHeld: false })).kind).toBe('agrees')
  })
  it('says the difference otherwise', () => {
    expect(mountAgreement(m(null))).toEqual({ kind: 'no-desc' })
    expect(mountAgreement(m(null, ''))).toEqual({ kind: 'root' })
    expect(mountAgreement(m({ status: 'needs-token', relay: null, neverHeld: true }, 'f', null))).toEqual({
      kind: 'needs-token',
      neverHeld: true,
    })
    expect(mountAgreement(m({ status: 'carving:seeding', relay: null, neverHeld: false }))).toEqual({
      kind: 'status',
      status: 'carving:seeding',
    })
    expect(mountAgreement(m({ status: 'active', relay: 'wss://other', neverHeld: false }))).toEqual({
      kind: 'relay',
      desc: 'wss://other',
      session: 'wss://r',
    })
  })
  it('relayHost shortens a URL and tolerates junk', () => {
    expect(relayHost('wss://relay.example:8080/x')).toBe('relay.example:8080')
    expect(relayHost('not a url')).toBe('not a url')
    expect(relayHost(null)).toBeNull()
  })
})

describe('reportText (Copy report)', () => {
  const words = { title: 'Report', state: (s: string) => s.toUpperCase() }
  const chain = { diskLca: 'equal' as const, lcaDoc: 'differs' as const, relay: 'none' as const }
  it('lists every row in scope, one per line, with the chain as glyphs', () => {
    const text = reportText(
      {
        kind: 'scope',
        scope: 'All mounts',
        invariants: ['x is wrong'],
        mounts: [{ name: 'root', line: 'local · active' }],
        rows: [
          { row: row({ path: 'a.md' }), state: 'doc-ahead', chain },
          { row: row({ path: 'p.png', kind: 'binary' }), state: 'not-text', chain },
        ],
      },
      0,
      words
    )
    expect(text.split('\n')).toEqual([
      'Report · 1970-01-01T00:00:00.000Z',
      'scope: All mounts',
      'invariants: 1 violated',
      '  ! x is wrong',
      'mount root: local · active',
      'rows: 2',
      'DOC-AHEAD  disk ═══ base ≠≠≠ doc – relay  a.md',
      'NOT-TEXT   binary  p.png',
    ])
  })
  it('reports one file with its record, measured chain and raw facts', () => {
    const text = reportText(
      {
        kind: 'file',
        row: { row: row(), state: 'doc-ahead', chain },
        record: record(),
        peek: { disk: { text: 'a', hash: 'h1' }, lca: { text: 'b', hash: 'h2' }, doc: null },
        detail: {
          guid: 'g-a',
          mount: { path: '', room: 'room-1' },
          lca: { contentHash: 'h2', headsDigest: 'hd', eol: 'lf', bom: false, baseTextLength: 1 },
          doc: { headsDigest: 'dd', textLength: 1 },
          journal: { count: 1, recent: [{ at: 0, bytes: 3 }] },
          providerAttached: false,
        },
      },
      0,
      words
    )
    expect(text).toContain('path: notes/a.md')
    expect(text).toContain('state: DOC-AHEAD (doc-ahead)')
    // The peek's hashes differ → disk ≠ base, measured.
    expect(text).toContain('chain: disk ≠≠≠ base ≠≠≠ doc – relay')
    expect(text).toContain('diverged false')
    expect(text).toContain("mount: '/' · room room-1 · guid g-a")
    expect(text).toContain('journal: 1')
  })
})
