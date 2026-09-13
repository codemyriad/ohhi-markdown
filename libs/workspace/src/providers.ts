/**
 * Relay provider wiring — doc-named `<folderGuid>/<docGuid>`
 * (docs/architecture/relay.md). This module and the editor binding are the
 * sanctioned `EngineDoc.raw()` consumers: providers need the engine-native
 * Y.Doc (engine-seam exception, overview.md rule 3).
 *
 * Provider facts (verified against @hocuspocus/provider 4.1.2 source):
 * - constructing with `url` creates a managed socket and auto-connects;
 * - remote updates are applied with origin = the provider INSTANCE (never the
 *   seam's 'remote' string) — callers must compare origins against
 *   `connection.provider`;
 * - `unsyncedChanges` counts local updates not yet acked by the server's
 *   SyncStatus message; `synced` flips true once it drains after a handshake;
 * - a provider given an explicit `websocketProvider` does NOT auto-attach
 *   (manageSocket is false) — the callers below attach by hand.
 *
 * ONE SOCKET PER ROOM (spike S10-Q4 §"Connection model"). A socket per doc put
 * a 1,029-note vault on 1,030 concurrent WebSockets, over the browser's global
 * cap (~255 Chrome / 200 Firefox) — a live ceiling for any room with more than
 * ~200 notes. Hocuspocus v4 multiplexes: one `HocuspocusProviderWebsocket`
 * keeps a `providerMap` keyed by document name and routes incoming messages by
 * it, so every doc of a mount can ride one socket. Auth stays per DOCUMENT:
 * the server runs `onAuthenticate` per document name and answers a rejection
 * with a permission-denied message addressed to that document only, leaving
 * the socket (and every other doc on it) untouched — verified against
 * @hocuspocus/server 4.1.2 `ClientConnection.handleQueue`, and exercised
 * against the real relay in `test/providers.test.ts`. What a shared socket
 * does NOT survive is a rejection of the CONNECTION itself: the relay has no
 * connection-level auth today, but were one added, every attached doc would
 * see `status: disconnected` with no `onAuthenticationFailed` — no permanent
 * error to report, just a reconnect loop, which is what the `whenSynced`
 * backstop and the stall watchdog below are for.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket, WebSocketStatus } from '@hocuspocus/provider'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import type { EngineDoc } from '@ohhi/sync'
import type { Clock } from '@ohhi/vault'
import type { CollabUser, SyncRecordFields } from './types.js'

/**
 * Fallback for callers that have not threaded their injected Clock through to
 * `whenSynced` yet (golden rule 5 — every Editor-owned scheduler is injected;
 * MountSession passes `clock: this.clock`). Kept so the timeout backstop can
 * never silently disappear when the option is omitted.
 */
const ambientClock: Clock = {
  now: () => Date.now(), // clock-exempt: documented fallback, see above
  schedule: (fn, ms) => {
    const id = setTimeout(fn, ms) // clock-exempt: documented fallback, see above
    return () => clearTimeout(id)
  },
}

// ---------------------------------------------------------------- room socket

/**
 * One multiplexed relay connection shared by every doc of a mount. Create one
 * per (relay, token) — the token is not a socket-level credential (Hocuspocus
 * sends it per document), it is part of the identity a host caches on.
 */
export interface RoomSocket {
  readonly relay: string
  readonly token: string
  /** The Hocuspocus socket; doc providers attach to it by document name. */
  readonly websocket: HocuspocusProviderWebsocket
  /** Docs currently attached (Hocuspocus's own `providerMap`). */
  readonly attached: number
  /** Closes the socket. Detach the docs first (`DocConnection.destroy()`). */
  destroy(): void
}

export interface RoomSocketOptions {
  /** Non-browser hosts (headless peer, tests) pass their WebSocket impl. */
  webSocketPolyfill?: unknown
}

/**
 * Open one socket that many `connectDoc` calls can share. The socket connects
 * eagerly (Hocuspocus `autoConnect`) and reconnects on its own; a doc attached
 * while it is already open is handed the open event immediately, so attach
 * order does not matter.
 */
