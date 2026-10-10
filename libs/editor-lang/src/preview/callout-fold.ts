/**
 * Folding a callout is VIEW state (editor-usability E3, answered default): the
 * chevron collapses or opens the body in this view, and the `-` / `+` in the
 * file is only where it starts. Nothing here edits the document — a fold
 * never reaches the Y.Text, the undo history or `git diff`.
 *
 * The field remembers the choices made in this view, keyed by the header
 * line's start and mapped through every edit, so a fold survives typing above
 * it; a header that is deleted takes its choice with it.
 */
import { MapMode, StateEffect, StateField } from '@codemirror/state'

export interface CalloutFoldChoice {
  /** The header line's start offset. */
  at: number
  collapsed: boolean
}

export const setCalloutFold = StateEffect.define<CalloutFoldChoice>({
  map: (value, mapping) => ({ at: mapping.mapPos(value.at), collapsed: value.collapsed }),
})

export const calloutFolds = StateField.define<ReadonlyMap<number, boolean>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value
    if (tr.docChanged && value.size) {
      const mapped = new Map<number, boolean>()
      for (const [at, collapsed] of value) {
        // A header whose first character was deleted is not the same header.
        const pos = tr.changes.mapPos(at, 1, MapMode.TrackDel)
        if (pos !== null) mapped.set(pos, collapsed)
      }
      next = mapped
    }
    for (const effect of tr.effects) {
      if (!effect.is(setCalloutFold)) continue
      if (next === value) next = new Map(value)
      ;(next as Map<number, boolean>).set(effect.value.at, effect.value.collapsed)
    }
    return next
  },
})
