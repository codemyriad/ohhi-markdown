/**
 * *Show in note* (QA round 1, *Oh hi Suggestion Explorations* Fork 3): an
 * agent's suggestion brought into view from outside its note — a session
 * card's *Show in note*, and its Accept / Reject, which reveal first so the
 * registry command acts on the suggestion under the caret like the key does.
 *
 * The note where it already is, else opened (the shell opens it beside the
 * companion view); then, once its editor is bound and draws the suggestion,
 * the caret at its start, scrolled to the middle, and that pane the focused
 * one for note-acting commands (`focusEditor` — the keyboard stays where it
 * was unless `focus`). Opening is asynchronous (the pane mounts its editor
 * in an effect), so it waits frame by frame, a bounded number of times.
 */
import { revealSuggestion } from '@ohhi/editor'
import { editorFor, focusEditor } from './focused-editor.svelte.js'

export interface RevealDeps {
  /** Open the note (the shell's `openPath(path, { beside: true })`). */
  open(path: string): void
  /** With `focus`: make the note's pane the layout's focused one (the keyboard follows). */
  focusPane?(paneId: string): void
  /** One frame later. */
  frame(): Promise<void>
  /** How many frames to wait for the note's editor; 120 by default (~2 s). */
  tries?: number
}

/** Bring suggestion `id` of `path` into view; false when the note never drew it. */
export async function revealSuggestionIn(
  path: string,
  id: string,
  opts: { focus?: boolean },
  deps: RevealDeps
): Promise<boolean> {
  if (!editorFor(path)) deps.open(path)
  const tries = deps.tries ?? 120
  for (let i = 0; i <= tries; i++) {
    const e = editorFor(path)
    if (e && revealSuggestion(e.view, id, opts)) {
      focusEditor(e.paneId)
      if (opts.focus) deps.focusPane?.(e.paneId)
      return true
    }
    if (i < tries) await deps.frame()
  }
  return false
}

/** The browser's next frame. */
export const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))
