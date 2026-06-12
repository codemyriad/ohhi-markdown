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
 *   SyncStatus message; `synced` flips true once it drains after a handshake.
 */
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import type { EngineDoc } from '@editor/sync'
import type { SyncRecord } from './sync-record.svelte.js'
import type { CollabUser } from '@editor/editor'

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
  record: SyncRecord
}

export function connectDoc(opts: ConnectDocOptions): DocConnection {
  const ydoc = opts.doc.raw() as Y.Doc
  const awareness = new Awareness(ydoc)
  awareness.setLocalStateField('user', { name: opts.user.name, color: opts.user.color })

  const provider = new HocuspocusProvider({
    url: opts.relay,
    name: opts.name,
    token: opts.token,
    document: ydoc,
    awareness,
    onStatus: ({ status }) => {
      opts.record.connected = status === 'connected'
      // synced is only re-emitted by the provider on the next handshake;
      // degrade immediately so the pill never shows a stale green.
      if (status !== 'connected') opts.record.synced = false
    },
    onSynced: () => {
      opts.record.synced = true
    },
    onUnsyncedChanges: ({ number }) => {
      opts.record.pendingLocal = number > 0
    },
  })

  return {
    provider,
    awareness,
    // provider.destroy() also destroys the awareness it was handed.
    destroy: () => provider.destroy(),
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
  timeoutMs = 60_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (provider.synced && ready()) return resolve()
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`relay sync timed out after ${timeoutMs}ms (${provider.configuration.name})`))
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}
