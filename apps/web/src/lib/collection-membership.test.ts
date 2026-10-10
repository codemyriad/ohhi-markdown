/**
 * Membership (bases-shaping Fork 3-B): a note is a row when a `.base` file's
 * global filters match it — the same compiler the tab runs, asked of the
 * same index, so the form and the table agree by construction.
 */
import { MemoryIndex, type IndexDoc } from '@ohhi/index'
import { describe, expect, it } from 'vitest'
import { collectionQueries, collectionsOf, inAnyCollection } from './collection-membership.js'

const NOTES: Record<string, string> = {
  'Competitors.base': 'filters:\n  and:\n    - file.inFolder("Competitors")\nviews:\n  - type: table\n    name: All\n',
  // No views at all: still a query over its folder (as `ohhi rows` reads it).
  'Meetings.base': 'filters:\n  and:\n    - file.inFolder("Meetings")\n    - status != "done"\n',
  // No filters: every note in the vault is a row.
  'Everything.base': 'views:\n  - type: table\n    name: All\n',
  'Broken.base': 'views: [\n',
  'Competitors/Ingredifind.md': '---\nthreat: direct\n---\n',
  'Meetings/Weekly.md': '---\nstatus: done\n---\n',
  'Meetings/Prep.md': '---\nstatus: open\n---\n',
  'Areas/Loose.md': 'no frontmatter\n',
}

function setup(paths = Object.keys(NOTES)) {
  const index = new MemoryIndex()
  index.rebuild(paths.map((path): IndexDoc => ({ guid: path, path, text: NOTES[path]! })))
  const queries = collectionQueries(paths, (p) => NOTES[p] ?? null)
  const ask = (path: string) => inAnyCollection(index, queries, path, Date.UTC(2026, 6, 1), 0)
  const which = (path: string) => collectionsOf(index, queries, path, Date.UTC(2026, 6, 1), 0)
  return { index, queries, ask, which }
}

describe('collectionQueries', () => {
  it('compiles one query per readable .base and skips notes and unreadable files', () => {
    const { queries } = setup()
    expect(queries.map((q) => q.path)).toEqual(['Competitors.base', 'Meetings.base', 'Everything.base'])
  })

  it('reads the text through the callback and skips a file it cannot read', () => {
    const queries = collectionQueries(['A.base', 'B.base'], (p) => (p === 'A.base' ? 'views: []\n' : null))
    expect(queries.map((q) => q.path)).toEqual(['A.base'])
  })
})

describe('inAnyCollection / collectionsOf', () => {
  it('claims a note the global filter matches, and names every collection that does', async () => {
    const { ask, which } = setup()
    expect(await ask('Competitors/Ingredifind.md')).toBe(true)
    expect(await which('Competitors/Ingredifind.md')).toEqual(['Competitors.base', 'Everything.base'])
  })

  it('applies a filterless collection to every note, and a view-less one through its filters', async () => {
    const { ask, which } = setup()
    expect(await which('Areas/Loose.md')).toEqual(['Everything.base'])
    expect(await which('Meetings/Prep.md')).toEqual(['Meetings.base', 'Everything.base'])
    // `status != "done"` excludes the done meeting from Meetings.base.
    expect(await which('Meetings/Weekly.md')).toEqual(['Everything.base'])
    expect(await ask('Meetings/Weekly.md')).toBe(true)
  })

  it('never claims the collection files themselves — rows are notes', async () => {
    const { ask } = setup()
    expect(await ask('Competitors.base')).toBe(false)
    expect(await ask('Everything.base')).toBe(false)
  })

  it('answers false when no collection matches, and with no collections at all', async () => {
    const { index } = setup()
    const queries = collectionQueries(['Competitors.base'], (p) => NOTES[p] ?? null)
    expect(await inAnyCollection(index, queries, 'Areas/Loose.md', 0, 0)).toBe(false)
    expect(await inAnyCollection(index, [], 'Areas/Loose.md', 0, 0)).toBe(false)
    expect(await inAnyCollection(index, queries, 'Nowhere.md', 0, 0)).toBe(false)
  })
})
