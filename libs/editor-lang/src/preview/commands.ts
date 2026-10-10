/**
 * The task edit, from where it is to how it flips. A checkbox click and `Mod+L`
 * are the same edit through the same path as typing: a one-character change in
 * the document, so the peer sees it, the reconciler flushes it, and `git diff`
 * shows one line (R2.3).
 *
 * A task is a list item's first thing — `- [x] done` — which is Obsidian's rule
 * and the only form the vault uses (1,941 tasks, no `[/]` or `[-]` states).
 */
import { indentUnit, syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type Line } from '@codemirror/state'
import { EditorView, type Command } from '@codemirror/view'
import { previewMode } from '../read-host.js'

/**
 * Indent, one or more list markers, then the brackets. More than one marker
 * because a nested item can sit on one line — `- - [ ] x` is what markdown's
 * own Enter binding writes when you continue a list and type a task — and the
 * checkbox WIDGET comes from the tree, which sees the nested item. If this
 * regex did not, the box would be drawn and refuse to be clicked.
 */
const TASK = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)+\[([ xX])\]/

export interface TaskState {
  /** Absolute offset of the single character between the brackets. */
  at: number
  done: boolean
}

export function taskOnLine(line: Line): TaskState | null {
  const m = TASK.exec(line.text)
  return m ? { at: line.from + m[0].length - 2, done: m[1] !== ' ' } : null
}

/** Flip `[ ]` ↔ `[x]` on every line the main selection touches. */
export const toggleTask: Command = (view) => {
  const { state } = view
  // Reading is read-only, and the mode menu is how you leave it; a key that
  // silently edited an uneditable view would be worse than one that does not.
  if (state.readOnly) return false
  const { from, to } = state.selection.main
  const changes = []
  const last = state.doc.lineAt(to).number
  for (let n = state.doc.lineAt(from).number; n <= last; n++) {
    const task = taskOnLine(state.doc.line(n))
    if (task) changes.push(flip(task))
  }
  if (changes.length === 0) return false
  view.dispatch({ changes, userEvent: 'input' })
  return true
}

/**
 * Toggle the task on the line at `pos` — what the checkbox widget's click
 * does. Deliberately NOT gated on `readOnly`: Reading is about markers, not
 * about edits, and a checkbox there is still a checkbox (R2.3).
 */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const task = taskOnLine(view.state.doc.lineAt(pos))
  if (!task) return false
  view.dispatch({ changes: flip(task), userEvent: 'input' })
  return true
}

function flip(task: TaskState): { from: number; to: number; insert: string } {
  return { from: task.at, to: task.at + 1, insert: task.done ? ' ' : 'x' }
}

/**
 * The drawn list marker that ENDS at `pos`, if there is one: a bullet's `- `
 * (with its spaces), or a task's whole `- [ ] ` when `pos` is after the box.
 * `from` is the marker's first character. Ordered numbers are text already
 * and are not drawn markers, so they are not returned.
 */
export function listMarkerBefore(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos)
  const skip = (at: number): number => {
    while (at < line.to && /[ \t]/.test(state.doc.sliceString(at, at + 1))) at++
    return at
  }
  let found: { from: number; to: number } | null = null
  syntaxTree(state).iterate({
    from: line.from,
    to: Math.min(pos, line.to),
    enter: (node) => {
      if (node.name !== 'ListMark') return
      const item = node.node.parent
      if (item?.parent?.name !== 'BulletList') return
      const end = skip(node.to)
      if (end === node.to) return
      const box = item.getChild('Task')?.getChild('TaskMarker')
      const to = box && box.from === end ? skip(box.to) : end
      if (pos === to || pos === end) found = { from: node.from, to: pos }
    },
  })
  return found
}

