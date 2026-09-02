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
  kind: 'text' | 'binary' | 'dir'
}

/** UI-facing events; every mutation the host must mirror into its view state. */
export interface MountEvents {
  /** Full row list after any folder-map change (sorted by path). */
  onFiles?: (rows: FileRow[]) => void
  /** Sorted unique presence names from the folder-doc awareness. */
  onPresence?: (names: string[]) => void
  onReview?: (review: DivergenceReview) => void
  onReviewCleared?: (guid: string) => void
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
