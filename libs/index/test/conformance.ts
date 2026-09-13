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

      it('leaves a tag inside a code span out, as the editor’s own parser does', () => {
        // Fork 6, one grammar: `#pool` in a code span is never decorated, so a
        // backend that counted it would answer `tag:#pool` with a note the
        // reader can see no chip in.
        const index = make()
        index.rebuild([
          { guid: 'g1', path: 'a.md', text: 'set `#pool` in the config, tagged #ops' },
        ])
        return Promise.all([
          index.tags().then((page) => {
            expect(page.items.map((t) => t.tag)).toEqual(['#ops'])
          }),
          index.byTag('#pool').then((page) => expect(page.items).toEqual([])),
        ])
      })

      it('lists notes by tag', async () => {
        const index = build()
        const { items } = await index.byTag('index')
        expect(items.map((i) => i.path)).toEqual(['TODO/Dev learning __index.md'])
      })

      it('counts a frontmatter tag the note never writes inline', async () => {
        // Systems Programming carries `tags: [cs]` and no `#cs` in its body.
        const index = build()
        expect((await index.tags()).items.map((t) => t.tag)).toContain('#cs')
        expect((await index.byTag('#cs')).items.map((i) => i.path)).toEqual([
          'Areas/CS/Systems Programming.md',
        ])
      })

      it('counts a note ONCE when it carries a tag in both forms', async () => {
        const index = make()
        index.rebuild([
          { guid: 'g1', path: 'a.md', text: '---\ntags: [alpha]\n---\n\nwritten #alpha too\n' },
        ])
        expect((await index.tags()).items).toEqual([{ tag: '#alpha', count: 1 }])
        expect((await index.byTag('#alpha')).total).toBe(1)
      })

      it("splits Obsidian's legacy space-separated frontmatter list", async () => {
        // The vault's own shape: YAML reads ONE string, Obsidian reads two tags.
        const index = make()
        index.rebuild([{ guid: 'g1', path: 'a.md', text: '---\ntags: [composition testing]\n---\n' }])
        const tags = (await index.tags()).items.map((t) => t.tag).sort()
        expect(tags).toEqual(['#composition', '#testing'])
      })

      it('matches a nested tag by prefix, and an exact nested tag exactly', async () => {
        const index = build()
        // Obsidian's rule: #os finds #os/memory; #os/memory finds only itself.
        expect((await index.byTag('#os')).items.map((i) => i.path)).toEqual([
          'Areas/CS/Systems Programming.md',
        ])
        expect((await index.byTag('#os/memory')).total).toBe(1)
        expect((await index.byTag('#os/paging')).total).toBe(0)
      })

      it('matches tags case-insensitively and shows the first spelling seen', async () => {
        const index = make()
        index.rebuild([
          { guid: 'g1', path: 'a.md', text: '#Project kickoff' },
          { guid: 'g2', path: 'b.md', text: '---\ntags: [PROJECT]\n---\n' },
        ])
        expect((await index.tags()).items).toEqual([{ tag: '#Project', count: 2 }])
        expect((await index.byTag('#project')).total).toBe(2)
      })

      it('filters search by tag with the same nesting rule', async () => {
        const index = build()
        const nested = await index.search('tag:#os')
        expect(nested.items.map((i) => i.path)).toEqual(['Areas/CS/Systems Programming.md'])
        const frontmatter = await index.search('tag:cs')
        expect(frontmatter.items.map((i) => i.path)).toEqual(['Areas/CS/Systems Programming.md'])
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
