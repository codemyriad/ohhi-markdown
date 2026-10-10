/**
 * Anchored comment threads (writing-harness-shaping B8, Fork 5-A).
 *
 * A thread hangs off a passage of a note by a **dual anchor**:
 *
 * - `live` — a `Y.RelativePosition` pair over the doc's Y.Text (encoded by
 *   `anchors.ts`, the one relative-position codec), which follows every
 *   insert and delete, local or a peer's, while the doc lives;
 * - `quote` — the passage's text with up to 32 characters either side (the
 *   text-quote selector Claude Docs' `find` anchor uses), which re-anchors
 *   the thread when the live pair cannot: after a rebuild from the file (a
 *   new Y.Doc, so the old item ids are gone) or on a tracked file, which has
 *   no CRDT at all.
 *
 * **Storage** (Fork 5-A). An enrolled doc carries its threads in a
 * `comments` Y.Map beside the text — the sync carrier, so a shared note's
 * comments reach every peer — and every change is also materialized to
 * `.ohhi/comments/<guid>.json` through the app-file seam (journaled), so
 * Editor never holds the only copy (golden rule 1). A tracked doc keeps the
 * JSON only. The markdown bytes never change (golden rule 2): CriticMarkup is
 * an export codec (`criticmarkup.ts`), never the store.
 *
 * The map is flat on purpose: `thread/<id>` holds a thread's own fields and
 * `comment/<threadId>/<commentId>` each comment. Two peers replying to one
 * thread at once write two keys, so neither reply can last-writer-win the
 * other away — one array value per thread would.
 *
 * Clock-injected (golden rule 5): the materializing write is debounced on
 * the caller's `Clock`.
 */
import type * as Y from 'yjs'
import type { EngineDoc } from '@ohhi/sync'
import type { Clock } from '@ohhi/vault'
import { decodeRange, encodeRange, ydocOf, ytextOf } from './anchors.js'

// ---- records ---------------------------------------------------------------

/**
 * The thread and comment records — the seam's one home: `@ohhi/harness`
 * re-exports them (libs/harness/src/types.ts).
 */
export interface CommentRecord {
  id: string
  author: string
  at: number
  body: string
  to?: 'agent'[]
  answered?: boolean
  answering?: string
}

export interface TextQuote {
  exact: string
  /** Up to `QUOTE_CONTEXT` characters before `exact`. */
  prefix: string
  /** Up to `QUOTE_CONTEXT` characters after `exact`. */
  suffix: string
}

export interface ThreadAnchor {
  live?: [unknown, unknown]
  quote: TextQuote
}

export interface ThreadRecord {
  id: string
  path: string
  author: string
  created: number
  resolved: boolean
  anchor: ThreadAnchor
  comments: CommentRecord[]
}

/** How much context either side of the quote is kept. */
export const QUOTE_CONTEXT = 32
/** The Y.Map beside the text that carries an enrolled doc's threads. */
export const COMMENTS_MAP = 'comments'
/** Where the materialized JSON lives — `.ohhi/`, ignored by sync and the index. */
export const COMMENTS_DIR = '.ohhi/comments/'
/** A burst of changes (typing a reply, a peer's batch) is one write. */
export const THREAD_WRITE_DEBOUNCE_MS = 500
export const THREADS_FILE_VERSION = 1

/** The materialized file for a doc. */
export function commentsFile(key: string): string {
  return `${COMMENTS_DIR}${encodeURIComponent(key)}.json`
}

// ---- the text quote ---------------------------------------------------------

/** The quote selector for `[from, to)` of `text`. */
export function quoteAt(text: string, from: number, to: number): TextQuote {
  return {
    exact: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - QUOTE_CONTEXT), from),
    suffix: text.slice(to, to + QUOTE_CONTEXT),
  }
}

/** Characters of `a`'s end that equal `b`'s end. */
function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

/** Characters of `a`'s start that equal `b`'s start. */
function commonPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * Find a quote in `text`: every exact occurrence is a candidate, the one
 * whose surroundings agree best with the quote's prefix and suffix wins (the
 * first on a tie). An empty `exact` (a comment on a point, CriticMarkup's
 * bare `{>>…<<}`) is found where its prefix meets its suffix. Null when the
 * quoted text is gone.
 */
