/**
 * The selected text of the editor mounted inside `root`, for a readout that
 * lives outside the view (the toolbar's selection-aware word count,
 * quiet-shell F6). Read through `EditorView.findFromDOM`, so the host never
 * holds a view or mirrors the selection into its own state: it asks when it
 * redraws. Null when there is no editor there or nothing is selected.
 */
import { EditorView } from '@codemirror/view'

export function selectedTextIn(root: ParentNode | null | undefined): string | null {
  const dom = root?.querySelector<HTMLElement>('.cm-editor')
  if (!dom) return null
  const view = EditorView.findFromDOM(dom)
  if (!view) return null
  const { ranges } = view.state.selection
  if (ranges.every((r) => r.empty)) return null
  return ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join('\n')
}
