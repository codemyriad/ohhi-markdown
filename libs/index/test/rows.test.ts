/**
 * Rows — notes as records (collections DB1): typed values, links inside
 * properties, the structured filter, ordering and paging.
 */
import { describe, expect, it, vi } from 'vitest'
import { MemoryIndex } from '../src/memory-index.js'
import { parseMarkdown } from '../src/parse.js'
import { compareRows, matchesFilter, pinnedPath, todayOf, typeScalar } from '../src/properties.js'
import type { IndexDoc, Row, RowFilter } from '../src/types.js'

const note = (guid: string, path: string, fm: string, body = '', mtime?: number): IndexDoc => ({
  guid,
  path,
  text: `---\n${fm}\n---\n${body}`,
  ...(mtime === undefined ? {} : { mtime }),
})

const DOCS: IndexDoc[] = [
  note(
    'g-ingredifind',
    'Competitors/Ingredifind.md',
    ['threat: direct', 'depth: Deep', 'verified: 2026-06-02', 'score: 8', 'pillar: "[[Clusters]]"', 'tags: [competitor, food]'].join('\n'),
    '# Ingredifind\n\nSee [[Quiteful]].',
    Date.UTC(2026, 5, 2)
  ),
  note(
    'g-quiteful',
    'Competitors/Quiteful.md',
    ['threat: adjacent', 'depth: Moderate', 'verified: 2026-03-14', 'score: 5', 'active: false', 'pillars:', '  - "[[Clusters]]"', '  - "[[Pricing]]"'].join('\n'),
    '',
    Date.UTC(2026, 2, 14)
  ),
  note('g-nodepth', 'Competitors/No Depth.md', ['threat: direct', 'score: 010'].join('\n')),
  note('g-elsewhere', 'Meetings/Weekly.md', ['status: done', 'base: "[[Competitors]]"'].join('\n')),
  { guid: 'g-hub', path: 'Competitors.md', text: '# Competitors\n' },
  { guid: 'g-base', path: 'Competitors.base', text: 'views:\n  - type: table\n    name: All\n' },
  { guid: 'g-nested', path: 'Competitors/Nested.md', text: '---\nmeta:\n  deep: true\n---\n# Nested' },
]

const build = (): MemoryIndex => {
  const index = new MemoryIndex()
  index.rebuild(DOCS)
  return index
}

const paths = (rows: { path: string }[]): string[] => rows.map((r) => r.path)

describe('typeScalar — what a value says it is', () => {
  it('types by the written form, never a side table', () => {
    expect(typeScalar('true')).toEqual({ kind: 'boolean', value: true })
    expect(typeScalar('3')).toEqual({ kind: 'number', value: 3 })
    expect(typeScalar('-2.5')).toEqual({ kind: 'number', value: -2.5 })
    expect(typeScalar('2026-01-05')).toMatchObject({ kind: 'date', value: '2026-01-05', ms: Date.UTC(2026, 0, 5) })
    expect(typeScalar('2026-01-05T10:30:00Z')).toMatchObject({ kind: 'date' })
    expect(typeScalar('[[Clusters]]')).toEqual({ kind: 'link', target: 'Clusters', alias: null, resolved: null })
    expect(typeScalar('[[Clusters|the clusters]]')).toMatchObject({ kind: 'link', target: 'Clusters', alias: 'the clusters' })
    expect(typeScalar('')).toEqual({ kind: 'null' })
    expect(typeScalar('Deep')).toEqual({ kind: 'string', value: 'Deep' })
  })

  it('a quoted scalar is text whatever it looks like, in a scalar and in a list', async () => {
    const parsed = parseMarkdown('---\nscore: "8"\nflag: \'true\'\nmixed: ["1", 2]\n---\n')
    expect(parsed.properties.map((p) => [p.key, p.quoted])).toEqual([['score', true], ['flag', true], ['mixed', [true, false]]])
    const index = new MemoryIndex()
    index.rebuild([{ guid: 'q', path: 'Q.md', text: '---\nscore: "8"\nmixed: ["1", 2]\n---\n' }])
    const row = (await index.rows({ now: 0 })).items[0]
    expect(row.props.score).toEqual({ kind: 'string', value: '8' })
    expect(row.props.mixed).toEqual({ kind: 'list', items: [{ kind: 'string', value: '1' }, { kind: 'number', value: 2 }] })
  })

  it('keeps a leading-zero number and a phone number as text', () => {
    expect(typeScalar('010')).toEqual({ kind: 'string', value: '010' })
    expect(typeScalar('0123456789')).toEqual({ kind: 'string', value: '0123456789' })
    expect(typeScalar('0')).toEqual({ kind: 'number', value: 0 })
  })
})

