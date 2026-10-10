/**
 * Comment threads in the shell (writing-harness-shaping B8). Comments are
 * NOT an AI feature: `note.comment` works with no provider; only the
 * bubble's *Send to agent* box waits for one (`aiEnabled()`).
 *
 * Three parts:
 *
 * - **The registry** (`createThreadRegistry`) — one `ThreadStore` per note,
 *   keyed by the doc's guid, rebuilt when the doc instance is (a carve or an
 *   unshare rebuilds every doc; the quote re-anchors the threads). The
 *   workspace facade (`threadsFor`, `addThread`, `reply`, `resolveThread`,
 *   `exportCriticMarkup`) is a thin skin over it.
 * - **The bubble** (`commentBubble`) — at most one open, shell-wide: a new
 *   comment on a selection, or a thread. The pane that owns the view draws
 *   it (`CommentBubble.svelte`, `ui/Popover`).
 * - **The editor binding** (`bindThreads`) — feeds a view's marks from its
 *   note's store, and records which editor `note.comment` acts on.
 */
import type { CommentRecord as HarnessComment, ThreadRecord as HarnessThread, VaultRef } from '@ohhi/harness'
import { getLL } from '@ohhi/i18n'
import {
  exportCriticMarkup as encodeReview,
  reviewCopyName,
  ThreadStore,
  type CommentRecord,
  type ThreadFiles,
  type ThreadRecord,
} from '@ohhi/workspace'
import {
  commentRanges,
  setActiveThread,
  setThreads,
  threadAt,
  type CommentsHost,
  type MarkdownEditorHandle,
} from '@ohhi/editor'
import type { EngineDoc } from '@ohhi/sync'
import type { Clock } from '@ohhi/vault'
import { untrack } from 'svelte'
import { linesOfRange } from './references.js'
import type { FlashInput } from './notices.js'

/** CM6's view, through the editor package (the app takes no CodeMirror dependency of its own). */
type EditorView = MarkdownEditorHandle['view']

// The records are `@ohhi/harness`'s seam, restated in `@ohhi/workspace`
// (which cannot depend on the harness): fail the build if they drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const RECORDS_AGREE: Same<ThreadRecord, HarnessThread> & Same<CommentRecord, HarnessComment> = true

// ---- the registry -----------------------------------------------------------

export interface ThreadRegistryHost {
  clock: Clock
  docForPath(path: string): EngineDoc | null
  /** The note's guid (rename-stable) — its JSON's name. */
  guidFor(path: string): string | null
  /** The note's path now, from its guid (it moves on rename). */
  pathFor(guid: string): string | null
  /** The app-file seam (`readAppFile` / `writeAppFile`). */
  files: ThreadFiles
}

export interface NewComment {
  from: number
  to: number
  body: string
  /** `['agent']`: *Send to agent* was ticked. F starts the run. */
  sendTo?: 'agent'[]
  author?: string
}

export interface ThreadRegistry {
  /** The note's store, or null when it has no doc (not a note, or not open in a mount). */
  storeFor(path: string): ThreadStore | null
  dispose(): Promise<void>
}

export function createThreadRegistry(host: ThreadRegistryHost): ThreadRegistry {
  const entries = new Map<string, { doc: EngineDoc; store: ThreadStore }>()
  return {
    storeFor(path) {
      const guid = host.guidFor(path)
      const doc = host.docForPath(path)
      // A note without a doc has no editor either — nothing to comment on.
      if (!guid || !doc) return null
      const had = entries.get(guid)
      if (had && had.doc === doc) return had.store
      // A rebuilt doc: the old store's live anchors name items the new doc
      // never had, so start over from the materialized JSON (quote re-anchor).
      if (had) void had.store.dispose()
      let last = path
      const store = new ThreadStore({
        key: guid,
        path: () => (last = host.pathFor(guid) ?? last),
        doc,
        files: host.files,
        clock: host.clock,
      })
      entries.set(guid, { doc, store })
      void store.load()
      return store
    },
    async dispose() {
      const stores = [...entries.values()].map((e) => e.store)
      entries.clear()
      await Promise.all(stores.map((s) => s.dispose()))
    },
  }
}

