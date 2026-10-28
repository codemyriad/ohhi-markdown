/**
 * ArrowUp / ArrowDown next to a line a block widget draws.
 *
 * CM6's vertical motion skips block widgets on purpose (`posAtCoords` with a
 * scan direction steps over every non-text block: a widget is not text). Live
 * preview draws real lines as block widgets while the caret is elsewhere — the
 * frontmatter strip or properties form, a callout's title, a fence's edges, a
 * picture or a rule on its own line, a table's grid — and each of those lines
 * shows its source the moment the caret is on it. Skipping them meant the
 * arrow landed past them: two lines up over a fence edge or a callout title,
 * and from the first line of a note's body all the way to line 1 over the
 * frontmatter. The keyboard could not reach those lines at all.
 *
 * The rule: when CM6's own move would leave the caret's line and pass over the
 * line next to it, and a block widget draws that next line, the caret goes
 * onto that line instead (same column, clamped) — one line, as the key says —
 * and the active-region rule shows its source. A move inside a wrapped line,
 * or one that already lands on the next line, is CM6's own.
 *
 * `blockLineStep` is the decision, pure over the state; `blockLineKeymap`
 * binds it with the move CM6 would make (which needs the view's layout).
 */
import { Prec, type EditorState, type Extension } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'
import { previewMode } from '../read-host.js'
import { blockPreviewField } from './index.js'

/** Does a block widget replace the whole of line `n` (1-based)? */
export function blockDrawsLine(state: EditorState, n: number): boolean {
  if (n < 1 || n > state.doc.lines) return false
  const field = state.field(blockPreviewField, false)
  if (!field) return false
  const line = state.doc.line(n)
  let drawn = false
  field.decorations.between(line.from, line.to, (from, to, deco) => {
    if (deco.spec.block && from <= line.from && to >= line.to && to > from) {
      drawn = true
      return false
    }
    return undefined
  })
  return drawn
}

/**
 * Where the caret goes instead of `moved` (the head CM6's vertical motion
 * would give), or null to let CM6's move stand. `dir` is -1 for up, 1 for down.
 */
export function blockLineStep(state: EditorState, head: number, moved: number, dir: 1 | -1): number | null {
  if (state.facet(previewMode) !== 'live') return null
  const line = state.doc.lineAt(head)
  const landed = state.doc.lineAt(moved).number
  // Inside a wrapped line, or onto the very next line: nothing was skipped.
  if (landed === line.number || landed === line.number + dir) return null
  const n = line.number + dir
  if (!blockDrawsLine(state, n)) return null
  const target = state.doc.line(n)
  return target.from + Math.min(head - line.from, target.length)
}

function step(dir: 1 | -1): Command {
  return (view: EditorView) => {
    const { state } = view
    const range = state.selection.main
    if (state.selection.ranges.length !== 1 || !range.empty) return false
    if (state.facet(previewMode) !== 'live') return false
    const moved = view.moveVertically(range, dir === 1)
    const to = blockLineStep(state, range.head, moved.head, dir)
    if (to === null) return false
    view.dispatch({ selection: { anchor: to }, scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

/** ArrowUp: onto the line above when a block widget draws it. */
export const blockLineUp: Command = step(-1)
/** ArrowDown: onto the line below when a block widget draws it. */
export const blockLineDown: Command = step(1)

/**
 * Above the default keymap's `cursorLineUp` / `cursorLineDown`; the plain
 * arrows only (Shift extends a selection, which CM6 keeps). After the table
 * keys, which handle their own edge first.
 */
export function blockLineKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: 'ArrowUp', run: blockLineUp },
      { key: 'ArrowDown', run: blockLineDown },
    ])
  )
}
