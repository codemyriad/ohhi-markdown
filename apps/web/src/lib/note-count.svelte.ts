/**
 * What the `words` and `chars` readouts share (round 3, Q4): a count over the
 * readout's note — of the SELECTION while there is one, as Obsidian's status
 * items do. Call during component init (it registers an effect).
 *
 * The selection is read from the pane's view on `selectionchange` (CM6
 * mirrors its selection into the DOM), never mirrored into state: the Y.Doc
 * stays the source of truth and the editor never learns this exists.
 */
import { selectedTextIn } from '@ohhi/editor'
import { targetOf, type ReadoutContext } from './readouts.js'

export interface NoteCount {
  /** The note the count is about; null for an empty or a view tab. */
  readonly path: string | null
  /** The selection's count while there is one, else the note's. */
  readonly value: number
}

export function noteCount(ctx: () => ReadoutContext, count: (text: string) => number): NoteCount {
  const focused = $derived(targetOf(ctx()))
  let selectionTick = $state(0)
  $effect(() => {
    const bump = (): void => {
      selectionTick++
    }
    document.addEventListener('selectionchange', bump)
    return () => document.removeEventListener('selectionchange', bump)
  })

  const total = $derived.by(() => {
    ctx().nav.revision // any content change, from any writer
    const doc = focused.path ? ctx().workspace.docForPath(focused.path) : null
    return doc ? count(doc.getText()) : 0
  })
  const selected = $derived.by(() => {
    void selectionTick
    void ctx().nav.revision
    if (!focused.path) return null
    const host = document.querySelector(`[data-pane-id="${CSS.escape(focused.pane.id)}"]`)
    const text = selectedTextIn(host)
    return text === null ? null : count(text)
  })

  return {
    get path() {
      return focused.path
    },
    get value() {
      return selected ?? total
    },
  }
}
