/**
 * `search` — references and snippets, never bodies (contract rule 2), in three
 * modes. Ordering assertions belong to `libs/index`'s ranking corpus (agent B);
 * what is asserted here is the CONTRACT: what comes back, in what shape, with
 * what honesty counters, and what is refused.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { runOp } from '../src/ops/index.js'
import { harness, type Harness } from './harness.js'

let h: Harness
const open = async (): Promise<Harness> => (h = await harness())
afterEach(async () => h?.cleanup())

describe('ranked mode', () => {
  it('returns references with a line, snippets and coverage — never a body', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'search', { query: 'json' })
    expect(out.mode).toBe('ranked')
    expect(out.hits.map((hit) => hit.path)).toContain('Areas/CS/JSON.md')
    const hit = out.hits.find((candidate) => candidate.path === 'Areas/CS/JSON.md')!
    expect(hit.line).toBeGreaterThan(0)
    expect(hit.snippets.length).toBeGreaterThan(0)
    expect(hit.snippets[0].text.length).toBeLessThan(200)
    expect(hit.tier).toBeDefined()
    expect(out.coverage.docs).toBeGreaterThan(0)
  })

  it('defaults to ten hits and pages with a cursor', async () => {
    const { backend } = await open()
    const first = await runOp(backend, 'search', { query: 'the', limit: 2 })
    expect(first.returned).toBeLessThanOrEqual(2)
    if (first.nextCursor) {
      const second = await runOp(backend, 'search', { query: 'the', limit: 2, cursor: first.nextCursor })
      expect(second.hits.map((hit) => hit.path)).not.toEqual(first.hits.map((hit) => hit.path))
    }
    const wide = await runOp(backend, 'search', { query: 'the' })
    expect(wide.returned).toBeLessThanOrEqual(10)
  })

  it('folds path: and tag: into the query the index already understands', async () => {
    const { backend } = await open()
    const scoped = await runOp(backend, 'search', { query: 'json', path: 'Areas' })
    expect(scoped.hits.length).toBeGreaterThan(0)
    expect(scoped.hits.every((hit) => hit.path.startsWith('Areas/'))).toBe(true)

    const tagged = await runOp(backend, 'search', { query: 'prose', tag: '#project' })
    expect(tagged.hits.map((hit) => hit.path)).toEqual(['Projects/Editor.md'])
  })

  it('scopes to a folder whose name contains a space', async () => {
    const { backend } = await open()
    const scoped = await runOp(backend, 'search', { query: 'json', path: 'Edible/Dev Notes' })
    expect(scoped.hits.map((hit) => hit.path)).toEqual([
      'Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md',
    ])
    // The index counted a wider prefix than it was asked for, so no count is
    // offered rather than a wrong one.
    expect(scoped.total).toBeNull()
  })

  it('refuses a case-sensitive ranked search instead of ignoring the flag', async () => {
    const { backend } = await open()
    await expect(runOp(backend, 'search', { query: 'json', caseSensitive: true })).rejects.toMatchObject({
      code: 'usage',
    })
  })

  it('answers an empty result honestly rather than failing', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'search', { query: 'zzzznotawordzzzz' })
    expect(out.hits).toEqual([])
    expect(out.returned).toBe(0)
    expect(out.coverage.docs).toBeGreaterThan(0)
  })
})

describe('grep modes', () => {
  it('finds text inside URLs that ranked search is meant to ignore', async () => {
    const { backend } = await open()
    const grep = await runOp(backend, 'search', { query: 'music/3/index.html', mode: 'exact' })
    expect(grep.mode).toBe('exact')
    expect(grep.hits.map((hit) => hit.path)).toEqual(['Areas/Life/Music.md'])
    const hit = grep.hits[0]
    expect(hit.tier).toBe('grep')
    expect(hit.score).toBe(0)
    expect(hit.snippets[0].text).toContain('index.html')
    const span = hit.snippets[0].spans[0]
    expect(hit.snippets[0].text.slice(span.from, span.to)).toBe('music/3/index.html')
  })

  it('is case-insensitive by default and case-sensitive on request', async () => {
    const { backend } = await open()
    expect((await runOp(backend, 'search', { query: 'CRLF LINES', mode: 'exact' })).returned).toBe(1)
    expect(
      (await runOp(backend, 'search', { query: 'CRLF LINES', mode: 'exact', caseSensitive: true })).returned
    ).toBe(0)
  })

  it('treats the pattern literally in exact mode and as a regex in regex mode', async () => {
    const { backend } = await open()
    expect((await runOp(backend, 'search', { query: 'index.html$', mode: 'exact' })).returned).toBe(0)
    const regex = await runOp(backend, 'search', { query: 'index\\.html$', mode: 'regex', limit: 5 })
    // Grep is per LINE, not per note: every one of these is a different line
    // of the same link dump, and each carries its own line number.
    expect(new Set(regex.hits.map((hit) => hit.path))).toEqual(new Set(['Areas/Life/Music.md']))
    expect(new Set(regex.hits.map((hit) => hit.line)).size).toBe(regex.returned)
    expect(regex.hits.every((hit) => hit.snippets.length === 1)).toBe(true)
    expect(regex.hits.every((hit) => hit.snippets[0].line === hit.line)).toBe(true)
  })

  it('scopes to a subtree, pages, and never spins on a zero-width match', async () => {
    const { backend } = await open()
    const scoped = await runOp(backend, 'search', { query: 'json', mode: 'exact', path: 'Edible', limit: 50 })
    expect(scoped.hits.every((hit) => hit.path.startsWith('Edible/'))).toBe(true)
    const page = await runOp(backend, 'search', { query: 'e', mode: 'exact', limit: 3 })
    expect(page.returned).toBe(3)
    expect(page.nextCursor).not.toBeNull()
    const empty = await runOp(backend, 'search', { query: 'x*', mode: 'regex', limit: 3 })
    expect(empty.returned).toBeGreaterThanOrEqual(0)
  })

  it('refuses a bad regex and a tag filter it cannot honour', async () => {
    const { backend } = await open()
    await expect(runOp(backend, 'search', { query: '[unclosed', mode: 'regex' })).rejects.toMatchObject({
      code: 'usage',
    })
    await expect(runOp(backend, 'search', { query: 'json', mode: 'exact', tag: 'project' })).rejects.toMatchObject({
      code: 'usage',
    })
  })
})
