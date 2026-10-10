/**
 * Table editing in the editor (E4): the keys and the `table.*` commands, over
 * the pure operations in `table-ops.ts`.
 *
 * Every operation is ONE transaction with `userEvent: 'input.table'`, so the
 * collab undo manager takes it back in one step, and the change is the
 * smallest single replacement that turns the old table into the new one — a
 * peer's caret elsewhere in the table stays where it was, and `git diff`
 * shows the padding that moved and nothing else. Only the table under the
 * caret is ever rewritten, and only when a table key or command runs (golden
 * rule 2: an alignment is an edit the user asked for, never a side effect of
 * opening or saving the note).
 *
 * The container prefix of each line (a list item's indent, a quote's `> `) is
 * kept byte for byte; a new row borrows the delimiter row's, which is always a
 * continuation prefix.
 */
import { completionStatus } from '@codemirror/autocomplete'
import { Prec, type EditorState, type Extension, type Line } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { previewMode } from '../read-host.js'
import { ancestorNamed, treeAt } from '../tree.js'
import { applyTableOp, locate, offsetIn, splitRow, type TableOp } from './table-ops.js'

const CONTINUATION = /^(?:[ \t]*>)*[ \t]*/
const TABLE = new Set(['Table'])

/** The `Table` node the position is in, or null. */
export function tableNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = treeAt(state, pos)
  const line = state.doc.lineAt(pos)
  // The caret at a line's very end, or in the indent before its first pipe,
  // is still on the table's line: try the caret, then the line's content.
  const firstText = line.from + (line.text.length - line.text.trimStart().length)
  for (const [at, side] of [
    [pos, 1],
    [pos, -1],
    [firstText, 1],
  ] as const) {
    const node = ancestorNamed(state, at, TABLE, side, tree)
    if (node) return node
  }
  return null
}

/** Is the main selection inside a table? The palette's `when` for `table.*`. */
export function inTable(state: EditorState): boolean {
  return tableNodeAt(state, state.selection.main.head) !== null
}

/** A table's lines, split into the container prefix and the table text. */
export interface TableBlock {
  from: number
  to: number
  lines: Line[]
  prefixes: string[]
  bodies: string[]
}

export function tableBlock(state: EditorState, node: SyntaxNode): TableBlock {
  const { doc } = state
  const first = doc.lineAt(node.from)
  const last = doc.lineAt(node.to)
  const lines: Line[] = []
  for (let n = first.number; n <= last.number; n++) lines.push(doc.line(n))
  const prefixes = lines.map((l, i) =>
    i === 0 ? doc.sliceString(l.from, node.from) : (CONTINUATION.exec(l.text)?.[0] ?? '')
  )
  const bodies = lines.map((l, i) => l.text.slice(prefixes[i].length))
  return { from: first.from, to: last.to, lines, prefixes, bodies }
}

/**
 * Run one table operation at the main selection's head. False — so the key
 * falls through — when the view is read-only, the caret is not in a table, or
 * the operation has nothing to do.
 */
export function runTableOp(view: EditorView, op: TableOp): boolean {
  const { state } = view
  if (state.readOnly) return false
  const head = state.selection.main.head
  const node = tableNodeAt(state, head)
  if (!node) return false
  const block = tableBlock(state, node)
  const row = state.doc.lineAt(head).number - block.lines[0].number
  const ch = head - block.lines[row].from - block.prefixes[row].length
  const edit = applyTableOp(block.bodies, locate(block.bodies[row], row, Math.max(0, ch)), op)
  if (!edit) return false

  const continuation = block.prefixes[1] ?? block.prefixes[0]
  const prefixes = edit.lines.map((_, i) => block.prefixes[i] ?? continuation)
  const next = edit.lines.map((l, i) => prefixes[i] + l)
  const before = state.doc.sliceString(block.from, block.to)
  const after = next.join('\n')

  // The caret, in the new text.
  let caret = block.from
  for (let i = 0; i < edit.focus.row; i++) caret += next[i].length + 1
  caret += prefixes[edit.focus.row].length + offsetIn(edit.lines[edit.focus.row], edit.focus.col, edit.focus.offset)

  // One minimal replacement: the common head and tail stay untouched.
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before[start] === after[start]) start++
  let end = 0
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  const changes =
    before === after
      ? []
      : [{ from: block.from + start, to: block.to - end, insert: after.slice(start, after.length - end) }]
  view.dispatch({
    changes,
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: 'input.table',
  })
  return true
}

/** One caret, no open completion: the only state the table keys act in. */
function plainCaret(view: EditorView): boolean {
  const { state } = view
  // An open completion owns Tab and Enter (E1: Tab accepts it).
  if (completionStatus(state) === 'active') return false
  return state.selection.ranges.length === 1
}

const key =
  (op: TableOp): Command =>
  (view) =>
    plainCaret(view) && runTableOp(view, op)

/** Tab: align the table, then move to the next cell (a new row past the last). */
export const tableNextCell: Command = key('next-cell')
/** Shift-Tab: align, then the previous cell. */
export const tablePrevCell: Command = key('prev-cell')
/**
 * Enter on the table's LAST row when every cell of it is empty (the row the
 * previous Enter or Tab just made): the row comes out and the caret leaves
 * the table — Advanced Tables' way out, so Enter alone can finish a table.
 * The row's line becomes a blank line and the caret goes onto a fresh line
 * after it: GFM (and lezer) read ANY non-blank line right under a table as
 * one more row, so without the blank line the next words typed would be.
 * Both lines keep the container prefix (a quote's `>`, a list item's indent),
 * so the caret stays in the block the table is in. One `input.table`
 * transaction; false anywhere else.
 */
