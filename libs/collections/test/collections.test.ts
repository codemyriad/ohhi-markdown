/**
 * @ohhi/collections — the `.base` reader, the statement grammar, the view
 * compiler against a real MemoryIndex, and the view-scoped patcher's
 * golden-rule-2 promise: only the view's bytes move.
 */
import { MemoryIndex, type IndexDoc, type Row } from '@ohhi/index'
import { describe, expect, it } from 'vitest'
import { newCollectionText, collectionName, isCollectionPath } from '../src/create.js'
import { compileStatement, UnsupportedFilter } from '../src/filter.js'
import { parseCollection } from '../src/parse.js'
import { addView, patchView, removeView } from '../src/patch.js'
import { compileView, dynamicColumnIds, folderOf, keyFor, labelFor, rowColumns } from '../src/query.js'

const BASE = `# Alex's competitor matrix
filters:
  and:
    - file.inFolder("Competitors")
    - '!file.hasTag("archived")'

properties:
  threat:
    displayName: Threat level
  file.mtime:
    displayName: Changed

views:
  - type: table
    name: All
    order:
      - file.name
      - threat
      - depth
      - verified
    sort:
      - property: verified
        direction: DESC
    columnSize:
      file.name: 220
  - type: table
    name: Threat Watch
    filters:
      and:
        - 'threat == "direct"'
        - 'verified < today() - "30d"'
    order:
      - file.name
      - verified
    limit: 10
  - type: kanban
    name: Board
    groupBy:
      property: depth
      direction: ASC
    order:
      - file.name
    cardSize: 240
  - type: table
    name: Needs formulas
    order:
      - file.name
      - formula.age
`

const note = (guid: string, path: string, fm: string, body = ''): IndexDoc => ({ guid, path, text: `---\n${fm}\n---\n${body}` })

const DOCS: IndexDoc[] = [
  note('a', 'Competitors/Ingredifind.md', 'threat: direct\ndepth: Deep\nverified: 2026-06-02\npillar: "[[Clusters]]"'),
  note('b', 'Competitors/Quiteful.md', 'threat: adjacent\ndepth: Moderate\nverified: 2026-03-14'),
  note('c', 'Competitors/Old Direct.md', 'threat: direct\ndepth: Shallow\nverified: 2026-01-01\ntags: [archived]'),
  note('d', 'Competitors/Stale.md', 'threat: direct\nverified: 2026-04-01'),
  note('e', 'Meetings/Weekly.md', 'status: done'),
  { guid: 'base', path: 'Competitors.base', text: BASE },
]

const index = (): MemoryIndex => {
  const i = new MemoryIndex()
  i.rebuild(DOCS)
  return i
}

describe('parseCollection', () => {
  it('reads filters, properties and every view, keeping what it does not interpret', () => {
    const spec = parseCollection(BASE)
    expect(spec.error).toBeNull()
    expect(spec.issues).toEqual([])
    expect(spec.filters).toEqual({ and: ['file.inFolder("Competitors")', '!file.hasTag("archived")'] })
    expect(spec.properties.threat).toEqual({ displayName: 'Threat level' })
    expect(spec.views.map((v) => [v.index, v.type, v.name])).toEqual([
      [0, 'table', 'All'],
      [1, 'table', 'Threat Watch'],
      [2, 'kanban', 'Board'],
      [3, 'table', 'Needs formulas'],
    ])
    expect(spec.views[0].sort).toEqual([{ property: 'verified', direction: 'desc' }])
    expect(spec.views[0].columnSize).toEqual({ 'file.name': 220 })
    expect(spec.views[1].limit).toBe(10)
    expect(spec.views[2].groupBy).toEqual({ property: 'depth', direction: 'asc' })
    expect(spec.views[2].extra).toEqual({ cardSize: 240 })
  })

  it('names formulas and summaries as not computed, and refuses nothing', () => {
    const spec = parseCollection('formulas:\n  age: "(now() - file.ctime).days"\nsummaries:\n  x: values.mean()\nviews:\n  - type: table\n    name: A\n')
    expect(spec.issues).toEqual(['formulas are not computed here', 'summaries are not computed here'])
    expect(spec.views).toHaveLength(1)
  })

  it('never throws: invalid YAML is an error with words, an empty file is a collection with no views', () => {
    expect(parseCollection('views: [\n').error).toMatch(/./)
    expect(parseCollection('').views).toEqual([])
    expect(parseCollection('- a\n').error).toMatch(/not a map/)
  })

  it('reads a single statement as the whole filter and tolerates a view with no name', () => {
    const spec = parseCollection('filters: file.hasTag("book")\nviews:\n  - type: list\n')
    expect(spec.filters).toBe('file.hasTag("book")')
    expect(spec.views[0].name).toBe('View 1')
  })
})

