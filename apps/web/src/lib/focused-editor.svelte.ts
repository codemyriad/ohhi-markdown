/**
 * The note editors on screen, by pane, and which one a command acts on — the
 * one registry every note-acting command reads (`note.comment`, the
 * suggestion commands, `ai.add-selection`, `ai.run-skill`, the composer's
 * selection chip).
 *
 * `Pane.svelte` binds its editor once (`bindEditor`) while it shows a note.
 * "Focused" is the layout's focused pane, remembered past the moment a
 * palette row or a Session view takes the keyboard: a command run from the
 * palette means the note the person was last in, not nobody. Plain module
 * state on purpose — CM6 views are not reactive, and nothing renders this.
 */
import type { MarkdownEditorHandle } from '@ohhi/editor'

/** CM6's view, through the editor package (the app takes no CodeMirror dependency of its own). */
export type EditorView = MarkdownEditorHandle['view']

/** One pane's editor and the note it shows. */
export interface BoundEditor {
  paneId: string
  path: string
  view: EditorView
}

/** A selection in a note: the note's text and the main range. */
export interface NoteSelection {
  path: string
  text: string
  from: number
  to: number
}

const editors = new Map<string, BoundEditor>()
/** The pane that last held the focus while showing a note. Survives the focus moving to a view tab. */
let focusedId: string | null = null

/**
 * A pane's editor is on screen showing `path`; `focused` when its pane holds
 * the focus. Returns the unbind — call it when the view or the note changes.
 */
export function bindEditor(input: BoundEditor & { focused: boolean }): () => void {
  const entry: BoundEditor = { paneId: input.paneId, path: input.path, view: input.view }
  editors.set(entry.paneId, entry)
  if (input.focused) focusedId = entry.paneId
  return () => {
    if (editors.get(entry.paneId) === entry) editors.delete(entry.paneId)
  }
}

/** The pane took the focus (its editor, when it has one, becomes the focused one). */
export function focusEditor(paneId: string): void {
  if (editors.has(paneId)) focusedId = paneId
}

/** The editor commands act on: the last-focused pane's, else the only one on screen. */
export function focusedEditor(): BoundEditor | null {
  const hit = focusedId ? editors.get(focusedId) : undefined
  if (hit) return hit
  return editors.size === 1 ? ([...editors.values()][0] ?? null) : null
}

/** An editor showing `path`: the focused one when it does, else the first. */
export function editorFor(path: string): BoundEditor | null {
  const focused = focusedEditor()
  if (focused?.path === path) return focused
  for (const e of editors.values()) if (e.path === path) return e
  return null
}

/** The editor in one pane. */
export function editorInPane(paneId: string): BoundEditor | null {
  return editors.get(paneId) ?? null
}

/** An editor's selection, or null when it is a bare caret. */
export function selectionOf(e: BoundEditor): NoteSelection | null {
  const { from, to } = e.view.state.selection.main
  if (from === to) return null
  return { path: e.path, text: e.view.state.doc.toString(), from, to }
}

/**
 * A selection in a note on screen: the focused editor's when it has one,
 * else any other editor's (the composer's pane shows no note itself).
 */
export function anySelection(): NoteSelection | null {
  const focused = focusedEditor()
  const first = focused ? selectionOf(focused) : null
  if (first) return first
  for (const e of editors.values()) {
    if (e === focused) continue
    const sel = selectionOf(e)
    if (sel) return sel
  }
  return null
}

/** Forget every editor (tests, and a vault switch). */
export function resetEditors(): void {
  editors.clear()
  focusedId = null
}
