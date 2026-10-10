/**
 * The collection tab's pure half (bases-shaping A3, A4, A8): what a cell
 * shows, which editor it takes, the one `FmOp` an edit becomes, how that op
 * lands on a live doc, and the small transforms the toolbar writes back
 * through the view patcher. DOM-free so every rule is a unit test.
 *
 * ONE write path for cells (A8): an edit is `patchFrontmatter(op)` over the
 * note's live text, applied to its Y.Text in one `'local'` transaction, so
 * the sync engine flushes it, the peers see it, the index re-derives it and
 * the sync indicator is the note's own. No second writer, no YAML round
 * trip: the patcher moves the bytes of one value and nothing else (golden
 * rule 2).
 */
import type { ViewSort } from '@ohhi/collections'
import { patchFrontmatter, type FmOp, type FmPatchResult } from '@ohhi/frontmatter'
import { keyValue, propText, scalarText, type PropScalar, type PropValue, type Row, type RowKey } from '@ohhi/index'
import type { EngineDoc } from '@ohhi/sync'

/** Which editor a cell takes — from the value it holds, else from its neighbours. */
export type CellKind = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'link'

export function kindOf(value: PropValue | undefined): CellKind | null {
  if (!value || value.kind === 'null') return null
  if (value.kind === 'list') return 'list'
  if (value.kind === 'string') return 'text'
  return value.kind
}

/**
 * The editor for a column: the cell's own kind, else the kind most of the
 * column's other cells have, else text. A column of dates with one empty
 * cell edits that cell as a date.
 */
export function columnKind(value: PropValue | undefined, column: readonly (PropValue | undefined)[]): CellKind {
  const own = kindOf(value)
  if (own) return own
  const counts = new Map<CellKind, number>()
  for (const v of column) {
    const k = kindOf(v)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: CellKind = 'text'
  let n = 0
  for (const [k, c] of counts) {
    if (c > n) {
      best = k
      n = c
    }
  }
  return best
}

/** A link shows its alias when it has one, its target otherwise. */
function linkText(s: Extract<PropScalar, { kind: 'link' }>): string {
  return s.alias ?? s.target
}

/** What a cell shows. */
export function cellText(value: PropValue | undefined): string {
  if (!value) return ''
  if (value.kind === 'link') return linkText(value)
  if (value.kind === 'list') return value.items.map((i) => (i.kind === 'link' ? linkText(i) : scalarText(i))).join(', ')
  return propText(value)
}

/** What a cell's editor starts from: the value as it would be written. */
export function cellDraft(value: PropValue | undefined): string {
  if (!value || value.kind === 'null') return ''
  if (value.kind === 'list') return value.items.map(scalarText).join(', ')
  return scalarText(value)
}

/**
 * The op an edit becomes. Every editor hands back a string (or a boolean,
 * or a list); the rules here are what the frontmatter will say:
 *  - text/number/date: the text, trimmed; empty keeps the key with no value
 *  - boolean: `true` / `false`
 *  - list: comma-separated → a block list; empty → `[]`
 *  - link: `[[x]]` unless already written as one; empty keeps the key
 */
export function opFor(key: string, kind: CellKind, raw: string | boolean | string[] | null | undefined): FmOp {
  if (kind === 'boolean') return { op: 'set', key, value: raw === true || raw === 'true' }
  if (kind === 'list') {
    const items = Array.isArray(raw) ? raw : splitList(raw ?? '')
    return { op: 'set', key, value: items.map((s) => s.trim()).filter(Boolean) }
  }
  const text = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim()
  // A plain decimal is written as a number, so `score: 8` stays a number in
  // the note; what was typed is kept as text otherwise — never rewritten
  // (`1e3`, `0x10`, `-0` are text, as the index would read them).
  if (kind === 'number' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && !Object.is(Number(text), -0)) {
    return { op: 'set', key, value: Number(text) }
  }
  if (kind === 'link' && text && !/^\[\[.*\]\]$/.test(text)) return { op: 'set', key, value: `[[${text}]]` }
  return { op: 'set', key, value: text }
}

/**
 * `a, "b, c", d` → `a` · `b, c` · `d`: a comma inside quotes is part of the
 * item, and the quotes come off. What a list cell's field means.
 */
export function splitList(raw: string | boolean): string[] {
  const text = String(raw)
  const out: string[] = []
  let item = ''
  let quote: string | null = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else item += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ',') {
      out.push(item)
      item = ''
    } else {
      item += ch
    }
  }
  out.push(item)
  return out.map((s) => s.trim())
}

