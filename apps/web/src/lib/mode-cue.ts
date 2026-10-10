/**
 * The pane mode's corner cue (E6, Settings › Layout › Hints): which of a
 * live mode's hint rows the *Subtle* line shows. Pure — the rows are
 * `mode.ts`'s `hints()`, already translated and filtered to what runs.
 *
 * Two verbs per mode, the ones reached for most; `?` opens the rest. An id
 * names a command (`workspace.split-right`) or a collapsed family
 * (`workspace.focus` — the `h j k l` row).
 */
import type { Hint, Mode } from './mode.js'

export const CUE_VERBS: Readonly<Record<Mode, readonly string[]>> = {
  pane: ['workspace.focus', 'workspace.split-right'],
  move: ['workspace.move'],
  resize: ['workspace.resize', 'workspace.equalize'],
  tab: ['tab.goto', 'tab.close'],
  group: ['group.new', 'group.toggle'],
}

/** Whether a hint row stands for `id`: the command itself, or every member of its family. */
function rowIs(hint: Hint, id: string): boolean {
  if (hint.ids.length === 0) return false
  if (hint.ids.length === 1 && hint.ids[0] === id) return true
  return hint.ids.length > 1 && hint.ids.every((i) => i.startsWith(`${id}-`))
}

/** The cue's rows for `mode`, in `CUE_VERBS` order; a verb whose row is absent (refused, unregistered) is skipped. */
export function cueHints(mode: Mode, rows: readonly Hint[]): Hint[] {
  const out: Hint[] = []
  for (const id of CUE_VERBS[mode]) {
    const row = rows.find((h) => rowIs(h, id))
    if (row && !out.includes(row)) out.push(row)
  }
  return out
}