describe('compileStatement — the subset', () => {
  const c = (s: string) => compileStatement(s, { thisPath: 'Bases/Competitors.base' })

  it('compiles comparisons, functions, methods and boolean composition', () => {
    expect(c('status == "done"')).toEqual({ op: 'cmp', cmp: '==', left: { key: { prop: 'status' } }, right: { lit: 'done' } })
    expect(c('note.priority >= 3')).toEqual({ op: 'cmp', cmp: '>=', left: { key: { prop: 'priority' } }, right: { lit: 3 } })
    expect(c('file.hasTag("a", "b")')).toEqual({ op: 'hasTag', tags: ['a', 'b'] })
    expect(c('file.inFolder("X/Y")')).toEqual({ op: 'inFolder', folder: 'X/Y' })
    expect(c('file.hasLink("Competitors")')).toEqual({ op: 'hasLink', target: 'Competitors' })
    expect(c('file.hasProperty("due")')).toEqual({ op: 'hasProperty', key: 'due' })
    expect(c('pillars.contains("Pricing")')).toEqual({ op: 'contains', target: { key: { prop: 'pillars' } }, value: { lit: 'Pricing' } })
    expect(c('file.tags.containsAny("a", "b")')).toEqual({ op: 'containsAny', target: { key: { file: 'tags' } }, values: [{ lit: 'a' }, { lit: 'b' }] })
    expect(c('!depth.isEmpty()')).toEqual({ op: 'not', arg: { op: 'isEmpty', target: { key: { prop: 'depth' } } } })
    expect(c('file.name.startsWith("2026")')).toEqual({ op: 'startsWith', target: { key: { file: 'name' } }, value: { lit: '2026' } })
    expect(c('done')).toEqual({ op: 'truthy', arg: { key: { prop: 'done' } } })
    expect(c('a == 1 && (b == 2 || !c)')).toEqual({
      op: 'and',
      args: [
        { op: 'cmp', cmp: '==', left: { key: { prop: 'a' } }, right: { lit: 1 } },
        { op: 'or', args: [{ op: 'cmp', cmp: '==', left: { key: { prop: 'b' } }, right: { lit: 2 } }, { op: 'not', arg: { op: 'truthy', arg: { key: { prop: 'c' } } } }] },
      ],
    })
  })

  it('compiles dates: now(), today(), date("…") and ± a duration', () => {
    expect(c('verified < today() - "30d"')).toEqual({
      op: 'cmp',
      cmp: '<',
      left: { key: { prop: 'verified' } },
      right: { dateAdd: { now: 'today' }, duration: '30d', sign: -1 },
    })
    expect(c('due <= now() + "1 week"')).toMatchObject({ right: { dateAdd: { now: 'now' }, duration: '1 week', sign: 1 } })
    expect(c('date("2026-01-01") <= verified')).toEqual({ op: 'cmp', cmp: '<=', left: { lit: '2026-01-01' }, right: { key: { prop: 'verified' } } })
  })

  it('substitutes this.file.* from where the collection is shown', () => {
    expect(c('file.inFolder(this.file.folder)')).toEqual({ op: 'inFolder', folder: 'Bases' })
    expect(c('file.hasLink(this.file.name)')).toEqual({ op: 'hasLink', target: 'Competitors' })
    expect(() => compileStatement('file.inFolder(this.file.folder)')).toThrow(UnsupportedFilter)
  })

  it('binds ! tighter than a comparison, compares a condition to a boolean, and translates escapes', () => {
    expect(c('!a.isEmpty() && b')).toEqual({ op: 'and', args: [{ op: 'not', arg: { op: 'isEmpty', target: { key: { prop: 'a' } } } }, { op: 'truthy', arg: { key: { prop: 'b' } } }] })
    expect(c('a.isEmpty() == false')).toEqual({ op: 'not', arg: { op: 'isEmpty', target: { key: { prop: 'a' } } } })
    expect(c('false == a.isEmpty()')).toEqual({ op: 'not', arg: { op: 'isEmpty', target: { key: { prop: 'a' } } } })
    expect(c('a.isEmpty() != false')).toEqual({ op: 'isEmpty', target: { key: { prop: 'a' } } })
    expect(() => c('!a == "b"')).toThrow(UnsupportedFilter)
    expect(c('x == "a\\nb"')).toEqual({ op: 'cmp', cmp: '==', left: { key: { prop: 'x' } }, right: { lit: 'a\nb' } })
  })

  it('refuses a duration the evaluator would not read', () => {
    expect(() => c('due < now() - "1 min"')).toThrow(UnsupportedFilter)
    expect(() => c('due < now() - "30"')).toThrow(UnsupportedFilter)
    expect(c('due < now() - "1 minute"')).toMatchObject({ right: { duration: '1 minute' } })
  })

  it('refuses the rest with the statement in the message', () => {
    for (const s of ['formula.age > 3', 'price * 2 > 10', 'file.ctime > 1', 'name.lower() == "x"', 'if(a, b, c)', 'a ==', '"open', 'file']) {
      expect(() => c(s)).toThrow(UnsupportedFilter)
    }
    try {
      c('formula.age > 3')
    } catch (e) {
      expect((e as Error).message).toContain('formula.age > 3')
    }
  })
})

