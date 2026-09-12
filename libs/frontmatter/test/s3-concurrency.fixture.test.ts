/**
 * SPIKE S3 — frontmatter concurrent-edit safety (shaping.md Spike S3, D2e).
 *
 * `read-shaping.md` B4.1 answers S3 on paper: because every writer edits only
 * the flat subset, and only ONE line-range per op, two concurrent patches on
 * different keys commute as text edits, two on the same key converge to
 * whichever value the CRDT orders last, and anything else degrades to Source
 * with a badge rather than to corruption. This fixture is what makes that
 * answer true rather than plausible.
 *
 * S3's acceptance: "a frontmatter edit policy validated by a fuzz fixture
 * interleaving Editor, agent, and Obsidian-shaped writers with no churn diffs
 * and no invalid YAML". The three writers here are the widget (`set` on one
 * value), the CLI/agent (`fm set/unset`, i.e. any op) and Obsidian (a
 * whole-block rewrite arriving from disk).
 *
 * S3-Q1 ("does the CST support single-key edits with byte-identical untouched
 * lines") and S3-Q2 ("can two concurrent edits converge to invalid YAML, and
 * does that force an atomic region") are answered below. S3-Q3 has a named,
 * skipped slot at the bottom — it needs a five-minute experiment on a scratch
 * vault, not a property test.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter, patchFrontmatter, type FmChange, type FmOp } from '../src/index.js'
import {
  applyChanges,
  BODIES,
  docOf,
  expectUntouchedLines,
  OBSIDIAN_BLOCKS,
  VAULT_BLOCKS,
} from './corpus.js'

/** Per-PR budget (testing skill): bounded runs here, depth at nightly. */
const RUNS = 300

const KEYS = ['tags', 'status', 'type', 'milestone', 'due-date', 'aliases', 'title', 'new-key']
const SCALARS = ['', 'Todo', 'Done', '2026-09-12', 'builder round 2 testing', 'true', '1.50', '#ccc', 'a: b']
const ITEMS = ['a', 'b', 'composition', 'testing', 'two words', 'Alt Name']

const opArb: fc.Arbitrary<FmOp> = fc.oneof(
  fc.record({
    op: fc.constant('set' as const),
    key: fc.constantFrom(...KEYS),
    value: fc.oneof(
      fc.constantFrom(...SCALARS),
      fc.array(fc.constantFrom(...ITEMS), { maxLength: 3 })
    ),
  }),
  fc.record({ op: fc.constant('remove' as const), key: fc.constantFrom(...KEYS) }),
  fc.record({
    op: fc.constant('rename' as const),
    key: fc.constantFrom(...KEYS),
    to: fc.constantFrom(...KEYS),
  })
)

const BLOCKS = [...VAULT_BLOCKS, ...OBSIDIAN_BLOCKS].map((b) => b.block)
const docArb = fc
  .tuple(fc.constantFrom(...BLOCKS), fc.constantFrom(...BODIES))
  .map(([block, body]) => docOf(block, body))

/** A scalar `set`, the only op two writers can aim at the same bytes. */
const scalarSetArb = fc.record({
  op: fc.constant('set' as const),
  key: fc.constantFrom(...KEYS),
  value: fc.constantFrom(...SCALARS),
})

/** What the widget and the index see — the whole state the UI derives from. */
function classify(text: string): ReturnType<typeof parseFrontmatter> {
  const fm = parseFrontmatter(text)
  // The reader is total: every string gets a verdict, and an unsupported one
  // always says why. That is what lets the strip degrade instead of guessing.
  expect(typeof fm.present).toBe('boolean')
  if (!fm.supported) expect(fm.reason).toBeTruthy()
  return fm
}

describe('S3 — writers interleaved through the CRDT', () => {
  it('every step leaves valid YAML, an untouched body, and no line that moved on its own', () => {
    fc.assert(
      fc.property(docArb, fc.array(opArb, { minLength: 1, maxLength: 10 }), (doc, ops) => {
        let text = doc
        const body = text.slice(parseFrontmatter(text).end)
        for (const op of ops) {
          const before = text
          const result = patchFrontmatter(before, op)
          if (!result.ok) {
            // A refusal changes nothing at all — that is the whole point of it.
            expect(['missing-key', 'duplicate-key', 'invalid-key', 'multiline']).toContain(
              result.reason
            )
            continue
          }
          expect(result.changes.length).toBeLessThanOrEqual(1)
          expect(applyChanges(before, result.changes)).toBe(result.text)
          for (const change of result.changes) expectUntouchedLines(before, result.text, change)
          const fm = classify(result.text)
          expect(fm.supported).toBe(true)
          expect(result.text.slice(fm.end)).toBe(body)
          text = result.text
        }
      }),
      { numRuns: RUNS }
    )
  })

  it('replaying an op produces no churn — the second time it is already done', () => {
    fc.assert(
      fc.property(docArb, opArb, (doc, op) => {
        const first = patchFrontmatter(doc, op)
        if (!first.ok || op.op === 'rename') return
        const again = patchFrontmatter(first.text, op)
        expect(again).toEqual({ ok: true, text: first.text, changes: [] })
      }),
      { numRuns: RUNS }
    )
  })
})

