/**
 * Writing a `.base` file, one view at a time (bases-shaping A2, S16-Q3).
 *
 * Golden rule 2 at NODE granularity: a change to a view's sort, columns,
 * filter or grouping re-emits THAT VIEW'S NODE and nothing else — the bytes
 * before and after it, every other view, the global filters, comments
 * between views, all stay as they were. Within the node the keys the file
 * wrote and this reader does not interpret (`cardSize`, a plugin's state)
 * ride along unchanged; a comment INSIDE the node does not survive, and a
 * patch that changes nothing leaves every byte alone.
 *
 * `yaml` gives node ranges; the node is re-serialised from its JS form with
 * the change applied, re-indented to the column it started at, and spliced
 * over its old range. Nothing else is serialised. What the patcher refuses,
 * with a reason: invalid YAML, a flow-style `views: [...]` (its items have
 * no lines of their own), two `views:` keys (the reader and the patcher
 * would disagree about which), a view that is not there.
 */
import { isMap, isScalar, isSeq, parseDocument, stringify, type Document, type Node, type Pair, type YAMLSeq } from 'yaml'
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

export type PatchReason = 'invalid' | 'no-views' | 'no-such-view' | 'flow' | 'duplicate-views' | 'no-range'

export type PatchResult = { ok: true; text: string } | { ok: false; reason: PatchReason }

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

/** The file's line ending: CRLF when it has one, LF otherwise. */
const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

/** Serialise one map, indented to `column`, in the file's line ending, with no trailing newline. */
function renderNode(view: Record<string, unknown>, column: number, eol: string): string {
  const lines = stringify(view, { lineWidth: 0, indent: 2 }).trimEnd().split('\n')
  const pad = ' '.repeat(column)
  return lines.map((l, i) => (i === 0 ? l : l === '' ? '' : pad + l)).join(eol)
}

function columnOf(text: string, offset: number): number {
  return offset - (text.lastIndexOf('\n', offset - 1) + 1)
}

/** A node's value range without the line break that ends its last line. */
function valueEnd(text: string, node: Node): number {
  const end = node.range![1]
  if (text.slice(end - 2, end) === '\r\n') return end - 2
  if (text[end - 1] === '\n') return end - 1
  return end
}

interface Views {
  doc: Document
  /** The `views:` pair, when the file has one. */
  pair: Pair<Node, Node | null> | null
  /** Its sequence node, when the value is a block sequence. */
  seq: YAMLSeq<Node> | null
}

/** Parse and locate `views`, refusing the shapes the patcher cannot address. */
function locate(text: string): Views | PatchReason {
  const doc = parseDocument(text, { uniqueKeys: false })
  if (doc.errors.length) return 'invalid'
  const root = doc.contents
  if (!root || !isMap(root)) return 'no-views'
  const pairs = root.items.filter((p) => isScalar(p.key) && p.key.value === 'views') as Pair<Node, Node | null>[]
  if (pairs.length > 1) return 'duplicate-views'
  const pair = pairs[0] ?? null
  const value = pair?.value ?? null
  if (value && isSeq(value)) {
    // `views: []` is simply empty; a flow list WITH items has no lines to address.
    if (value.flow) return value.items.length === 0 ? { doc, pair, seq: null } : 'flow'
    return { doc, pair, seq: value as YAMLSeq<Node> }
  }
  return { doc, pair, seq: null }
}