describe('parseMarkdown — properties and the links inside them', () => {
  it('keeps every flat entry, in order, values as written', () => {
    const parsed = parseMarkdown(DOCS[0].text)
    expect(parsed.properties.map((p) => p.key)).toEqual(['threat', 'depth', 'verified', 'score', 'pillar', 'tags'])
    expect(parsed.properties[4]).toMatchObject({ key: 'pillar', value: '[[Clusters]]', kind: 'scalar' })
    expect(parsed.properties[5]).toMatchObject({ key: 'tags', value: ['competitor', 'food'], kind: 'flow-list' })
  })

  it('finds a link written as a value and tags it with its key, at its real offset', () => {
    const parsed = parseMarkdown(DOCS[0].text)
    expect(parsed.propertyLinks).toHaveLength(1)
    const link = parsed.propertyLinks[0]
    expect(link).toMatchObject({ target: 'Clusters', property: 'pillar', embed: false })
    expect(DOCS[0].text.slice(link.offset, link.offset + 12)).toBe('[[Clusters]]')
    // The body scan still never sees it: the block is blanked.
    expect(parsed.links.map((l) => l.target)).toEqual(['Quiteful'])
  })

  it('finds every link in a block list', () => {
    const parsed = parseMarkdown(DOCS[1].text)
    expect(parsed.propertyLinks.map((l) => [l.property, l.target])).toEqual([
      ['pillars', 'Clusters'],
      ['pillars', 'Pricing'],
    ])
  })

  it('reads no cell from an entry the patcher would refuse, and every cell beside it', () => {
    const parsed = parseMarkdown(DOCS[6].text)
    expect(parsed.frontmatterKeys).toEqual(['meta'])
    expect(parsed.properties).toEqual([])
    const mixed = parseMarkdown('---\ndesc: >\n  long\n  text\nstatus: active\nstatus: again\n---\n')
    expect(mixed.frontmatterKeys).toEqual(['desc', 'status', 'status'])
    expect(mixed.properties.map((p) => [p.key, p.value])).toEqual([['status', 'active']])
  })

  it('reads a zoneless date-time as UTC, like a date', () => {
    expect(typeScalar('2026-06-02T10:00')).toMatchObject({ kind: 'date', ms: Date.UTC(2026, 5, 2, 10) })
    expect(typeScalar('2026-06-02T10:00+02:00')).toMatchObject({ kind: 'date', ms: Date.UTC(2026, 5, 2, 8) })
  })
})