/**
 * Apply one op to a live doc: read its text NOW, compute the patch, write
 * the one change in one `'local'` transaction. Returns the patcher's answer
 * so the caller can say why a note was left alone (`nested`, `multiline`).
 */
export function applyFrontmatterOp(doc: EngineDoc, op: FmOp): FmPatchResult {
  const before = doc.getText()
  const result = patchFrontmatter(before, op)
  if (!result.ok || result.changes.length === 0) return result
  doc.transact((t) => {
    // Changes are against `before`, applied last-to-first so earlier offsets hold.
    for (const c of [...result.changes].sort((a, b) => b.from - a.from)) {
      if (c.to > c.from) t.delete(c.from, c.to - c.from)
      if (c.insert) t.insert(c.from, c.insert)
    }
  }, 'local')
  return result
}

/**
 * Replace a doc's whole text with `after`, as the smallest edit: the common
 * prefix and suffix stay, the middle is one delete + one insert. How the
 * collection file takes a view patch — the bytes the patcher left alone are
 * never touched, so a peer's caret in Source mode is not thrown.
 */
export function replaceDocText(doc: EngineDoc, after: string): void {
  const before = doc.getText()
  if (before === after) return
  let prefix = 0
  const max = Math.min(before.length, after.length)
  while (prefix < max && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  doc.transact((t) => {
    const removed = before.length - prefix - suffix
    if (removed > 0) t.delete(prefix, removed)
    const inserted = after.slice(prefix, after.length - suffix)
    if (inserted) t.insert(prefix, inserted)
  }, 'local')
}

/** A header click: none → ascending → descending → none, on that column alone. */
export function toggleSort(sort: readonly ViewSort[], property: string): ViewSort[] {
  const current = sort.find((s) => s.property === property)
  if (!current) return [{ property, direction: 'asc' }]
  if (current.direction === 'asc') return [{ property, direction: 'desc' }]
  return []
}

export interface RowGroup {
  /** The group's value as text; `''` for rows with none. */
  key: string
  rows: Row[]
}

/**
 * Rows bucketed by a key, groups ordered by their value (empties last),
 * rows inside keeping the view's own order. A list value groups by its
 * text, as Obsidian does.
 */
export function groupRows(rows: readonly Row[], groupBy: { key: RowKey; direction: 'asc' | 'desc' } | null): RowGroup[] {
  if (!groupBy) return [{ key: '', rows: [...rows] }]
  const buckets = new Map<string, Row[]>()
  for (const row of rows) {
    const key = cellText(keyValue(row, groupBy.key))
    const list = buckets.get(key)
    if (list) list.push(row)
    else buckets.set(key, [row])
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    const c = collator.compare(a, b)
    return groupBy.direction === 'desc' ? -c : c
  })
  return keys.map((key) => ({ key, rows: buckets.get(key)! }))
}

/** A new row's text: the view's property columns as empty keys, then an empty body. */
export function newRowText(propertyKeys: readonly string[]): string {
  if (propertyKeys.length === 0) return ''
  return `---\n${propertyKeys.map((k) => `${k}:\n`).join('')}---\n\n`
}

/** What a tab, a title or a crumb calls a file: the basename without `.md` or `.base`. */
export function displayName(path: string): string {
  const slash = path.lastIndexOf('/')
  return (slash === -1 ? path : path.slice(slash + 1)).replace(/\.(md|base)$/i, '')
}

/** `Collection.base`, then `Collection 2.base`, … — the first name not taken in `dir`. */
export function uniqueName(taken: ReadonlySet<string>, dir: string, stem: string, ext: string): string {
  const at = (name: string): string => (dir ? `${dir}/${name}` : name)
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${stem}${ext}` : `${stem} ${n}${ext}`
    if (!taken.has(at(name))) return name
  }
  return `${stem} ${Date.now()}${ext}`
}
