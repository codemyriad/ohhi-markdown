/**
 * THE BACKEND CONFORMANCE SUITE.
 *
 * plans/v2-shaping.md Fork 1 defers the sqlite-wasm/rusqlite index behind a
 * measured trigger, and the honest risk it records is that "temporary"
 * becomes permanent by neglect. This suite is the mitigation: it is written
 * against the CONTRACT (types.ts), not against MemoryIndex, so a future
 * backend passes it or is not a valid backend.
 *
 * Call it with a factory:
 *
 *   describeIndexConformance('MemoryIndex', () => new MemoryIndex())
 *
 * Every assertion here is a property a caller is allowed to rely on. If a
 * future backend cannot satisfy one, the fix is to change the contract and
 * the callers in the same change — not to weaken the test.
 */
import { describe, expect, it } from 'vitest'
import type { IndexDoc, WritableIndex } from '../src/types.js'

export interface IndexFactory {
  (): WritableIndex
}

const DOCS: IndexDoc[] = [
  {
    guid: 'g-systems',
    path: 'Areas/CS/Systems Programming.md',
    text: [
      '---',
      'tags: [cs]',
      'status: active',
      '---',
      '# Systems Programming',
      '',
      'Memory layout and the stack. See [[Memory Layout]] and [[Missing Note]].',
      '',
      '## Virtual memory',
      '',
      'Paging, the TLB, and #os/memory notes.',
      '',
      '```sh',
      '# not a heading, and [[Not A Link]] either',
      'grep -r memory .',
      '```',
    ].join('\n'),
  },
  {
    guid: 'g-layout',
    path: 'Areas/CS/Memory Layout.md',
    text: [
      '# Memory Layout',
      '',
      'Heap, stack, and the data segment. Back to [[Systems Programming|systems]].',
      '',
      'Também vale para o `não` caso — memória virtual.',
    ].join('\n'),
  },
  {
    guid: 'g-index',
    path: 'TODO/Dev learning __index.md',
    text: [
      '# Dev learning',
      '',
      '- [[Systems Programming]]',
      '- [[Memory Layout#Heap]]',
      '- [[Edible Inbox]]',
      '',
      '#index',
    ].join('\n'),
  },
  {
    guid: 'g-daily',
    path: 'Daily/2-9-2026.md',
    text: '中文分词测试 and a note about memory.',
  },
]