/**
 * Write a review copy of the note with its open threads as CriticMarkup,
 * beside it as `<note> (review).md` — or `(review 2)`, … when that exists:
 * `createFile` returns an existing path as-is, and a stale copy is not an
 * export. Never the note itself (golden rule 2).
 */
export async function writeReviewCopy(
  store: ThreadStore,
  path: string,
  deps: {
    exists(path: string): boolean
    createFile(dir: string, name: string, text: string): Promise<string | null>
  }
): Promise<{ path: string | null; written: number; skipped: number }> {
  const open = store.threads().filter((t) => !t.resolved)
  if (open.length === 0) return { path: null, written: 0, skipped: 0 }
  const { text, skipped } = encodeReview(store.text(), open, { locate: (t) => store.rangeOf(t) })
  const cut = path.lastIndexOf('/')
  const dir = cut === -1 ? '' : path.slice(0, cut)
  const first = reviewCopyName(path)
  let name = first
  for (let n = 2; deps.exists(dir ? `${dir}/${name}` : name); n++) {
    name = first.replace(/ \(review\)\.md$/, ` (review ${n}).md`)
  }
  const written = await deps.createFile(dir, name, text)
  return { path: written, written: open.length - skipped.length, skipped: skipped.length }
}

/**
 * A thread's passage as a `lines` reference (F: the agent's mention for a
 * comment sent to it), or null when the passage is gone.
 */
export function threadLinesRef(store: ThreadStore, thread: Pick<ThreadRecord, 'anchor' | 'path'>): VaultRef | null {
  const range = store.rangeOf(thread)
  if (!range) return null
  return { kind: 'lines', path: thread.path, lines: linesOfRange(store.text(), range.from, range.to) }
}

/**
 * A component's live view of a note's threads: re-read on every change to
 * the store (a local write, a peer's, a load). Call during component init.
 */
export function liveThreads(storeOf: () => ThreadStore | null): { readonly list: ThreadRecord[]; readonly store: ThreadStore | null } {
  let list = $state<ThreadRecord[]>([])
  let store = $state.raw<ThreadStore | null>(null)
  $effect(() => {
    const s = storeOf()
    store = s
    if (!s) {
      list = []
      return
    }
    list = s.threads()
    return s.onChange(() => {
      list = s.threads()
    })
  })
  return {
    get list() {
      return list
    },
    get store() {
      return store
    },
  }
}

// ---- the bubble -------------------------------------------------------------

/** What the bubble is open on: a new comment over `[from, to)`, or a thread. */
export type BubbleRequest = {
  paneId: string
  path: string
  anchor: HTMLElement | { x: number; y: number } | null
} & ({ kind: 'new'; from: number; to: number } | { kind: 'thread'; threadId: string })

class CommentBubbleState {
  current = $state<BubbleRequest | null>(null)
  open(req: BubbleRequest): void {
    this.current = req
  }
  close(): void {
    this.current = null
  }
}

/** The one comment bubble (shell-wide; the owning pane draws it). */
export const commentBubble = new CommentBubbleState()

// ---- the editor binding -----------------------------------------------------

interface BoundEditor {
  paneId: string
  path: string
  view: EditorView
}

/** Every editor showing a note, by pane; and which one has the focus. */
const editors = new Map<string, BoundEditor>()
let focusedPane: string | null = null

/** A selection's anchor point for the bubble: under its end, at its start's x. */
function selectionPoint(view: EditorView, from: number, to: number): { x: number; y: number } | null {
  const a = view.coordsAtPos(from)
  const b = view.coordsAtPos(to, -1) ?? a
  return a && b ? { x: a.left, y: b.bottom } : null
}

/** The gutter's verbs for one pane's view. */
export function commentsHostFor(paneId: () => string, path: () => string | null): CommentsHost {
  return {
    open: (threadId, anchor) => {
      const p = untrack(path)
      if (p) commentBubble.open({ kind: 'thread', paneId: untrack(paneId), path: p, threadId, anchor })
    },
    label: (range) => {
      const t = getLL().web.ai.comments
      const view = untrack(() => editors.get(untrack(paneId))?.view)
      const quote = view ? view.state.doc.sliceString(range.from, Math.min(range.to, range.from + 40)) : ''
      return quote ? t.marker({ quote }) : t.marker_point()
    },
  }
}