export function findQuote(text: string, quote: TextQuote): { from: number; to: number } | null {
  if (quote.exact === '') {
    const joint = quote.prefix + quote.suffix
    if (joint === '') return null
    const at = text.indexOf(joint)
    return at === -1 ? null : { from: at + quote.prefix.length, to: at + quote.prefix.length }
  }
  let best: { from: number; score: number } | null = null
  for (let at = text.indexOf(quote.exact); at !== -1; at = text.indexOf(quote.exact, at + 1)) {
    const before = text.slice(Math.max(0, at - quote.prefix.length), at)
    const end = at + quote.exact.length
    const after = text.slice(end, end + quote.suffix.length)
    const score = commonSuffix(before, quote.prefix) + commonPrefix(after, quote.suffix)
    if (!best || score > best.score) best = { from: at, score }
  }
  return best ? { from: best.from, to: best.from + quote.exact.length } : null
}

/**
 * Where a thread's passage is now: by the live anchor first (it follows
 * edits inside the passage too), then by the quote. A live pair that resolves
 * to nothing (the passage was deleted) or not at all (a different Y.Doc — a
 * rebuild from file) falls through to the quote; null when both are gone.
 *
 * `ydoc` is the doc the live pair was encoded against, or null (tracked).
 */
export function resolveAnchor(
  text: string,
  thread: Pick<ThreadRecord, 'anchor'>,
  ydoc: Y.Doc | null = null
): { from: number; to: number } | null {
  const { live, quote } = thread.anchor
  if (live && ydoc) {
    const range = decodeRange(ydoc, live)
    if (range && (range.to > range.from || quote.exact === '')) return range
  }
  return findQuote(text, quote)
}

// ---- the store --------------------------------------------------------------

/** The app-file seam the store materializes through (`Workspace.readAppFile` / `writeAppFile`). */
export interface ThreadFiles {
  read(path: string): Promise<string | null>
  write(path: string, text: string): Promise<void>
}

export interface ThreadStoreOptions {
  /** The doc's guid — rename-stable, so the JSON follows the note. */
  key: string
  /** The note's current vault path (it moves on rename). */
  path: () => string
  /** The enrolled doc, or null for a tracked file (JSON only, no CRDT). */
  doc: EngineDoc | null
  /** A tracked file's current text (an enrolled doc's comes from `doc`). */
  text?: () => string
  files: ThreadFiles
  clock: Clock
  newId?: () => string
  debounceMs?: number
}

export interface NewThreadInput {
  from: number
  to: number
  author: string
  body: string
  /** `['agent']`: the comment asks the agent (B8 *Send to agent*). */
  sendTo?: 'agent'[]
  /** Overrides for an import; default the clock and a fresh id. */
  id?: string
  at?: number
}

/** What the materialized file holds. */
export interface ThreadsFile {
  version: typeof THREADS_FILE_VERSION
  key: string
  path: string
  threads: ThreadRecord[]
}

/**
 * Thread-level fields as the Y.Map holds them (comments live in their own
 * keys), plus the opening comment's id: replies sort by time, but a peer's
 * skewed clock must never put a reply above the comment that opened it.
 */
type StoredThread = Omit<ThreadRecord, 'comments' | 'path'> & { root?: string }

const THREAD_KEY = 'thread/'
const COMMENT_KEY = 'comment/'
/** The transaction origin of a comment write — not `local`, which is typing. */
export const COMMENTS_ORIGIN = 'comments'

const byCreated = (a: ThreadRecord, b: ThreadRecord): number => a.created - b.created || (a.id < b.id ? -1 : 1)
const byAt = (a: CommentRecord, b: CommentRecord): number => a.at - b.at || (a.id < b.id ? -1 : 1)
/** The opening comment first, then the replies in time order. */
function ordered(comments: CommentRecord[], root: string | undefined): CommentRecord[] {
  return comments.sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : byAt(a, b)))
}

/**
 * One note's threads. Created per open note by the host; `load()` reads the
 * materialized JSON (and seeds the map with any thread it lacks — the
 * rebuild-from-file case), `dispose()` flushes a pending write.
 */
export class ThreadStore {
  private readonly opts: ThreadStoreOptions
  private readonly ydoc: Y.Doc | null
  private readonly map: Y.Map<unknown> | null
  /** A tracked doc's threads (an enrolled doc's are the map). */
  private memory = new Map<string, ThreadRecord>()
  private readonly listeners = new Set<() => void>()
  private cancelWrite: (() => void) | null = null
  private lastWritten: string | null = null
  /** The text of the write in flight, so a second schedule does not repeat it. */
  private writing: string | null = null
  private readonly off: (() => void) | null = null
  private disposed = false

