/**
 * Suggestions in the document (writing-harness B7; spike S14 Q3).
 *
 * The L0 property at the bottom is H3's build gate: for random notes, a
 * random suggestion and a random peer edit before, inside or after its range
 * — delivered before the accept or concurrent with it — accept-or-stale
 * never loses the peer's characters and never applies a stale proposal.
 */
import { createYjsEngine, type EngineDoc } from '@ohhi/sync'
import { TestNetwork } from '@ohhi/testkit'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  AgentRuns,
  memoryRecordMap,
  resolveRange,
  SuggestionConflictError,
  SuggestionStore,
  SUGGESTIONS_KEY,
  yRecordMap,
  ytextOf,
  type AgentOrigin,
  type RecordMap,
} from '../src/index.js'
import { bootDuo } from './fixture.js'

const origin: AgentOrigin = { kind: 'agent', runId: 'r1', sessionId: 's1', name: 'Tighten' }

function store(text: string, records: (doc: Y.Doc) => RecordMap = yRecordMap) {
  const doc = new Y.Doc()
  const ytext = ytextOf(doc)
  ytext.insert(0, text)
  const runs = new AgentRuns()
  return { doc, ytext, runs, s: new SuggestionStore({ doc, records: records(doc), runs }) }
}

let seq = 0
const propose = (s: SuggestionStore, from: number, to: number, baseText: string, proposedText: string) =>
  s.propose({ id: `id${++seq}`, at: seq, from, to, baseText, proposedText, origin })

describe.each([
  ['shared (Y.Map in the doc)', yRecordMap],
  ['tracked (in memory)', () => memoryRecordMap()],
] as const)('SuggestionStore — %s', (_label, records) => {
  it('proposes without touching the text, and accepts in one agent transaction', () => {
    const { doc, ytext, s } = store('alpha beta gamma', records)
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.changed.has(ytext as unknown as Y.AbstractType<Y.YEvent<Y.Text>>)) origins.push(tr.origin)
    })
    const r = propose(s, 6, 10, 'beta', 'BETA')
    expect(ytext.toString()).toBe('alpha beta gamma')
    expect(r).toMatchObject({ status: 'pending', baseText: 'beta', proposedText: 'BETA', origin })
    expect(s.spans()).toEqual([
      { id: r.id, from: 6, to: 10, baseText: 'beta', proposedText: 'BETA', status: 'pending', name: 'Tighten', runId: 'r1' },
    ])
    expect(s.accept(r.id)?.status).toBe('accepted')
    expect(ytext.toString()).toBe('alpha BETA gamma')
    expect(origins).toHaveLength(1)
    expect(origins[0]).toMatchObject(origin)
    // Accepted records leave the page; accepting twice is a no-op.
    expect(s.spans()).toEqual([])
    expect(s.accept(r.id)?.status).toBe('accepted')
    expect(ytext.toString()).toBe('alpha BETA gamma')
  })

  it('refuses a proposal over text the agent did not read', () => {
    const { s } = store('alpha beta', records)
    expect(() => propose(s, 0, 5, 'omega', 'x')).toThrow(SuggestionConflictError)
    expect(() => propose(s, 4, 99, 'a beta', 'x')).toThrow(SuggestionConflictError)
  })

  it('follows edits around the range; an edit inside flips it stale, and a stale one is never applied', () => {
    const { ytext, s } = store('alpha beta gamma', records)
    const r = propose(s, 6, 10, 'beta', 'BETA')
    ytext.insert(0, '# ')
    ytext.insert(ytext.length, '!')
    expect(s.spans()[0]).toMatchObject({ from: 8, to: 12, status: 'pending' })
    ytext.insert(10, 'X')
    expect(s.list()[0]?.status).toBe('stale')
    expect(s.accept(r.id)?.status).toBe('stale')
    expect(ytext.toString()).toBe('# alpha beXta gamma!')
    // A stale record stays on the page (to re-run) until rejected.
    expect(s.spans()[0]).toMatchObject({ status: 'stale' })
    expect(s.reject(r.id)).toBe(true)
    expect(s.list()).toEqual([])
  })

  it('reject drops the record and leaves the text alone; subscribers hear every change', () => {
    const { ytext, s } = store('one two', records)
    let heard = 0
    const off = s.subscribe(() => heard++)
    const r = propose(s, 4, 7, 'two', '2')
    expect(heard).toBeGreaterThan(0)
    const before = heard
    expect(s.reject(r.id)).toBe(true)
    expect(heard).toBeGreaterThan(before)
    expect(s.reject(r.id)).toBe(false)
    expect(ytext.toString()).toBe('one two')
    off()
    ytext.insert(0, 'x')
    const after = heard
    ytext.insert(0, 'y')
    expect(heard).toBe(after)
  })

  it('an empty range is an insertion point; an empty proposal is a deletion', () => {
    const { ytext, s } = store('ab', records)
    const ins = propose(s, 1, 1, '', '-')
    ytext.insert(1, 'zz') // at the point: lands before it, never "inside"
    expect(s.accept(ins.id)?.status).toBe('accepted')
    expect(ytext.toString()).toBe('azz-b')
    const del = propose(s, 1, 3, 'zz', '')
    expect(s.accept(del.id)?.status).toBe('accepted')
    expect(ytext.toString()).toBe('a-b')
  })

  it('lists newest first and orders spans by position', () => {
    const { s } = store('one two three', records)
    const a = propose(s, 8, 13, 'three', '3')
    const b = propose(s, 0, 3, 'one', '1')
    expect(s.list().map((r) => r.id)).toEqual([b.id, a.id])
    expect(s.spans().map((r) => r.id)).toEqual([b.id, a.id])
  })
})

