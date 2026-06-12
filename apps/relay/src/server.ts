/**
 * createRelay — the thin Hocuspocus v4 sync server (docs/architecture/relay.md).
 *
 * Auth: static per-share bearer tokens checked in onAuthenticate against the
 * relay-authoritative shares table. Doc names are `<folderGuid>/<docGuid>`,
 * so authorization is a relay-side prefix check — never derived from doc
 * contents. Read-only shares flip `connectionConfig.readOnly`, which makes
 * Hocuspocus drop incoming updates from that connection.
 *
 * Persistence: full doc state as an opaque blob in SQLite. onLoadDocument
 * returns the stored Uint8Array (v4 applies it as a Yjs update for us);
 * onStoreDocument (debounced by Hocuspocus, flushed on disconnect/destroy)
 * writes the current state back.
 */
import { type Hocuspocus, Server } from '@hocuspocus/server'
import { encodeStateAsUpdate } from 'yjs'
import { RelayDb } from './db.ts'

export interface RelayOptions {
  dbPath: string
  /** Defaults to 0 (ephemeral — read the actual port after listen()). */
  port?: number
}

export interface Relay {
  hocuspocus: Hocuspocus
  db: RelayDb
  /** The bound port; meaningful after listen() resolves. */
  readonly port: number
  listen(): Promise<void>
  destroy(): Promise<void>
}

export function createRelay(opts: RelayOptions): Relay {
  const db = new RelayDb(opts.dbPath)

  const server = new Server({
    port: opts.port ?? 0,
    quiet: true,
    stopOnSignals: false, // main.ts owns shutdown; keeps embedded/test use clean

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const share = db.getShare(token)
      if (!share) throw new Error('unknown share token')
      const inScope =
        documentName === `${share.folderGuid}/folder` ||
        documentName.startsWith(`${share.folderGuid}/`)
      if (!inScope) throw new Error('document outside share scope')
      if (share.readOnly) connectionConfig.readOnly = true
      return { folderGuid: share.folderGuid, readOnly: share.readOnly }
    },

    async onLoadDocument({ documentName }) {
      // Returning a Uint8Array makes Hocuspocus apply it as an update to the
      // fresh server-side Y.Doc; null/undefined means "start empty".
      return db.getDocState(documentName)
    },

    async onStoreDocument({ documentName, document }) {
      db.putDocState(documentName, encodeStateAsUpdate(document))
    },
  })

  return {
    hocuspocus: server.hocuspocus,
    db,
    get port() {
      return server.address.port
    },
    async listen() {
      await server.listen()
    },
    async destroy() {
      // Server.destroy() flushes pending debounced stores and waits for all
      // documents to unload, so doc state is in SQLite before we close it.
      await server.destroy()
      db.close()
    },
  }
}