describe('compileView against the index', () => {
  it('runs the global and view filters as one query, with sort and columns', async () => {
    const spec = parseCollection(BASE)
    const all = compileView(spec, spec.views[0])
    expect(all.supported).toBe(true)
    expect(all.columns.map((col) => col.label)).toEqual(['Name', 'Threat level', 'Depth', 'Verified'])
    const rows = await index().rows({ ...all.query, now: 0 })
    // The archived one is excluded, the `.base` is not a note, Meetings is elsewhere.
    expect(rows.items.map((r) => r.name)).toEqual(['Ingredifind', 'Stale', 'Quiteful'])
  })

  it('answers a relative-date view from the instant the caller passes', async () => {
    const spec = parseCollection(BASE)
    const watch = compileView(spec, spec.views[1])
    expect(watch.limit).toBe(10)
    const rows = await index().rows({ ...watch.query, now: Date.UTC(2026, 5, 15) })
    expect(rows.items.map((r) => r.name)).toEqual(['Stale'])
  })

  it('shows a property listed twice once', () => {
    const spec = parseCollection('views:\n  - type: table\n    name: A\n    order:\n      - file.name\n      - status\n      - status\n')
    expect(compileView(spec, spec.views[0]).columns.map((c) => c.id)).toEqual(['file.name', 'status'])
  })

  it('compiles grouping and marks what it cannot compute without refusing the view', () => {
    const spec = parseCollection(BASE)
    const board = compileView(spec, spec.views[2])
    expect(board.groupBy).toEqual({ key: { prop: 'depth' }, direction: 'asc', id: 'depth' })
    expect(board.supported).toBe(true)
    const formulas = compileView(spec, spec.views[3])
    expect(formulas.supported).toBe(false)
    expect(formulas.reasons).toEqual(['`formula.age` is not computed here'])
    expect(formulas.columns[1]).toEqual({ id: 'formula.age', label: 'Age', key: null })
  })

  it('folderOf finds the first inFolder', () => {
    const spec = parseCollection(BASE)
    expect(folderOf(spec.filters)).toBe('Competitors')
    expect(folderOf('file.hasTag("x")')).toBeNull()
    expect(folderOf({ and: ['file.inFolder(this.file.folder)'] }, { thisPath: 'Team/Competitors.base' })).toBe('Team')
  })

  it('keyFor and labelFor', () => {
    expect(keyFor('file.basename')).toEqual({ file: 'name' })
    expect(keyFor('note.x')).toEqual({ prop: 'x' })
    expect(keyFor('file.ctime')).toBeNull()
    expect(labelFor('due_date', { properties: {} })).toBe('Due date')
    expect(labelFor('file.mtime', { properties: {} })).toBe('Mtime')
    expect(labelFor('x', { properties: { 'note.x': { displayName: 'Ex' } } })).toBe('Ex')
  })
})