/**
 * Backspace from the start of a list item's text, in Live (Chris, 2026-10-06).
 * The marker is drawn and atomic, so the default Backspace would take the
 * whole `- ` in one keystroke you cannot see coming, and markdown's own
 * binding would turn it into indentation. Instead the FIRST Backspace selects
 * the marker — which is the marker's caret rule: selected means raw, so the
 * `- ` is text again, highlighted — and the second deletes it like any
 * selection. No document change until the person asks for one.
 */
export const selectListMarker: Command = (view) => {
  const { state } = view
  if (state.readOnly || state.facet(previewMode) !== 'live') return false
  const { ranges, main } = state.selection
  if (ranges.length !== 1 || !main.empty) return false
  const marker = listMarkerBefore(state, main.head)
  if (!marker) return false
  view.dispatch({ selection: { anchor: marker.to, head: marker.from }, userEvent: 'select' })
  return true
}

/**
 * The list-item lines a selection touches (Chris, 2026-10-06: "on a bullet
 * point tab should allow me to indent it"). A line counts when the TREE puts a
 * list marker on it — bullet, ordered or task — so a `-` in a fence or a
 * paragraph is not a list line. A selection that ends at the very start of a
 * line does not take that line along (it selected the line above's break).
 */
export function listLinesIn(state: EditorState): Line[] {
  return listItemsIn(state).map((i) => i.line)
}

interface ListLine {
  line: Line
  /** The item has an earlier sibling in its list — something to nest under. */
  canNest: boolean
}

function listItemsIn(state: EditorState): ListLine[] {
  const tree = syntaxTree(state)
  const seen = new Set<number>()
  const out: ListLine[] = []
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    let last = state.doc.lineAt(r.to).number
    if (!r.empty && last > first && state.doc.lineAt(r.to).from === r.to) last--
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      let found: ListLine | null = null
      tree.iterate({
        from: line.from,
        to: line.to,
        enter: (node) => {
          if (found) return false
          if (node.name !== 'ListMark' || node.from < line.from || node.from > line.to) return
          found = { line, canNest: node.node.parent?.prevSibling?.name === 'ListItem' }
        },
      })
      if (found) out.push(found)
    }
  }
  return out
}

/**
 * The end of a list line's drawn marker, as an offset into the line: indent,
 * one or more markers with their spaces, then a task's box and its space.
 * Where the item's TEXT starts — the side of the bullet a caret belongs on.
 */
const MARKER = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)+(?:\[[ xX]\][ \t]?)?/

export function markerEnd(text: string): number {
  return MARKER.exec(text)?.[0].length ?? 0
}

/**
 * Where a selection lands after the list lines under it moved: every
 * endpoint shifted by what was inserted before it (or removed from before it)
 * on its own line, and a CARET that was in the marker — the indent, the dash —
 * put after the marker, at the text, so it is on the text side of the drawn
 * bullet. Set explicitly rather than mapped (Chris, 2026-10-10: the caret
 * flashed before the bullet on Tab): a mapped caret after a widget is the
 * DOM's to place, and the browser placed it on the wrong side for a frame.
 * `assoc: 1` ties the caret to the text after it, never the widget before it.
 *
 * Pure: `edits` are the line edits about to be dispatched, in the old
 * document's offsets (`delta` > 0 inserted at `from`, < 0 removed from it).
 */
export function selectionAfterListEdit(
  state: EditorState,
  edits: readonly { line: Line; delta: number }[]
): EditorSelection {
  const byLine = new Map(edits.map((e) => [e.line.number, e]))
  // Total shift from every edit strictly before a position's line.
  const before = (lineNo: number): number => {
    let sum = 0
    for (const e of edits) if (e.line.number < lineNo) sum += e.delta
    return sum
  }
  const move = (pos: number, caret: boolean): number => {
    const line = state.doc.lineAt(pos)
    const base = before(line.number)
    const edit = byLine.get(line.number)
    if (!edit) return pos + base
    const col = pos - line.from
    // Removed: a position inside the cut collapses to its start.
    let next = edit.delta >= 0 ? col + edit.delta : Math.max(0, col + edit.delta)
    if (caret) {
      // The line as it will read (an inserted unit is whitespace either way).
      const text = edit.delta >= 0 ? ' '.repeat(edit.delta) + line.text : line.text.slice(-edit.delta)
      const end = markerEnd(text)
      if (next < end) next = end
    }
    return line.from + base + next
  }
  const ranges = state.selection.ranges.map((r) =>
    r.empty
      ? EditorSelection.cursor(move(r.head, true), 1)
      : EditorSelection.range(move(r.anchor, false), move(r.head, false))
  )
  return EditorSelection.create(ranges, state.selection.mainIndex)
}

