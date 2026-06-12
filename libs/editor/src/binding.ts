/**
 * The sanctioned yjs-importing module (engine-seam exception — see
 * docs/architecture/overview.md, dependency rule 3). Collab bindings are
 * engine-coupled by nature: they reach the engine-native Y.Doc only through
 * `EngineDoc.raw()` and live here, in one clearly-marked file.
 *
 * TODO(V2): vendor y-codemirror.next into libs/editor/vendor/ with its MIT
 * LICENSE before V2 — upstream is dormant (plans/V1-plan.md, Dependencies).
 */
import type { Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { EngineDoc } from '@editor/sync'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

export interface CollabUser {
  name: string
  color: string
}

/**
 * CM6 extensions binding a view to `doc`'s Y.Text plus remote
 * cursors/selections via awareness. When `awareness` is null (standalone /
 * relay-less use) a local Awareness over the same ydoc is created so the
 * cursor layer still works; it lives as long as the ydoc.
 *
 * Undo/redo comes from yCollab's Y.UndoManager (bound via
 * yUndoManagerKeymap), NOT @codemirror/commands history() — CM6 history
 * would also undo remote peers' edits.
 */
export function createCollabExtensions(
  doc: EngineDoc,
  awareness: Awareness | null,
  user: CollabUser
): Extension[] {
  const ydoc = doc.raw() as Y.Doc
  // 'content' is the engine's text key (libs/sync/src/yjs-engine.ts).
  const ytext = ydoc.getText('content')
  const aw = awareness ?? new Awareness(ydoc)
  aw.setLocalStateField('user', { name: user.name, color: user.color })
  return [yCollab(ytext, aw), keymap.of(yUndoManagerKeymap)]
}