describe('patchView — golden rule 2', () => {
  it('changes one view’s sort and touches no other byte', () => {
    const out = patchView(BASE, 1, { sort: [{ property: 'file.name', direction: 'asc' }] })
    expect(out.ok).toBe(true)
    const text = (out as { text: string }).text
    const before = BASE.indexOf('  - type: table\n    name: Threat Watch')
    const after = BASE.indexOf('  - type: kanban')
    expect(text.slice(0, before)).toBe(BASE.slice(0, before))
    expect(text.slice(text.indexOf('  - type: kanban'))).toBe(BASE.slice(after))
    const spec = parseCollection(text)
    expect(spec.views[1].sort).toEqual([{ property: 'file.name', direction: 'asc' }])
    expect(spec.views[1].limit).toBe(10)
    expect(spec.views[1].filters).toEqual(parseCollection(BASE).views[1].filters)
  })

  it('keeps keys it does not interpret, drops a sort set to empty, writes Obsidian’s key order', () => {
    const out = patchView(BASE, 2, { sort: [], order: ['file.name', 'threat'], groupBy: null, limit: 5 })
    const text = (out as { text: string }).text
    const spec = parseCollection(text)
    expect(spec.views[2].extra).toEqual({ cardSize: 240 })
    expect(spec.views[2].groupBy).toBeNull()
    expect(spec.views[2].order).toEqual(['file.name', 'threat'])
    expect(spec.views[2].limit).toBe(5)
    const node = text.slice(text.indexOf('  - type: kanban'), text.indexOf('  - type: table\n    name: Needs'))
    expect(node.indexOf('name:')).toBeLessThan(node.indexOf('order:'))
    expect(node.indexOf('order:')).toBeLessThan(node.indexOf('limit:'))
  })

  it('is a no-op when the bytes would not change, and refuses what it cannot address', () => {
    const spec = parseCollection(BASE)
    const same = patchView(BASE, 0, { sort: spec.views[0].sort })
    expect(same).toEqual({ ok: true, text: BASE })
    expect(patchView(BASE, 9, { limit: 1 })).toEqual({ ok: false, reason: 'no-such-view' })
    // The same bytes under a different spelling of the same sort: still a no-op.
    expect(patchView(BASE, 0, { sort: [{ property: 'verified', direction: 'desc' }] })).toEqual({ ok: true, text: BASE })
    expect(patchView('views: [\n', 0, { limit: 1 })).toEqual({ ok: false, reason: 'invalid' })
    expect(patchView('filters: a\n', 0, { limit: 1 })).toEqual({ ok: false, reason: 'no-views' })
  })

  it('writes a filter tree back as statements the reader reads again', () => {
    const out = patchView(BASE, 0, { filters: { and: ['depth == "Deep"', 'file.hasTag("x")'] } })
    const spec = parseCollection((out as { text: string }).text)
    expect(spec.views[0].filters).toEqual({ and: ['depth == "Deep"', 'file.hasTag("x")'] })
    expect(compileView(spec, spec.views[0]).supported).toBe(true)
  })
})

