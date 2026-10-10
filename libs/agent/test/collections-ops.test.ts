/**
 * `collections` and `rows` over the fixture vault (bases-shaping DB1, A9):
 * the demo is an agent answering "which direct competitors haven't been
 * verified since March?" from a `.base` and frontmatter, in one call.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpError } from '../src/contract.js'
import { runOp } from '../src/ops/index.js'
import { harness, type Harness } from './harness.js'

let h: Harness
beforeEach(async () => {
  h = await harness()
})
afterEach(() => h.cleanup())

describe('collections', () => {
  it('lists every .base with its views and live row counts', async () => {
    const out = await runOp(h.backend, 'collections', {})
    expect(out.schema).toBe('ohhi.collections.v1')
    expect(out.collections).toHaveLength(1)
    const c = out.collections[0]
    expect(c).toMatchObject({ path: 'Competitors.base', name: 'Competitors', issues: [], error: null })
    expect(c.views).toEqual([
      { name: 'All', type: 'table', rows: 3, supported: true, reasons: [] },
      { name: 'Direct', type: 'table', rows: 2, supported: true, reasons: [] },
    ])
    expect(out.coverage.docs).toBeGreaterThan(0)
  })

  it('scopes to a folder', async () => {
    const out = await runOp(h.backend, 'collections', { dir: 'Areas' })
    expect(out.collections).toEqual([])
  })
})

describe('rows', () => {
  it('returns the first view as references plus its columns, sorted as the file says', async () => {
    const out = await runOp(h.backend, 'rows', { collection: 'Competitors.base' })
    expect(out.schema).toBe('ohhi.rows.v1')
    expect(out.view).toBe('All')
    expect(out.columns).toEqual(['file.name', 'threat', 'depth', 'verified'])
    expect(out.rows.map((r) => r.name)).toEqual(['Ingredifind', 'Quiteful', 'Stale'])
    expect(out.rows[0]).toEqual({
      path: 'Competitors/Ingredifind.md',
      name: 'Ingredifind',
      values: { 'file.name': 'Ingredifind', threat: 'direct', depth: 'Deep', verified: '2026-06-02' },
    })
    expect(out.rows[2].values.depth).toBeNull()
    expect(out.supported).toBe(true)
    expect(out.total).toBe(3)
  })

  it('answers the demo question: direct competitors not verified since March', async () => {
    const out = await runOp(h.backend, 'rows', {
      collection: 'Competitors.base',
      view: 'direct',
      where: 'verified < date("2026-03-01")',
      columns: ['verified', 'score'],
    })
    expect(out.view).toBe('Direct')
    expect(out.rows.map((r) => [r.path, r.values])).toEqual([['Competitors/Stale.md', { verified: '2026-01-10', score: null }]])
  })

  it('types cells by what the note says: numbers are numbers', async () => {
    const out = await runOp(h.backend, 'rows', { collection: 'Competitors.base', columns: ['score'], sort: 'score:desc' })
    expect(out.rows.map((r) => r.values.score)).toEqual([8, 5, null])
  })

  it('queries the whole vault with --where and no collection, defaulting columns to what the rows carry', async () => {
    const out = await runOp(h.backend, 'rows', { where: 'file.hasProperty("status")' })
    expect(out.collection).toBeNull()
    expect(out.view).toBeNull()
    expect(out.rows.map((r) => r.path)).toEqual(['Projects/Editor.md'])
    expect(out.columns).toContain('status')
    expect(out.rows[0].values.status).toBe('active')
    expect(out.rows[0].values.tags).toEqual(['project', 'editor'])
    expect(out.rows[0].values.draft).toBe(false)
  })

  it('pages like every list', async () => {
    const first = await runOp(h.backend, 'rows', { collection: 'Competitors.base', limit: 2 })
    expect(first.returned).toBe(2)
    expect(first.nextCursor).not.toBeNull()
    const second = await runOp(h.backend, 'rows', { collection: 'Competitors.base', limit: 2, cursor: first.nextCursor! })
    expect(second.rows.map((r) => r.name)).toEqual(['Stale'])
    expect(second.nextCursor).toBeNull()
  })

  it('refuses what it should, with the words an agent can act on', async () => {
    await expect(runOp(h.backend, 'rows', { collection: 'Nope.base' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(runOp(h.backend, 'rows', { collection: 'Areas/CS/JSON.md' })).rejects.toMatchObject({ code: 'usage' })
    const unknownView = runOp(h.backend, 'rows', { collection: 'Competitors.base', view: 'Nothing' })
    await expect(unknownView).rejects.toBeInstanceOf(OpError)
    await expect(unknownView).rejects.toMatchObject({ code: 'usage', details: { views: ['All', 'Direct'] } })
    await expect(runOp(h.backend, 'rows', { collection: 'Competitors.base', where: 'formula.x > 1' })).rejects.toMatchObject({
      code: 'usage',
      message: expect.stringContaining('formula.x > 1'),
    })
    await expect(runOp(h.backend, 'rows', { sort: 'file.ctime' })).rejects.toMatchObject({ code: 'usage' })
  })
})
