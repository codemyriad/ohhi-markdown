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
 * watcher. Not per-adapter policy: `.editor/` holding a user theme that gets
 * enrolled as a note, synced to every peer, and simultaneously read as the
 * stylesheet Editor is rendering itself with is the same bug in each one.
 *
 * `read`/`writeAtomic` are deliberately NOT filtered — Editor reads its own
 * `.editor/` files directly (see Workspace.readAppFile).
 */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.obsidian',
  '.editor',
  '.editor-cache',
  '.trash',
  'node_modules',
])

export interface VaultAdapter {
  list(): Promise<FileStat[]>
  /**
   * Every directory path (deep, POSIX-relative, ignored dirs excluded) — kept
   * separate from list() so existing file consumers never see dirs (M3).
   */
  listDirs(): Promise<string[]>
  /** null if the file does not exist (or the path is a directory). */
  read(path: string): Promise<Uint8Array | null>
  /** Atomic: temp file + fsync + rename (or simulated equivalent). */
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  /** Create a directory (parents included); idempotent. */
  mkdir(path: string): Promise<void>
  /** Remove an EMPTY directory; rejects when non-empty; missing is a no-op. */
  removeDir(path: string): Promise<void>
  /** Move a directory and everything under it (copy+delete where the platform has no rename). */
  renameDir(from: string, to: string): Promise<void>
  /** Raw change notifications; QuiescedWatcher turns these into stable events. */
  watch(cb: (ev: WatchEvent) => void): () => void
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

export interface JournalEntry {
  path: string
  at: number
  bytes: Uint8Array
}

/** Pre-image journal: content snapshot before every Editor-initiated write. */
export interface PreImageJournal {
  record(path: string, bytes: Uint8Array | null): Promise<void>
  entries(path?: string): Promise<JournalEntry[]>
  /** Latest pre-image for a path, if any. */
  latest(path: string): Promise<JournalEntry | null>
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
