/**
 * Reading a `.base` file (bases-shaping A2). `yaml` parses — it is the one
 * YAML reader in the repo, as in `@ohhi/frontmatter` — and this file turns
 * the document into a `CollectionSpec`, keeping every key it does not
 * interpret on the view's `extra` so the patcher writes it back untouched.
 *
 * Never throws: a collection is a file someone may be typing in Source
 * mode, and the view asks on every change. Invalid YAML → `error` set,
 * `views` empty, and the tab shows the words.
 */
import { isMap, isSeq, parseDocument } from 'yaml'
import type { CollectionSpec, FilterTree, PropertyConfig, SortDirection, ViewSort, ViewSpec } from './types.js'

const VIEW_KEYS = new Set(['type', 'name', 'filters', 'order', 'sort', 'groupBy', 'limit', 'columnSize'])
const TOP_KEYS = new Set(['filters', 'properties', 'views'])

export function parseCollection(text: string): CollectionSpec {
  const empty: CollectionSpec = { filters: null, properties: {}, views: [], issues: [], error: null }
  let raw: unknown
  try {
    const doc = parseDocument(text, { uniqueKeys: false })
    if (doc.errors.length) return { ...empty, error: doc.errors[0].message.split('\n')[0] }
    raw = doc.toJS()
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
  if (raw === null || raw === undefined) return empty
  if (!isRecord(raw)) return { ...empty, error: 'the file is not a map of filters, properties and views' }

  const issues: string[] = []
  for (const key of Object.keys(raw)) {
    if (TOP_KEYS.has(key)) continue
    issues.push(key === 'formulas' ? 'formulas are not computed here' : key === 'summaries' ? 'summaries are not computed here' : `\`${key}\` is not read`)
  }

  const filters = readFilters(raw.filters, issues, 'filters')
  const properties: Record<string, PropertyConfig> = {}
  if (isRecord(raw.properties)) {
    for (const [key, value] of Object.entries(raw.properties)) {
      const cfg: PropertyConfig = {}
      if (isRecord(value) && typeof value.displayName === 'string') cfg.displayName = value.displayName
      properties[key] = cfg
    }
  }

  const views: ViewSpec[] = []
  if (Array.isArray(raw.views)) {
    raw.views.forEach((v, index) => {
      if (!isRecord(v)) {
        issues.push(`view ${index + 1} is not a map`)
        return
      }
      views.push(readView(v, index, issues))
    })
  } else if (raw.views !== undefined) {
    issues.push('`views` is not a list')
  }
  return { filters, properties, views, issues, error: null }
}

function readView(v: Record<string, unknown>, index: number, issues: string[]): ViewSpec {
  const type = typeof v.type === 'string' ? v.type : 'table'
  const name = typeof v.name === 'string' ? v.name : `View ${index + 1}`
  const order = Array.isArray(v.order) ? v.order.filter((o): o is string => typeof o === 'string') : []
  const sort: ViewSort[] = []
  if (Array.isArray(v.sort)) {
    for (const s of v.sort) {
      if (isRecord(s) && typeof s.property === 'string') sort.push({ property: s.property, direction: direction(s.direction) })
    }
  }
  const groupBy =
    isRecord(v.groupBy) && typeof v.groupBy.property === 'string'
      ? { property: v.groupBy.property, direction: direction(v.groupBy.direction) }
      : null
  const limit = typeof v.limit === 'number' && Number.isFinite(v.limit) && v.limit > 0 ? Math.floor(v.limit) : null
  const columnSize: Record<string, number> = {}
  if (isRecord(v.columnSize)) {
    for (const [k, n] of Object.entries(v.columnSize)) if (typeof n === 'number') columnSize[k] = n
  }
  const extra: Record<string, unknown> = {}
  for (const [k, value] of Object.entries(v)) if (!VIEW_KEYS.has(k)) extra[k] = value
  return {
    index,
    type,
    name,
    filters: readFilters(v.filters, issues, `view "${name}"`),
    order,
    sort,
    groupBy,
    limit,
    columnSize,
    extra,
  }
}

/** `and`/`or`/`not` nodes over statements, any depth; one statement alone is fine. */
function readFilters(raw: unknown, issues: string[], where: string): FilterTree | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string') return raw.trim() ? raw : null
  if (isRecord(raw)) {
    const keys = Object.keys(raw)
    const op = keys.find((k) => k === 'and' || k === 'or' || k === 'not')
    if (keys.length === 1 && op) {
      const list = Array.isArray(raw[op]) ? (raw[op] as unknown[]) : [raw[op]]
      const items = list.map((item) => readFilters(item, issues, where)).filter((f): f is FilterTree => f !== null)
      if (op === 'and') return { and: items }
      if (op === 'or') return { or: items }
      return { not: items }
    }
  }
  issues.push(`${where}: a filter must be a statement or one and/or/not block`)
  return null
}

function direction(raw: unknown): SortDirection {
  return typeof raw === 'string' && raw.toUpperCase() === 'DESC' ? 'desc' : 'asc'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `isMap`/`isSeq` re-exported for the patcher's node walk. */
export { isMap, isSeq }