describe('patchView — the shapes it refuses, and the ones it must get right', () => {
  it('refuses a flow-style views list, two views keys and invalid YAML, naming the reason', () => {
    const flow = 'views: [{type: table, name: A}, {type: list, name: B}]\n'
    expect(patchView(flow, 0, { limit: 5 })).toEqual({ ok: false, reason: 'flow' })
    expect(removeView(flow, 0)).toEqual({ ok: false, reason: 'flow' })
    expect(addView(flow, { type: 'table', name: 'C' })).toEqual({ ok: false, reason: 'flow' })
    const twice = 'views:\n  - type: table\n    name: A\nviews:\n  - type: table\n    name: B\n'
    expect(patchView(twice, 0, { limit: 1 })).toEqual({ ok: false, reason: 'duplicate-views' })
  })

  it('keeps CRLF files CRLF', () => {
    const crlf = 'views:\r\n  - type: table\r\n    name: A\r\n  - type: list\r\n    name: B\r\n'
    const out = patchView(crlf, 0, { limit: 5 })
    expect(out).toEqual({ ok: true, text: 'views:\r\n  - type: table\r\n    name: A\r\n    limit: 5\r\n  - type: list\r\n    name: B\r\n' })
    const added = addView(crlf, { type: 'table', name: 'C' })
    expect((added as { text: string }).text.includes('\n  - type: table\r\n    name: C\r\n')).toBe(true)
    expect((added as { text: string }).text.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(true)
  })

  it('leaves a node byte-identical when the patch changes nothing, quoting and comments included', () => {
    const text = "views:\n  - type: table\n    name: A\n    limit: 10 # ten\n    filters:\n      and:\n        - 'threat == \"direct\"'\n"
    expect(patchView(text, 0, { limit: 10 })).toEqual({ ok: true, text })
    expect(patchView(text, 0, { filters: { and: ['threat == "direct"'] } })).toEqual({ ok: true, text })
  })

  it('adds a view under an empty or null views key as a block sequence, and after a dash-only item', () => {
    for (const empty of ['filters: x\nviews: []\n', 'filters: x\nviews:\n', 'filters: x\nviews: null\n']) {
      const out = addView(empty, { type: 'table', name: 'A' })
      expect(out.ok).toBe(true)
      const spec = parseCollection((out as { text: string }).text)
      expect(spec.error).toBeNull()
      expect(spec.filters).toBe('x')
      expect(spec.views.map((v) => v.name)).toEqual(['A'])
    }
    const dash = 'views:\n  -\n    type: table\n    name: A\n'
    const removed = removeView(dash, 0)
    expect(removed).toEqual({ ok: true, text: 'views:\n' })
    const back = addView((removed as { text: string }).text, { type: 'list', name: 'B' })
    expect(parseCollection((back as { text: string }).text).views.map((v) => v.name)).toEqual(['B'])
  })

  it('remove the last view, then add one: the file stays readable', () => {
    const one = 'filters: file.hasTag("x")\nviews:\n  - type: table\n    name: A\n'
    const removed = removeView(one, 0) as { text: string }
    expect(parseCollection(removed.text)).toMatchObject({ error: null, views: [], issues: [] })
    const added = addView(removed.text, { type: 'table', name: 'B' }) as { text: string }
    expect(parseCollection(added.text).views.map((v) => v.name)).toEqual(['B'])
  })
})

describe('addView / removeView', () => {
  it('appends a view after the last one, at its indentation', () => {
    const out = addView(BASE, { type: 'list', name: 'Quick', order: ['file.name'] })
    const text = (out as { text: string }).text
    expect(text.startsWith(BASE.trimEnd())).toBe(true)
    const spec = parseCollection(text)
    expect(spec.views.map((v) => v.name)).toEqual(['All', 'Threat Watch', 'Board', 'Needs formulas', 'Quick'])
    expect(spec.views[4].type).toBe('list')
  })

  it('writes a board with its grouping and sort, in the file’s own spelling', () => {
    const out = addView('views: []\n', { type: 'kanban', name: 'Board', order: ['file.name'], groupBy: { property: 'status', direction: 'asc' }, sort: [{ property: 'due', direction: 'desc' }] })
    expect((out as { text: string }).text).toBe(
      'views:\n  - type: kanban\n    name: Board\n    groupBy:\n      property: status\n      direction: ASC\n    order:\n      - file.name\n    sort:\n      - property: due\n        direction: DESC\n'
    )
  })

  it('creates the views block when there is none', () => {
    const out = addView('filters: file.hasTag("x")\n', { type: 'table', name: 'A' })
    const spec = parseCollection((out as { text: string }).text)
    expect(spec.filters).toBe('file.hasTag("x")')
    expect(spec.views.map((v) => v.name)).toEqual(['A'])
  })

  it('removes one view and leaves the others as they were', () => {
    const out = removeView(BASE, 1)
    const text = (out as { text: string }).text
    const spec = parseCollection(text)
    expect(spec.views.map((v) => v.name)).toEqual(['All', 'Board', 'Needs formulas'])
    expect(text.slice(text.indexOf('  - type: kanban'))).toBe(BASE.slice(BASE.indexOf('  - type: kanban')))
  })
})

describe('new collections', () => {
  it('writes one table view over a folder, in the file’s own grammar', () => {
    const text = newCollectionText({ folder: 'Competitors', columns: ['threat', 'depth'] })
    const spec = parseCollection(text)
    expect(spec.error).toBeNull()
    expect(folderOf(spec.filters)).toBe('Competitors')
    expect(spec.views[0]).toMatchObject({ type: 'table', name: 'All', order: ['file.name', 'threat', 'depth'] })
    expect(compileView(spec, spec.views[0]).supported).toBe(true)
    expect(parseCollection(newCollectionText({ folder: '' })).filters).toBeNull()
  })

  it('writes no `order` when no columns are given, so the columns follow the notes', () => {
    const text = newCollectionText({ folder: 'Competitors' })
    expect(text).toBe('filters:\n  and:\n    - file.inFolder("Competitors")\nviews:\n  - type: table\n    name: All\n')
    const spec = parseCollection(text)
    expect(spec.views[0]!.order).toBeNull()
    const compiled = compileView(spec, spec.views[0]!)
    expect(compiled.dynamicColumns).toBe(true)
    expect(compiled.columns).toEqual([])
  })
  it('names and recognises the file', () => {
    expect(collectionName('Team/Competitors.base')).toBe('Competitors')
    expect(isCollectionPath('x/y.BASE')).toBe(true)
    expect(isCollectionPath('x/y.md')).toBe(false)
  })
})

describe('columns that follow the notes (QA round 1)', () => {
  const rows = [
    { props: { threat: { kind: 'string', value: 'direct' }, depth: { kind: 'string', value: 'Deep' } } },
    { props: { verified: { kind: 'date', value: '2026-01-01', ms: 0 }, threat: { kind: 'string', value: 'x' } } },
    { props: {} },
  ] as unknown as Pick<Row, 'props'>[]

  it('an absent `order` is null; a written one, even empty, is kept as written', () => {
    const spec = parseCollection('views:\n  - type: table\n    name: A\n  - type: table\n    name: B\n    order: []\n  - type: table\n    name: C\n    order:\n      - file.name\n')
    expect(spec.views.map((v) => v.order)).toEqual([null, [], ['file.name']])
    expect(spec.views.map((v) => compileView(spec, v).dynamicColumns)).toEqual([true, false, false])
  })

  it('the name, then every key in order of first appearance across the rows as sorted', () => {
    expect(dynamicColumnIds(rows)).toEqual(['file.name', 'threat', 'depth', 'verified'])
    expect(dynamicColumnIds([])).toEqual(['file.name'])
    const cols = rowColumns({ properties: { threat: { displayName: 'Threat level' } } }, rows)
    expect(cols.map((c) => c.label)).toEqual(['Name', 'Threat level', 'Depth', 'Verified'])
    expect(cols[1]!.key).toEqual({ prop: 'threat' })
  })

  it('a patch that materialises the columns writes `order` into that view alone', () => {
    const text = 'views:\n  - type: table\n    name: A\n  - type: list\n    name: B\n'
    const out = patchView(text, 0, { order: ['file.name', 'threat'] })
    expect(out).toEqual({ ok: true, text: 'views:\n  - type: table\n    name: A\n    order:\n      - file.name\n      - threat\n  - type: list\n    name: B\n' })
  })
})

