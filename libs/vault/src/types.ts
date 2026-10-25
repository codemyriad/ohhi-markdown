/** Core vault types. See docs/architecture/vault-and-reconciler.md. */

export interface FileStat {
  path: string
  size: number
}

export interface WatchEvent {
  /** Paths that changed in this batch (create/modify/rename/delete). */
  paths: string[]
}

/**
 * Adapter over a real or simulated vault directory.
 * Implementations: MemVaultAdapter (tests/demo), NodeVaultAdapter
 * (tests/CLI, ./node export), TauriVaultAdapter (apps/web under Tauri).
 */
/**
 * Directories every VaultAdapter must hide from `list`, `listDirs` and the
 * watcher. Not per-adapter policy: `.ohhi/` holding a user theme that gets
 * enrolled as a note, synced to every peer, and simultaneously read as the
 * stylesheet Editor is rendering itself with is the same bug in each one.
 *
 * `read`/`writeAtomic` are deliberately NOT filtered — Editor reads its own
 * `.ohhi/` files directly (see Workspace.readAppFile).
 */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.obsidian',
  '.ohhi',
  '.ohhi-cache',
  // The pre-rename app folders: ignored so a vault made before the rename never enrols them as notes.
  '.editor',
  '.editor-cache',
  // The skills farm: `.claude/skills/` mirrors `.agents/skills/`; never index or enrol the copy.
  '.claude',
  '.trash',
  'node_modules',
])

/**
 * The infix every `writeAtomic` temp file carries (`<file>.ohhi-tmp-…`).
 * Listings and watchers skip any name for which `isTempName` holds.
 */
export const TEMP_INFIX = '.ohhi-tmp-'

/**
 * True for a `writeAtomic` temp name — the current `.ohhi-tmp-` infix or the
 * pre-rename `.editor-tmp-` one, which a crashed older build can leave behind.
 */
export const isTempName = (name: string): boolean =>
  name.includes(TEMP_INFIX) || name.includes('.editor-tmp-')

/**
 * Compare-and-swap for `writeAtomic` (Spike S11 finding F1).
 *
 * A reconciler reads a file to classify it, does durable work (journaling),
 * and only then writes. Without a check at the seam, an external write —
 * an agent, git, another editor — that lands inside that window is
 * overwritten and survives NOWHERE: not on disk, not in the journal (which
 * holds the pre-agent bytes), and in no review (the classification already
 * happened). The check has to be here, as late as the implementation can
 * make it, because a re-read by the CALLER just moves the window.
 */
export interface WriteOptions {
  /**
   * Refuse the write unless the file's CURRENT content hash is this.
   * `''` means "there must be no file there" — the same convention
   * `LcaRecord.contentHash` uses for a note that has never been on disk.
   * Omit it entirely for an unconditional write (seeding, tests, the
   * durable store).
   */
  expectHash?: string
}

/**
 * `writeAtomic` refused because the bytes on disk are not the ones the caller
 * expected. Thrown by every adapter; caught by `materialize`, which
 * reclassifies instead of writing (so the external bytes are ingested or
 * surfaced as a review rather than lost).
 */
export class WriteConflictError extends Error {
  readonly name = 'WriteConflictError'
  constructor(
    readonly path: string,
    /** What the caller expected to find; `''` for "nothing". */
    readonly expected: string,
    /** What is actually there now; `''` when the file is absent. */
    readonly actual: string
  ) {
    super(`write conflict on ${path}: expected ${expected || '(absent)'}, found ${actual || '(absent)'}`)
  }
}