export function createRoomSocket(
  relay: string,
  token: string,
  opts: RoomSocketOptions = {}
): RoomSocket {
  const websocket = new HocuspocusProviderWebsocket({
    url: relay,
    ...(opts.webSocketPolyfill ? { WebSocketPolyfill: opts.webSocketPolyfill as typeof WebSocket } : {}),
  })
  return {
    relay,
    token,
    websocket,
    get attached(): number {
      return websocket.configuration.providerMap.size
    },
    destroy: () => websocket.destroy(),
  }
}

// ---------------------------------------------------------------- doc connect

export interface DocConnection {
  provider: HocuspocusProvider
  awareness: Awareness
  /** True when this doc rides a caller-owned `RoomSocket`. */
  readonly shared: boolean
  /** Detaches this doc. Never closes a shared socket — that is `RoomSocket`'s. */
  destroy(): void
}

export interface ConnectDocOptions {
  relay: string
  /** Relay doc name: `${room}/folder` or `${room}/${guid}`. */
  name: string
  token: string
  doc: EngineDoc
  user: CollabUser
  /** Reactive record this provider keeps honest. */
  record: SyncRecordFields
  /** Auth rejection is permanent — surface it instead of retrying silently. */
  onAuthFailed?: (reason: string) => void
  /** Non-browser hosts (headless peer, tests) pass their WebSocket impl. */
  webSocketPolyfill?: unknown
  /**
   * Ride a shared socket instead of opening one (S10-Q4). `relay` must match
   * `socket.relay`; `webSocketPolyfill` is ignored (the socket owns it).
   */
  socket?: RoomSocket
}

export function connectDoc(opts: ConnectDocOptions): DocConnection {
  if (opts.socket && opts.socket.relay !== opts.relay) {
    // Silently riding the wrong socket would ship a room's docs to another
    // relay; a mount always passes its own `relay.url` for both.
    throw new Error(
      `connectDoc: socket is for ${opts.socket.relay}, not ${opts.relay} (${opts.name})`
    )
  }
  const ydoc = opts.doc.raw() as Y.Doc
  const awareness = new Awareness(ydoc)
  awareness.setLocalStateField('user', { name: opts.user.name, color: opts.user.color })

  const shared = {
    name: opts.name,
    token: opts.token,
    document: ydoc,
    awareness,
    onStatus: ({ status }: { status: string }) => {
      opts.record.connected = status === 'connected'
      // synced is only re-emitted by the provider on the next handshake;
      // degrade immediately so the pill never shows a stale green.
      if (status !== 'connected') opts.record.synced = false
    },
    onSynced: () => {
      opts.record.synced = true
    },
    onUnsyncedChanges: ({ number }: { number: number }) => {
      opts.record.pendingLocal = number > 0
    },
    onAuthenticationFailed: ({ reason }: { reason: string }) => {
      opts.record.connected = false
      opts.record.synced = false
      opts.onAuthFailed?.(reason)
    },
  }

  let provider: HocuspocusProvider
  // The socket this connection OWNS (and must therefore close). A shared
  // RoomSocket is never ours: detaching the doc is the whole teardown.
  let ownedSocket: HocuspocusProviderWebsocket | null = null
  if (opts.socket) {
    provider = new HocuspocusProvider({ ...shared, websocketProvider: opts.socket.websocket })
    provider.attach()
    // Hocuspocus emits `status` on the SOCKET's transitions only. A doc that
    // attaches to an ALREADY-OPEN socket is handed `onOpen` (so it syncs at
    // once) but never a status event — `HocuspocusProviderWebsocket.attach`,
    // 4.1.2 — so its record would sit at connected:false while the doc is
    // plainly live. That is golden rule 4 in reverse: a pill reading
    // "offline" about a doc that is syncing. Seed it from the socket instead.
    // (Only reachable with a shared socket: a managed one is created here and
    // is never already open.)
    if (opts.socket.websocket.status === WebSocketStatus.Connected) opts.record.connected = true
  } else if (opts.webSocketPolyfill) {
    ownedSocket = new HocuspocusProviderWebsocket({
      url: opts.relay,
      WebSocketPolyfill: opts.webSocketPolyfill as typeof WebSocket,
    })
    provider = new HocuspocusProvider({ ...shared, websocketProvider: ownedSocket })
    provider.attach()
  } else {
    provider = new HocuspocusProvider({ ...shared, url: opts.relay })
  }

  return {
    provider,
    awareness,
    shared: opts.socket !== undefined,
    // provider.destroy() also destroys the awareness it was handed, and
    // detaches from whatever socket it is on (sending a per-doc CLOSE so the
    // relay unloads just this document); an explicitly-created socket is ours
    // to close, a shared one never is.
    destroy: () => {
      provider.destroy()
      ownedSocket?.destroy()
    },
  }
}

