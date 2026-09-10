/**
 * Plain-markdown CM6 editor factory. Framework-free: the Svelte wrapper
 * (MarkdownEditor.svelte) manages lifecycle only; CM6 owns the editing
 * surface and the DOM under `parent`.
 *
 * All colour comes from --ed-* custom properties (see theme.ts). Everything
 * a host can change at runtime lives in a Compartment, so the view is
 * reconfigured rather than recreated — recreating it would tear down the
 * Y.Text binding and lose cursor, scroll and undo history.
 */
import { defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { Awareness } from 'y-protocols/awareness'
import type { EngineDoc } from '@editor/sync'
import { WikiLink, wikiLinkExtensions } from '@editor/editor-lang'
import { createCollabExtensions, type CollabUser } from './binding.js'
import { editorTheme, themeModeCompartment } from './theme.js'

/** Host-supplied extensions (wikilinks, completion, …), swappable at runtime. */
const hostCompartment = new Compartment()

export interface MarkdownEditorOptions {
  doc: EngineDoc
  awareness: Awareness | null
  user: CollabUser
  readOnly?: boolean
  /** Drives only CM6's own dark/light base rules; all colours come from CSS. */
  dark?: boolean
  /**
   * Extra CM6 extensions from the host (language extras, decorations,
   * completion sources). Reconfigurable via `setExtensions` — pass a STABLE
   * array or the caller will churn the compartment on every render.
   */
  extensions?: Extension[]
}

export interface MarkdownEditorHandle {
  view: EditorView
  /** One dispatch: no teardown, no Y.Text rebind. */
  setDark(dark: boolean): void
  /** Swap the host extension set in place. */
  setExtensions(extensions: Extension[]): void
  /**
   * Put the caret at `offset` and scroll it into view — what a search result
   * does on Enter. Clamped to the document, so a stale offset (the note
   * changed since the hit was computed) lands at the end rather than throwing.
   */
  reveal(offset: number): void
  destroy(): void
}

export function createMarkdownEditor(
  parent: HTMLElement,
  opts: MarkdownEditorOptions
): MarkdownEditorHandle {
  const extensions = [
    // Collab FIRST: in CM6 earlier array entries have HIGHER precedence, so
    // this is what actually makes yUndo win over @codemirror/commands' undo.
    // (It also works today only because history() is not installed; do not
    // rely on position alone when adding keymaps — use Prec.high.)
    ...createCollabExtensions(opts.doc, opts.awareness, opts.user),
    hostCompartment.of(opts.extensions ?? []),
    keymap.of(defaultKeymap),
    // Wikilinks are part of the language here, not an optional extra: 29% of
    // the vault's notes carry one. The BEHAVIOUR (resolve/open/create) is what
    // varies per host, and that arrives through the wikiLinkHost facet — see
    // the host compartment above.
    markdown({ extensions: [WikiLink] }),
    ...wikiLinkExtensions(),
    EditorView.lineWrapping,
    // CM6 renders the content as role="textbox"; without a name it is an
    // unlabelled input to assistive tech (and to the axe gate).
    EditorView.contentAttributes.of({ 'aria-label': 'Note text' }),
    editorTheme(opts.dark ?? false),
  ]
  if (opts.readOnly) {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
  }
  const view = new EditorView({
    // Initial doc must mirror the Y.Text — ySync only relays subsequent deltas.
    state: EditorState.create({ doc: opts.doc.getText(), extensions }),
    parent,
  })
  return {
    view,
    setDark(dark) {
      view.dispatch({
        effects: themeModeCompartment.reconfigure(EditorView.darkTheme.of(dark)),
      })
    },
    setExtensions(next) {
      view.dispatch({ effects: hostCompartment.reconfigure(next) })
    },
    reveal(offset) {
      const pos = Math.max(0, Math.min(offset, view.state.doc.length))
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        scrollIntoView: false,
      })
      view.focus()
    },
    destroy: () => view.destroy(),
  }
}
