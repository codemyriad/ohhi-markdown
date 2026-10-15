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
 *
 * A comment thread comes back the same way (*Show thread* on a comment's
 * turn in the session): `revealThreadIn` opens the note and the thread's
 * bubble over its passage (`threads.svelte.ts` `openThread`).
 */
import { revealSuggestion } from '@ohhi/editor'
import { commentRanges } from '@ohhi/editor'
import { editorFor, focusEditor, type BoundEditor } from './focused-editor.svelte.js'
import { openThread } from './threads.svelte.js'

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

/**
 * The note's editor once `ready(editor)` holds: the note opened when no
 * editor shows it, then waited for frame by frame. Null when it never did.
 */
async function whenShown(path: string, ready: (e: BoundEditor) => boolean, deps: RevealDeps): Promise<BoundEditor | null> {
  if (!editorFor(path)) deps.open(path)
  const tries = deps.tries ?? 120
  for (let i = 0; i <= tries; i++) {
    const e = editorFor(path)
    if (e && ready(e)) return e
    if (i < tries) await deps.frame()
  }
  return null
}

/** Bring suggestion `id` of `path` into view; false when the note never drew it. */
export async function revealSuggestionIn(
  path: string,
  id: string,
  opts: { focus?: boolean },
  deps: RevealDeps
): Promise<boolean> {
  const e = await whenShown(path, (x) => revealSuggestion(x.view, id, opts), deps)
  if (!e) return false
  focusEditor(e.paneId)
  if (opts.focus) deps.focusPane?.(e.paneId)
  return true
}

/** Open thread `threadId`'s bubble in `path`, over its passage; false when the note never drew the thread. */
export async function revealThreadIn(path: string, threadId: string, deps: RevealDeps): Promise<boolean> {
  const e = await whenShown(path, (x) => commentRanges(x.view.state).some((r) => r.id === threadId), deps)
  if (!e) return false
  focusEditor(e.paneId)
  deps.focusPane?.(e.paneId)
  return openThread(path, threadId)
}

/** The browser's next frame. */
export const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))
