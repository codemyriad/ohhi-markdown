/**
 * Relay provider wiring — one HocuspocusProvider per doc, doc-named
 * `<folderGuid>/<docGuid>` (docs/architecture/relay.md). This module and the
 * editor binding are the sanctioned `EngineDoc.raw()` consumers: providers
 * need the engine-native Y.Doc (engine-seam exception, overview.md rule 3).
 *
 * Provider facts (verified against @hocuspocus/provider 4.1.2 source):
 * - constructing with `url` creates a managed socket and auto-connects;
 * - remote updates are applied with origin = the provider INSTANCE (never the
 *   seam's 'remote' string) — callers must compare origins against
 *   `connection.provider`;
 * - `unsyncedChanges` counts local updates not yet acked by the server's
 *   SyncStatus message; `synced` flips true once it drains after a handshake;
 * - a provider given an explicit `websocketProvider` does NOT auto-attach
 *   (manageSocket is false) — the non-browser path below attaches by hand.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import type { EngineDoc } from '@editor/sync'
import type { CollabUser, SyncRecordFields } from './types.js'

export interface DocConnection {
  provider: HocuspocusProvider
  awareness: Awareness
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
}

export function connectDoc(opts: ConnectDocOptions): DocConnection {
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
  let socket: HocuspocusProviderWebsocket | null = null
  if (opts.webSocketPolyfill) {
    socket = new HocuspocusProviderWebsocket({
      url: opts.relay,
      WebSocketPolyfill: opts.webSocketPolyfill as typeof WebSocket,
    })
    provider = new HocuspocusProvider({ ...shared, websocketProvider: socket })
    provider.attach()
  } else {
    provider = new HocuspocusProvider({ ...shared, url: opts.relay })
  }

  return {
    provider,
    awareness,
    // provider.destroy() also destroys the awareness it was handed; an
    // explicitly-created socket is ours to close.
    destroy: () => {
      provider.destroy()
      socket?.destroy()
    },
  }
}

/**
 * Resolve when `provider.synced` and `ready()` hold. Polling (50ms) instead
 * of event-juggling: the extra condition (e.g. "folder map non-empty") has no
 * single event source — the seeder may connect long after we do.
 */
export function whenSynced(
  provider: HocuspocusProvider,
  ready: () => boolean = () => true,
  timeoutMs = 60_000,
  failed: () => string | null = () => null
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const failure = failed()
      if (failure) return reject(new Error(failure))
      if (provider.synced && ready()) return resolve()
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`relay sync timed out after ${timeoutMs}ms (${provider.configuration.name})`))
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}
