/**
 * A view, compiled: the file's filters (global AND view) and sort become
 * the index's structured `RowQuery`; `order` becomes the columns. A part
 * the subset refuses marks the view `supported: false` with the reason in
 * the file's words — the view still draws what it can.
 */
import type { RowFilter, RowKey, RowSort } from '@ohhi/index'
import { compileStatement, UnsupportedFilter, type FilterScope } from './filter.js'
import { VIEW_TYPES, type CollectionSpec, type Column, type FilterTree, type ViewQuery, type ViewSpec } from './types.js'

/** `file.name` → the index key; `status` / `note.status` → a property; `formula.x` → null. */
export function keyFor(property: string): RowKey | null {
  if (property.startsWith('file.')) {
    const field = property.slice(5)
    switch (field) {
      case 'name':
      case 'basename':
        return { file: 'name' }
      case 'path':
      case 'folder':
      case 'ext':
      case 'mtime':
      case 'size':
      case 'tags':
      case 'links':
        return { file: field }
      default:
        return null
    }
  }
  if (property.startsWith('formula.')) return null
  return { prop: property.startsWith('note.') ? property.slice(5) : property }
}

/** A readable header for a property written as `file.mtime` or `snake_case`. */
export function labelFor(property: string, spec: Pick<CollectionSpec, 'properties'>): string {
  const display = spec.properties[property]?.displayName ?? spec.properties[`note.${property}`]?.displayName
  if (display !== undefined) return display
  if (property === 'file.name' || property === 'file.basename') return 'Name'
  if (property.startsWith('file.')) return property.slice(5).replace(/^./, (c) => c.toUpperCase())
  const bare = property.replace(/^(note|formula)\./, '')
  return bare.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** The rows of a collection are NOTES: the implicit `file.ext == "md"` every compiled view carries. */
export const NOTES_ONLY: RowFilter = { op: 'cmp', cmp: '==', left: { key: { file: 'ext' } }, right: { lit: 'md' } }

function compileTree(tree: FilterTree, scope: FilterScope, reasons: string[]): RowFilter | null {
  if (typeof tree === 'string') {
    try {
      return compileStatement(tree, scope)
    } catch (e) {
      reasons.push(e instanceof UnsupportedFilter ? e.message : String(e))
      return null
    }
  }
  const compileAll = (items: FilterTree[]): RowFilter[] =>
    items.map((i) => compileTree(i, scope, reasons)).filter((f): f is RowFilter => f !== null)
  if ('and' in tree) return { op: 'and', args: compileAll(tree.and) }
  if ('or' in tree) return { op: 'or', args: compileAll(tree.or) }
  // `not:` lists conditions NONE of which may hold — "exclude matching items".
  return { op: 'not', arg: { op: 'or', args: compileAll(tree.not) } }
}

export function compileView(spec: CollectionSpec, view: ViewSpec, scope: FilterScope = {}): ViewQuery {
  const reasons: string[] = []
  const parts: RowFilter[] = [NOTES_ONLY]
  if (spec.filters) {
    const f = compileTree(spec.filters, scope, reasons)
    if (f) parts.push(f)
  }
  if (view.filters) {
    const f = compileTree(view.filters, scope, reasons)
    if (f) parts.push(f)
  }
  const sort: RowSort[] = []
  for (const s of view.sort) {
    const key = keyFor(s.property)
    if (key) sort.push({ key, direction: s.direction })
    else reasons.push(`sorting by \`${s.property}\` is not computed here`)
  }
  // A property listed twice shows once (first occurrence): the table keys on the id.
  const columns: Column[] = [...new Set(view.order)].map((id) => {
    const key = keyFor(id)
    if (!key) reasons.push(`\`${id}\` is not computed here`)
    return { id, label: labelFor(id, spec), key }
  })
  let groupBy: ViewQuery['groupBy'] = null
  if (view.groupBy) {
    const key = keyFor(view.groupBy.property)
    if (key) groupBy = { key, direction: view.groupBy.direction, id: view.groupBy.property }
    else reasons.push(`grouping by \`${view.groupBy.property}\` is not computed here`)
  }
  if (!(VIEW_TYPES as readonly string[]).includes(view.type)) reasons.push(`\`${view.type}\` views are not drawn here`)
  return {
    view,
    query: { filter: { op: 'and', args: parts }, sort },
    columns,
    limit: view.limit,
    groupBy,
    supported: reasons.length === 0,
    reasons,
  }
}

/** The first `file.inFolder("…")` a tree names — where "+ New" puts a note. */
export function folderOf(tree: FilterTree | null, scope: FilterScope = {}): string | null {
  if (!tree) return null
  if (typeof tree === 'string') {
    let f: RowFilter
    try {
      f = compileStatement(tree, scope)
    } catch {
      return null
    }
    return f.op === 'inFolder' ? f.folder : null
  }
  if ('and' in tree) {
    for (const item of tree.and) {
      const found = folderOf(item, scope)
      if (found !== null) return found
    }
  }
  return null
}
