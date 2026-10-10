/**
 * The CriticMarkup codec (writing-harness B8): the three Obsidian encodings
 * import into threads over the de-marked text, the export form round-trips.
 */
import { describe, expect, it } from 'vitest'
import { exportCriticMarkup, importCriticMarkup, reviewCopyName } from '../src/criticmarkup.js'
import { findQuote, type ThreadRecord } from '../src/threads.js'

function ids(): () => string {
  let n = 0
  return () => `id${++n}`
}

const opts = () => ({ path: 'notes/plan.md', newId: ids(), now: 42 })

describe('importCriticMarkup', () => {
  it('reads Review Comments: id|author|date|TYPE: comment, and replies after it', () => {
    const md = 'Intro. {==The plan==}{>>c1|Ana|2026-09-01|COMMENT: too vague<<}{>>c2|Ben|2026-09-02|QUESTION: why?<<} ends.'
    const { text, threads } = importCriticMarkup(md, opts())
    expect(text).toBe('Intro. The plan ends.')
    expect(threads).toHaveLength(1)
    const [t] = threads
    expect(t).toMatchObject({ id: 'c1', path: 'notes/plan.md', author: 'Ana', created: Date.parse('2026-09-01'), resolved: false })
    expect(t.comments.map((c) => [c.author, c.body])).toEqual([
      ['Ana', 'too vague'],
      ['Ben', 'why?'],
    ])
    expect(t.anchor.quote).toEqual({ exact: 'The plan', prefix: 'Intro. ', suffix: ' ends.' })
  })

  it('reads Relay Comments: {{authorId="…" author="Name">>text<<}}', () => {
    const md = 'A {==passage==}{{authorId="u-7" author="Cleo">>tighten this<<}} here.'
    const { text, threads } = importCriticMarkup(md, opts())
    expect(text).toBe('A passage here.')
    expect(threads[0].comments[0]).toMatchObject({ author: 'Cleo', body: 'tighten this', at: 42 })
    expect(threads[0].anchor.quote.exact).toBe('passage')
  })

  it('falls back to the Relay authorId when no name is given', () => {
    const { threads } = importCriticMarkup('{==x==}{{authorId="u-7">>y<<}}', opts())
    expect(threads[0].author).toBe('u-7')
  })

  it('reads Track Changes: author="…" date="…" prefixes', () => {
    const md = 'See {==this line==}{>>author="Dee" date="2026-09-23T10:00:00Z" Needs a source.<<}.'
    const { text, threads } = importCriticMarkup(md, opts())
    expect(text).toBe('See this line.')
    expect(threads[0].comments[0]).toMatchObject({ author: 'Dee', at: Date.parse('2026-09-23T10:00:00Z'), body: 'Needs a source.' })
  })

  it('reads a bare comment as a thread on a point, and a plain body with the default author', () => {
    const { text, threads } = importCriticMarkup('One two{>>a note<<} three.', { ...opts(), defaultAuthor: 'Import' })
    expect(text).toBe('One two three.')
    expect(threads[0].anchor.quote).toMatchObject({ exact: '', prefix: 'One two', suffix: ' three.' })
    expect(threads[0].comments[0]).toMatchObject({ author: 'Import', body: 'a note' })
    expect(findQuote(text, threads[0].anchor.quote)).toEqual({ from: 7, to: 7 })
  })

  it('leaves a bare highlight and the edit marks alone — they are not comments', () => {
    const md = 'Keep {==this==} and {++that++} and {--those--} {~~a~>b~~}.'
    const { text, threads } = importCriticMarkup(md, opts())
    expect(text).toBe(md)
    expect(threads).toEqual([])
  })

  it('anchors each thread against the FINAL text, after every other mark is removed', () => {
    const md = '{==a==}{>>x|2026-01-01T00:00:00.000Z: one<<} b {==c==}{>>y|2026-01-02T00:00:00.000Z: two<<}'
    const { text, threads } = importCriticMarkup(md, opts())
    expect(text).toBe('a b c')
    expect(threads.map((t) => findQuote(text, t.anchor.quote))).toEqual([
      { from: 0, to: 1 },
      { from: 4, to: 5 },
    ])
  })
})