describe('MemoryIndex.rows', () => {
  it('turns every note into a record with typed props and file fields', async () => {
    const index = build()
    const page = await index.rows({ now: 0, filter: { op: 'cmp', cmp: '==', left: { key: { file: 'name' } }, right: { lit: 'Ingredifind' } } })
    expect(page.items).toHaveLength(1)
    const row = page.items[0]
    expect(row).toMatchObject({
      path: 'Competitors/Ingredifind.md',
      name: 'Ingredifind',
      folder: 'Competitors',
      ext: 'md',
      mtime: Date.UTC(2026, 5, 2),
    })
    expect(row.tags.sort()).toEqual(['competitor', 'food'])
    expect(row.props.depth).toEqual({ kind: 'string', value: 'Deep' })
    expect(row.props.score).toEqual({ kind: 'number', value: 8 })
    expect(row.props.verified).toMatchObject({ kind: 'date', value: '2026-06-02' })
    // The link resolves against the vault, now.
    expect(row.props.pillar).toMatchObject({ kind: 'link', target: 'Clusters', resolved: null })
    expect(row.links).toEqual(['Competitors/Quiteful.md'])
  })

  it('filters by folder, including subfolders, and the vault root means everything', async () => {
    const index = build()
    expect(paths((await index.rows({ now: 0, filter: { op: 'inFolder', folder: 'Competitors' } })).items)).toEqual([
      'Competitors/Ingredifind.md',
      'Competitors/Nested.md',
      'Competitors/No Depth.md',
      'Competitors/Quiteful.md',
    ])
    expect((await index.rows({ now: 0, filter: { op: 'inFolder', folder: '' } })).total).toBe(DOCS.length)
    expect((await index.rows({ now: 0, filter: { op: 'inFolder', folder: 'Comp' } })).total).toBe(0)
  })

  it('compares typed values the way a person means them', async () => {
    const index = build()
    const q = (filter: RowFilter) => index.rows({ filter, now: 0 }).then((p) => paths(p.items))
    await expect(q({ op: 'cmp', cmp: '==', left: { key: { prop: 'threat' } }, right: { lit: 'direct' } })).resolves.toEqual([
      'Competitors/Ingredifind.md',
      'Competitors/No Depth.md',
    ])
    await expect(q({ op: 'cmp', cmp: '>', left: { key: { prop: 'score' } }, right: { lit: 6 } })).resolves.toEqual([
      'Competitors/Ingredifind.md',
    ])
    // A string literal against a number: re-typed.
    await expect(q({ op: 'cmp', cmp: '>=', left: { key: { prop: 'score' } }, right: { lit: '5' } })).resolves.toEqual([
      'Competitors/Ingredifind.md',
      'Competitors/Quiteful.md',
    ])
    await expect(
      q({ op: 'cmp', cmp: '<', left: { key: { prop: 'verified' } }, right: { lit: '2026-04-01' } })
    ).resolves.toEqual(['Competitors/Quiteful.md'])
    await expect(q({ op: 'cmp', cmp: '==', left: { key: { prop: 'active' } }, right: { lit: false } })).resolves.toEqual([
      'Competitors/Quiteful.md',
    ])
    // `!=` is true of a note that lacks the property, as Obsidian's is.
    expect((await q({ op: 'cmp', cmp: '!=', left: { key: { prop: 'threat' } }, right: { lit: 'direct' } })).length).toBe(
      DOCS.length - 2
    )
  })

  it('evaluates relative dates against the instant the caller passes', async () => {
    const index = build()
    const now = Date.UTC(2026, 6, 1)
    const stale: RowFilter = {
      op: 'cmp',
      cmp: '<',
      left: { key: { prop: 'verified' } },
      right: { dateAdd: { now: 'today' }, duration: '30d', sign: -1 },
    }
    expect(paths((await index.rows({ filter: stale, now })).items)).toEqual(['Competitors/Quiteful.md'])
    expect(paths((await index.rows({ filter: stale, now: Date.UTC(2026, 8, 1) })).items)).toEqual([
      'Competitors/Ingredifind.md',
      'Competitors/Quiteful.md',
    ])
  })

  it('answers hasTag with the nesting rule, hasLink through resolution, and list membership', async () => {
    const index = build()
    const q = (filter: RowFilter) => index.rows({ filter, now: 0 }).then((p) => paths(p.items))
    await expect(q({ op: 'hasTag', tags: ['Competitor'] })).resolves.toEqual(['Competitors/Ingredifind.md'])
    await expect(q({ op: 'hasLink', target: 'Quiteful' })).resolves.toEqual(['Competitors/Ingredifind.md'])
    // A link written in a property is a link (the hub-note membership rule).
    await expect(q({ op: 'hasLink', target: 'Competitors' })).resolves.toEqual(['Meetings/Weekly.md'])
    await expect(
      q({ op: 'contains', target: { key: { prop: 'pillars' } }, value: { lit: 'Pricing' } })
    ).resolves.toEqual(['Competitors/Quiteful.md'])
    await expect(
      q({ op: 'containsAny', target: { key: { file: 'tags' } }, values: [{ lit: 'food' }, { lit: 'nothing' }] })
    ).resolves.toEqual(['Competitors/Ingredifind.md'])
    await expect(q({ op: 'isEmpty', target: { key: { prop: 'depth' } } })).resolves.toContain('Competitors/No Depth.md')
    await expect(q({ op: 'hasProperty', key: 'active' })).resolves.toEqual(['Competitors/Quiteful.md'])
    await expect(
      q({ op: 'startsWith', target: { key: { file: 'name' } }, value: { lit: 'Ingr' } })
    ).resolves.toEqual(['Competitors/Ingredifind.md'])
  })

  it('composes and/or/not and treats a bare property as its truthiness', async () => {
    const index = build()
    const page = await index.rows({
      now: 0,
      filter: {
        op: 'and',
        args: [
          { op: 'inFolder', folder: 'Competitors' },
          { op: 'not', arg: { op: 'truthy', arg: { key: { prop: 'active' } } } },
          { op: 'or', args: [{ op: 'cmp', cmp: '==', left: { key: { prop: 'depth' } }, right: { lit: 'Deep' } }, { op: 'hasProperty', key: 'pillars' }] },
        ],
      },
    })
    // `active` absent reads as not-true too, so Ingredifind (depth Deep) is in.
    expect(paths(page.items)).toEqual(['Competitors/Ingredifind.md', 'Competitors/Quiteful.md'])
  })

  it('sorts by a typed key, empties last, direction honoured, path as the tie-break', async () => {
    const index = build()
    const desc = await index.rows({ now: 0, filter: { op: 'inFolder', folder: 'Competitors' }, sort: [{ key: { prop: 'score' }, direction: 'desc' }] })
    expect(paths(desc.items)).toEqual([
      'Competitors/No Depth.md', // `010` is text; against numbers it orders naturally, as 10
      'Competitors/Ingredifind.md',
      'Competitors/Quiteful.md',
      'Competitors/Nested.md', // no score at all: last
    ])
    const byDate = await index.rows({ now: 0, filter: { op: 'hasProperty', key: 'verified' }, sort: [{ key: { prop: 'verified' }, direction: 'asc' }] })
    expect(paths(byDate.items)).toEqual(['Competitors/Quiteful.md', 'Competitors/Ingredifind.md'])
    const byMtime = await index.rows({ now: 0, sort: [{ key: { file: 'mtime' }, direction: 'desc' }], filter: { op: 'inFolder', folder: 'Competitors' } })
    expect(paths(byMtime.items).slice(0, 2)).toEqual(['Competitors/Ingredifind.md', 'Competitors/Quiteful.md'])
  })

  it('pages like every other list and keeps the order stable across pages', async () => {
    const index = build()
    const first = await index.rows({ now: 0, sort: [{ key: { file: 'name' }, direction: 'asc' }] }, { limit: 3 })
    expect(first.items).toHaveLength(3)
    expect(first.total).toBe(DOCS.length)
    expect(first.nextCursor).not.toBeNull()
    const second = await index.rows({ now: 0, sort: [{ key: { file: 'name' }, direction: 'asc' }] }, { limit: 3, cursor: first.nextCursor! })
    expect(new Set([...paths(first.items), ...paths(second.items)]).size).toBe(6)
  })

  it('follows a text change on the next query — derived, never stored', async () => {
    const index = build()
    index.upsert({ guid: 'g-nodepth', path: 'Competitors/No Depth.md', text: '---\nthreat: adjacent\ndepth: Shallow\n---\n' })
    const page = await index.rows({ now: 0, filter: { op: 'cmp', cmp: '==', left: { key: { prop: 'depth' } }, right: { lit: 'Shallow' } } })
    expect(paths(page.items)).toEqual(['Competitors/No Depth.md'])
    index.remove('g-nodepth')
    expect((await index.rows({ now: 0, filter: { op: 'hasProperty', key: 'depth' } })).total).toBe(2)
  })
})

