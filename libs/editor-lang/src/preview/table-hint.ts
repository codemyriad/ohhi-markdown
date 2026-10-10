/**
 * The table hint toolbar (E4, the approved mock): while the caret is in a
 * table, a small bar floats above it — `Tab next cell · ↵ next row · ↵ on an
 * empty row: done` as hints,
 * then `+ row`, `+ column` and `Align` as buttons that run the `table.*`
 * commands. Live and Source; never Reading (nothing to edit there).
 *
 * A CM6 tooltip, styled in libs/editor/theme.ts (`.cm-table-hint`), so it
 * scrolls with the text and needs no shell overlay. Its copy arrives through
 * `readHost`'s labels, like every other string a widget prints.
 */
import { StateField, type EditorState } from '@codemirror/state'
import { showTooltip, type EditorView, type Tooltip } from '@codemirror/view'
import { FALLBACK_TABLE_LABELS, previewMode, readHost } from '../read-host.js'
import { runTableCommand, tableNodeAt, type TableCommandId } from './table-commands.js'

/** Where the hint sits: the start of the table the caret is in, or null. */
function hintAt(state: EditorState): number | null {
  if (state.readOnly || state.facet(previewMode) === 'reading') return null
  if (state.selection.ranges.length !== 1) return null
  return tableNodeAt(state, state.selection.main.head)?.from ?? null
}

function tooltipAt(pos: number): Tooltip {
  return { pos, above: true, create: createHint }
}

function createHint(view: EditorView): { dom: HTMLElement } {
  const t = view.state.facet(readHost).labels.table ?? FALLBACK_TABLE_LABELS
  const dom = document.createElement('div')
  dom.className = 'cm-table-hint'
  dom.setAttribute('role', 'toolbar')
  dom.setAttribute('aria-label', t.toolbar)
  const hint = (text: string): void => {
    const span = document.createElement('span')
    span.className = 'cm-table-hint-key'
    span.textContent = text
    dom.appendChild(span)
  }
  const button = (text: string, id: TableCommandId): void => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cm-table-hint-button'
    b.textContent = text
    // Keep the editor's focus and selection: the command acts at the caret.
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      runTableCommand(view, id)
      view.focus()
    })
    dom.appendChild(b)
  }
  hint(t.nextCell)
  hint(t.nextRow)
  hint(t.leave)
  button(t.addRow, 'table.insert-row-below')
  button(t.addColumn, 'table.insert-column-right')
  button(t.align, 'table.align')
  return { dom }
}

/**
 * The tooltip, kept as the SAME object while the caret stays in the same
 * table — CM6 rebuilds a tooltip's DOM whenever the object changes, and a bar
 * that flickered on every keystroke would be worse than none.
 */
export const tableHint = StateField.define<Tooltip | null>({
  create(state) {
    const pos = hintAt(state)
    return pos === null ? null : tooltipAt(pos)
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && tr.startState.facet(previewMode) === tr.state.facet(previewMode)) {
      return value
    }
    const pos = hintAt(tr.state)
    if (pos === null) return null
    return value && value.pos === pos ? value : tooltipAt(pos)
  },
  provide: (f) => showTooltip.from(f),
})