describe('SuggestionStore — where records live', () => {
  it('a shared doc carries its records in the `suggestions` Y.Map, so a replica sees them', () => {
    const { doc, s } = store('alpha beta')
    propose(s, 6, 10, 'beta', 'BETA')
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    expect([...other.getMap(SUGGESTIONS_KEY).values()]).toHaveLength(1)
    const mirror = new SuggestionStore({ doc: other, records: yRecordMap(other), runs: new AgentRuns() })
    expect(mirror.spans()).toMatchObject([{ from: 6, to: 10, status: 'pending' }])
  })

  it('a tracked doc keeps them in memory: nothing enters the doc', () => {
    const { doc, s } = store('alpha beta', () => memoryRecordMap())
    propose(s, 6, 10, 'beta', 'BETA')
    expect(doc.getMap(SUGGESTIONS_KEY).size).toBe(0)
  })

  it('resolveRange clamps plain offsets to the text', () => {
    const { doc } = store('abc')
    expect(resolveRange(doc, { from: 1, to: 99 })).toEqual({ from: 1, to: 3 })
    expect(resolveRange(doc, { from: 5, to: 2 })).toEqual({ from: 3, to: 3 })
  })
})

describe('MountSession — a shared note: the peer sees the proposal, and its edit inside stales it', () => {
  it('B sees A\'s pending suggestion; B typing inside it makes it stale on both, and A cannot apply it', async () => {
    const duo = await bootDuo({ files: { 'note.md': 'alpha beta gamma\n' } })
    try {
      const r = await duo.a.root.proposeEdit({ path: 'note.md', from: 6, to: 10, baseText: 'beta', proposedText: 'BETA', origin })
      await duo.deliver()
      expect(duo.b.root.suggestionsFor('note.md')).toMatchObject([{ id: r.id, status: 'pending', path: 'note.md' }])
      duo.b.root.docForPath('note.md')!.transact((t) => t.insert(8, 'XX'), 'local')
      await duo.deliver()
      expect(duo.b.root.suggestionsFor('note.md')[0]?.status).toBe('stale')
      expect(duo.a.root.suggestionsFor('note.md')[0]?.status).toBe('stale')
      expect(duo.a.root.acceptSuggestion('note.md', r.id)?.status).toBe('stale')
      await duo.deliver()
      expect(duo.a.root.docForPath('note.md')!.getText()).toBe('alpha beXXta gamma\n')
      expect(duo.b.root.docForPath('note.md')!.getText()).toBe('alpha beXXta gamma\n')
    } finally {
      duo.dispose()
    }
  })

  it('an accepted suggestion reaches the peer as text, and B rejecting another drops it for A', async () => {
    const duo = await bootDuo({ files: { 'note.md': 'one two three\n' } })
    try {
      const a = await duo.a.root.proposeEdit({ path: 'note.md', from: 0, to: 3, baseText: 'one', proposedText: '1', origin })
      const b = await duo.a.root.proposeEdit({ path: 'note.md', from: 8, to: 13, baseText: 'three', proposedText: '3', origin })
      await duo.deliver()
      expect(duo.b.root.acceptSuggestion('note.md', a.id)?.status).toBe('accepted')
      expect(duo.b.root.rejectSuggestion('note.md', b.id)).toBe(true)
      await duo.deliver()
      expect(duo.a.root.docForPath('note.md')!.getText()).toBe('1 two three\n')
      expect(duo.a.root.suggestionsFor('note.md').map((r) => [r.id, r.status])).toEqual([[a.id, 'accepted']])
    } finally {
      duo.dispose()
    }
  })
})

// ---- L0: suggestion ⊕ concurrent peer edit (spike S14 Q3, H3's build gate) ----

const BASE = fc.string({ unit: fc.constantFrom('a', 'b', 'c', ' ', '\n'), minLength: 1, maxLength: 24 })
const PROPOSED = fc.string({ unit: fc.constantFrom('X', 'Y', 'Z'), maxLength: 5 })
const PEER_TEXT = fc.string({ unit: fc.constantFrom('p', 'q'), minLength: 1, maxLength: 4 })
type PeerEdit = { kind: 'insert'; pos: number; text: string } | { kind: 'delete'; pos: number; len: number }
const EDIT: fc.Arbitrary<PeerEdit> = fc.oneof(
  fc.record({ kind: fc.constant('insert' as const), pos: fc.nat(), text: PEER_TEXT }),
  fc.record({ kind: fc.constant('delete' as const), pos: fc.nat(), len: fc.integer({ min: 1, max: 6 }) })
)