/**
 * Feed one pane's view from its note's threads, and keep the marks current
 * as the records change; draw the bubble's thread as active. Returns the
 * cleanup. Called from the pane's own `$effect`.
 */
export function bindThreads(input: {
  paneId: string
  path: string | null
  view: EditorView | null
  focused: boolean
  storeFor: (path: string) => ThreadStore | null
}): (() => void) | undefined {
  const { paneId, path, view, focused } = input
  if (!view || !path) return
  editors.set(paneId, { paneId, path, view })
  if (focused) focusedPane = paneId
  const store = untrack(() => input.storeFor(path))
  const push = (): void => {
    if (!store) return
    const ranges = store
      .threads()
      .map((t) => ({ t, r: store.rangeOf(t) }))
      .filter((x): x is { t: ThreadRecord; r: { from: number; to: number } } => x.r !== null)
      .map(({ t, r }) => ({ id: t.id, from: r.from, to: r.to, resolved: t.resolved }))
    view.dispatch({ effects: setThreads.of(ranges) })
  }
  push()
  const off = store?.onChange(push)
  return () => {
    off?.()
    if (editors.get(paneId)?.view === view) editors.delete(paneId)
    if (focusedPane === paneId && !editors.has(paneId)) focusedPane = null
  }
}

/** Draw the open bubble's thread as active in its pane (or nothing). Called from the pane's `$effect`. */
export function showActiveThread(paneId: string, view: EditorView | null): void {
  if (!view) return
  const req = commentBubble.current
  const active = req && req.paneId === paneId && req.kind === 'thread' ? req.threadId : null
  view.dispatch({ effects: setActiveThread.of(active) })
}

/** The editor `note.comment` acts on: the focused pane's, else the only one. */
function commentTarget(): BoundEditor | null {
  if (focusedPane && editors.has(focusedPane)) return editors.get(focusedPane) ?? null
  return editors.size === 1 ? ([...editors.values()][0] ?? null) : null
}

/** True while a note is open in an editor (`note.comment`'s `when`). */
export function canComment(): boolean {
  return commentTarget() !== null
}

/**
 * `note.comment`: the selection → a new-comment bubble; a bare caret inside
 * a thread's passage → that thread; else say what to do.
 */
export function commentOnSelection(flash?: (input: FlashInput) => void): boolean {
  // Typing in the bubble itself must not open another one over it.
  if (typeof document !== 'undefined' && document.activeElement?.closest('[role="dialog"]')) return false
  const target = commentTarget()
  if (!target) {
    flash?.({ level: 'info', text: getLL().web.ai.comments.unavailable() })
    return false
  }
  const { view, paneId, path } = target
  const { from, to } = view.state.selection.main
  if (from === to) {
    const hit = threadAt(view.state, from)
    if (hit) {
      commentBubble.open({ kind: 'thread', paneId, path, threadId: hit.id, anchor: selectionPoint(view, hit.from, hit.to) })
      return true
    }
    flash?.({ level: 'info', text: getLL().web.ai.comments.select_first() })
    return false
  }
  commentBubble.open({ kind: 'new', paneId, path, from, to, anchor: selectionPoint(view, from, to) })
  return true
}

/** Open a thread's bubble from the list: in an editor showing its note, scrolled to it. */
export function openThread(path: string, threadId: string): boolean {
  const pick =
    (focusedPane && editors.get(focusedPane)?.path === path ? editors.get(focusedPane) : undefined) ??
    [...editors.values()].find((e) => e.path === path)
  if (!pick) return false
  const range = commentRanges(pick.view.state).find((r) => r.id === threadId)
  if (range) {
    pick.view.dispatch({ selection: { anchor: range.from }, scrollIntoView: true })
  }
  commentBubble.open({
    kind: 'thread',
    paneId: pick.paneId,
    path,
    threadId,
    anchor: range ? selectionPoint(pick.view, range.from, range.to) : null,
  })
  return true
}

/** Test seam: forget every bound editor. */
export function resetCommentEditors(): void {
  editors.clear()
  focusedPane = null
  commentBubble.close()
}
