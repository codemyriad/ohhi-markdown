/**
 * GFM table operations, as pure functions over lines of text (E4, fork B2).
 *
 * Why this is ours and not `@tgrosinger/md-advanced-tables` (the engine the
 * fork named): its `table.js` requires the spreadsheet-formula engine
 * unconditionally, from CommonJS, so the bundle carries lodash, decimal.js and
 * ebnf whether or not a formula is ever written — 192 kB minified / 64 kB
 * gzipped, about three quarters of it code this editor would never run, and
 * none of it tree-shakeable. What the editor needs from it is small: split a
 * row into cells, pad the columns, and move cells, rows and columns around.
 * That is this file. (The library also counts an emoji as one column; here it
 * is two, as a terminal and a monospace font draw it.)
 *
 * Everything here works on a table's lines WITHOUT their container prefix (the
 * indent of a list item, a blockquote's `> `): the editor strips those before
 * calling in and puts them back after, byte for byte (`table-commands.ts`).
 *
 * Cells keep their source exactly — `\|` stays `\|`, `**b**` stays `**b**`;
 * only the whitespace around a cell's content and the dashes of the delimiter
 * row are ever rewritten (golden rule 2: the edit is the user's, the bytes
 * inside a cell are not ours to touch).
 */

export type Align = 'none' | 'left' | 'center' | 'right'

/** A cell's content as `[from, to)` within its line, trimmed of the padding. */
export interface CellSpan {
  from: number
  to: number
  /** The content, `\|` escapes and all. */
  text: string
}

/**
 * Split one row into its cells. Leading and trailing pipes are optional (GFM);
 * an escaped `\|` is content, as it is to the lezer grammar the decorations
 * come from — the two must agree on where a cell is, or a click on the grid
 * lands in the wrong one.
 */
export function splitRow(line: string): CellSpan[] {
  const pipes: number[] = []
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '|') pipes.push(i)
  }
  // The boundaries cells sit between: an implicit edge at each end unless the
  // row opens or closes with a pipe of its own.
  const first = line.search(/\S/)
  const last = line.length - (line.length - line.trimEnd().length) - 1
  const edges = [...pipes]
  const opens = first !== -1 && pipes[0] === first
  const closes = last >= 0 && pipes[pipes.length - 1] === last && !(pipes.length === 1 && opens)
  if (!opens) edges.unshift(-1)
  if (!closes) edges.push(line.length)
  const cells: CellSpan[] = []
  for (let k = 0; k + 1 < edges.length; k++) {
    let from = edges[k] + 1
    let to = edges[k + 1]
    while (from < to && /\s/.test(line[from])) from++
    while (to > from && /\s/.test(line[to - 1])) to--
    cells.push({ from, to, text: line.slice(from, to) })
  }
  return cells
}

/** The column a delimiter cell (`:---:`, `---:`, `:--`, `-`) declares. */
export function alignOf(cell: string): Align {
  const t = cell.trim()
  const left = t.startsWith(':')
  const right = t.endsWith(':') && t.length > 1
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return 'none'
}

export interface TableModel {
  header: string[]
  aligns: Align[]
  rows: string[][]
}

/** Lines → cells. Needs at least the header and the delimiter row. */
export function parseTable(lines: readonly string[]): TableModel | null {
  if (lines.length < 2) return null
  const header = splitRow(lines[0]).map((c) => c.text)
  const aligns = splitRow(lines[1]).map((c) => alignOf(c.text))
  const rows = lines.slice(2).map((l) => splitRow(l).map((c) => c.text))
  return { header, aligns, rows }
}

