/**
 * Where the `[ ]` / `[x]` on a line is, if there is one.
 *
 * One definition, three callers: the checkbox widget's click, the `Mod+L`
 * command, and the tests. A task is a list item's first thing — `- [x] done` —
 * which is Obsidian's rule and the only form the vault uses (1,941 tasks, no
 * `[/]` or `[-]` states).
 */
import type { Line } from '@codemirror/state'

const TASK = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\]/

export interface TaskState {
  /** Absolute offset of the single character between the brackets. */
  at: number
  done: boolean
}

export function taskOnLine(line: Line): TaskState | null {
  const m = TASK.exec(line.text)
  if (!m) return null
  return { at: line.from + m[0].length - 2, done: m[1] !== ' ' }
}