// ------------------------------------------------------------ progress + wait

/** What a progress UI needs while a group of docs pulls. */
export interface ProgressSnapshot {
  /** Providers in the group whose first `synced` has landed. */
  synced: number
  /** Providers the group is waiting for; 0 until the host knows (setTotal). */
  total: number
}

/** No group progress for this long ⇒ the relay is dead, not slow. */
export const DEFAULT_STALL_MS = 20_000

export interface ProgressTrackerOptions {
  /** Injected scheduler — the watchdog's only use of time (golden rule 5). */
  clock: Clock
  /** Known up front, or later via `setTotal` once the folder map arrives. */
  total?: number
  /** Abort the group when NOTHING has synced for this long. 0 disables. */
  stallMs?: number
  /** Called on every count change — the `pulled/total` line. Must not throw. */
  onProgress?: (snapshot: ProgressSnapshot) => void
}

/**
 * The shared half of a group pull (S10-Q4 §"Timeout"): every `whenSynced`
 * handed the same tracker reports its first `synced` to it, which
 *  (a) advances the `synced/total` counts a progress panel renders, and
 *  (b) resets ONE no-progress watchdog for the whole group.
 *
 * That is the difference the measurement asked for: `whenSynced`'s own
 * `timeoutMs` is a per-call deadline started at call time, and because every
 * per-doc wait is entered together it degenerates into one budget for the
 * whole pull. The watchdog instead aborts only when the relay has gone quiet —
 * a 1,029-doc pull that is still arriving is never cut off, and a dead relay
 * is reported in `stallMs` instead of being waited on for a minute.
 */
export class ProgressTracker {
  readonly clock: Clock
  private readonly stallMs: number
  private readonly onProgress?: (snapshot: ProgressSnapshot) => void
  private syncedCount = 0
  private totalCount: number
  private readonly waiters = new Set<(reason: string) => void>()
  private cancelWatchdog: (() => void) | null = null

  constructor(opts: ProgressTrackerOptions) {
    this.clock = opts.clock
    this.stallMs = opts.stallMs ?? DEFAULT_STALL_MS
    this.totalCount = opts.total ?? 0
    this.onProgress = opts.onProgress
  }

  get synced(): number {
    return this.syncedCount
  }

  get total(): number {
    return this.totalCount
  }

  /** Waiters currently in the group. */
  get waiting(): number {
    return this.waiters.size
  }

  snapshot(): ProgressSnapshot {
    return { synced: this.syncedCount, total: this.totalCount }
  }

  /** The denominator, learned when the folder doc syncs and the map is read. */
  setTotal(total: number): void {
    this.totalCount = total
    this.emit()
  }

  /** One more doc synced: advance the count and restart the watchdog. */
  noteSynced(): void {
    this.syncedCount++
    this.arm()
    this.emit()
  }