export interface VaultAdapter {
  list(): Promise<FileStat[]>
  /**
   * Every directory path (deep, POSIX-relative, ignored dirs excluded) — kept
   * separate from list() so existing file consumers never see dirs (M3).
   */
  listDirs(): Promise<string[]>
  /** null if the file does not exist (or the path is a directory). */
  read(path: string): Promise<Uint8Array | null>
  /**
   * Atomic: temp file + fsync + rename (or simulated equivalent).
   *
   * With `opts.expectHash`, the write is a COMPARE-AND-SWAP: the destination
   * is re-read and re-hashed as late as the implementation can manage (for a
   * temp+rename adapter, immediately before the rename) and the write is
   * abandoned with a `WriteConflictError` if the bytes moved. See
   * `WriteOptions` for why the check lives here and not in the caller.
   */
  writeAtomic(path: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  /** Create a directory (parents included); idempotent. */
  mkdir(path: string): Promise<void>
  /** Remove an EMPTY directory; rejects when non-empty; missing is a no-op. */
  removeDir(path: string): Promise<void>
  /** Move a directory and everything under it (copy+delete where the platform has no rename). */
  renameDir(from: string, to: string): Promise<void>
  /**
   * Raw change notifications; QuiescedWatcher turns these into stable events.
   *
   * `onError` hears a watcher that failed to start or died: a vault with no
   * watcher silently stops ingesting outside edits, which is an error the app
   * must report, never swallow (golden rule 4 in spirit). An adapter that has
   * nothing to watch by design (OPFS: the app is the only writer) never calls it.
   */
  watch(cb: (ev: WatchEvent) => void, onError?: (err: unknown) => void): () => void
  /**
   * The files directly inside one IGNORED app directory (`.ohhi/layouts`),
   * as vault-relative paths; `[]` when it does not exist. `list()` never sees
   * them, by design (IGNORED_DIRS), so the resource loader asks here. Optional:
   * an adapter without it simply has no vault-root resources to list.
   */
  listAppDir?(dir: string): Promise<string[]>
  /**
   * The FOLDERS directly inside one ignored app directory (`.ohhi/themes`),
   * as vault-relative paths, sorted; `[]` when it does not exist. The
   * folder-shaped twin of `listAppDir`: a theme is a folder,
   * `.ohhi/themes/<name>/theme.css`, so listing the themes means listing
   * folders. Same reach as `listAppDir` — app directories only, never fed to
   * `list()`, the path map, the index or a CRDT. Optional: an adapter without
   * it has no theme folders to offer.
   */
  listAppDirs?(dir: string): Promise<string[]>
  /**
   * Changes under ONE ignored app directory (`.ohhi`), routed to their own
   * listener (spike-resource-root Q1). The events already reach the adapter's
   * watcher and are dropped there; with a listener they go HERE instead —
   * never to `watch`'s callback, so they cannot reach the path map, the index
   * or a CRDT. No second native watcher: delivery rides on an active
   * `watch()`. Raw and undebounced (one save is temp + rename = several
   * events); the subscriber debounces on its own scheduler. OPFS omits it:
   * nothing but the app writes there.
   */
  watchAppDir?(dir: string, cb: (paths: string[]) => void): () => void
}

export type EolFlavor = 'lf' | 'crlf' | 'raw'

/**
 * Last-common-ancestor record: the durable shadow state that makes three-way
 * classification possible. IRON RULE: an LcaRecord is only ever written in
 * the same logical transaction as the CRDT ingestion/materialization it
 * describes (see the "Offline/collab seam" decision-log kill).
 */
export interface LcaRecord {
  guid: string
  path: string
  /** Shadow copy of the content at LCA time — the diff/merge base. */
  baseText: string
  /** sha-256 (hex) of the raw disk bytes at LCA time. */
  contentHash: string
  /** Encoded engine heads (state vector + delete set) at LCA time. */
  heads: Uint8Array
  eol: EolFlavor
  bom: boolean
}

export interface LcaStore {
  get(guid: string): Promise<LcaRecord | null>
  put(rec: LcaRecord): Promise<void>
  remove(guid: string): Promise<void>
  all(): Promise<LcaRecord[]>
}

/**
 * One journaled pre-image WITHOUT its bytes — everything a listing needs.
 *
 * Split out from `JournalEntry` because the History rail lists a note's
 * twenty retained versions on every flush (M11): reading each one back just
 * to learn its length turned a metadata read into a full content read of the
 * entire retention window. The size travels in the entry's own name, so a
 * listing is a directory listing.
 */
export interface JournalEntryInfo {
  /**
   * Stable, monotonic id within one journal — what a UI names when it asks
   * for a specific pre-image back (the History rail section, W3). `at` alone
   * cannot: a coarse clock stamps two records of the same path identically.
   */
  seq: number
  path: string
  at: number
  /** Byte length of the pre-image. */
  size: number
}

export interface JournalEntry extends JournalEntryInfo {
  bytes: Uint8Array
}

/** Pre-image journal: content snapshot before every Editor-initiated write. */
export interface PreImageJournal {
  record(path: string, bytes: Uint8Array | null): Promise<void>
  /** Metadata only: no pre-image's bytes are read (M11). */
  list(path?: string): Promise<JournalEntryInfo[]>
  entries(path?: string): Promise<JournalEntry[]>
  /** Latest pre-image for a path, if any. */
  latest(path: string): Promise<JournalEntry | null>
  /**
   * Follow a rename/move: every entry for `from` — and, prefix-wise, for the
   * subtree under it — is re-keyed to `to`. The journal is keyed by path, so
   * without this a rename silently ends a note's recoverable history: the
   * pre-images stay on disk under a name nothing will ever ask for (M10).
   */
  rename(from: string, to: string): Promise<void>
}

export type ReconcileAction =
  | 'noop'
  | 'materialized' // CRDT advanced, disk untouched → wrote disk
  | 'ingested' // disk changed externally, CRDT didn't → applied as ops
  | 'diverged' // both changed → review required, nothing written
  | 'escalated' // clean path but threshold tripped → review required

export interface ReconcileResult {
  action: ReconcileAction
  /** Present when a review is required. */
  review?: DivergenceReview
}

export interface DivergenceReview {
  guid: string
  path: string
  base: string
  /** Editor/CRDT side. */
  mine: string
  /** Disk side. */
  theirs: string
  reason: 'three-way' | 'ratio-threshold' | 'stale-echo' | 'mass-change' | 'vanished'
}

export interface ReconcileThresholds {
  /** Escalate external ingest when levenshtein(diff)/baseLen exceeds this (and base is non-trivial). */
  maxIngestRatio: number
  /** Base length below which ratio escalation never applies. */
  ratioMinBaseLength: number
  /** Watch batches touching more than this many known files pause for confirmation. */
  massChangePaths: number
  /** How many recent flush hashes to remember per path (stale-echo detection). */
  flushRingSize: number
}

export const DEFAULT_THRESHOLDS: ReconcileThresholds = {
  maxIngestRatio: 0.6,
  ratioMinBaseLength: 240,
  massChangePaths: 20,
  flushRingSize: 8,
}
