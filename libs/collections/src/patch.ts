/**
 * Writing a `.base` file, one view at a time (bases-shaping A2, S16-Q3).
 *
 * Golden rule 2: a change to a view's sort, columns, filter or grouping
 * re-emits THAT VIEW'S NODE and nothing else — the bytes before and after it,
 * every other view, the global filters, comments between views, all stay as
 * they were. Within the node the keys the file wrote and this reader does
 * not interpret (`cardSize`, a plugin's state) ride along unchanged.
 *
 * `yaml` gives node ranges; the node is re-serialised from its JS form with
 * the change applied, re-indented to the column it started at, and spliced
 * over its old range. Nothing else is serialised.
 */
import { isMap, isSeq, parseDocument, stringify, type Node } from 'yaml'
import type { FilterTree, SortDirection, ViewSort } from './types.js'

export interface ViewPatch {
  name?: string
  type?: string
  order?: string[]
  sort?: ViewSort[]
  groupBy?: { property: string; direction: SortDirection } | null
  limit?: number | null
  filters?: FilterTree | null
  columnSize?: Record<string, number>
}

export type PatchResult = { ok: true; text: string } | { ok: false; reason: string }

/** The key order Obsidian writes, so a file this app creates reads like one it did not. */
const KEY_ORDER = ['type', 'name', 'filters', 'groupBy', 'order', 'sort', 'limit', 'columnSize']

function orderKeys(view: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of KEY_ORDER) if (k in view) out[k] = view[k]
  for (const k of Object.keys(view)) if (!(k in out)) out[k] = view[k]
  return out
}

/** A view as the file writes it: `direction` upper-case, empty blocks dropped. */
function toFileForm(view: Record<string, unknown>, patch: ViewPatch): Record<string, unknown> {
  const next = { ...view }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.type !== undefined) next.type = patch.type
  if (patch.order !== undefined) next.order = patch.order
  if (patch.sort !== undefined) {
    if (patch.sort.length) next.sort = patch.sort.map((s) => ({ property: s.property, direction: s.direction.toUpperCase() }))
    else delete next.sort
  }
  if (patch.groupBy !== undefined) {
    if (patch.groupBy) next.groupBy = { property: patch.groupBy.property, direction: patch.groupBy.direction.toUpperCase() }
    else delete next.groupBy
  }
  if (patch.limit !== undefined) {
    if (patch.limit === null) delete next.limit
    else next.limit = patch.limit
  }
  if (patch.filters !== undefined) {
    if (patch.filters === null) delete next.filters
    else next.filters = patch.filters
  }
  if (patch.columnSize !== undefined) {
    if (Object.keys(patch.columnSize).length) next.columnSize = patch.columnSize
    else delete next.columnSize
  }
  return orderKeys(next)
}

/** Serialise one view map, indented to `column`, with no trailing newline. */
function renderView(view: Record<string, unknown>, column: number): string {
  const lines = stringify(view, { lineWidth: 0, indent: 2 }).trimEnd().split('\n')
  const pad = ' '.repeat(column)
  return lines.map((l, i) => (i === 0 ? l : l === '' ? '' : pad + l)).join('\n')
}

function columnOf(text: string, offset: number): number {
  return offset - (text.lastIndexOf('\n', offset - 1) + 1)
}

/** Replace `views[index]`'s node with the patched one; every other byte stays. */
export function patchView(text: string, index: number, patch: ViewPatch): PatchResult {
  const doc = parseDocument(text, { uniqueKeys: false })
  if (doc.errors.length) return { ok: false, reason: 'invalid' }
  const views = doc.get('views', true) as Node | undefined
  if (!views || !isSeq(views)) return { ok: false, reason: 'no-views' }
  const node = views.items[index] as Node | undefined
  if (!node || !isMap(node) || !node.range) return { ok: false, reason: 'no-such-view' }
  const from = node.range[0]
  // A block map's value range runs past the last line's newline; keep it.
  const to = text[node.range[1] - 1] === '\n' ? node.range[1] - 1 : node.range[1]
  const current = node.toJS(doc) as Record<string, unknown>
  const rendered = renderView(toFileForm(current, patch), columnOf(text, from))
  if (text.slice(from, to) === rendered) return { ok: true, text }
  return { ok: true, text: text.slice(0, from) + rendered + text.slice(to) }
}

/** Append a view to `views` (creating the block when absent); nothing else moves. */
export function addView(text: string, view: { type: string; name: string; order?: string[]; filters?: FilterTree }): PatchResult {
  const doc = parseDocument(text, { uniqueKeys: false })
  if (doc.errors.length) return { ok: false, reason: 'invalid' }
  const body = orderKeys({ type: view.type, name: view.name, ...(view.filters ? { filters: view.filters } : {}), ...(view.order ? { order: view.order } : {}) })
  const views = doc.get('views', true) as Node | undefined
  const base = text.endsWith('\n') || text === '' ? text : `${text}\n`
  if (!views || !isSeq(views) || views.items.length === 0 || !views.range) {
    const block = stringify({ views: [body] }, { lineWidth: 0, indent: 2 })
    if (views && views.range) {
      // `views:` present but empty (`views: []`): replace its value.
      const [from, to] = views.range
      return { ok: true, text: `${text.slice(0, from)}${stringify([body], { lineWidth: 0, indent: 2 }).trimEnd()}${text.slice(to)}` }
    }
    return { ok: true, text: base + block }
  }
  const last = views.items[views.items.length - 1] as Node
  if (!last.range) return { ok: false, reason: 'no-range' }
  // A new item takes the column of the last item's `- ` marker.
  const lastStart = last.range[0]
  const lineStart = text.lastIndexOf('\n', lastStart - 1) + 1
  const marker = text.slice(lineStart, lastStart)
  const dash = marker.lastIndexOf('-')
  const prefix = dash === -1 ? '  - ' : marker.slice(0, dash) + '- '
  const rendered = renderView(body, prefix.length)
  const at = last.range[1]
  const sep = text[at - 1] === '\n' ? '' : '\n'
  return { ok: true, text: `${text.slice(0, at)}${sep}${prefix}${rendered}\n${text.slice(at)}` }
}

/** Remove `views[index]` and its `- ` line; nothing else moves. */
export function removeView(text: string, index: number): PatchResult {
  const doc = parseDocument(text, { uniqueKeys: false })
  if (doc.errors.length) return { ok: false, reason: 'invalid' }
  const views = doc.get('views', true) as Node | undefined
  if (!views || !isSeq(views)) return { ok: false, reason: 'no-views' }
  const node = views.items[index] as Node | undefined
  if (!node || !node.range) return { ok: false, reason: 'no-such-view' }
  const lineStart = text.lastIndexOf('\n', node.range[0] - 1) + 1
  // The value range already runs past the last line's newline.
  return { ok: true, text: text.slice(0, lineStart) + text.slice(node.range[1]) }
}
