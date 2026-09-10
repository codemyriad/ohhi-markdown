/**
 * Host-neutral workspace types. This package must not depend on Svelte or any
 * UI framework: hosts (the web shell, a future Obsidian plugin, a headless
 * peer) inject reactive record objects and consume events.
 */
import type { DivergenceReview } from '@editor/vault'

/** Presence identity for cursors/awareness (plain twin of the editor's type). */
export interface CollabUser {
  name: string
  color: string
}

export interface RelayConfig {
  url: string
  token: string
}

/**
 * The mutable fields of a per-doc sync record. Hosts hand MountSession a
 * `recordFor(key)` factory returning a STABLE object per key (providers hold
 * references and mutate fields in place — in the web shell these are Svelte
 * `$state` objects, which satisfy this interface structurally). Keys are doc
 * GUIDs plus FOLDER_RECORD_KEY — guids survive renames, paths don't (M3).
 */
export interface SyncRecordFields {
  connected: boolean
  synced: boolean
  pendingLocal: boolean
  diskMatchesCrdt: boolean
  diverged: boolean
}

/** records key for the folder doc ('//' is impossible in a vault path). */
export const FOLDER_RECORD_KEY = '//folder'

export interface FileRow {
  path: string
  guid: string
  /**
   * 'mount' (N1) is a nested share's root: the subtree belongs to another
   * mount session on this device, and `guid` is that mount's ROOM guid, not a
   * doc guid. The tree renders it as the shared folder it is.
   */
  kind: 'text' | 'binary' | 'dir' | 'mount'
}

/**
 * A `kind:'mount'` entry as the map announces it (device-link-shaping A2):
 * where the nested share is, which room it is, and which relay carries it.
 * Never a token — the map is advisory, never an auth source (shaping D4).
 */
export interface MountEntryInfo {
  /** Mount root, relative to THIS mount's root. */
  path: string
  /** The room GUID (the map entry's `guid`). */
  room: string
  relay?: string
}

/** UI-facing events; every mutation the host must mirror into its view state. */
export interface MountEvents {
  /** Full row list after any folder-map change (sorted by path). */
  onFiles?: (rows: FileRow[]) => void
  /**
   * The CURRENT set of `kind:'mount'` entries in this mount's map (N1,
   * device-link-shaping A2/A3) — a full snapshot, not a delta, sorted by path.
   *
   * Fired once at boot (so a device that was offline during someone else's
   * carve adopts on reopen) and thereafter whenever the set changes from a
   * FOREIGN origin — i.e. a peer carved or unshared a subtree of a room we
   * share. Our own carve mutates the map with a 'local' origin and does not
   * fire: the carver already knows. Always emitted AFTER `onFiles`, so a host
   * that renders from rows has the mount row before it hears about the mount.
   *
   * This is the trigger for the peer-side adopt/absorb machine.
   */
  onMountEntries?: (entries: MountEntryInfo[]) => void
  /** Sorted unique presence names from the folder-doc awareness. */
  onPresence?: (names: string[]) => void
  onReview?: (review: DivergenceReview) => void
  onReviewCleared?: (guid: string) => void
  /**
   * A text doc's CONTENT changed, from any writer. Fires for local keystrokes,
   * remote peers, and — critically — `disk`-origin ingests, i.e. Obsidian,
   * git and Claude Code editing the same files (V2 slice V2b, B2.1).
   *
   * Emitted BEFORE routeDocUpdate's origin filter on purpose: an index that
   * only saw local edits would go blind to exactly the writers this product
   * exists to coexist with. `path` is MOUNT-RELATIVE like every other path
   * on this interface; hosts spanning mounts must re-prefix it.
   *
   * Fire-and-forget: listeners must not throw and must not do I/O inline.
   */
  onDocChanged?: (guid: string, path: string, origin: unknown) => void
  /** Fired when the mount becomes shared (join boot, or enableSharing). */
  onShared?: (link: string) => void
  /**
   * Mass-change breaker (spike S8 Q3 + watch batches, unified in M3): more
   * than massChangePaths files changed at once — boot delta or live watch
   * (git-branch-switch shape). The batch is HELD until the host calls
   * confirmBreaker() or dismissBreaker(). Unhandled (no listener), it
   * auto-confirms with a console warning (headless parity).
   */
  onBreaker?: (paths: string[]) => void
  /**
   * Paths changed identity (rename/move, local or remote, incl. every child
   * of a directory move). Hosts MUST re-key per-path state by MOVING the
   * existing record object under the new key — providers hold and mutate that
   * object, so a fresh record would go dead (M3).
   */
  onPathsRenamed?: (moves: { from: string; to: string }[]) => void
  onError?: (err: unknown) => void
}
