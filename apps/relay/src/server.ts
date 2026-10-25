/**
 * createRelay — the thin Hocuspocus v4 sync server (docs/architecture/relay.md).
 *
 * Auth: static per-share bearer tokens checked in onAuthenticate against the
 * relay-authoritative shares table. Doc names are `<folderGuid>/<docGuid>`,
 * so authorization is a relay-side prefix check — never derived from doc
 * contents. Read-only shares flip `connectionConfig.readOnly`, which makes
 * Hocuspocus drop incoming updates from that connection.
 *
 * Two token kinds (device-link-shaping A4-A, R5):
 *   - `folder` — exact room match, as it has always been. A folder token
 *     never reaches the vault it was carved out of, nor a sibling room.
 *   - `device` — one person's own device. Exact match *or* any room whose
 *     recorded ancestry (the `rooms` table, written by POST /shares with a
 *     `parent`) reaches the token's room, so folders carved after the
 *     devices were linked need no new paste.
 * `read_only` is orthogonal: a read-only device token is read-only
 * everywhere it reaches. The relay stays the only auth authority — maps and
 * descs are advisory (parent D4) and tokens never travel in them.
 *
 * Persistence: full doc state as an opaque blob in SQLite. onLoadDocument
 * returns the stored Uint8Array (v4 applies it as a Yjs update for us);
 * onStoreDocument (debounced by Hocuspocus, flushed on disconnect/destroy)
 * writes the current state back.
 *
 * Plain HTTP on the same port goes through onRequest: `GET /healthz` (the
 * unauthenticated container/proxy probe) and the operator admin API (admin.ts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Hocuspocus, Server } from '@hocuspocus/server'
import { encodeStateAsUpdate } from 'yjs'
import { handleAdminRequest } from './admin.ts'
import { RelayDb } from './db.ts'

export interface RelayOptions {
  dbPath: string
  /** Defaults to 0 (ephemeral — read the actual port after listen()). */
  port?: number
  /**
   * Enables the operator admin HTTP API (mint/list/revoke shares) guarded by
   * `Authorization: Bearer <secret>`. Unset → the routes answer 404 and the
   * CLI remains the only mutation path (see admin.ts).
   */
  operatorSecret?: string
}

export interface Relay {
  hocuspocus: Hocuspocus
  db: RelayDb
  /** The bound port; meaningful after listen() resolves. */
  readonly port: number
  listen(): Promise<void>
  destroy(): Promise<void>
}

/**
 * GET /healthz: 200 `{ ok: true }` only while the database answers a read,
 * else 503 — a relay that accepts sockets but cannot persist is not healthy.
 * Unauthenticated, so it says nothing else (no counts, names or version).
 */
function handleHealthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  db: RelayDb
): boolean {
  if (new URL(request.url ?? '/', 'http://relay.invalid').pathname !== '/healthz') return false
  let ok = true
  try {
    db.ping()
  } catch {
    ok = false
  }
  // Readable cross-origin: the app probes it before a join or a share
  // (apps/web relay-probe.ts) from the web origin and the desktop webview.
  // It carries no credential and says nothing but `ok`, so `*` gives away
  // nothing the socket handshake does not.
  response.writeHead(ok ? 200 : 503, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  response.end(JSON.stringify({ ok }))
  return true
}

/**
 * Why the relay refused a connection, as the client reads it. Hocuspocus
 * answers every throw in `onAuthenticate` with `permission-denied` unless
 * the thrown value carries a `reason`, which it forwards verbatim — so the
 * two refusals the client can word usefully say which they are. Anything
 * else (a database failure) stays the default.
 */
export type RefusalReason = 'unknown_token' | 'out_of_scope'

function refusal(reason: RefusalReason, message: string): Error & { reason: RefusalReason } {
  return Object.assign(new Error(message), { reason })
}

export function createRelay(opts: RelayOptions): Relay {
  const db = new RelayDb(opts.dbPath)

  const server = new Server({
    port: opts.port ?? 0,
    quiet: true,
    stopOnSignals: false, // main.ts owns shutdown; keeps embedded/test use clean

    async onRequest({ request, response }: { request: IncomingMessage; response: ServerResponse }) {
      const handled =
        handleHealthRequest(request, response, db) ||
        (await handleAdminRequest(request, response, db, opts.operatorSecret))
      if (handled) {
        // Hocuspocus contract: a rejected onRequest hook aborts the chain so
        // its default "Welcome to Hocuspocus!" handler never runs; throwing a
        // falsy value aborts without surfacing an error (`if (error) throw`).
        throw null
      }
    },

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const share = db.getShare(token)
      if (!share) throw refusal('unknown_token', 'unknown share token')
      // One prefix, every doc of the room — the folder doc
      // (`<guid>/folder`) is just another name under it.
      const inScope = documentName.startsWith(`${share.folderGuid}/`)
      // A device token also reaches the rooms carved out of its own room.
      // The room is the first doc-name segment; the walk is bounded and
      // cycle-guarded in db.ancestorsOf.
      const viaAncestry =
        !inScope &&
        share.kind === 'device' &&
        db.ancestorsOf(documentName.split('/')[0] ?? '').includes(share.folderGuid)
      if (!inScope && !viaAncestry) throw refusal('out_of_scope', 'document outside share scope')
      if (share.readOnly) connectionConfig.readOnly = true
      return { folderGuid: share.folderGuid, readOnly: share.readOnly, kind: share.kind }
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