describe('S3-Q2 — two writers, one document', () => {
  it('patches on DIFFERENT keys commute: both land, in either order', () => {
    fc.assert(
      fc.property(docArb, scalarSetArb, scalarSetArb, (doc, a, b) => {
        if (a.key === b.key) return
        const ra = patchFrontmatter(doc, a)
        const rb = patchFrontmatter(doc, b)
        if (!ra.ok || !rb.ok) return
        if (overlaps(ra.changes, rb.changes)) return // different keys, same line: an insert point
        // Both change sets are computed against the SAME base, which is what
        // concurrency means; applying them together is what the CRDT does.
        const merged = applyChanges(doc, [...ra.changes, ...rb.changes])
        const fm = classify(merged)
        expect(fm.supported).toBe(true)
        expect(valueOf(fm, a.key)).toEqual(a.value)
        expect(valueOf(fm, b.key)).toEqual(b.value)
      }),
      { numRuns: RUNS }
    )
  })

  it('patches on the SAME key converge to one of the two values, still valid', () => {
    fc.assert(
      fc.property(docArb, scalarSetArb, fc.constantFrom(...SCALARS), (doc, a, second) => {
        const ra = patchFrontmatter(doc, a)
        const rb = patchFrontmatter(doc, { ...a, value: second })
        if (!ra.ok || !rb.ok) return
        // Last writer wins at the range level — the ordering the CRDT picks.
        for (const winner of [ra, rb]) {
          const fm = classify(winner.text)
          expect(fm.supported).toBe(true)
        }
        expect([a.value, second]).toContainEqual(valueOf(classify(rb.text), a.key))
      }),
      { numRuns: RUNS }
    )
  })

  it('even a character-level interleaving of the two inserts stays classifiable', () => {
    // The adversarial case B4.1 concedes: a CRDT may keep BOTH inserts when
    // two writers aim at the same range, so the value reads as one string, or
    // — when both writers ADD the same missing key — as a duplicate key. The
    // guarantee is not that the result parses; it is that the reader always
    // says which, and the patcher then refuses rather than writing into a
    // block it cannot read (R4.4). Measured over this corpus, most same-key
    // collisions land unsupported and every one of them is refused.
    fc.assert(
      fc.property(docArb, scalarSetArb, fc.constantFrom(...SCALARS), (doc, a, second) => {
        const ra = patchFrontmatter(doc, a)
        const rb = patchFrontmatter(doc, { ...a, value: second })
        if (!ra.ok || !rb.ok || !ra.changes.length || !rb.changes.length) return
        const [ca] = ra.changes
        const [cb] = rb.changes
        if (ca.from !== cb.from || ca.to !== cb.to) return
        const both = doc.slice(0, ca.from) + ca.insert + cb.insert + doc.slice(ca.to)
        const fm = classify(both)
        const retry = patchFrontmatter(both, { ...a, value: 'Recovered' })
        if (fm.supported) expect(retry.ok).toBe(true)
        else expect(retry).toEqual({ ok: false, reason: fm.reason })
      }),
      { numRuns: RUNS }
    )
  })
})

describe('S3 — an Obsidian-shaped whole-block rewrite arrives from disk', () => {
  it('the patcher keeps working on the rewritten block, and nothing else moves', () => {
    fc.assert(
      fc.property(
        docArb,
        fc.constantFrom(...OBSIDIAN_BLOCKS.map((b) => b.block)),
        opArb,
        (doc, rewritten, op) => {
          const fm = parseFrontmatter(doc)
          if (!fm.present) return
          // Obsidian rewrites the WHOLE block (key order, quoting, list style)
          // and the reconciler lands it as one text edit over those lines.
          const change: FmChange = { from: 4, to: fm.end - 4, insert: rewritten }
          const after = applyChanges(doc, [change])
          const reread = classify(after)
          expect(reread.supported).toBe(true)
          expect(after.slice(reread.end)).toBe(doc.slice(fm.end))
          const result = patchFrontmatter(after, op)
          if (result.ok) expect(classify(result.text).supported).toBe(true)
        }
      ),
      { numRuns: RUNS }
    )
  })
})

describe('S3-Q3 — what Obsidian\'s Properties UI rewrites', () => {
  // The last open question of the spike: the exact shapes Obsidian writes when
  // it touches a block (key order, quoting, date handling, list style), so the
  // stale-echo detector (D2d) can whitelist them. It is answered by a
  // five-minute experiment on a scratch vault — open a note in Obsidian, edit
  // one property, diff the file — not by a property test, which can only
  // explore shapes we already thought of. When Chris runs it, the observed
  // before/after pairs go in OBSIDIAN_BLOCKS and this test asserts the
  // patcher's output round-trips through them.
  it.skip('round-trips the shapes Obsidian actually writes (needs the scratch-vault experiment)', () => {
    expect.unreachable('S3-Q3 pending: see read-shaping.md B4.1')
  })
})

function overlaps(a: FmChange[], b: FmChange[]): boolean {
  return a.some((x) => b.some((y) => x.from < y.to && y.from < x.to)) || sameInsertPoint(a, b)
}

/** Two inserts at the same offset are not disjoint edits; a CRDT orders them. */
function sameInsertPoint(a: FmChange[], b: FmChange[]): boolean {
  return a.some((x) => b.some((y) => x.from === y.from && x.to === y.to))
}

function valueOf(fm: ReturnType<typeof parseFrontmatter>, key: string): string | string[] | undefined {
  return fm.entries.find((e) => e.key === key)?.value
}