describe('today() and calendar arithmetic', () => {
  it('today() is the local calendar day as UTC midnight, like a date-only value', async () => {
    const lateEvening = Date.UTC(2026, 5, 3, 3, 30) // 23:30 on June 2 in UTC-4
    expect(todayOf(lateEvening, -240)).toBe(Date.UTC(2026, 5, 2))
    expect(todayOf(lateEvening, 0)).toBe(Date.UTC(2026, 5, 3))
    const index = build()
    const same: RowFilter = { op: 'cmp', cmp: '==', left: { key: { prop: 'verified' } }, right: { now: 'today' } }
    expect(paths((await index.rows({ filter: same, now: lateEvening, tzOffsetMinutes: -240 })).items)).toEqual(['Competitors/Ingredifind.md'])
    expect(paths((await index.rows({ filter: same, now: lateEvening })).items)).toEqual([])
  })

  it('adds months on the calendar, clamped to the month’s end', async () => {
    const index = build()
    index.upsert({ guid: 'g-jan', path: 'Dates/Jan.md', text: '---\ndue: 2026-02-28\n---\n' })
    const inOneMonth: RowFilter = { op: 'cmp', cmp: '==', left: { key: { prop: 'due' } }, right: { dateAdd: { now: 'today' }, duration: '1M', sign: 1 } }
    expect(paths((await index.rows({ filter: inOneMonth, now: Date.UTC(2026, 0, 31) })).items)).toEqual(['Dates/Jan.md'])
  })

  it('two links are equal when they point at the same note, however spelled', async () => {
    const index = build()
    index.upsert({ guid: 'g-clusters', path: 'Pillars/Clusters.md', text: '# Clusters\n' })
    index.upsert({ guid: 'g-other', path: 'Competitors/Other.md', text: '---\npillar: "[[Pillars/Clusters]]"\n---\n' })
    const f: RowFilter = { op: 'cmp', cmp: '==', left: { key: { prop: 'pillar' } }, right: { lit: '[[Clusters]]' } }
    expect(paths((await index.rows({ filter: f, now: 0 })).items)).toEqual(['Competitors/Ingredifind.md', 'Competitors/Other.md'])
  })
})

