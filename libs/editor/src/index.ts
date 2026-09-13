/**
 * @ohhi/editor — CM6 editing surface + Yjs collab binding.
 *
 * TS API only: the Svelte wrapper is imported by path
 * ('@ohhi/editor/src/MarkdownEditor.svelte') so this entry stays pure TS
 * and `tsc --noEmit` needs no Svelte awareness.
 */
export {
  createCollabExtensions,
  createUndoManager,
  type CollabUndoManager,
  type CollabUser,
} from './binding.js'
export {
  createMarkdownEditor,
  type EditorResumeState,
  type MarkdownEditorHandle,
  type MarkdownEditorOptions,
} from './markdown-editor.js'
export { editorHighlightStyle, editorTheme, themeModeCompartment } from './theme.js'
export type { ViewMode } from '@ohhi/editor-lang'
