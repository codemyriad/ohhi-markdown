/**
 * The engine seam: the only surface the rest of the codebase may use to talk
 * to the CRDT engine. Nothing outside libs/sync imports `yjs` (sanctioned
 * exception: the CM6 collab binding and network providers, which need the raw
 * doc — they go through `EngineDoc.raw()` and live in clearly-marked modules).
 *
 * See docs/primers/04-engine-seam.md for why this exists (Yjs v14 migration,
 * Loro swap option, invariant-based testing).
 */

/**
 * Opaque identity of "what this doc has seen": state vector + delete set.
 * A state vector alone does NOT cover delete-only edits (deletions extend the
 * delete set without advancing clocks), so equality MUST compare both.
 * Decision log: "CRDT engine" row in plans/shaping.md.
 */
export interface Heads {
  /** Encoded state vector — usable as an update-diff target. */
  readonly sv: Uint8Array
  /** Encoded snapshot (state vector + delete set) — the equality authority. */
  readonly snapshot: Uint8Array
}

export interface TextHandle {
  insert(index: number, text: string): void
  delete(index: number, length: number): void
}

/**
 * Entry in a folder doc's path map. 'dir' entries (slice M3) make directories
 * first-class so empty folders enroll, sync, and materialize; they carry no
 * Y.Doc, no LCA, no provider — the guid only gives them a stable identity.
 */
export interface FileEntry {
  guid: string
  kind: 'text' | 'binary' | 'dir'
  deleted?: boolean
}

export interface MapHandle {
  get(key: string): FileEntry | undefined
  set(key: string, value: FileEntry): void
  delete(key: string): void
  entries(): [string, FileEntry][]
  /** Fires after any change to the map; `origin` is the transaction origin. */
  observe(cb: (origin: unknown) => void): () => void
}

/** Transaction origins — consumers filter on these to avoid echo loops. */
export type Origin = 'local' | 'disk' | 'remote' | 'seed'

export interface EngineDoc {
  readonly guid: string
  /** Current text content (text docs). */
  getText(): string
  /** Mutate text atomically; all ops in one engine transaction with `origin`. */
  transact(fn: (text: TextHandle) => void, origin: Origin): void
  /** Path → FileEntry map (folder docs). */
  getMap(): MapHandle
  /** Mutate the map atomically. */
  transactMap(fn: (map: MapHandle) => void, origin: Origin): void
  /**
   * Escape hatch for collab bindings/providers that need the engine-native
   * doc object. Returns the underlying Y.Doc. Do not use outside
   * libs/editor's binding module and provider wiring.
   */
  raw(): unknown
  destroy(): void
}

export interface SyncEngine {
  createDoc(guid: string): EngineDoc
  /** Apply a remote/persisted update. */
  applyUpdate(doc: EngineDoc, update: Uint8Array, origin?: Origin): void
  /** Encode everything `doc` knows that `since` doesn't. `null` = full state. */
  encodeUpdateSince(doc: EngineDoc, since: Heads | null): Uint8Array
  heads(doc: EngineDoc): Heads
  headsEqual(a: Heads, b: Heads): boolean
  encodeHeads(h: Heads): Uint8Array
  decodeHeads(bytes: Uint8Array): Heads
  /** Subscribe to update emission (fires for local and applied updates). */
  onUpdate(
    doc: EngineDoc,
    cb: (update: Uint8Array, origin: unknown) => void
  ): () => void
}
