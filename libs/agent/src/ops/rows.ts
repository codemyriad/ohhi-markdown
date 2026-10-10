import {
  compileStatement,
  compileView,
  isCollectionPath,
  keyFor,
  parseCollection,
  UnsupportedFilter,
  type CollectionSpec,
  type ViewSpec,
} from '@ohhi/collections'
import type { PropScalar, PropValue, Row, RowFilter, RowKey, RowQuery, RowSort } from '@ohhi/index'
import { OP_SCHEMAS, OpError, schemaName, type OpOutput } from '../contract.js'
import { openForRead } from '../backend.js'
import type { OpDef } from '../op.js'
import { fromIndexPage } from '../paging.js'

type Cell = OpOutput<'rows'>['rows'][number]['values'][string]

/** The rows of a collection are notes: the rule `compileView` applies. */
const NOTES_ONLY: RowFilter = { op: 'cmp', cmp: '==', left: { key: { file: 'ext' } }, right: { lit: 'md' } }

/**
 * `rows` — a collection view as records: each note as a reference plus the
 * columns asked for, filtered further by `--where` in the file's own
 * grammar. Values are what the note says (bases-shaping A1): a date as
 * written, a link as `[[target]]`, a list as an array.
 */
export const rows: OpDef<'rows'> = {
  ...OP_SCHEMAS.rows,
  async run(backend, input) {
    const index = await backend.index()
    const now = backend.clock.now()

    let spec: CollectionSpec | null = null
    let view: ViewSpec | null = null
    let collection: string | null = null
    if (input.collection !== undefined) {
      const note = await openForRead(backend, input.collection)
      if (!isCollectionPath(note.path)) throw new OpError('usage', `not a collection (a .base file): ${note.path}`, { path: note.path })
      collection = note.path
      spec = parseCollection(note.text)
      if (spec.error) throw new OpError('refused', `${note.path} is not readable YAML: ${spec.error}`, { path: note.path })
      if (input.view !== undefined) {
        const want = input.view.trim().toLowerCase()
        view = spec.views.find((v) => v.name.toLowerCase() === want) ?? null
        if (!view) {
          throw new OpError('usage', `no view ${JSON.stringify(input.view)} in ${note.path}`, {
            path: note.path,
            views: spec.views.map((v) => v.name),
          })
        }
      } else {
        view = spec.views[0] ?? null
      }
    }

    const scope = collection === null ? {} : { thisPath: collection }
    const compiled = spec && view ? compileView(spec, view, scope) : null
    const parts: RowFilter[] = compiled ? [compiled.query.filter!] : [NOTES_ONLY]
    if (input.where !== undefined) {
      try {
        parts.push(compileStatement(input.where, scope))
      } catch (e) {
        if (e instanceof UnsupportedFilter) throw new OpError('usage', `--where: ${e.message}`, { where: input.where })
        throw e
      }
    }
    const sort: RowSort[] = input.sort === undefined ? (compiled?.query.sort ?? []) : [parseSort(input.sort)]
    const query: RowQuery = { filter: { op: 'and', args: parts }, sort, now }

    // A view's `limit` caps what it shows; a page never reaches past it.
    const limit = compiled?.limit ?? null
    const page = await index.rows(query, input)
    let items = page.items
    let total = page.total
    let nextCursor = page.nextCursor
    if (limit !== null) {
      const start = cursorOffset(input.cursor)
      items = items.slice(0, Math.max(0, limit - start))
      total = total === null ? null : Math.min(total, limit)
      if (start + items.length >= limit) nextCursor = null
    }

    const columns = input.columns ?? compiled?.columns.map((c) => c.id) ?? defaultColumns(items)
    const out = fromIndexPage({ items, total, nextCursor }, (row) => ({
      path: row.path,
      name: row.name,
      values: Object.fromEntries(columns.map((id) => [id, cellOf(row, keyFor(id))])),
    }))
    const reasons = [...(compiled?.reasons ?? [])]
    for (const id of columns) if (keyFor(id) === null && !reasons.some((r) => r.includes(`\`${id}\``))) reasons.push(`\`${id}\` is not computed here`)
    return {
      schema: schemaName('rows'),
      collection,
      view: view?.name ?? null,
      columns,
      rows: out.items,
      supported: reasons.length === 0,
      reasons,
      returned: out.returned,
      total: out.total,
      nextCursor: out.nextCursor,
      coverage: await backend.coverage(),
    }
  },
}

/** `prop`, `prop:desc`, `file.mtime:asc`. */
function parseSort(raw: string): RowSort {
  const m = /^(.*?)(?::(asc|desc))?$/i.exec(raw.trim())
  const property = m?.[1]?.trim() ?? ''
  const key = property ? keyFor(property) : null
  if (!key) throw new OpError('usage', `--sort: cannot sort by ${JSON.stringify(raw)}`, { sort: raw })
  return { key, direction: m?.[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
}

/** The index's cursor is `o<offset>`; a view limit needs the offset to cap honestly. */
function cursorOffset(cursor: string | undefined): number {
  if (!cursor || !cursor.startsWith('o')) return 0
  const n = Number.parseInt(cursor.slice(1), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** With no view and no `--columns`: the name plus every property the page's rows carry. */
function defaultColumns(items: Row[]): string[] {
  const keys = new Set<string>()
  for (const row of items) for (const key of Object.keys(row.props)) keys.add(key)
  return ['file.name', ...keys]
}

function scalarCell(s: PropScalar): string | number | boolean | null {
  switch (s.kind) {
    case 'null':
      return null
    case 'string':
    case 'date':
      return s.value
    case 'number':
    case 'boolean':
      return s.value
    case 'link':
      return s.alias ? `[[${s.target}|${s.alias}]]` : `[[${s.target}]]`
  }
}

function propCell(v: PropValue | undefined): Cell {
  if (!v) return null
  return v.kind === 'list' ? v.items.map(scalarCell) : scalarCell(v)
}

function cellOf(row: Row, key: RowKey | null): Cell {
  if (!key) return null
  if ('prop' in key) return propCell(row.props[key.prop])
  switch (key.file) {
    case 'name':
      return row.name
    case 'path':
      return row.path
    case 'folder':
      return row.folder
    case 'ext':
      return row.ext
    case 'size':
      return row.size
    case 'mtime':
      return row.mtime === null ? null : new Date(row.mtime).toISOString()
    case 'tags':
      return row.tags
    case 'links':
      return row.links
  }
}
