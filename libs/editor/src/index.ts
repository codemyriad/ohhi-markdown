/**
 * @editor/editor — CM6 editing surface + Yjs collab binding.
 *
 * TS API only: the Svelte wrapper is imported by path
 * ('@editor/editor/src/MarkdownEditor.svelte') so this entry stays pure TS
 * and `tsc --noEmit` needs no Svelte awareness.
 */
export { createCollabExtensions, type CollabUser } from './binding.js'
export {
  createMarkdownEditor,
  type MarkdownEditorHandle,
  type MarkdownEditorOptions,
} from './markdown-editor.js'
export { editorHighlightStyle, editorTheme, themeModeCompartment } from './theme.js'
