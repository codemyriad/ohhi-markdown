/**
 * The task edit, from where it is to how it flips. A checkbox click and `Mod+L`
 * are the same edit through the same path as typing: a one-character change in
 * the document, so the peer sees it, the reconciler flushes it, and `git diff`
 * shows one line (R2.3).
 *
 * A task is a list item's first thing — `- [x] done` — which is Obsidian's rule
 * and the only form the vault uses (1,941 tasks, no `[/]` or `[-]` states).
 */
import type { Line } from '@codemirror/state'
import { EditorView, type Command } from '@codemirror/view'

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