export function exitEmptyLastRow(view: EditorView): boolean {
  const { state } = view
  if (state.readOnly) return false
  const head = state.selection.main.head
  const node = tableNodeAt(state, head)
  if (!node) return false
  const block = tableBlock(state, node)
  const row = state.doc.lineAt(head).number - block.lines[0].number
  // A body row (the header and the delimiter row are 0 and 1), and the last.
  if (row < 2 || row !== block.lines.length - 1) return false
  if (!splitRow(block.bodies[row]).every((c) => c.text.trim() === '')) return false
  const line = block.lines[row]
  const prefix = block.prefixes[row]
  const insert = `${prefix.trimEnd()}\n${prefix}`
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.table',
  })
  return true
}

/**
 * Enter: align, then the same column one row down (a new row past the last);
 * on an empty last row, out of the table (`exitEmptyLastRow`).
 */
export const tableNextRow: Command = (view) =>
  plainCaret(view) && (exitEmptyLastRow(view) || runTableOp(view, 'next-row'))

/**
 * ArrowDown / ArrowUp onto a Live grid. The grid is a block widget, and CM6's
 * vertical motion steps OVER a block widget rather than into the text it
 * replaces — so from the line above, ArrowDown would land below the table and
 * the keyboard could never reach it. When the next line in that direction is
 * a table drawn as a grid, the caret goes onto its edge line instead (same
 * column, clamped), which makes the table active and shows its source.
 */
function enterGrid(dir: 1 | -1): Command {
  return (view) => {
    const { state } = view
    if (state.facet(previewMode) !== 'live') return false
    const range = state.selection.main
    if (state.selection.ranges.length !== 1 || !range.empty) return false
    const line = state.doc.lineAt(range.head)
    const n = line.number + dir
    if (n < 1 || n > state.doc.lines) return false
    if (tableNodeAt(state, range.head)) return false
    const target = state.doc.line(n)
    const node = tableNodeAt(state, target.from)
    if (!node) return false
    // Only the table's own edge line: the line above its header, or below its last row.
    if (dir === 1 ? state.doc.lineAt(node.from).number !== n : state.doc.lineAt(node.to).number !== n) return false
    const col = Math.min(range.head - line.from, target.length)
    view.dispatch({ selection: { anchor: target.from + col }, scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

/** ArrowDown from the line above a Live grid: onto its header line. */
export const tableEnterBelow: Command = enterGrid(1)
/** ArrowUp from the line below a Live grid: onto its last row. */
export const tableEnterAbove: Command = enterGrid(-1)

/**
 * The table keys, above everything that also wants Tab and Enter — list
 * indent and E2's paragraph Tab (`Prec.high` in libs/editor), markdown's
 * list-continuing Enter (`Prec.high`). They answer false outside a table, so
 * those still run everywhere else; and they stand aside while a completion
 * is open, so accepting it still wins. Escape is not bound. The arrows only
 * act on the line next to a Live grid (see `enterGrid`).
 */
export function tableKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: 'Tab', run: tableNextCell, shift: tablePrevCell },
      { key: 'Enter', run: tableNextRow },
      { key: 'ArrowDown', run: tableEnterBelow },
      { key: 'ArrowUp', run: tableEnterAbove },
    ])
  )
}

// --- the palette's table -----------------------------------------------------

export type TableCommandId =
  | 'table.insert-row-below'
  | 'table.insert-column-right'
  | 'table.delete-row'
  | 'table.delete-column'
  | 'table.align'
  | 'table.move-row-up'
  | 'table.move-row-down'
  | 'table.move-column-left'
  | 'table.move-column-right'

export interface TableCommand {
  id: TableCommandId
  run: Command
}

const command =
  (op: TableOp): Command =>
  (view) =>
    runTableOp(view, op)

/**
 * The `table.*` commands, palette-only (no default key, no bar entry). A
 * separate list from libs/editor's `FORMAT_COMMANDS` because they act on the
 * table under the caret and are offered only while there is one.
 */
export const TABLE_COMMANDS: readonly TableCommand[] = [
  { id: 'table.insert-row-below', run: command('insert-row-below') },
  { id: 'table.insert-column-right', run: command('insert-column-right') },
  { id: 'table.delete-row', run: command('delete-row') },
  { id: 'table.delete-column', run: command('delete-column') },
  { id: 'table.align', run: command('format') },
  { id: 'table.move-row-up', run: command('move-row-up') },
  { id: 'table.move-row-down', run: command('move-row-down') },
  { id: 'table.move-column-left', run: command('move-column-left') },
  { id: 'table.move-column-right', run: command('move-column-right') },
]

/** Run a `table.*` command by id on a view; false when it did nothing. */
export function runTableCommand(view: EditorView, id: TableCommandId): boolean {
  return TABLE_COMMANDS.find((c) => c.id === id)?.run(view) ?? false
}

/**
 * The caret position for a click on grid cell (`row`, `col`) of the table
 * starting at `pos` — `row` counts the header as 0 and skips the delimiter
 * row, as the grid draws it. The caret goes to the end of the cell's text.
 */
export function cellPosition(state: EditorState, pos: number, row: number, col: number): number | null {
  const node = tableNodeAt(state, pos)
  if (!node) return null
  const block = tableBlock(state, node)
  const index = row === 0 ? 0 : row + 1
  const line = block.lines[index]
  if (!line) return null
  return line.from + block.prefixes[index].length + offsetIn(block.bodies[index], col, 'end')
}