// --- display width ---------------------------------------------------------

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** East Asian Wide / Fullwidth, as ranges of code points (UAX #11, abridged). */
const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

function wideCodePoint(cp: number): boolean {
  for (const [a, b] of WIDE) {
    if (cp < a) return false
    if (cp <= b) return true
  }
  return false
}

const EMOJI = /\p{Extended_Pictographic}/u
const MARK = /^\p{M}+$/u

/**
 * How many columns `text` takes in a monospace font: two for CJK and emoji,
 * none for a lone combining mark, one otherwise — per grapheme, so a flag or a
 * family emoji is one wide glyph rather than seven.
 */
export function displayWidth(text: string): number {
  let width = 0
  const graphemes = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
  for (const g of graphemes) {
    if (MARK.test(g)) continue
    const cp = g.codePointAt(0) ?? 0
    if (wideCodePoint(cp) || (EMOJI.test(g) && (g.length > 2 || g.includes('️') || cp >= 0x1f000))) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

// --- formatting ------------------------------------------------------------

function pad(text: string, width: number, align: Align): string {
  const gap = Math.max(0, width - displayWidth(text))
  if (align === 'right') return ' '.repeat(gap) + text
  if (align === 'center') {
    const left = Math.floor(gap / 2)
    return ' '.repeat(left) + text + ' '.repeat(gap - left)
  }
  return text + ' '.repeat(gap)
}

function delimiter(width: number, align: Align): string {
  const w = Math.max(width, 3)
  switch (align) {
    case 'center':
      return ':' + '-'.repeat(w - 2) + ':'
    case 'left':
      return ':' + '-'.repeat(w - 1)
    case 'right':
      return '-'.repeat(w - 1) + ':'
    default:
      return '-'.repeat(w)
  }
}

/** Every row as wide as the widest, with the header's column count at least. */
function columnCount(t: TableModel): number {
  return Math.max(t.header.length, t.aligns.length, ...t.rows.map((r) => r.length), 1)
}

/**
 * The table as aligned lines: every column padded to its widest cell (by
 * display width, at least 3 so the delimiter reads as one), the delimiter row
 * keeping each column's `:` alignment, short rows filled with empty cells.
 */
export function formatTable(t: TableModel): string[] {
  const n = columnCount(t)
  const cell = (row: readonly string[], c: number): string => row[c] ?? ''
  const aligns = Array.from({ length: n }, (_, c) => t.aligns[c] ?? 'none')
  const widths = Array.from({ length: n }, (_, c) =>
    Math.max(3, displayWidth(cell(t.header, c)), ...t.rows.map((r) => displayWidth(cell(r, c))))
  )
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  return [
    line(widths.map((w, c) => pad(cell(t.header, c), w, aligns[c]))),
    line(widths.map((w, c) => delimiter(w, aligns[c]))),
    ...t.rows.map((r) => line(widths.map((w, c) => pad(cell(r, c), w, aligns[c])))),
  ]
}

// --- the caret -------------------------------------------------------------

/**
 * Where the caret is, in table terms. `row` is the LINE index in the table
 * (0 = header, 1 = the delimiter row, 2… = body), `col` the cell, `offset` the
 * caret's distance from the start of the cell's trimmed content (clamped to
 * it, so a caret in the padding counts as the content's edge).
 */
export interface Focus {
  row: number
  col: number
  offset: number
}

/**
 * The cell `ch` (an offset into `line`) is in. A caret just before a pipe ends
 * the cell on its left; just after it, it starts the cell on its right.
 */
export function locate(line: string, row: number, ch: number): Focus {
  const cells = splitRow(line)
  if (!cells.length) return { row, col: 0, offset: 0 }
  // The cell whose span (between its pipes) holds `ch`: the last cell that
  // starts at or before it, measured from the pipe before its content.
  let col = 0
  for (let c = 0; c < cells.length; c++) {
    const start = c === 0 ? 0 : boundaryBefore(line, cells[c].from)
    if (ch >= start) col = c
  }
  const span = cells[col]
  const offset = Math.max(0, Math.min(ch - span.from, span.to - span.from))
  return { row, col, offset }
}

/** The offset just past the pipe that opens the cell whose content starts at `from`. */
function boundaryBefore(line: string, from: number): number {
  let i = from - 1
  while (i >= 0 && line[i] !== '|') i--
  return i + 1
}

/**
 * The offset of the caret in a formatted `line` for `focus`: inside the
 * cell's content, `offset` characters in (`'end'` for the end of it). An
 * empty cell puts the caret one space after its pipe, where typing lands.
 */
export function offsetIn(line: string, col: number, offset: number | 'end'): number {
  const cells = splitRow(line)
  const cell = cells[Math.min(col, cells.length - 1)]
  if (!cell) return 0
  const len = cell.to - cell.from
  if (len === 0) {
    // An empty cell's span collapsed onto the pipe after it; the caret goes
    // after the pipe before it, plus the one space of padding.
    const open = boundaryBefore(line, cell.from)
    return Math.min(open + 1, cell.from)
  }
  return cell.from + (offset === 'end' ? len : Math.min(offset, len))
}

// --- operations ------------------------------------------------------------

/** What an operation answers: the new lines, and where the caret goes in them. */
export interface TableEdit {
  lines: string[]
  /** `offset: 'end'` puts the caret at the end of the target cell's content. */
  focus: { row: number; col: number; offset: number | 'end' }
}

export type TableOp =
  | 'format'
  | 'next-cell'
  | 'prev-cell'
  | 'next-row'
  | 'insert-row-below'
  | 'insert-column-right'
  | 'delete-row'
  | 'delete-column'
  | 'move-row-up'
  | 'move-row-down'
  | 'move-column-left'
  | 'move-column-right'

const clone = (t: TableModel): TableModel => ({
  header: [...t.header],
  aligns: [...t.aligns],
  rows: t.rows.map((r) => [...r]),
})

/** Pad every row, the header and the alignments to `n` columns. */
function widen(t: TableModel, n: number): void {
  const fill = <T>(a: T[], v: T): void => {
    while (a.length < n) a.push(v)
  }
  fill(t.header, '')
  fill(t.aligns, 'none')
  for (const r of t.rows) fill(r, '')
}

/** Body row index (into `rows`) of a line index, or -1 for the header and delimiter. */
const bodyIndex = (row: number): number => (row >= 2 ? row - 2 : -1)

/**
 * Run one operation on the table in `lines` with the caret at `focus`, and
 * answer the aligned result — or null when the operation has nothing to do
 * (delete the only column, move the first row up), so the key or command can
 * say it did nothing and fall through.
 */
export function applyTableOp(lines: readonly string[], focus: Focus, op: TableOp): TableEdit | null {
  const parsed = parseTable(lines)
  if (!parsed) return null
  const t = clone(parsed)
  const n = columnCount(t)
  widen(t, n)
  // The delimiter row has no content of its own: a caret on it acts from the
  // header's cell above it, which is what a reader means.
  const row = focus.row === 1 ? 0 : Math.min(focus.row, t.rows.length + 1)
  const col = Math.min(focus.col, n - 1)
  const lastRow = t.rows.length + 1
  const at = (r: number, c: number, offset: number | 'end' = 'end'): TableEdit => ({
    lines: formatTable(t),
    focus: { row: r, col: c, offset },
  })
  const newRow = (): string[] => Array.from({ length: n }, () => '')

  switch (op) {
    case 'format':
      return at(Math.min(focus.row, lastRow), col, focus.offset)
    case 'next-cell': {
      if (col + 1 < n) return at(row, col + 1)
      if (row === 0) {
        if (!t.rows.length) t.rows.push(newRow())
        return at(2, 0)
      }
      if (row === lastRow) t.rows.push(newRow())
      return at(row + 1, 0)
    }
    case 'prev-cell': {
      if (col > 0) return at(row, col - 1)
      if (row === 0) return at(0, 0)
      return at(row === 2 ? 0 : row - 1, n - 1)
    }
    case 'next-row': {
      const next = row === 0 ? 2 : row + 1
      if (next > lastRow) t.rows.push(newRow())
      return at(next, col)
    }
    case 'insert-row-below': {
      const index = row === 0 ? 0 : bodyIndex(row) + 1
      t.rows.splice(index, 0, newRow())
      return at(index + 2, col)
    }
    case 'insert-column-right': {
      t.header.splice(col + 1, 0, '')
      t.aligns.splice(col + 1, 0, 'none')
      for (const r of t.rows) r.splice(col + 1, 0, '')
      return at(row, col + 1)
    }
    case 'delete-row': {
      if (row === 0) {
        // The header cannot go (a table without one is not a table): it is
        // emptied instead, as Advanced Tables does.
        if (t.header.every((h) => h === '')) return null
        t.header = t.header.map(() => '')
        return at(0, col)
      }
      t.rows.splice(bodyIndex(row), 1)
      // The row below takes its place; the last row's place is the one above,
      // and with no body left the caret goes back to the header.
      return at(t.rows.length ? Math.min(row, t.rows.length + 1) : 0, col)
    }
    case 'delete-column': {
      if (n <= 1) return null
      t.header.splice(col, 1)
      t.aligns.splice(col, 1)
      for (const r of t.rows) r.splice(col, 1)
      return at(row, Math.min(col, n - 2))
    }
    case 'move-row-up':
    case 'move-row-down': {
      const i = bodyIndex(row)
      const j = op === 'move-row-up' ? i - 1 : i + 1
      if (i < 0 || j < 0 || j >= t.rows.length) return null
      ;[t.rows[i], t.rows[j]] = [t.rows[j], t.rows[i]]
      return at(j + 2, col, focus.offset)
    }
    case 'move-column-left':
    case 'move-column-right': {
      const j = op === 'move-column-left' ? col - 1 : col + 1
      if (j < 0 || j >= n) return null
      const swap = <T>(a: T[]): void => {
        ;[a[col], a[j]] = [a[j], a[col]]
      }
      swap(t.header)
      swap(t.aligns)
      for (const r of t.rows) swap(r)
      return at(row, j, focus.offset)
    }
  }
}