  constructor(opts: ThreadStoreOptions) {
    this.opts = opts
    this.ydoc = opts.doc ? ydocOf(opts.doc) : null
    this.map = this.ydoc ? this.ydoc.getMap<unknown>(COMMENTS_MAP) : null
    if (this.map) {
      const map = this.map
      // Local and remote alike: a peer's reply is a change to materialize too.
      const handler = (): void => this.changed()
      map.observe(handler)
      this.off = () => map.unobserve(handler)
    }
  }

  get key(): string {
    return this.opts.key
  }

  /** The Y.Doc live anchors resolve against, or null (tracked). */
  get liveDoc(): Y.Doc | null {
    return this.ydoc
  }

  /** Read the materialized JSON; for an enrolled doc, seed the map with what it lacks. */
  async load(): Promise<void> {
    const raw = await this.opts.files.read(commentsFile(this.opts.key)).catch(() => null)
    const file = raw ? parseThreadsFile(raw) : null
    this.lastWritten = raw
    if (!file || this.disposed) return
    if (this.map && this.ydoc) {
      const map = this.map
      const missing = file.threads.filter((t) => !map.has(THREAD_KEY + t.id))
      const comments = file.threads.flatMap((t) =>
        t.comments.map((c) => [t.id, c] as const).filter(([id, c]) => !map.has(`${COMMENT_KEY}${id}/${c.id}`))
      )
      if (missing.length === 0 && comments.length === 0) return
      this.ydoc.transact(() => {
        for (const t of missing) map.set(THREAD_KEY + t.id, storedOf(t))
        for (const [id, c] of comments) map.set(`${COMMENT_KEY}${id}/${c.id}`, c)
      }, COMMENTS_ORIGIN)
    } else {
      for (const t of file.threads) if (!this.memory.has(t.id)) this.memory.set(t.id, t)
      this.notify()
    }
  }

  /** Every thread, oldest first, with its comments in order and `path` current. */
  threads(): ThreadRecord[] {
    const path = this.opts.path()
    if (!this.map) return [...this.memory.values()].map((t) => ({ ...t, path })).sort(byCreated)
    const threads = new Map<string, ThreadRecord>()
    const roots = new Map<string, string | undefined>()
    const comments = new Map<string, CommentRecord[]>()
    for (const [k, v] of this.map.entries()) {
      if (k.startsWith(THREAD_KEY)) {
        const { root, ...s } = v as StoredThread
        roots.set(s.id, root)
        threads.set(s.id, { ...s, path, comments: [] })
      } else if (k.startsWith(COMMENT_KEY)) {
        const id = k.slice(COMMENT_KEY.length, k.lastIndexOf('/'))
        const list = comments.get(id) ?? []
        list.push(v as CommentRecord)
        comments.set(id, list)
      }
    }
    for (const [id, list] of comments) {
      const t = threads.get(id)
      if (t) t.comments = ordered(list, roots.get(id))
    }
    return [...threads.values()].sort(byCreated)
  }

  get(id: string): ThreadRecord | null {
    return this.threads().find((t) => t.id === id) ?? null
  }

  /** The note's text now — what the quote is cut from and resolved against. */
  text(): string {
    return this.opts.doc ? this.opts.doc.getText() : (this.opts.text?.() ?? '')
  }

  /** Where a thread's passage is now (see `resolveAnchor`). */
  rangeOf(thread: Pick<ThreadRecord, 'anchor'>): { from: number; to: number } | null {
    return resolveAnchor(this.text(), thread, this.ydoc)
  }

  /** Open a thread on `[from, to)` with its first comment. */
  add(input: NewThreadInput): ThreadRecord {
    const text = this.text()
    const from = Math.max(0, Math.min(input.from, text.length))
    const to = Math.max(from, Math.min(input.to, text.length))
    const at = input.at ?? this.opts.clock.now()
    const id = input.id ?? this.newId()
    const anchor: ThreadAnchor = { quote: quoteAt(text, from, to) }
    if (this.ydoc) anchor.live = encodeRange(ytextOf(this.ydoc), from, to)
    const first: CommentRecord = {
      id: this.newId(),
      author: input.author,
      at,
      body: input.body,
      ...(input.sendTo?.length ? { to: [...input.sendTo] } : {}),
    }
    const thread: ThreadRecord = {
      id,
      path: this.opts.path(),
      author: input.author,
      created: at,
      resolved: false,
      anchor,
      comments: [first],
    }
    this.put(thread, [first])
    return thread
  }

