/**
 * Membership (bases-shaping Fork 3-B): a note is a row when a `.base` file's
 * global filters match it and one of its views' filters does — the same
 * compiler the tab runs, asked of the same index, so the form and the table
 * agree by construction; a collection with no filters at all claims nothing.
 */
import { MemoryIndex, type IndexDoc } from '@ohhi/index'
import { describe, expect, it } from 'vitest'
import { collectionQueries, collectionsOf, compileCollection, inAnyCollection, type CompiledCollection } from './collection-membership.js'

const NOTES: Record<string, string> = {
  // Global filter, one view without filters: the folder's notes.
  'Competitors.base': 'filters:\n  and:\n    - file.inFolder("Competitors")\nviews:\n  - type: table\n    name: All\n',
  // No views at all: still a query over its filters (as `ohhi rows` reads it).
  'Meetings.base': 'filters:\n  and:\n    - file.inFolder("Meetings")\n    - status != "done"\n',
  // No filters at any level: claims nothing — one such file must not put a form on every note.
  'Everything.base': 'views:\n  - type: table\n    name: All\n',
  // No global filter; every view filtered: OR over the views.
  'Threats.base': 'views:\n  - type: table\n    name: Direct\n    filters:\n      and:\n        - threat == "direct"\n  - type: table\n    name: Done\n    filters:\n      and:\n        - status == "done"\n',
  // Global AND the views: the folder's notes some view lists.
  'Open.base': 'filters:\n  and:\n    - file.inFolder("Meetings")\nviews:\n  - type: table\n    name: Open\n    filters:\n      and:\n        - status == "open"\n',
  'Broken.base': 'views: [\n',
  'Competitors/Ingredifind.md': '---\nthreat: direct\n---\n',
  'Competitors/Quiteful.md': '---\nthreat: adjacent\n---\n',
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

describe('compileCollection — the rule', () => {
  it('claims nothing without a filter at any level, or when the file does not parse', () => {
    expect(compileCollection('Everything.base', NOTES['Everything.base']!)).toBeNull()
    expect(compileCollection('Broken.base', NOTES['Broken.base']!)).toBeNull()
    expect(compileCollection('Empty.base', '')).toBeNull()
  })

  it('ORs the views, each under the global filters', () => {
    const q = compileCollection('Threats.base', NOTES['Threats.base']!)!
    expect(q.filter.op).toBe('or')
    expect((q.filter as { args: unknown[] }).args).toHaveLength(2)
    const one = compileCollection('Open.base', NOTES['Open.base']!)!
    expect(one.filter.op).toBe('and')
  })
})

describe('collectionQueries', () => {
  it('compiles one query per claiming .base and skips notes, unreadable and filterless files', () => {
    const { queries } = setup()
    expect(queries.map((q) => q.path)).toEqual(['Competitors.base', 'Meetings.base', 'Threats.base', 'Open.base'])
  })

  it('reads the text through the callback and skips a file it cannot read', () => {
    const queries = collectionQueries(['A.base', 'B.base'], (p) => (p === 'A.base' ? NOTES['Open.base']! : null))
    expect(queries.map((q) => q.path)).toEqual(['A.base'])
  })

  it('compiles once per text through the cache, and forgets a file that is gone', () => {
    const cache = new Map<string, CompiledCollection>()
    const texts = new Map([['A.base', NOTES['Open.base']!], ['B.base', NOTES['Everything.base']!]])
    const first = collectionQueries([...texts.keys()], (p) => texts.get(p) ?? null, cache)
    expect(first).toHaveLength(1)
    const again = collectionQueries([...texts.keys()], (p) => texts.get(p) ?? null, cache)
    // The same text: the same compiled query object, not a second parse.
    expect(again[0]).toBe(first[0])
    expect(cache.get('B.base')?.query).toBeNull()
    // A changed text recompiles; a file that is gone leaves the cache.
    texts.set('A.base', NOTES['Competitors.base']!)
    texts.delete('B.base')
    const changed = collectionQueries([...texts.keys()], (p) => texts.get(p) ?? null, cache)
    expect(changed[0]).not.toBe(first[0])
    expect(cache.has('B.base')).toBe(false)
  })
})

describe('inAnyCollection / collectionsOf', () => {
  it('claims a note the global filter matches through a filterless view, and names every collection that does', async () => {
    const { ask, which } = setup()
    expect(await ask('Competitors/Ingredifind.md')).toBe(true)
    expect(await which('Competitors/Ingredifind.md')).toEqual(['Competitors.base', 'Threats.base'])
    // Adjacent: in the folder (Competitors.base), in no view of Threats.base.
    expect(await which('Competitors/Quiteful.md')).toEqual(['Competitors.base'])
  })

  it('a filterless collection claims nothing; a view-less one claims through its filters', async () => {
    const { ask, which } = setup()
    expect(await ask('Areas/Loose.md')).toBe(false)
    expect(await which('Meetings/Prep.md')).toEqual(['Meetings.base', 'Open.base'])
    // `status != "done"` excludes the done meeting from Meetings.base; Threats.base's Done view lists it; Open.base's Open view does not.
    expect(await which('Meetings/Weekly.md')).toEqual(['Threats.base'])
  })

  it('never claims the collection files themselves — rows are notes', async () => {
    const { ask } = setup()
    expect(await ask('Competitors.base')).toBe(false)
    expect(await ask('Threats.base')).toBe(false)
  })

  it('answers false when no collection matches, and with no collections at all', async () => {
    const { index } = setup()
    const queries = collectionQueries(['Competitors.base'], (p) => NOTES[p] ?? null)
    expect(await inAnyCollection(index, queries, 'Areas/Loose.md', 0, 0)).toBe(false)
    expect(await inAnyCollection(index, [], 'Areas/Loose.md', 0, 0)).toBe(false)
    expect(await inAnyCollection(index, queries, 'Nowhere.md', 0, 0)).toBe(false)
  })
})
