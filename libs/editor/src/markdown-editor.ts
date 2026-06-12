/**
 * Plain-markdown CM6 editor factory (shaping D3: zero preview in V1).
 * Framework-free: the Svelte wrapper (MarkdownEditor.svelte) only manages
 * lifecycle; CM6 owns the editing surface and the DOM under `parent`.
 */
import { defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { Awareness } from 'y-protocols/awareness'
import type { EngineDoc } from '@editor/sync'
import { createCollabExtensions, type CollabUser } from './binding.js'

export interface MarkdownEditorOptions {
  doc: EngineDoc
  awareness: Awareness | null
  user: CollabUser
  readOnly?: boolean
}

export interface MarkdownEditorHandle {
  view: EditorView
  destroy(): void
}

// Minimal inline theme — no external theme dep in V1.
const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'white' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '1rem', caretColor: '#111' },
})

export function createMarkdownEditor(
  parent: HTMLElement,
  opts: MarkdownEditorOptions
): MarkdownEditorHandle {
  const extensions = [
    keymap.of(defaultKeymap),
    markdown(),
    EditorView.lineWrapping,
    baseTheme,
    // Collab binding last so its undo keymap wins over defaults.
    ...createCollabExtensions(opts.doc, opts.awareness, opts.user),
  ]
  if (opts.readOnly) {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
  }
  const view = new EditorView({
    // Initial doc must mirror the Y.Text — ySync only relays subsequent deltas.
    state: EditorState.create({ doc: opts.doc.getText(), extensions }),
    parent,
  })
  return { view, destroy: () => view.destroy() }
}
