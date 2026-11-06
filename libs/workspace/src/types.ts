/**
 * Host-neutral workspace types. This package must not depend on Svelte or any
 * UI framework: hosts (the web shell, a future Obsidian plugin, a headless
 * peer) inject reactive record objects and consume events.
 */
import type { DivergenceReview } from '@ohhi/vault'
import type { AppEvent } from './events.js'

/** Presence identity for cursors/awareness (plain twin of the editor's type). */
export interface CollabUser {
  name: string
  color: string
}

/** One doc's file on the custodian's backend, as `CustodianState.disk` reports it. */
export type DiskState = 'match' | 'behind' | 'blocked'

/**
 * What a headless custodian announces on the folder-doc awareness under the
 * `custodian` field (nextcloud-build decision 8). Per doc guid: `match` when
 * the bytes behind the room equal the doc, `behind` while a write is pending
 * or retrying, `blocked` when the backend refused it (`blocked` carries the
 * HTTP status). Ephemeral by design: a custodian that is gone takes its claim
 * with it.
 */
export interface CustodianState {
  type: 'custodian'
  instance: string
  disk: Record<string, DiskState>
  blocked: Record<string, number>
  /**
   * How many changes the custodian is holding for a person to answer
   * (nextcloud-build decision 7). The shell fetches the vault's status the
   * moment this moves, instead of finding out on a blind poll.
   */
  holds: number
}

export interface RelayConfig {
  url: string
  token: string
  /**
   * Fetch a fresh token for every (re)connect (nextcloud-build decision 4):
   * a host whose tokens are short-lived passes this and the provider calls
   * it on each handshake; `token` stays the first value, for the places that
   * compare or encode a token as a string (a share link, a socket identity).
   */
  refreshToken?: () => Promise<string>
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
  /**
   * base64 of the new room's folder-doc state, as the announcer wrote it
   * (`FileEntry.seed`). Absent above the size cap — then a peer with a token
   * pulls the room instead of seeding (spike S10 Q1).
   */
  seed?: string
}

/**
 * Where a first join has got to. `pull` = waiting on the relay, `write` =
 * writing the pulled content into the vault folder. `done`/`total` are
 * counted in DOCS (the map's non-deleted text entries), so the two phases
 * share one denominator and a panel can render both determinately.
 */
export interface PullProgress {
  phase: 'pull' | 'write'
  done: number
  total: number
}

/**
 * One peer present in one doc (sharing E1): their awareness client id on that
 * doc, the name they announce, and — when their view has focus — the caret as
 * a Yjs relative position (JSON), which the host resolves at the moment it
 * jumps. Names are self-reported, never verified.
 */
export interface DocPeer {
  clientId: number
  name: string
  cursor: { anchor: unknown; head: unknown } | null
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
   * This is the trigger for the peer-side adopt/absorb machine. A promise the
   * handler returns is AWAITED on the session's serialized map-work chain,
   * ahead of the map scan for that same change — so an adopt or an absorb
   * never interleaves with the scan adopting the very guids it is moving.
   */
  onMountEntries?: (entries: MountEntryInfo[]) => void | Promise<void>
  /**
   * The folder map changed, fired SYNCHRONOUSLY inside the observer before any
   * await (N1, S10 Q6). The host recomputes its derived ignore set here —
   * `mounts.json ∪ the map's kind:'mount' entries` — so a mount root a peer
   * just announced is hidden from this instruction on, well before this
   * device has a desc of its own to derive it from.
   *
   * Must not throw and must not do I/O: it runs inside a CRDT transaction
   * callback.
   */
  onMapChanged?: () => void
  /** Sorted unique presence names from the folder-doc awareness. */
  onPresence?: (names: string[]) => void
  /**
   * A headless custodian's state, read off the folder-doc awareness
   * (nextcloud-build decision 8): what it has written to the files behind the
   * room and what it could not. `null` when no custodian is present — an
   * honest "nothing is keeping files up to date" rather than a stale map.
   */
  onCustodianState?: (state: CustodianState | null) => void
  /**
   * Who is IN one doc (sharing E1): the peers whose awareness on this doc's
   * provider says `here: true` — set by their session while a view holds the
   * note (`setOpenPaths`), cleared when the last one leaves. Ourselves
   * excluded. Keyed by guid (rename-stable); an empty list when nobody is,
   * and on every teardown of the doc's connection.
   */
  onDocPresence?: (guid: string, peers: DocPeer[]) => void
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
   * First-join progress, in the two phases the measurement found (spike S10
   * Q4 §"Where the progress signal comes from"): `pull` counts doc providers
   * whose first `synced` has landed, `write` counts files materialized onto
   * disk — which is where ~92% of the wait goes and what nothing reported.
   *
   * `total` is 0 until the folder doc syncs and the map hands over the
   * denominator; both phases share it. Emitted only while a `firstJoin` boot
   * is running; fire-and-forget (a progress line must never break a pull).
   */
  onPullProgress?: (progress: PullProgress) => void
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
  /**
   * One event appended to this room's log (sharing E3, spike S22): an
   * attributed remote or disk edit (`doc.changed`, folded per note per
   * window), a peer's map change (`file.*`), a peer joining or leaving, a
   * relay edge, a review or a held batch, a mount status transition. A fold
   * re-reports the SAME `id` with the new `count`/`at` — hosts replace by id.
   * The stored history is `MountSession.roomEvents()`, read on mount open.
   *
   * Notices are not here: `onError` and the adopt machine's notices keep
   * their own paths, worded by the host. Fire-and-forget; must not throw.
   */
  onEvent?: (event: AppEvent) => void
}