describe('MemoryIndex.backlinks with a property', () => {
  it('lists a relation’s reverse side, derived from the links written in values', async () => {
    const index = build()
    index.upsert({ guid: 'g-clusters', path: 'Pillars/Clusters.md', text: '# Clusters\n' })
    const all = await index.backlinks('Clusters')
    expect(all.items.map((r) => [r.path, r.property])).toEqual([
      ['Competitors/Ingredifind.md', 'pillar'],
      ['Competitors/Quiteful.md', 'pillars'],
    ])
    const only = await index.backlinks('Clusters', { property: 'pillars' })
    expect(only.items.map((r) => r.path)).toEqual(['Competitors/Quiteful.md'])
    // Resolution now fills the row's link value too.
    const row = (await index.rows({ now: 0, filter: { op: 'cmp', cmp: '==', left: { key: { file: 'name' } }, right: { lit: 'Ingredifind' } } })).items[0]
    expect(row.props.pillar).toMatchObject({ kind: 'link', resolved: 'Pillars/Clusters.md' })
    expect(row.links).toContain('Pillars/Clusters.md')
  })
})

describe('MemoryIndex.propertyValues', () => {
  it('counts each distinct value once per note, most used first', async () => {
    const index = build()
    const threat = await index.propertyValues('threat')
    expect(threat.items).toEqual([
      { value: 'direct', count: 2 },
      { value: 'adjacent', count: 1 },
    ])
    const pillars = await index.propertyValues('pillars')
    expect(pillars.items.map((v) => v.value)).toEqual(['Clusters', 'Pricing'])
    expect((await index.propertyValues('nothing')).items).toEqual([])
  })
})

describe('pure helpers', () => {
  const row = (over: Partial<Row>): Row => ({
    guid: 'g',
    path: 'a.md',
    name: 'a',
    folder: '',
    ext: 'md',
    tags: [],
    links: [],
    mtime: null,
    size: 0,
    props: {},
    ...over,
  })
  const ctx = { now: 0, resolve: () => null }

  it('matchesFilter: a one-item list equals its item', () => {
    const r = row({ props: { tags: { kind: 'list', items: [{ kind: 'string', value: 'a' }] } } })
    expect(matchesFilter(r, { op: 'cmp', cmp: '==', left: { key: { prop: 'tags' } }, right: { lit: 'a' } }, ctx)).toBe(true)
  })

  it('compareRows: natural order for text with numbers', () => {
    const a = row({ path: 'a.md', props: { n: { kind: 'string', value: 'v2' } } })
    const b = row({ path: 'b.md', props: { n: { kind: 'string', value: 'v10' } } })
    expect(compareRows(a, b, [{ key: { prop: 'n' }, direction: 'asc' }])).toBeLessThan(0)
    expect(compareRows(a, b, [{ key: { prop: 'n' }, direction: 'desc' }])).toBeGreaterThan(0)
  })
})

