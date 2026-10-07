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
 *
 * 'mount' entries (slice N1, device-link-shaping A2) mark a subtree that has
 * become its OWN mount — a nested share. They are an opaque boundary: the
 * session that owns this map never reconciles, materializes or scans anything
 * at or under the entry's path, because that subtree belongs to another
 * session on this device. For a mount entry `guid` IS the room GUID (the
 * relay doc-name prefix), never a doc guid.
 */
export interface FileEntry {
  guid: string
  kind: 'text' | 'binary' | 'dir' | 'mount'
  deleted?: boolean
  /**
   * Mount entries only: the relay WebSocket URL the room lives on. Not a
   * secret — tokens NEVER travel in the map (shaping D4: maps and descs are
   * advisory, never an auth source), so a peer that sees this still needs its
   * own token before it can connect.
   */
  relay?: string
  /**
   * Mount entries only: base64 of the mount folder doc's FULL state, written
   * by whoever announced the mount, in the same transaction as this entry.
   *
   * It is what makes every device's copy of the new room's folder doc ONE
   * history instead of N independent ones. Before it, each peer seeded its
   * own folder doc by re-`set`ting the entries it knew — so after the merge
   * every key existed twice and a hard delete on one side (which is how a
   * rename removes its source, and how the ghost rule removes a key) had
   * nothing to delete on the other: permanent divergence
   * (`fuzz-crashers/0003`). Applying one update on every device instead
   * gives byte-identical ops everywhere.
   *
   * Structure, never a credential (shaping D4) — the seed is the map, and the
   * map already travels. Omitted above 64 KB encoded, in which case a peer
   * with a token pulls the room instead (spike S10 Q1).
   */
  seed?: string
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
  /**
   * The engine client ids whose inserts an encoded update carries, ascending
   * (sharing E3 / spike S22 Q2: remote attribution). A peer's client id is
   * per DOC INSTANCE — the same id its awareness announces itself under on
   * that doc — so the caller maps ids → names through that doc's awareness.
   * Delete-only updates carry no insert, so they return `[]`: a delete set is
   * keyed by the deleted item's AUTHOR, never by whoever deleted it, and
   * reading it as attribution would name the wrong person.
   */
  clientIdsOf(update: Uint8Array): number[]
  /**
   * Cheap character delta of an encoded update: text inserted (live string
   * content) and items deleted (the delete set). For the Changes feed's
   * `+added / −removed` — a display hint, never a correctness input.
   */
  charDeltaOf(update: Uint8Array): { added: number; removed: number }
  /** This replica's own client id on `doc` (what its updates carry). */
  clientIdOf(doc: EngineDoc): number
  /** Subscribe to update emission (fires for local and applied updates). */
  onUpdate(
    doc: EngineDoc,
    cb: (update: Uint8Array, origin: unknown) => void
  ): () => void
}