interface Case {
  base: string
  r1: number
  r2: number
  proposed: string
  edit: PeerEdit
  order: 'peer-first' | 'concurrent'
}

/** Two replicas of one note over the TestNetwork, each with its own store over the shared records. */
function pair(base: string) {
  const engine = createYjsEngine()
  const net = new TestNetwork(engine)
  const a = engine.createDoc('note')
  const b = engine.createDoc('note')
  a.transact((t) => t.insert(0, base), 'seed')
  engine.applyUpdate(b, engine.encodeUpdateSince(a, null), 'remote')
  net.addPeer('a', a)
  net.addPeer('b', b)
  const mk = (doc: EngineDoc) => new SuggestionStore({ doc, records: yRecordMap(doc), runs: new AgentRuns() })
  return { net, a, b, sa: mk(a), sb: mk(b) }
}

function applyPeer(doc: EngineDoc, e: PeerEdit, n: number): { p: number; len: number } {
  if (e.kind === 'insert') {
    const p = e.pos % (n + 1)
    doc.transact((t) => t.insert(p, e.text), 'local')
    return { p, len: e.text.length }
  }
  const p = e.pos % n
  const len = Math.min(e.len, n - p)
  doc.transact((t) => t.delete(p, len), 'local')
  return { p, len }
}

/** Remove the characters at `drop` (base indices). */
const keep = (s: string, offset: number, drop: (i: number) => boolean): string =>
  [...s].filter((_, i) => !drop(i + offset)).join('')

describe('L0 property: suggestion ⊕ concurrent peer edit (spike S14 Q3)', () => {
  it('never loses the peer\'s characters and never applies a stale proposal', () => {
    fc.assert(
      fc.property(BASE, fc.nat(), fc.nat(), PROPOSED, EDIT, fc.constantFrom('peer-first' as const, 'concurrent' as const), (base, r1, r2, proposed, edit, order) => {
        const c: Case = { base, r1, r2, proposed, edit, order }
        const n = base.length
        const from = Math.min(r1 % (n + 1), r2 % (n + 1))
        const to = Math.max(r1 % (n + 1), r2 % (n + 1))
        const { net, a, b, sa, sb } = pair(base)
        const rec = sa.propose({ id: 's1', at: 1, from, to, baseText: base.slice(from, to), proposedText: proposed, origin })
        net.deliverAll()
        expect(sb.list()).toHaveLength(1)

        const { p, len } = applyPeer(b, edit, n)
        const empty = from === to
        // The oracle for "inside": an insert strictly between the edges; a
        // delete that takes at least one character of the range. An empty
        // range holds no characters, so nothing is ever inside it.
        const inside = empty ? false : edit.kind === 'insert' ? from < p && p < to : len > 0 && p < to && p + len > from
        const peerText = edit.kind === 'insert' ? edit.text : ''

        if (order === 'peer-first') {
          net.deliverAll()
          const afterPeer = a.getText()
          const result = sa.accept(rec.id)
          net.deliverAll()
          expect(a.getText(), JSON.stringify(c)).toBe(b.getText())
          if (inside) {
            // Stale: never applied — the text is exactly what the peer left.
            expect(result?.status, JSON.stringify(c)).toBe('stale')
            expect(a.getText()).toBe(afterPeer)
            expect(sb.list()[0]?.status).toBe('stale')
          } else {
            expect(result?.status, JSON.stringify(c)).toBe('accepted')
            // Where the range is now, by the anchoring rule (edges stay outside).
            let nf = from
            let nt = to
            if (edit.kind === 'insert') {
              if (p <= from) nf += len
              if (empty) nt = nf
              else if (p < to) nt += len
            } else {
              const map = (x: number): number => (x <= p ? x : x >= p + len ? x - len : p)
              nf = map(from)
              nt = empty ? nf : map(to)
            }
            expect(a.getText(), JSON.stringify(c)).toBe(afterPeer.slice(0, nf) + proposed + afterPeer.slice(nt))
          }
        } else {
          // Concurrent: A accepts before it hears of the peer's edit.
          expect(sa.accept(rec.id)?.status).toBe('accepted')
          net.deliverAll()
          const final = a.getText()
          expect(final, JSON.stringify(c)).toBe(b.getText())
          const replaced = base.slice(0, from) + proposed + base.slice(to)
          if (edit.kind === 'insert') {
            // The peer's characters survive whole, and everything else is the accepted text.
            expect(final, JSON.stringify(c)).toContain(peerText)
            const at = final.indexOf(peerText)
            expect(final.slice(0, at) + final.slice(at + peerText.length), JSON.stringify(c)).toBe(replaced)
          } else {
            // Both deletions land; the proposal sits where the range was.
            const gone = (i: number): boolean => (i >= from && i < to) || (i >= p && i < p + len)
            expect(final, JSON.stringify(c)).toBe(keep(base.slice(0, from), 0, gone) + proposed + keep(base.slice(from), from, gone))
          }
          // Both replicas agree on the record.
          expect(sa.list()[0]?.status).toBe(sb.list()[0]?.status)
        }
      }),
      { numRuns: 500 }
    )
  })
})