describe('a query pinned to one note (collections DB4: membership)', () => {
  const pathIs = (path: string): RowFilter => ({ op: 'cmp', cmp: '==', left: { key: { file: 'path' } }, right: { lit: path } })
  const direct: RowFilter = { op: 'cmp', cmp: '==', left: { key: { prop: 'threat' } }, right: { lit: 'direct' } }

  it('finds the pin at the top, inside the top-level ands, on either side — and nowhere else', () => {
    expect(pinnedPath(pathIs('a.md'))).toBe('a.md')
    expect(pinnedPath({ op: 'and', args: [direct, pathIs('a.md')] })).toBe('a.md')
    expect(pinnedPath({ op: 'and', args: [direct, { op: 'and', args: [pathIs('a.md')] }] })).toBe('a.md')
    expect(pinnedPath({ op: 'cmp', cmp: '==', left: { lit: 'a.md' }, right: { key: { file: 'path' } } })).toBe('a.md')
    expect(pinnedPath({ op: 'or', args: [pathIs('a.md')] })).toBeNull()
    expect(pinnedPath({ op: 'not', arg: pathIs('a.md') })).toBeNull()
    expect(pinnedPath({ op: 'cmp', cmp: '!=', left: { key: { file: 'path' } }, right: { lit: 'a.md' } })).toBeNull()
    expect(pinnedPath({ op: 'cmp', cmp: '==', left: { key: { file: 'name' } }, right: { lit: 'a' } })).toBeNull()
    expect(pinnedPath(direct)).toBeNull()
  })

  it('answers from the one note, with the rest of the filter still deciding, and never walks the vault', async () => {
    const index = build()
    const rowOf = vi.spyOn(index as unknown as { rowOf: (e: unknown) => Row }, 'rowOf')
    const q = (rest: RowFilter, path: string) => index.rows({ filter: { op: 'and', args: [rest, pathIs(path)] }, now: 0 }, { limit: 1 })
    expect(paths((await q(direct, 'Competitors/Ingredifind.md')).items)).toEqual(['Competitors/Ingredifind.md'])
    expect(rowOf).toHaveBeenCalledTimes(1)
    // The rest of the filter refuses the note: no row, and still one look.
    expect((await q(direct, 'Competitors/Quiteful.md')).items).toEqual([])
    expect(rowOf).toHaveBeenCalledTimes(2)
    // A path the vault has not got: nothing to look at.
    expect((await q(direct, 'Nowhere.md')).items).toEqual([])
    expect(rowOf).toHaveBeenCalledTimes(2)
  })

  it('follows a rename, a removal and a rebuild', async () => {
    const index = build()
    const one = (path: string) => index.rows({ filter: pathIs(path), now: 0 }).then((p) => paths(p.items))
    index.rename('g-ingredifind', 'Competitors/Renamed.md')
    expect(await one('Competitors/Ingredifind.md')).toEqual([])
    expect(await one('Competitors/Renamed.md')).toEqual(['Competitors/Renamed.md'])
    index.remove('g-ingredifind')
    expect(await one('Competitors/Renamed.md')).toEqual([])
    index.rebuild(DOCS)
    expect(await one('Competitors/Ingredifind.md')).toEqual(['Competitors/Ingredifind.md'])
  })

  it('keeps the pin when two notes trade paths, in either order of rename and removal', async () => {
    const X = 'Competitors/Ingredifind.md'
    const Y = 'Competitors/Quiteful.md'
    // A swap, as a git checkout lands it: a to Y first, then b to X.
    const swapped = build()
    const one = (index: MemoryIndex, path: string) => index.rows({ filter: pathIs(path), now: 0 }).then((p) => p.items.map((r) => r.guid))
    swapped.rename('g-ingredifind', Y)
    swapped.rename('g-quiteful', X)
    expect(await one(swapped, Y)).toEqual(['g-ingredifind'])
    expect(await one(swapped, X)).toEqual(['g-quiteful'])

    // Another note takes the path, and only then is the old owner removed.
    const replaced = build()
    replaced.upsert({ guid: 'g-quiteful', path: X, text: '---\nthreat: adjacent\n---\n' })
    replaced.remove('g-ingredifind')
    expect(await one(replaced, X)).toEqual(['g-quiteful'])
    expect(await one(replaced, Y)).toEqual([])
  })
})
