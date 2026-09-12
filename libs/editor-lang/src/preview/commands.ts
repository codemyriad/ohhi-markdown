/**
 * Editing commands the Read slice adds. A checkbox click and `Mod+L` are the
 * same edit through the same path as typing: a one-character change in the
 * document, so the peer sees it, the reconciler flushes it, and `git diff`
 * shows one line (R2.3).
 */
import { EditorView, type Command } from '@codemirror/view'
import { taskOnLine } from './tasks.js'

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

function flip(task: { at: number; done: boolean }): { from: number; to: number; insert: string } {
  return { from: task.at, to: task.at + 1, insert: task.done ? ' ' : 'x' }
}