export function describeIndexConformance(name: string, make: IndexFactory): void {
  const build = (): WritableIndex => {
    const index = make()
    index.rebuild(DOCS)
    return index
  }

  describe(`${name} — index contract`, () => {
    describe('shape', () => {
      it('reports a schema version so droppability is contractual', async () => {
        const index = build()
        expect(index.schemaVersion).toBeGreaterThan(0)
        expect((await index.stats()).schemaVersion).toBe(index.schemaVersion)
      })

      it('returns promises from every query, even when it could answer synchronously', () => {
        const index = build()
        expect(index.search('memory')).toBeInstanceOf(Promise)
        expect(index.quickOpen('mem')).toBeInstanceOf(Promise)
        expect(index.backlinks('Memory Layout')).toBeInstanceOf(Promise)
        expect(index.resolve('Memory Layout')).toBeInstanceOf(Promise)
      })

      it('is empty and answers cleanly before anything is written', async () => {
        const index = make()
        const hits = await index.search('anything')
        expect(hits.items).toEqual([])
        expect(hits.nextCursor).toBeNull()
        expect(await index.resolve('Nothing')).toBeNull()
        expect((await index.stats()).docs).toBe(0)
      })
    })

    describe('paging', () => {
      it('honours limit and never silently returns more', async () => {
        const index = build()
        const page = await index.quickOpen('m', { limit: 2 })
        expect(page.items.length).toBeLessThanOrEqual(2)
        expect(page.nextCursor).not.toBeNull()
      })

      it('walks every result exactly once across pages', async () => {
        const index = build()
        const seen: string[] = []
        let cursor: string | null = null
        for (let guard = 0; guard < 20; guard++) {
          const page: Awaited<ReturnType<WritableIndex['quickOpen']>> = await index.quickOpen('', {
            limit: 1,
            cursor: cursor ?? undefined,
          })
          seen.push(...page.items.map((i) => i.path))
          cursor = page.nextCursor
          if (!cursor) break
        }
        expect(seen.length).toBe(DOCS.length)
        expect(new Set(seen).size).toBe(DOCS.length)
      })

      it('reports a total independent of the page size', async () => {
        const index = build()
        const small = await index.quickOpen('', { limit: 1 })
        const big = await index.quickOpen('', { limit: 100 })
        expect(small.total).toBe(big.total)
      })

      it('treats a foreign cursor as the start rather than throwing', async () => {
        const index = build()
        const page = await index.search('memory', { cursor: 'not-a-cursor' })
        expect(page.items.length).toBeGreaterThan(0)
      })
    })

    describe('search', () => {
      it('finds a term and ranks the more relevant note first', async () => {
        const index = build()
        const { items } = await index.search('memory')
        expect(items.length).toBeGreaterThanOrEqual(2)
        expect(items[0].path).toBe('Areas/CS/Memory Layout.md')
      })

      it('scores are descending and comparable within a result set', async () => {
        const index = build()
        const { items } = await index.search('memory')
        for (let i = 1; i < items.length; i++) {
          expect(items[i - 1].score).toBeGreaterThanOrEqual(items[i].score)
        }
      })

      it('matches a prefix, so results appear while typing', async () => {
        const index = build()
        const { items } = await index.search('progr')
        expect(items.map((i) => i.path)).toContain('Areas/CS/Systems Programming.md')
      })

      it('folds diacritics — nao finds não', async () => {
        const index = build()
        const { items } = await index.search('nao')
        expect(items.map((i) => i.path)).toContain('Areas/CS/Memory Layout.md')
      })

      it('segments CJK so a single character finds the note', async () => {
        const index = build()
        const { items } = await index.search('分词')
        expect(items.map((i) => i.path)).toContain('Daily/2-9-2026.md')
      })

      it('returns spans and snippets a results list can render', async () => {
        const index = build()
        const [hit] = (await index.search('paging')).items
        expect(hit).toBeDefined()
        expect(hit.spans.length).toBeGreaterThan(0)
        expect(hit.snippets.length).toBeGreaterThan(0)
        const snippet = hit.snippets[0]
        for (const span of snippet.spans) {
          expect(span.from).toBeGreaterThanOrEqual(0)
          expect(span.to).toBeLessThanOrEqual(snippet.text.length)
        }
      })

      it('filters by tag: and path: prefixes', async () => {
        const index = build()
        const tagged = await index.search('tag:#index')
        expect(tagged.items.map((i) => i.path)).toEqual(['TODO/Dev learning __index.md'])
        const scoped = await index.search('path:Areas/ memory')
        expect(scoped.items.every((i) => i.path.startsWith('Areas/'))).toBe(true)
      })

      it('finds a note by its filename even when the body never says it', async () => {
        const index = build()
        const { items } = await index.search('daily')
        expect(items.map((i) => i.path)).toContain('Daily/2-9-2026.md')
      })
    })

    /**
     * Ranking STRUCTURE (plans/agent-surface-shaping.md A10, Fork 3-B). The
     * measured vault has hundreds of one-generic-noun filenames whose own word
     * is also its most frequent body term, so "the note called X" can only win
     * by a tier — a weight is always one more mention from being wrong. A
     * backend that answers `search` must compute the tier; it is a pure
     * function of the query and the path, so bm25() alone is not an excuse.
     */
    describe('tiers', () => {
      it('labels every hit with the field that earned it its place', async () => {
        const index = build()
        const { items } = await index.search('memory')
        expect(items.length).toBeGreaterThan(0)
        for (const hit of items) expect(['title', 'path', 'body']).toContain(hit.tier)
      })

      it('puts the note NAMED by the query first, even with no body mention', async () => {
        const index = make()
        index.rebuild([
          // The measured `Docs` case: the note called it says it zero times,
          // and a much larger note says it constantly.
          { guid: 'a', path: 'Edible/Docs.md', text: '# Product writing\n\nHandbook and guides.' },
          {
            guid: 'b',
            path: 'Areas/CS/Electron.md',
            text: Array.from({ length: 40 }, (_, i) => `line ${i} about docs and more docs`).join('\n'),
          },
        ])
        const { items } = await index.search('docs')
        expect(items[0].path).toBe('Edible/Docs.md')
        expect(items[0].tier).toBe('title')
      })

      it('orders tier BEFORE score — no body hit precedes a path hit', async () => {
        const index = build()
        const { items } = await index.search('memory')
        const rank = { title: 0, path: 1, body: 2 }
        const seq = items.map((i) => rank[i.tier])
        expect([...seq].sort((a, b) => a - b)).toEqual(seq)
      })

      it('lets recency break a tie inside a tier and never across one', async () => {
        const index = make()
        index.rebuild([
          { guid: 'a', path: 'Notes/topic one.md', text: 'zephyrine' },
          { guid: 'b', path: 'Notes/topic two.md', text: 'zephyrine' },
          { guid: 'c', path: 'Notes/Zephyrine.md', text: 'nothing to say' },
        ])
        const cold = await index.search('zephyrine')
        expect(cold.items[0].path).toBe('Notes/Zephyrine.md')
        const warm = await index.search('zephyrine', { recent: ['Notes/topic two.md'] })
        // The title tier still wins; recency only reorders the two body hits.
        expect(warm.items[0].path).toBe('Notes/Zephyrine.md')
        expect(warm.items[1].path).toBe('Notes/topic two.md')
      })
    })

    /**
     * Noise exclusion. URL text, markdown link targets and fenced code are not
     * prose and must never outrank it — but nothing may become UNFINDABLE, so
     * `grep` below reads the raw text.
     */
    describe('what ranking refuses to count', () => {
      it('does not rank a term that only appears inside a URL', async () => {
        const index = make()
        index.rebuild([
          {
            guid: 'dump',
            path: 'Areas/Life/Music.md',
            text: Array.from(
              { length: 30 },
              (_, i) => `- [album ${i}](https://example.invalid/html/album-${i}.html)`
            ).join('\n'),
          },
          { guid: 'real', path: 'Areas/CS/Notes.md', text: 'a sentence about html parsing' },
        ])
        const { items } = await index.search('html')
        expect(items.map((i) => i.path)).toEqual(['Areas/CS/Notes.md'])
      })

      it('does not rank a term that only appears inside a fenced code block', async () => {
        const index = make()
        index.rebuild([
          { guid: 'fenced', path: 'a.md', text: '# A\n\n```\nzephyrine zephyrine\n```\n' },
        ])
        expect((await index.search('zephyrine')).items).toEqual([])
      })

      it('still ranks inline code, which is written in sentences', async () => {
        const index = make()
        index.rebuild([{ guid: 'inline', path: 'a.md', text: 'call `zephyrine` first' }])
        expect((await index.search('zephyrine')).items.map((i) => i.path)).toEqual(['a.md'])
      })

      it('keeps every offset valid — blanking must not shift positions', async () => {
        const index = make()
        const text = '[x](https://example.invalid/html) and zephyrine here'
        index.rebuild([{ guid: 'a', path: 'a.md', text }])
        const [hit] = (await index.search('zephyrine')).items
        expect(text.slice(hit.spans[0].from, hit.spans[0].to)).toBe('zephyrine')
      })
    })

    describe('explain', () => {
      it('is absent unless asked for — it costs a pass per hit', async () => {
        const index = build()
        const [hit] = (await index.search('memory')).items
        expect(hit.explain).toBeUndefined()
      })

      it('reports one row per (term, field) whose contributions sum to the score', async () => {
        const index = build()
        const [hit] = (await index.search('memory', { explain: true })).items
        expect(hit.explain).toBeDefined()
        expect(hit.explain!.length).toBeGreaterThan(0)
        for (const row of hit.explain!) {
          expect(typeof row.term).toBe('string')
          expect(['body', 'title', 'heading', 'phrase']).toContain(row.field)
        }
        const sum = hit.explain!.reduce((n, r) => n + r.contribution, 0)
        expect(sum).toBeCloseTo(hit.score, 6)
      })

      it('names the phrase bonus when a multi-term query is adjacent and in order', async () => {
        const index = make()
        index.rebuild([
          { guid: 'a', path: 'a.md', text: 'the zephyrine cascade is documented here' },
          { guid: 'b', path: 'b.md', text: 'zephyrine alone. and a cascade, elsewhere.' },
        ])
        const { items } = await index.search('zephyrine cascade', { explain: true })
        expect(items[0].path).toBe('a.md')
        expect(items[0].explain!.some((r) => r.field === 'phrase')).toBe(true)
        expect(items[1].explain!.some((r) => r.field === 'phrase')).toBe(false)
      })
    })

    /**
     * `grep` — unranked, document order, over the RAW text. It is the contract's
     * honesty clause: ranking hides URL text and fenced code, so there has to be
     * one call that hides nothing.
     */
    describe('grep', () => {
      it('returns a promise and a paged result like every other query', async () => {
        const index = build()
        expect(index.grep('memory')).toBeInstanceOf(Promise)
        const page = await index.grep('memory', { limit: 1 })
        expect(page.items.length).toBeLessThanOrEqual(1)
        expect(page.total).toBeGreaterThan(1)
        expect(page.nextCursor).not.toBeNull()
      })

      it('matches case-insensitively by default and exactly when asked', async () => {
        const index = make()
        index.rebuild([{ guid: 'a', path: 'a.md', text: 'Memory and memory' }])
        expect((await index.grep('memory')).total).toBe(1)
        const [hit] = (await index.grep('memory')).items
        expect(hit.spans.length).toBe(2)
        const [strict] = (await index.grep('Memory', { caseSensitive: true })).items
        expect(strict.spans.length).toBe(1)
      })

      it('treats the pattern as literal text unless regex is asked for', async () => {
        const index = make()
        index.rebuild([{ guid: 'a', path: 'a.md', text: 'a.b and axb' }])
        expect((await index.grep('a.b')).total).toBe(1)
        expect((await index.grep('a.b', { regex: true })).items[0].spans.length).toBe(2)
      })

      it('reports a line number and the whole line, with spans relative to it', async () => {
        const index = build()
        const [hit] = (await index.grep('TLB')).items
        expect(hit.line).toBeGreaterThan(1)
        expect(hit.lineText).toContain('TLB')
        expect(hit.lineText.slice(hit.spans[0].from, hit.spans[0].to)).toBe('TLB')
      })

      it('returns document order — by path, then by line', async () => {
        const index = build()
        const { items } = await index.grep('memory', { limit: 100 })
        for (let i = 1; i < items.length; i++) {
          const prev = items[i - 1]
          const cur = items[i]
          expect(prev.path < cur.path || (prev.path === cur.path && prev.line < cur.line)).toBe(true)
        }
      })

      it('scopes to a path prefix', async () => {
        const index = build()
        const { items } = await index.grep('memory', { pathPrefix: 'Areas/', limit: 100 })
        expect(items.length).toBeGreaterThan(0)
        expect(items.every((i) => i.path.startsWith('Areas/'))).toBe(true)
      })

      it('finds what ranking deliberately excludes', async () => {
        const index = make()
        index.rebuild([
          { guid: 'a', path: 'a.md', text: '- [x](https://example.invalid/html/page.html)' },
        ])
        expect((await index.search('html')).items).toEqual([])
        expect((await index.grep('html')).total).toBe(1)
      })

      it('rejects an invalid regex rather than reporting an empty vault', async () => {
        const index = build()
        await expect(index.grep('[unclosed', { regex: true })).rejects.toThrow()
      })

      it('anchors ^ and $ to lines, as a grep pattern is meant to', async () => {
        const index = make()
        index.rebuild([{ guid: 'a', path: 'a.md', text: 'one\ntwo\nthree' }])
        const { items } = await index.grep('^two$', { regex: true })
        expect(items.map((h) => h.line)).toEqual([2])
      })

      it('does not hang on a pattern that can match nothing', async () => {
        const index = build()
        await expect(index.grep('x*', { regex: true })).resolves.toBeDefined()
      })
    })

    describe('quick-open', () => {
      it('subsequence-matches a path', async () => {
        const index = build()
        const { items } = await index.quickOpen('sysprog')
        expect(items[0]?.path).toBe('Areas/CS/Systems Programming.md')
      })

      it('puts recent files first on an empty query', async () => {
        const index = build()
        const { items } = await index.quickOpen('', { recent: ['Daily/2-9-2026.md'] })
        expect(items[0].path).toBe('Daily/2-9-2026.md')
      })

      it('lets recency break a tie between two equally good matches', async () => {
        const index = build()
        // Purpose-built pair: same length, same match positions, so the ONLY
        // difference the scorer can see is recency.
        index.upsert({ guid: 'g-a1', path: 'Notes/alpha one.md', text: 'a' })
        index.upsert({ guid: 'g-a2', path: 'Notes/alpha two.md', text: 'b' })
        const cold = await index.quickOpen('alpha')
        expect(cold.items[0].path).toBe('Notes/alpha one.md')
        const warm = await index.quickOpen('alpha', { recent: ['Notes/alpha two.md'] })
        expect(warm.items[0].path).toBe('Notes/alpha two.md')
      })

      it('does not let recency override a clearly better match', async () => {
        const index = build()
        const { items } = await index.quickOpen('sysprog', {
          recent: ['Daily/2-9-2026.md'],
        })
        expect(items[0].path).toBe('Areas/CS/Systems Programming.md')
      })

      it('returns highlight spans inside the path', async () => {
        const index = build()
        const [hit] = (await index.quickOpen('memory')).items
        for (const span of hit.spans) {
          expect(span.to).toBeLessThanOrEqual(hit.path.length)
        }
      })
    })

    describe('links', () => {
      it('resolves a bare note name to its path', async () => {
        const index = build()
        expect(await index.resolve('Memory Layout')).toBe('Areas/CS/Memory Layout.md')
      })

      it('resolves case-insensitively and ignores a .md suffix', async () => {
        const index = build()
        expect(await index.resolve('memory layout.md')).toBe('Areas/CS/Memory Layout.md')
      })

      it('returns null rather than guessing for an unknown target', async () => {
        const index = build()
        expect(await index.resolve('Edible Inbox')).toBeNull()
      })

      it('lists backlinks with the line they sit on', async () => {
        const index = build()
        const { items } = await index.backlinks('Systems Programming')
        expect(items.map((i) => i.path).sort()).toEqual([
          'Areas/CS/Memory Layout.md',
          'TODO/Dev learning __index.md',
        ])
        expect(items.every((i) => i.context.length > 0)).toBe(true)
        expect(items.every((i) => i.line >= 1)).toBe(true)
      })

      it('keeps the alias and the anchor of a link', async () => {
        const index = build()
        const { items } = await index.outgoing('g-layout')
        expect(items[0].alias).toBe('systems')
        const list = (await index.outgoing('g-index')).items
        expect(list.find((l) => l.target === 'Memory Layout')?.anchor).toBe('Heap')
      })

      it('marks an embed occurrence, so a missing attachment is not offered as a note', async () => {
        const index = build()
        index.upsert({ guid: 'g-emb', path: 'study.md', text: 'see ![[Tree Layout.png]] here' })
        const [ref] = (await index.outgoing('g-emb')).items
        expect(ref.embed).toBe(true)
        expect(ref.resolved).toBeNull()
        const links = (await index.outgoing('g-index')).items
        expect(links.every((l) => l.embed === false)).toBe(true)
      })

      it('ranks the note NAMED by the query above one that merely mentions it', async () => {
        // A regression guard: summing df across prefix-matching terms drove
        // idf negative, which inverted the whole ordering.
        const index = make()
        index.rebuild([
          { guid: 'a', path: 'Meeting.md', text: 'meeting meeting agenda' },
          { guid: 'b', path: 'x1.md', text: 'meetings meetingroom meets' },
          { guid: 'c', path: 'x2.md', text: 'meetings meetingroom meetup' },
        ])
        const { items } = await index.search('meeting')
        expect(items[0].path).toBe('Meeting.md')
        expect(items.every((i) => i.score >= 0)).toBe(true)
      })

      it('finds a renamed note by its NEW name and not by its old one', async () => {
        const index = make()
        index.rebuild([{ guid: 'g1', path: 'projects/alpha.md', text: 'body text here' }])
        index.rename('g1', 'projects/beta.md')
        expect((await index.search('beta')).items.map((i) => i.path)).toEqual([
          'projects/beta.md',
        ])
        expect((await index.search('alpha')).items).toEqual([])
      })

      it('counts NOTES per tag, matching what byTag returns', async () => {
        const index = make()
        index.rebuild([{ guid: 'g1', path: 'a.md', text: '#project x #project y #project z' }])
        const [tag] = (await index.tags()).items
        expect(tag).toEqual({ tag: '#project', count: 1 })
        expect((await index.byTag('#project')).total).toBe(1)
      })

      it('collects unresolved links as the note-creation queue', async () => {
        const index = build()
        const targets = (await index.unresolved()).items.map((i) => i.target)
        expect(targets).toContain('Missing Note')
        expect(targets).toContain('Edible Inbox')
        expect(targets).not.toContain('Memory Layout')
      })

      it('ignores wikilinks inside fenced code', async () => {
        const index = build()
        const targets = (await index.outgoing('g-systems')).items.map((i) => i.target)
        expect(targets).not.toContain('Not A Link')
      })

      it('re-resolves the whole graph after a rename', async () => {
        const index = build()
        index.rename('g-layout', 'Archive/Memory Layout.md')
        const { items } = await index.backlinks('Memory Layout')
        expect(items.length).toBeGreaterThan(0)
        expect(await index.resolve('Memory Layout')).toBe('Archive/Memory Layout.md')
      })

      it('moves a target into unresolved when it is deleted', async () => {
        const index = build()
        index.remove('g-layout')
        const targets = (await index.unresolved()).items.map((i) => i.target)
        expect(targets).toContain('Memory Layout')
      })

      it('resolves a newly created note, closing an unresolved link', async () => {
        const index = build()
        index.upsert({ guid: 'g-new', path: 'Edible Inbox.md', text: '# Edible Inbox' })
        expect(await index.resolve('Edible Inbox')).toBe('Edible Inbox.md')
        const targets = (await index.unresolved()).items.map((i) => i.target)
        expect(targets).not.toContain('Edible Inbox')
      })
    })

    describe('metadata', () => {
      it('counts inline tags and ignores headings and code', async () => {
        const index = build()
        const tags = (await index.tags()).items.map((t) => t.tag)
        expect(tags).toContain('#os/memory')
        expect(tags).toContain('#index')
        expect(tags).not.toContain('#Systems')
      })

      it('lists notes by tag', async () => {
        const index = build()
        const { items } = await index.byTag('index')
        expect(items.map((i) => i.path)).toEqual(['TODO/Dev learning __index.md'])
      })

      it('reads frontmatter KEYS only', async () => {
        const index = build()
        const keys = (await index.frontmatterKeys()).items.map((k) => k.tag)
        expect(keys).toContain('tags')
        expect(keys).toContain('status')
        expect(keys).not.toContain('active')
      })

      it('lists headings in document order, skipping fenced hashes', async () => {
        const index = build()
        const headings = await index.headings('g-systems')
        expect(headings.map((h) => h.text)).toEqual(['Systems Programming', 'Virtual memory'])
        expect(headings[0].level).toBe(1)
        expect(headings[1].level).toBe(2)
      })
    })

    describe('write path', () => {
      it('replaces a document rather than duplicating it', async () => {
        const index = build()
        index.upsert({ guid: 'g-daily', path: 'Daily/2-9-2026.md', text: 'nothing here' })
        const { items } = await index.search('memory')
        expect(items.map((i) => i.path)).not.toContain('Daily/2-9-2026.md')
        expect((await index.stats()).docs).toBe(DOCS.length)
      })

      it('forgets a removed document entirely', async () => {
        const index = build()
        index.remove('g-layout')
        const { items } = await index.search('heap')
        expect(items.map((i) => i.path)).not.toContain('Areas/CS/Memory Layout.md')
      })

      it('keeps the guid and moves the path on rename', async () => {
        const index = build()
        index.rename('g-daily', 'Daily/renamed.md')
        const { items } = await index.quickOpen('renamed')
        expect(items[0].guid).toBe('g-daily')
      })

      it('rebuild is idempotent and drops everything not in the new set', async () => {
        const index = build()
        index.rebuild([DOCS[0]])
        expect((await index.stats()).docs).toBe(1)
        index.rebuild(DOCS)
        expect((await index.stats()).docs).toBe(DOCS.length)
      })

      it('survives an empty document and a document of only markup', async () => {
        const index = build()
        index.upsert({ guid: 'g-empty', path: 'empty.md', text: '' })
        index.upsert({ guid: 'g-markup', path: 'markup.md', text: '---\n---\n\n> \n\n---\n' })
        expect((await index.stats()).docs).toBe(DOCS.length + 2)
        await expect(index.search('anything')).resolves.toBeDefined()
      })

      it('does not throw on malformed wikilinks or unterminated fences', async () => {
        const index = build()
        index.upsert({
          guid: 'g-bad',
          path: 'bad.md',
          text: '[[ ]] [[|alias]] [[#]] ```\nunterminated [[Nope]]',
        })
        await expect(index.outgoing('g-bad')).resolves.toBeDefined()
        await expect(index.unresolved()).resolves.toBeDefined()
      })
    })
  })
}
