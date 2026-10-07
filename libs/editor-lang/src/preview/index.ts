/**
 * Live preview, assembled (read-shaping.md B2, R7).
 *
 * TWO sources, because CM6 forces the split and performance rewards it:
 *
 * - **A StateField for block decorations** — a rule, a fence's edges, an embed
 *   on its own line, the frontmatter strip, a Reading table. These change the
 *   vertical layout, and CM6 refuses them from a plugin ("Block decorations may
 *   not be specified via plugins") because plugin decorations are computed
 *   after the viewport has been measured. A field is computed from the state,
 *   before it — but for the same reason it cannot see the viewport, so its walk
 *   covers the whole parsed tree and skips everything that cannot be a block.
 * - **A ViewPlugin for everything else** — every marker hidden, every class,
 *   every inline widget — built over `view.visibleRanges` only, which is where
 *   the volume is: the vault's heaviest note holds ~24,000 inline decorations
 *   and ~180 block ones.
 *
 * Both halves come from ONE builder with one active-region rule, so they cannot
 * drift; `preview.test.ts` asserts that their union is the whole set, and
 * `bench.test.ts` holds the pair to a frame on a 3,000-URL note.
 */
import { syntaxTree } from '@codemirror/language'
import { Prec, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view'
import { previewMode, readHost } from '../read-host.js'
import { buildBlockPreview, buildInlinePreview, type PreviewDecorations } from './build.js'
import { previewClicks } from './clicks.js'
import { selectListMarker } from './commands.js'

/** True when anything the decorations are a function of has moved. */
function stale(startState: ViewUpdate['startState'], state: ViewUpdate['state']): boolean {
  return (
    startState.facet(previewMode) !== state.facet(previewMode) ||
    startState.facet(readHost) !== state.facet(readHost) ||
    // The parser runs in the background: when it catches up, constructs below
    // the fold become renderable and the set has to be rebuilt.
    syntaxTree(startState) !== syntaxTree(state)
  )
}

export const blockPreviewField = StateField.define<PreviewDecorations>({
  create: (state) => buildBlockPreview(state),
  update(value, tr) {
    const rebuild =
      tr.docChanged || tr.selection !== undefined || stale(tr.startState, tr.state)
    return rebuild ? buildBlockPreview(tr.state) : value
  },
})

class InlinePreview {
  decorations = Decoration.none
  hidden = Decoration.none

  constructor(view: EditorView) {
    this.build(view)
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      stale(update.startState, update.state)
    ) {
      this.build(update.view)
    }
  }

  private build(view: EditorView): void {
    const built = buildInlinePreview(view.state, view.visibleRanges)
    this.decorations = built.decorations
    this.hidden = built.hidden
  }
}

const inlinePreview = ViewPlugin.fromClass(InlinePreview, {
  decorations: (v) => v.decorations,
})

/** The whole reveal engine. Install once; the mode arrives through the facet. */
export function livePreview(): Extension[] {
  return [
    blockPreviewField,
    EditorView.decorations.from(blockPreviewField, (v) => v.decorations),
    inlinePreview,
    // Every hidden range is atomic, so the caret steps over text it cannot see
    // instead of disappearing into it (R2.2). Both halves contribute.
    EditorView.atomicRanges.of((view) => view.state.field(blockPreviewField).hidden),
    EditorView.atomicRanges.of((view) => view.plugin(inlinePreview)?.hidden ?? Decoration.none),
    previewClicks,
    // Above markdown's own Backspace (Prec.high, deleteMarkupBackward), which
    // would turn a drawn bullet into indentation in one invisible step.
    Prec.highest(keymap.of([{ key: 'Backspace', run: selectListMarker }])),
  ]
}

export { activeLines } from './active-lines.js'
export {
  indentListItem,
  listLinesIn,
  listMarkerBefore,
  outdentListItem,
  selectListMarker,
  toggleTask,
} from './commands.js'
export { tagCompletions } from './completion.js'
