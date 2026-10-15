import {
  compileStatement,
  compileView,
  dynamicColumnIds,
  isCollectionPath,
  keyFor,
  NOTES_ONLY,
  parseCollection,
  UnsupportedFilter,
  type CollectionSpec,
  type ViewSpec,
} from '@ohhi/collections'
import type { PropScalar, PropValue, Row, RowFilter, RowKey, RowQuery, RowSort } from '@ohhi/index'
import { OP_SCHEMAS, OpError, schemaName, type OpOutput } from '../contract.js'
import { openForRead } from '../read.js'
import type { OpDef } from '../op.js'
import { fromIndexPage, paginate, type PageResult } from '../paging.js'

type Cell = OpOutput<'rows'>['rows'][number]['values'][string]

/**
 * A collection with no `views:` is still a query: its global filters apply
 * through this empty view, so `rows NoViews.base` never widens to the vault.
 */
const EMPTY_VIEW: ViewSpec = { index: -1, type: 'table', name: '', filters: null, order: null, sort: [], groupBy: null, limit: null, columnSize: {}, extra: {} }

/** The index caps a page at this; a view's `limit` beyond it is read in full by paging. */
const INDEX_MAX = 1000

/**
 * `rows` — a collection view as records: each note as a reference plus the
 * columns asked for, filtered further by `--where` in the file's own
 * grammar. Values are what the note says (bases-shaping A1): a date as
 * written, a link as `[[target]]`, a list as an array. With no collection
 * at all, every note in the vault is a row (`--where` narrows it).
 */
export const rows: OpDef<'rows'> = {
  ...OP_SCHEMAS.rows,
  async run(backend, input) {
    const index = await backend.index()
    const now = backend.clock.now()
    // The reader's zone, so `today()` is their calendar day (a zone is not a clock — golden rule 5 is about scheduling). clock-exempt
    const tzOffsetMinutes = -new Date().getTimezoneOffset() // clock-exempt

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
    const compiled = spec ? compileView(spec, view ?? EMPTY_VIEW, scope) : null
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
    const query: RowQuery = { filter: { op: 'and', args: parts }, sort, now, tzOffsetMinutes }

    // A view's `limit` caps what it shows. The capped set is read once and
    // paged HERE, with this package's own cursor — the index's cursor is
    // opaque to every caller, this op included.
    const limit = compiled?.limit ?? null
    let page: PageResult<Row>
    if (limit === null) {
      page = fromIndexPage(await index.rows(query, input), (row) => row)
    } else {
      const capped: Row[] = []
      let cursor: string | undefined
      while (capped.length < limit) {
        const chunk = await index.rows(query, { limit: Math.min(limit - capped.length, INDEX_MAX), cursor })
        capped.push(...chunk.items)
        if (!chunk.nextCursor || chunk.items.length === 0) break
        cursor = chunk.nextCursor
      }
      page = paginate(capped, input)
    }

    const columns =
      input.columns?.length ? input.columns : compiled?.columns.length ? compiled.columns.map((c) => c.id) : defaultColumns(page.items)
    const out = page.items.map((row) => ({
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
      rows: out,
      supported: reasons.length === 0,
      reasons,
      returned: out.length,
      total: page.total,
      nextCursor: page.nextCursor,
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

/** With no view columns and no `--columns`: the name plus every property the page's rows carry — the app's rule for a view with no `order`. */
function defaultColumns(items: Row[]): string[] {
  return dynamicColumnIds(items)
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