  /** Append a comment to a thread (a person's reply, or the agent's — F). */
  reply(threadId: string, comment: Omit<CommentRecord, 'id' | 'at'> & Partial<Pick<CommentRecord, 'id' | 'at'>>): CommentRecord | null {
    const thread = this.get(threadId)
    if (!thread) return null
    const record: CommentRecord = { ...comment, id: comment.id ?? this.newId(), at: comment.at ?? this.opts.clock.now() }
    this.put(null, [record], threadId)
    return record
  }

  /** Mark a comment answered (the agent replied to it). */
  markAnswered(threadId: string, commentId: string): void {
    const c = this.get(threadId)?.comments.find((x) => x.id === commentId)
    if (c && !c.answered) this.put(null, [{ ...c, answered: true }], threadId)
  }

  resolve(threadId: string, resolved = true): void {
    const thread = this.get(threadId)
    if (!thread || thread.resolved === resolved) return
    this.put({ ...thread, resolved }, [])
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Write the pending change now (the debounce is for bursts, not for losing one). */
  async flush(): Promise<void> {
    this.cancelWrite?.()
    this.cancelWrite = null
    await this.write()
  }

  /** Stop listening; a pending write is flushed, not dropped. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.off?.()
    this.listeners.clear()
    if (this.cancelWrite) await this.flush()
  }

  // ---- internals ----

  private newId(): string {
    return this.opts.newId?.() ?? crypto.randomUUID()
  }

  /** One write: the thread's own fields (when given) and comments, in one transaction. */
  private put(thread: ThreadRecord | null, comments: CommentRecord[], threadId = thread?.id ?? ''): void {
    if (this.map && this.ydoc) {
      const map = this.map
      this.ydoc.transact(() => {
        if (thread) map.set(THREAD_KEY + thread.id, storedOf(thread))
        for (const c of comments) map.set(`${COMMENT_KEY}${threadId}/${c.id}`, c)
      }, COMMENTS_ORIGIN)
      return // the observer schedules the write
    }
    const was = this.memory.get(threadId)
    const base = thread ?? was
    if (!base) return
    const merged = new Map((was?.comments ?? []).map((c) => [c.id, c]))
    for (const c of thread?.comments ?? []) merged.set(c.id, c)
    for (const c of comments) merged.set(c.id, c)
    this.memory.set(threadId, { ...base, comments: ordered([...merged.values()], base.comments[0]?.id) })
    this.changed()
  }

  private changed(): void {
    if (this.disposed) return
    this.notify()
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    this.cancelWrite ??= this.opts.clock.schedule(() => {
      this.cancelWrite = null
      void this.write()
    }, this.opts.debounceMs ?? THREAD_WRITE_DEBOUNCE_MS)
  }

  private notify(): void {
    for (const cb of [...this.listeners]) cb()
  }

  private async write(): Promise<void> {
    const file: ThreadsFile = {
      version: THREADS_FILE_VERSION,
      key: this.opts.key,
      path: this.opts.path(),
      threads: this.threads(),
    }
    const text = `${JSON.stringify(file, null, 2)}\n`
    if (text === this.lastWritten || text === this.writing) return
    this.writing = text
    try {
      await this.opts.files.write(commentsFile(this.opts.key), text)
      // Only a write that landed counts: a failed one is tried again.
      this.lastWritten = text
    } catch {
      if (!this.disposed) this.scheduleWrite()
    } finally {
      if (this.writing === text) this.writing = null
    }
  }
}

function storedOf(t: ThreadRecord): StoredThread {
  const root = t.comments[0]?.id
  return { id: t.id, author: t.author, created: t.created, resolved: t.resolved, anchor: t.anchor, ...(root ? { root } : {}) }
}

/** The materialized file, or null when it is not one (a corrupt file is not a crash). */
export function parseThreadsFile(raw: string): ThreadsFile | null {
  try {
    const v = JSON.parse(raw) as Partial<ThreadsFile>
    if (!v || v.version !== THREADS_FILE_VERSION || !Array.isArray(v.threads)) return null
    const threads = v.threads.filter(
      (t): t is ThreadRecord =>
        !!t && typeof t.id === 'string' && !!t.anchor && typeof t.anchor.quote?.exact === 'string' && Array.isArray(t.comments)
    )
    return { version: THREADS_FILE_VERSION, key: String(v.key ?? ''), path: String(v.path ?? ''), threads }
  } catch {
    return null
  }
}