function itemOf(seq: YAMLSeq<Node>, index: number): Node | null {
  const node = seq.items[index]
  return node && isMap(node) && node.range ? node : null
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Replace `views[index]`'s node with the patched one; every other byte stays. */
export function patchView(text: string, index: number, patch: ViewPatch): PatchResult {
  const found = locate(text)
  if (typeof found === 'string') return { ok: false, reason: found }
  if (!found.seq) return { ok: false, reason: 'no-views' }
  const node = itemOf(found.seq, index)
  if (!node) return { ok: false, reason: 'no-such-view' }
  const current = node.toJS(found.doc) as Record<string, unknown>
  const next = toFileForm(current, patch)
  // A patch that changes nothing leaves the bytes — and the node's own
  // quoting and comments — exactly as they were.
  if (deepEqual(next, current)) return { ok: true, text }
  const from = node.range![0]
  const to = valueEnd(text, node)
  const rendered = renderNode(next, columnOf(text, from), eolOf(text))
  return { ok: true, text: text.slice(0, from) + rendered + text.slice(to) }
}

/** What a new view is made of: its type and name, plus any of a patch's fields. */
export type NewView = { type: string; name: string } & ViewPatch

/** Append a view to `views` (creating the block when absent or empty); nothing else moves. */
export function addView(text: string, view: NewView): PatchResult {
  const found = locate(text)
  if (typeof found === 'string') return { ok: false, reason: found }
  const eol = eolOf(text)
  const { type, name, ...rest } = view
  const body = toFileForm({ type, name }, rest)
  const seqText = (column: number): string => renderNode({ views: [body] }, 0, eol).split(eol).slice(1).map((l) => ' '.repeat(column) + l).join(eol)

  if (!found.pair) {
    // No `views:` at all: the block goes at the end of the file.
    const base = text === '' || text.endsWith('\n') ? text : `${text}${eol}`
    return { ok: true, text: `${base}views:${eol}${seqText(0)}${eol}` }
  }
  const { pair, seq } = found
  if (!seq || seq.items.length === 0) {
    // `views:` with nothing, `null`, or `[]`: the sequence starts on its own
    // line under the key, as a block sequence must.
    const key = pair.key
    if (!key.range) return { ok: false, reason: 'no-range' }
    const colon = text.indexOf(':', key.range[1])
    if (colon === -1) return { ok: false, reason: 'invalid' }
    const value = pair.value
    const from = colon + 1
    const to = value && value.range ? valueEnd(text, value) : text.indexOf('\n', from) === -1 ? text.length : lineEndAt(text, from)
    const keyColumn = columnOf(text, key.range[0])
    return { ok: true, text: `${text.slice(0, from)}${eol}${seqText(keyColumn)}${text.slice(to)}` }
  }
  const last = seq.items[seq.items.length - 1] as Node
  if (!last.range) return { ok: false, reason: 'no-range' }
  // A new item takes the column of the last item's `- ` marker.
  const dashAt = text.lastIndexOf('-', last.range[0])
  const lineStart = text.lastIndexOf('\n', dashAt) + 1
  const prefix = `${text.slice(lineStart, dashAt)}- `
  const rendered = renderNode(body, prefix.length, eol)
  const at = last.range[1]
  const sep = text[at - 1] === '\n' ? '' : eol
  return { ok: true, text: `${text.slice(0, at)}${sep}${prefix}${rendered}${eol}${text.slice(at)}` }
}

/** The offset of the line break that ends the line containing `at` (or the text's end). */
function lineEndAt(text: string, at: number): number {
  const nl = text.indexOf('\n', at)
  if (nl === -1) return text.length
  return text[nl - 1] === '\r' ? nl - 1 : nl
}

/** Remove `views[index]` from its `- ` marker through its last line; nothing else moves. */
export function removeView(text: string, index: number): PatchResult {
  const found = locate(text)
  if (typeof found === 'string') return { ok: false, reason: found }
  if (!found.seq) return { ok: false, reason: 'no-views' }
  const node = found.seq.items[index] as Node | undefined
  if (!node || !node.range) return { ok: false, reason: 'no-such-view' }
  // The item's dash may sit on its own line (`-\n    type: …`): cut from that line.
  const dashAt = text.lastIndexOf('-', node.range[0])
  const lineStart = text.lastIndexOf('\n', dashAt) + 1
  return { ok: true, text: text.slice(0, lineStart) + text.slice(node.range[1]) }
}