  /** Abort every waiter in the group (stall, or a host-initiated cancel). */
  abort(reason: string): void {
    this.disarm()
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter)
      waiter(reason)
    }
  }

  /** Drop the watchdog and forget the waiters WITHOUT aborting them. */
  dispose(): void {
    this.disarm()
    this.waiters.clear()
  }

  /** @internal — `whenSynced` joins the group for the life of its wait. */
  join(abort: (reason: string) => void): void {
    this.waiters.add(abort)
    if (!this.cancelWatchdog) this.arm()
  }

  /** @internal */
  leave(abort: (reason: string) => void): void {
    this.waiters.delete(abort)
    if (this.waiters.size === 0) this.disarm()
  }

  private arm(): void {
    this.disarm()
    if (this.stallMs <= 0 || this.waiters.size === 0) return
    this.cancelWatchdog = this.clock.schedule(() => {
      this.cancelWatchdog = null
      this.abort(
        `relay stalled: no document synced for ${this.stallMs}ms ` +
          `(${this.syncedCount}/${this.totalCount} synced)`
      )
    }, this.stallMs)
  }

  private disarm(): void {
    this.cancelWatchdog?.()
    this.cancelWatchdog = null
  }

  private emit(): void {
    if (!this.onProgress) return
    // A progress line is a derived convenience; it must never be able to
    // break the pull (same rule as MountSession.emitDocChanged).
    try {
      this.onProgress(this.snapshot())
    } catch {
      /* ignore */
    }
  }
}

export interface WhenSyncedOptions {
  /** Injected scheduler for the timeout backstop. Defaults to the tracker's. */
  clock?: Clock
  /** Join a group: shared counts + one no-progress watchdog for all of them. */
  progress?: ProgressTracker
}

/**
 * Resolve when `provider.synced` and `ready()` hold — event-driven.
 *
 * Was a 50 ms poll, which cost ~20k timer callbacks/s across a 1,029-doc pull
 * (S10-Q4). The events are the provider's own: `synced`, `status` (a drop
 * clears `synced`), `authenticationFailed` (so a permanent rejection is
 * reported instead of waited out) — plus updates on the provider's Y.Doc,
 * which is the event source for the extra `ready()` condition ("the folder map
 * is non-empty"): the seeder may connect long after we do, and its arrival is
 * exactly a doc update.
 *
 * `timeoutMs` keeps its meaning and position: a per-call dead-relay backstop,
 * clocked from call time. Pass `progress` for the group watchdog that this
 * backstop cannot express (see ProgressTracker).
 */
export function whenSynced(
  provider: HocuspocusProvider,
  ready: () => boolean = () => true,
  timeoutMs = 60_000,
  failed: () => string | null = () => null,
  opts: WhenSyncedOptions = {}
): Promise<void> {
  const tracker = opts.progress ?? null
  const clock = opts.clock ?? tracker?.clock ?? ambientClock
  return new Promise((resolve, reject) => {
    let settled = false
    let counted = false
    const cleanups: (() => void)[] = []

    const settle = (err: Error | null): void => {
      if (settled) return
      settled = true
      for (const undo of cleanups.splice(0)) undo()
      if (err) reject(err)
      else resolve()
    }
    const abort = (reason: string): void => settle(new Error(reason))

    const check = (): void => {
      if (settled) return
      const failure = failed()
      if (failure) return settle(new Error(failure))
      if (provider.synced && !counted) {
        counted = true
        tracker?.noteSynced()
      }
      if (provider.synced && ready()) settle(null)
    }

    const onEvent = (): void => check()
    for (const event of ['synced', 'status', 'authenticationFailed'] as const) {
      provider.on(event, onEvent)
      cleanups.push(() => provider.off(event, onEvent))
    }
    const doc = provider.document
    doc.on('update', onEvent)
    cleanups.push(() => doc.off('update', onEvent))

    if (tracker) {
      tracker.join(abort)
      cleanups.push(() => tracker.leave(abort))
    }

    if (timeoutMs > 0) {
      cleanups.push(
        clock.schedule(
          () =>
            settle(
              new Error(`relay sync timed out after ${timeoutMs}ms (${provider.configuration.name})`)
            ),
          timeoutMs
        )
      )
    }

    check()
  })
}
