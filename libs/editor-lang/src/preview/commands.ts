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
import type { EditorState, Line } from '@codemirror/state'
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
 * Tab on a list line: one indent unit (the editor's `indentUnit` — the vault
 * indents with a tab) at the start of every selected list line, before its
 * marker. Not a list line: false, so Tab keeps whatever it did before. The
 * caret is mapped, never moved, so a caret after a drawn bullet stays after
 * it — the atomic range is never asked to place anything.
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
  const changes = items.filter((i) => i.canNest).map((i) => ({ from: i.line.from, insert: unit }))
  if (changes.length) view.dispatch({ changes, userEvent: 'input.indent' })
  return true
}

/**
 * Shift+Tab on a list line: take one indent unit off the start of every
 * selected list line that has one (a tab, or up to a unit's width of spaces).
 * A top-level item has none; the key is still the list's, so focus does not
 * leave the editor from the middle of a list.
 */
export const outdentListItem: Command = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const lines = listLinesIn(state)
  if (!lines.length) return false
  const unit = state.facet(indentUnit)
  const width = unit === '\t' ? state.tabSize : unit.length
  const changes = []
  for (const l of lines) {
    let cut = 0
    if (l.text.startsWith('\t')) cut = 1
    else while (cut < width && l.text[cut] === ' ') cut++
    if (cut) changes.push({ from: l.from, to: l.from + cut })
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'delete.dedent' })
  return true
}