describe('exportCriticMarkup', () => {
  const thread = (over: Partial<ThreadRecord>): ThreadRecord => ({
    id: 't',
    path: 'n.md',
    author: 'Ana',
    created: Date.parse('2026-10-10T09:00:00.000Z'),
    resolved: false,
    anchor: { quote: { exact: 'plan', prefix: 'The ', suffix: ' is' } },
    comments: [{ id: 'c', author: 'Ana', at: Date.parse('2026-10-10T09:00:00.000Z'), body: 'vague' }],
    ...over,
  })

  it('writes {==passage==}{>>author|date: body<<} per comment', () => {
    const t = thread({
      comments: [
        { id: 'c1', author: 'Ana', at: Date.parse('2026-10-10T09:00:00.000Z'), body: 'vague' },
        { id: 'c2', author: 'Claude', at: Date.parse('2026-10-10T09:01:00.000Z'), body: 'a | b: c' },
      ],
    })
    const { text, skipped } = exportCriticMarkup('The plan is set.', [t])
    expect(text).toBe(
      'The {==plan==}{>>Ana|2026-10-10T09:00:00.000Z: vague<<}{>>Claude|2026-10-10T09:01:00.000Z: a | b: c<<} is set.'
    )
    expect(skipped).toEqual([])
  })

  it('round-trips: export then import gives back the text, the quotes and the comments', () => {
    const original = 'The plan is set. Then the plan changes.'
    const threads = [
      thread({ id: 'a', anchor: { quote: { exact: 'plan', prefix: 'The ', suffix: ' is set' } } }),
      thread({
        id: 'b',
        author: 'Ben',
        anchor: { quote: { exact: 'the plan changes', prefix: 'Then ', suffix: '.' } },
        comments: [{ id: 'x', author: 'Ben', at: Date.parse('2026-10-11T00:00:00.000Z'), body: 'Why | how?' }],
      }),
    ]
    const exported = exportCriticMarkup(original, threads)
    const back = importCriticMarkup(exported.text, opts())
    expect(back.text).toBe(original)
    expect(back.threads.map((t) => [t.author, t.anchor.quote.exact, findQuote(original, t.anchor.quote)])).toEqual([
      ['Ana', 'plan', { from: 4, to: 8 }],
      ['Ben', 'the plan changes', { from: 22, to: 38 }],
    ])
    expect(back.threads.map((t) => t.comments.map((c) => [c.author, c.at, c.body]))).toEqual(
      threads.map((t) => t.comments.map((c) => [c.author, c.at, c.body]))
    )
  })

  it('round-trips each Obsidian encoding through import → export → import', () => {
    for (const md of [
      'X {==y==}{>>c1|Ana|2026-09-01|COMMENT: z<<} w',
      'X {==y==}{{authorId="u" author="Ana">>z<<}} w',
      'X {==y==}{>>author="Ana" date="2026-09-01T00:00:00Z" z<<} w',
    ]) {
      const once = importCriticMarkup(md, opts())
      const twice = importCriticMarkup(exportCriticMarkup(once.text, once.threads).text, opts())
      expect(twice.text).toBe(once.text)
      expect(twice.threads.map((t) => [t.anchor.quote, t.comments.map((c) => [c.author, c.at, c.body])])).toEqual(
        once.threads.map((t) => [t.anchor.quote, t.comments.map((c) => [c.author, c.at, c.body])])
      )
    }
  })

  it('skips resolved threads unless asked, a vanished passage, and an overlap', () => {
    const text = 'alpha beta gamma'
    const { text: out, skipped } = exportCriticMarkup(text, [
      thread({ id: 'r', resolved: true, anchor: { quote: { exact: 'alpha', prefix: '', suffix: '' } } }),
      thread({ id: 'gone', anchor: { quote: { exact: 'delta', prefix: '', suffix: '' } } }),
      thread({ id: 'one', anchor: { quote: { exact: 'beta gamma', prefix: '', suffix: '' } } }),
      thread({ id: 'two', anchor: { quote: { exact: 'gamma', prefix: '', suffix: '' } } }),
    ])
    expect(out).toBe('alpha {==beta gamma==}{>>Ana|2026-10-10T09:00:00.000Z: vague<<}')
    expect(skipped.sort()).toEqual(['gone', 'two'])
    const all = exportCriticMarkup(text, [thread({ id: 'r', resolved: true, anchor: { quote: { exact: 'alpha', prefix: '', suffix: '' } } })], {
      includeResolved: true,
    })
    expect(all.text.startsWith('{==alpha==}')).toBe(true)
  })
})

describe('reviewCopyName', () => {
  it('names the copy beside the note, never the note', () => {
    expect(reviewCopyName('notes/plan.md')).toBe('plan (review).md')
    expect(reviewCopyName('Plan.MD')).toBe('Plan (review).md')
    expect(reviewCopyName('readme')).toBe('readme (review).md')
  })
})
