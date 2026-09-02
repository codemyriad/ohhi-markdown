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
 * `recordFor(path)` factory returning a STABLE object per path (providers
 * hold references and mutate fields in place — in the web shell these are
 * Svelte `$state` objects, which satisfy this interface structurally).
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
  kind: 'text' | 'binary'
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
   * Boot-time mass-change breaker (spike S8 Q3): more than massChangePaths
   * files changed/appeared/vanished while the mount was closed. The batch is
   * HELD until the host calls confirmBootBatch() or dismissBootBatch().
   * Unhandled (no listener), the batch auto-confirms with a console warning —
   * V1-shell parity; the real confirm dialog lands in slice M3.
   */
  onBreaker?: (paths: string[]) => void
  onError?: (err: unknown) => void
}
