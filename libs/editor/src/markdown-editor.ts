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
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { Awareness } from 'y-protocols/awareness'
import type { EngineDoc } from '@editor/sync'
import {
  Frontmatter,
  Highlight,
  livePreview,
  previewMode,
  Tag,
  toggleTask,
  type ViewMode,
  WikiLink,
  wikiLinkExtensions,
} from '@editor/editor-lang'
import { createCollabExtensions, type CollabUndoManager, type CollabUser } from './binding.js'
import { editorTheme, themeModeCompartment } from './theme.js'

/** Host-supplied extensions (wikilinks, completion, …), swappable at runtime. */
const hostCompartment = new Compartment()

/**
 * The view mode (read-shaping.md B3): Live / Source / Reading are one view
 * reconfigured, never three views. Reading is the only mode that changes
 * editability; the decorations read `previewMode` for the rest.
 */
const modeCompartment = new Compartment()

function modeExtensions(mode: ViewMode): Extension[] {
  const ext: Extension[] = [previewMode.of(mode)]
  if (mode === 'reading') ext.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
  return ext
}

export interface MarkdownEditorOptions {
  doc: EngineDoc
  awareness: Awareness | null
  user: CollabUser
  readOnly?: boolean
  /** Initial view mode; `setMode` changes it in place. Default `live`. */
  mode?: ViewMode
  /** Drives only CM6's own dark/light base rules; all colours come from CSS. */
  dark?: boolean
  /**
   * Extra CM6 extensions from the host (language extras, decorations,
   * completion sources). Reconfigurable via `setExtensions` — pass a STABLE
   * array or the caller will churn the compartment on every render.
   */
  extensions?: Extension[]
  /**
   * The doc's undo manager, owned by the host so the stack outlives this view
   * (tab-groups B2: a tab switch destroys the view, not the history). Omit it
   * and yCollab mints a view-lifetime one, as before.
   */
  undoManager?: CollabUndoManager
}

/**
 * Where a view was when it went away: enough to put a tab back exactly where
 * its reader left it (tab-groups B2). Plain data — it is persisted with the
 * pane tree, so it must survive JSON.
 */
export interface EditorResumeState {
  cursor: { anchor: number; head: number }
  /** `scrollDOM.scrollTop`, in pixels. */
  scroll: number
}

export interface MarkdownEditorHandle {
  view: EditorView
  /** One dispatch: no teardown, no Y.Text rebind. */
  setDark(dark: boolean): void
  /** Swap the host extension set in place. */
  setExtensions(extensions: Extension[]): void
  /** Live / Source / Reading — one dispatch, same document, same scroll. */
  setMode(mode: ViewMode): void
  /**
   * Put the caret at `offset` and scroll it into view — what a search result
   * does on Enter. Clamped to the document, so a stale offset (the note
   * changed since the hit was computed) lands at the end rather than throwing.
   */
  reveal(offset: number): void
  /**
   * The resume point of this view — read it BEFORE the view is destroyed
   * (tab-groups B2).
   */
  capture(): EditorResumeState
  /** Put a captured resume point back. Clamped to the current document. */
  restore(state: EditorResumeState): void
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
    ...createCollabExtensions(opts.doc, opts.awareness, opts.user, opts.undoManager),
    hostCompartment.of(opts.extensions ?? []),
    modeCompartment.of(modeExtensions(opts.mode ?? 'live')),
    // Above defaultKeymap, and explicitly so: a binding that only wins by
    // sitting earlier in the array is one refactor away from not winning.
    Prec.high(keymap.of([{ key: 'Mod-l', run: toggleTask }])),
    keymap.of(defaultKeymap),
    // GFM is the base because the vault is GFM: tables, task lists,
    // strikethrough and bare URLs (3,005 of them) do not parse without it.
    // Wikilinks are part of the language here too, not an optional extra: 29%
    // of the notes carry one. The BEHAVIOUR (resolve/open/create) is what
    // varies per host, and that arrives through the wikiLinkHost facet — see
    // the host compartment above.
    markdown({
      base: markdownLanguage,
      extensions: [WikiLink, Tag, Highlight, Frontmatter],
      // Lazy-loaded grammars for fenced code: js/rust/bash/jsx/ts alone are
      // 369 of the vault's 527 fences.
      codeLanguages: languages,
    }),
    // The vault indents lists with tabs and reads them at four columns, and a
    // rendered bullet has to sit where the tab put it (read-shaping.md B1).
    EditorState.tabSize.of(4),
    indentUnit.of('\t'),
    ...wikiLinkExtensions(),
    // After the wikilink extensions: live preview's plain-click rule only
    // applies where a link is RENDERED, and V2c's Mod-click keeps the rest.
    ...livePreview(),
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
    setMode(mode) {
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode)) })
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
    capture() {
      const { anchor, head } = view.state.selection.main
      return { cursor: { anchor, head }, scroll: view.scrollDOM.scrollTop }
    },
    restore(state) {
      const max = view.state.doc.length
      const clamp = (n: number): number => Math.max(0, Math.min(n, max))
      view.dispatch({
        selection: { anchor: clamp(state.cursor.anchor), head: clamp(state.cursor.head) },
        // The saved scroll is the resume point, not the caret: scrolling to
        // the selection here would fight the assignment below.
        scrollIntoView: false,
      })
      // A view mounted this tick has no measured height yet, so assigning
      // scrollTop now would clamp to 0. requestMeasure runs after layout.
      view.requestMeasure({
        read: () => state.scroll,
        write: (top) => {
          view.scrollDOM.scrollTop = top
        },
      })
    },
    destroy: () => view.destroy(),
  }
}
