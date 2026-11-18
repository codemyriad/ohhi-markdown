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
  undoManagerFits,
  type CollabUndoManager,
  type CollabUser,
} from './binding.js'
export {
  createMarkdownEditor,
  type EditorResumeState,
  type MarkdownEditorHandle,
  type MarkdownEditorOptions,
} from './markdown-editor.js'
export {
  cycleHeading,
  cmKey,
  editorKeymap,
  FORMAT_COMMANDS,
  formatKeymap,
  indentFormat,
  insertCallout,
  insertCodeBlock,
  insertImage,
  insertLink,
  insertTable,
  insertRule,
  insertWikilink,
  outdentFormat,
  runFormat,
  setHeading,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  toggleStrike,
  toggleTaskList,
  type EditorKey,
  type EditorKeyId,
  type FormatBindings,
  type FormatCommand,
  type FormatCommandId,
} from './format.js'
export { editorHighlightStyle, editorTheme, themeModeCompartment } from './theme.js'
export {
  attachmentDrop,
  attachmentFiles,
  attachmentHost,
  attachmentMarkup,
  insertAttachments,
  pastedAttachments,
  type AttachmentGesture,
  type AttachmentHost,
  type SavedAttachment,
} from './attachments.js'
export { selectedTextIn } from './selection.js'
export {
  barEligible,
  createSettle,
  focusSelectionBar,
  insideSuggestion,
  isTyping,
  selectionBar,
  selectionBarField,
  selectionBarForm,
  handlePlacement,
  SETTLE_MS,
  showSelectionBar,
  type Schedule,
  type Settle,
  type SelectionBarForm,
  type SelectionBarHost,
  type SelectionBarMount,
  type SelectionBarOptions,
} from './selection-bar.js'
export {
  acceptSuggestionAtCaret,
  buildDecorations,
  currentSuggestion,
  hasSuggestionGutter,
  INTRA_DIFF_MIN,
  pairDecorations,
  rejectSuggestionAtCaret,
  revealSuggestion,
  setSuggestions,
  stepSuggestion,
  suggestionAt,
  suggestionField,
  suggestionMarkers,
  suggestions,
  suggestionsCompartment,
  suggestionsIn,
  suggestionStep,
  type EditorSuggestion,
  type SuggestionLabels,
  type SuggestionsHost,
} from './suggestions.js'
export {
  centreTarget,
  typewriterCompartment,
  typewriterExtension,
  typewriterScrolling,
  type TypewriterInput,
} from './typewriter.js'
export {
  sameTypingAids,
  TYPING_DEFAULTS,
  typingAttributes,
  typingCompartment,
  typingExtension,
  type TypingAids,
} from './typing.js'
export type { ViewMode } from '@ohhi/editor-lang'
export {
  commentRanges,
  commentsExtension,
  commentsField,
  setActiveThread,
  setThreads,
  threadAt,
  type CommentRange,
  type CommentsHost,
} from './comments.js'
export {
  setWorking,
  workingField,
  workingHighlight,
  type WorkingHost,
  type WorkingRange,
} from './working-highlight.js'
/** A host's data into a view, a microtask after each change — never inside an update. */
export { hostPush, type PushSource } from './host-push.js'

export { redoCommand, undoCommand } from './binding.js'
