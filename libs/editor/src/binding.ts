/**
 * The sanctioned yjs-importing module (engine-seam exception — see
 * docs/architecture/overview.md, dependency rule 3). Collab bindings are
 * engine-coupled by nature: they reach the engine-native Y.Doc only through
 * `EngineDoc.raw()` and live here, in one clearly-marked file.
 *
 * TODO(V2): vendor y-codemirror.next into libs/editor/vendor/ with its MIT
 * LICENSE before V2 — upstream is dormant (V1-plan, Dependencies).
 */
import type { Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { EngineDoc } from '@ohhi/sync'
import type { Command } from '@codemirror/view'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { Awareness } from 'y-protocols/awareness'
import { peerLabelInk } from './peer-label.js'
import * as Y from 'yjs'

export interface CollabUser {
  name: string
  color: string
}

/**
 * The engine-native undo manager, named here so hosts can hold one without
 * importing `yjs` themselves (dependency rule 3).
 */
export type CollabUndoManager = Y.UndoManager

/** The engine's text key (libs/sync/src/yjs-engine.ts). */
const TEXT_KEY = 'content'

function textOf(doc: EngineDoc): Y.Text {
  return (doc.raw() as Y.Doc).getText(TEXT_KEY)
}

/**
 * One undo manager for a doc, owned by the HOST rather than by a view.
 *
 * `yCollab` otherwise mints `new Y.UndoManager(ytext)` per binding, so undo
 * dies with the view — and tab groups recreate the view on every tab switch
 * (tab-groups B2). Same construction, longer life: each view adds its own
 * sync config as a tracked origin on mount and removes it on destroy, so N
 * views over one doc share one stack and undo survives the switch.
 */
export function createUndoManager(doc: EngineDoc): CollabUndoManager {
  return new Y.UndoManager(textOf(doc))
}

/**
 * CM6 extensions binding a view to `doc`'s Y.Text plus remote
 * cursors/selections via awareness. When `awareness` is null (standalone /
 * relay-less use) a local Awareness over the same ydoc is created so the
 * cursor layer still works; it lives as long as the ydoc.
 *
 * Undo/redo comes from yCollab's Y.UndoManager (bound via
 * yUndoManagerKeymap), NOT @codemirror/commands history() — CM6 history
 * would also undo remote peers' edits. Pass `undoManager` to share one across
 * views of the same doc; omit it and yCollab mints a view-lifetime one.
 */
export function createCollabExtensions(
  doc: EngineDoc,
  awareness: Awareness | null,
  user: CollabUser,
  undoManager?: CollabUndoManager
): Extension[] {
  const ydoc = doc.raw() as Y.Doc
  const ytext = textOf(doc)
  const aw = awareness ?? new Awareness(ydoc)
  aw.setLocalStateField('user', { name: user.name, color: user.color })
  // Omitted entirely rather than passed as undefined: yCollab's own
  // destructuring default is what mints the per-view manager.
  const collab = undoManager ? yCollab(ytext, aw, { undoManager }) : yCollab(ytext, aw)
  // The label's ink by its fill's luminance, not one token (peer-label.ts).
  return [collab, keymap.of(yUndoManagerKeymap), peerLabelInk()]
}


/**
 * Whether `manager` records `doc`'s text — false once the doc behind a guid
 * was rebuilt (a new instance) and the manager still holds the old one.
 */
export function undoManagerFits(manager: CollabUndoManager, doc: EngineDoc): boolean {
  return manager.doc === doc.raw()
}

/**
 * The doc's undo and redo as commands — the Y.UndoManager's, never CM6's
 * history — for a surface that takes the keys itself (the properties form
 * inside a widget ignores every event, so Mod+Z inside it has to be handed
 * on). Lifted from the keymap y-codemirror.next ships, which is the only
 * place the package exports them.
 */
const bound = (key: string): Command => yUndoManagerKeymap.find((b) => b.key === key)?.run ?? (() => false)
export const undoCommand: Command = bound('Mod-z')
export const redoCommand: Command = bound('Mod-Shift-z')
