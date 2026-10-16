/**
 * THE RANKING REGRESSION TEST (agent-surface-shaping A10, R5).
 *
 * "For an unambiguous query the note the user means is the first result" is a
 * requirement, not a preference, and the way it stops being true is a weight
 * someone nudged. So it is asserted here against a corpus shaped like the
 * measured vault (test/fixtures/ranking-corpus.ts), and again against the real
 * vault in bench/run-bench.test.ts under EDITOR_BENCH_VAULT.
 *
 * Each probe below is a measured failure of the pre-tier ranking. Before this
 * pass, 1 of the 7 put the right note first on the real vault.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { MemoryIndex } from '../src/memory-index.js'
import { CORPUS_PROBES, rankingCorpus } from './fixtures/ranking-corpus.js'

let index: MemoryIndex

beforeAll(() => {
  index = new MemoryIndex()
  index.rebuild(rankingCorpus())
})

describe('ranking corpus — tiers', () => {
  for (const { query, expect: wanted } of CORPUS_PROBES) {
    it(`puts the note MEANT first for "${query}"`, async () => {
      const { items } = await index.search(query, { limit: 5 })
      expect(items[0]?.path, items.map((h) => `${h.tier} ${h.path}`).join(' | ')).toBe(wanted)
      expect(items[0].tier).toBe('title')
    })
  }

  it('labels the three tiers so the palette and the CLI can show why', async () => {
    const { items } = await index.search('JSON', { limit: 20 })
    const tiers = new Map(items.map((h) => [h.path, h.tier]))
    expect(tiers.get('Areas/CS/JSON.md')).toBe('title')
    // Every query term is in the path, but the note is not CALLED that.
    expect(tiers.get('Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md')).toBe('path')
    // Tier is the first sort key: no body hit may precede a path hit.
    const ranks = { title: 0, path: 1, body: 2 }
    const seq = items.map((h) => ranks[h.tier])
    expect([...seq].sort((a, b) => a - b)).toEqual(seq)
  })

  it('does not claim a title tier for a prefix still being typed', async () => {
    // `svel` is not the name of anything yet; ranking falls back to the body
    // tier, exactly as it did before tiers existed.
    const { items } = await index.search('svel', { limit: 5 })
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((h) => h.tier !== 'title')).toBe(true)
  })

  it('breaks a tier tie with recency and never across tiers', async () => {
    const cold = await index.search('Writing', { limit: 5 })
    expect(cold.items[0].path).toBe('TODO/Writing.md')
    // A recently opened body-tier note must NOT jump over the title tier.
    const warm = await index.search('Writing', {
      limit: 5,
      recent: ['Areas/Writing/Berlin Itinerary.md'],
    })
    expect(warm.items[0].path).toBe('TODO/Writing.md')
  })
})

describe('ranking corpus — noise exclusion', () => {
  it('keeps a 60 KB URL dump out of the results for HTML', async () => {
    // 40 "html" mentions, every one inside a URL. This is the measured case:
    // `Areas/Life/Music.md`, 64 KB, 39 matches, all in links.
    const { items } = await index.search('HTML', { limit: 10 })
    expect(items.map((h) => h.path)).not.toContain('Areas/Life/Music.md')
  })

  it('ignores a term that only appears inside a fenced code block', async () => {
    const { items } = await index.search('Testing', { limit: 20 })
    expect(items.map((h) => h.path)).not.toContain('Areas/CS/Vitest Fixtures.md')
  })

  it('still indexes inline code, which is written in sentences', async () => {
    index.upsert({ guid: 'g-inline', path: 'Notes/Inline.md', text: 'use `zephyrine` here' })
    const { items } = await index.search('zephyrine')
    expect(items.map((h) => h.path)).toContain('Notes/Inline.md')
  })

  it('blanks noise WITHOUT shifting any offset', async () => {
    // The blanking is done with spaces precisely so spans and snippets keep
    // indexing into the raw text. A shifted offset would highlight the wrong
    // characters and land the caret in the wrong place on Enter.
    index.upsert({
      guid: 'g-offset',
      path: 'Notes/Offsets.md',
      text: '[see](https://example.invalid/html/x) then zephyrine appears.',
    })
    const [hit] = (await index.search('zephyrine')).items.filter(
      (h) => h.path === 'Notes/Offsets.md'
    )
    const span = hit.spans[0]
    expect(hit.snippets.length).toBeGreaterThan(0)
    expect('[see](https://example.invalid/html/x) then zephyrine appears.'.slice(
      span.from,
      span.to
    )).toBe('zephyrine')
  })
})

describe('ranking corpus — phrase bonus', () => {
  it('prefers the note where a two-word query is adjacent and in order', async () => {
    const { items } = await index.search('memory layout', { limit: 5, explain: true })
    expect(items[0].path).toBe('Notes/Phrase Adjacent.md')
    expect(items[0].explain?.some((r) => r.field === 'phrase')).toBe(true)
    const apart = items.find((h) => h.path === 'Notes/Phrase Apart.md')
    expect(apart?.explain?.some((r) => r.field === 'phrase')).toBe(false)
  })

  it('awards no phrase bonus for a single-term query', async () => {
    const { items } = await index.search('memory', { limit: 5, explain: true })
    expect(items.every((h) => !h.explain?.some((r) => r.field === 'phrase'))).toBe(true)
  })
})

describe('ranking corpus — grep finds what ranking excludes', () => {
  it('finds a term that only exists inside URLs', async () => {
    const ranked = await index.search('HTML', { limit: 50 })
    expect(ranked.items.map((h) => h.path)).not.toContain('Areas/Life/Music.md')

    const grepped = await index.grep('html', { pathPrefix: 'Areas/Life/', limit: 100 })
    expect(grepped.items.length).toBe(40)
    expect(grepped.items.every((h) => h.path === 'Areas/Life/Music.md')).toBe(true)
    for (const hit of grepped.items) {
      for (const span of hit.spans) {
        expect(hit.lineText.slice(span.from, span.to).toLowerCase()).toBe('html')
      }
    }
  })

  it('finds a term that only exists inside a fenced code block', async () => {
    const { total } = await index.grep('testing', { pathPrefix: 'Areas/CS/Vitest' })
    expect(total).toBe(60)
  })
})