/**
 * Tab on a list line: one indent unit (the editor's `indentUnit` — the vault
 * indents with a tab) at the start of every selected list line, before its
 * marker. Not a list line: false, so Tab keeps whatever it did before. The
 * selection is SET, not mapped (`selectionAfterListEdit`): a caret after a
 * drawn bullet stays after it, on the text side.
 *
 * The outliner rule: an item nests only under an earlier sibling. The first
 * item of a list has nothing to nest under, and a tab in front of it would make
 * it an indented code block — the bullet gone, the text in a slab — so that
 * line stays put (the key is still consumed).
 */
export const indentListItem: Command = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const items = listItemsIn(state)
  if (!items.length) return false
  const unit = state.facet(indentUnit)
  const edits = items.filter((i) => i.canNest).map((i) => ({ line: i.line, delta: unit.length }))
  if (edits.length) {
    view.dispatch({
      changes: edits.map((e) => ({ from: e.line.from, insert: unit })),
      selection: selectionAfterListEdit(state, edits),
      userEvent: 'input.indent',
    })
  }
  return true
}

/**
 * Shift+Tab on a list line: take one indent unit off the start of every
 * selected list line that has one (a tab, or up to a unit's width of spaces).
 * A top-level item has none; the key is still the list's, so focus does not
 * leave the editor from the middle of a list. The selection is set as Tab's.
 */
export const outdentListItem: Command = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const lines = listLinesIn(state)
  if (!lines.length) return false
  const unit = state.facet(indentUnit)
  const width = unit === '\t' ? state.tabSize : unit.length
  const edits: { line: Line; delta: number }[] = []
  for (const l of lines) {
    let cut = 0
    if (l.text.startsWith('\t')) cut = 1
    else while (cut < width && l.text[cut] === ' ') cut++
    if (cut) edits.push({ line: l, delta: -cut })
  }
  if (edits.length) {
    view.dispatch({
      changes: edits.map((e) => ({ from: e.line.from, to: e.line.from - e.delta })),
      selection: selectionAfterListEdit(state, edits),
      userEvent: 'delete.dedent',
    })
  }
  return true
}

/**
 * Tab off a list line, in Live and Source (E2): one indent unit at the caret —
 * a tab, the vault's unit — rather than the browser moving focus out of the
 * note mid-sentence. With text selected it indents the selected lines, which
 * is what every editor's Tab does over a selection. Keyboard escape is CM6's
 * tab-focus mode, untouched: Escape, then Tab, leaves the editor (and
 * `Ctrl-m` / `Shift-Alt-m` on macOS toggles it). Read-only: false, so Tab is
 * the browser's again in Reading.
 */
export const insertIndent: Command = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const unit = state.facet(indentUnit)
  if (state.selection.ranges.some((r) => !r.empty)) {
    const seen = new Set<number>()
    const changes = []
    for (const r of state.selection.ranges) {
      const first = state.doc.lineAt(r.from).number
      let last = state.doc.lineAt(r.to).number
      if (last > first && state.doc.lineAt(r.to).from === r.to) last--
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue
        seen.add(n)
        changes.push({ from: state.doc.line(n).from, insert: unit })
      }
    }
    view.dispatch({ changes, userEvent: 'input.indent' })
    return true
  }
  view.dispatch(state.update(state.replaceSelection(unit), { scrollIntoView: true, userEvent: 'input' }))
  return true
}
